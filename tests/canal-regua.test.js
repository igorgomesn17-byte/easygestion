// ============================================================
// A REGUA GANHA CANAL — e dois gatilhos novos.
//
// O que este teste protege:
//
//   1. RESPOSTA FECHA O CICLO. Ate agora status='enviada' so dizia "cliquei no
//      botao". Sem respondeu_em nao da' pra saber se a mensagem CONVENCE — e' a
//      diferenca entre "mandei 40" e "mandei 40, 12 responderam".
//   2. CARRINHO ABANDONADO sai de vitrine_pedidos, sem tabela nova. Precisa nascer
//      com prioridade 1 (e' o contato mais quente) e MORRER quando o pedido e' pago.
//   3. CADENCIA SEMANAL dispara por CALENDARIO, nao por comportamento — e fica
//      desligada por padrao (ligar sozinho viraria spam semanal pra base inteira).
//   4. Nenhum dos dois entra em TIPOS_DE_AUSENCIA: uma compra nao invalida "voce
//      esqueceu o carrinho" nem "chegaram as novidades".
//
//   node tests/canal-regua.test.js
// ============================================================
process.env.DB_DIR = process.env.DB_DIR || './tests/.tmp-canal';
process.env.CERT_CIPHER_KEY = process.env.CERT_CIPHER_KEY || 'chave-de-teste-com-32-caracteres!';

const fs = require('fs');
const path = require('path');
const dir = path.resolve(process.env.DB_DIR);
if (fs.existsSync(dir)) fs.rmSync(dir, { recursive: true, force: true });
fs.mkdirSync(dir, { recursive: true });

const { db, setConfig } = require('../db/database');
const crm = require('../lib/crm');
const conv = require('../lib/conversas');

let falhas = 0;
function ok(desc, cond, extra = '') {
  if (cond) console.log(`  ✅ ${desc}`);
  else { console.log(`  ❌ ${desc}${extra ? ' → ' + extra : ''}`); falhas++; }
}
function secao(t) { console.log(`\n${t}`); }

const hoje = new Date().toISOString().slice(0, 10);

function criarTenant(nome, email) {
  return Number(db.prepare(`
    INSERT INTO tenants (nome_loja, nome_responsavel, telefone, email, senha_hash, plano, status)
    VALUES (?, ?, '73999990000', ?, 'x', 'interno', 'ativo')
  `).run(nome, nome, email).lastInsertRowid);
}

const T = criarTenant('Loja Canal', 'canal@teste.com');
const T2 = criarTenant('Loja Vizinha', 'vizinha@teste.com');

// Cliente que ja comprou (pra ela o carrinho e a cadencia valem)
const cliId = Number(db.prepare(`
  INSERT INTO clientes (tenant_id, nome, telefone, total_gasto, num_compras, ultima_compra)
  VALUES (?, 'Mariana', '5573988887777', 1200, 3, date('now','-5 days'))
`).run(T).lastInsertRowid);

// ------------------------------------------------------------
secao('1. Carrinho abandonado: sai de vitrine_pedidos, sem tabela nova');
// ------------------------------------------------------------
function criarPedido(tenantId, { clienteId, total, horasAtras, status = 'novo', codigo }) {
  return Number(db.prepare(`
    INSERT INTO vitrine_pedidos (tenant_id, codigo, cliente_id, cliente_nome, cliente_tel, total, qtd_itens, status, criado_em)
    VALUES (?, ?, ?, 'Mariana', '5573988887777', ?, 3, ?, datetime('now','localtime', ?))
  `).run(tenantId, codigo, clienteId, total, status, `-${horasAtras} hours`).lastInsertRowid);
}

const pedRecente = criarPedido(T, { clienteId: cliId, total: 890, horasAtras: 1, codigo: 'AAA1' });
let acoes = crm.acoesDoDia(T, hoje);
ok('carrinho de 1h ainda NAO vira contato (ela pode estar decidindo)',
   !acoes.some((a) => a.tipo === 'CARRINHO'));

// envelhece o pedido pra passar da janela de 4h
db.prepare(`UPDATE vitrine_pedidos SET criado_em = datetime('now','localtime','-6 hours') WHERE id = ?`).run(pedRecente);
acoes = crm.acoesDoDia(T, hoje);
const carrinho = acoes.find((a) => a.tipo === 'CARRINHO');
ok('carrinho de 6h vira contato', !!carrinho);
ok('prioridade 1 — mais quente que qualquer reativacao', carrinho && carrinho.prioridade === 1, String(carrinho?.prioridade));
ok('a mensagem diz o valor que ela montou', carrinho && /890/.test(carrinho.detalhe), carrinho?.detalhe);
ok('NAO tem cupom (dar desconto ensina a abandonar o carrinho)', carrinho && !carrinho.cupom);

// pedido pago some do gatilho
db.prepare(`UPDATE vitrine_pedidos SET status = 'fechado' WHERE id = ?`).run(pedRecente);
ok('pedido FECHADO nao gera mais carrinho',
   !crm.acoesDoDia(T, hoje).some((a) => a.tipo === 'CARRINHO'));

// pedido velho demais tambem nao
db.prepare(`UPDATE vitrine_pedidos SET status = 'novo', criado_em = datetime('now','localtime','-72 hours') WHERE id = ?`).run(pedRecente);
ok('carrinho de 3 dias nao vira contato (chegaria tarde e viraria incomodo)',
   !crm.acoesDoDia(T, hoje).some((a) => a.tipo === 'CARRINHO'));

// pedido ANONIMO (sem cliente vinculada) nao quebra nem vira acao orfa
db.prepare(`UPDATE vitrine_pedidos SET criado_em = datetime('now','localtime','-6 hours') WHERE id = ?`).run(pedRecente);
criarPedido(T, { clienteId: null, total: 300, horasAtras: 6, codigo: 'ANON' });
const comAnonimo = crm.acoesDoDia(T, hoje);
ok('pedido anonimo nao quebra a geracao', Array.isArray(comAnonimo));
ok('e nao vira acao sem dono', comAnonimo.filter((a) => a.tipo === 'CARRINHO').length === 1,
   String(comAnonimo.filter((a) => a.tipo === 'CARRINHO').length));

// isolamento: pedido da loja vizinha nao aparece aqui
const cliT2 = Number(db.prepare(`
  INSERT INTO clientes (tenant_id, nome, telefone, total_gasto, num_compras, ultima_compra)
  VALUES (?, 'Outra', '5573911112222', 500, 2, date('now','-5 days'))
`).run(T2).lastInsertRowid);
criarPedido(T2, { clienteId: cliT2, total: 5000, horasAtras: 6, codigo: 'VIZ1' });
const acoesT = crm.acoesDoDia(T, hoje);
ok('carrinho da loja vizinha NAO vaza', !acoesT.some((a) => a.detalhe && a.detalhe.includes('5000')));
ok('e a vizinha ve o dela', crm.acoesDoDia(T2, hoje).some((a) => a.tipo === 'CARRINHO'));

// ------------------------------------------------------------
secao('2. Cadencia semanal: calendario, e desligada por padrao');
// ------------------------------------------------------------
ok('vem DESLIGADA (ligar sozinho seria spam semanal)',
   !crm.acoesDoDia(T, hoje).some((a) => a.tipo === 'CATALOGO_SEMANAL'));

// liga no dia de HOJE
const jsDay = new Date(hoje + 'T12:00:00').getDay();
const isoHoje = jsDay === 0 ? 7 : jsDay;
setConfig('crm_catalogo_dia', String(isoHoje), T);
ok('ligada no dia de hoje, dispara',
   crm.acoesDoDia(T, hoje).some((a) => a.tipo === 'CATALOGO_SEMANAL'));

// no dia errado, nao dispara
setConfig('crm_catalogo_dia', String(isoHoje === 7 ? 1 : isoHoje + 1), T);
ok('em outro dia da semana, nao dispara',
   !crm.acoesDoDia(T, hoje).some((a) => a.tipo === 'CATALOGO_SEMANAL'));

// quem nunca comprou nao recebe catalogo (isso e prospeccao, tem lugar proprio)
setConfig('crm_catalogo_dia', String(isoHoje), T);
const prospectId = Number(db.prepare(`
  INSERT INTO clientes (tenant_id, nome, telefone, total_gasto, num_compras, tipo)
  VALUES (?, 'Nunca Comprou', '5573900001111', 0, 0, 'prospect')
`).run(T).lastInsertRowid);
const comCat = crm.acoesDoDia(T, hoje);
ok('quem NUNCA comprou nao recebe o catalogo semanal',
   !comCat.some((a) => a.tipo === 'CATALOGO_SEMANAL' && a.cliente_id === prospectId));
ok('mas quem ja comprou recebe',
   comCat.some((a) => a.tipo === 'CATALOGO_SEMANAL' && a.cliente_id === cliId));
setConfig('crm_catalogo_dia', '0', T);   // desliga pro resto do teste

// ------------------------------------------------------------
secao('3. Nenhum dos dois e gatilho de AUSENCIA');
// ------------------------------------------------------------
// TIPOS_DE_AUSENCIA sao os que a COMPRA invalida ("sentimos sua falta" para de
// fazer sentido quando ela compra). Carrinho e catalogo nao sao disso: ela nao
// sumiu. Se entrassem, uma compra antiga silenciaria o carrinho de hoje.
ok('CARRINHO fora de TIPOS_DE_AUSENCIA', !crm.TIPOS_DE_AUSENCIA.includes('CARRINHO'));
ok('CATALOGO_SEMANAL fora de TIPOS_DE_AUSENCIA', !crm.TIPOS_DE_AUSENCIA.includes('CATALOGO_SEMANAL'));
ok('e os de ausencia de verdade continuam la',
   crm.TIPOS_DE_AUSENCIA.includes('REAT_1') && crm.TIPOS_DE_AUSENCIA.includes('RECOMPRA'));

// ------------------------------------------------------------
secao('4. A resposta da cliente fecha o ciclo da regua');
// ------------------------------------------------------------
function criarAcaoEnviada(tenantId, clienteId, tipo, diasAtras = 0) {
  return Number(db.prepare(`
    INSERT INTO crm_acoes (tenant_id, data, cliente_id, tipo, prioridade, mensagem, status, resolvido_em)
    VALUES (?, date('now', ?), ?, ?, 3, 'oi', 'enviada', datetime('now','localtime', ?))
  `).run(tenantId, `-${diasAtras} days`, clienteId, tipo, `-${diasAtras} days`).lastInsertRowid);
}

const acaoId = criarAcaoEnviada(T, cliId, 'REAT_1', 1);
ok('acao nasce sem resposta',
   db.prepare('SELECT respondeu_em FROM crm_acoes WHERE id = ?').get(acaoId).respondeu_em === null);

conv.receberMensagem(T, {
  externalId: 'RESP_1', telefone: '5573988887777', nome: 'Mariana', texto: 'oi! vou passar sim',
});
ok('a resposta dela carimba respondeu_em',
   !!db.prepare('SELECT respondeu_em FROM crm_acoes WHERE id = ?').get(acaoId).respondeu_em);

// segunda mensagem nao recredita nada
const antes = db.prepare('SELECT respondeu_em FROM crm_acoes WHERE id = ?').get(acaoId).respondeu_em;
conv.receberMensagem(T, { externalId: 'RESP_2', telefone: '5573988887777', texto: 'e tem na M?' });
ok('mensagem seguinte nao mexe no que ja foi respondido',
   db.prepare('SELECT respondeu_em FROM crm_acoes WHERE id = ?').get(acaoId).respondeu_em === antes);

// acao antiga demais nao e' creditada (resposta de 2 meses depois nao e' resposta AQUILO)
const acaoVelha = criarAcaoEnviada(T, cliId, 'REAT_2', 45);
conv.receberMensagem(T, { externalId: 'RESP_3', telefone: '5573988887777', texto: 'oi de novo' });
ok('acao de 45 dias atras NAO e creditada',
   db.prepare('SELECT respondeu_em FROM crm_acoes WHERE id = ?').get(acaoVelha).respondeu_em === null);

// so a acao MAIS RECENTE e' creditada, nao todas
const a1 = criarAcaoEnviada(T, cliId, 'RECOMPRA', 5);
const a2 = criarAcaoEnviada(T, cliId, 'SELOS_PARADOS', 2);
conv.receberMensagem(T, { externalId: 'RESP_4', telefone: '5573988887777', texto: 'respondendo' });
const r1 = db.prepare('SELECT respondeu_em FROM crm_acoes WHERE id = ?').get(a1).respondeu_em;
const r2 = db.prepare('SELECT respondeu_em FROM crm_acoes WHERE id = ?').get(a2).respondeu_em;
ok('so a acao mais recente e creditada (nao infla a taxa)', r2 !== null && r1 === null);

// resposta de cliente de OUTRA loja nao credita acao daqui
const acaoT2 = criarAcaoEnviada(T2, cliT2, 'REAT_1', 1);
conv.receberMensagem(T, { externalId: 'RESP_X', telefone: '5573911112222', texto: 'oi' });
ok('resposta na loja A nao credita acao da loja B',
   db.prepare('SELECT respondeu_em FROM crm_acoes WHERE id = ?').get(acaoT2).respondeu_em === null);

// ------------------------------------------------------------
secao('5. A taxa de resposta agora e calculavel');
// ------------------------------------------------------------
const stats = db.prepare(`
  SELECT COUNT(*) AS enviadas,
         SUM(CASE WHEN respondeu_em IS NOT NULL THEN 1 ELSE 0 END) AS responderam
    FROM crm_acoes WHERE tenant_id = ? AND status = 'enviada'
`).get(T);
ok('da pra contar enviadas e respondidas', stats.enviadas >= 4 && stats.responderam >= 1,
   `${stats.responderam}/${stats.enviadas}`);

console.log(falhas === 0
  ? '\n✅ CANAL+REGUA OK — carrinho, cadencia e resposta fechando o ciclo'
  : `\n❌ ${falhas} FALHA(S)`);
process.exit(falhas ? 1 : 0);
