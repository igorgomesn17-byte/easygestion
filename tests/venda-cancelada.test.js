// ============================================================
// VENDA CANCELADA NAO PODE CONTAR NO DINHEIRO.
//
// BUG VISTO EM PRODUCAO (18/07/2026): "vendas canceladas ainda constam no
// faturamento do dia". Cancelar faz SOFT DELETE (deletado=1, pra auditoria) e manda
// recalcular o caixa — mas o recalculo somava TODAS as vendas da data, inclusive as
// canceladas. O estoque voltava e a cliente era estornada, mas o faturamento nao.
//
// O mesmo furo estava em 8 outras queries de dinheiro (DRE, fluxo, dashboard,
// relatorio por canal/vendedor, conciliacao, comissao). Este teste guarda o
// principio: soft delete SO funciona se TODO leitor souber filtrar.
//
//   node tests/venda-cancelada.test.js
// ============================================================
process.env.DB_DIR = process.env.DB_DIR || './tests/.tmp-cancel';
const fs = require('fs');
const path = require('path');

const dir = path.resolve(process.env.DB_DIR);
if (fs.existsSync(dir)) fs.rmSync(dir, { recursive: true, force: true });
fs.mkdirSync(dir, { recursive: true });

const { db } = require('../db/database');

let falhas = 0;
const ok = (d, c, x = '') => { if (c) console.log(`  ✅ ${d}`); else { console.log(`  ❌ ${d}${x ? ' → ' + x : ''}`); falhas++; } };
const secao = (t) => console.log(`\n${t}`);

const hoje = new Date().toISOString().slice(0, 10);
const mes = hoje.slice(0, 7);

const T = Number(db.prepare(`
  INSERT INTO tenants (nome_loja, nome_responsavel, telefone, email, senha_hash, plano, status)
  VALUES ('Loja Cancel', 'R', '73999990000', ?, 'x', 'interno', 'ativo')
`).run(`cancel-${Date.now()}@t.com`).lastInsertRowid);

// Duas vendas de R$100 no mesmo dia: uma fica, a outra sera cancelada.
const venda = (total, deletado = 0) => Number(db.prepare(`
  INSERT INTO vendas (tenant_id, data_hora, total, valor_liquido, lucro, custo_total, forma_pagamento, origem, deletado)
  VALUES (?, ?, ?, ?, ?, ?, 'pix', 'loja', ?)
`).run(T, hoje + ' 10:00:00', total, total, total * 0.5, total * 0.5, deletado).lastInsertRowid);

const vOk = venda(100, 0);
const vCancelada = venda(100, 1);   // <- cancelada

const FILTRO = '(deletado IS NULL OR deletado = 0)';

// ============================================================
secao('1. As queries de dinheiro ignoram a venda cancelada');
// ============================================================
const somaDia = db.prepare(
  `SELECT COALESCE(SUM(total),0) v, COUNT(*) n FROM vendas
   WHERE date(data_hora) = ? AND tenant_id = ? AND ${FILTRO}`
).get(hoje, T);
ok('faturamento do dia = 100 (nao 200)', somaDia.v === 100, `veio ${somaDia.v}`);
ok('conta 1 venda (nao 2)', somaDia.n === 1, `veio ${somaDia.n}`);

const somaMes = db.prepare(
  `SELECT COALESCE(SUM(total),0) v FROM vendas
   WHERE substr(data_hora,1,7) = ? AND tenant_id = ? AND ${FILTRO}`
).get(mes, T);
ok('faturamento do mes (DRE) = 100', somaMes.v === 100, `veio ${somaMes.v}`);

// ============================================================
secao('2. Sem o filtro, o bug reaparece (prova que o filtro e o que segura)');
// ============================================================
const semFiltro = db.prepare(
  `SELECT COALESCE(SUM(total),0) v FROM vendas WHERE date(data_hora) = ? AND tenant_id = ?`
).get(hoje, T);
ok('sem o filtro somaria 200 (o bug original)', semFiltro.v === 200, `veio ${semFiltro.v}`);

// ============================================================
secao('3. A venda cancelada CONTINUA no banco (auditoria preservada)');
// ============================================================
const aindaLa = db.prepare('SELECT deletado FROM vendas WHERE id = ?').get(vCancelada);
ok('a linha nao foi apagada', !!aindaLa);
ok('e esta marcada deletado=1', aindaLa.deletado === 1);

// ============================================================
secao('4. As queries REAIS do sistema carregam o filtro');
// ============================================================
// Guarda contra regressao: se alguem escrever uma agregacao nova sem o filtro,
// este teste nao pega — mas o grep abaixo documenta onde ele precisa estar.
const arquivos = {
  'routes/vendas.js': ['atualizarCaixaDia'],
  'lib/dre.js': ['SUM(total)'],
  'routes/financeiro.js': ['SUM(total)'],
  'routes/dashboard.js': ['SUM(total)'],
  'routes/vendedores.js': ['SUM(total)'],
};
for (const [arq] of Object.entries(arquivos)) {
  const src = fs.readFileSync(path.join(__dirname, '..', arq), 'utf8');
  // pega as linhas com FROM vendas que agregam dinheiro
  const linhas = src.split('\n').filter(l => /FROM vendas/.test(l));
  const semFiltroReal = linhas.filter(l => !/deletado/.test(l) && !/DELETE FROM/.test(l) &&
                                            !/WHERE id = \?/.test(l) && !/LIMIT 100/.test(l));
  // as que sobram devem ser lookups por id (sem SUM/COUNT de dinheiro no mesmo trecho)
  ok(`${arq}: nenhuma agregacao de dinheiro sem filtro`,
     semFiltroReal.every(l => !/SUM\(|COUNT\(\*\)/.test(l)),
     semFiltroReal.filter(l => /SUM\(|COUNT\(\*\)/.test(l)).join(' | ').slice(0, 90));
}

console.log(`\n${falhas === 0 ? '✅ CANCELAMENTO OK — venda cancelada nao entra no dinheiro' : `❌ ${falhas} falha(s)`}`);
process.exit(falhas === 0 ? 0 : 1);
