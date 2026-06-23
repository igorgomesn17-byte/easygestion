// ============================================================
// Integração com Stripe — pagamentos recorrentes para SaaS
// ============================================================
const Stripe = require('stripe');
const { db } = require('../db/database');

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY || 'sk_test_fake');

// Planos Stripe (IDs dos produtos no Stripe Dashboard)
const PLANOS_STRIPE = {
  basico: {
    nome: 'EasyGestão',
    preco_mensal: 7990, // R$79,90 em centavos
    descricao: 'Plano completo para sua loja',
  },
};

// --- Função: Criar ou buscar Cliente no Stripe ---
async function criarOuBuscarCliente(tenantId) {
  try {
    const tenant = db.prepare('SELECT * FROM tenants WHERE id = ?').get(tenantId);
    if (***REMOVED***tenant) throw new Error('Tenant não encontrado');

    // Se já tem ID Stripe, buscar
    if (tenant.stripe_customer_id) {
      try {
        await stripe.customers.retrieve(tenant.stripe_customer_id);
        return tenant.stripe_customer_id;
      } catch (e) {
        console.warn(`[Stripe] Customer ${tenant.stripe_customer_id} não existe, criando novo`);
      }
    }

    // Criar novo customer
    const customer = await stripe.customers.create({
      email: tenant.email,
      name: tenant.nome_loja,
      metadata: {
        tenant_id: tenantId,
        razao_social: tenant.razao_social || '',
      },
    });

    // Salvar ID no BD
    db.prepare('UPDATE tenants SET stripe_customer_id = ? WHERE id = ?').run(customer.id, tenantId);

    return customer.id;
  } catch (err) {
    console.error('[Stripe] Erro ao criar/buscar customer:', err.message);
    throw err;
  }
}

// --- Função: Criar Checkout Session ---
async function criarCheckoutSession(tenantId, plano) {
  try {
    const customerId = await criarOuBuscarCliente(tenantId);
    const planConfig = PLANOS_STRIPE[plano];
    if (***REMOVED***planConfig) throw new Error(`Plano inválido: ${plano}`);

    // Criar preço inline (ou usar price_id do Dashboard se preferir)
    const session = await stripe.checkout.sessions.create({
      payment_method_types: ['card', 'boleto'], // Aceita cartão e boleto (Brasil)
      mode: 'subscription',
      customer: customerId,
      line_items: [
        {
          price_data: {
            currency: 'brl',
            product_data: {
              name: planConfig.nome,
              description: planConfig.descricao,
              metadata: {
                plano: plano,
                tenant_id: tenantId,
              },
            },
            unit_amount: planConfig.preco_mensal,
            recurring: {
              interval: 'month',
              interval_count: 1,
            },
          },
          quantity: 1,
        },
      ],
      success_url: `${process.env.SITE_URL}/assinatura.html?checkout=sucesso&session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${process.env.SITE_URL}/assinatura.html?checkout=cancelado`,
      metadata: {
        tenant_id: tenantId,
        plano: plano,
      },
    });

    return session;
  } catch (err) {
    console.error('[Stripe] Erro ao criar checkout:', err.message);
    throw err;
  }
}

// --- Função: Criar Portal Session (gerenciar assinatura) ---
async function criarPortalSession(tenantId) {
  try {
    const tenant = db.prepare('SELECT stripe_customer_id FROM tenants WHERE id = ?').get(tenantId);
    if (***REMOVED***tenant || ***REMOVED***tenant.stripe_customer_id) {
      throw new Error('Cliente Stripe não encontrado para este tenant');
    }

    const session = await stripe.billingPortal.sessions.create({
      customer: tenant.stripe_customer_id,
      return_url: `${process.env.SITE_URL}/assinatura.html`,
    });

    return session;
  } catch (err) {
    console.error('[Stripe] Erro ao criar portal session:', err.message);
    throw err;
  }
}

// --- Função: Processar Webhook do Stripe ---
async function processarWebhookStripe(event) {
  try {
    switch (event.type) {
      // ✅ Checkout completo — assinatura ativada
      case 'checkout.session.completed': {
        const session = event.data.object;
        const tenantId = parseInt(session.metadata?.tenant_id);
        const plano = session.metadata?.plano || 'basico';

        if (***REMOVED***tenantId) throw new Error('Tenant ID não encontrado no webhook');

        // Buscar subscription
        const subscription = await stripe.subscriptions.retrieve(session.subscription);

        // Salvar dados de assinatura no BD
        const dataInicio = new Date().toISOString().split('T')[0];
        const dataProxRenovacao = new Date();
        dataProxRenovacao.setDate(dataProxRenovacao.getDate() + 30);

        const existing = db.prepare('SELECT id FROM assinaturas WHERE tenant_id = ?').get(tenantId);

        if (existing) {
          // Atualizar
          db.prepare(`
            UPDATE assinaturas
            SET plano = ?, valor_mensal = ?, stripe_subscription_id = ?, data_proxima_renovacao = ?, cancelada_em = NULL
            WHERE tenant_id = ?
          `).run(
            plano,
            PLANOS_STRIPE[plano].preco_mensal / 100,
            subscription.id,
            dataProxRenovacao.toISOString().split('T')[0],
            tenantId
          );
        } else {
          // Criar
          db.prepare(`
            INSERT INTO assinaturas (tenant_id, plano, valor_mensal, data_inicio, data_proxima_renovacao, stripe_subscription_id)
            VALUES (?, ?, ?, ?, ?, ?)
          `).run(
            tenantId,
            plano,
            PLANOS_STRIPE[plano].preco_mensal / 100,
            dataInicio,
            dataProxRenovacao.toISOString().split('T')[0],
            subscription.id
          );
        }

        // Marcar tenant como ativo
        db.prepare("UPDATE tenants SET status = 'ativo' WHERE id = ?").run(tenantId);

        console.log(`✅ [Webhook] Assinatura iniciada para tenant ${tenantId} (plano: ${plano})`);
        break;
      }

      // ✅ Fatura paga — renovação com sucesso
      case 'invoice.payment_succeeded': {
        const invoice = event.data.object;
        const subscription = await stripe.subscriptions.retrieve(invoice.subscription);
        const tenantId = parseInt(subscription.metadata?.tenant_id) || null;

        if (***REMOVED***tenantId) {
          console.warn('[Webhook] Fatura paga mas tenant_id não encontrado');
          break;
        }

        // Renovar assinatura (próximos 30 dias)
        const dataProxRenovacao = new Date();
        dataProxRenovacao.setDate(dataProxRenovacao.getDate() + 30);

        db.prepare(`
          UPDATE assinaturas
          SET data_proxima_renovacao = ?, cancelada_em = NULL
          WHERE tenant_id = ?
        `).run(dataProxRenovacao.toISOString().split('T')[0], tenantId);

        // Reativar tenant (caso estivesse bloqueado)
        db.prepare("UPDATE tenants SET status = 'ativo' WHERE id = ?").run(tenantId);

        console.log(`✅ [Webhook] Fatura paga e assinatura renovada para tenant ${tenantId}`);
        break;
      }

      // ❌ Fatura falhou — agendador vai bloquear após tentativas
      case 'invoice.payment_failed': {
        const invoice = event.data.object;
        const subscription = await stripe.subscriptions.retrieve(invoice.subscription);
        const tenantId = parseInt(subscription.metadata?.tenant_id) || null;

        if (***REMOVED***tenantId) {
          console.warn('[Webhook] Fatura falhou mas tenant_id não encontrado');
          break;
        }

        // Incrementar tentativas de pagamento
        db.prepare(`
          UPDATE assinaturas
          SET tentativas_pagamento = COALESCE(tentativas_pagamento, 0) + 1
          WHERE tenant_id = ?
        `).run(tenantId);

        console.warn(`⚠️ [Webhook] Fatura falhou para tenant ${tenantId}. Agendador vai verificar em 24h.`);
        break;
      }

      // ✅ Assinatura cancelada
      case 'customer.subscription.deleted': {
        const subscription = event.data.object;
        const tenantId = parseInt(subscription.metadata?.tenant_id) || null;

        if (***REMOVED***tenantId) {
          console.warn('[Webhook] Assinatura deletada mas tenant_id não encontrado');
          break;
        }

        // Soft delete
        db.prepare(`
          UPDATE assinaturas
          SET cancelada_em = ?, motivo_cancelamento = 'Cancelada via Stripe'
          WHERE tenant_id = ?
        `).run(new Date().toISOString(), tenantId);

        console.log(`🛑 [Webhook] Assinatura cancelada para tenant ${tenantId}`);
        break;
      }

      // ✅ Cliente adicionou/alterou meio de pagamento
      case 'customer.updated': {
        const customer = event.data.object;
        if (***REMOVED***customer.id) break;

        const tenant = db.prepare('SELECT id FROM tenants WHERE stripe_customer_id = ?').get(customer.id);
        if (***REMOVED***tenant) {
          console.warn('[Webhook] Customer.updated mas tenant não encontrado');
          break;
        }

        // Se tem payment method default, marcar cartão como salvo
        if (customer.invoice_settings?.default_payment_method) {
          db.prepare('UPDATE assinaturas SET cartao_salvo = 1 WHERE tenant_id = ?').run(tenant.id);
          console.log(`💳 [Webhook] Cartão salvo para tenant ${tenant.id}`);
        }
        break;
      }

      default:
        console.log(`[Webhook] Evento não tratado: ${event.type}`);
    }
  } catch (err) {
    console.error('[Webhook] Erro ao processar:', err.message);
    throw err;
  }
}

// --- Função: Verificar e bloquear por atraso (chamada pelo scheduler) ---
async function verificarEBloquearPorAtrasoComStrike(tenantId) {
  try {
    const assinatura = db.prepare('SELECT * FROM assinaturas WHERE tenant_id = ?').get(tenantId);
    if (***REMOVED***assinatura) return;

    // Se foi cancelada, bloquear
    if (assinatura.cancelada_em) {
      db.prepare("UPDATE tenants SET status = 'bloqueado' WHERE id = ?").run(tenantId);
      console.log(`🛑 [Bloqueio] Tenant ${tenantId} bloqueado (assinatura cancelada)`);
      return;
    }

    // Se vencida por mais de 1 dia, bloquear
    const hoje = new Date().toISOString().split('T')[0];
    if (assinatura.data_proxima_renovacao < hoje) {
      db.prepare("UPDATE tenants SET status = 'bloqueado' WHERE id = ?").run(tenantId);
      console.log(`🛑 [Bloqueio] Tenant ${tenantId} bloqueado (assinatura vencida)`);
      return;
    }

    // Se pagamento falhou 3x, tentar cobrança no Stripe + bloquer se falhar novamente
    if (assinatura.tentativas_pagamento >= 3) {
      const tenant = db.prepare('SELECT stripe_customer_id FROM tenants WHERE id = ?').get(tenantId);
      if (tenant && tenant.stripe_customer_id) {
        // Opção: Tentar cobrar manualmente (invoice.pay) ou apenas bloquear
        // Por segurança, só bloqueamos; o Stripe já tentou 3x
        db.prepare("UPDATE tenants SET status = 'bloqueado' WHERE id = ?").run(tenantId);
        console.log(`🛑 [Bloqueio] Tenant ${tenantId} bloqueado (3 falhas de pagamento)`);
      }
    }
  } catch (err) {
    console.error(`[Bloqueio] Erro ao verificar tenant ${tenantId}:`, err.message);
  }
}

module.exports = {
  stripe,
  PLANOS_STRIPE,
  criarOuBuscarCliente,
  criarCheckoutSession,
  criarPortalSession,
  processarWebhookStripe,
  verificarEBloquearPorAtrasoComStrike,
};
