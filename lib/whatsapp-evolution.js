// ============================================================
// ADAPTADOR — Evolution API (WhatsApp NAO-OFICIAL).
// ------------------------------------------------------------
// Este e' o unico arquivo do sistema que conhece o formato da Evolution. Todo o
// resto fala com lib/whatsapp.js. Trocar de provedor = escrever um irmao deste
// arquivo e mudar uma linha no mapa ADAPTADORES.
//
// ⚠️ NAO-OFICIAL, e o dono sabe disso. A Evolution conecta um WhatsApp comum via
// WhatsApp Web. A Meta pode banir o NUMERO — e se cair, cai o canal com a base
// inteira de clientes, justo quando o volume estiver alto. Decisao consciente:
// o dono vai avisar e orientar o uso. As defesas que dependem de codigo estao aqui:
//
//   - PAUSA entre mensagens: disparo em rajada e' o padrao que a deteccao procura.
//   - Timeout: instancia caida nao pode segurar a tela da lojista.
//   - Erro nunca sobe: falha de envio nao pode desfazer a venda que ja aconteceu.
//
// Doc: https://doc.evolution-api.com/
// ============================================================
// SEM require de ./whatsapp aqui, de proposito: whatsapp.js requer ESTE arquivo pra
// montar o mapa de adaptadores. Requerer de volta cria ciclo, e o Node entrega um
// module.exports pela metade — a funcao viria `undefined` e so quebraria no primeiro
// envio REAL, em producao, que e' o pior lugar pra descobrir. O timeout mora aqui.
const TIMEOUT_MS = 15000;

async function fetchComTimeout(url, opcoes = {}, ms = TIMEOUT_MS) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), ms);
  try {
    return await fetch(url, { ...opcoes, signal: ctrl.signal });
  } finally {
    clearTimeout(t);
  }
}

// A Evolution nao tem rate limit proprio: ela manda tudo que mandarem. Sem pausa,
// 40 mensagens da regua saem em 2 segundos — que e' exatamente o comportamento que
// derruba numero nao-oficial. 1,2s entre envios do MESMO tenant.
const PAUSA_MS = 1200;
const ultimoEnvio = new Map();   // tenantId -> timestamp

function dormir(ms) { return new Promise((r) => setTimeout(r, ms)); }

async function respeitarPausa(tenantId) {
  const anterior = ultimoEnvio.get(tenantId) || 0;
  const espera = PAUSA_MS - (Date.now() - anterior);
  if (espera > 0) await dormir(espera);
  ultimoEnvio.set(tenantId, Date.now());
}

// A Evolution monta a URL como {base}/{recurso}/{instancia}. Barra dobrada ou
// faltando da 404 silencioso — normaliza uma vez, aqui.
function urlDe(cred, recurso) {
  const base = String(cred.base_url || '').replace(/\/+$/, '');
  const inst = encodeURIComponent(cred.instancia || '');
  return `${base}/${recurso}/${inst}`;
}

function cabecalhos(cred) {
  return { 'Content-Type': 'application/json', apikey: cred.token };
}

// O id da mensagem na Evolution vem em key.id — e' o WAMID, que e' o que usamos
// pra dedup do webhook (mensagens.external_id e' UNIQUE). Sem ele, um retry do
// provedor gravaria a mesma mensagem duas vezes na conversa.
function idDaResposta(dados) {
  return dados?.key?.id || dados?.messageId || dados?.id || null;
}

async function enviarTexto(cred, telefone, texto) {
  await respeitarPausa(cred.tenant_id);

  const r = await fetchComTimeout(urlDe(cred, 'message/sendText'), {
    method: 'POST',
    headers: cabecalhos(cred),
    body: JSON.stringify({
      number: telefone,
      text: texto,
      // delay: a Evolution simula "digitando" antes de entregar. Mensagem que
      // aparece instantaneamente em resposta a outra denuncia automacao.
      delay: 800,
    }),
  });

  let dados = null;
  try { dados = await r.json(); } catch (_) { /* corpo vazio ou HTML de erro */ }

  if (!r.ok) {
    return { ok: false, erro: dados?.message || dados?.error || `HTTP ${r.status}` };
  }
  return { ok: true, externalId: idDaResposta(dados) };
}

async function enviarMidia(cred, telefone, url, legenda = '') {
  await respeitarPausa(cred.tenant_id);

  const r = await fetchComTimeout(urlDe(cred, 'message/sendMedia'), {
    method: 'POST',
    headers: cabecalhos(cred),
    body: JSON.stringify({
      number: telefone,
      mediatype: 'image',
      media: url,
      caption: legenda || undefined,
      delay: 800,
    }),
  });

  let dados = null;
  try { dados = await r.json(); } catch (_) { /* idem */ }

  if (!r.ok) return { ok: false, erro: dados?.message || dados?.error || `HTTP ${r.status}` };
  return { ok: true, externalId: idDaResposta(dados) };
}

// A instancia esta conectada? Serve pra tela de configuracao mostrar o estado real
// em vez de deixar a lojista descobrir que caiu quando a mensagem nao chega.
async function estado(cred) {
  try {
    const r = await fetchComTimeout(urlDe(cred, 'instance/connectionState'), { headers: cabecalhos(cred) });
    const dados = await r.json();
    const s = dados?.instance?.state || dados?.state || 'desconhecido';
    return { ok: r.ok, conectado: s === 'open', estado: s };
  } catch (err) {
    return { ok: false, conectado: false, estado: 'inacessivel', erro: err.message };
  }
}

// ------------------------------------------------------------
// Leitura do webhook
// ------------------------------------------------------------
// Traduz o payload da Evolution pro formato neutro que o resto do sistema entende.
// Mantido AQUI, junto do envio, porque e' conhecimento do mesmo provedor: quando
// outro adaptador existir, ele traz a sua propria versao disto.
//
// Devolve null pro que nao deve virar conversa: mensagem que NOS enviamos (voltando
// como eco), status de entrega, e evento que nao e' mensagem.
function lerWebhook(corpo) {
  const evento = corpo?.event || corpo?.type;
  if (evento && !String(evento).toLowerCase().includes('messages.upsert')) return null;

  const d = corpo?.data || corpo;
  const key = d?.key;
  if (!key?.id) return null;

  // fromMe = eco da nossa propria mensagem. Gravar isso duplicaria o que ja
  // gravamos no envio, e ainda apareceria como se a cliente tivesse escrito.
  if (key.fromMe) return null;

  const remoteJid = String(key.remoteJid || '');
  // Grupo (@g.us) nao e' atendimento — e' conversa de grupo onde a loja foi
  // adicionada. Entrar na fila do comercial poluiria o dia dele.
  if (remoteJid.includes('@g.us')) return null;

  const telefone = remoteJid.split('@')[0];
  if (!telefone) return null;

  const m = d?.message || {};
  const texto =
    m.conversation ||
    m.extendedTextMessage?.text ||
    m.imageMessage?.caption ||
    m.videoMessage?.caption ||
    '';

  let tipo = 'text';
  if (m.imageMessage) tipo = 'image';
  else if (m.audioMessage) tipo = 'audio';
  else if (m.videoMessage) tipo = 'video';
  else if (m.documentMessage) tipo = 'document';

  return {
    externalId: key.id,
    telefone,
    nome: d?.pushName || null,      // como ela se chama no WhatsApp
    texto: texto || null,
    tipo,
    // Audio e foto sem legenda chegam com texto vazio. Precisa aparecer na tela
    // como "[audio]" — senao o comercial ve um card em branco e ignora.
    temMidia: tipo !== 'text',
  };
}

module.exports = { enviarTexto, enviarMidia, estado, lerWebhook };
