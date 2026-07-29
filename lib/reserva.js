// ============================================================
// RESERVA DE ESTOQUE — a peça sai do disponível enquanto o Pix está de pé.
// ------------------------------------------------------------
// O catálogo só mostra o que tem, então o pedido nasce válido e não precisa da
// aprovação de ninguém. Mas isso deixa uma corrida aberta: duas clientes veem a
// MESMA última peça M como disponível, as duas geram Pix, as duas pagam — e uma
// vai ser estornada. Numa cidade pequena, onde a cliente conhece a dona, esse
// estorno custa mais que a venda inteira.
//
// Três decisões que sustentam o resto:
//
//   1. RESERVA AO GERAR O PIX, não ao montar o carrinho. Reservar no carrinho
//      prenderia peça de quem só estava olhando — e quem monta carrinho e some é
//      a maioria.
//   2. EXPIRAÇÃO LAZY (reservado_ate < agora), sem job. Um job que não roda —
//      deploy, reboot, exceção — deixaria peça presa indefinidamente, e ninguém
//      descobriria até a lojista jurar que tem a peça e o sistema dizer que não.
//      Mesmo padrão do cupom expirado, pelo mesmo motivo.
//   3. A BAIXA DEFINITIVA mora na transação da venda, com a trava no próprio
//      UPDATE (`AND quantidade >= ?`) — igual ao vale e ao cupom. Reserva é uma
//      promessa; baixa é o fato.
// ============================================================
const { db } = require('../db/database');

// Quanto tempo a peça fica presa esperando o pagamento. Curto o bastante pra não
// travar o estoque da loja, longo o bastante pra caber "vou pegar o celular do
// meu marido pra pagar".
const MINUTOS_PADRAO = 45;

function exigirTenant(tenantId) {
  const t = Number(tenantId);
  if (!t) throw new Error('reserva: tenantId obrigatorio');
  return t;
}

// ------------------------------------------------------------
// Quanto está reservado AGORA
// ------------------------------------------------------------
// Só conta reserva viva: `reservado_ate > agora`. A linha vencida continua no
// banco (é histórico do pedido), mas não segura mais nada — é isso que dispensa
// o job de limpeza.
//
// Exclui o próprio pedido quando pedidoId é passado: na hora de renovar o Pix de
// um pedido, a reserva DELE não pode contar contra ele mesmo.
function reservadoDe(tenantId, variacaoId, exceptoPedidoId = null) {
  const t = exigirTenant(tenantId);
  const r = db.prepare(`
    SELECT COALESCE(SUM(i.qtd), 0) AS n
      FROM vitrine_pedido_itens i
      JOIN vitrine_pedidos p ON p.id = i.pedido_id AND p.tenant_id = i.tenant_id
     WHERE i.tenant_id = ?
       AND i.variacao_id = ?
       AND i.reservado_ate IS NOT NULL
       AND i.reservado_ate > datetime('now','localtime')
       AND p.status = 'novo'
       AND (? IS NULL OR i.pedido_id <> ?)
  `).get(t, variacaoId, exceptoPedidoId, exceptoPedidoId);
  return Number(r?.n || 0);
}

// Mapa variacao_id -> quantidade reservada. Uma query só, pro catálogo não virar
// N+1 (a página inteira pergunta isso de uma vez).
function mapaDeReservas(tenantId) {
  const t = exigirTenant(tenantId);
  const linhas = db.prepare(`
    SELECT i.variacao_id, SUM(i.qtd) AS n
      FROM vitrine_pedido_itens i
      JOIN vitrine_pedidos p ON p.id = i.pedido_id AND p.tenant_id = i.tenant_id
     WHERE i.tenant_id = ?
       AND i.variacao_id IS NOT NULL
       AND i.reservado_ate IS NOT NULL
       AND i.reservado_ate > datetime('now','localtime')
       AND p.status = 'novo'
     GROUP BY i.variacao_id
  `).all(t);
  return new Map(linhas.map((l) => [l.variacao_id, Number(l.n)]));
}

// O que a cliente pode pedir de verdade: o que está no estoque menos o que está
// reservado por outra pessoa. Nunca negativo.
function disponivelDe(tenantId, variacaoId, exceptoPedidoId = null) {
  const t = exigirTenant(tenantId);
  const v = db.prepare('SELECT quantidade FROM variacoes WHERE id = ? AND tenant_id = ?').get(variacaoId, t);
  if (!v) return 0;
  return Math.max(0, Number(v.quantidade) - reservadoDe(t, variacaoId, exceptoPedidoId));
}

// ------------------------------------------------------------
// Reservar
// ------------------------------------------------------------
// TUDO OU NADA. Reservar 4 dos 6 itens e deixar 2 de fora entregaria à cliente um
// Pix por um pedido que não pode ser cumprido — ela pagaria por peça que não existe.
// Se qualquer item não couber, nada é reservado e quem chamou decide o que fazer.
//
// Roda dentro de uma transação e relê o estoque AQUI: entre montar o carrinho e
// gerar o Pix pode ter passado uma venda no balcão.
function reservar(tenantId, pedidoId, minutos = MINUTOS_PADRAO) {
  const t = exigirTenant(tenantId);

  const itens = db.prepare(`
    SELECT id, variacao_id, produto_nome, cor, tamanho, qtd
      FROM vitrine_pedido_itens
     WHERE tenant_id = ? AND pedido_id = ?
  `).all(t, pedidoId);

  if (!itens.length) return { ok: false, erro: 'Pedido sem itens' };

  db.exec('BEGIN IMMEDIATE');
  try {
    const faltando = [];

    for (const it of itens) {
      // Item sem variação é peça sem grade (tamanho único não cadastrado). Não dá
      // pra reservar o que não tem SKU — segue sem travar o pedido.
      if (!it.variacao_id) continue;

      const disp = disponivelDe(t, it.variacao_id, pedidoId);
      if (disp < it.qtd) {
        faltando.push({
          produto: it.produto_nome,
          cor: it.cor, tamanho: it.tamanho,
          pedido: it.qtd, disponivel: disp,
        });
      }
    }

    if (faltando.length) {
      db.exec('ROLLBACK');
      return { ok: false, erro: 'Estoque insuficiente', faltando };
    }

    const ate = db.prepare(`SELECT datetime('now','localtime','+' || ? || ' minutes') AS t`).get(minutos).t;
    db.prepare(`
      UPDATE vitrine_pedido_itens SET reservado_ate = ?
       WHERE tenant_id = ? AND pedido_id = ?
    `).run(ate, t, pedidoId);

    db.exec('COMMIT');
    return { ok: true, reservado_ate: ate };
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
}

// Solta a reserva (pedido cancelado, Pix expirado, cliente desistiu).
function liberar(tenantId, pedidoId) {
  const t = exigirTenant(tenantId);
  const r = db.prepare(`
    UPDATE vitrine_pedido_itens SET reservado_ate = NULL
     WHERE tenant_id = ? AND pedido_id = ?
  `).run(t, pedidoId);
  return r.changes;
}

// A reserva deste pedido ainda vale? Usado antes de dar baixa: um Pix pago depois
// do prazo pode ter perdido a peça pra outra cliente, e é melhor descobrir aqui
// do que prometer o que não tem.
function reservaViva(tenantId, pedidoId) {
  const t = exigirTenant(tenantId);
  const r = db.prepare(`
    SELECT COUNT(*) AS n FROM vitrine_pedido_itens
     WHERE tenant_id = ? AND pedido_id = ?
       AND reservado_ate IS NOT NULL AND reservado_ate > datetime('now','localtime')
  `).get(t, pedidoId);
  return Number(r?.n || 0) > 0;
}

module.exports = {
  MINUTOS_PADRAO,
  reservadoDe, mapaDeReservas, disponivelDe,
  reservar, liberar, reservaViva,
};
