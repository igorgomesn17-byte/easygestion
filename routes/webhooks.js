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

// ============================================================
// POST /api/webhooks/whatsapp/:token — mensagem que CHEGOU.
// ------------------------------------------------------------
// A porta de entrada do Comercial 1. Quem vê o anúncio e escreve chega por aqui —
// e é o contato mais caro que a loja tem, porque foi pago pra existir. Se cair no
// vazio, o dinheiro do anúncio virou nada.
//
// O token vai na URL, e não num header, porque é a Evolution quem monta a chamada:
// ela permite configurar a URL do webhook por instância, mas não headers. Cada loja
// tem o seu (gerado em salvarCredencial), e é ele que diz de QUAL tenant é a
// mensagem — sem ele, uma mensagem cairia na loja errada.
//
// SEMPRE 200. Provedor que recebe erro reenvia em loop; e o que não deu certo aqui
// não vai dar certo na terceira tentativa — vira log, não retry infinito.
// ============================================================
router.post('/whatsapp/:token', (req, res) => {
  try {
    const { tenantDoWebhookToken, credencialDe } = require('../lib/whatsapp');
    const { receberMensagem } = require('../lib/conversas');

    const tenantId = tenantDoWebhookToken(req.params.token);
    if (!tenantId) {
      // 404 e não 403: um token inválido não deve revelar que a rota existe nem
      // que outras lojas têm canal. Mesma postura das rotas exclusivas da vitrine.
      logger.warn('[Webhook WhatsApp] token desconhecido');
      return res.status(404).json({ erro: 'Nao encontrado' });
    }

    const cred = credencialDe(tenantId);
    if (!cred) return res.status(200).json({ received: true, ignorado: 'sem canal' });

    // Cada provedor tem seu próprio formato — o adaptador traduz pro neutro.
    // Devolve null pro que não deve virar conversa: eco da nossa própria mensagem,
    // status de entrega, evento de grupo.
    const adaptador = require('../lib/whatsapp-evolution');
    const msg = adaptador.lerWebhook(req.body);
    if (!msg) return res.status(200).json({ received: true, ignorado: true });

    const r = receberMensagem(tenantId, msg);

    if (r.duplicada) {
      // O provedor reenvia quando não recebe 200 rápido. Não é erro — é o normal.
      return res.status(200).json({ received: true, duplicada: true });
    }
    if (!r.ok) {
      logger.warn('[Webhook WhatsApp] nao processou:', r.erro);
      return res.status(200).json({ received: true, erro: r.erro });
    }

    logger.info(`[Webhook WhatsApp] tenant ${tenantId} · conversa ${r.conversaId}${r.nova ? ' (NOVA)' : ''}`);
    res.status(200).json({ received: true, conversa_id: r.conversaId });

  } catch (err) {
    logger.error('[Webhook WhatsApp] erro:', err.stack || err.message);
    res.status(200).json({ received: true, error: err.message });
  }
});

// ============================================================
// POST /api/webhooks/mercadopago — o Pix caiu.
// ------------------------------------------------------------
// Este é o momento em que o pedido da vitrine vira venda: estoque baixa, o dinheiro
// entra no caixa e no DRE, e a compra passa a existir pro CRM. Sem ele, a lojista
// teria que digitar tudo de novo no PDV.
//
// SEMPRE 200, mesmo em erro: o Mercado Pago reenvia até receber 200, e um erro que
// não vai se resolver sozinho viraria retry infinito. O que falha aqui vira log.
// ============================================================
router.post('/mercadopago', async (req, res) => {
  try {
    const pix = require('../lib/pix');
    const pedidoVenda = require('../lib/pedido-venda');

    // O MP manda o id do pagamento em lugares diferentes conforme o tipo de
    // notificação (IPN antigo × webhook novo). Aceita os dois.
    const pagamentoId = req.body?.data?.id || req.query['data.id'] || req.body?.id;
    const tipo = req.body?.type || req.query.type || '';
    if (!pagamentoId) return res.status(200).json({ received: true, ignorado: 'sem id' });
    // Só interessa pagamento. `merchant_order` e afins chegam pelo mesmo endpoint.
    if (tipo && tipo !== 'payment') return res.status(200).json({ received: true, ignorado: tipo });

    // Acha o pedido pelo id do pagamento — é o que diz de QUAL loja é a notificação.
    // Sem isso não dá pra saber qual credencial usar pra consultar o MP.
    const pedido = db.prepare(
      'SELECT id, tenant_id, codigo, venda_id FROM vitrine_pedidos WHERE pagamento_id = ?'
    ).get(String(pagamentoId));

    if (!pedido) {
      // Pode ser cobrança de outro sistema na mesma conta MP, ou o webhook chegando
      // antes de a nossa gravação terminar. Não é erro nosso.
      logger.info(`[Webhook MP] pagamento ${pagamentoId} não corresponde a nenhum pedido`);
      return res.status(200).json({ received: true, ignorado: 'pedido nao encontrado' });
    }

    if (pedido.venda_id) return res.status(200).json({ received: true, jaProcessado: true });

    // IDEMPOTÊNCIA ANTES DE PROCESSAR: o UNIQUE é o lock. Se o INSERT não passa,
    // outro processo já pegou este evento — e processar de novo daria baixa dobrada
    // no estoque e venda duplicada no caixa. Mesma lição do webhook do Stripe.
    const eventoId = `${pagamentoId}:${req.body?.action || tipo || 'payment'}`;
    if (!pix.reservarEvento(eventoId, pedido.tenant_id)) {
      return res.status(200).json({ received: true, duplicado: true });
    }

    // Consulta o MP em vez de confiar no corpo: o webhook diz "algo mudou", não
    // "está pago". Aceitar o status do corpo permitiria a qualquer um postar aqui
    // dizendo que pagou.
    const p = await pix.consultarPagamento(pedido.tenant_id, pagamentoId);
    if (!p.ok) {
      logger.warn(`[Webhook MP] não consegui consultar ${pagamentoId}: ${p.erro}`);
      return res.status(200).json({ received: true, erro: p.erro });
    }

    db.prepare('UPDATE vitrine_pedidos SET pagamento_status = ? WHERE id = ?').run(p.status, pedido.id);

    if (!p.aprovado) {
      // Recusado ou expirado: solta a peça na hora, senão ela fica presa até o
      // prazo da reserva vencer por conta própria.
      if (p.status === 'rejected' || p.status === 'cancelled') {
        require('../lib/reserva').liberar(pedido.tenant_id, pedido.id);
      }
      return res.status(200).json({ received: true, status: p.status });
    }

    const r = pedidoVenda.converter(pedido.tenant_id, pedido.id, { forma: 'pix', origem: 'vitrine' });
    if (!r.ok) {
      // O caso mais provável é a peça ter sido vendida no balcão enquanto o Pix
      // estava aberto. O dinheiro ENTROU — isso precisa de olho humano, não de
      // retry: a lojista resolve na conversa (troca ou devolve).
      logger.error(`[Webhook MP] pedido ${pedido.codigo} pago mas NÃO virou venda: ${r.erro}`);
      return res.status(200).json({ received: true, erro: r.erro, revisar: true });
    }

    logger.info(`[Webhook MP] pedido ${pedido.codigo} pago → venda ${r.vendaId}`);
    res.status(200).json({ received: true, venda_id: r.vendaId });

  } catch (err) {
    logger.error('[Webhook MP] erro:', err.stack || err.message);
    res.status(200).json({ received: true, error: err.message });
  }
});

module.exports = router;
