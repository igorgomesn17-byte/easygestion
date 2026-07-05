// ============================================================
// Webhooks — Receber eventos do Stripe (COM IDEMPOTÊNCIA)
// POST /api/webhooks/stripe
// ============================================================
const express = require('express');
const router = express.Router();
const Stripe = require('stripe');
const { processarWebhookStripe } = require('../lib/stripe');
const { db } = require('../db/database');
const logger = require('../lib/logger');

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY || 'sk_test_fake');
const WEBHOOK_SECRET = process.env.STRIPE_WEBHOOK_SECRET || 'whsec_test_fake';

// --- Middleware: Verificar assinatura HMAC do Stripe ---
function verificarAssinaturaStripe(req, res, next) {
  const sig = req.headers['stripe-signature'];
  const body = req.rawBody || req.body;

  try {
    const event = stripe.webhooks.constructEvent(body, sig, WEBHOOK_SECRET);
    req.stripeEvent = event;
    next();
  } catch (err) {
    logger.error('[Webhook] Assinatura inválida:', err.message);
    return res.status(400).json({ erro: 'Assinatura inválida' });
  }
}

// --- POST /api/webhooks/stripe (COM IDEMPOTÊNCIA) ---
router.post('/stripe', verificarAssinaturaStripe, async (req, res) => {
  try {
    const event = req.stripeEvent;

    logger.info(`[Webhook] Evento recebido: ${event.type} (ID: ${event.id})`);

    // ✅ PASSO 1: Verificar idempotência (evento já foi processado?)
    const jaProcessado = db.prepare(
      'SELECT id FROM stripe_webhooks WHERE event_id = ?'
    ).get(event.id);

    if (!jaProcessado) {
      // ✅ PASSO 2: Processar apenas uma vez
      try {
        await processarWebhookStripe(event);
        logger.info(`[Webhook] Evento processado com sucesso: ${event.id}`);
      } catch (err) {
        logger.error(`[Webhook] Erro ao processar evento ${event.id}: ${err.message}`);
        // Registrar error para review manual depois
        db.prepare(
          'INSERT INTO stripe_webhooks (event_id, event_type, processed_at, manual_review) VALUES (?, ?, ?, ?)'
        ).run(event.id, event.type, Date.now(), 1);
        // SEMPRE retornar 200 para Stripe (não deixar retentar)
        return res.status(200).json({
          received: true,
          error: err.message,
          manual_review_required: true
        });
      }

      // ✅ PASSO 3: Marcar como processado (sucesso)
      db.prepare(
        'INSERT INTO stripe_webhooks (event_id, event_type, processed_at, manual_review) VALUES (?, ?, ?, ?)'
      ).run(event.id, event.type, Date.now(), 0);
    } else {
      logger.warn(`[Webhook] Evento já foi processado (idempotência ativada): ${event.id}`);
    }

    // ✅ PASSO 4: SEMPRE retornar 200 (sucesso ou já processado)
    res.status(200).json({ received: true, type: event.type });

  } catch (err) {
    logger.error('[Webhook] Erro inesperado:', err.message);
    // Mesmo em erro inesperado: retornar 200 (não deixar Stripe retentar infinitamente)
    res.status(200).json({
      received: true,
      error: err.message,
      manual_review_required: true
    });
  }
});

module.exports = router;
