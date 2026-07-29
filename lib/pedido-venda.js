// ============================================================
// PEDIDO PAGO VIRA VENDA — o elo que fecha o ciclo do atacado.
// ------------------------------------------------------------
// Sem isto, o pedido da vitrine morre na tela de pedidos: a lojista teria que
// digitar tudo de novo no PDV pra o estoque baixar e o dinheiro aparecer no DRE.
// Digitar duas vezes é onde o erro entra — e é justamente a dor que o portal
// existe pra resolver.
//
// Tudo numa transação: venda, itens, baixa de estoque, pagamento e o status do
// pedido entram juntos ou não entram. Uma venda sem baixa de estoque venderia a
// mesma peça de novo; uma baixa sem venda sumiria com a peça sem explicação.
//
// IDEMPOTENTE. O webhook do provedor reenvia até receber 200, e um retry aqui
// daria baixa DUAS vezes no estoque e lançaria a venda duplicada no caixa. A
// guarda é o próprio status do pedido, checado DENTRO da transação.
// ============================================================
const { db, getConfig } = require('../db/database');

function exigirTenant(tenantId) {
  const t = Number(tenantId);
  if (!t) throw new Error('pedido-venda: tenantId obrigatorio');
  return t;
}

// Rótulo do item na venda: precisa dizer QUAL peça saiu, senão o cupom e o
// histórico ficam com "Vestido" três vezes sem distinguir cor nem tamanho.
function rotulo(nome, cor, tamanho) {
  const partes = [nome];
  if (cor) partes.push(cor);
  if (tamanho) partes.push(tamanho);
  return partes.join(' · ');
}

// ------------------------------------------------------------
// Converter
// ------------------------------------------------------------
function converter(tenantId, pedidoId, { forma = 'pix', origem = 'vitrine' } = {}) {
  const t = exigirTenant(tenantId);

  db.exec('BEGIN IMMEDIATE');
  try {
    // Relê DENTRO da transação: entre o webhook chegar e esta linha rodar, outro
    // processo (um retry, a lojista clicando "marcar como pago") pode ter fechado.
    const pedido = db.prepare(
      'SELECT * FROM vitrine_pedidos WHERE id = ? AND tenant_id = ?'
    ).get(pedidoId, t);

    if (!pedido) { db.exec('ROLLBACK'); return { ok: false, erro: 'Pedido não encontrado' }; }

    // JÁ VIROU VENDA. Não é erro — é o retry do provedor fazendo o trabalho dele.
    // Devolve a venda que já existe pra quem chamou poder responder 200.
    if (pedido.venda_id) {
      db.exec('ROLLBACK');
      return { ok: true, jaConvertido: true, vendaId: pedido.venda_id };
    }
    if (pedido.status === 'perdido') {
      db.exec('ROLLBACK');
      return { ok: false, erro: 'Pedido cancelado' };
    }

    const itens = db.prepare(`
      SELECT i.*, v.quantidade AS estoque, p.custo
        FROM vitrine_pedido_itens i
        LEFT JOIN variacoes v ON v.id = i.variacao_id AND v.tenant_id = i.tenant_id
        LEFT JOIN produtos  p ON p.id = i.produto_id  AND p.tenant_id = i.tenant_id
       WHERE i.tenant_id = ? AND i.pedido_id = ?
    `).all(t, pedidoId);

    if (!itens.length) { db.exec('ROLLBACK'); return { ok: false, erro: 'Pedido sem itens' }; }

    const subtotal = itens.reduce((s, i) => s + i.qtd * i.preco_unit, 0);

    // Taxa e imposto DESTA loja — getConfig sem o 3º argumento cairia no tenant 1
    // e cobraria a taxa de outra loja em toda venda (erro que já aconteceu aqui).
    const taxaPct = Number(getConfig(`taxa_${forma}`, '0', t)) || 0;
    const taxa = +(subtotal * taxaPct / 100).toFixed(2);
    const impostoPct = Number(getConfig('imposto_pct', '0', t)) || 0;
    const imposto = +(subtotal * impostoPct / 100).toFixed(2);

    const custoTotal = itens.reduce((s, i) => s + (Number(i.custo) || 0) * i.qtd, 0);
    const liquido = +(subtotal - taxa).toFixed(2);
    const lucro = +(subtotal - taxa - imposto - custoTotal).toFixed(2);

    const rv = db.prepare(`
      INSERT INTO vendas (tenant_id, cliente_id, subtotal, desconto, acrescimo, total,
                          forma_pagamento, origem, parcelas, taxa_aplicada, valor_liquido,
                          imposto, custo_total, lucro, observacao)
      VALUES (?, ?, ?, 0, 0, ?, ?, ?, 1, ?, ?, ?, ?, ?, ?)
    `).run(t, pedido.cliente_id || null, subtotal, subtotal, forma, origem,
           taxa, liquido, imposto, custoTotal, lucro, `Pedido ${pedido.codigo}`);
    const vendaId = Number(rv.lastInsertRowid);

    const insItem = db.prepare(`
      INSERT INTO venda_itens (venda_id, tenant_id, variacao_id, produto_id, descricao, qtd, preco_unit, custo_unit)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `);
    // A TRAVA MORA NO PRÓPRIO UPDATE (`AND quantidade >= ?`), como no vale e no
    // cupom. Checar antes e atualizar depois deixa uma janela entre as duas
    // operações — e é exatamente nessa janela que a venda do balcão passa.
    const baixa = db.prepare('UPDATE variacoes SET quantidade = quantidade - ? WHERE id = ? AND tenant_id = ? AND quantidade >= ?');
    const mov = db.prepare("INSERT INTO movimentos_estoque (variacao_id, tipo, qtd, motivo) VALUES (?, 'saida', ?, ?)");

    for (const i of itens) {
      insItem.run(vendaId, t, i.variacao_id || null, i.produto_id || null,
                  rotulo(i.produto_nome, i.cor, i.tamanho), i.qtd, i.preco_unit, Number(i.custo) || 0);

      if (i.variacao_id) {
        const r = baixa.run(i.qtd, i.variacao_id, t, i.qtd);
        if (r.changes !== 1) {
          // Estoque acabou entre a reserva e o pagamento. Desfaz TUDO: é melhor a
          // lojista tratar isso na conversa (devolver ou trocar a peça) do que o
          // sistema registrar uma venda de algo que não existe e o estoque virar
          // negativo em silêncio.
          db.exec('ROLLBACK');
          return {
            ok: false, semEstoque: true,
            erro: `Sem estoque: ${rotulo(i.produto_nome, i.cor, i.tamanho)}`,
          };
        }
        mov.run(i.variacao_id, -i.qtd, `pedido ${pedido.codigo}`);
      }
    }

    db.prepare(`
      INSERT INTO venda_pagamentos (venda_id, tenant_id, forma, valor, parcelas, taxa_pct, valor_taxa, valor_liquido, adquirente, status_transacao)
      VALUES (?, ?, ?, ?, 1, ?, ?, ?, 'mercadopago', 'aprovado')
    `).run(vendaId, t, forma, subtotal, taxaPct, taxa, liquido);

    // A reserva cumpriu o papel dela: a peça agora está baixada de verdade.
    db.prepare('UPDATE vitrine_pedido_itens SET reservado_ate = NULL WHERE tenant_id = ? AND pedido_id = ?')
      .run(t, pedidoId);

    db.prepare(`
      UPDATE vitrine_pedidos
         SET status = 'fechado', venda_id = ?, pagamento_status = 'approved',
             atualizado_em = datetime('now','localtime')
       WHERE id = ? AND tenant_id = ?
    `).run(vendaId, pedidoId, t);

    // Totais da cliente — é o que alimenta RFM, régua e clube. Sem isto, a compra
    // do atacado não existiria pro CRM.
    if (pedido.cliente_id) {
      db.prepare(`
        UPDATE clientes
           SET total_gasto = COALESCE(total_gasto,0) + ?,
               num_compras = COALESCE(num_compras,0) + 1,
               ultima_compra = date('now','localtime'),
               gasto_sem_selo = COALESCE(gasto_sem_selo,0) + ?
         WHERE id = ? AND tenant_id = ?
      `).run(subtotal, subtotal, pedido.cliente_id, t);
    }

    db.exec('COMMIT');

    // O caixa do dia é recalculado FORA da transação, de propósito: ele soma as
    // vendas do dia inteiro e a função é do router de vendas (que abre a própria
    // conexão). Chamar dentro daria transação aninhada. Se falhar aqui, a venda
    // continua correta — o caixa se acerta na próxima venda ou no fechamento.
    try {
      const { atualizarCaixaDia } = require('../routes/vendas');
      const hoje = new Date().toLocaleDateString('sv-SE');   // YYYY-MM-DD local
      if (typeof atualizarCaixaDia === 'function') atualizarCaixaDia(hoje, t);
    } catch (err) {
      require('./logger').warn('[PEDIDO->VENDA] venda ok, caixa nao recalculado:', err.message);
    }

    return { ok: true, vendaId, total: subtotal, clienteId: pedido.cliente_id || null };
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
}

module.exports = { converter };
