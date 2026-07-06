// ============================================================
// Integração com Stripe — pagamentos recorrentes para SaaS
// ============================================================
const Stripe = require('stripe');
const { db } = require('../db/database');
const { definicaoPlano, normalizarPlano } = require('./planos');

const stripeKey = process.env.STRIPE_SECRET_KEY || 'sk_test_fake';
console.log('[STRIPE INIT] Usando chave:', stripeKey.substring(0, 30) + '...');
const stripe = new Stripe(stripeKey);

// Matriz de Price IDs: TIER (starter/growth/enterprise) × CICLO (mensal/anual).
// São dois eixos independentes — o tier define o que o cliente pode fazer
// (lib/planos.js); o ciclo define de quanto em quanto tempo é cobrado.
// Configure os 6 Price IDs no Stripe Dashboard via env. Sem env = placeholder
// (checkout falhará em produção até os IDs reais serem preenchidos).
const PRICE_IDS = {
  starter:    { mensal: process.env.STRIPE_PRICE_STARTER_MENSAL,    anual: process.env.STRIPE_PRICE_STARTER_ANUAL },
  growth:     { mensal: process.env.STRIPE_PRICE_GROWTH_MENSAL,     anual: process.env.STRIPE_PRICE_GROWTH_ANUAL },
  enterprise: { mensal: process.env.STRIPE_PRICE_ENTERPRISE_MENSAL, anual: process.env.STRIPE_PRICE_ENTERPRISE_ANUAL },
};

// Compat: os antigos STRIPE_PRICE_MENSAL/ANUAL viram o Starter (plano de entrada).
if (!PRICE_IDS.starter.mensal && process.env.STRIPE_PRICE_MENSAL) PRICE_IDS.starter.mensal = process.env.STRIPE_PRICE_MENSAL;
if (!PRICE_IDS.starter.anual && process.env.STRIPE_PRICE_ANUAL)   PRICE_IDS.starter.anual  = process.env.STRIPE_PRICE_ANUAL;

// Resolve o price_id para um par (tier, ciclo).
function priceIdDe(tier, ciclo) {
  const t = normalizarPlano(tier);
  return PRICE_IDS[t]?.[ciclo] || null;
}

// --- Função: Criar ou buscar Cliente no Stripe ---
async function criarOuBuscarCliente(tenantId) {
  try {
    const tenant = db.prepare('SELECT * FROM tenants WHERE id = ?').get(tenantId);
    if (!tenant) throw new Error('Tenant não encontrado');

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
// tier: 'starter'|'growth'|'enterprise' (o QUE o cliente contrata)
// ciclo: 'mensal'|'anual' (de quanto em quanto tempo paga). Default mensal.
async function criarCheckoutSession(tenantId, tier, ciclo = 'mensal') {
  try {
    const customerId = await criarOuBuscarCliente(tenantId);
    const plano = normalizarPlano(tier);
    if (!['mensal', 'anual'].includes(ciclo)) throw new Error(`Ciclo inválido: ${ciclo}`);

    const priceId = priceIdDe(plano, ciclo);
    if (!priceId) throw new Error(`Price ID não configurado para ${plano}/${ciclo}. Defina STRIPE_PRICE_${plano.toUpperCase()}_${ciclo.toUpperCase()} no .env`);

    const session = await stripe.checkout.sessions.create({
      payment_method_types: ['card'],
      mode: 'subscription', // subscription p/ parcelamento nativo do Stripe
      customer: customerId,
      line_items: [{ price: priceId, quantity: 1 }],
      success_url: `${process.env.SITE_URL}/assinatura.html?checkout=sucesso&session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${process.env.SITE_URL}/planos.html?checkout=cancelado`,
      metadata: {
        tenant_id: tenantId,
        plano: plano,      // TIER contratado (o que grava em tenants.plano)
        ciclo: ciclo,      // ciclo de cobrança
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
    if (!tenant || !tenant.stripe_customer_id) {
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
        // Novo modelo: TIER (plano) e CICLO são metadados separados.
        // Compat: se vier o antigo 'tipo_plano' (mensal/anual), trata como ciclo e
        // usa o tier já existente do tenant (ou starter).
        const plano = normalizarPlano(session.metadata?.plano || db.prepare('SELECT plano FROM tenants WHERE id = ?').get(tenantId)?.plano);
        const ciclo = session.metadata?.ciclo || session.metadata?.tipo_plano || 'mensal';

        if (!tenantId) throw new Error('Tenant ID não encontrado no webhook');

        const dataInicio = new Date().toISOString().split('T')[0];

        const subscription = await stripe.subscriptions.retrieve(session.subscription);
        const stripeSubscriptionId = subscription.id;

        // Ciclo define o intervalo de renovação; tier define o valor (de lib/planos.js).
        const daysToAdd = ciclo === 'anual' ? 365 : 30;
        const dataProxRenovacao = new Date();
        dataProxRenovacao.setDate(dataProxRenovacao.getDate() + daysToAdd);

        const def = definicaoPlano(plano);
        // valor_mensal sempre normalizado por mês (anual desdobrado em 12) p/ o MRR bater.
        const valorMensalReal = ciclo === 'anual'
          ? Math.round((def.preco_anual / 12) * 100) / 100
          : def.preco_mensal;

        const existing = db.prepare('SELECT id FROM assinaturas WHERE tenant_id = ?').get(tenantId);

        if (existing) {
          db.prepare(`
            UPDATE assinaturas
            SET plano = ?, valor_mensal = ?, stripe_subscription_id = ?, data_proxima_renovacao = ?, cancelada_em = NULL, em_teste = 0
            WHERE tenant_id = ?
          `).run(plano, valorMensalReal, stripeSubscriptionId, dataProxRenovacao.toISOString().split('T')[0], tenantId);
        } else {
          db.prepare(`
            INSERT INTO assinaturas (tenant_id, plano, valor_mensal, data_inicio, data_proxima_renovacao, stripe_subscription_id, em_teste)
            VALUES (?, ?, ?, ?, ?, ?, ?)
          `).run(tenantId, plano, valorMensalReal, dataInicio, dataProxRenovacao.toISOString().split('T')[0], stripeSubscriptionId, 0);
        }

        // Grava o TIER no tenant (fonte que os gates leem) e marca como ativo.
        db.prepare("UPDATE tenants SET status = 'ativo', plano = ? WHERE id = ?").run(plano, tenantId);

        console.log(`✅ [Webhook] Assinatura ${existing ? 'atualizada' : 'criada'} p/ tenant ${tenantId} (plano: ${plano}, ciclo: ${ciclo}, +${daysToAdd}d)`);
        break;
      }

      // ✅ Fatura paga — renovação com sucesso
      case 'invoice.payment_succeeded': {
        const invoice = event.data.object;
        const subscription = await stripe.subscriptions.retrieve(invoice.subscription);
        const tenantId = parseInt(subscription.metadata?.tenant_id) || null;

        if (!tenantId) {
          console.warn('[Webhook] Fatura paga mas tenant_id não encontrado');
          break;
        }

        // Renovar assinatura usando função generalizada (respeita período do plano: 30 ou 365 dias)
        const { renovarAssinatura } = require('./assinatura');
        renovarAssinatura(tenantId);

        // Desativar qualquer cancelamento pendente
        db.prepare(`
          UPDATE assinaturas
          SET cancelada_em = NULL
          WHERE tenant_id = ?
        `).run(tenantId);

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

        if (!tenantId) {
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

        if (!tenantId) {
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
        if (!customer.id) break;

        const tenant = db.prepare('SELECT id FROM tenants WHERE stripe_customer_id = ?').get(customer.id);
        if (!tenant) {
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
    if (!assinatura) return;

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
  PRICE_IDS,
  priceIdDe,
  criarOuBuscarCliente,
  criarCheckoutSession,
  criarPortalSession,
  processarWebhookStripe,
  verificarEBloquearPorAtrasoComStrike,
};
