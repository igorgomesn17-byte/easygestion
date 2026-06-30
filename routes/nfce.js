// ============================================================
// API de NFC-e (Nota Fiscal de Consumidor eletrônica) via Focus NFe
// ------------------------------------------------------------
// Fluxo: PDV/Histórico chama POST /api/nfce/emitir/:vendaId.
// A nota é autorizada pela SEFAZ (via Focus). Guardamos a referência e o
// estado na tabela `nfce`. Como a autorização pode ser assíncrona, há
// GET /status/:vendaId pra reconsultar e DELETE pra cancelar.
//
// Toda a rota é restrita a admin (montada com apenasAdmin no server.js).
// O segredo (token Focus) nunca passa por aqui — está no .env.
// ============================================================
const express = require('express');
const router = express.Router();
const { db, getConfig, FOCUS } = require('../db/database');
const { emitirNfce, consultarNfce, cancelarNfce } = require('../lib/focusNfe');

// grava/atualiza a linha da nfce no banco a partir do retorno interpretado
function salvarNfce({ venda_id, ref, ambiente, valor_total, info, tenant_id = 1 }) {
  db.prepare(`
    INSERT INTO nfce (venda_id, ref, ambiente, status, numero, serie, chave, protocolo,
                      caminho_danfe, caminho_xml, qrcode_url, mensagem_sefaz, valor_total, tenant_id)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(ref) DO UPDATE SET
      status=excluded.status, numero=excluded.numero, serie=excluded.serie, chave=excluded.chave,
      protocolo=excluded.protocolo, caminho_danfe=excluded.caminho_danfe, caminho_xml=excluded.caminho_xml,
      qrcode_url=excluded.qrcode_url, mensagem_sefaz=excluded.mensagem_sefaz
  `).run(venda_id, ref, ambiente, info.status, info.numero, info.serie, info.chave, info.protocolo,
         info.caminho_danfe, info.caminho_xml, info.qrcode_url, info.mensagem_sefaz, valor_total || 0, tenant_id);
  return db.prepare('SELECT * FROM nfce WHERE ref = ?').get(ref);
}

// monta a URL absoluta do DANFE/XML na Focus (os caminhos vêm relativos)
function urlAbsoluta(caminho, ambiente) {
  if (!caminho) return null;
  if (/^https?:\/\//i.test(caminho)) return caminho;
  return FOCUS.urlDe(ambiente) + caminho;
}
function comUrls(linha) {
  if (!linha) return linha;
  return {
    ...linha,
    danfe_url: urlAbsoluta(linha.caminho_danfe, linha.ambiente),
    xml_url: urlAbsoluta(linha.caminho_xml, linha.ambiente),
  };
}

// GET /api/nfce/config -> estado da integração (sem expor o token!)
router.get('/config', (req, res) => {
  const ambiente = getConfig('nfce_ambiente', 'homologacao', req.tenantId);
  const ativoStr = getConfig('nfce_ativo', '0', req.tenantId);
  const cscId = getConfig('nfce_csc_id', '', req.tenantId);
  const nfceSerie = getConfig('nfce_serie', '1', req.tenantId);

  res.json({
    ativo: ativoStr === '1',
    ambiente,
    configurado: FOCUS.configurado(ambiente),     // tem token no .env pro ambiente atual?
    tem_token_homologacao: FOCUS.configurado('homologacao'),
    tem_token_producao: FOCUS.configurado('producao'),
    cnpj: getConfig('loja_cnpj', '', req.tenantId),
    ie: getConfig('loja_ie', '', req.tenantId),
    csc_id: cscId,
    nfce_serie: nfceSerie,
  });
});

// ============================================================
// POST /api/nfce/ativar → Cliente ativa sua integração Focus
// Salva token + CSC ID do cliente, criptografado
// ============================================================
router.post('/ativar', (req, res) => {
  const { token, csc_id, ambiente, serie } = req.body;

  // Validação básica
  if (!token || typeof token !== 'string' || token.trim().length < 10) {
    return res.status(400).json({ erro: 'TOKEN inválido ou muito curto' });
  }

  if (!csc_id || typeof csc_id !== 'string' || csc_id.trim().length < 3) {
    return res.status(400).json({ erro: 'CSC ID inválido' });
  }

  if (!['homologacao', 'producao'].includes(ambiente)) {
    return res.status(400).json({ erro: 'Ambiente deve ser "homologacao" ou "producao"' });
  }

  const serieNum = parseInt(serie || 1);
  if (isNaN(serieNum) || serieNum < 1 || serieNum > 999) {
    return res.status(400).json({ erro: 'Série deve ser um número entre 1 e 999' });
  }

  try {
    // Salvar no banco (para este tenant)
    // Nota: Token agora é salvo via /api/config/focus-token, não aqui
    db.prepare(`
      INSERT OR REPLACE INTO config (chave, valor, tenant_id)
      VALUES (?, ?, ?)
    `).run('nfce_ativo', '1', req.tenantId);

    db.prepare(`
      INSERT OR REPLACE INTO config (chave, valor, tenant_id)
      VALUES (?, ?, ?)
    `).run('nfce_csc_id', csc_id, req.tenantId);

    db.prepare(`
      INSERT OR REPLACE INTO config (chave, valor, tenant_id)
      VALUES (?, ?, ?)
    `).run('nfce_ambiente', ambiente, req.tenantId);

    db.prepare(`
      INSERT OR REPLACE INTO config (chave, valor, tenant_id)
      VALUES (?, ?, ?)
    `).run('nfce_serie', String(serieNum), req.tenantId);

    console.log(`[NFC-e] Cliente ${req.tenantId} ativou integração (ambiente: ${ambiente})`);

    res.status(201).json({
      ok: true,
      mensagem: 'NFC-e ativada com sucesso!',
      ambiente,
      serie: serieNum,
    });
  } catch (e) {
    console.error('[NFC-e] Erro ao ativar:', e);
    res.status(500).json({ erro: 'Erro ao ativar NFC-e: ' + e.message });
  }
});

// ============================================================
// POST /api/nfce/desativar → Cliente desativa sua integração
// ============================================================
router.post('/desativar', (req, res) => {
  try {
    db.prepare(`
      INSERT OR REPLACE INTO config (chave, valor, tenant_id)
      VALUES (?, ?, ?)
    `).run('nfce_ativo', '0', req.tenantId);

    console.log(`[NFC-e] Cliente ${req.tenantId} desativou integração`);

    res.json({
      ok: true,
      mensagem: 'NFC-e desativada',
    });
  } catch (e) {
    console.error('[NFC-e] Erro ao desativar:', e);
    res.status(500).json({ erro: 'Erro ao desativar: ' + e.message });
  }
});

// GET /api/nfce/relatorio?de=YYYY-MM-DD&ate=YYYY-MM-DD  (ou ?mes=YYYY-MM)
// Relatório de notas emitidas pro contador: quantidades por status, valor total
// AUTORIZADO (o que vale fiscalmente) e a lista nota a nota.
router.get('/relatorio', (req, res) => {
  let { de, ate, mes } = req.query;
  if (mes && /^\d{4}-\d{2}$/.test(mes)) {
    de = mes + '-01';
    const [a, m] = mes.split('-').map(Number);
    const ultimoDia = new Date(a, m, 0).getDate();
    ate = `${mes}-${String(ultimoDia).padStart(2, '0')}`;
  }
  const params = [req.tenantId];
  let filtro = 'tenant_id = ?';
  if (de)  { filtro += " AND date(emitido_em) >= ?"; params.push(de); }
  if (ate) { filtro += " AND date(emitido_em) <= ?"; params.push(ate); }

  const linhas = db.prepare(`SELECT * FROM nfce WHERE ${filtro} ORDER BY emitido_em DESC`).all(...params);

  // resumo por status (o valor que conta pro fisco é o das AUTORIZADAS)
  const resumo = { autorizadas: 0, canceladas: 0, com_erro: 0, processando: 0,
                   valor_autorizado: 0, valor_cancelado: 0 };
  for (const n of linhas) {
    if (n.status === 'autorizado') { resumo.autorizadas++; resumo.valor_autorizado += n.valor_total || 0; }
    else if (n.status === 'cancelado') { resumo.canceladas++; resumo.valor_cancelado += n.valor_total || 0; }
    else if (n.status === 'erro' || n.status === 'denegado') resumo.com_erro++;
    else if (n.status === 'processando') resumo.processando++;
  }
  resumo.valor_autorizado = +resumo.valor_autorizado.toFixed(2);
  resumo.valor_cancelado = +resumo.valor_cancelado.toFixed(2);
  resumo.total_emitidas = linhas.length;

  res.json({ de, ate, resumo, notas: linhas.map(comUrls) });
});

// GET /api/nfce/venda/:vendaId -> nota(s) já emitida(s) pra essa venda
router.get('/venda/:vendaId', (req, res) => {
  const linhas = db.prepare('SELECT * FROM nfce WHERE venda_id = ? AND tenant_id = ? ORDER BY id DESC').all(req.params.vendaId, req.tenantId);
  res.json(linhas.map(comUrls));
});

// POST /api/nfce/emitir/:vendaId  body: { cpf_cliente? }
// Emite a NFC-e da venda. Se já existe uma autorizada, não duplica.
// Usa token do cliente (se configurado) ou token do .env (fallback)
router.post('/emitir/:vendaId', async (req, res) => {
  if (getConfig('nfce_ativo', '0', req.tenantId) !== '1') {
    return res.status(400).json({ erro: 'A emissão de NFC-e está desligada. Ative em Configurações.' });
  }

  // Validar dados obrigatórios da loja
  const cnpj = getConfig('loja_cnpj', '', req.tenantId);
  const razaoSocial = getConfig('loja_razao_social', '', req.tenantId);
  const ie = getConfig('loja_ie', '', req.tenantId);
  const endereco = getConfig('loja_endereco', '', req.tenantId);
  const cidade = getConfig('loja_cidade', '', req.tenantId);
  const cep = getConfig('loja_cep', '', req.tenantId);

  const camposFaltando = [];
  if (!cnpj || cnpj.trim() === '') camposFaltando.push('CNPJ');
  if (!razaoSocial || razaoSocial.trim() === '') camposFaltando.push('Razão Social');
  if (!ie || ie.trim() === '') camposFaltando.push('Inscrição Estadual');
  if (!endereco || endereco.trim() === '') camposFaltando.push('Endereço');
  if (!cidade || cidade.trim() === '') camposFaltando.push('Cidade');
  if (!cep || cep.trim() === '') camposFaltando.push('CEP');

  if (camposFaltando.length > 0) {
    return res.status(400).json({
      erro: 'Dados da loja incompletos para emitir NFC-e',
      campos_faltando: camposFaltando,
      detalhe: `Preencha: ${camposFaltando.join(', ')} em Configurações > Dados da Loja`
    });
  }

  // Validar se a integração Focus está configurada (token no .env ou no banco)
  const FOCUS = require('../db/database').FOCUS;
  const ambiente = getConfig('nfce_ambiente', 'homologacao', req.tenantId);
  const tokenCliente = getConfig(`focus_token_${ambiente}`, null, req.tenantId);  // Buscar token do banco

  if (!FOCUS.configurado(ambiente) && !tokenCliente) {
    return res.status(503).json({
      erro: `Integração Focus NFe não configurada para o ambiente ${ambiente}.`,
      detalhe: 'Adicione o token em Configurações > NFC-e > Token de Autenticação ou contate o suporte.'
    });
  }

  const venda = db.prepare('SELECT * FROM vendas WHERE id = ? AND tenant_id = ?').get(req.params.vendaId, req.tenantId);
  if (!venda) return res.status(404).json({ erro: 'Venda não encontrada' });

  // não duplica: se já tem nota autorizada/processando, devolve a existente
  // se foi rejeitada/cancelada, permite tentar de novo
  const existente = db.prepare(
    "SELECT * FROM nfce WHERE venda_id = ? AND tenant_id = ? AND status IN ('autorizado','processando') ORDER BY id DESC"
  ).get(venda.id, req.tenantId);
  if (existente) return res.json({ ...comUrls(existente), ja_emitida: true });

  // CPF opcional na nota
  venda.cpf_cliente = req.body && req.body.cpf_cliente;

  // referência única e idempotente desta emissão
  const ref = `venda-${venda.id}-${Date.now()}`;

  try {
    const r = await emitirNfce(venda, ref, req.tenantId, tokenCliente);
    const linha = salvarNfce({
      venda_id: venda.id, ref, ambiente: r.ambiente, valor_total: r.valorTotal,
      info: r, tenant_id: req.tenantId,
    });
    if (r.status === 'erro' || r.status === 'denegado') {
      console.error(`[NFC-e] Rejeição SEFAZ para venda ${venda.id}:`, r.mensagem_sefaz);
      return res.status(422).json({ ...comUrls(linha), erro: r.mensagem_sefaz || 'A SEFAZ rejeitou a nota' });
    }
    console.log(`[NFC-e] ✅ Venda ${venda.id} emitida com sucesso. Ref: ${ref}, Status: ${r.status}`);
    res.status(201).json(comUrls(linha));
  } catch (e) {
    console.error(`[NFC-e] ❌ Erro ao emitir venda ${venda.id}:`, e.message);
    res.status(e.status || 500).json({ erro: e.message });
  }
});

// GET /api/nfce/status/:vendaId -> reconsulta a SEFAZ (resolve 'processando')
router.get('/status/:vendaId', async (req, res) => {
  const linha = db.prepare(
    'SELECT * FROM nfce WHERE venda_id = ? AND tenant_id = ? ORDER BY id DESC'
  ).get(req.params.vendaId, req.tenantId);
  if (!linha) return res.status(404).json({ erro: 'Nenhuma NFC-e para esta venda' });
  if (linha.status === 'autorizado' || linha.status === 'cancelado') return res.json(comUrls(linha));

  const ambiente = linha.ambiente || getConfig('nfce_ambiente', 'homologacao', req.tenantId);
  const tokenCliente = getConfig(`focus_token_${ambiente}`, null, req.tenantId);

  try {
    const r = await consultarNfce(linha.ref, linha.ambiente, tokenCliente);
    const atualizada = salvarNfce({
      venda_id: linha.venda_id, ref: linha.ref, ambiente: linha.ambiente,
      valor_total: linha.valor_total, info: r, tenant_id: req.tenantId,
    });
    res.json(comUrls(atualizada));
  } catch (e) {
    res.status(e.status || 500).json({ erro: e.message });
  }
});

// DELETE /api/nfce/cancelar/:vendaId  body: { justificativa }
router.delete('/cancelar/:vendaId', async (req, res) => {
  const linha = db.prepare(
    "SELECT * FROM nfce WHERE venda_id = ? AND tenant_id = ? AND status = 'autorizado' ORDER BY id DESC"
  ).get(req.params.vendaId, req.tenantId);
  if (!linha) return res.status(404).json({ erro: 'Nenhuma NFC-e autorizada para cancelar' });
  const justificativa = (req.body && req.body.justificativa || '').trim();
  if (justificativa.length < 15) {
    return res.status(400).json({ erro: 'A justificativa do cancelamento precisa ter pelo menos 15 caracteres.' });
  }

  const ambiente = linha.ambiente || getConfig('nfce_ambiente', 'homologacao', req.tenantId);
  const tokenCliente = getConfig(`focus_token_${ambiente}`, null, req.tenantId);

  try {
    const r = await cancelarNfce(linha.ref, linha.ambiente, justificativa, tokenCliente);
    if (r.status === 'cancelado') {
      db.prepare("UPDATE nfce SET status='cancelado', cancelado_em=datetime('now','localtime'), mensagem_sefaz=? WHERE id=?")
        .run(r.mensagem_sefaz || 'Cancelada', linha.id);
      return res.json({ ok: true, status: 'cancelado' });
    }
    res.status(422).json({ erro: r.mensagem_sefaz || 'Não foi possível cancelar', status: r.status });
  } catch (e) {
    res.status(e.status || 500).json({ erro: e.message });
  }
});

module.exports = router;
