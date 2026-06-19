// ============================================================
// FOCUS NFe — integração de NFC-e (Nota Fiscal de Consumidor eletrônica)
// ------------------------------------------------------------
// A NFC-e NÃO é gerada aqui: a SEFAZ-BA autoriza. A Focus é a ponte —
// recebe um JSON com os dados da venda, assina com o certificado (que
// fica guardado no painel da Focus) e devolve número + chave + DANFE/QRCode.
//
// Segredo (token) vem SEMPRE do .env (objeto FOCUS em db/database.js),
// nunca do banco nem do código. Os dados FISCAIS (CNPJ, CSC id, CFOP,
// NCM, CSOSN padrão...) vêm da tabela `config` (não-secretos).
//
// Doc oficial: https://focusnfe.com.br/doc/  (seção NFC-e)
// ============================================================
const { db, getConfig, FOCUS } = require('../db/database');

// Mapeia a forma de pagamento interna do DS -> código da Focus/SEFAZ (tag tPag).
// Tabela SEFAZ: 01 dinheiro, 02 cheque, 03 cartão crédito, 04 cartão débito,
// 05 crédito loja, 15 boleto, 17 PIX, 99 outros.
function formaPagamentoFocus(forma) {
  switch (forma) {
    case 'dinheiro':           return '01';
    case 'credito_vista':
    case 'credito_parcelado':  return '03';
    case 'debito':             return '04';
    case 'pix':
    case 'pix_chave':          return '17';
    default:                   return '99';
  }
}

// Só dígitos (CPF/CNPJ/CEP/telefone).
function digitos(v) { return String(v || '').replace(/\D/g, ''); }

// Monta o array de formas de pagamento da NFC-e a partir das partes da venda
// (venda_pagamentos). Cai pra forma única se a venda não tiver split gravado.
function montarPagamentos(venda) {
  const partes = db.prepare('SELECT forma, valor FROM venda_pagamentos WHERE venda_id = ?').all(venda.id);
  const lista = partes.length
    ? partes
    : [{ forma: venda.forma_pagamento, valor: venda.total }];
  return lista.map(p => ({
    forma_pagamento: formaPagamentoFocus(p.forma),
    valor_pagamento: +(+p.valor).toFixed(2),
  }));
}

// Monta os itens da NFC-e. NCM: usa o da peça se houver; senão o NCM padrão da config.
function montarItens(venda) {
  const itens = db.prepare(`
    SELECT vi.descricao, vi.qtd, vi.preco_unit, vi.produto_id,
           p.codigo, p.ncm AS ncm_produto
    FROM venda_itens vi
    LEFT JOIN produtos p ON p.id = vi.produto_id
    WHERE vi.venda_id = ?
  `).all(venda.id);

  const ncmPadrao   = getConfig('nfce_ncm_padrao', '61099000');
  const cfopPadrao  = getConfig('nfce_cfop_padrao', '5102');
  const csosnPadrao = getConfig('nfce_csosn_padrao', '102');
  const origemProd  = getConfig('nfce_origem_padrao', '0');
  const unidade     = getConfig('nfce_unidade_padrao', 'UN');

  return itens.map((it, i) => {
    const qtd = it.qtd || 1;
    const valorUnit = +(+it.preco_unit).toFixed(2);
    const valorBruto = +(valorUnit * qtd).toFixed(2);
    return {
      numero_item: i + 1,
      codigo_produto: it.codigo || String(it.produto_id || (i + 1)),
      descricao: it.descricao || 'Peça',
      codigo_ncm: digitos(it.ncm_produto) || ncmPadrao,
      cfop: cfopPadrao,
      unidade_comercial: unidade,
      quantidade_comercial: qtd,
      valor_unitario_comercial: valorUnit,
      valor_bruto: valorBruto,
      unidade_tributavel: unidade,
      quantidade_tributavel: qtd,
      valor_unitario_tributavel: valorUnit,
      // Simples Nacional: ICMS por CSOSN (102 = sem permissão de crédito, sem ICMS a recolher).
      icms_origem: origemProd,
      icms_situacao_tributaria: csosnPadrao,
      // PIS/COFINS no Simples geralmente 49 (outras operações), alíquota zero.
      pis_situacao_tributaria: '49',
      cofins_situacao_tributaria: '49',
    };
  });
}

// Monta o payload COMPLETO da NFC-e que a Focus espera.
// `ref` é a referência única (idempotência) que também salvamos no banco.
function montarPayloadNfce(venda, ref) {
  const ambiente = getConfig('nfce_ambiente', 'homologacao');
  const itens = montarItens(venda);
  const valorProdutos = +itens.reduce((s, it) => s + it.valor_bruto, 0).toFixed(2);

  const cliente = venda.cliente_id
    ? db.prepare('SELECT nome, telefone FROM clientes WHERE id = ?').get(venda.cliente_id)
    : null;
  const cpfCliente = digitos(venda.cpf_cliente); // opcional ("CPF na nota")

  const payload = {
    // Em homologação a Focus exige tipo_documento_fiscal homologação automático;
    // o ambiente é definido pelo TOKEN usado (homologação x produção).
    natureza_operacao: 'Venda ao consumidor',
    data_emissao: new Date().toISOString(),
    tipo_documento: 1,            // 1 = saída
    local_destino: 1,             // operação interna (mesmo estado)
    finalidade_emissao: 1,        // 1 = normal
    consumidor_final: 1,
    presenca_comprador: 1,        // 1 = presencial (balcão)
    modalidade_frete: 9,          // sem frete

    // Emitente (a DS) — vem da config
    cnpj_emitente: digitos(getConfig('loja_cnpj', '')),
    nome_emitente: getConfig('loja_razao_social', '') || getConfig('loja_nome', 'DS STORE'),
    nome_fantasia_emitente: getConfig('loja_nome_fantasia', 'DS STORE'),
    inscricao_estadual_emitente: digitos(getConfig('loja_ie', '')),
    logradouro_emitente: getConfig('loja_endereco', ''),
    municipio_emitente: getConfig('loja_cidade', 'Itabuna'),
    uf_emitente: getConfig('loja_uf', 'BA'),
    cep_emitente: digitos(getConfig('loja_cep', '')),
    codigo_municipio_emitente: getConfig('loja_codigo_municipio', '2914802'),
    regime_tributario_emitente: 1, // 1 = Simples Nacional

    // Totais
    valor_produtos: valorProdutos,
    valor_desconto: +(+venda.desconto || 0).toFixed(2),
    valor_total: +(+venda.total).toFixed(2),

    // Itens + pagamentos
    items: itens,
    formas_pagamento: montarPagamentos(venda),
  };

  // CPF na nota (opcional — só se a cliente pediu)
  if (cpfCliente && cpfCliente.length === 11) {
    payload.cpf_destinatario = cpfCliente;
    if (cliente && cliente.nome) payload.nome_destinatario = cliente.nome;
  }

  return { payload, ambiente, valorTotal: payload.valor_total };
}

// Chamada HTTP genérica à Focus (Basic Auth: token como usuário, senha vazia).
async function focusRequest(ambiente, metodo, caminho, corpo) {
  const token = FOCUS.tokenDe(ambiente);
  if (***REMOVED***token) {
    const err = new Error(`Integração NFC-e não configurada (falta o token de ${ambiente} no .env)`);
    err.status = 503;
    throw err;
  }
  const url = FOCUS.urlDe(ambiente) + caminho;
  const auth = Buffer.from(token + ':').toString('base64');
  const resp = await fetch(url, {
    method: metodo,
    headers: {
      'Authorization': 'Basic ' + auth,
      'Content-Type': 'application/json',
    },
    body: corpo ? JSON.stringify(corpo) : undefined,
  });
  let dados = null;
  try { dados = await resp.json(); } catch (e) { dados = null; }
  return { httpStatus: resp.status, dados };
}

// Normaliza o retorno da Focus para o nosso formato de status.
// Focus status: autorizado | processando_autorizacao | erro_autorizacao | cancelado | denegado
function interpretarRetorno(dados) {
  const s = dados && dados.status;
  let status = 'processando';
  if (s === 'autorizado') status = 'autorizado';
  else if (s === 'cancelado') status = 'cancelado';
  else if (s === 'denegado') status = 'denegado';
  else if (s === 'erro_autorizacao' || s === 'erro') status = 'erro';
  else if (s === 'processando_autorizacao') status = 'processando';

  return {
    status,
    numero: dados && (dados.numero || null),
    serie: dados && (dados.serie || null),
    chave: dados && (dados.chave_nfe || dados.chave || null),
    protocolo: dados && (dados.protocolo || null),
    caminho_danfe: dados && (dados.caminho_danfe || dados.url_danfe || null),
    caminho_xml: dados && (dados.caminho_xml_nota_fiscal || dados.caminho_xml || null),
    qrcode_url: dados && (dados.qrcode_url || dados.url_consulta_nf || null),
    mensagem_sefaz: dados && (dados.mensagem_sefaz || dados.mensagem || (dados.erros && JSON.stringify(dados.erros)) || null),
  };
}

// EMITE a NFC-e de uma venda. Envia o payload e retorna o estado interpretado.
// POST /v2/nfce?ref=REF
async function emitirNfce(venda, ref) {
  const { payload, ambiente, valorTotal } = montarPayloadNfce(venda, ref);
  const { httpStatus, dados } = await focusRequest(ambiente, 'POST', `/v2/nfce?ref=${encodeURIComponent(ref)}`, payload);
  const info = interpretarRetorno(dados || {});
  return { ambiente, valorTotal, httpStatus, retorno: dados, ...info };
}

// CONSULTA o status de uma NFC-e já enviada (pra resolver 'processando').
// GET /v2/nfce/REF
async function consultarNfce(ref, ambiente) {
  const { httpStatus, dados } = await focusRequest(ambiente, 'GET', `/v2/nfce/${encodeURIComponent(ref)}`, null);
  return { httpStatus, retorno: dados, ...interpretarRetorno(dados || {}) };
}

// CANCELA uma NFC-e autorizada (precisa de justificativa com 15+ caracteres).
// DELETE /v2/nfce/REF  body: { justificativa }
async function cancelarNfce(ref, ambiente, justificativa) {
  const { httpStatus, dados } = await focusRequest(ambiente, 'DELETE', `/v2/nfce/${encodeURIComponent(ref)}`, { justificativa });
  return { httpStatus, retorno: dados, ...interpretarRetorno(dados || {}) };
}

module.exports = {
  emitirNfce,
  consultarNfce,
  cancelarNfce,
  montarPayloadNfce,   // exportado p/ testes (montar sem enviar)
  formaPagamentoFocus,
};
