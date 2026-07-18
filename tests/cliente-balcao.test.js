// ============================================================
// CLIENTE DE BALCAO + BASE IMPORTADA — os dois registros que NAO sao pessoas
// a contatar, e por isso precisam sair da regua sem sumir do sistema.
//
// O risco que este teste trava: o "Consumidor nao identificado" acumula as vendas
// de toda a loja. Se ele entrasse no RFM, viraria a "campea" da base (centenas de
// compras, milhares de reais) e distorceria todos os segmentos. Se entrasse na
// regua, apareceria na fila todo dia — sem telefone pra contatar.
//
//   node tests/cliente-balcao.test.js
// ============================================================
process.env.DB_DIR = process.env.DB_DIR || './tests/.tmp-balcao';
const fs = require('fs');
const path = require('path');

const dir = path.resolve(process.env.DB_DIR);
if (fs.existsSync(dir)) fs.rmSync(dir, { recursive: true, force: true });
fs.mkdirSync(dir, { recursive: true });

const { db } = require('../db/database');
const { clienteBalcao, acoesDoDia, segmentarRFM, NOME_BALCAO } = require('../lib/crm');

let falhas = 0;
const ok = (d, c, x = '') => { if (c) console.log(`  ✅ ${d}`); else { console.log(`  ❌ ${d}${x ? ' → ' + x : ''}`); falhas++; } };
const secao = (t) => console.log(`\n${t}`);

const fmt = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const hojeMenos = (n) => { const d = new Date(); d.setDate(d.getDate() - n); return fmt(d); };
const hoje = fmt(new Date());

const loja = (nome) => Number(db.prepare(`
  INSERT INTO tenants (nome_loja, nome_responsavel, telefone, email, senha_hash, plano, status)
  VALUES (?, 'R', '73999990000', ?, 'x', 'interno', 'ativo')
`).run(nome, `balcao-${Date.now()}-${Math.random()}@t.com`).lastInsertRowid);

const A = loja('Loja A'), B = loja('Loja B');

// ============================================================
secao('1. O balcao nasce sob demanda e eh unico por loja');
// ============================================================
const b1 = clienteBalcao(A);
const b2 = clienteBalcao(A);
ok('cria o cliente de balcao', !!b1.id);
ok('chamar de novo devolve o MESMO (nao duplica)', b1.id === b2.id, `${b1.id} vs ${b2.id}`);
ok('o nome e o esperado', b1.nome === NOME_BALCAO, b1.nome);

const bB = clienteBalcao(B);
ok('cada loja tem o SEU balcao (nao vaza entre tenants)', bB.id !== b1.id);

const linha = db.prepare('SELECT * FROM clientes WHERE id = ?').get(b1.id);
ok("nasce com tipo='balcao'", linha.tipo === 'balcao', String(linha.tipo));
ok('nasce SEM telefone (nao ha quem contatar)', !linha.telefone);
ok('nasce com nao_perturbe=1 (cinto e suspensorio)', linha.nao_perturbe === 1);

// ============================================================
secao('2. O balcao NAO entra na regua, por mais vendas que acumule');
// ============================================================
// Simula o pior caso: o balcao virou o "maior cliente" da loja e parou ha 30 dias
// (exatamente a janela da reativacao).
db.prepare(`UPDATE clientes SET total_gasto = 50000, num_compras = 300, ultima_compra = ?, telefone = '73988887777'
            WHERE id = ?`).run(hojeMenos(30), b1.id);

const acoes = acoesDoDia(A, hoje);
const doBalcao = acoes.filter(a => a.cliente_id === b1.id);
ok('o balcao NAO gera nenhuma acao na regua', doBalcao.length === 0, `gerou ${doBalcao.length}`);

// ============================================================
secao('3. O balcao NAO entra no RFM (senao vira a "campea" fantasma)');
// ============================================================
const rfm = segmentarRFM(A, hoje);
const noRfm = rfm.clientes.filter(c => c.id === b1.id);
ok('o balcao esta fora da matriz RFM', noRfm.length === 0, `apareceu ${noRfm.length}x`);

// ============================================================
secao('4. Base importada: fica no RFM, sai da regua');
// ============================================================
const importada = Number(db.prepare(`
  INSERT INTO clientes (tenant_id, nome, telefone, origem, tipo, total_gasto, num_compras, ultima_compra, arquivado, nao_perturbe)
  VALUES (?, 'Cleide de Camacan', '73977776666', 'Cliente Camacan', 'importado', 1200, 8, ?, 0, 0)
`).run(A, hojeMenos(30)).lastInsertRowid);

const acoes2 = acoesDoDia(A, hoje);
ok('importada NAO entra na fila diaria', acoes2.filter(a => a.cliente_id === importada).length === 0);

const rfm2 = segmentarRFM(A, hoje);
ok('mas CONTINUA no RFM (o valor dela e real)', rfm2.clientes.filter(c => c.id === importada).length === 1);

// ============================================================
secao('5. Cliente normal segue funcionando (nao quebrei a regua)');
// ============================================================
const normal = Number(db.prepare(`
  INSERT INTO clientes (tenant_id, nome, telefone, total_gasto, num_compras, ultima_compra, arquivado, nao_perturbe)
  VALUES (?, 'Maria Normal', '73955554444', 600, 3, ?, 0, 0)
`).run(A, hojeMenos(30)).lastInsertRowid);

const acoes3 = acoesDoDia(A, hoje);
ok('cliente normal de 30 dias GERA acao de reativacao', acoes3.some(a => a.cliente_id === normal && a.tipo === 'REAT_1'));

console.log(`\n${falhas === 0 ? '✅ BALCAO OK — preserva o dado sem envenenar regua e RFM' : `❌ ${falhas} falha(s)`}`);
process.exit(falhas === 0 ? 0 : 1);
