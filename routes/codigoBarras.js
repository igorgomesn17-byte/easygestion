// ============================================================
// API de CODIGO DE BARRAS (gera imagem PNG do codigo para impressao)
// ============================================================
const express = require('express');
const router = express.Router();
const bwipjs = require('bwip-js');

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

// NOTA: existia aqui um GET /etiquetas/:produtoId que lia produtos sem filtrar por
// tenant. Como /api/codigo-barras e' publica (a <img> do codigo nao manda sessao),
// qualquer um sem login lia nome/codigo/preco de qualquer loja iterando o id. Ninguem
// consumia a rota -- etiquetas.html usa /api/produtos/:id, que ja isola por tenant.
// Removida em vez de remendada.

module.exports = router;
