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
const sqlite3 = require('sqlite3');
const router = express.Router();

// --- Middleware: só o admin (você) acessa ---
// Se tiver ADMIN_PASSWORD no .env, exige password
// Senão, assume que req.session.logado e papel=admin
function exigirAdminBackoffice(req, res, next) {
  const senhaAdmin = process.env.ADMIN_PASSWORD || null;

  // Se tem senha configurada, exigir ela
  if (senhaAdmin) {
    const senha = req.headers['x-admin-password'] || req.query.admin_password || null;
    if (senha ***REMOVED***== senhaAdmin) {
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

// --- Conectar ao banco ---
function db() {
  return new sqlite3.Database(
    path.join(__dirname, '..', 'db', 'dsstore.db'),
    sqlite3.OPEN_READONLY
  );
}

// --- GET / → dashboard HTML (validação é no navegador via sessionStorage) ---
router.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, '..', 'public', 'admin-dashboard.html'));
});

// --- GET /clientes → lista de clientes (tenants) ---
// Retorna: id, nome, email, status, data_criacao, últimas vendas, última atividade
router.get('/clientes', (req, res) => {
  const banco = db();

  // Query: pega tenants com contagem de usuários
  const sql = `
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
  `;

  banco.all(sql, (err, clientes) => {
    banco.close();
    if (err) {
      console.error('[ADMIN] Erro ao buscar clientes:', err);
      return res.status(500).json({ erro: 'Erro ao buscar clientes' });
    }
    res.json({ clientes });
  });
});

// --- GET /clientes/:id → detalhes de um cliente ---
// Retorna: dados do tenant
router.get('/clientes/:id', (req, res) => {
  const clienteId = req.params.id;
  const banco = db();

  // Buscar tenant
  banco.get(
    'SELECT * FROM tenants WHERE id = ?',
    [clienteId],
    (err, tenant) => {
      banco.close();
      if (err || ***REMOVED***tenant) {
        return res.status(404).json({ erro: 'Cliente não encontrado' });
      }

      res.json({
        tenant,
        assinaturas: [],
        mensagem: 'Detalhes do cliente'
      });
    }
  );
});

// --- PATCH /clientes/:id → bloquear/desbloquear cliente ---
router.patch('/clientes/:id', (req, res) => {
  const clienteId = req.params.id;
  const { status } = req.body; // 'ativo' ou 'bloqueado'

  if (***REMOVED***['ativo', 'bloqueado', 'teste', 'teste'].includes(status)) {
    return res.status(400).json({ erro: 'Status inválido. Use "ativo", "bloqueado" ou "teste"' });
  }

  // Abrir banco para ESCRITA
  const sqlite3 = require('sqlite3');
  const path = require('path');
  const bancoEscrita = new sqlite3.Database(
    path.join(__dirname, '..', 'db', 'dsstore.db')
  );

  bancoEscrita.run(
    'UPDATE tenants SET status = ? WHERE id = ?',
    [status, clienteId],
    function(err) {
      bancoEscrita.close();
      if (err) {
        return res.status(500).json({ erro: 'Erro ao atualizar' });
      }
      if (this.changes === 0) {
        return res.status(404).json({ erro: 'Cliente não encontrado' });
      }
      res.json({ sucesso: true, status });
    }
  );
});

// --- GET /financeiro → resumo de faturamento ---
// Retorna: MRR (receita mensal recorrente), ARR, total cobrado, pendente, etc
router.get('/financeiro', (req, res) => {
  const banco = db();

  const sql = `
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
  `;

  banco.get(sql, (err, financeiro) => {
    banco.close();
    if (err) {
      console.error('[ADMIN] Erro ao buscar financeiro:', err);
      return res.status(500).json({ erro: 'Erro ao buscar financeiro' });
    }

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
  });
});

module.exports = router;
