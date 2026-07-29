// ============================================================
// CANAL DE MENSAGEM — a fachada que o CRM enxerga.
// ------------------------------------------------------------
// Todo o resto do sistema (regua, bot, painel de conversas) fala com ESTE arquivo
// e nunca com o provedor. O motivo nao e' purismo de arquitetura: e' que o canal
// escolhido hoje — Evolution API, nao-oficial — pode cair. O numero pode ser banido
// pela Meta, ou a biblioteca pode parar de funcionar quando o WhatsApp Web muda.
// Quando isso acontecer, trocar de provedor tem que ser escrever um adaptador novo,
// nao reescrever o CRM inteiro.
//
// O risco do provedor nao-oficial e' uma decisao consciente do dono (avisar e
// orientar o uso). Este arquivo existe pra que essa decisao seja REVERSIVEL.
//
// Contrato — as tres coisas que o CRM precisa:
//   enviarTexto(tenantId, telefone, texto) -> { ok, externalId, erro }
//   enviarMidia(tenantId, telefone, url, legenda) -> { ok, externalId, erro }
//   normalizarTelefone(t) -> so digitos, com 55, sem o 9 duplicado
//
// O que este arquivo NAO faz de proposito: decidir O QUE mandar (isso e' da regua),
// gravar a mensagem (isso e' de quem chama, dentro da transacao dele) e entender
// webhook de entrada (isso e' de routes/webhooks.js).
// ============================================================
const crypto = require('crypto');
const { db } = require('../db/database');

const CERT_CIPHER = process.env.CERT_CIPHER_KEY || '';

// ------------------------------------------------------------
// Credencial (cifrada, por tenant) — mesmo padrao de lib/mercadopago.js
// ------------------------------------------------------------
function chaveAes() {
  if (!CERT_CIPHER) throw new Error('CERT_CIPHER_KEY nao configurada — sem ela o token do canal ficaria em texto puro');
  return Buffer.from(CERT_CIPHER.padEnd(32, '0').slice(0, 32));
}

function cifrar(texto) {
  const iv = crypto.randomBytes(16);
  const c = crypto.createCipheriv('aes-256-cbc', chaveAes(), iv);
  return Buffer.concat([iv, c.update(String(texto), 'utf8'), c.final()]).toString('base64');
}

function decifrar(b64) {
  const buf = Buffer.from(b64, 'base64');
  const d = crypto.createDecipheriv('aes-256-cbc', chaveAes(), buf.subarray(0, 16));
  return Buffer.concat([d.update(buf.subarray(16)), d.final()]).toString('utf8');
}

// A credencial da loja. null = ela ainda nao conectou nenhum canal.
function credencialDe(tenantId) {
  if (!tenantId) throw new Error('credencialDe: tenantId obrigatorio');
  const r = db.prepare(
    `SELECT * FROM integracoes_canal WHERE tenant_id = ? AND ativo = 1 ORDER BY id LIMIT 1`
  ).get(tenantId);
  if (!r) return null;
  return { ...r, token: decifrar(r.token) };
}

function salvarCredencial(tenantId, { provedor = 'evolution', base_url, instancia, token, numero = null }) {
  if (!tenantId) throw new Error('salvarCredencial: tenantId obrigatorio');
  if (!token) throw new Error('salvarCredencial: token obrigatorio');
  // O webhook_token nasce aqui e nao e' pedido ao usuario: e' ele que prova que quem
  // chamou /api/webhooks/whatsapp foi mesmo o provedor desta loja. Gerado, nunca digitado.
  const webhookToken = crypto.randomBytes(24).toString('hex');
  db.prepare(`
    INSERT INTO integracoes_canal (tenant_id, provedor, base_url, instancia, token, numero, webhook_token, ativo, atualizado_em)
    VALUES (?, ?, ?, ?, ?, ?, ?, 1, datetime('now','localtime'))
    ON CONFLICT(tenant_id, provedor) DO UPDATE SET
      base_url      = excluded.base_url,
      instancia     = excluded.instancia,
      token         = excluded.token,
      numero        = COALESCE(excluded.numero, integracoes_canal.numero),
      ativo         = 1,
      atualizado_em = datetime('now','localtime')
  `).run(tenantId, provedor, base_url || null, instancia || null, cifrar(token), soDigitos(numero) || null, webhookToken);
  return webhookToken;
}

function desconectar(tenantId, provedor = 'evolution') {
  db.prepare(`DELETE FROM integracoes_canal WHERE tenant_id = ? AND provedor = ?`).run(tenantId, provedor);
}

// Quem chamou o webhook e' mesmo o provedor desta loja? Comparacao em tempo
// constante — comparar segredo com === vaza o tamanho do prefixo correto.
function tenantDoWebhookToken(token) {
  if (!token) return null;
  const linhas = db.prepare(`SELECT tenant_id, webhook_token FROM integracoes_canal WHERE ativo = 1`).all();
  const alvo = Buffer.from(String(token));
  for (const l of linhas) {
    if (!l.webhook_token) continue;
    const cand = Buffer.from(l.webhook_token);
    if (cand.length === alvo.length && crypto.timingSafeEqual(cand, alvo)) return l.tenant_id;
  }
  return null;
}

// ------------------------------------------------------------
// Telefone
// ------------------------------------------------------------
function soDigitos(t) { return String(t || '').replace(/\D/g, ''); }

// O MESMO numero chega em quatro formatos: "73 98888-7777" digitado pela lojista,
// "5573988887777" que o WhatsApp devolve, "73988887777" do cadastro antigo, e
// "557388887777" (celular BR antigo, sem o nono digito). Sem normalizar, a cliente
// vira quatro conversas diferentes e o historico se parte.
//
// Regra: devolve SEMPRE com 55 na frente. O nono digito e' preservado quando existe
// (nao inventamos digito que o numero nao tem — numero fixo comercial nao tem nono).
function normalizarTelefone(t) {
  let d = soDigitos(t);
  if (!d) return '';
  if (d.startsWith('55') && d.length >= 12) d = d.slice(2);   // tira o pais pra normalizar o resto
  if (d.length > 11) d = d.slice(-11);                        // lixo na frente (0800, operadora)
  return d.length >= 10 ? '55' + d : '';                      // menos de 10 digitos nao e' telefone
}

// Duas formas do mesmo numero sao a MESMA pessoa? Compara os 8 digitos finais —
// e' o que sobrevive ao nono digito e ao DDI. Usado pra casar mensagem que chega
// com cliente cadastrada.
function mesmoNumero(a, b) {
  const x = soDigitos(a), y = soDigitos(b);
  if (!x || !y) return false;
  return x.slice(-8) === y.slice(-8) && x.slice(-10, -8) === y.slice(-10, -8);
}

// ------------------------------------------------------------
// Adaptadores
// ------------------------------------------------------------
const ADAPTADORES = {
  evolution: require('./whatsapp-evolution'),
};

function adaptadorDe(cred) {
  const a = ADAPTADORES[cred.provedor];
  if (!a) throw new Error(`Provedor de canal desconhecido: ${cred.provedor}`);
  return a;
}

// ------------------------------------------------------------
// Envio
// ------------------------------------------------------------
// NUNCA joga excecao pra quem chama. O envio acontece no meio de coisas que ja
// deram certo (a acao da regua, o pedido pago) — estourar aqui desfaria o que ja
// funcionou. Devolve { ok:false, erro } e deixa quem chamou decidir.
async function enviarTexto(tenantId, telefone, texto) {
  const destino = normalizarTelefone(telefone);
  if (!destino) return { ok: false, erro: 'Telefone invalido' };
  if (!texto || !String(texto).trim()) return { ok: false, erro: 'Mensagem vazia' };

  const cred = credencialDe(tenantId);
  // SEM CANAL NAO E' ERRO: a lojista que nao conectou continua usando o wa.me,
  // exatamente como antes. Quem chama testa `semCanal` e cai no fallback.
  if (!cred) return { ok: false, semCanal: true, erro: 'Canal nao configurado' };

  try {
    return await adaptadorDe(cred).enviarTexto(cred, destino, String(texto));
  } catch (err) {
    return { ok: false, erro: err.message || 'Falha ao enviar' };
  }
}

async function enviarMidia(tenantId, telefone, url, legenda = '') {
  const destino = normalizarTelefone(telefone);
  if (!destino) return { ok: false, erro: 'Telefone invalido' };

  const cred = credencialDe(tenantId);
  if (!cred) return { ok: false, semCanal: true, erro: 'Canal nao configurado' };

  try {
    return await adaptadorDe(cred).enviarMidia(cred, destino, url, legenda);
  } catch (err) {
    return { ok: false, erro: err.message || 'Falha ao enviar' };
  }
}

// A loja tem canal ligado? O painel usa isto pra decidir entre "Enviar" (pelo
// sistema) e "Abrir no WhatsApp" (o wa.me de sempre).
function temCanal(tenantId) {
  try { return !!credencialDe(tenantId); } catch (_) { return false; }
}

module.exports = {
  credencialDe, salvarCredencial, desconectar, tenantDoWebhookToken,
  enviarTexto, enviarMidia, temCanal,
  normalizarTelefone, mesmoNumero, soDigitos,
  cifrar, decifrar,
};
