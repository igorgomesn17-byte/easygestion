// ============================================================
// API de AUDITORIA — logs de ações (LGPD/GDPR compliance)
// Apenas admin pode visualizar o histórico de auditoria
// ============================================================
const express = require('express');
const router = express.Router();
const { db } = require('../db/database');

// GET /api/auditoria — lista de ações auditadas (filtrado por tenant do usuário)
// Filtros opcionais: ?recurso=cliente&usuario_id=5&dias=30
router.get('/', (req, res) => {
  const { recurso, usuario_id, dias = 90, limite = 100, offset = 0 } = req.query;

  let sql = `
    SELECT
      id, usuario_id, usuario_nome, tenant_id,
      acao, recurso, recurso_id,
      antes, depois,
      ip, status_http, criado_em
    FROM auditoria
    WHERE tenant_id = ?
      AND criado_em >= datetime('now', '-' || ? || ' days')
  `;
  const params = [req.tenantId, dias];

  if (recurso) {
    sql += ` AND recurso = ?`;
    params.push(recurso);
  }

  if (usuario_id) {
    sql += ` AND usuario_id = ?`;
    params.push(parseInt(usuario_id, 10));
  }

  sql += ` ORDER BY criado_em DESC LIMIT ? OFFSET ?`;
  params.push(parseInt(limite, 10), parseInt(offset, 10));

  try {
    const logs = db.prepare(sql).all(...params);

    // Também retorna o total para paginação
    const countSql = `
      SELECT COUNT(*) as total FROM auditoria
      WHERE tenant_id = ?
        AND criado_em >= datetime('now', '-' || ? || ' days')
      ${recurso ? 'AND recurso = ?' : ''}
      ${usuario_id ? 'AND usuario_id = ?' : ''}
    `;
    const countParams = [req.tenantId, dias];
    if (recurso) countParams.push(recurso);
    if (usuario_id) countParams.push(parseInt(usuario_id, 10));

    const { total } = db.prepare(countSql).get(...countParams);

    res.json({ logs, total, limite: parseInt(limite, 10), offset: parseInt(offset, 10) });
  } catch (err) {
    console.error('[AUDITORIA] Erro ao listar:', err);
    res.status(500).json({ erro: 'Erro ao buscar logs de auditoria' });
  }
});

// GET /api/auditoria/:id — detalhes de uma ação auditada
router.get('/:id', (req, res) => {
  const { id } = req.params;

  try {
    const log = db.prepare(`
      SELECT * FROM auditoria
      WHERE id = ? AND tenant_id = ?
    `).get(parseInt(id, 10), req.tenantId);

    if (***REMOVED***log) {
      return res.status(404).json({ erro: 'Log de auditoria não encontrado' });
    }

    // Parse JSON se existir
    if (log.antes) log.antes = JSON.parse(log.antes);
    if (log.depois) log.depois = JSON.parse(log.depois);

    res.json(log);
  } catch (err) {
    console.error('[AUDITORIA] Erro ao buscar detalhe:', err);
    res.status(500).json({ erro: 'Erro ao buscar log de auditoria' });
  }
});

// GET /api/auditoria/usuario/:usuario_id — histórico de ações de um usuário
router.get('/usuario/:usuario_id', (req, res) => {
  const { usuario_id } = req.params;
  const { dias = 90 } = req.query;

  try {
    const logs = db.prepare(`
      SELECT
        id, usuario_id, usuario_nome, acao, recurso, recurso_id, ip, criado_em
      FROM auditoria
      WHERE usuario_id = ?
        AND tenant_id = ?
        AND criado_em >= datetime('now', '-' || ? || ' days')
      ORDER BY criado_em DESC
      LIMIT 100
    `).all(parseInt(usuario_id, 10), req.tenantId, dias);

    res.json(logs);
  } catch (err) {
    console.error('[AUDITORIA] Erro ao buscar por usuário:', err);
    res.status(500).json({ erro: 'Erro ao buscar logs' });
  }
});

// GET /api/auditoria/recurso/:recurso/:recurso_id — histórico de mudanças de um recurso
router.get('/recurso/:recurso/:recurso_id', (req, res) => {
  const { recurso, recurso_id } = req.params;

  try {
    const logs = db.prepare(`
      SELECT
        id, usuario_id, usuario_nome, acao, antes, depois, ip, criado_em
      FROM auditoria
      WHERE recurso = ?
        AND recurso_id = ?
        AND tenant_id = ?
      ORDER BY criado_em ASC
    `).all(recurso, parseInt(recurso_id, 10), req.tenantId);

    // Parse JSON
    logs.forEach(log => {
      if (log.antes) log.antes = JSON.parse(log.antes);
      if (log.depois) log.depois = JSON.parse(log.depois);
    });

    res.json(logs);
  } catch (err) {
    console.error('[AUDITORIA] Erro ao buscar por recurso:', err);
    res.status(500).json({ erro: 'Erro ao buscar logs' });
  }
});

// GET /api/auditoria/resumo — estatísticas de auditoria
router.get('/resumo/stats', (req, res) => {
  const { dias = 30 } = req.query;

  try {
    // Contagem por ação
    const porAcao = db.prepare(`
      SELECT acao, COUNT(*) as total FROM auditoria
      WHERE tenant_id = ? AND criado_em >= datetime('now', '-' || ? || ' days')
      GROUP BY acao
      ORDER BY total DESC
    `).all(req.tenantId, dias);

    // Contagem por recurso
    const porRecurso = db.prepare(`
      SELECT recurso, COUNT(*) as total FROM auditoria
      WHERE tenant_id = ? AND criado_em >= datetime('now', '-' || ? || ' days')
      GROUP BY recurso
      ORDER BY total DESC
    `).all(req.tenantId, dias);

    // Top usuarios (mais ações)
    const topUsuarios = db.prepare(`
      SELECT usuario_id, usuario_nome, COUNT(*) as total FROM auditoria
      WHERE tenant_id = ? AND criado_em >= datetime('now', '-' || ? || ' days')
      GROUP BY usuario_id, usuario_nome
      ORDER BY total DESC
      LIMIT 10
    `).all(req.tenantId, dias);

    // IPs com mais ações (suspeita de automação)
    const topIps = db.prepare(`
      SELECT ip, COUNT(*) as total FROM auditoria
      WHERE tenant_id = ? AND criado_em >= datetime('now', '-' || ? || ' days')
      GROUP BY ip
      ORDER BY total DESC
      LIMIT 5
    `).all(req.tenantId, dias);

    res.json({
      periodo_dias: dias,
      por_acao: porAcao,
      por_recurso: porRecurso,
      top_usuarios: topUsuarios,
      top_ips: topIps,
    });
  } catch (err) {
    console.error('[AUDITORIA] Erro ao gerar resumo:', err);
    res.status(500).json({ erro: 'Erro ao gerar estatísticas' });
  }
});

module.exports = router;
