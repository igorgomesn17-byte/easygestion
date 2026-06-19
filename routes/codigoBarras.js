// ============================================================
// API de CODIGO DE BARRAS (gera imagem PNG do codigo para impressao)
// ============================================================
const express = require('express');
const router = express.Router();
const bwipjs = require('bwip-js');
const { db } = require('../db/database');

// GET /api/codigo-barras/:codigo.png  -> imagem do codigo de barras
router.get('/:codigo.png', async (req, res) => {
  try {
    const png = await bwipjs.toBuffer({
      bcid: 'ean13',
      text: req.params.codigo,
      scale: 3,
      height: 12,
      includetext: true,
      textxalign: 'center',
    });
    res.set('Content-Type', 'image/png');
    res.send(png);
  } catch (e) {
    // fallback: code128 (aceita qualquer texto)
    try {
      const png = await bwipjs.toBuffer({ bcid: 'code128', text: req.params.codigo, scale: 3, height: 12, includetext: true, textxalign: 'center' });
      res.set('Content-Type', 'image/png');
      res.send(png);
    } catch (e2) {
      res.status(400).json({ erro: e2.message });
    }
  }
});

// GET /api/codigo-barras/etiquetas/:produtoId  -> dados para folha de etiquetas
router.get('/etiquetas/:produtoId', (req, res) => {
  const p = db.prepare('SELECT codigo, codigo_barras, nome, preco_venda FROM produtos WHERE id = ?').get(req.params.produtoId);
  if (***REMOVED***p) return res.status(404).json({ erro: 'Produto nao encontrado' });
  res.json(p);
});

module.exports = router;
