// ============================================================
// ATACADO — reserva de estoque, pedido virando venda, idempotencia.
//
// Os quatro riscos que este teste trava:
//
//   1. DUAS CLIENTES, A ULTIMA PECA. O catalogo so mostra o que tem, entao o
//      pedido nasce valido sem aprovacao. Sem reserva, as duas geram Pix, as duas
//      pagam, e uma e' estornada. Numa cidade pequena isso custa mais que a venda.
//   2. RESERVA PARCIAL. Reservar 4 de 6 itens entregaria um Pix por um pedido que
//      nao pode ser cumprido. E' tudo ou nada.
//   3. WEBHOOK DUPLICADO. O provedor reenvia ate receber 200. Um retry daria baixa
//      DUAS vezes no estoque e lancaria a venda duplicada no caixa — a mesma licao
//      que o webhook do Stripe ja ensinou aqui (+30 dias de graca por retry).
//   4. EXPIRACAO SEM JOB. Job que nao roda (deploy, reboot) deixaria peca presa
//      pra sempre. A expiracao e' lazy: reservado_ate < agora nao segura nada.
//
//   node tests/atacado.test.js
// ============================================================
process.env.DB_DIR = process.env.DB_DIR || './tests/.tmp-atacado';
process.env.CERT_CIPHER_KEY = process.env.CERT_CIPHER_KEY || 'chave-de-teste-com-32-caracteres!';

const fs = require('fs');
const path = require('path');
const dir = path.resolve(process.env.DB_DIR);
if (fs.existsSync(dir)) fs.rmSync(dir, { recursive: true, force: true });
fs.mkdirSync(dir, { recursive: true });

const { db, setConfig } = require('../db/database');
const reserva = require('../lib/reserva');
const pedidoVenda = require('../lib/pedido-venda');
const pix = require('../lib/pix');
const vitrine = require('../lib/vitrine-publica');

let falhas = 0;
function ok(desc, cond, extra = '') {
  if (cond) console.log(`  ✅ ${desc}`);
  else { console.log(`  ❌ ${desc}${extra ? ' → ' + extra : ''}`); falhas++; }
}
function secao(t) { console.log(`\n${t}`); }

// ---------- cenario ----------
const T = Number(db.prepare(`
  INSERT INTO tenants (nome_loja, nome_responsavel, telefone, email, senha_hash, plano, status, slug)
  VALUES ('Loja Atacado','Igor','73999','atac@t.com','x','interno','ativo','loja-atacado')
`).run().lastInsertRowid);

const T2 = Number(db.prepare(`
  INSERT INTO tenants (nome_loja, nome_responsavel, telefone, email, senha_hash, plano, status, slug)
  VALUES ('Vizinha','X','73','viz@t.com','x','interno','ativo','vizinha')
`).run().lastInsertRowid);

const prodId = Number(db.prepare(`
  INSERT INTO produtos (tenant_id, codigo, nome, preco_venda, custo, ativo)
  VALUES (?, 'P001', 'Vestido Chemise', 100, 40, 1)
`).run(T).lastInsertRowid);

// 3 peças no tamanho M — é sobre elas que a corrida acontece
const varM = Number(db.prepare(`
  INSERT INTO variacoes (produto_id, tenant_id, cor, tamanho, quantidade) VALUES (?, ?, 'Off White', 'M', 3)
`).run(prodId, T).lastInsertRowid);
const varG = Number(db.prepare(`
  INSERT INTO variacoes (produto_id, tenant_id, cor, tamanho, quantidade) VALUES (?, ?, 'Off White', 'G', 10)
`).run(prodId, T).lastInsertRowid);

const cliId = Number(db.prepare(`
  INSERT INTO clientes (tenant_id, nome, telefone) VALUES (?, 'Boutique Mariana', '5573988887777')
`).run(T).lastInsertRowid);

let seq = 0;
function criarPedido(tenantId, itens, clienteId = null) {
  const codigo = 'PED' + (++seq);
  const total = itens.reduce((s, i) => s + i.qtd * i.preco, 0);
  const pid = Number(db.prepare(`
    INSERT INTO vitrine_pedidos (tenant_id, codigo, cliente_id, cliente_nome, cliente_tel, total, qtd_itens, status)
    VALUES (?, ?, ?, 'Mariana', '5573988887777', ?, ?, 'novo')
  `).run(tenantId, codigo, clienteId, total, itens.length).lastInsertRowid);

  const ins = db.prepare(`
    INSERT INTO vitrine_pedido_itens (tenant_id, pedido_id, produto_id, variacao_id, produto_nome, cor, tamanho, qtd, preco_unit)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  for (const i of itens) ins.run(tenantId, pid, i.produto || prodId, i.variacao, i.nome || 'Vestido Chemise', 'Off White', i.tamanho || 'M', i.qtd, i.preco);
  return pid;
}

// ------------------------------------------------------------
secao('1. Reserva: a peça sai do disponível enquanto o Pix está de pé');
// ------------------------------------------------------------
ok('sem reserva, disponível = estoque', reserva.disponivelDe(T, varM) === 3, String(reserva.disponivelDe(T, varM)));

const ped1 = criarPedido(T, [{ variacao: varM, qtd: 2, preco: 100 }], cliId);
const r1 = reserva.reservar(T, ped1);
ok('reserva de 2 peças passa', r1.ok, r1.erro);
ok('disponível cai pra 1', reserva.disponivelDe(T, varM) === 1, String(reserva.disponivelDe(T, varM)));

// ------------------------------------------------------------
secao('2. A CORRIDA: duas clientes querendo a última peça');
// ------------------------------------------------------------
const ped2 = criarPedido(T, [{ variacao: varM, qtd: 2, preco: 100 }]);
const r2 = reserva.reservar(T, ped2);
ok('segunda cliente NÃO consegue reservar 2 (só sobrou 1)', !r2.ok, JSON.stringify(r2));
ok('e o sistema diz o que faltou', !!r2.faltando && r2.faltando[0].disponivel === 1,
   JSON.stringify(r2.faltando));

const ped3 = criarPedido(T, [{ variacao: varM, qtd: 1, preco: 100 }]);
ok('mas 1 peça ela consegue', reserva.reservar(T, ped3).ok);
ok('agora o estoque disponível zerou', reserva.disponivelDe(T, varM) === 0);

const ped4 = criarPedido(T, [{ variacao: varM, qtd: 1, preco: 100 }]);
ok('a terceira não pega nada', !reserva.reservar(T, ped4).ok);

// ------------------------------------------------------------
secao('3. Reserva é TUDO OU NADA');
// ------------------------------------------------------------
// Pedido misto: G tem de sobra, M não tem nenhum. Reservar só o G daria à cliente
// um Pix por um pedido que a loja não consegue entregar inteiro.
const pedMisto = criarPedido(T, [
  { variacao: varG, qtd: 2, preco: 100 },
  { variacao: varM, qtd: 1, preco: 100 },
]);
const rm = reserva.reservar(T, pedMisto);
ok('pedido misto com 1 item indisponível é recusado inteiro', !rm.ok);
ok('o item que TINHA estoque não ficou preso', reserva.disponivelDe(T, varG) === 10,
   String(reserva.disponivelDe(T, varG)));

// ------------------------------------------------------------
secao('4. Expiração é lazy — sem job, sem peça presa');
// ------------------------------------------------------------
db.prepare(`UPDATE vitrine_pedido_itens SET reservado_ate = datetime('now','localtime','-1 minute') WHERE pedido_id = ?`).run(ped1);
ok('reserva vencida devolve as peças sozinha', reserva.disponivelDe(T, varM) === 2,
   String(reserva.disponivelDe(T, varM)));
ok('e reservaViva enxerga que morreu', !reserva.reservaViva(T, ped1));

// pedido cancelado libera na hora
db.prepare(`UPDATE vitrine_pedido_itens SET reservado_ate = datetime('now','localtime','+45 minutes') WHERE pedido_id = ?`).run(ped1);
ok('reserva renovada volta a segurar', reserva.disponivelDe(T, varM) === 0);
reserva.liberar(T, ped1);
ok('liberar devolve as peças', reserva.disponivelDe(T, varM) === 2);

// pedido que já foi fechado não segura estoque
db.prepare(`UPDATE vitrine_pedido_itens SET reservado_ate = datetime('now','localtime','+45 minutes') WHERE pedido_id = ?`).run(ped3);
db.prepare(`UPDATE vitrine_pedidos SET status = 'perdido' WHERE id = ?`).run(ped3);
ok('pedido perdido não segura estoque', reserva.disponivelDe(T, varM) === 3,
   String(reserva.disponivelDe(T, varM)));

// ------------------------------------------------------------
secao('5. O catálogo mostra o que dá pra vender de verdade');
// ------------------------------------------------------------
db.prepare(`UPDATE vitrine_pedidos SET status = 'novo' WHERE id = ?`).run(ped1);
db.prepare(`UPDATE vitrine_pedido_itens SET reservado_ate = datetime('now','localtime','+45 minutes') WHERE pedido_id = ?`).run(ped1);

const cat = vitrine.catalogoPublico ? vitrine.catalogoPublico(T) : null;
if (cat && cat.produtos && cat.produtos.length) {
  const p = cat.produtos.find((x) => x.id === prodId);
  const gm = (p.grade || []).find((g) => g.tamanho === 'M');
  ok('o catálogo desconta as reservas', !gm || gm.quantidade === 1,
     gm ? String(gm.quantidade) : 'M sumiu da grade');
  const gg = (p.grade || []).find((g) => g.tamanho === 'G');
  ok('e não mexe no que não tem reserva', gg && gg.quantidade === 10, String(gg?.quantidade));
} else {
  ok('catálogo carregou', false, 'catalogoPublico não retornou produtos');
}
reserva.liberar(T, ped1);

// ------------------------------------------------------------
secao('6. Pedido pago vira venda — uma vez só');
// ------------------------------------------------------------
setConfig('taxa_pix', '0.99', T);
setConfig('imposto_pct', '7.3', T);

const estoqueAntes = db.prepare('SELECT quantidade FROM variacoes WHERE id = ?').get(varM).quantidade;
const pedPagar = criarPedido(T, [{ variacao: varM, qtd: 2, preco: 100 }], cliId);
reserva.reservar(T, pedPagar);

const cv = pedidoVenda.converter(T, pedPagar);
ok('converteu em venda', cv.ok && cv.vendaId > 0, cv.erro);

const venda = db.prepare('SELECT * FROM vendas WHERE id = ?').get(cv.vendaId);
ok('a venda tem o total certo', venda.total === 200, String(venda.total));
ok('origem marcada como vitrine', venda.origem === 'vitrine', venda.origem);
ok('taxa desta loja foi aplicada (não a do tenant 1)', Math.abs(venda.taxa_aplicada - 1.98) < 0.01, String(venda.taxa_aplicada));
ok('imposto desta loja também', Math.abs(venda.imposto - 14.6) < 0.01, String(venda.imposto));
ok('custo veio do produto', venda.custo_total === 80, String(venda.custo_total));

const estoqueDepois = db.prepare('SELECT quantidade FROM variacoes WHERE id = ?').get(varM).quantidade;
ok('estoque baixou de verdade', estoqueDepois === estoqueAntes - 2, `${estoqueAntes} -> ${estoqueDepois}`);
ok('a reserva foi solta (virou baixa real)',
   db.prepare('SELECT COUNT(*) n FROM vitrine_pedido_itens WHERE pedido_id = ? AND reservado_ate IS NOT NULL').get(pedPagar).n === 0);
ok('o pedido ficou fechado e aponta pra venda',
   db.prepare('SELECT status, venda_id FROM vitrine_pedidos WHERE id = ?').get(pedPagar).venda_id === cv.vendaId);
ok('a cliente ganhou a compra no histórico (RFM/régua enxergam)',
   db.prepare('SELECT num_compras, total_gasto FROM clientes WHERE id = ?').get(cliId).num_compras === 1);
ok('itens da venda foram gravados',
   db.prepare('SELECT COUNT(*) n FROM venda_itens WHERE venda_id = ?').get(cv.vendaId).n === 1);
ok('e o pagamento também', db.prepare('SELECT COUNT(*) n FROM venda_pagamentos WHERE venda_id = ?').get(cv.vendaId).n === 1);

// ------------------------------------------------------------
secao('7. WEBHOOK DUPLICADO não vende duas vezes');
// ------------------------------------------------------------
const cv2 = pedidoVenda.converter(T, pedPagar);
ok('segunda conversão é no-op', cv2.ok && cv2.jaConvertido === true);
ok('e devolve a MESMA venda', cv2.vendaId === cv.vendaId);
ok('estoque NÃO baixou de novo',
   db.prepare('SELECT quantidade FROM variacoes WHERE id = ?').get(varM).quantidade === estoqueDepois);
ok('não criou venda duplicada',
   db.prepare('SELECT COUNT(*) n FROM vendas WHERE tenant_id = ? AND observacao LIKE ?').get(T, '%' + db.prepare('SELECT codigo FROM vitrine_pedidos WHERE id=?').get(pedPagar).codigo).n === 1);
ok('a cliente não ganhou 2 compras',
   db.prepare('SELECT num_compras FROM clientes WHERE id = ?').get(cliId).num_compras === 1);

// guarda de idempotência do evento
ok('primeiro evento é reservado', pix.reservarEvento('EVT-1', T) === true);
ok('o mesmo evento não é processado de novo', pix.reservarEvento('EVT-1', T) === false);
ok('evento diferente passa', pix.reservarEvento('EVT-2', T) === true);

// ------------------------------------------------------------
secao('8. Estoque que sumiu entre a reserva e o pagamento');
// ------------------------------------------------------------
// A peça foi vendida no balcão enquanto o Pix estava aberto. Registrar a venda
// assim deixaria o estoque negativo em silêncio.
const pedSemEstoque = criarPedido(T, [{ variacao: varM, qtd: 5, preco: 100 }], cliId);
const cvFalha = pedidoVenda.converter(T, pedSemEstoque);
ok('venda é recusada quando não há estoque', !cvFalha.ok && cvFalha.semEstoque === true, JSON.stringify(cvFalha));
ok('e diz QUAL peça faltou', /Vestido/.test(cvFalha.erro || ''), cvFalha.erro);
ok('o estoque não ficou negativo',
   db.prepare('SELECT quantidade FROM variacoes WHERE id = ?').get(varM).quantidade >= 0);
ok('nenhuma venda meio-feita ficou no banco',
   db.prepare('SELECT venda_id FROM vitrine_pedidos WHERE id = ?').get(pedSemEstoque).venda_id === null);

// ------------------------------------------------------------
secao('9. Isolamento entre lojas');
// ------------------------------------------------------------
const prodT2 = Number(db.prepare(`INSERT INTO produtos (tenant_id, codigo, nome, preco_venda, custo, ativo) VALUES (?, 'X1', 'Outro', 50, 20, 1)`).run(T2).lastInsertRowid);
const varT2 = Number(db.prepare(`INSERT INTO variacoes (produto_id, tenant_id, cor, tamanho, quantidade) VALUES (?, ?, 'Azul', 'P', 5)`).run(prodT2, T2).lastInsertRowid);
const pedT2 = criarPedido(T2, [{ variacao: varT2, qtd: 2, preco: 50, produto: prodT2 }]);
reserva.reservar(T2, pedT2);

ok('reserva da loja B não afeta o estoque da A', reserva.disponivelDe(T, varM) >= 0);
ok('a loja A não enxerga a variação da B', reserva.disponivelDe(T, varT2) === 0);
ok('converter pedido de outra loja não funciona', !pedidoVenda.converter(T, pedT2).ok);
ok('e a loja B converte o dela normalmente', pedidoVenda.converter(T2, pedT2).ok);

console.log(falhas === 0
  ? '\n✅ ATACADO OK — corrida fechada, webhook idempotente, venda com taxa da loja certa'
  : `\n❌ ${falhas} FALHA(S)`);
process.exit(falhas ? 1 : 0);
