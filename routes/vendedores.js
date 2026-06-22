// ============================================================
// API de VENDEDORES (cadastro + % comissao + desempenho)
// ============================================================
const express = require('express');
const router = express.Router();
const { db } = require('../db/database');
const { hojeLocal } = require('../lib/datas');

// GET /api/vendedores
router.get('/', (req, res) => {
  const lista = db.prepare('SELECT * FROM vendedores WHERE ativo = 1 AND tenant_id = ? ORDER BY nome').all(req.tenantId);
  // desempenho do mes por vendedor
  const mesPrefixo = hojeLocal().slice(0, 7);
  const desemp = db.prepare(`
    SELECT vendedor_id, COUNT(*) AS vendas, COALESCE(SUM(total),0) AS total, COALESCE(SUM(comissao_valor),0) AS comissao
    FROM vendas WHERE date(data_hora) LIKE ? AND vendedor_id IS NOT NULL AND tenant_id = ? GROUP BY vendedor_id
  `).all(mesPrefixo + '%', req.tenantId);
  const map = {}; desemp.forEach(d => map[d.vendedor_id] = d);
  for (const v of lista) {
    const d = map[v.id] || { vendas: 0, total: 0, comissao: 0 };
    v.mes = { vendas: d.vendas, total: +d.total.toFixed(2), comissao: +d.comissao.toFixed(2) };
  }
  res.json(lista);
});

// POST /api/vendedores
router.post('/', (req, res) => {
  const { nome, telefone, comissao_pct } = req.body;
  if (***REMOVED***nome) return res.status(400).json({ erro: 'Nome obrigatorio' });
  const info = db.prepare('INSERT INTO vendedores (tenant_id, nome, telefone, comissao_pct) VALUES (?, ?, ?, ?)')
    .run(req.tenantId, nome, telefone || null, parseFloat(comissao_pct) || 0);
  res.status(201).json({ id: info.lastInsertRowid });
});

// PUT /api/vendedores/:id
router.put('/:id', (req, res) => {
  const { nome, telefone, comissao_pct } = req.body;
  db.prepare('UPDATE vendedores SET nome=?, telefone=?, comissao_pct=? WHERE id=? AND tenant_id=?')
    .run(nome, telefone || null, parseFloat(comissao_pct) || 0, req.params.id, req.tenantId);
  res.json({ ok: true });
});

// DELETE /api/vendedores/:id -> inativa
router.delete('/:id', (req, res) => {
  db.prepare('UPDATE vendedores SET ativo = 0 WHERE id = ? AND tenant_id = ?').run(req.params.id, req.tenantId);
  res.json({ ok: true });
});

module.exports = router;
