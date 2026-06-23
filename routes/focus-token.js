const express = require('express');
const router = express.Router();
const { db } = require('../db/database');

// POST /focus-token — recebe { token, ambiente } e salva
router.post('/', (req, res) => {
  console.log('[FOCUS TOKEN] POST chegou', { body: req.body, tenantId: req.tenantId });

  if (!req.tenantId) {
    return res.status(400).json({ erro: 'Tenant ID não encontrado' });
  }

  const { token, ambiente } = req.body;
  if (!token || !ambiente) {
    return res.status(400).json({ erro: 'Token e ambiente são obrigatórios' });
  }

  if (!['homologacao', 'producao'].includes(ambiente)) {
    return res.status(400).json({ erro: 'Ambiente deve ser homologacao ou producao' });
  }

  try {
    const chave = `focus_token_${ambiente}`;
    db.prepare('INSERT INTO config (chave, valor, tenant_id) VALUES (?, ?, ?) ON CONFLICT(chave, tenant_id) DO UPDATE SET valor=excluded.valor')
      .run(chave, token, req.tenantId);

    console.log('[FOCUS TOKEN] Salvo com sucesso');
    res.json({ ok: true, mensagem: `Token de ${ambiente} salvo com segurança!` });
  } catch (e) {
    console.error('[TOKEN SAVE ERROR]', e);
    res.status(500).json({ erro: 'Erro ao salvar: ' + e.message });
  }
});

// GET /focus-token — retorna se tem token
router.get('/', (req, res) => {
  if (!req.tenantId) {
    return res.status(400).json({ erro: 'Tenant ID não encontrado' });
  }

  const stmt = db.prepare('SELECT valor FROM config WHERE chave = ? AND tenant_id = ?');
  const tokenHomolog = stmt.get('focus_token_homologacao', req.tenantId);
  const tokenProd = stmt.get('focus_token_producao', req.tenantId);

  res.json({
    tem_token_homologacao: !!(tokenHomolog && tokenHomolog.valor),
    tem_token_producao: !!(tokenProd && tokenProd.valor)
  });
});

// DELETE /focus-token/:ambiente — remove token
router.delete('/:ambiente', (req, res) => {
  if (!req.tenantId) {
    return res.status(400).json({ erro: 'Tenant ID não encontrado' });
  }

  const { ambiente } = req.params;
  if (!['homologacao', 'producao'].includes(ambiente)) {
    return res.status(400).json({ erro: 'Ambiente inválido' });
  }

  const chave = `focus_token_${ambiente}`;
  db.prepare("DELETE FROM config WHERE chave=? AND tenant_id = ?").run(chave, req.tenantId);
  res.json({ ok: true, mensagem: `Token de ${ambiente} removido` });
});

module.exports = router;
