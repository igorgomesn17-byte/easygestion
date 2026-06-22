// ============================================================
// Webhooks — Receber eventos do Stripe
// POST /api/webhooks/stripe
// ============================================================
const express = require('express');
const router = express.Router();
const Stripe = require('stripe');
const { processarWebhookStripe } = require('../lib/stripe');

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY || 'sk_test_fake');
const WEBHOOK_SECRET = process.env.STRIPE_WEBHOOK_SECRET || 'whsec_test_fake';

// --- Middleware: Verificar assinatura HMAC do Stripe (deve estar ANTES do json parser) ---
// Este middleware é montado no server.js ANTES do express.json()
function verificarAssinaturaStripe(req, res, next) {
  const sig = req.headers['stripe-signature'];
  const body = req.rawBody || req.body; // req.rawBody foi definido no server.js

  try {
    const event = stripe.webhooks.constructEvent(body, sig, WEBHOOK_SECRET);
    req.stripeEvent = event;
    next();
  } catch (err) {
    console.error('[Webhook Erro] Assinatura inválida:', err.message);
    return res.status(400).json({ erro: 'Assinatura inválida' });
  }
}

// --- POST /api/webhooks/stripe ---
router.post('/stripe', verificarAssinaturaStripe, async (req, res) => {
  try {
    const event = req.stripeEvent;

    console.log(`[Webhook] Evento recebido: ${event.type} (ID: ${event.id})`);

    // Processar evento
    await processarWebhookStripe(event);

    // Confirmar ao Stripe que foi processado
    res.json({ received: true, type: event.type });
  } catch (err) {
    console.error('[Webhook] Erro ao processar evento:', err.message);
    // Stripe vai retentar se retornar status ***REMOVED***= 200
    return res.status(500).json({ erro: 'Erro ao processar webhook' });
  }
});

module.exports = router;
