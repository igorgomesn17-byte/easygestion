// ============================================================
// API de CAIXA DO DIA (fechamento, conciliacao)
// ============================================================
const express = require('express');
const router = express.Router();
const { db } = require('../db/database');
const { hojeLocal } = require('../lib/datas');

// Garante que existe a linha do caixa do dia (sem zerar valores existentes)
function garantirLinha(data, tenantId = 1) {
  db.prepare('INSERT OR IGNORE INTO caixa_dia (data, tenant_id) VALUES (?, ?)').run(data, tenantId);
}

// Calcula o esperado em dinheiro: fundo + dinheiro de vendas + suprimentos - sangrias.
// IMPORTANTE: caixa_dia.sangrias/suprimentos contam SÓ movimentos em dinheiro (gaveta).
function dinheiroEsperado(c) {
  return +((c.fundo_troco || 0) + (c.total_dinheiro || 0) + (c.suprimentos || 0) - (c.sangrias || 0)).toFixed(2);
}

// Recalcula caixa_dia.sangrias/suprimentos contando APENAS movimentos em dinheiro
// (os que afetam o físico da gaveta). Pix/cartão saem/entram na conta, não na gaveta.
function recalcularMovimentos(data, tenantId = 1) {
  const r = db.prepare(`
    SELECT
      COALESCE(SUM(CASE WHEN tipo='sangria'    AND forma='dinheiro' THEN valor END),0) AS sangria_din,
      COALESCE(SUM(CASE WHEN tipo='suprimento' AND forma='dinheiro' THEN valor END),0) AS suprimento_din
    FROM caixa_movimentos WHERE data = ? AND tenant_id = ?`).get(data, tenantId);
  db.prepare('UPDATE caixa_dia SET sangrias = ?, suprimentos = ? WHERE data = ? AND tenant_id = ?')
    .run(+r.sangria_din.toFixed(2), +r.suprimento_din.toFixed(2), data, tenantId);
}

// Totais de movimentos que saíram/entraram na CONTA (não-dinheiro), por tipo.
function movimentosConta(data, tenantId = 1) {
  const r = db.prepare(`
    SELECT
      COALESCE(SUM(CASE WHEN tipo='sangria'    AND forma<>'dinheiro' THEN valor END),0) AS sangrias_conta,
      COALESCE(SUM(CASE WHEN tipo='suprimento' AND forma<>'dinheiro' THEN valor END),0) AS suprimentos_conta
    FROM caixa_movimentos WHERE data = ? AND tenant_id = ?`).get(data, tenantId);
  return { sangrias_conta: +r.sangrias_conta.toFixed(2), suprimentos_conta: +r.suprimentos_conta.toFixed(2) };
}

// Bloco CONTA bancária: bate o saldo do banco no fim do dia.
//   esperado = saldo_inicial + PIX do dia (cai na hora) + suprimentos conta − saídas conta
//   cartão (débito/crédito) é mostrado à parte como "a receber" (não cai no mesmo dia).
function contaEsperada(caixa, data) {
  const pixDia = +(caixa.total_pix || 0).toFixed(2);          // pix cai na hora
  const cartaoReceber = +((caixa.total_debito || 0) + (caixa.total_credito || 0)).toFixed(2); // a receber depois
  const saldoIni = caixa.saldo_conta_inicial;
  const supConta = +(caixa.suprimentos_conta || 0).toFixed(2);
  const sangConta = +(caixa.sangrias_conta || 0).toFixed(2);
  // só calcula esperado se o usuário informou o saldo inicial da conta
  const temSaldo = saldoIni ***REMOVED***== null && saldoIni ***REMOVED***== undefined;
  const contaEsperado = temSaldo
    ? +((saldoIni || 0) + pixDia + supConta - sangConta).toFixed(2)
    : null;
  return {
    conta_pix_dia: pixDia,
    conta_cartao_receber: cartaoReceber,
    conta_saidas: sangConta,
    conta_entradas_extra: supConta,
    conta_esperado: contaEsperado, // null = saldo inicial não informado ainda
  };
}

// GET /api/caixa/hoje  (ou ?data=YYYY-MM-DD)
router.get('/hoje', (req, res) => {
  const data = req.query.data || hojeLocal();
  let caixa = db.prepare('SELECT * FROM caixa_dia WHERE data = ? AND tenant_id = ?').get(data, req.tenantId || 1);
  if (***REMOVED***caixa) {
    caixa = { data, total_pix: 0, total_debito: 0, total_credito: 0, total_dinheiro: 0,
              total_bruto: 0, total_liquido: 0, lucro_dia: 0, num_vendas: 0, conciliado: 0, obs: null,
              fundo_troco: 0, sangrias: 0, suprimentos: 0, dinheiro_contado: null, diferenca: null,
              aberto: 0, fechado: 0, aberto_em: null, fechado_em: null };
  }
  caixa.dinheiro_esperado = dinheiroEsperado(caixa);
  // movimentos que saíram/entraram na CONTA (pix/cartão), separados da gaveta
  Object.assign(caixa, movimentosConta(data, req.tenantId || 1));
  // bloco CONTA: saldo inicial + entradas na conta − saídas pela conta = esperado no banco
  Object.assign(caixa, contaEsperada(caixa, data));
  // vendas do dia para detalhamento
  caixa.vendas = db.prepare(`
    SELECT v.id, v.data_hora, v.total, v.forma_pagamento, v.origem, v.valor_liquido, v.lucro, c.nome AS cliente_nome
    FROM vendas v LEFT JOIN clientes c ON c.id = v.cliente_id AND c.tenant_id = v.tenant_id
    WHERE date(v.data_hora) = ? AND v.tenant_id = ? ORDER BY v.data_hora DESC
  `).all(data, req.tenantId || 1);
  // movimentos (abertura/sangria/suprimento) do dia
  caixa.movimentos = db.prepare(
    'SELECT * FROM caixa_movimentos WHERE data = ? AND tenant_id = ? ORDER BY criado_em').all(data, req.tenantId || 1);
  res.json(caixa);
});

// POST /api/caixa/abrir  body: { data?, fundo_troco }
router.post('/abrir', (req, res) => {
  const data = req.body.data || hojeLocal();
  const fundo = parseFloat(req.body.fundo_troco) || 0;
  garantirLinha(data, req.tenantId || 1);
  const c = db.prepare('SELECT * FROM caixa_dia WHERE data = ? AND tenant_id = ?').get(data, req.tenantId || 1);
  if (c.fechado) return res.status(400).json({ erro: 'Caixa deste dia já foi fechado.' });
  const tx = db.transaction(() => {
    db.prepare(`UPDATE caixa_dia SET fundo_troco = ?, aberto = 1, aberto_em = datetime('now','localtime') WHERE data = ? AND tenant_id = ?`)
      .run(fundo, data, req.tenantId || 1);
    db.prepare(`INSERT INTO caixa_movimentos (data, tenant_id, tipo, valor, motivo) VALUES (?, ?, 'abertura', ?, ?)`)
      .run(data, req.tenantId || 1, fundo, 'fundo de troco');
  });
  tx();
  res.json({ ok: true });
});

// POST /api/caixa/saldo-conta  body: { data?, saldo }
// Informa/edita o saldo inicial da CONTA bancária do dia (olhando o app do banco).
router.post('/saldo-conta', (req, res) => {
  const data = req.body.data || hojeLocal();
  const saldo = req.body.saldo === '' || req.body.saldo == null ? null : parseFloat(req.body.saldo);
  if (saldo ***REMOVED***== null && isNaN(saldo)) return res.status(400).json({ erro: 'Saldo inválido' });
  garantirLinha(data, req.tenantId || 1);
  db.prepare('UPDATE caixa_dia SET saldo_conta_inicial = ? WHERE data = ? AND tenant_id = ?').run(saldo, data, req.tenantId || 1);
  res.json({ ok: true, saldo_conta_inicial: saldo });
});

const FORMAS_MOV = ['dinheiro', 'pix', 'debito', 'credito', 'transferencia'];
function normalizaForma(f) {
  f = String(f || 'dinheiro').toLowerCase();
  return FORMAS_MOV.includes(f) ? f : 'dinheiro';
}

// POST /api/caixa/sangria  body: { data?, valor, motivo, forma }
router.post('/sangria', (req, res) => {
  const data = req.body.data || hojeLocal();
  const valor = parseFloat(req.body.valor) || 0;
  if (valor <= 0) return res.status(400).json({ erro: 'Informe um valor.' });
  const forma = normalizaForma(req.body.forma);
  garantirLinha(data, req.tenantId || 1);
  const tx = db.transaction(() => {
    db.prepare(`INSERT INTO caixa_movimentos (data, tenant_id, tipo, valor, forma, motivo) VALUES (?, ?, 'sangria', ?, ?, ?)`)
      .run(data, req.tenantId || 1, valor, forma, req.body.motivo || null);
    recalcularMovimentos(data, req.tenantId || 1); // só dinheiro afeta a gaveta
  });
  tx();
  res.json({ ok: true });
});

// POST /api/caixa/saida  body: { data?, valor, forma, descricao, categoria, centro }
// Saída do dia que JÁ É uma despesa: registra a sangria no caixa (gaveta/conta)
// E cria a despesa no Financeiro (paga, na data do caixa). Não lança 2x.
router.post('/saida', (req, res) => {
  const data = req.body.data || hojeLocal();
  const valor = parseFloat(req.body.valor) || 0;
  if (valor <= 0) return res.status(400).json({ erro: 'Informe um valor.' });
  const descricao = String(req.body.descricao || '').trim();
  if (***REMOVED***descricao) return res.status(400).json({ erro: 'Descreva a saída (ex: pagamento fornecedor).' });
  const forma = normalizaForma(req.body.forma);
  const categoria = req.body.categoria || 'outro';
  const centro = req.body.centro === 'pessoal' ? 'pessoal' : 'empresa';
  // forma no padrão das despesas (cartão/transferência viram 'cartao'/'transferencia')
  const formaDespesa = forma === 'debito' || forma === 'credito' ? 'cartao' : forma;
  garantirLinha(data, req.tenantId || 1);
  const tx = db.transaction(() => {
    // 1) despesa no Financeiro (já paga, competência = mês do caixa, data_pagamento = data do caixa)
    const info = db.prepare(`INSERT INTO despesas (tenant_id, descricao, valor, categoria, tipo, centro, data_competencia,
                data_pagamento, pago, forma_pagamento, obs)
                VALUES (?, ?, ?, ?, 'variavel', ?, ?, ?, 1, ?, 'Lançada pelo caixa do dia')`)
      .run(req.tenantId || 1, descricao, valor, categoria, centro, data.slice(0, 7) + '-01', data, formaDespesa);
    // 2) movimento no caixa (sangria) vinculado à despesa — apagar um apaga o outro
    db.prepare(`INSERT INTO caixa_movimentos (data, tenant_id, tipo, valor, forma, motivo, despesa_id) VALUES (?, ?, 'sangria', ?, ?, ?, ?)`)
      .run(data, req.tenantId || 1, valor, forma, descricao, info.lastInsertRowid);
    recalcularMovimentos(data, req.tenantId || 1); // só dinheiro afeta a gaveta
  });
  tx();
  res.json({ ok: true });
});

// DELETE /api/caixa/movimento/:id  -> apaga sangria/suprimento; se veio de despesa, apaga a despesa junto
router.delete('/movimento/:id', (req, res) => {
  const m = db.prepare('SELECT * FROM caixa_movimentos WHERE id = ? AND tenant_id = ?').get(req.params.id, req.tenantId || 1);
  if (***REMOVED***m) return res.status(404).json({ erro: 'Movimento não encontrado' });
  if (m.tipo === 'abertura') return res.status(400).json({ erro: 'A abertura do caixa não pode ser apagada por aqui.' });
  const tx = db.transaction(() => {
    db.prepare('DELETE FROM caixa_movimentos WHERE id = ? AND tenant_id = ?').run(m.id, req.tenantId || 1);
    if (m.despesa_id) db.prepare('DELETE FROM despesas WHERE id = ? AND tenant_id = ?').run(m.despesa_id, req.tenantId || 1); // despesa vinculada some junto
    recalcularMovimentos(m.data, req.tenantId || 1);
  });
  tx();
  res.json({ ok: true });
});

// POST /api/caixa/suprimento  body: { data?, valor, motivo, forma }
router.post('/suprimento', (req, res) => {
  const data = req.body.data || hojeLocal();
  const valor = parseFloat(req.body.valor) || 0;
  if (valor <= 0) return res.status(400).json({ erro: 'Informe um valor.' });
  const forma = normalizaForma(req.body.forma);
  garantirLinha(data, req.tenantId || 1);
  const tx = db.transaction(() => {
    db.prepare(`INSERT INTO caixa_movimentos (data, tenant_id, tipo, valor, forma, motivo) VALUES (?, ?, 'suprimento', ?, ?, ?)`)
      .run(data, req.tenantId || 1, valor, forma, req.body.motivo || null);
    recalcularMovimentos(data, req.tenantId || 1);
  });
  tx();
  res.json({ ok: true });
});

// POST /api/caixa/fechar  body: { data?, dinheiro_contado, conta_conferida?, obs }
router.post('/fechar', (req, res) => {
  const data = req.body.data || hojeLocal();
  const contado = parseFloat(req.body.dinheiro_contado) || 0;
  const contaConf = req.body.conta_conferida === '' || req.body.conta_conferida == null
    ? null : parseFloat(req.body.conta_conferida);
  garantirLinha(data, req.tenantId || 1);
  const c = db.prepare('SELECT * FROM caixa_dia WHERE data = ? AND tenant_id = ?').get(data, req.tenantId || 1);
  const esperado = dinheiroEsperado(c);
  const diferenca = +(contado - esperado).toFixed(2);
  db.prepare(`UPDATE caixa_dia SET dinheiro_contado = ?, diferenca = ?, conta_conferida = ?, fechado = 1,
              fechado_em = datetime('now','localtime'), obs = COALESCE(?, obs) WHERE data = ? AND tenant_id = ?`)
    .run(contado, diferenca, contaConf, req.body.obs || null, data, req.tenantId || 1);
  res.json({ ok: true, dinheiro_esperado: esperado, diferenca });
});

// POST /api/caixa/reabrir  body: { data? }  (corrige fechamento por engano)
router.post('/reabrir', (req, res) => {
  const data = req.body.data || hojeLocal();
  db.prepare(`UPDATE caixa_dia SET fechado = 0, fechado_em = NULL WHERE data = ? AND tenant_id = ?`).run(data, req.tenantId || 1);
  res.json({ ok: true });
});

// POST /api/caixa/conciliar  body: { data, conciliado, obs }
router.post('/conciliar', (req, res) => {
  const { data, conciliado, obs } = req.body;
  const d = data || hojeLocal();
  db.prepare(`
    INSERT INTO caixa_dia (data, tenant_id, conciliado, obs) VALUES (?, ?, ?, ?)
    ON CONFLICT(data, tenant_id) DO UPDATE SET conciliado=excluded.conciliado, obs=excluded.obs
  `).run(d, req.tenantId || 1, conciliado ? 1 : 0, obs || null);
  res.json({ ok: true });
});

// GET /api/caixa/mes?ano=2026&mes=06  -> resumo mensal
router.get('/mes', (req, res) => {
  const ano = req.query.ano || new Date().getFullYear();
  const mes = String(req.query.mes || (new Date().getMonth() + 1)).padStart(2, '0');
  const prefixo = `${ano}-${mes}`;
  const dias = db.prepare('SELECT * FROM caixa_dia WHERE data LIKE ? AND tenant_id = ? ORDER BY data').all(prefixo + '%', req.tenantId || 1);
  const total = dias.reduce((a, d) => ({
    bruto: a.bruto + d.total_bruto, liquido: a.liquido + d.total_liquido,
    lucro: a.lucro + d.lucro_dia, vendas: a.vendas + d.num_vendas
  }), { bruto: 0, liquido: 0, lucro: 0, vendas: 0 });
  res.json({ prefixo, dias, total });
});

module.exports = router;
