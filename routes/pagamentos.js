// ============================================================
// Rotas de Pagamento Stripe
// POST /api/pagamentos/checkout    → criar sessão de checkout
// GET  /api/pagamentos/status      → status de uma sessão
// POST /api/pagamentos/webhook     → webhook do Stripe
// ============================================================
const express = require('express');
const { exigirLogin, injetarTenant, apenasAdmin } = require('../middleware/seguranca');
const { db } = require('../db/database');
const {
  criarCheckoutSession,
  processarWebhookStripe,
  obterStatusCheckout,
} = require('../lib/stripe-integration');

const router = express.Router();

// --- POST /checkout → criar sessão de checkout para pagar cobrança ---
router.post('/checkout', exigirLogin, injetarTenant, async (req, res) => {
  try {
    const tenantId = req.session?.tenant_id;
    if (!tenantId) {
      return res.status(401).json({ erro: 'Tenant não identificado' });
    }

    // Cobrança específica (renovação) ou primeira assinatura?
    const { cobranca_id } = req.body;

    const { sessionId, url } = await criarCheckoutSession(tenantId, cobranca_id);

    console.log(`[PAGAMENTO] Checkout criado: tenant=${tenantId} session=${sessionId}`);
    res.json({
      sucesso: true,
      checkoutUrl: url,
      sessionId,
    });
  } catch (err) {
    console.error('[PAGAMENTO] Erro ao criar checkout:', err);
    res.status(500).json({ erro: 'Erro ao criar sessão de pagamento' });
  }
});

// --- GET /status → verificar status do pagamento ---
router.get('/status', exigirLogin, injetarTenant, async (req, res) => {
  try {
    const { session_id } = req.query;
    if (!session_id) {
      return res.status(400).json({ erro: 'session_id obrigatório' });
    }

    const status = await obterStatusCheckout(session_id);
    res.json(status);
  } catch (err) {
    console.error('[PAGAMENTO] Erro ao obter status:', err);
    res.status(500).json({ erro: 'Erro ao obter status do pagamento' });
  }
});

// --- POST /webhook → Webhook do Stripe (raw body, sem autenticação) ---
router.post('/webhook', express.raw({ type: 'application/json' }), async (req, res) => {
  try {
    const signature = req.headers['stripe-signature'];
    if (!signature) {
      return res.status(400).json({ erro: 'Assinatura do Stripe não encontrada' });
    }

    const payload = req.body instanceof Buffer ? req.body.toString('utf-8') : req.body;
    const event = await processarWebhookStripe(payload, signature);

    console.log(`[STRIPE] ✅ Webhook processado: ${event.type}`);
    res.json({ recebido: true, tipo: event.type });
  } catch (err) {
    console.error('[STRIPE] Erro ao processar webhook:', err);
    res.status(400).json({ erro: err.message });
  }
});

// --- GET /admin/cobrancas → listar todas as cobranças (admin) ---
router.get('/admin/cobrancas', apenasAdmin, (req, res) => {
  try {
    const cobracas = db.prepare(`
      SELECT
        c.*,
        t.email,
        t.nome_loja,
        a.plano,
        a.valor_mensal
      FROM cobracas c
      JOIN tenants t ON t.id = c.tenant_id
      LEFT JOIN assinaturas a ON a.id = c.assinatura_id
      ORDER BY c.data_cobranca DESC
      LIMIT 100
    `).all();

    // Resumo
    const resumo = {
      total_cobracas: cobracas.length,
      pago: cobracas.filter(c => c.status === 'pago').reduce((s, c) => s + c.valor, 0),
      pendente: cobracas.filter(c => c.status === 'pendente').reduce((s, c) => s + c.valor, 0),
      falho: cobracas.filter(c => c.status === 'falho').length,
    };

    res.json({
      cobracas,
      resumo,
    });
  } catch (err) {
    console.error('[PAGAMENTO] Erro ao listar cobranças:', err);
    res.status(500).json({ erro: 'Erro ao listar cobranças' });
  }
});

// --- GET /admin/cobrancas/:id → detalhes de uma cobrança ---
router.get('/admin/cobrancas/:id', apenasAdmin, (req, res) => {
  try {
    const cobranca = db.prepare(`
      SELECT
        c.*,
        t.email,
        t.nome_loja,
        a.plano,
        a.valor_mensal
      FROM cobracas c
      JOIN tenants t ON t.id = c.tenant_id
      LEFT JOIN assinaturas a ON a.id = c.assinatura_id
      WHERE c.id = ?
    `).get(req.params.id);

    if (!cobranca) {
      return res.status(404).json({ erro: 'Cobrança não encontrada' });
    }

    res.json(cobranca);
  } catch (err) {
    console.error('[PAGAMENTO] Erro ao buscar cobrança:', err);
    res.status(500).json({ erro: 'Erro ao buscar cobrança' });
  }
});

// --- PATCH /admin/cobrancas/:id/marcar-paga → marcar cobrança como paga manualmente ---
router.patch('/admin/cobrancas/:id/marcar-paga', apenasAdmin, (req, res) => {
  try {
    const cobranca = db.prepare('SELECT * FROM cobracas WHERE id = ?').get(req.params.id);
    if (!cobranca) {
      return res.status(404).json({ erro: 'Cobrança não encontrada' });
    }

    const { metodo_pagamento = 'manual' } = req.body;

    db.prepare(`
      UPDATE cobracas
      SET status = 'pago', metodo_pagamento = ?, data_pagamento = datetime('now')
      WHERE id = ?
    `).run(metodo_pagamento, req.params.id);

    console.log(`[PAGAMENTO] Cobrança ${req.params.id} marcada como paga manualmente`);
    res.json({
      sucesso: true,
      mensagem: `Cobrança marcada como paga via ${metodo_pagamento}`,
    });
  } catch (err) {
    console.error('[PAGAMENTO] Erro ao marcar cobrança:', err);
    res.status(500).json({ erro: 'Erro ao marcar cobrança como paga' });
  }
});

module.exports = router;
