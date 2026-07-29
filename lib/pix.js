// ============================================================
// PIX ONLINE (Mercado Pago) — o pedido da vitrine se cobra sozinho.
// ------------------------------------------------------------
// Isto é DIFERENTE do que lib/mercadopago.js já fazia. Lá é a maquininha Point:
// presencial, a cliente está no balcão e passa o cartão. Aqui é a cliente em casa
// olhando o catálogo: cobrança Pix com QR Code, e um webhook que avisa quando o
// dinheiro caiu. As duas usam a MESMA credencial cifrada por tenant — o lojista
// conecta uma vez e vale pros dois.
//
// Por que Pix e não cartão (decisão de 28/07): cai na hora, não tem chargeback, e
// a taxa é ~1% contra 5-20% do parcelado. Pra quem está reconstruindo capital de
// giro, receber R$ 1.000 hoje é diferente de receber R$ 83 por mês durante um ano.
//
// A REGRA QUE NÃO PODE SER QUEBRADA: o valor da cobrança vem do BANCO, somando os
// itens do pedido. Nunca do corpo da requisição. Aceitar valor do cliente é como
// deixar a cliente digitar quanto quer pagar pelo vestido.
// ============================================================
const crypto = require('crypto');
const { db } = require('../db/database');
const { credencialDe } = require('./mercadopago');

const API = 'https://api.mercadopago.com';

// Quanto tempo o QR vale. Casado com a reserva de estoque (MINUTOS_PADRAO): não
// adianta o Pix valer 24h se a peça é liberada em 45 minutos — a cliente pagaria
// por algo que já foi vendido pra outra pessoa.
const MINUTOS_EXPIRA = 45;

function exigirTenant(tenantId) {
  const t = Number(tenantId);
  if (!t) throw new Error('pix: tenantId obrigatorio');
  return t;
}

async function chamar(token, metodo, caminho, corpo = null) {
  const headers = { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' };
  // Sem chave de idempotência, um retry de rede vira DUAS cobranças pra mesma
  // cliente — e ela vê dois QR Codes sem saber qual pagar.
  if (metodo === 'POST') headers['X-Idempotency-Key'] = crypto.randomUUID();

  const r = await fetch(API + caminho, {
    method: metodo, headers, body: corpo ? JSON.stringify(corpo) : undefined,
  });
  let dados = null;
  try { dados = await r.json(); } catch (_) { /* 204 e afins */ }
  return { status: r.status, dados };
}

// ------------------------------------------------------------
// Criar a cobrança
// ------------------------------------------------------------
// O total é recalculado a partir dos ITENS, não lido de vitrine_pedidos.total:
// se algum item foi alterado depois que o pedido nasceu, a soma é a verdade.
function totalDoPedido(tenantId, pedidoId) {
  const r = db.prepare(`
    SELECT COALESCE(SUM(qtd * preco_unit), 0) AS total, COUNT(*) AS itens
      FROM vitrine_pedido_itens WHERE tenant_id = ? AND pedido_id = ?
  `).get(tenantId, pedidoId);
  return { total: Math.round(Number(r.total) * 100) / 100, itens: Number(r.itens) };
}

async function criarCobranca(tenantId, pedidoId, { email = null } = {}) {
  const t = exigirTenant(tenantId);

  const pedido = db.prepare(
    'SELECT * FROM vitrine_pedidos WHERE id = ? AND tenant_id = ?'
  ).get(pedidoId, t);
  if (!pedido) return { ok: false, erro: 'Pedido não encontrado' };
  if (pedido.status !== 'novo') return { ok: false, erro: 'Este pedido já foi finalizado' };

  const { total, itens } = totalDoPedido(t, pedidoId);
  if (!itens || total <= 0) return { ok: false, erro: 'Pedido sem itens' };

  const cred = credencialDe(t);
  if (!cred) return { ok: false, semCredencial: true, erro: 'Pagamento não configurado' };

  const expira = new Date(Date.now() + MINUTOS_EXPIRA * 60000);

  const { status, dados } = await chamar(cred.access_token, 'POST', '/v1/payments', {
    transaction_amount: total,
    payment_method_id: 'pix',
    // A descrição aparece no extrato da cliente. O código do pedido ali é o que
    // permite a ela (e à lojista) casar o pagamento com a compra depois.
    description: `Pedido ${pedido.codigo}`,
    date_of_expiration: expira.toISOString().replace(/\.\d{3}Z$/, '.000-03:00'),
    payer: {
      // O MP exige um email. Quando a cliente não deu, um placeholder derivado do
      // código do pedido é melhor que inventar um email de pessoa real.
      email: email || `pedido-${pedido.codigo.toLowerCase()}@easygestao.com.br`,
      first_name: (pedido.cliente_nome || 'Cliente').split(' ')[0].slice(0, 40),
    },
    // Volta no webhook. É por aqui que sabemos QUAL pedido de QUAL loja pagar —
    // sem isso, um pagamento que cai não tem como ser casado.
    metadata: { tenant_id: String(t), pedido_id: String(pedidoId), codigo: pedido.codigo },
    external_reference: `${t}:${pedidoId}`,
  });

  if (status >= 300 || !dados?.id) {
    return { ok: false, erro: dados?.message || `Falha ao gerar o Pix (HTTP ${status})` };
  }

  const tx = dados.point_of_interaction?.transaction_data || {};

  db.prepare(`
    UPDATE vitrine_pedidos
       SET pagamento_id = ?, pagamento_status = ?, pix_qr = ?, pix_expira_em = ?,
           atualizado_em = datetime('now','localtime')
     WHERE id = ? AND tenant_id = ?
  `).run(String(dados.id), dados.status || 'pending', tx.qr_code || null,
         expira.toISOString(), pedidoId, t);

  return {
    ok: true,
    pagamento_id: String(dados.id),
    // `qr_code` é o copia-e-cola (texto); `qr_code_base64` é a imagem. A tela usa
    // os dois: imagem pra quem escaneia de outro aparelho, texto pra quem está no
    // celular e vai colar no app do banco.
    copia_cola: tx.qr_code || null,
    qr_base64: tx.qr_code_base64 || null,
    total,
    expira_em: expira.toISOString(),
  };
}

// Consulta direta — usada pelo "já paguei" da tela. O webhook é o caminho normal;
// isto é a rede de segurança pra quando ele atrasa ou se perde.
async function consultarPagamento(tenantId, pagamentoId) {
  const t = exigirTenant(tenantId);
  const cred = credencialDe(t);
  if (!cred) return { ok: false, erro: 'Pagamento não configurado' };

  const { status, dados } = await chamar(cred.access_token, 'GET', `/v1/payments/${pagamentoId}`);
  if (status >= 300 || !dados) return { ok: false, erro: `HTTP ${status}` };

  return {
    ok: true,
    id: String(dados.id),
    status: dados.status,                      // pending | approved | rejected | cancelled
    aprovado: dados.status === 'approved',
    valor: dados.transaction_amount,
    tenant_id: Number(dados.metadata?.tenant_id) || null,
    pedido_id: Number(dados.metadata?.pedido_id) || null,
  };
}

// ------------------------------------------------------------
// Idempotência do webhook
// ------------------------------------------------------------
// RESERVA o evento ANTES de processar: o UNIQUE(provedor, event_id) é o próprio
// lock. Se o INSERT passa, este processo é o dono; se estoura, outro já pegou.
//
// Isto não é zelo excessivo — é a lição que o webhook do Stripe já ensinou neste
// projeto: um retry dava +30 dias de assinatura grátis. Aqui daria baixa dobrada
// no estoque e venda duplicada no caixa.
function reservarEvento(eventId, tenantId = null, provedor = 'mercadopago') {
  if (!eventId) return false;
  try {
    const r = db.prepare(
      'INSERT OR IGNORE INTO pagamento_eventos (provedor, event_id, tenant_id) VALUES (?, ?, ?)'
    ).run(provedor, String(eventId), tenantId);
    return r.changes === 1;
  } catch (_) {
    return false;
  }
}

module.exports = {
  MINUTOS_EXPIRA,
  criarCobranca, consultarPagamento, reservarEvento, totalDoPedido,
};
