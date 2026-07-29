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

// ============================================================
// MODO GERENCIADO — a lojista só lê um QR Code
// ------------------------------------------------------------
// Antes disto, conectar exigia endereço do servidor, nome da instância e token.
// Nenhuma lojista de interior tem isso, e nenhuma vai subir um Docker — na
// prática a funcionalidade só existia pra quem já roda uma Evolution própria.
//
// Com EVOLUTION_URL/EVOLUTION_KEY no .env, o Easy cria a instância dela por trás
// e mostra o QR. Ela aponta o celular, como no WhatsApp Web.
//
// O modo manual continua funcionando: quem tem servidor próprio informa os dados
// e nada muda pra essa pessoa.
function servidorGerenciado() {
  const url = process.env.EVOLUTION_URL;
  const key = process.env.EVOLUTION_KEY;
  return url && key ? { url: String(url).replace(/\/+$/, ''), key } : null;
}

function temGerenciado() { return !!servidorGerenciado(); }

// O nome da instância carrega o tenant: duas lojas no mesmo servidor não podem
// colidir, e olhando o painel da Evolution dá pra saber de quem é cada uma sem
// consultar o banco.
function nomeInstancia(tenantId) { return `easy-loja-${Number(tenantId)}`; }

// Conecta (ou reconecta) e devolve o QR pra tela mostrar.
async function conectarGerenciado(tenantId, siteUrl) {
  const srv = servidorGerenciado();
  if (!srv) return { ok: false, erro: 'Conexão automática não está disponível' };

  const evo = require('./whatsapp-evolution');
  const nome = nomeInstancia(tenantId);

  // A credencial precisa existir ANTES de criar a instância: é ela que tem o
  // webhook_token, e o webhook vai configurado já na criação. Invertendo a ordem,
  // a instância nasceria recebendo mensagem sem ter pra onde mandar.
  let cred = credencialDe(tenantId);
  if (!cred) {
    // Token provisório: a Evolution devolve o definitivo ao criar a instância.
    salvarCredencial(tenantId, {
      base_url: srv.url, instancia: nome, token: 'pendente-' + crypto.randomBytes(8).toString('hex'),
    });
    cred = credencialDe(tenantId);
  }

  const webhookUrl = siteUrl ? `${String(siteUrl).replace(/\/+$/, '')}/api/webhooks/whatsapp/${cred.webhook_token}` : null;

  const r = await evo.criarInstancia(srv.url, srv.key, nome, webhookUrl);
  if (!r.ok) return { ok: false, erro: r.erro };

  // Token novo só quando a instância foi criada agora. Reconexão devolve
  // `jaExistia` sem token — sobrescrever com null quebraria o envio de quem já
  // estava funcionando.
  if (r.token) {
    salvarCredencial(tenantId, { base_url: srv.url, instancia: nome, token: r.token });
  }

  // O QR pode não vir na criação (a Evolution às vezes leva um instante pra
  // gerar). Pedir de novo é mais confiável que devolver "sem QR" pra tela.
  let qr = r.qr;
  if (!qr) {
    const q = await evo.pegarQr(srv.url, srv.key, nome);
    if (q.conectado) return { ok: true, conectado: true };
    qr = q.qr;
  }

  return { ok: true, qr, jaExistia: !!r.jaExistia };
}

// Só o QR — usado pelo polling da tela enquanto ela espera o pareamento.
async function qrGerenciado(tenantId) {
  const srv = servidorGerenciado();
  if (!srv) return { ok: false };
  return require('./whatsapp-evolution').pegarQr(srv.url, srv.key, nomeInstancia(tenantId));
}

// Desconectar de verdade: apaga a instância no servidor E a credencial.
// Só apagar a credencial deixaria a instância pendurada consumindo recurso, e o
// celular da lojista continuaria mostrando um aparelho conectado.
async function desconectarGerenciado(tenantId) {
  const srv = servidorGerenciado();
  const cred = credencialDe(tenantId);
  if (srv && cred?.instancia) {
    await require('./whatsapp-evolution').apagarInstancia(srv.url, srv.key, cred.instancia).catch(() => {});
  }
  desconectar(tenantId);
  return { ok: true };
}

// Guarda o número assim que o pareamento acontece — é o que a lojista confere
// pra ter certeza de que ligou o aparelho certo.
async function sincronizarNumero(tenantId) {
  const srv = servidorGerenciado();
  const cred = credencialDe(tenantId);
  if (!srv || !cred?.instancia) return null;
  const num = await require('./whatsapp-evolution').numeroConectado(srv.url, srv.key, cred.instancia);
  if (num) {
    db.prepare('UPDATE integracoes_canal SET numero = ? WHERE tenant_id = ? AND provedor = ?')
      .run(soDigitos(num), tenantId, 'evolution');
  }
  return num;
}

// De qual loja é esta conta da Meta?
//
// A Evolution manda um token na URL do webhook; a Meta não — ela assina o corpo e
// o identificador da conta vem DENTRO do payload. Então o caminho de volta é
// procurar qual tenant registrou aquele phone_number_id (WhatsApp) ou aquele id
// de conta do Instagram.
//
// Sem esta função, a mensagem chega e não há como saber pra quem entregar.
function tenantDaContaMeta(idConta, canal = 'whatsapp') {
  if (!idConta) return null;
  const coluna = canal === 'instagram' ? 'instancia_ig' : 'instancia';
  const r = db.prepare(
    `SELECT tenant_id FROM integracoes_canal
      WHERE provedor = 'meta' AND ativo = 1 AND ${coluna} = ?
      LIMIT 1`
  ).get(String(idConta));
  return r ? r.tenant_id : null;
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
  // A oficial da Meta: cobre WhatsApp Cloud API E Instagram Direct pela mesma
  // porta (mesma Graph API, mesma autorização, mesmo webhook).
  meta: require('./whatsapp-meta'),
  // Evolution FICA: serve pra testar sem depender de aprovação da Meta (que leva
  // dias), e pra quem já tem servidor próprio. Foi por isso que o envio nasceu
  // isolado atrás desta fachada — trocar de provedor é escrever um adaptador,
  // não refazer o CRM.
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
// `canal` decide o DESTINO: WhatsApp vai por telefone, Instagram por IGSID (quem
// escreve pelo Instagram não tem telefone nenhum). Normalizar um IGSID como
// telefone destruiria o identificador.
async function enviarTexto(tenantId, telefone, texto, canal = 'whatsapp') {
  const destino = canal === 'instagram' ? String(telefone || '').trim() : normalizarTelefone(telefone);
  if (!destino) return { ok: false, erro: canal === 'instagram' ? 'Contato invalido' : 'Telefone invalido' };
  if (!texto || !String(texto).trim()) return { ok: false, erro: 'Mensagem vazia' };

  const cred = credencialDe(tenantId);
  // SEM CANAL NAO E' ERRO: a lojista que nao conectou continua usando o wa.me,
  // exatamente como antes. Quem chama testa `semCanal` e cai no fallback.
  if (!cred) return { ok: false, semCanal: true, erro: 'Canal nao configurado' };

  // INSTAGRAM NAO ACEITA INICIAR CONVERSA — so' responder quem escreveu, e dentro
  // de 7 dias. Barrar aqui, e nao deixar a Meta recusar, poupa a lojista de uma
  // mensagem de erro tecnica por uma regra que ela nao tem como adivinhar.
  if (canal === 'instagram' && cred.provedor !== 'meta') {
    return { ok: false, erro: 'Instagram só funciona com a conexão oficial da Meta' };
  }

  try {
    return await adaptadorDe(cred).enviarTexto(cred, destino, String(texto), canal);
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
  temGerenciado, conectarGerenciado, qrGerenciado, desconectarGerenciado,
  sincronizarNumero, nomeInstancia,
  // O webhook da Meta depende desta pra saber de qual loja é a mensagem — sem
  // ela exportada, toda mensagem recebida era descartada em silêncio (o webhook
  // respondia 200 e nada acontecia).
  tenantDaContaMeta,
  credencialDe, salvarCredencial, desconectar, tenantDoWebhookToken,
  enviarTexto, enviarMidia, temCanal,
  normalizarTelefone, mesmoNumero, soDigitos,
  cifrar, decifrar,
};
