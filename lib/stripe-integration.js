// ============================================================
// Integração Stripe para Cobranças SaaS
// Checkout Session + Webhooks
// ============================================================
const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
const { db } = require('../db/database');
const { pagarCobranca, reativarAposPagamento } = require('./assinatura');

// ✅ Criar sessão de checkout (assinar ou renovar)
async function criarCheckoutSession(tenantId, cobrancaId = null) {
  const tenant = db.prepare('SELECT * FROM tenants WHERE id = ?').get(tenantId);
  if (!tenant) {
    throw new Error('Tenant não encontrado');
  }

  const assinatura = db.prepare('SELECT * FROM assinaturas WHERE tenant_id = ?').get(tenantId);
  if (!assinatura) {
    throw new Error('Assinatura não encontrada');
  }

  // Se houver cobrança específica, usar seu valor; senão, usar valor mensal
  let valor = assinatura.valor_mensal * 100; // Stripe usa centavos
  if (cobrancaId) {
    const cobranca = db.prepare('SELECT valor FROM cobracas WHERE id = ?').get(cobrancaId);
    if (cobranca) {
      valor = cobranca.valor * 100;
    }
  }

  const descricao = cobrancaId
    ? `Cobrança ${cobrancaId} - ${tenant.nome_loja}`
    : `Assinatura ${assinatura.plano} - ${tenant.nome_loja}`;

  const session = await stripe.checkout.sessions.create({
    payment_method_types: ['card'],
    line_items: [
      {
        price_data: {
          currency: 'brl',
          product_data: {
            name: descricao,
            description: `Plano ${assinatura.plano} por 30 dias`,
          },
          unit_amount: Math.round(valor),
        },
        quantity: 1,
      },
    ],
    mode: 'payment',
    success_url: `${process.env.STRIPE_REDIRECT_URL}/dashboard?pagamento=sucesso&session_id={CHECKOUT_SESSION_ID}`,
    cancel_url: `${process.env.STRIPE_REDIRECT_URL}/dashboard?pagamento=cancelado`,
    customer_email: tenant.email,
    metadata: {
      tenant_id: tenantId,
      cobranca_id: cobrancaId || null,
      plano: assinatura.plano,
    },
  });

  // Guardar session_id no banco para rastreamento
  if (cobrancaId) {
    db.prepare(`
      UPDATE cobracas
      SET referencia = ?
      WHERE id = ?
    `).run(session.id, cobrancaId);
  }

  return {
    sessionId: session.id,
    url: session.url,
  };
}

// ✅ Processar webhook do Stripe
async function processarWebhookStripe(payload, signature) {
  let event;

  try {
    event = stripe.webhooks.constructEvent(
      payload,
      signature,
      process.env.STRIPE_WEBHOOK_SECRET
    );
  } catch (err) {
    console.error('[STRIPE] Erro ao validar assinatura:', err);
    throw new Error('Assinatura inválida');
  }

  console.log(`[STRIPE] Webhook recebido: ${event.type}`);

  switch (event.type) {
    case 'checkout.session.completed':
      await handleCheckoutSessionCompleted(event.data.object);
      break;

    case 'payment_intent.succeeded':
      await handlePaymentIntentSucceeded(event.data.object);
      break;

    case 'payment_intent.payment_failed':
      await handlePaymentIntentFailed(event.data.object);
      break;

    default:
      console.log(`[STRIPE] Evento não tratado: ${event.type}`);
  }

  return event;
}

// ✅ Handle: Checkout completado (pagamento processado)
async function handleCheckoutSessionCompleted(session) {
  const { tenant_id, cobranca_id } = session.metadata;

  if (!tenant_id) {
    console.error('[STRIPE] tenant_id não encontrado no metadata');
    return;
  }

  try {
    // Confirmar pagamento da cobrança específica
    if (cobranca_id) {
      pagarCobranca(parseInt(cobranca_id), 'stripe');
      console.log(`[STRIPE] ✅ Cobrança ${cobranca_id} marcada como paga`);
    }

    // Reativar cliente se estava bloqueado
    reativarAposPagamento(parseInt(tenant_id));
    console.log(`[STRIPE] 🔓 Tenant ${tenant_id} reativado após pagamento`);

    // Registrar no banco (transação Stripe)
    db.prepare(`
      UPDATE cobracas
      SET status = 'pago', metodo_pagamento = 'stripe', data_pagamento = datetime('now')
      WHERE id = ?
    `).run(cobranca_id);

  } catch (err) {
    console.error('[STRIPE] Erro ao processar checkout:', err);
  }
}

// ✅ Handle: Payment Intent bem-sucedido
async function handlePaymentIntentSucceeded(paymentIntent) {
  console.log(`[STRIPE] 💳 Pagamento bem-sucedido: ${paymentIntent.id}`);
  // Já tratado no checkout.session.completed
}

// ✅ Handle: Payment Intent falhou
async function handlePaymentIntentFailed(paymentIntent) {
  console.log(`[STRIPE] ❌ Pagamento falhou: ${paymentIntent.id}`);

  const session = await stripe.checkout.sessions.list({
    limit: 1,
  });

  if (session.data.length > 0) {
    const { metadata, id } = session.data[0];
    const { cobranca_id } = metadata;

    if (cobranca_id) {
      // Incrementar tentativas
      db.prepare(`
        UPDATE cobracas
        SET tentativas = tentativas + 1
        WHERE id = ?
      `).run(cobranca_id);

      console.log(`[STRIPE] ⚠️ Cobrança ${cobranca_id} falhou. Tentativas incrementadas.`);
    }
  }
}

// ✅ Obter status de uma sessão Stripe
async function obterStatusCheckout(sessionId) {
  try {
    const session = await stripe.checkout.sessions.retrieve(sessionId);
    return {
      status: session.payment_status, // paid, unpaid, no_payment_required
      paymentStatus: session.payment_status,
      amountTotal: session.amount_total / 100,
      customerEmail: session.customer_email,
      metadata: session.metadata,
    };
  } catch (err) {
    console.error('[STRIPE] Erro ao obter status:', err);
    throw err;
  }
}

module.exports = {
  criarCheckoutSession,
  processarWebhookStripe,
  obterStatusCheckout,
};
