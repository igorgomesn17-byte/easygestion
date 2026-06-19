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
function salvarNfce({ venda_id, ref, ambiente, valor_total, info }) {
  db.prepare(`
    INSERT INTO nfce (venda_id, ref, ambiente, status, numero, serie, chave, protocolo,
                      caminho_danfe, caminho_xml, qrcode_url, mensagem_sefaz, valor_total)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(ref) DO UPDATE SET
      status=excluded.status, numero=excluded.numero, serie=excluded.serie, chave=excluded.chave,
      protocolo=excluded.protocolo, caminho_danfe=excluded.caminho_danfe, caminho_xml=excluded.caminho_xml,
      qrcode_url=excluded.qrcode_url, mensagem_sefaz=excluded.mensagem_sefaz
  `).run(venda_id, ref, ambiente, info.status, info.numero, info.serie, info.chave, info.protocolo,
         info.caminho_danfe, info.caminho_xml, info.qrcode_url, info.mensagem_sefaz, valor_total || 0);
  return db.prepare('SELECT * FROM nfce WHERE ref = ?').get(ref);
}

// monta a URL absoluta do DANFE/XML na Focus (os caminhos vêm relativos)
function urlAbsoluta(caminho, ambiente) {
  if (***REMOVED***caminho) return null;
  if (/^https?:\/\//i.test(caminho)) return caminho;
  return FOCUS.urlDe(ambiente) + caminho;
}
function comUrls(linha) {
  if (***REMOVED***linha) return linha;
  return {
    ...linha,
    danfe_url: urlAbsoluta(linha.caminho_danfe, linha.ambiente),
    xml_url: urlAbsoluta(linha.caminho_xml, linha.ambiente),
  };
}

// GET /api/nfce/config -> estado da integração (sem expor o token***REMOVED***)
router.get('/config', (req, res) => {
  const ambiente = getConfig('nfce_ambiente', 'homologacao');
  res.json({
    ativo: getConfig('nfce_ativo', '0') === '1',
    ambiente,
    configurado: FOCUS.configurado(ambiente),     // tem token no .env pro ambiente atual?
    tem_token_homologacao: FOCUS.configurado('homologacao'),
    tem_token_producao: FOCUS.configurado('producao'),
    cnpj: getConfig('loja_cnpj', ''),
    ie: getConfig('loja_ie', ''),
    csc_id: getConfig('nfce_csc_id', ''),
  });
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
  const params = [];
  let filtro = '1=1';
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
  const linhas = db.prepare('SELECT * FROM nfce WHERE venda_id = ? ORDER BY id DESC').all(req.params.vendaId);
  res.json(linhas.map(comUrls));
});

// POST /api/nfce/emitir/:vendaId  body: { cpf_cliente? }
// Emite a NFC-e da venda. Se já existe uma autorizada, não duplica.
router.post('/emitir/:vendaId', async (req, res) => {
  if (getConfig('nfce_ativo', '0') ***REMOVED***== '1') {
    return res.status(400).json({ erro: 'A emissão de NFC-e está desligada. Ative em Configurações.' });
  }
  const venda = db.prepare('SELECT * FROM vendas WHERE id = ?').get(req.params.vendaId);
  if (***REMOVED***venda) return res.status(404).json({ erro: 'Venda não encontrada' });

  // não duplica: se já tem nota autorizada/processando, devolve a existente
  const existente = db.prepare(
    "SELECT * FROM nfce WHERE venda_id = ? AND status IN ('autorizado','processando') ORDER BY id DESC"
  ).get(venda.id);
  if (existente) return res.json({ ...comUrls(existente), ja_emitida: true });

  // CPF opcional na nota
  venda.cpf_cliente = req.body && req.body.cpf_cliente;

  // referência única e idempotente desta emissão
  const ref = `venda-${venda.id}-${Date.now()}`;

  try {
    const r = await emitirNfce(venda, ref);
    const linha = salvarNfce({
      venda_id: venda.id, ref, ambiente: r.ambiente, valor_total: r.valorTotal,
      info: r,
    });
    if (r.status === 'erro' || r.status === 'denegado') {
      return res.status(422).json({ ...comUrls(linha), erro: r.mensagem_sefaz || 'A SEFAZ rejeitou a nota' });
    }
    res.status(201).json(comUrls(linha));
  } catch (e) {
    res.status(e.status || 500).json({ erro: e.message });
  }
});

// GET /api/nfce/status/:vendaId -> reconsulta a SEFAZ (resolve 'processando')
router.get('/status/:vendaId', async (req, res) => {
  const linha = db.prepare(
    'SELECT * FROM nfce WHERE venda_id = ? ORDER BY id DESC'
  ).get(req.params.vendaId);
  if (***REMOVED***linha) return res.status(404).json({ erro: 'Nenhuma NFC-e para esta venda' });
  if (linha.status === 'autorizado' || linha.status === 'cancelado') return res.json(comUrls(linha));

  try {
    const r = await consultarNfce(linha.ref, linha.ambiente);
    const atualizada = salvarNfce({
      venda_id: linha.venda_id, ref: linha.ref, ambiente: linha.ambiente,
      valor_total: linha.valor_total, info: r,
    });
    res.json(comUrls(atualizada));
  } catch (e) {
    res.status(e.status || 500).json({ erro: e.message });
  }
});

// DELETE /api/nfce/cancelar/:vendaId  body: { justificativa }
router.delete('/cancelar/:vendaId', async (req, res) => {
  const linha = db.prepare(
    "SELECT * FROM nfce WHERE venda_id = ? AND status = 'autorizado' ORDER BY id DESC"
  ).get(req.params.vendaId);
  if (***REMOVED***linha) return res.status(404).json({ erro: 'Nenhuma NFC-e autorizada para cancelar' });
  const justificativa = (req.body && req.body.justificativa || '').trim();
  if (justificativa.length < 15) {
    return res.status(400).json({ erro: 'A justificativa do cancelamento precisa ter pelo menos 15 caracteres.' });
  }
  try {
    const r = await cancelarNfce(linha.ref, linha.ambiente, justificativa);
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
