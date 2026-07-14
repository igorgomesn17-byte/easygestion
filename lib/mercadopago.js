// ============================================================
// MERCADO PAGO POINT — a maquininha deixa de ser caixa preta.
// ------------------------------------------------------------
// O PDV manda a cobranca; a maquininha da loja acende (cloud-to-cloud, via 4G/wifi
// do proprio aparelho). Nada instalado na loja — e' o unico caminho compativel com
// um PDV que roda no navegador. Volta NSU, autorizacao, bandeira e — o que importa
// de verdade — a TAXA REAL COBRADA.
//
// Doc: https://www.mercadopago.com.br/developers/pt/docs/mp-point/landing
//
// -- O QUE O BENCH TEST (cobranca real de R$1 na Point da DS, 14/07) ENSINOU --
//
// 1. GET /v1/payments/{PAY01K...} da' 404. O id novo NAO serve no endpoint classico.
//    A chave e' transactions.payments[0].REFERENCE_ID — ele e' o id numerico classico.
//    Isso nao esta em documentacao nenhuma; so aparece cobrando de verdade.
// 2. A order ja traz bandeira, parcelas e card.last_digits SEM o 2o hop (a doc diz
//    que nao vem — esta desatualizada). O 2o hop serve pra TAXA e AUTORIZACAO.
// 3. So 1 order ativa por terminal: criar outra com uma pendente da' HTTP 409.
// 4. operating_mode PDV e' obrigatorio — o default e' STANDALONE e a maquininha
//    IGNORA as orders, em silencio.
// ============================================================
const crypto = require('crypto');
const { db } = require('../db/database');

const API = 'https://api.mercadopago.com';
const CERT_CIPHER = process.env.CERT_CIPHER_KEY || '';

// ---------- credencial (cifrada, por tenant) ----------
// Mesmo AES-256-CBC do certificado A1 (routes/config.js). NAO usar a tabela `config`:
// la o token da Focus esta em plaintext. Um token que move dinheiro nao repete isso.
function chaveAes() {
  if (!CERT_CIPHER) throw new Error('CERT_CIPHER_KEY nao configurada — sem ela o token ficaria em texto puro');
  return Buffer.from(CERT_CIPHER.padEnd(32, '0').slice(0, 32));
}

function cifrar(texto) {
  const iv = crypto.randomBytes(16);
  const c = crypto.createCipheriv('aes-256-cbc', chaveAes(), iv);
  const enc = Buffer.concat([c.update(String(texto), 'utf8'), c.final()]);
  return Buffer.concat([iv, enc]).toString('base64');
}

function decifrar(b64) {
  const buf = Buffer.from(b64, 'base64');
  const d = crypto.createDecipheriv('aes-256-cbc', chaveAes(), buf.slice(0, 16));
  return Buffer.concat([d.update(buf.slice(16)), d.final()]).toString('utf8');
}

// A credencial da loja. Devolve null se ela ainda nao conectou.
function credencialDe(tenantId, adquirente = 'mercadopago') {
  const r = db.prepare(`SELECT * FROM integracoes_pagamento
                        WHERE tenant_id = ? AND adquirente = ? AND ativo = 1`).get(tenantId, adquirente);
  if (!r) return null;
  return { ...r, access_token: decifrar(r.access_token) };
}

// Grava/atualiza (UPSERT — reconectar nao duplica).
function salvarCredencial(tenantId, { access_token, mp_user_id = null, terminal_id = null, terminal_nome = null }) {
  db.prepare(`
    INSERT INTO integracoes_pagamento (tenant_id, adquirente, access_token, mp_user_id, terminal_id, terminal_nome, ativo, atualizado_em)
    VALUES (?, 'mercadopago', ?, ?, ?, ?, 1, datetime('now','localtime'))
    ON CONFLICT(tenant_id, adquirente) DO UPDATE SET
      access_token  = excluded.access_token,
      mp_user_id    = COALESCE(excluded.mp_user_id, integracoes_pagamento.mp_user_id),
      terminal_id   = COALESCE(excluded.terminal_id, integracoes_pagamento.terminal_id),
      terminal_nome = COALESCE(excluded.terminal_nome, integracoes_pagamento.terminal_nome),
      ativo         = 1,
      atualizado_em = datetime('now','localtime')
  `).run(tenantId, cifrar(access_token), mp_user_id, terminal_id, terminal_nome);
}

function escolherTerminal(tenantId, terminalId, terminalNome = null) {
  db.prepare(`UPDATE integracoes_pagamento SET terminal_id = ?, terminal_nome = ?, atualizado_em = datetime('now','localtime')
              WHERE tenant_id = ? AND adquirente = 'mercadopago'`).run(terminalId, terminalNome, tenantId);
}

function desconectar(tenantId) {
  db.prepare(`DELETE FROM integracoes_pagamento WHERE tenant_id = ? AND adquirente = 'mercadopago'`).run(tenantId);
}

// ---------- HTTP ----------
async function chamar(token, metodo, caminho, corpo = null) {
  const headers = { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' };
  // Idempotencia: sem isso, um retry de rede vira COBRANCA DUPLICADA no cartao da cliente.
  if (metodo === 'POST') headers['X-Idempotency-Key'] = crypto.randomUUID();

  const r = await fetch(API + caminho, { method: metodo, headers, body: corpo ? JSON.stringify(corpo) : undefined });
  let dados = null;
  try { dados = await r.json(); } catch (_) { /* 204 e afins */ }
  return { status: r.status, dados };
}

// ---------- terminais ----------
async function listarTerminais(token) {
  const { status, dados } = await chamar(token, 'GET', '/terminals/v1/list?limit=50&offset=0');
  if (status !== 200) {
    const err = new Error('Nao consegui falar com o Mercado Pago. Confira o token.');
    err.status = status === 401 ? 401 : 502;
    throw err;
  }
  return (dados?.data?.terminals || []).map((t) => ({
    id: t.id,
    modo: t.operating_mode,          // PDV | STANDALONE | UNDEFINED
    pos_id: t.pos_id,
    store_id: t.store_id,
  }));
}

// SEM isto a maquininha ignora as cobrancas — e nao avisa. O default e' STANDALONE.
async function ativarModoPdv(token, terminalId) {
  const { status, dados } = await chamar(token, 'PATCH', '/terminals/v1/setup', {
    terminals: [{ id: terminalId, operating_mode: 'PDV' }],
  });
  if (status !== 200) {
    const err = new Error('Nao consegui colocar a maquininha em modo PDV');
    err.status = 502; err.detalhe = dados;
    throw err;
  }
  return true;
}

// ---------- cobranca ----------
// forma interna do PDV -> tipo do MP. Debito e credito sao os unicos que a
// maquininha processa; dinheiro/pix/vale/crediario nao passam por aqui.
function tipoPagamentoMp(forma) {
  if (forma === 'debito') return 'debit_card';
  if (forma === 'credito_vista' || forma === 'credito_parcelado') return 'credit_card';
  return null;
}

// Manda o valor pra maquininha. Ela acende e pede o cartao.
// `referencia` volta no webhook — e' como reencontramos a venda.
async function criarCobranca(token, { terminalId, valor, forma, parcelas = 1, referencia }) {
  const tipo = tipoPagamentoMp(forma);
  if (!tipo) throw Object.assign(new Error(`Forma "${forma}" nao passa na maquininha`), { status: 400 });

  const corpo = {
    type: 'point',
    external_reference: String(referencia).slice(0, 64),
    // amount e' STRING na Orders API (numero e' rejeitado)
    transactions: { payments: [{ amount: (+valor).toFixed(2) }] },
    config: {
      point: { terminal_id: terminalId, print_on_terminal: 'no_ticket' },
      payment_method: {
        default_type: tipo,
        default_installments: Math.max(1, parseInt(parcelas, 10) || 1),
        // 'seller': a loja absorve o custo do parcelamento. O repasse pra cliente,
        // quando existe, ja foi somado ao total pelo acrescimoParcelamento().
        installments_cost: 'seller',
      },
    },
  };

  const { status, dados } = await chamar(token, 'POST', '/v1/orders', corpo);

  // 409 = ja tem cobranca aberta NESTA maquininha. Mensagem em portugues de gente:
  // a vendedora precisa saber o que fazer, nao ler um codigo HTTP.
  if (status === 409) {
    const err = new Error('A maquininha ja tem uma cobranca aberta. Termine ou cancele nela antes de mandar outra.');
    err.status = 409;
    throw err;
  }
  if (status !== 201) {
    const err = new Error('O Mercado Pago recusou a cobranca');
    err.status = 502; err.detalhe = dados;
    throw err;
  }
  return { orderId: dados.id, paymentId: dados?.transactions?.payments?.[0]?.id || null, status: dados.status };
}

async function consultarOrder(token, orderId) {
  const { status, dados } = await chamar(token, 'GET', `/v1/orders/${orderId}`);
  if (status !== 200) throw Object.assign(new Error('Nao consegui consultar a cobranca'), { status: 502 });
  return dados;
}

// So funciona enquanto a order esta 'created'. Depois que foi pro terminal, o
// cancelamento TEM que ser feito na maquininha — a tela precisa dizer isso.
async function cancelarOrder(token, orderId) {
  const { status } = await chamar(token, 'POST', `/v1/orders/${orderId}/cancel`);
  return status === 200 || status === 201;
}

// ---------- o 2o hop: a TAXA REAL ----------
// Aqui mora o valor da integracao inteira. `referenceId` (NAO o id 'PAY01K...',
// que da' 404) e' o id numerico classico, escondido dentro do payment da order.
async function detalhesPagamento(token, referenceId) {
  const { status, dados } = await chamar(token, 'GET', `/v1/payments/${referenceId}`);
  if (status !== 200) return null;   // nao derruba a venda: taxa e' enriquecimento

  const fees = Array.isArray(dados.fee_details) ? dados.fee_details : [];
  const taxa = +fees.reduce((s, f) => s + (+f.amount || 0), 0).toFixed(2);
  const bruto = +dados.transaction_amount || 0;
  // O LIQUIDO E' O QUE O MP DIZ, nao (bruto - taxa): no bench test R$1,00 - R$0,02
  // dava 0,98, mas o net_received_amount real era 0,96. Quem compoe a conta e' ele.
  const liquido = dados?.transaction_details?.net_received_amount;

  return {
    autorizacao: dados.authorization_code || null,
    bandeira: dados.payment_method_id || null,
    parcelas: dados.installments || 1,
    cartao_final: dados?.card?.last_four_digits || null,
    valor_taxa_real: taxa,
    valor_liquido_real: liquido != null ? +(+liquido).toFixed(2) : null,
    // % efetivo derivado do liquido — e' ele que a lojista compara com o que ela ACHA
    // que paga. Se ela digitou 3,15% e aqui sai 3,49%, o DRE dela estava mentindo.
    taxa_real_pct: (liquido != null && bruto > 0)
      ? +(((bruto - liquido) / bruto) * 100).toFixed(2)
      : null,
  };
}

// ---------- webhook ----------
// x-signature: ts=...,v1=<hmac>. O manifest e' fixado pelo MP (id/request-id/ts).
// Sem isso, qualquer um que descubra a URL "aprova" uma venda que nunca aconteceu.
function assinaturaValida(req, segredo) {
  if (!segredo) return false;
  const sig = req.get('x-signature') || '';
  const reqId = req.get('x-request-id') || '';
  const partes = Object.fromEntries(sig.split(',').map((p) => p.split('=').map((s) => s.trim())));
  const ts = partes.ts, v1 = partes.v1;
  if (!ts || !v1) return false;

  const dataId = (req.query['data.id'] || req.body?.data?.id || '');
  const manifest = `id:${dataId};request-id:${reqId};ts:${ts};`;
  const esperado = crypto.createHmac('sha256', segredo).update(manifest).digest('hex');
  try {
    return crypto.timingSafeEqual(Buffer.from(esperado), Buffer.from(v1));
  } catch (_) {
    return false;   // tamanhos diferentes
  }
}

// Achata o retorno da order no formato que gravamos em venda_pagamentos.
function extrairDaOrder(order) {
  const p = order?.transactions?.payments?.[0] || {};
  return {
    mp_order_id: order?.id || null,
    mp_payment_id: p.id || null,
    nsu: p.reference_id || null,              // o id numerico classico — a chave do 2o hop
    bandeira: p.payment_method?.id || null,
    parcelas: p.payment_method?.installments || 1,
    cartao_final: p.card?.last_digits || null,
    valor: p.paid_amount != null ? +p.paid_amount : null,
    status_transacao: order?.status === 'processed' ? 'aprovado'
      : (order?.status === 'canceled' || order?.status === 'expired') ? 'cancelado'
      : order?.status === 'failed' ? 'recusado'
      : 'pendente',
  };
}

module.exports = {
  credencialDe, salvarCredencial, escolherTerminal, desconectar,
  listarTerminais, ativarModoPdv,
  criarCobranca, consultarOrder, cancelarOrder,
  detalhesPagamento, extrairDaOrder,
  assinaturaValida, tipoPagamentoMp,
  cifrar, decifrar,
};
