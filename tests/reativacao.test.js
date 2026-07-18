// ============================================================
// REATIVACAO DA BASE IMPORTADA — a campanha que NAO e' a regua.
//
// O que este teste trava:
//   1. a feature `base_importada` existe SO no plano interno (o Igor foi explicito:
//      "isso e so no perfil da DS, pra depois voce nao fazer para todo o sistema").
//      Se ela vazar pro growth, toda lojista que assinar ganha uma aba que nao faz
//      sentido pra loja dela;
//   2. so entra na campanha quem e' tipo='importado' (a base migrada), nunca a
//      cliente normal da loja;
//   3. contatar e' idempotente e reversivel;
//   4. o cupom emitido e' NOMINAL (codigo unico por cliente).
//
//   node tests/reativacao.test.js
// ============================================================
process.env.DB_DIR = process.env.DB_DIR || './tests/.tmp-reat';
const fs = require('fs');
const path = require('path');

const dir = path.resolve(process.env.DB_DIR);
if (fs.existsSync(dir)) fs.rmSync(dir, { recursive: true, force: true });
fs.mkdirSync(dir, { recursive: true });

const { db } = require('../db/database');
const { PLANOS, temFeature } = require('../lib/planos');
const { emitirCupom } = require('../lib/cupons');

let falhas = 0;
const ok = (d, c, x = '') => { if (c) console.log(`  ✅ ${d}`); else { console.log(`  ❌ ${d}${x ? ' → ' + x : ''}`); falhas++; } };
const secao = (t) => console.log(`\n${t}`);

const T = Number(db.prepare(`
  INSERT INTO tenants (nome_loja, nome_responsavel, telefone, email, senha_hash, plano, status)
  VALUES ('Loja Reat', 'R', '73999990000', ?, 'x', 'interno', 'ativo')
`).run(`reat-${Date.now()}@t.com`).lastInsertRowid);

// ============================================================
secao('1. O GATE: a feature existe SO no interno');
// ============================================================
ok('starter NAO tem base_importada',    temFeature('starter', 'base_importada') === false);
ok('growth NAO tem base_importada',     temFeature('growth', 'base_importada') === false);
ok('enterprise NAO tem base_importada', temFeature('enterprise', 'base_importada') === false);
ok('interno TEM base_importada',        temFeature('interno', 'base_importada') === true);

// A tela nao pode citar a campanha especifica: se um dia virar produto, o texto
// tem que servir pra qualquer loja.
const html = fs.readFileSync(path.join(__dirname, '..', 'public', 'reativacao.html'), 'utf8');
const rota = fs.readFileSync(path.join(__dirname, '..', 'routes', 'reativacao.js'), 'utf8');
ok('a TELA nao cita a cidade da campanha (texto generico)', !/camacan/i.test(html));
ok('a ROTA nao cita a cidade da campanha', !/camacan/i.test(rota));

// ============================================================
secao('2. So a base IMPORTADA entra na campanha');
// ============================================================
const importada = Number(db.prepare(`
  INSERT INTO clientes (tenant_id, nome, telefone, tipo, total_gasto, num_compras, ultima_compra, arquivado, nao_perturbe)
  VALUES (?, 'Cleide Importada', '73988887777', 'importado', 1500, 8, '2025-06-15', 0, 0)
`).run(T).lastInsertRowid);
const normal = Number(db.prepare(`
  INSERT INTO clientes (tenant_id, nome, telefone, total_gasto, num_compras, ultima_compra, arquivado, nao_perturbe)
  VALUES (?, 'Maria Normal', '73977776666', 2000, 10, '2026-07-01', 0, 0)
`).run(T).lastInsertRowid);
const balcao = Number(db.prepare(`
  INSERT INTO clientes (tenant_id, nome, tipo, total_gasto, num_compras, arquivado, nao_perturbe)
  VALUES (?, 'Consumidor não identificado', 'balcao', 9999, 300, 0, 1)
`).run(T).lastInsertRowid);

const daCampanha = db.prepare(
  `SELECT id FROM clientes WHERE tenant_id = ? AND tipo = 'importado' AND arquivado = 0 AND nao_perturbe = 0`
).all(T).map(r => r.id);
ok('a importada entra', daCampanha.includes(importada));
ok('a cliente NORMAL da loja nao entra', !daCampanha.includes(normal));
ok('o balcao nao entra', !daCampanha.includes(balcao));

// ============================================================
secao('3. Ondas por VALOR (o dinheiro e concentrado)');
// ============================================================
const ONDAS = { vip: [1000, Infinity], alta: [500, 1000], media: [200, 500], baixa: [0, 200] };
const ondaDe = (g) => Object.entries(ONDAS).find(([, [a, b]]) => g >= a && g < b)[0];
ok('R$1.500 cai na onda VIP',  ondaDe(1500) === 'vip');
ok('R$700 cai na onda alta',   ondaDe(700) === 'alta');
ok('R$300 cai na media',       ondaDe(300) === 'media');
ok('R$50 cai na baixa',        ondaDe(50) === 'baixa');

// ============================================================
secao('4. Contatar: registra, nao duplica, e da pra desfazer');
// ============================================================
const marcar = (cli, onda, cupom) => db.prepare(`
  INSERT INTO reativacao_contatos (tenant_id, cliente_id, onda, mensagem, cupom)
  VALUES (?, ?, ?, 'oi', ?)
  ON CONFLICT (tenant_id, cliente_id) DO UPDATE SET
    onda = excluded.onda, contatado_em = datetime('now','localtime')
`).run(T, cli, onda, cupom || null);

marcar(importada, 'vip', null);
ok('registra o contato', db.prepare('SELECT COUNT(*) n FROM reativacao_contatos WHERE tenant_id=? AND cliente_id=?').get(T, importada).n === 1);

marcar(importada, 'vip', null);   // clicou de novo
ok('contatar 2x NAO duplica a linha', db.prepare('SELECT COUNT(*) n FROM reativacao_contatos WHERE tenant_id=? AND cliente_id=?').get(T, importada).n === 1);

db.prepare('DELETE FROM reativacao_contatos WHERE tenant_id=? AND cliente_id=?').run(T, importada);
ok('desmarcar remove o registro', db.prepare('SELECT COUNT(*) n FROM reativacao_contatos WHERE tenant_id=?').get(T).n === 0);

// ============================================================
secao('5. O cupom da campanha e NOMINAL');
// ============================================================
const c1 = emitirCupom(T, { clienteId: importada, tipo: 'REATIVACAO', prefixo: 'VOLTA', pct: 15, dias: 15, status: 'ativo' });
const c2 = emitirCupom(T, { clienteId: normal,    tipo: 'REATIVACAO', prefixo: 'VOLTA', pct: 15, dias: 15, status: 'ativo' });
ok('emite o cupom', !!c1 && !!c1.codigo);
ok('codigo e' + ' unico por cliente (nao vaza no grupo)', c1.codigo !== c2.codigo, `${c1.codigo} vs ${c2.codigo}`);
ok('nasce ATIVO (o envio ja aconteceu)', c1.status === 'ativo');
ok('tem validade', !!c1.validade);

// ============================================================
secao('6. Isolamento entre lojas');
// ============================================================
const T2 = Number(db.prepare(`
  INSERT INTO tenants (nome_loja, nome_responsavel, telefone, email, senha_hash, plano, status)
  VALUES ('Outra Loja', 'R', '73999990000', ?, 'x', 'interno', 'ativo')
`).run(`reat2-${Date.now()}@t.com`).lastInsertRowid);
marcar(importada, 'vip', null);
const daOutra = db.prepare('SELECT COUNT(*) n FROM reativacao_contatos WHERE tenant_id=?').get(T2).n;
ok('a outra loja nao ve os contatos desta', daOutra === 0, String(daOutra));

console.log(`\n${falhas === 0 ? '✅ REATIVACAO OK — gate no interno, base certa, cupom nominal' : `❌ ${falhas} falha(s)`}`);
process.exit(falhas === 0 ? 0 : 1);
