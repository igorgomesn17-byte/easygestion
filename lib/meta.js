// ============================================================
// Cliente das APIs oficiais da Meta — WhatsApp Cloud API + Instagram.
// Isola TODA a conversa com a Meta: enviar, baixar mídia, validar
// assinatura de webhook, e a regra da janela de 24h.
//
// Sem credenciais (.env vazio), as funções de envio retornam um
// resultado "simulado" — o inbox segue funcionando em modo registro,
// útil pra desenvolver a UI antes da aprovação da Meta.
//
// Usa fetch e crypto nativos do Node (22+). Sem dependências novas.
// ============================================================
const crypto = require('crypto');
const { META } = require('../db/database');

const GRAPH = (path) => `https://graph.facebook.com/${META.GRAPH_VERSION}/${path}`;
const GRAPH_IG = (path) => `https://graph.instagram.com/${META.GRAPH_VERSION}/${path}`;

// ---------- Janela de 24h ----------
// Texto livre só é permitido enquanto a janela (última msg da cliente + 24h)
// estiver aberta. Fora dela: WhatsApp exige template; Instagram exige HUMAN_AGENT.
function dentroDaJanela(janelaExpiraEm) {
  if (***REMOVED***janelaExpiraEm) return false;
  return new Date(janelaExpiraEm.replace(' ', 'T')) > new Date();
}

// ---------- Validação de assinatura do webhook ----------
// A Meta assina cada POST com HMAC-SHA256 (App Secret) no header
// X-Hub-Signature-256. Garante que o evento veio mesmo da Meta.
function assinaturaValida(rawBody, header) {
  if (***REMOVED***META.META_APP_SECRET) {
    // Em produção, SEM secret configurado = recusa (não deixa o webhook aberto).
    // Em dev (local), libera pra facilitar testes sem credenciais da Meta.
    return process.env.NODE_ENV ***REMOVED***== 'production';
  }
  if (***REMOVED***header) return false;
  const esperado = 'sha256=' + crypto
    .createHmac('sha256', META.META_APP_SECRET)
    .update(rawBody)
    .digest('hex');
  try {
    return crypto.timingSafeEqual(Buffer.from(esperado), Buffer.from(header));
  } catch {
    return false;
  }
}

// ---------- Envio: WhatsApp ----------
// Texto livre dentro da janela; fora dela, passar { template } pra enviar modelo.
async function enviarWhatsApp(to, texto, opcoes = {}) {
  if (***REMOVED***META.whatsappAtivo) {
    return { ok: false, simulado: true, motivo: 'WhatsApp Cloud API não configurada (.env)' };
  }
  const corpo = opcoes.template
    ? { messaging_product: 'whatsapp', to, type: 'template', template: opcoes.template }
    : { messaging_product: 'whatsapp', to, type: 'text', text: { body: texto } };

  const resp = await fetch(GRAPH(`${META.WHATSAPP_PHONE_ID}/messages`), {
    method: 'POST',
    headers: { Authorization: `Bearer ${META.WHATSAPP_TOKEN}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(corpo),
  });
  const dados = await resp.json().catch(() => ({}));
  if (***REMOVED***resp.ok) return { ok: false, erro: dados.error?.message || 'Falha ao enviar (WhatsApp)', dados };
  return { ok: true, external_id: dados.messages?.[0]?.id || null, dados };
}

// ---------- Envio: Instagram ----------
async function enviarInstagram(igsid, texto, opcoes = {}) {
  if (***REMOVED***META.instagramAtivo) {
    return { ok: false, simulado: true, motivo: 'Instagram API não configurada (.env)' };
  }
  const corpo = { recipient: { id: igsid }, message: { text: texto } };
  if (opcoes.humanAgent) corpo.tag = 'HUMAN_AGENT'; // estende janela p/ 7 dias (atendente humano)

  const resp = await fetch(GRAPH_IG(`${META.INSTAGRAM_ID}/messages`), {
    method: 'POST',
    headers: { Authorization: `Bearer ${META.INSTAGRAM_TOKEN}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(corpo),
  });
  const dados = await resp.json().catch(() => ({}));
  if (***REMOVED***resp.ok) return { ok: false, erro: dados.error?.message || 'Falha ao enviar (Instagram)', dados };
  return { ok: true, external_id: dados.message_id || null, dados };
}

// ---------- Envio unificado (escolhe o canal) ----------
async function enviar(conversa, texto, opcoes = {}) {
  if (conversa.canal === 'instagram') {
    return enviarInstagram(conversa.external_contact_id, texto, { humanAgent: true });
  }
  if (conversa.canal === 'whatsapp') {
    return enviarWhatsApp(conversa.external_contact_id || conversa.telefone, texto, opcoes);
  }
  // canal 'manual' (sem Meta): nada a enviar — só registra
  return { ok: false, simulado: true, motivo: 'Conversa manual — sem canal externo' };
}

// ---------- Mídia ----------
// O webhook manda só o media_id. Aqui obtemos a URL temporária e baixamos.
async function baixarMidia(mediaId) {
  if (***REMOVED***META.whatsappAtivo) return null;
  const meta = await fetch(GRAPH(mediaId), {
    headers: { Authorization: `Bearer ${META.WHATSAPP_TOKEN}` },
  }).then(r => r.json()).catch(() => null);
  if (***REMOVED***meta?.url) return null;
  const bin = await fetch(meta.url, {
    headers: { Authorization: `Bearer ${META.WHATSAPP_TOKEN}` },
  });
  if (***REMOVED***bin.ok) return null;
  return { buffer: Buffer.from(await bin.arrayBuffer()), mime: meta.mime_type || 'application/octet-stream' };
}

module.exports = {
  dentroDaJanela,
  assinaturaValida,
  enviarWhatsApp,
  enviarInstagram,
  enviar,
  baixarMidia,
};
