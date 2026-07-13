// ============================================================
// ISOLAMENTO MULTI-TENANT DO RELACIONAMENTO
//
// Este e' O teste que justifica a refatoracao do lib/crm.js. O arquivo veio de um
// sistema de UMA loja: fazia `SELECT * FROM clientes` sem WHERE tenant_id e chamava
// getConfig() omitindo o tenant (que tem `= 1` como default). Ligado assim, a loja B
// veria os clientes da loja A e leria a config da loja 1.
//
// O cross-tenant.test.js existente e' um grep no codigo — ele NAO pega um SELECT sem
// WHERE. So um teste que povoa dois tenants e compara o resultado pega.
//
//   node tests/crm-tenant.test.js
// ============================================================
process.env.DB_DIR = process.env.DB_DIR || './tests/.tmp-crm';
const fs = require('fs');
const path = require('path');

// Banco limpo a cada rodada
const dir = path.resolve(process.env.DB_DIR);
if (fs.existsSync(dir)) fs.rmSync(dir, { recursive: true, force: true });
fs.mkdirSync(dir, { recursive: true });

const { db, setConfig } = require('../db/database');
const crm = require('../lib/crm');

let falhas = 0;
function ok(desc, cond, extra = '') {
  if (cond) { console.log(`  ✅ ${desc}`); }
  else { console.log(`  ❌ ${desc}${extra ? ' → ' + extra : ''}`); falhas++; }
}
function secao(t) { console.log(`\n${t}`); }

const hoje = new Date().toISOString().slice(0, 10);
const ddmmHoje = hoje.slice(8, 10) + '/' + hoje.slice(5, 7);

// ---------- Setup: duas lojas, cada uma com sua cliente ----------
function criarTenant(nome, email) {
  const r = db.prepare(`
    INSERT INTO tenants (nome_loja, nome_responsavel, telefone, email, senha_hash, plano, status)
    VALUES (?, ?, '73999990000', ?, 'x', 'interno', 'ativo')
  `).run(nome, 'Responsavel ' + nome, email);
  return Number(r.lastInsertRowid);
}
const A = criarTenant('Loja A', `a-${Date.now()}@t.com`);
const B = criarTenant('Loja B', `b-${Date.now()}@t.com`);

const { semearConfigRelacionamento } = require('../lib/config-relacionamento');
semearConfigRelacionamento(db, A);
semearConfigRelacionamento(db, B);
setConfig('loja_nome', 'Loja A', A);
setConfig('loja_nome', 'Loja B', B);

// Cliente que comprou HOJE e faz aniversario HOJE (dispara varios gatilhos)
function criarCliente(tenantId, nome, { totalGasto = 0, numCompras = 1, ultimaCompra = hoje } = {}) {
  const r = db.prepare(`
    INSERT INTO clientes (tenant_id, nome, telefone, aniversario, total_gasto, num_compras, ultima_compra, arquivado, nao_perturbe)
    VALUES (?, ?, '73999990000', ?, ?, ?, ?, 0, 0)
  `).run(tenantId, nome, ddmmHoje, totalGasto, numCompras, ultimaCompra);
  return Number(r.lastInsertRowid);
}
const cliA = criarCliente(A, 'Ana da Loja A', { totalGasto: 600, numCompras: 3 });
const cliB = criarCliente(B, 'Bia da Loja B', { totalGasto: 600, numCompras: 3 });

// ============================================================
secao('1. acoesDoDia NAO vaza clientes entre lojas');
// ============================================================
const acoesA = crm.acoesDoDia(A, hoje);
const acoesB = crm.acoesDoDia(B, hoje);

ok('loja A recebe acoes', acoesA.length > 0, `${acoesA.length} acoes`);
ok('loja B recebe acoes', acoesB.length > 0, `${acoesB.length} acoes`);
ok(
  'NENHUMA acao da loja A aponta pra cliente da loja B',
  acoesA.every((a) => a.cliente_id !== cliB),
  'VAZAMENTO: a regua da loja A esta contatando cliente de outra loja'
);
ok(
  'NENHUMA acao da loja B aponta pra cliente da loja A',
  acoesB.every((a) => a.cliente_id !== cliA),
  'VAZAMENTO CROSS-TENANT'
);
ok('toda acao da loja A e da propria cliente', acoesA.every((a) => a.cliente_id === cliA));

// ============================================================
secao('2. As mensagens usam a config DA LOJA (nao a do tenant 1)');
// ============================================================
const msgA = acoesA.map((a) => a.mensagem).join('\n');
const msgB = acoesB.map((a) => a.mensagem).join('\n');
ok('mensagem da loja A cita "Loja A"', msgA.includes('Loja A'));
ok('mensagem da loja B cita "Loja B"', msgB.includes('Loja B'));
ok('mensagem da loja B NAO cita "Loja A"', !msgB.includes('Loja A'),
  'getConfig caiu no tenant errado — a loja B esta mandando mensagem assinada por outra loja');

// ============================================================
secao('3. getConfig respeita o tenant (o bug do "tenantId = 1")');
// ============================================================
setConfig('clube_valor_selo', '50', A);
setConfig('clube_valor_selo', '200', B);
const selosA = crm.selosDe(A, { total_gasto: 600 });
const selosB = crm.selosDe(B, { total_gasto: 600 });
ok('loja A: R$600 / selo de R$50 = 12 selos', selosA.selos === 12, `deu ${selosA.selos}`);
ok('loja B: R$600 / selo de R$200 = 3 selos', selosB.selos === 3,
  `deu ${selosB.selos} — se deu 12, getConfig ignorou o tenant e leu a config da loja A`);

// ============================================================
secao('4. Sem tenantId, o motor DERRUBA (nao devolve tudo)');
// ============================================================
function lanca(fn) { try { fn(); return false; } catch (e) { return true; } }
ok('acoesDoDia(undefined) lanca', lanca(() => crm.acoesDoDia(undefined, hoje)),
  'PERIGO: sem tenant a funcao respondeu — e' + ' varreria a base inteira');
ok('acoesDoDia(0) lanca', lanca(() => crm.acoesDoDia(0, hoje)));
ok('segmentarRFM(null) lanca', lanca(() => crm.segmentarRFM(null, hoje)));
ok('selosDe(undefined) lanca', lanca(() => crm.selosDe(undefined, { total_gasto: 100 })));

// ============================================================
secao('5. segmentarRFM tambem nao vaza');
// ============================================================
const rfmA = crm.segmentarRFM(A, hoje);
const rfmB = crm.segmentarRFM(B, hoje);
ok('RFM da loja A so tem cliente da loja A',
  rfmA.clientes.every((c) => c.id === cliA), 'VAZAMENTO na RFM');
ok('RFM da loja B so tem cliente da loja B',
  rfmB.clientes.every((c) => c.id === cliB), 'VAZAMENTO na RFM');
ok('RFM da loja A conta 1 cliente', rfmA.total_clientes === 1, `contou ${rfmA.total_clientes}`);

// ============================================================
secao('6. Anti-farming: gasto pago com vale do clube nao gera selo');
// ============================================================
setConfig('clube_valor_selo', '50', A);
const semVale = crm.selosDe(A, { total_gasto: 500, gasto_sem_selo: 0 });
const comVale = crm.selosDe(A, { total_gasto: 500, gasto_sem_selo: 100 });
ok('R$500 limpos = 10 selos', semVale.selos === 10, `deu ${semVale.selos}`);
ok('R$500 com R$100 pagos em vale = 8 selos', comVale.selos === 8,
  `deu ${comVale.selos} — o clube estaria financiando a si mesmo`);

// ============================================================
secao('7. Config invalida nao vira premio infinito');
// ============================================================
setConfig('clube_valor_selo', '0', B);
const div0 = crm.selosDe(B, { total_gasto: 500 });
ok('selo de R$0 nao gera Infinity selos', Number.isFinite(div0.selos) && div0.selos === 0,
  `deu ${div0.selos}`);

// ---------- Resultado ----------
console.log('');
if (falhas === 0) {
  console.log('✅ ISOLAMENTO DO RELACIONAMENTO OK — nenhuma loja enxerga a outra');
  process.exit(0);
} else {
  console.log(`❌ ${falhas} FALHA(S) — NAO SUBIR PRA PRODUCAO`);
  process.exit(1);
}
