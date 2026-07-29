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

    // ---- o bot atende, se for a vez dele ----
    // Responde ANTES do 200 sair? Não: o provedor precisa do 200 rápido, senão
    // reenvia. O envio vai em background e a falha dele nunca vira erro do webhook.
    res.status(200).json({ received: true, conversa_id: r.conversaId });

    if (require('../lib/conversas').botDeveResponder(tenantId, r.conversaId)) {
      responderComBot(tenantId, r.conversaId, r.texto, r.clienteId).catch((e) =>
        logger.warn('[BOT] falhou:', e.message));
    }
    return;

  } catch (err) {
    logger.error('[Webhook WhatsApp] erro:', err.stack || err.message);
    res.status(200).json({ received: true, error: err.message });
  }
});

// ============================================================
// POST/GET /api/webhooks/meta — WhatsApp Cloud E Instagram Direct
// ------------------------------------------------------------
// UM endpoint para os DOIS canais: a Meta manda tudo pela mesma Graph API, e o
// adaptador (`lerWebhook`) decide se é WhatsApp ou Instagram lendo o formato.
//
// A Meta NÃO manda token na URL como a Evolution — ela assina o corpo com o App
// Secret. Então a identificação do tenant vem de dentro do payload (o
// phone_number_id do WhatsApp, ou o id da conta do Instagram).
// ============================================================

// GET — a Meta chama uma vez pra confirmar que a URL é nossa.
router.get('/meta', (req, res) => {
  const modo = req.query['hub.mode'];
  const token = req.query['hub.verify_token'];
  const desafio = req.query['hub.challenge'];

  if (modo === 'subscribe' && token && token === process.env.META_VERIFY_TOKEN) {
    logger.info('[Webhook Meta] verificação aceita');
    return res.status(200).send(desafio);
  }
  // 403 e não 404: dizer "não existe" quando a URL existe atrapalha o diagnóstico
  // de quem está configurando.
  res.sendStatus(403);
});

router.post('/meta', async (req, res) => {
  try {
    const meta = require('../lib/whatsapp-meta');
    const whatsapp = require('../lib/whatsapp');
    const conversas = require('../lib/conversas');

    // ASSINATURA — sem isto, quem descobrir a URL injeta mensagem falsa na fila
    // da lojista. Exige o corpo CRU: JSON.stringify reordena chaves e o hash não
    // fecha (por isso o mount usa express.raw).
    const cru = Buffer.isBuffer(req.body) ? req.body : Buffer.from(JSON.stringify(req.body || {}));
    const assinatura = req.get('x-hub-signature-256');
    if (process.env.META_APP_SECRET) {
      if (!meta.assinaturaValida(cru, assinatura, process.env.META_APP_SECRET)) {
        logger.warn('[Webhook Meta] assinatura inválida');
        return res.sendStatus(401);
      }
    }

    let corpo;
    try { corpo = JSON.parse(cru.toString('utf8')); } catch (_) { return res.sendStatus(200); }

    const msg = meta.lerWebhook(corpo);
    // null = eco, status de entrega, ou evento que não é mensagem. 200 sempre:
    // a Meta reenvia o que não recebe 200, e reenviar um evento que devemos
    // ignorar viraria retry infinito.
    if (!msg) return res.sendStatus(200);

    // De QUAL loja é esta mensagem? O identificador vem do payload — não há
    // token na URL como na Evolution.
    const idConta = msg.canal === 'instagram'
      ? corpo?.entry?.[0]?.id
      : corpo?.entry?.[0]?.changes?.[0]?.value?.metadata?.phone_number_id;

    const tenantId = whatsapp.tenantDaContaMeta(idConta, msg.canal);
    if (!tenantId) {
      logger.warn(`[Webhook Meta] conta ${idConta} (${msg.canal}) não corresponde a nenhuma loja`);
      return res.sendStatus(200);
    }

    const r = conversas.receberMensagem(tenantId, msg);
    if (r.duplicada) return res.sendStatus(200);
    if (!r.ok) { logger.warn('[Webhook Meta]', r.erro); return res.sendStatus(200); }

    logger.info(`[Webhook Meta] ${msg.canal} · tenant ${tenantId} · conversa ${r.conversaId}`);
    res.sendStatus(200);

    // O bot vai DEPOIS do 200: a Meta precisa da resposta rápida ou reenvia.
    if (conversas.botDeveResponder(tenantId, r.conversaId)) {
      responderComBot(tenantId, r.conversaId, r.texto, r.clienteId).catch((e) =>
        logger.warn('[BOT] falhou:', e.message));
    }
  } catch (err) {
    logger.error('[Webhook Meta] erro:', err.stack || err.message);
    res.sendStatus(200);
  }
});

// ------------------------------------------------------------
// O bot atende — ou passa pro humano.
// ------------------------------------------------------------
// Roda DEPOIS da resposta HTTP, de propósito: o provedor precisa do 200 rápido ou
// reenvia o webhook. Nada aqui pode derrubar o recebimento da mensagem, que já
// aconteceu e já está gravado.
async function responderComBot(tenantId, conversaId, texto, clienteId) {
  const bot = require('../lib/bot');
  const conversas = require('../lib/conversas');
  const whatsapp = require('../lib/whatsapp');
  const { getConfig } = require('../db/database');

  // O INTERRUPTOR. Sem ele o bot respondia sempre, e a lojista não tinha como
  // calar. Desligado é o padrão: um robô falando com a base de todo mundo sem
  // ninguém ter pedido é o pior jeito de estrear a funcionalidade.
  if (getConfig('bot_ativo', '0', tenantId) !== '1') return;

  const d = bot.decidir(tenantId, texto, {});

  // TRANSFERIU: o bot se cala nesta conversa pra sempre. Voltar a falar depois de
  // ter chamado gente é o comportamento que faz a cliente desistir — ela já foi
  // avisada que um humano vem.
  if (d.acao === 'transferir') {
    conversas.pausarBot(tenantId, conversaId);

    // Pra QUEM: nunca comprou → Comercial 1; já comprou → Comercial 2. A regra
    // vem do MCC, e é o que faz o card cair na fila certa.
    const depto = bot.departamentoDe(tenantId, clienteId);

    db.prepare(`
      UPDATE conversas SET estagio = CASE WHEN estagio = 'novo' THEN 'falei' ELSE estagio END
       WHERE id = ? AND tenant_id = ?
    `).run(conversaId, tenantId);

    // A nota interna é a transferência QUENTE: o comercial abre o card e já lê o
    // motivo, em vez de receber um "cliente aguarda atendimento" sem contexto.
    const rotulo = {
      reclamacao: '🔴 Reclamação',
      irritada: '🔴 Cliente irritada',
      negociacao: '💬 Pediu desconto/condição',
      troca: '🔄 Troca ou devolução',
      pediu_humano: '🙋 Pediu falar com atendente',
      pedido_nao_encontrado: '❓ Código de pedido não encontrado',
      duvida_produto: '👗 Dúvida sobre peça',
      fora_do_escopo: '❓ Fora do que o atendimento automático cobre',
    }[d.motivo] || d.motivo;

    conversas.registrarNota(tenantId, {
      conversaId,
      texto: `${rotulo} — passado para ${depto === 'c1' ? 'Comercial 1 (primeira compra)' : 'Comercial 2 (já é cliente)'}`,
    });

    logger.info(`[BOT] tenant ${tenantId} · conversa ${conversaId} → ${depto} (${d.motivo})`);
  }

  // A resposta pode existir nos dois casos: mesmo transferindo, o bot avisa que
  // chamou alguém. Silêncio deixaria a cliente falando sozinha.
  let resposta = d.resposta;

  // Fora do horário, avisa quando alguém volta em vez de fingir que tem gente.
  if (d.acao === 'transferir' && !bot.dentroDoHorario(tenantId)) {
    resposta = (resposta ? resposta + '\n\n' : '') + bot.avisoForaDoHorario(tenantId);
  }
  // Sem resposta = ele calou e passou (o caso "fora do escopo"). Precisa ir pro
  // log do mesmo jeito: é justamente o silêncio dele que a lojista precisa ver,
  // pra saber o que ele ainda não cobre.
  if (!resposta) {
    registrarBotLog(tenantId, conversaId, texto, d, null, clienteId);
    return;
  }

  // O bot responde PELO MESMO canal que a cliente usou. Responder no WhatsApp
  // quem escreveu no Instagram exigiria um telefone que ela não deu.
  const conv = db.prepare('SELECT telefone, canal, external_contact_id FROM conversas WHERE id = ? AND tenant_id = ?')
    .get(conversaId, tenantId) || {};
  const destino = conv.canal === 'instagram' ? conv.external_contact_id : conv.telefone;
  const envio = await whatsapp.enviarTexto(tenantId, destino || '', resposta, conv.canal || 'whatsapp');
  if (envio.ok) {
    conversas.registrarEnviada(tenantId, { conversaId, externalId: envio.externalId, texto: resposta });
  } else {
    logger.warn('[BOT] nao consegui responder:', envio.erro);
  }

  registrarBotLog(tenantId, conversaId, texto, d, resposta, clienteId);
}

// O QUE O BOT FEZ, gravado. Sem isto a lojista só descobre o que ele falou pela
// reclamação da cliente — e não tem como saber se ele está ajudando ou atrapalhando.
// Nunca derruba o atendimento: log é registro, não parte do fluxo.
function registrarBotLog(tenantId, conversaId, entrada, decisao, resposta, clienteId) {
  try {
    const bot = require('../lib/bot');
    db.prepare(`
      INSERT INTO bot_log (tenant_id, conversa_id, entrada, acao, motivo, resposta, departamento)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(
      tenantId, conversaId,
      String(entrada || '').slice(0, 500),
      decisao.acao === 'transferir' ? 'transferiu' : 'respondeu',
      decisao.motivo || null,
      resposta ? String(resposta).slice(0, 1000) : null,
      decisao.acao === 'transferir' ? bot.departamentoDe(tenantId, clienteId) : null,
    );
  } catch (e) {
    logger.warn('[BOT] log falhou:', e.message);
  }
}

function telefoneDaConversa(tenantId, conversaId) {
  const c = db.prepare('SELECT telefone FROM conversas WHERE id = ? AND tenant_id = ?')
    .get(conversaId, tenantId);
  return c?.telefone || '';
}

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
