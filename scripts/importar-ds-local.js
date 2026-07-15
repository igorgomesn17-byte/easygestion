// ============================================================
// IMPORTADOR: DS Local  ->  EasyGestão
//
// Traz do banco do sistema antigo (DS Local) para um tenant da EasyGestão:
//   1. clientes  (cadastro + total_gasto/num_compras/ultima_compra acumulados)
//   2. vendas    (com venda_pagamentos), com o cliente amarrado
//
// O QUE ELE **NÃO** FAZ, DE PROPÓSITO:
//   - NÃO importa produtos (o tenant já tem os dele; importar duplicaria)
//   - NÃO importa venda_itens (aponta pra produto que não existe aqui)
//   - NÃO mexe em estoque nem em caixa (as vendas são históricas, já aconteceram)
//
// IDEMPOTENTE:
//   - cliente: dedup por telefone (últimos 8 dígitos, igual ao importar-camacan)
//   - venda:   marcada em `observacao` com [imp:ds-local#<id_origem>]; rerun não duplica
//
// TRANSACIONAL: ou entra tudo, ou não entra nada.
//
// Uso:
//   node scripts/importar-ds-local.js --origem <caminho.db> --tenant <id> [--desde AAAA-MM] [--commit]
//
// SEM --commit é SIMULAÇÃO (dry-run): mostra o que faria e não grava nada.
// ============================================================
const fs = require('fs');
const path = require('path');
const { DatabaseSync } = require('node:sqlite');

// ---------- args ----------
const args = process.argv.slice(2);
function arg(nome, padrao = null) {
  const i = args.indexOf('--' + nome);
  return i >= 0 && args[i + 1] && !args[i + 1].startsWith('--') ? args[i + 1] : padrao;
}
const ORIGEM = arg('origem');
const TENANT = parseInt(arg('tenant'), 10);
const DESDE = arg('desde');           // ex: 2026-06  -> só vendas desse mês pra frente
const DESTINO = arg('destino', path.join(__dirname, '..', 'db', 'dsstore.db'));
const COMMIT = args.includes('--commit');

if (!ORIGEM || !fs.existsSync(ORIGEM)) {
  console.error('ERRO: --origem <caminho do dsstore.db do DS Local> é obrigatório e o arquivo precisa existir.');
  process.exit(1);
}
if (!Number.isInteger(TENANT) || TENANT <= 0) {
  console.error('ERRO: --tenant <id> é obrigatório (o id da loja na EasyGestão).');
  process.exit(1);
}
if (!fs.existsSync(DESTINO)) {
  console.error('ERRO: banco de destino não encontrado:', DESTINO);
  process.exit(1);
}

const soDigitos = (t) => String(t || '').replace(/\D/g, '');
const chaveTel = (t) => soDigitos(t).slice(-8);   // ignora DDD/nono dígito pra casar duplicado
const brl = (n) => 'R$ ' + Number(n || 0).toFixed(2).replace('.', ',');

console.log('='.repeat(64));
console.log(COMMIT ? '  IMPORTAÇÃO REAL (--commit)' : '  SIMULAÇÃO (dry-run) — nada será gravado');
console.log('='.repeat(64));
console.log('  origem :', ORIGEM);
console.log('  destino:', DESTINO);
console.log('  tenant :', TENANT);
console.log('  vendas :', DESDE ? `a partir de ${DESDE}` : 'todas');
console.log('');

// ---------- 1. cópia consistente da ORIGEM (pega o WAL junto) ----------
// Ler o .db direto perde o que ainda está no -wal. VACUUM INTO resolve.
const TMP = path.join(require('os').tmpdir(), `ds-local-import-${Date.now()}.db`);
{
  const o = new DatabaseSync(ORIGEM);
  o.exec(`VACUUM INTO '${TMP.replace(/\\/g, '/')}'`);
  o.close();
}
const src = new DatabaseSync(TMP, { readOnly: true });

// ---------- 2. backup do DESTINO ----------
if (COMMIT) {
  const dir = path.join(__dirname, '..', 'backups-producao');
  fs.mkdirSync(dir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[-:T]/g, '').slice(0, 14);
  const bak = path.join(dir, `dsstore-ANTES-IMPORT-${stamp}.db`);
  const d = new DatabaseSync(DESTINO);
  d.exec(`VACUUM INTO '${bak.replace(/\\/g, '/')}'`);
  d.close();
  console.log('  backup do destino:', bak, `(${(fs.statSync(bak).size / 1024).toFixed(0)} KB)\n`);
}

const dst = new DatabaseSync(DESTINO);
dst.exec('PRAGMA foreign_keys = ON');

// ---------- 3. sanidade: o tenant existe? ----------
const tenant = dst.prepare('SELECT id, nome_loja, email FROM tenants WHERE id = ?').get(TENANT);
if (!tenant) {
  console.error(`ERRO: tenant ${TENANT} não existe no destino. Abortando.`);
  process.exit(1);
}
console.log(`  loja destino: #${tenant.id} ${tenant.nome_loja} <${tenant.email}>\n`);

// ---------- 4. vendedores (tabela GLOBAL, sem tenant_id) — reusar por nome ----------
const vendedoresOrigem = src.prepare('SELECT * FROM vendedores').all();
const mapVendedor = new Map();     // id_origem -> id_destino (preenchido na transação)
const vendedoresACriar = [];
for (const v of vendedoresOrigem) {
  const existe = dst.prepare('SELECT id FROM vendedores WHERE nome = ?').get(v.nome);
  if (existe) mapVendedor.set(v.id, existe.id);
  else vendedoresACriar.push(v);
}

// ---------- 5. CLIENTES ----------
const clientesOrigem = src.prepare(`
  SELECT id, nome, telefone, cidade, aniversario, origem, total_gasto, num_compras,
         ultima_compra, arquivado, nao_perturbe
  FROM clientes ORDER BY id
`).all();

// telefones que JÁ existem neste tenant (dedup)
const jaTem = new Map();           // chaveTel -> id_destino
for (const c of dst.prepare('SELECT id, telefone FROM clientes WHERE tenant_id = ?').all(TENANT)) {
  const k = chaveTel(c.telefone);
  if (k) jaTem.set(k, c.id);
}

const mapCliente = new Map();      // id_origem -> id_destino (número, só depois do INSERT)
const novosClientes = [];
// A origem PODE ter o mesmo telefone em 2 cadastros (tem: a 'Ewellyn'). O 2o precisa
// apontar pro MESMO id de destino do 1o — senão vira cliente_id inválido e a FK estoura.
const donoDaChave = new Map();     // chaveTel -> id_origem do cadastro que vai virar o registro real
let clientesJaExistiam = 0, clientesSemTelefone = 0, clientesDupNaOrigem = 0;

for (const c of clientesOrigem) {
  const k = chaveTel(c.telefone);
  if (!k) { clientesSemTelefone++; continue; }        // sem telefone não dá pra deduplicar

  if (jaTem.has(k)) {                                 // já existe NO DESTINO: reaproveita
    mapCliente.set(c.id, jaTem.get(k));
    clientesJaExistiam++;
    continue;
  }
  if (donoDaChave.has(k)) {                           // duplicado DENTRO da origem: aponta pro irmão
    mapCliente.set(c.id, { _mesmoQue: donoDaChave.get(k) });
    clientesDupNaOrigem++;
    continue;
  }
  donoDaChave.set(k, c.id);
  novosClientes.push(c);
}

// ---------- 6. VENDAS ----------
const filtroData = DESDE ? `WHERE substr(data_hora,1,7) >= '${DESDE}'` : '';
const vendasOrigem = src.prepare(`SELECT * FROM vendas ${filtroData} ORDER BY data_hora, id`).all();

// vendas já importadas antes (rerun não duplica) — marca no observacao
const jaImportadas = new Set();
for (const v of dst.prepare(`SELECT observacao FROM vendas WHERE tenant_id = ? AND observacao LIKE '%[imp:ds-local#%'`).all(TENANT)) {
  const m = String(v.observacao).match(/\[imp:ds-local#(\d+)\]/);
  if (m) jaImportadas.add(parseInt(m[1], 10));
}

const vendasNovas = vendasOrigem.filter(v => !jaImportadas.has(v.id));
const pagsPorVenda = new Map();
for (const p of src.prepare('SELECT * FROM venda_pagamentos').all()) {
  if (!pagsPorVenda.has(p.venda_id)) pagsPorVenda.set(p.venda_id, []);
  pagsPorVenda.get(p.venda_id).push(p);
}

// ---------- 7. RELATÓRIO ----------
const totalNovas = vendasNovas.reduce((s, v) => s + (v.total || 0), 0);
const lucroNovas = vendasNovas.reduce((s, v) => s + (v.lucro || 0), 0);
const comCliente = vendasNovas.filter(v => v.cliente_id).length;

console.log('  ── CLIENTES ' + '─'.repeat(50));
console.log(`     a inserir ................ ${novosClientes.length}`);
console.log(`     já existiam no destino ... ${clientesJaExistiam}`);
console.log(`     duplicados na origem ..... ${clientesDupNaOrigem}  (mesmo telefone; viram 1 só)`);
console.log(`     sem telefone (pulados) ... ${clientesSemTelefone}`);
console.log('');
console.log('  ── VENDAS ' + '─'.repeat(52));
console.log(`     a inserir ................ ${vendasNovas.length}   (${brl(totalNovas)}, lucro ${brl(lucroNovas)})`);
console.log(`     já importadas antes ...... ${vendasOrigem.length - vendasNovas.length}`);
console.log(`     com cliente amarrado ..... ${comCliente}`);
console.log(`     sem cliente (balcão) ..... ${vendasNovas.length - comCliente}`);
if (vendasNovas.length) {
  const meses = {};
  for (const v of vendasNovas) {
    const m = String(v.data_hora).slice(0, 7);
    meses[m] = (meses[m] || { n: 0, t: 0 });
    meses[m].n++; meses[m].t += v.total || 0;
  }
  console.log('     por mês:');
  for (const [m, x] of Object.entries(meses).sort()) console.log(`       ${m}  ${String(x.n).padStart(4)} vendas  ${brl(x.t)}`);
}
console.log('');

if (!COMMIT) {
  console.log('  Nada foi gravado. Para importar de verdade, repita o comando com --commit');
  console.log('');
  src.close(); dst.close(); fs.unlinkSync(TMP);
  process.exit(0);
}

// ---------- 8. GRAVAÇÃO (tudo ou nada) ----------
const insCliente = dst.prepare(`
  INSERT INTO clientes (tenant_id, nome, telefone, cidade, aniversario, origem,
                        total_gasto, num_compras, ultima_compra, arquivado, nao_perturbe)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
`);
const insVendedor = dst.prepare('INSERT INTO vendedores (nome, telefone, comissao_pct, ativo) VALUES (?, ?, ?, ?)');
const insVenda = dst.prepare(`
  INSERT INTO vendas (tenant_id, data_hora, cliente_id, vendedor_id, subtotal, desconto, acrescimo,
                      total, forma_pagamento, origem, parcelas, taxa_aplicada, valor_liquido,
                      imposto, comissao_valor, embalagem_total, custo_total, lucro, observacao)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
`);
const insPag = dst.prepare(`
  INSERT INTO venda_pagamentos (venda_id, forma, parcelas, valor, taxa_pct, valor_taxa, valor_liquido)
  VALUES (?, ?, ?, ?, ?, ?, ?)
`);

// 'misto' não é forma válida na EasyGestão (o split mora em venda_pagamentos).
// Guarda a forma da MAIOR parte como a "cara" da venda; o detalhe fica nos pagamentos.
const FORMAS_VALIDAS = new Set(['pix', 'pix_chave', 'dinheiro', 'debito', 'credito_vista', 'credito_parcelado', 'vale', 'crediario']);
function normalizarForma(v) {
  if (FORMAS_VALIDAS.has(v.forma_pagamento)) return v.forma_pagamento;
  const pags = pagsPorVenda.get(v.id) || [];
  if (!pags.length) return 'dinheiro';
  return pags.slice().sort((a, b) => b.valor - a.valor)[0].forma;   // a maior parte manda
}

let nCli = 0, nVen = 0, nPag = 0, nVdd = 0;

// lastInsertRowid vem como BigInt — passar BigInt de volta num bind de FK estoura.
const novoId = (r) => Number(r.lastInsertRowid);

dst.exec('BEGIN');
try {
  // vendedores que faltam
  for (const v of vendedoresACriar) {
    const r = insVendedor.run(v.nome, v.telefone, v.comissao_pct || 0, v.ativo ?? 1);
    mapVendedor.set(v.id, novoId(r));
    nVdd++;
  }

  // clientes
  for (const c of novosClientes) {
    const r = insCliente.run(
      TENANT, c.nome, soDigitos(c.telefone), c.cidade || null, c.aniversario || null,
      c.origem || null, c.total_gasto || 0, c.num_compras || 0, c.ultima_compra || null,
      c.arquivado || 0, c.nao_perturbe || 0
    );
    mapCliente.set(c.id, novoId(r));
    nCli++;
  }

  // duplicados da origem: só agora o "irmão" tem id — resolve o ponteiro
  for (const [idOrig, alvo] of [...mapCliente]) {
    if (alvo && typeof alvo === 'object' && alvo._mesmoQue !== undefined) {
      const real = mapCliente.get(alvo._mesmoQue);
      if (typeof real !== 'number') throw new Error(`dedup: cliente ${idOrig} aponta pra ${alvo._mesmoQue}, que não tem id`);
      mapCliente.set(idOrig, real);
    }
  }

  // vendas + pagamentos
  for (const v of vendasNovas) {
    const clienteDst = v.cliente_id ? (mapCliente.get(v.cliente_id) ?? null) : null;
    const vddDst = v.vendedor_id ? (mapVendedor.get(v.vendedor_id) ?? null) : null;

    // FK só reclama "constraint failed", sem dizer qual. Falhe alto, com o dado na mão.
    if (clienteDst !== null && typeof clienteDst !== 'number')
      throw new Error(`venda origem #${v.id}: cliente_id ${v.cliente_id} nao resolveu (${JSON.stringify(clienteDst)})`);
    if (vddDst !== null && typeof vddDst !== 'number')
      throw new Error(`venda origem #${v.id}: vendedor_id ${v.vendedor_id} nao resolveu (${JSON.stringify(vddDst)})`);

    const marca = `[imp:ds-local#${v.id}]`;
    const obs = v.observacao ? `${v.observacao} ${marca}` : marca;

    const r = insVenda.run(
      TENANT, v.data_hora, clienteDst, vddDst,
      v.subtotal || 0, v.desconto || 0, v.acrescimo || 0, v.total || 0,
      normalizarForma(v), v.origem || 'loja', v.parcelas || 1,
      v.taxa_aplicada || 0, v.valor_liquido || 0, v.imposto || 0,
      v.comissao_valor || 0, v.embalagem_total || 0, v.custo_total || 0, v.lucro || 0, obs
    );
    const idVenda = novoId(r);
    nVen++;

    for (const p of (pagsPorVenda.get(v.id) || [])) {
      insPag.run(idVenda, p.forma, p.parcelas || 1, p.valor || 0, p.taxa_pct || 0, p.valor_taxa || 0, p.valor_liquido || 0);
      nPag++;
    }
  }

  dst.exec('COMMIT');
} catch (e) {
  console.error('\n  ERRO — nada foi gravado (rollback):', e.message);
  console.error('  contexto: clientes=' + nCli + ' vendas=' + nVen + ' pagamentos=' + nPag + ' vendedores=' + nVdd);
  if (process.env.DEBUG_IMPORT) console.error(e.stack);
  dst.exec('ROLLBACK');
  src.close(); dst.close(); fs.unlinkSync(TMP);
  process.exit(1);
}

// ---------- 9. CONFERÊNCIA (conta o que ficou de verdade no banco) ----------
const q = (sql) => dst.prepare(sql).get(TENANT);
const cli = q('SELECT COUNT(*) n FROM clientes WHERE tenant_id = ?').n;
const ven = q('SELECT COUNT(*) n, ROUND(COALESCE(SUM(total),0),2) t, ROUND(COALESCE(SUM(lucro),0),2) l FROM vendas WHERE tenant_id = ?');

console.log('  ── GRAVADO ' + '─'.repeat(51));
console.log(`     clientes inseridos ....... ${nCli}`);
console.log(`     vendas inseridas ......... ${nVen}`);
console.log(`     pagamentos inseridos ..... ${nPag}`);
console.log(`     vendedores criados ....... ${nVdd}`);
console.log('');
console.log('  ── AGORA NO BANCO (tenant ' + TENANT + ') ' + '─'.repeat(28));
console.log(`     clientes ................. ${cli}`);
console.log(`     vendas ................... ${ven.n}  (${brl(ven.t)}, lucro ${brl(ven.l)})`);
console.log('');
console.log('  ✅ Importação concluída.');
console.log('');

src.close(); dst.close();
fs.unlinkSync(TMP);
