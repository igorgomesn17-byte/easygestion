// ============================================================
// API de DESPESAS (contas a pagar, despesas fixas e variaveis)
// Tudo que SAI do caixa. Base do fluxo de caixa e do DRE.
// ============================================================
const express = require('express');
const router = express.Router();
const { db } = require('../db/database');
const { hojeLocal } = require('../lib/datas');

// GET /api/despesas?mes=YYYY-MM&centro=&status=  -> lista despesas do mes
router.get('/', (req, res) => {
  const mes = req.query.mes || hojeLocal().slice(0, 7);
  let sql = "SELECT * FROM despesas WHERE substr(data_competencia,1,7) = ? AND recorrente = 0 AND tenant_id = ?";
  const params = [mes, req.tenantId];
  if (req.query.centro) { sql += ' AND centro = ?'; params.push(req.query.centro); }
  if (req.query.status === 'pago') sql += ' AND pago = 1';
  if (req.query.status === 'apagar') sql += ' AND pago = 0';
  sql += ' ORDER BY pago ASC, vencimento ASC, id DESC';
  const despesas = db.prepare(sql).all(...params);

  // resumo do mes
  const resumo = despesas.reduce((a, d) => {
    a.total += d.valor;
    if (d.pago) a.pago += d.valor; else a.apagar += d.valor;
    if (d.centro === 'empresa') a.empresa += d.valor; else a.pessoal += d.valor;
    return a;
  }, { total: 0, pago: 0, apagar: 0, empresa: 0, pessoal: 0 });
  for (const k in resumo) resumo[k] = +resumo[k].toFixed(2);

  res.json({ despesas, resumo, mes });
});

// GET /api/despesas/recorrentes -> modelos de despesa fixa
router.get('/recorrentes', (req, res) => {
  res.json(db.prepare('SELECT * FROM despesas WHERE recorrente = 1 AND tenant_id = ? ORDER BY categoria, descricao').all(req.tenantId));
});

// GET /api/despesas/a-pagar -> contas a pagar (nao pagas, todas), ordenado por vencimento
router.get('/a-pagar', (req, res) => {
  const rows = db.prepare("SELECT * FROM despesas WHERE pago = 0 AND recorrente = 0 AND tenant_id = ? ORDER BY vencimento ASC").all(req.tenantId);
  res.json(rows);
});

// POST /api/despesas -> cria despesa
router.post('/', (req, res) => {
  const { descricao, valor, categoria, tipo, centro, data_competencia, vencimento, pago, forma_pagamento, recorrente, obs } = req.body;
  if (!descricao) return res.status(400).json({ erro: 'Descricao obrigatoria' });
  const v = parseFloat(valor) || 0;
  const comp = data_competencia || (hojeLocal().slice(0, 7) + '-01');
  const info = db.prepare(`
    INSERT INTO despesas (tenant_id, descricao, valor, categoria, tipo, centro, data_competencia, vencimento, data_pagamento, pago, forma_pagamento, recorrente, obs)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(req.tenantId, descricao, v, categoria || null, tipo || 'variavel', centro || 'empresa',
    comp, vencimento || null, (pago ? (req.body.data_pagamento || hojeLocal()) : null),
    pago ? 1 : 0, forma_pagamento || null, recorrente ? 1 : 0, obs || null);
  res.status(201).json({ id: info.lastInsertRowid });
});

// PUT /api/despesas/:id
router.put('/:id', (req, res) => {
  const d = db.prepare('SELECT id FROM despesas WHERE id = ? AND tenant_id = ?').get(req.params.id, req.tenantId);
  if (!d) return res.status(404).json({ erro: 'Despesa nao encontrada' });
  const { descricao, valor, categoria, tipo, centro, data_competencia, vencimento, pago, forma_pagamento, obs } = req.body;
  db.prepare(`
    UPDATE despesas SET descricao=?, valor=?, categoria=?, tipo=?, centro=?, data_competencia=?,
      vencimento=?, pago=?, data_pagamento=?, forma_pagamento=?, obs=? WHERE id=? AND tenant_id=?
  `).run(descricao, parseFloat(valor) || 0, categoria || null, tipo || 'variavel', centro || 'empresa',
    data_competencia, vencimento || null, pago ? 1 : 0,
    pago ? (req.body.data_pagamento || hojeLocal()) : null, forma_pagamento || null, obs || null, req.params.id, req.tenantId);
  res.json({ ok: true });
});

// POST /api/despesas/:id/pagar -> marca como paga + opcionalmente cria movimento no caixa
router.post('/:id/pagar', (req, res) => {
  const despesaId = req.params.id;
  const dataPagamento = req.body.data_pagamento || hojeLocal();
  const formaPagemento = req.body.forma_pagamento || null;

  // busca a despesa
  const d = db.prepare('SELECT * FROM despesas WHERE id = ? AND tenant_id = ?').get(despesaId, req.tenantId);
  if (!d) return res.status(404).json({ erro: 'Despesa não encontrada' });

  const tx = db.transaction(() => {
    // 1. marca como paga
    db.prepare('UPDATE despesas SET pago = 1, data_pagamento = ?, forma_pagamento = ? WHERE id = ? AND tenant_id = ?')
      .run(dataPagamento, formaPagemento, despesaId, req.tenantId);

    // 2. se forma de pagamento informada, cria movimento no caixa (sangria)
    if (formaPagemento) {
      // verifica se caixa do dia existe
      const cxDia = db.prepare('SELECT id, aberto FROM caixa_dia WHERE data = ? AND tenant_id = ?').get(dataPagamento, req.tenantId);

      if (cxDia && cxDia.aberto) {
        // caixa aberto: cria movimento de sangria
        const insMovimento = db.prepare(`
          INSERT INTO caixa_movimentos (data, tenant_id, tipo, valor, forma, motivo, despesa_id)
          VALUES (?, ?, 'sangria', ?, ?, ?, ?)
        `).run(dataPagamento, req.tenantId, d.valor, formaPagemento, `Pagamento de ${d.descricao}`, despesaId);

        // recalcula sangrias/suprimentos do dia (só dinheiro afeta a gaveta)
        if (formaPagemento === 'dinheiro') {
          const sangrias = db.prepare(`
            SELECT COALESCE(SUM(valor), 0) AS v FROM caixa_movimentos
            WHERE data = ? AND tenant_id = ? AND tipo = 'sangria' AND forma = 'dinheiro'
          `).get(dataPagamento, req.tenantId).v;
          db.prepare('UPDATE caixa_dia SET sangrias = ? WHERE data = ? AND tenant_id = ?').run(sangrias, dataPagamento, req.tenantId);
        }
      }
    }
  });

  tx();
  res.json({ ok: true });
});

// DELETE /api/despesas/:id
router.delete('/:id', (req, res) => {
  db.prepare('DELETE FROM despesas WHERE id = ? AND tenant_id = ?').run(req.params.id, req.tenantId);
  res.json({ ok: true });
});

// POST /api/despesas/gerar-mes -> gera as despesas recorrentes (fixas) para um mes
// body: { mes: 'YYYY-MM' }
router.post('/gerar-mes', (req, res) => {
  const mes = req.body.mes || hojeLocal().slice(0, 7);
  const comp = mes + '-01';
  const modelos = db.prepare('SELECT * FROM despesas WHERE recorrente = 1 AND tenant_id = ?').all(req.tenantId);
  let geradas = 0, jaExistiam = 0;
  const tx = db.transaction(() => {
    for (const m of modelos) {
      // evita duplicar: ja existe despesa gerada desse modelo nesse mes?
      const existe = db.prepare(
        "SELECT id FROM despesas WHERE recorrente_id = ? AND substr(data_competencia,1,7) = ? AND tenant_id = ?"
      ).get(m.id, mes, req.tenantId);
      if (existe) { jaExistiam++; continue; }
      db.prepare(`
        INSERT INTO despesas (tenant_id, descricao, valor, categoria, tipo, centro, data_competencia, vencimento, pago, recorrente, recorrente_id)
        VALUES (?, ?, ?, ?, 'fixa', ?, ?, ?, 0, 0, ?)
      `).run(req.tenantId, m.descricao, m.valor, m.categoria, m.centro || 'empresa', comp,
             m.vencimento ? mes + '-' + (m.vencimento.slice(-2)) : null, m.id);
      geradas++;
    }
  });
  tx();
  res.json({ ok: true, geradas, jaExistiam, mes });
});

module.exports = router;
