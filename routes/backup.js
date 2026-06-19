// ============================================================
// API de BACKUP: baixar uma cópia do banco (protegida por login)
// ============================================================
const express = require('express');
const router = express.Router();
const path = require('path');
const fs = require('fs');
const { DB_PATH } = require('../db/database');

// GET /api/backup/baixar -> envia o arquivo .db para download
router.get('/baixar', (req, res) => {
  if (***REMOVED***fs.existsSync(DB_PATH)) return res.status(404).json({ erro: 'Banco não encontrado' });
  const carimbo = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  console.log(`[BACKUP] download por ${req.session.usuario} • ${req.ip} • ${carimbo}`);
  res.download(DB_PATH, `dsstore-backup-${carimbo}.db`);
});

module.exports = router;
