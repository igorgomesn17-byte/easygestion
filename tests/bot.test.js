// ============================================================
// BOT DE SAC — o que ele responde, e principalmente o que ele NAO faz.
//
// A regra que este teste protege: o bot nunca inventa e nunca insiste. Uma
// passagem malfeita pro humano derruba a satisfacao em ate 22 pontos, e bot que
// empurra venda quando nao sabe responder e' motivo de cliente bloquear o numero
// da loja. Na duvida ele PASSA — errar pro lado de chamar o humano e' barato.
//
// E o roteamento vem do MCC: nunca comprou -> Comercial 1 (falta a primeira
// venda); ja comprou -> Comercial 2 (a relacao e' dele).
//
//   node tests/bot.test.js
// ============================================================
process.env.DB_DIR = process.env.DB_DIR || './tests/.tmp-bot';
process.env.CERT_CIPHER_KEY = process.env.CERT_CIPHER_KEY || 'chave-de-teste-com-32-caracteres!';

const fs = require('fs');
const path = require('path');
const dir = path.resolve(process.env.DB_DIR);
if (fs.existsSync(dir)) fs.rmSync(dir, { recursive: true, force: true });
fs.mkdirSync(dir, { recursive: true });

const { db, setConfig } = require('../db/database');
const bot = require('../lib/bot');
const conversas = require('../lib/conversas');

let falhas = 0;
function ok(desc, cond, extra = '') {
  if (cond) console.log(`  ✅ ${desc}`);
  else { console.log(`  ❌ ${desc}${extra ? ' → ' + extra : ''}`); falhas++; }
}
function secao(t) { console.log(`\n${t}`); }

const T = Number(db.prepare(`
  INSERT INTO tenants (nome_loja, nome_responsavel, telefone, email, senha_hash, plano, status)
  VALUES ('DS Store','Igor','73','bot@t.com','x','interno','ativo')
`).run().lastInsertRowid);

setConfig('loja_nome', 'DS Store', T);
setConfig('atendimento_inicio', '0', T);   // sempre "aberto" durante o teste
setConfig('atendimento_fim', '24', T);

const prodId = Number(db.prepare(`
  INSERT INTO produtos (tenant_id, codigo, nome, preco_venda, custo, ativo)
  VALUES (?, 'V1', 'Vestido Chemise Linho', 189.9, 70, 1)
`).run(T).lastInsertRowid);
const varM = Number(db.prepare(`INSERT INTO variacoes (produto_id, tenant_id, cor, tamanho, quantidade) VALUES (?, ?, 'Off White', 'M', 4)`).run(prodId, T).lastInsertRowid);
db.prepare(`INSERT INTO variacoes (produto_id, tenant_id, cor, tamanho, quantidade) VALUES (?, ?, 'Off White', 'G', 2)`).run(prodId, T);
db.prepare(`INSERT INTO variacoes (produto_id, tenant_id, cor, tamanho, quantidade) VALUES (?, ?, 'Off White', 'P', 0)`).run(prodId, T);

// esgotada, pra provar a diferença entre "não existe" e "acabou"
const prodEsgotado = Number(db.prepare(`INSERT INTO produtos (tenant_id, codigo, nome, preco_venda, custo, ativo) VALUES (?, 'C1', 'Cropped Canelado', 89.9, 30, 1)`).run(T).lastInsertRowid);
db.prepare(`INSERT INTO variacoes (produto_id, tenant_id, cor, tamanho, quantidade) VALUES (?, ?, 'Preto', 'M', 0)`).run(prodEsgotado, T);

const pedId = Number(db.prepare(`
  INSERT INTO vitrine_pedidos (tenant_id, codigo, cliente_nome, cliente_tel, total, qtd_itens, status)
  VALUES (?, 'A7K2', 'Mariana', '5573988887777', 1078.8, 12, 'novo')
`).run(T).lastInsertRowid);

// ------------------------------------------------------------
secao('1. O que o bot NUNCA faz');
// ------------------------------------------------------------
const desconto = bot.decidir(T, 'consegue fazer um desconto?');
ok('pedido de desconto vai pro humano', desconto.acao === 'transferir', desconto.acao);
ok('e o motivo é negociação', desconto.motivo === 'negociacao', desconto.motivo);
ok('o bot NÃO oferece desconto na resposta',
   !/\d+\s*%|desconto de|cupom/i.test(desconto.resposta || ''), desconto.resposta);

for (const frase of ['qual o melhor preço?', 'dá pra parcelar?', 'faz por 80?', 'aceita fiado?', 'tem promoção?']) {
  ok(`"${frase}" → humano`, bot.decidir(T, frase).acao === 'transferir');
}

const humano = bot.decidir(T, 'quero falar com uma pessoa');
ok('pedido de humano é sempre atendido', humano.acao === 'transferir' && humano.motivo === 'pediu_humano');
// no MEIO de outra coisa, sem digitar 5 — bot que prende no menu faz bloquear o número
ok('pedido de humano funciona no meio da frase',
   bot.decidir(T, 'tem na M? na verdade quero falar com atendente').acao === 'transferir');

// ------------------------------------------------------------
secao('2. Reclamação e irritação vão pro TOPO da fila');
// ------------------------------------------------------------
const rec = bot.decidir(T, 'chegou um vestido com defeito na costura');
ok('reclamação transfere', rec.acao === 'transferir' && rec.motivo === 'reclamacao');
ok('com prioridade máxima (acima de qualquer venda)', rec.prioridade === 1, String(rec.prioridade));
ok('e o bot NÃO tenta resolver sozinho', /sinto muito|equipe/i.test(rec.resposta || ''), rec.resposta);

const brava = bot.decidir(T, 'isso é um absurdo, ninguém me responde');
ok('cliente irritada também vai pro topo', brava.acao === 'transferir' && brava.prioridade === 1);

ok('"não chegou" é reclamação, não consulta de pedido',
   bot.decidir(T, 'meu pedido não chegou até hoje').motivo === 'reclamacao');

// ------------------------------------------------------------
secao('3. Estoque: o bot responde com dado REAL do banco');
// ------------------------------------------------------------
const est = bot.decidir(T, 'tem vestido chemise na M?');
ok('responde sozinho (não transfere)', est.acao === 'responder', est.acao);
ok('diz a quantidade real por tamanho', /M \(4\)/.test(est.resposta || ''), est.resposta);
ok('e o tamanho G também', /G \(2\)/.test(est.resposta || ''));
ok('NÃO oferece o P, que está zerado', !/\bP \(/.test(est.resposta || ''), est.resposta);
ok('mostra o preço', /189/.test(est.resposta || ''));

const esg = bot.decidir(T, 'tem cropped canelado?');
ok('peça esgotada: diz que ACABOU (≠ não existe)',
   esg.acao === 'responder' && /esgotad/i.test(esg.resposta || ''), esg.resposta);

const naoExiste = bot.decidir(T, 'tem jaqueta de couro?');
ok('peça que não existe: PASSA em vez de chutar',
   naoExiste.acao === 'transferir' && naoExiste.motivo === 'duvida_produto', JSON.stringify(naoExiste));
ok('e não afirma que não tem', !/não temos|nao temos/i.test(naoExiste.resposta || ''));

// A reserva tem que refletir na resposta do bot: peça prometida a outra cliente
// não pode ser oferecida.
const pedRes = Number(db.prepare(`INSERT INTO vitrine_pedidos (tenant_id, codigo, total, qtd_itens, status) VALUES (?, 'RES1', 200, 1, 'novo')`).run(T).lastInsertRowid);
db.prepare(`INSERT INTO vitrine_pedido_itens (tenant_id, pedido_id, produto_id, variacao_id, produto_nome, cor, tamanho, qtd, preco_unit, reservado_ate)
            VALUES (?, ?, ?, ?, 'Vestido Chemise Linho', 'Off White', 'M', 3, 189.9, datetime('now','localtime','+45 minutes'))`)
  .run(T, pedRes, prodId, varM);
const comReserva = bot.decidir(T, 'tem vestido chemise na M?');
ok('o bot desconta as reservas (não vende o que está prometido)',
   /M \(1\)/.test(comReserva.resposta || ''), comReserva.resposta);

// ------------------------------------------------------------
secao('4. Pedido: consulta pelo código');
// ------------------------------------------------------------
const ped = bot.decidir(T, 'cadê meu pedido A7K2?');
ok('acha o pedido pelo código', ped.acao === 'responder' && /A7K2/.test(ped.resposta || ''), ped.resposta);
ok('diz que está aguardando pagamento', /aguardando|pagamento/i.test(ped.resposta || ''));

// Venda de verdade: `venda_id` tem FK, e um id inventado quebraria o INSERT.
const vendaId = Number(db.prepare(`
  INSERT INTO vendas (tenant_id, subtotal, total, forma_pagamento, origem) VALUES (?, 1078.8, 1078.8, 'pix', 'vitrine')
`).run(T).lastInsertRowid);
db.prepare(`UPDATE vitrine_pedidos SET venda_id = ? WHERE id = ?`).run(vendaId, pedId);
ok('pedido pago responde confirmado',
   /pago|confirmad/i.test(bot.decidir(T, 'status do pedido A7K2').resposta || ''));

const inventado = bot.decidir(T, 'cadê meu pedido ZZ99?');
ok('código que não existe: PASSA (não inventa)',
   inventado.acao === 'transferir' && inventado.motivo === 'pedido_nao_encontrado', JSON.stringify(inventado));

// Volta o pedido pro estado original pras próximas seções
db.prepare(`UPDATE vitrine_pedidos SET venda_id = NULL WHERE id = ?`).run(pedId);

// ------------------------------------------------------------
secao('5. Menu e saudação');
// ------------------------------------------------------------
const oi = bot.decidir(T, 'oi');
ok('saudação mostra o menu', oi.acao === 'responder' && /1.*comprar/is.test(oi.resposta || ''));
ok('e o menu traz o nome da loja', /DS Store/.test(oi.resposta || ''));

ok('opção 1 manda pro catálogo',
   /catálogo|catalogo/i.test(bot.decidir(T, '1').resposta || ''));
ok('opção 3 (troca) transfere', bot.decidir(T, '3').acao === 'transferir');
ok('opção 5 transfere', bot.decidir(T, '5').acao === 'transferir');

// ------------------------------------------------------------
secao('6. Fora do escopo: passa, nunca inventa');
// ------------------------------------------------------------
const solto = bot.decidir(T, 'vocês patrocinam evento de moda?');
ok('pergunta fora do escopo transfere', solto.acao === 'transferir' && solto.motivo === 'fora_do_escopo');
ok('e o bot fica CALADO em vez de improvisar', solto.resposta === null, String(solto.resposta));

// ------------------------------------------------------------
secao('7. Roteamento C1 × C2 (a regra do MCC)');
// ------------------------------------------------------------
const nunca = Number(db.prepare(`INSERT INTO clientes (tenant_id, nome, telefone, tipo, num_compras) VALUES (?, 'Nova', '5573900001111', 'prospect', 0)`).run(T).lastInsertRowid);
const ja = Number(db.prepare(`INSERT INTO clientes (tenant_id, nome, telefone, num_compras, total_gasto) VALUES (?, 'Antiga', '5573900002222', 4, 2180)`).run(T).lastInsertRowid);

ok('quem NUNCA comprou vai pro Comercial 1', bot.departamentoDe(T, nunca) === 'c1');
ok('quem JÁ comprou vai pro Comercial 2', bot.departamentoDe(T, ja) === 'c2');
ok('número sem cadastro vai pro C1 (é levantada de mão)', bot.departamentoDe(T, null) === 'c1');

// cliente cadastrada mas sem compra ainda é C1 — o trabalho com ela é a 1ª venda
const semCompra = Number(db.prepare(`INSERT INTO clientes (tenant_id, nome, telefone, num_compras) VALUES (?, 'Cadastrada', '5573900003333', 0)`).run(T).lastInsertRowid);
ok('cadastrada sem compra ainda é C1', bot.departamentoDe(T, semCompra) === 'c1');

// ------------------------------------------------------------
secao('8. O bot se cala quando um humano está atendendo');
// ------------------------------------------------------------
const c1 = conversas.acharOuCriarConversa(T, { telefone: '5573988884444', nome: 'Teste' });
ok('conversa nova: o bot pode responder', conversas.botDeveResponder(T, c1.id) === true);

conversas.registrarEnviada(T, { conversaId: c1.id, texto: 'oi, sou a Daisy', usuarioId: null });
ok('depois que um humano falou, o bot cala', conversas.botDeveResponder(T, c1.id) === false);

const c2 = conversas.acharOuCriarConversa(T, { telefone: '5573988885555', nome: 'Outra' });
conversas.pausarBot(T, c2.id);
ok('bot pausado na conversa não responde', conversas.botDeveResponder(T, c2.id) === false);

const c3 = conversas.acharOuCriarConversa(T, { telefone: '5573988886666', nome: 'Terceira' });
const u = Number(db.prepare(`INSERT INTO usuarios (tenant_id, nome, senha_hash, papel) VALUES (?, 'carla', 'x', 'relacionamento')`).run(T).lastInsertRowid);
conversas.assumir(T, c3.id, u);
ok('conversa com dono não recebe bot', conversas.botDeveResponder(T, c3.id) === false);

// ------------------------------------------------------------
secao('9. Fora do horário o bot é honesto');
// ------------------------------------------------------------
setConfig('atendimento_inicio', '8', T);
setConfig('atendimento_fim', '18', T);
const h = new Date().getHours();
const dentro = h >= 8 && h < 18;
ok('dentro/fora do horário é calculado certo', bot.dentroDoHorario(T) === dentro);
ok('o aviso diz quando alguém volta', /\d+h/.test(bot.avisoForaDoHorario(T)), bot.avisoForaDoHorario(T));

// ------------------------------------------------------------
secao('10. Isolamento entre lojas');
// ------------------------------------------------------------
const T2 = Number(db.prepare(`INSERT INTO tenants (nome_loja,nome_responsavel,telefone,email,senha_hash,plano,status) VALUES ('Outra','X','73','bot2@t.com','x','interno','ativo')`).run().lastInsertRowid);
const semEstoque = bot.decidir(T2, 'tem vestido chemise na M?');
ok('a loja B não enxerga o produto da A',
   semEstoque.acao === 'transferir', JSON.stringify(semEstoque));
ok('e não vaza o pedido da A',
   bot.decidir(T2, 'cadê meu pedido A7K2?').motivo === 'pedido_nao_encontrado');

console.log(falhas === 0
  ? '\n✅ BOT OK — nunca dá desconto, nunca inventa, e passa pro departamento certo'
  : `\n❌ ${falhas} FALHA(S)`);
process.exit(falhas ? 1 : 0);
