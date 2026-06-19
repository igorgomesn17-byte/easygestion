// ============================================================
// Rotas de Licença
// ============================================================
const express = require('express');
const router = express.Router();
const LicenseManager = require('../license');

// GET /api/license/check — Verificar status da licença
router.get('/check', (req, res) => {
  const status = LicenseManager.isLicensed();
  res.json(status);
});

// POST /api/license/activate — Ativar com código
router.post('/activate', (req, res) => {
  const { code } = req.body;

  if (***REMOVED***code) {
    return res.json({ success: false, error: 'Código não fornecido' });
  }

  const result = LicenseManager.saveLicense(code);
  res.json(result);
});

// GET /api/license/generate — Gerar novo código (ADMIN ONLY)
// Use em localhost:3000/api/license/generate?name=Cliente%20Teste
router.get('/generate', (req, res) => {
  // Apenas em desenvolvimento (remover em produção***REMOVED***)
  if (process.env.NODE_ENV === 'production') {
    return res.status(403).json({ error: 'Não permitido em produção' });
  }

  const { name = 'Cliente' } = req.query;
  const code = LicenseManager.generateCode(name);

  res.json({
    code: code,
    message: 'Código gerado (válido por 30 dias)',
    clientName: name
  });
});

module.exports = router;
