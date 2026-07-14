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

    // ✅ PASSO 1: RESERVAR o evento ANTES de processar. A idempotência é o próprio
    // UNIQUE(event_id): se o INSERT passa, este processo é o dono; se estoura o UNIQUE,
    // outro já pegou (ou já processou) e a gente sai.
    //
    // Ordem importa. Antes era check-then-act: SELECT vazio → processa (com await de
    // rede ao Stripe no meio) → INSERT. Dois envios do MESMO evento (o Stripe reenvia
    // em timeout) passavam os dois pelo SELECT vazio e processavam os dois. Em
    // invoice.payment_succeeded isso é renovarAssinatura() rodando 2x → +30 dias de
    // brinde por retry. Reservar primeiro fecha a janela.
    try {
      db.prepare(
        'INSERT INTO stripe_webhooks (event_id, event_type, processed_at, manual_review) VALUES (?, ?, ?, ?)'
      ).run(event.id, event.type, Date.now(), 0);
    } catch (err) {
      // UNIQUE violado = evento já reservado/processado. Idempotência funcionando.
      if (/UNIQUE constraint/i.test(err.message)) {
        logger.warn(`[Webhook] Evento já processado (idempotência): ${event.id}`);
        return res.status(200).json({ received: true, type: event.type, duplicate: true });
      }
      throw err; // erro de banco inesperado sobe pro catch externo
    }

    // ✅ PASSO 2: Processar (só o dono da reserva chega aqui)
    try {
      await processarWebhookStripe(event);
      logger.info(`[Webhook] Evento processado com sucesso: ${event.id}`);
    } catch (err) {
      logger.error(`[Webhook] Erro ao processar evento ${event.id}: ${err.message}`);
      // A reserva já existe; MARCA pra review manual em vez de inserir de novo.
      db.prepare(
        'UPDATE stripe_webhooks SET manual_review = 1 WHERE event_id = ?'
      ).run(event.id);
      // SEMPRE 200: não deixar o Stripe retentar (a linha fica marcada pra revisão).
      return res.status(200).json({
        received: true,
        error: err.message,
        manual_review_required: true
      });
    }

    // ✅ PASSO 3: SEMPRE retornar 200
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
