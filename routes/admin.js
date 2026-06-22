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
// Exige: req.session.admin_autenticado === true (definido em POST /api/admin/login)
function exigirAdminBackoffice(req, res, next) {
  if (req.session?.admin_autenticado === true) {
    return next();
  }
  return res.status(403).json({ erro: 'Acesso negado. Faça login primeiro.' });
}

// --- GET / → dashboard HTML (validação é feita pelos fetch's das APIs, não aqui) ---
router.get('/', exigirAdminBackoffice, (req, res) => {
  res.sendFile(path.join(__dirname, '..', 'public', 'admin-dashboard.html'));
});

// --- POST /login → autentica admin via senha (cria sessão segura) ---
router.post('/login', limiteAdminPassword, (req, res) => {
  const { senha } = req.body;
  const hashAdmin = process.env.ADMIN_SENHA_HASH || null;

  if (***REMOVED***hashAdmin) {
    return res.status(400).json({ erro: 'Admin não configurado neste servidor.' });
  }

  if (***REMOVED***senha) {
    return res.status(400).json({ erro: 'Senha obrigatória.' });
  }

  if (***REMOVED***verificarSenha(String(senha), hashAdmin)) {
    return res.status(401).json({ erro: 'Senha incorreta.' });
  }

  // ✅ Autenticação bem-sucedida: marca a sessão como admin autenticado
  req.session.admin_autenticado = true;
  req.session.admin_login_em = new Date().toISOString();

  res.json({ sucesso: true, mensagem: 'Logado como admin' });
});

// --- POST /logout → encerra sessão admin ---
router.post('/logout', (req, res) => {
  req.session.admin_autenticado = false;
  res.json({ sucesso: true, mensagem: 'Deslogado' });
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
