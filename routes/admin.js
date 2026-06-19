// ============================================================
// Backoffice Administrativo — Rotas do painel SaaS
// GET  /admin                     → dashboard HTML
// GET  /api/admin/clientes        → lista de clientes (tenants)
// GET  /api/admin/clientes/:id    → detalhes de um cliente
// PATCH /api/admin/clientes/:id   → bloquear/desbloquear cliente
// GET  /api/admin/financeiro      → resumo de faturamento (MRR, ARR, etc)
// ============================================================
const express = require('express');
const path = require('path');
const { db } = require('../db/database');
const router = express.Router();

const { limiteAdminPassword, verificarSenha } = require('../middleware/seguranca');

// --- Middleware: só o admin (você) acessa ---
// Se tiver ADMIN_SENHA_HASH no .env, exige password (via header, nunca via query***REMOVED***)
// Senão, assume que req.session.logado e papel=admin
function exigirAdminBackoffice(req, res, next) {
  const hashAdmin = process.env.ADMIN_SENHA_HASH || null;

  // Se tem hash configurado, exigir validação via header
  if (hashAdmin) {
    const senha = req.headers['x-admin-password'] || null;
    if (***REMOVED***senha || ***REMOVED***verificarSenha(senha, hashAdmin)) {
      return res.status(403).json({ erro: 'Acesso negado. Credenciais de admin incorretas.' });
    }
    return next();
  }

  // Senão, exigir que seja um usuário logado com papel admin
  if (***REMOVED***req.session?.logado || req.session?.papel ***REMOVED***== 'admin') {
    return res.status(403).json({ erro: 'Acesso negado. Admin requerido.' });
  }

  next();
}

// --- GET / → dashboard HTML (validação é no navegador via sessionStorage) ---
router.get('/', exigirAdminBackoffice, (req, res) => {
  res.sendFile(path.join(__dirname, '..', 'public', 'admin-dashboard.html'));
});

// --- GET /clientes → lista de clientes (tenants) ---
// Retorna: id, nome, email, status, data_criacao, últimas vendas, última atividade
router.get('/clientes', exigirAdminBackoffice, (req, res) => {
  try {
    const clientes = db.prepare(`
      SELECT
        t.id,
        t.nome_loja AS nome,
        t.email,
        t.status,
        t.data_cadastro AS data_criacao,
        COUNT(DISTINCT u.id) AS num_usuarios,
        NULL AS ultima_venda,
        MAX(u.criado_em) AS ultimo_acesso
      FROM tenants t
      LEFT JOIN usuarios u ON u.tenant_id = t.id
      GROUP BY t.id
      ORDER BY t.data_cadastro DESC
    `).all();
    res.json({ clientes });
  } catch (err) {
    console.error('[ADMIN] Erro ao buscar clientes:', err);
    return res.status(500).json({ erro: 'Erro ao buscar clientes' });
  }
});

// --- GET /clientes/:id → detalhes de um cliente ---
// Retorna: dados do tenant
router.get('/clientes/:id', exigirAdminBackoffice, (req, res) => {
  const clienteId = req.params.id;
  try {
    const tenant = db.prepare('SELECT * FROM tenants WHERE id = ?').get(clienteId);
    if (***REMOVED***tenant) {
      return res.status(404).json({ erro: 'Cliente não encontrado' });
    }

    res.json({
      tenant,
      assinaturas: [],
      mensagem: 'Detalhes do cliente'
    });
  } catch (err) {
    console.error('[ADMIN] Erro ao buscar cliente:', err);
    return res.status(500).json({ erro: 'Erro ao buscar cliente' });
  }
});

// --- PATCH /clientes/:id → bloquear/desbloquear cliente ---
router.patch('/clientes/:id', exigirAdminBackoffice, (req, res) => {
  const clienteId = req.params.id;
  const { status } = req.body; // 'ativo' ou 'bloqueado'

  if (***REMOVED***['ativo', 'bloqueado', 'teste'].includes(status)) {
    return res.status(400).json({ erro: 'Status inválido. Use "ativo", "bloqueado" ou "teste"' });
  }

  try {
    const result = db.prepare('UPDATE tenants SET status = ? WHERE id = ?')
      .run(status, clienteId);

    if (result.changes === 0) {
      return res.status(404).json({ erro: 'Cliente não encontrado' });
    }
    res.json({ sucesso: true, status });
  } catch (err) {
    console.error('[ADMIN] Erro ao atualizar cliente:', err);
    return res.status(500).json({ erro: 'Erro ao atualizar' });
  }
});

// --- GET /financeiro → resumo de faturamento ---
// Retorna: MRR (receita mensal recorrente), ARR, total cobrado, pendente, etc
router.get('/financeiro', exigirAdminBackoffice, (req, res) => {
  try {
    const financeiro = db.prepare(`
      SELECT
        COUNT(DISTINCT t.id) AS total_clientes,
        COUNT(DISTINCT CASE WHEN t.status = 'ativo' THEN t.id END) AS clientes_ativos,
        COUNT(DISTINCT CASE WHEN t.status = 'bloqueado' THEN t.id END) AS clientes_bloqueados,
        COALESCE(SUM(CASE WHEN c.status = 'pago' THEN c.valor ELSE 0 END), 0) AS total_recebido,
        COALESCE(SUM(CASE WHEN c.status = 'pendente' THEN c.valor ELSE 0 END), 0) AS total_pendente,
        COALESCE(SUM(CASE WHEN c.status = 'vencido' THEN c.valor ELSE 0 END), 0) AS total_vencido,
        COALESCE(AVG(c.valor), 0) AS ticket_medio
      FROM tenants t
      LEFT JOIN assinaturas a ON a.tenant_id = t.id
      LEFT JOIN cobracas c ON c.assinatura_id = a.id
    `).get();

    // Calcular MRR (receita média por cliente ativo × número de clientes ativos)
    const mrr = (financeiro.ticket_medio * financeiro.clientes_ativos) || 0;
    const arr = mrr * 12; // ARR = MRR × 12

    res.json({
      financeiro: {
        ...financeiro,
        mrr: Math.round(mrr * 100) / 100,
        arr: Math.round(arr * 100) / 100
      }
    });
  } catch (err) {
    console.error('[ADMIN] Erro ao buscar financeiro:', err);
    return res.status(500).json({ erro: 'Erro ao buscar financeiro' });
  }
});

module.exports = router;
