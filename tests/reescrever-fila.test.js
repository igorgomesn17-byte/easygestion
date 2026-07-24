// ============================================================
// EDITAR A MENSAGEM ALCANCA A FILA QUE JA EXISTE.
//
// BUG DE CAMPO (24/07/2026): o Igor colou o link de avaliacao do Google no template
// da tela Fidelidade, salvou, viu "Mensagem salva" — e os 4 contatos do dia daquele
// tipo continuaram com o texto ANTIGO, sem o link. Clicar em "Atualizar lista"
// tambem nao resolvia: /gerar so materializa acoes que FALTAM, nunca reescreve as
// que existem.
//
// A causa e' o desenho: a regua CONGELA a mensagem interpolada em crm_acoes no
// momento da geracao (06:00). Isso protege o gatilho de dia exato, mas deixava a
// edicao sem alcance sobre a fila.
//
// O que este teste trava:
//   - editar o template reescreve as PENDENTES daquele tipo;
//   - NAO toca nas ja enviadas (historico e' historico);
//   - NAO toca em outros tipos;
//   - o CUPOM NOMINAL ja emitido sobrevive (nao gera codigo novo).
//
//   node tests/reescrever-fila.test.js
// ============================================================
process.env.DB_DIR = process.env.DB_DIR || './tests/.tmp-reescrever';
const fs = require('fs');
const path = require('path');

const dir = path.resolve(process.env.DB_DIR);
if (fs.existsSync(dir)) fs.rmSync(dir, { recursive: true, force: true });
fs.mkdirSync(dir, { recursive: true });

const { db } = require('../db/database');
const { reescreverAcoesPendentes, mensagemDe } = require('../lib/crm');

let falhas = 0;
const ok = (d, c, x = '') => { if (c) console.log(`  ✅ ${d}`); else { console.log(`  ❌ ${d}${x ? ' → ' + x : ''}`); falhas++; } };
const secao = (t) => console.log(`\n${t}`);

const hoje = new Date().toISOString().slice(0, 10);

const T = Number(db.prepare(`
  INSERT INTO tenants (nome_loja, nome_responsavel, telefone, email, senha_hash, plano, status)
  VALUES ('Loja Reescreve', 'R', '73999990000', ?, 'x', 'interno', 'ativo')
`).run(`resc-${Date.now()}@t.com`).lastInsertRowid);

const cliente = (nome) => Number(db.prepare(`
  INSERT INTO clientes (tenant_id, nome, telefone, total_gasto, num_compras, ultima_compra, arquivado, nao_perturbe)
  VALUES (?, ?, '73988887777', 500, 3, ?, 0, 0)
`).run(T, nome, hoje).lastInsertRowid);

const acao = (cli, tipo, msg, status = 'pendente', cupom = null, cupomId = null) => Number(db.prepare(`
  INSERT INTO crm_acoes (tenant_id, data, cliente_id, tipo, prioridade, mensagem, status, cupom, cupom_id, detalhe)
  VALUES (?, ?, ?, ?, 2, ?, ?, ?, ?, '60 dias sem comprar')
`).run(T, hoje, cli, tipo, msg, status, cupom, cupomId).lastInsertRowid);

const msgDe = (id) => db.prepare('SELECT mensagem FROM crm_acoes WHERE id = ?').get(id).mensagem;

const maria = cliente('Maria');
const ana = cliente('Ana');

// ============================================================
secao('1. Editar o template reescreve as PENDENTES');
// ============================================================
const pend = acao(maria, 'GOOGLE', 'TEXTO ANTIGO sem link');
const enviada = acao(ana, 'GOOGLE', 'TEXTO ANTIGO sem link', 'enviada');

// a lojista salva o texto novo (com o link)
db.prepare(`INSERT INTO crm_templates (tenant_id, tipo, texto, ativo) VALUES (?, 'GOOGLE', ?, 1)`)
  .run(T, 'Oi {nome}! Avalia a gente aqui: https://g.page/EXEMPLO/review');

const n = reescreverAcoesPendentes(T, 'GOOGLE');
ok('reescreveu 1 acao (so a pendente)', n === 1, String(n));
ok('a PENDENTE tem o texto novo com o link', /g\.page\/EXEMPLO/.test(msgDe(pend)), msgDe(pend));
ok('e ela foi interpolada com o nome da cliente', /Maria/.test(msgDe(pend)), msgDe(pend));
ok('a ENVIADA continua intocada (historico)', msgDe(enviada) === 'TEXTO ANTIGO sem link', msgDe(enviada));

// ============================================================
secao('2. Nao vaza pra outros tipos');
// ============================================================
const outra = acao(maria, 'REAT_1', 'mensagem de reativacao original');
reescreverAcoesPendentes(T, 'GOOGLE');
ok('acao de OUTRO tipo nao foi tocada', msgDe(outra) === 'mensagem de reativacao original');

// ============================================================
secao('3. O CUPOM NOMINAL ja emitido sobrevive');
// ============================================================
// cupom real na tabela, com o codigo unico da cliente
const cupomId = Number(db.prepare(`
  INSERT INTO crm_cupons (tenant_id, codigo, cliente_id, tipo, pct, min_compra, validade, status)
  VALUES (?, 'VOLTE20-K3P9', ?, 'REAT_2', 20, 0, '2026-12-31', 'rascunho')
`).run(T, maria).lastInsertRowid);
const comCupom = acao(maria, 'REAT_2', 'texto antigo com VOLTE20-K3P9', 'pendente', 'VOLTE20-K3P9', cupomId);

db.prepare(`INSERT INTO crm_templates (tenant_id, tipo, texto, cupom, cupom_pct, cupom_dias, ativo)
            VALUES (?, 'REAT_2', ?, 'VOLTE20', 20, 7, 1)`)
  .run(T, 'Oi {nome}! Volta pra gente com {cupom_pct}% no cupom {cupom} 🎁');

reescreverAcoesPendentes(T, 'REAT_2');
const nova = msgDe(comCupom);
ok('a mensagem nova mantem o codigo NOMINAL da cliente', nova.includes('VOLTE20-K3P9'), nova);
ok('NAO caiu no prefixo cru da campanha', !/cupom VOLTE20\b(?!-)/.test(nova), nova);
ok('o pct do cupom emitido continua o mesmo (20%)', nova.includes('20%'), nova);

const cupomDepois = db.prepare('SELECT codigo, pct, status FROM crm_cupons WHERE id = ?').get(cupomId);
ok('nenhum cupom NOVO foi emitido', db.prepare('SELECT COUNT(*) n FROM crm_cupons WHERE tenant_id=?').get(T).n === 1);
ok('o cupom original nao mudou', cupomDepois.codigo === 'VOLTE20-K3P9' && cupomDepois.pct === 20);

// ============================================================
secao('4. Tipo desligado nao apaga a fila');
// ============================================================
const antesDesligar = msgDe(pend);
db.prepare(`UPDATE crm_templates SET ativo = 0 WHERE tenant_id = ? AND tipo = 'GOOGLE'`).run(T);
reescreverAcoesPendentes(T, 'GOOGLE');
ok('mensagem preservada quando o tipo esta desligado', msgDe(pend) === antesDesligar);

// ============================================================
secao('5. Isolamento entre lojas');
// ============================================================
const T2 = Number(db.prepare(`
  INSERT INTO tenants (nome_loja, nome_responsavel, telefone, email, senha_hash, plano, status)
  VALUES ('Outra', 'R', '73999990000', ?, 'x', 'interno', 'ativo')
`).run(`resc2-${Date.now()}@t.com`).lastInsertRowid);
const cliB = Number(db.prepare(`
  INSERT INTO clientes (tenant_id, nome, telefone, total_gasto, num_compras, ultima_compra, arquivado, nao_perturbe)
  VALUES (?, 'Cliente B', '73911112222', 100, 1, ?, 0, 0)
`).run(T2, hoje).lastInsertRowid);
const acaoB = Number(db.prepare(`
  INSERT INTO crm_acoes (tenant_id, data, cliente_id, tipo, prioridade, mensagem, status)
  VALUES (?, ?, ?, 'GOOGLE', 2, 'mensagem da loja B', 'pendente')
`).run(T2, hoje, cliB).lastInsertRowid);

reescreverAcoesPendentes(T, 'GOOGLE');
ok('editar na loja A nao mexe na fila da loja B',
   db.prepare('SELECT mensagem FROM crm_acoes WHERE id = ?').get(acaoB).mensagem === 'mensagem da loja B');

console.log(`\n${falhas === 0 ? '✅ REESCRITA OK — a edicao alcanca a fila, sem quebrar cupom nem historico' : `❌ ${falhas} falha(s)`}`);
process.exit(falhas === 0 ? 0 : 1);
