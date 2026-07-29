// ============================================================
// META — WhatsApp Cloud API e Instagram Direct pela MESMA porta.
// ------------------------------------------------------------
// Adaptador irmão do `whatsapp-evolution.js`: mesma interface, provedor
// diferente. Era exatamente pra isto que o envio foi isolado atrás de
// `lib/whatsapp.js` — o CRM, a régua, o bot e as telas não mudam uma linha.
//
// POR QUE A OFICIAL, e não a Evolution self-hosted (decisão de 29/07/2026):
// cada instância da Evolution come 300-500MB de RAM, mesmo com a loja parada.
// Com um cliente por instância, isso vira custo fixo de servidor por cliente —
// e vários números no mesmo IP fazem um banimento derrubar TODOS ao mesmo tempo.
// Na oficial, cada lojista usa a conta dela: custo zero de infra, número que não
// cai, e o risco de IP compartilhado deixa de existir.
//
// OS DOIS CANAIS, UMA INTEGRAÇÃO: WhatsApp Cloud e Instagram Direct rodam na
// mesma Graph API — mesma autorização, mesmo webhook, mesmo formato. Não são
// duas integrações; é uma, com dois canais.
//
// A DIFERENÇA QUE IMPORTA: no Instagram NÃO se pode iniciar conversa, só
// responder quem escreveu (e dentro de 7 dias). Por isso a régua e o clube
// continuam sendo WhatsApp; o Instagram serve pra atender quem chega — que é o
// trabalho do Comercial 1.
// ============================================================
const crypto = require('crypto');

const API = 'https://graph.facebook.com';
const VERSAO = process.env.META_API_VERSAO || 'v21.0';
const TIMEOUT_MS = 20000;

async function fetchComTimeout(url, opcoes = {}, ms = TIMEOUT_MS) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), ms);
  try {
    return await fetch(url, { ...opcoes, signal: ctrl.signal });
  } finally {
    clearTimeout(t);
  }
}

function cabecalhos(cred) {
  return { 'Content-Type': 'application/json', Authorization: `Bearer ${cred.token}` };
}

// A Meta devolve erro em `error.message` com um `error_user_msg` mais legível
// quando existe. Preferir o segundo: "o número não tem WhatsApp" ajuda a lojista;
// "(#131030) Recipient phone number not in allowed list" não ajuda ninguém.
function erroDe(dados, status) {
  const e = dados?.error;
  return e?.error_user_msg || e?.message || `HTTP ${status}`;
}

// ------------------------------------------------------------
// WhatsApp Cloud API
// ------------------------------------------------------------
// `instancia` guarda o PHONE_NUMBER_ID (não o telefone): é o identificador que a
// Meta usa pra dizer de qual número a mensagem sai.
async function enviarTextoWhats(cred, telefone, texto) {
  const url = `${API}/${VERSAO}/${encodeURIComponent(cred.instancia)}/messages`;
  const r = await fetchComTimeout(url, {
    method: 'POST',
    headers: cabecalhos(cred),
    body: JSON.stringify({
      messaging_product: 'whatsapp',
      recipient_type: 'individual',
      to: String(telefone).replace(/\D/g, ''),
      type: 'text',
      // `preview_url: false` de propósito: link que vira card grande empurra o
      // resto da mensagem pra fora da tela no celular.
      text: { preview_url: false, body: String(texto).slice(0, 4096) },
    }),
  });

  const dados = await r.json().catch(() => ({}));
  if (!r.ok) return { ok: false, erro: erroDe(dados, r.status) };
  return { ok: true, externalId: dados?.messages?.[0]?.id || null };
}

async function enviarMidiaWhats(cred, telefone, url, legenda = '') {
  const alvo = `${API}/${VERSAO}/${encodeURIComponent(cred.instancia)}/messages`;
  const r = await fetchComTimeout(alvo, {
    method: 'POST',
    headers: cabecalhos(cred),
    body: JSON.stringify({
      messaging_product: 'whatsapp',
      to: String(telefone).replace(/\D/g, ''),
      type: 'image',
      image: { link: url, caption: String(legenda || '').slice(0, 1024) },
    }),
  });
  const dados = await r.json().catch(() => ({}));
  if (!r.ok) return { ok: false, erro: erroDe(dados, r.status) };
  return { ok: true, externalId: dados?.messages?.[0]?.id || null };
}

// ------------------------------------------------------------
// Instagram Direct
// ------------------------------------------------------------
// Endpoint diferente (`/me/messages` na conta do IG), destinatário por IGSID em
// vez de telefone. Só isso — o resto é igual.
async function enviarTextoInsta(cred, igsid, texto) {
  const url = `${API}/${VERSAO}/${encodeURIComponent(cred.instancia_ig || 'me')}/messages`;
  const r = await fetchComTimeout(url, {
    method: 'POST',
    headers: cabecalhos(cred),
    body: JSON.stringify({
      recipient: { id: String(igsid) },
      message: { text: String(texto).slice(0, 1000) },
    }),
  });
  const dados = await r.json().catch(() => ({}));
  if (!r.ok) return { ok: false, erro: erroDe(dados, r.status) };
  return { ok: true, externalId: dados?.message_id || null };
}

// Fachada: o resto do sistema chama `enviarTexto` sem saber de qual canal se
// trata. Quem decide é a conversa — WhatsApp usa telefone, Instagram usa IGSID.
async function enviarTexto(cred, destino, texto, canal = 'whatsapp') {
  return canal === 'instagram'
    ? enviarTextoInsta(cred, destino, texto)
    : enviarTextoWhats(cred, destino, texto);
}

async function enviarMidia(cred, destino, url, legenda = '', canal = 'whatsapp') {
  if (canal === 'instagram') {
    const alvo = `${API}/${VERSAO}/${encodeURIComponent(cred.instancia_ig || 'me')}/messages`;
    const r = await fetchComTimeout(alvo, {
      method: 'POST', headers: cabecalhos(cred),
      body: JSON.stringify({
        recipient: { id: String(destino) },
        message: { attachment: { type: 'image', payload: { url } } },
      }),
    });
    const dados = await r.json().catch(() => ({}));
    return r.ok ? { ok: true, externalId: dados?.message_id || null } : { ok: false, erro: erroDe(dados, r.status) };
  }
  return enviarMidiaWhats(cred, destino, url, legenda);
}

// ------------------------------------------------------------
// Estado da conexão
// ------------------------------------------------------------
// Na oficial não existe "instância caiu" como na Evolution: se o token vale, o
// número está no ar. O que pode dar errado é o token expirar ou a Meta suspender
// a conta — e as duas coisas aparecem como falha nesta chamada.
async function estado(cred) {
  try {
    const r = await fetchComTimeout(
      `${API}/${VERSAO}/${encodeURIComponent(cred.instancia)}?fields=display_phone_number,verified_name,quality_rating`,
      { headers: cabecalhos(cred) },
    );
    const dados = await r.json().catch(() => ({}));
    if (!r.ok) return { ok: false, conectado: false, estado: 'token_invalido', erro: erroDe(dados, r.status) };
    return {
      ok: true, conectado: true, estado: 'open',
      numero: dados?.display_phone_number || null,
      nome: dados?.verified_name || null,
      // A Meta rebaixa a qualidade quando muita gente bloqueia ou denuncia. É o
      // alerta antecipado de que a régua está incomodando — vale mostrar.
      qualidade: dados?.quality_rating || null,
    };
  } catch (err) {
    return { ok: false, conectado: false, estado: 'inacessivel', erro: err.message };
  }
}

// ------------------------------------------------------------
// Webhook — traduz os DOIS canais pro formato neutro
// ------------------------------------------------------------
// Devolve null pro que não deve virar conversa: eco da nossa própria mensagem,
// status de entrega (sent/delivered/read) e evento que não é mensagem.
function lerWebhook(corpo) {
  const entry = corpo?.entry?.[0];
  if (!entry) return null;

  // ---- WhatsApp ----
  const mudanca = entry.changes?.[0];
  if (mudanca?.field === 'messages') {
    const valor = mudanca.value || {};
    // `statuses` é confirmação de entrega da NOSSA mensagem, não mensagem nova.
    // Tratar como nova criaria uma conversa fantasma a cada entrega.
    if (valor.statuses) return null;

    const msg = valor.messages?.[0];
    if (!msg) return null;
    if (msg.from === valor.metadata?.display_phone_number) return null;   // eco

    const contato = valor.contacts?.[0];
    return {
      canal: 'whatsapp',
      externalId: msg.id,
      telefone: msg.from,
      externalContactId: msg.from,
      nome: contato?.profile?.name || null,
      texto: textoDaMensagem(msg),
      tipo: msg.type || 'text',
    };
  }

  // ---- Instagram ----
  // Vem em `messaging`, não em `changes`. E a identidade é o IGSID: quem escreve
  // pelo Instagram NÃO tem telefone — casar com o cadastro dela depende de
  // alguém reconhecer que é a mesma pessoa.
  const m = entry.messaging?.[0];
  if (m?.message) {
    if (m.message.is_echo) return null;   // mensagem que NÓS mandamos, voltando
    return {
      canal: 'instagram',
      externalId: m.message.mid,
      telefone: null,
      externalContactId: m.sender?.id || null,
      nome: null,   // o nome vem por outra chamada; a conversa nasce sem ele
      texto: m.message.text || (m.message.attachments ? '[mídia]' : ''),
      tipo: m.message.attachments ? 'image' : 'text',
    };
  }

  return null;
}

function textoDaMensagem(msg) {
  if (msg.text) return msg.text.body || '';
  // Botão e lista de opções: o que a cliente escolheu É a resposta dela.
  if (msg.interactive) {
    return msg.interactive.button_reply?.title || msg.interactive.list_reply?.title || '[opção]';
  }
  if (msg.button) return msg.button.text || '[botão]';
  const rotulo = { image: '[foto]', audio: '[áudio]', video: '[vídeo]', document: '[documento]',
                   sticker: '[figurinha]', location: '[localização]', contacts: '[contato]' };
  return rotulo[msg.type] || `[${msg.type}]`;
}

// ------------------------------------------------------------
// Assinatura do webhook
// ------------------------------------------------------------
// A Meta assina o corpo com o App Secret. Sem verificar, qualquer um que
// descubra a URL pode injetar mensagem falsa na fila da lojista.
//
// Exige o corpo CRU: `JSON.stringify(req.body)` reordena chaves e muda espaços,
// e o hash não fecha. É por isso que a rota precisa de `express.raw`.
function assinaturaValida(bodyCru, assinatura, appSecret) {
  if (!appSecret || !assinatura || !bodyCru) return false;
  const esperado = 'sha256=' + crypto.createHmac('sha256', appSecret).update(bodyCru).digest('hex');
  try {
    return crypto.timingSafeEqual(Buffer.from(esperado), Buffer.from(String(assinatura)));
  } catch (_) {
    return false;   // tamanhos diferentes
  }
}

// ------------------------------------------------------------
// Embedded Signup — a lojista autoriza dentro do fluxo da Meta
// ------------------------------------------------------------
// Troca o código que volta do fluxo por um token de longa duração. É o que
// dispensa a lojista de entender token, webhook ou painel de developer.
async function trocarCodigoPorToken(codigo, appId, appSecret) {
  const url = `${API}/${VERSAO}/oauth/access_token`
    + `?client_id=${encodeURIComponent(appId)}`
    + `&client_secret=${encodeURIComponent(appSecret)}`
    + `&code=${encodeURIComponent(codigo)}`;
  const r = await fetchComTimeout(url);
  const dados = await r.json().catch(() => ({}));
  if (!r.ok || !dados.access_token) return { ok: false, erro: erroDe(dados, r.status) };
  return { ok: true, token: dados.access_token };
}

// Descobre os IDs da conta dela: WABA, número do WhatsApp e conta do Instagram.
// Sem isso o Easy tem o token mas não sabe por qual número enviar.
async function descobrirContas(token) {
  const cred = { token };
  const res = { waba: null, phoneNumberId: null, numero: null, instagramId: null };

  try {
    const r = await fetchComTimeout(`${API}/${VERSAO}/me/businesses?fields=id,name`, { headers: cabecalhos(cred) });
    const negocios = (await r.json().catch(() => ({})))?.data || [];
    if (!negocios.length) return { ok: false, erro: 'Nenhuma conta de negócio encontrada' };

    for (const neg of negocios) {
      const rw = await fetchComTimeout(
        `${API}/${VERSAO}/${neg.id}/owned_whatsapp_business_accounts?fields=id,name`,
        { headers: cabecalhos(cred) },
      );
      const wabas = (await rw.json().catch(() => ({})))?.data || [];
      if (wabas.length) {
        res.waba = wabas[0].id;
        const rp = await fetchComTimeout(
          `${API}/${VERSAO}/${res.waba}/phone_numbers?fields=id,display_phone_number,verified_name`,
          { headers: cabecalhos(cred) },
        );
        const nums = (await rp.json().catch(() => ({})))?.data || [];
        if (nums.length) {
          res.phoneNumberId = nums[0].id;
          res.numero = nums[0].display_phone_number;
        }
        break;
      }
    }
  } catch (err) {
    return { ok: false, erro: err.message };
  }

  // Instagram é OPCIONAL: quem não conectou o IG continua com o WhatsApp
  // funcionando. Falhar aqui não pode derrubar a conexão inteira.
  try {
    const r = await fetchComTimeout(
      `${API}/${VERSAO}/me/accounts?fields=instagram_business_account{id,username}`,
      { headers: cabecalhos(cred) },
    );
    const paginas = (await r.json().catch(() => ({})))?.data || [];
    const comIg = paginas.find((p) => p.instagram_business_account?.id);
    if (comIg) res.instagramId = comIg.instagram_business_account.id;
  } catch (_) { /* segue sem Instagram */ }

  if (!res.phoneNumberId) return { ok: false, erro: 'Nenhum número de WhatsApp encontrado nessa conta' };
  return { ok: true, ...res };
}

// Registra o webhook do Easy na WABA dela. Sem isto ela consegue ENVIAR mas o
// que a cliente responde não chega — o mesmo furo que a Evolution tinha.
async function assinarWebhook(token, wabaId) {
  try {
    const r = await fetchComTimeout(
      `${API}/${VERSAO}/${wabaId}/subscribed_apps`,
      { method: 'POST', headers: cabecalhos({ token }) },
    );
    const dados = await r.json().catch(() => ({}));
    return r.ok ? { ok: true } : { ok: false, erro: erroDe(dados, r.status) };
  } catch (err) {
    return { ok: false, erro: err.message };
  }
}

module.exports = {
  enviarTexto, enviarMidia, estado, lerWebhook, assinaturaValida,
  trocarCodigoPorToken, descobrirContas, assinarWebhook,
  VERSAO,
};
