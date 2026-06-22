// ============================================================
// Backoffice Administrativo — Rotas do painel SaaS (LGPD-compliant)
// GET  /admin                     → dashboard HTML
// GET  /api/admin/clientes        → lista de clientes (tenants)
// GET  /api/admin/clientes/:id    → detalhes de um cliente
// PATCH /api/admin/clientes/:id   → bloquear/desbloquear cliente (+ email)
// DELETE /api/admin/clientes/:id  → deletar cliente (com auditoria)
// GET  /api/admin/financeiro      → resumo de faturamento (MRR, ARR, etc)
// GET  /api/admin/auditoria       → histórico de ações administrativas (LGPD)
// ============================================================
const express = require('express');
const path = require('path');
const { db } = require('../db/database');
const { exigirPapel } = require('../middleware/seguranca');
const { auditarAcao, buscarAuditoria } = require('../middleware/auditoria');
const { enviarEmail, templateContaBloqueada, templateContaReativada } = require('../lib/email');
const router = express.Router();

const { limiteAdminPassword, verificarSenha, hashSenha } = require('../middleware/seguranca');

// --- Middleware: só admin acessa o backoffice ---
// Verifica: 1) logado na sessão, 2) papel === 'admin'
function exigirAdminBackoffice(req, res, next) {
  // Se não está logado, nega
  if (***REMOVED***req.session?.logado) {
    return res.status(401).json({ erro: 'Não autenticado. Faça login primeiro.', login: true });
  }

  // Se está logado mas não é admin, nega
  if (req.session.papel ***REMOVED***== 'admin') {
    return res.status(403).json({ erro: 'Acesso negado. Apenas admins.' });
  }

  return next();
}

// --- GET / → dashboard HTML ---
router.get('/', exigirAdminBackoffice, (req, res) => {
  res.sendFile(path.join(__dirname, '..', 'public', 'admin-dashboard.html'));
});

// --- POST /login → autentica admin (usuário admin real na tabela DE usuarios) ---
router.post('/login', limiteAdminPassword, (req, res) => {
  const { nome, senha } = req.body;

  if (***REMOVED***nome || ***REMOVED***senha) {
    return res.status(400).json({ erro: 'Nome de usuário e senha obrigatórios.' });
  }

  try {
    // 1️⃣ Tentar buscar usuário admin na TABELA (novo sistema LGPD-compliant)
    let usuario = db.prepare(
      'SELECT id, tenant_id, nome, email, senha_hash, papel FROM usuarios WHERE nome = ? AND papel = ? AND ativo = 1'
    ).get(nome, 'admin');

    // 2️⃣ Se não encontrou, tentar ADMIN_SENHA_HASH do .env (compatibilidade)
    let eh_admin_env = false;
    if (***REMOVED***usuario) {
      const hashAdmin = process.env.ADMIN_SENHA_HASH || null;
      if (hashAdmin && verificarSenha(String(senha), hashAdmin)) {
        eh_admin_env = true;
      } else {
        return res.status(401).json({ erro: 'Usuário ou senha incorretos.' });
      }
    }

    // 3️⃣ Se encontrou usuário na tabela, validar senha
    if (usuario && ***REMOVED***verificarSenha(String(senha), usuario.senha_hash)) {
      return res.status(401).json({ erro: 'Usuário ou senha incorretos.' });
    }

    // ✅ Autenticação bem-sucedida: criar sessão
    req.session.logado = true;
    req.session.usuario_id = usuario?.id || null;
    req.session.nome = nome;
    req.session.email = usuario?.email || null;
    req.session.papel = 'admin';
    req.session.tenant_id = usuario?.tenant_id || 1; // admin sempre é tenant 1
    req.session.login_em = new Date().toISOString();

    console.log(`[ADMIN] Login bem-sucedido: ${nome} (${eh_admin_env ? 'env' : 'db'})`);
    res.json({ sucesso: true, mensagem: 'Logado como administrador', usuario: nome });
  } catch (err) {
    console.error('[ADMIN] Erro ao fazer login:', err);
    return res.status(500).json({ erro: 'Erro ao processar login' });
  }
});

// --- POST /logout → encerra sessão admin ---
router.post('/logout', (req, res) => {
  const usuario = req.session?.nome || 'unknown';
  req.session.destroy((err) => {
    console.log(`[ADMIN] Logout: ${usuario}`);
    if (err) {
      return res.status(500).json({ erro: 'Erro ao desconectar' });
    }
    res.json({ sucesso: true, mensagem: 'Deslogado com sucesso' });
  });
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

// --- PATCH /clientes/:id → bloquear/desbloquear cliente (+ AUDITORIA + EMAIL) ---
router.patch('/clientes/:id', exigirAdminBackoffice, async (req, res) => {
  const clienteId = req.params.id;
  const { status, motivo } = req.body; // status: 'ativo' ou 'bloqueado'; motivo: opcional

  if (***REMOVED***['ativo', 'bloqueado', 'teste'].includes(status)) {
    return res.status(400).json({ erro: 'Status inválido. Use "ativo", "bloqueado" ou "teste"' });
  }

  try {
    // Buscar dados ANTES
    const antes = db.prepare('SELECT * FROM tenants WHERE id = ?').get(clienteId);
    if (***REMOVED***antes) {
      return res.status(404).json({ erro: 'Cliente não encontrado' });
    }

    // Detectar mudança de status (para saber se precisa notificar)
    const statusAnterior = antes.status;
    const statusNovo = status;
    const houveMudanca = statusAnterior ***REMOVED***== statusNovo;

    // Atualizar
    const result = db.prepare('UPDATE tenants SET status = ? WHERE id = ?')
      .run(status, clienteId);

    if (result.changes === 0) {
      return res.status(404).json({ erro: 'Cliente não encontrado' });
    }

    // Buscar dados DEPOIS
    const depois = db.prepare('SELECT * FROM tenants WHERE id = ?').get(clienteId);

    // ✅ AUDITORIA
    auditarAcao(req, {
      acao: 'PATCH_tenant_status',
      recurso: 'tenants',
      recurso_id: clienteId,
      antes,
      depois,
      status: 200,
    });

    // ✅ NOTIFICAÇÃO: se mudou pra 'bloqueado', avisar cliente
    if (houveMudanca && statusNovo === 'bloqueado' && antes.email) {
      const html = templateContaBloqueada(antes.nome_loja, motivo);
      enviarEmail(antes.email, '⚠️ Sua conta foi bloqueada', html).catch(err => {
        console.error('[EMAIL] Erro ao notificar bloqueio:', err.message);
        // Não falha a requisição por erro de email
      });
      console.log(`[NOTIF] Cliente ${antes.nome_loja} (${antes.email}) foi bloqueado`);
    }

    // ✅ NOTIFICAÇÃO: se mudou pra 'ativo', avisar que foi reativado
    if (houveMudanca && statusNovo === 'ativo' && statusAnterior === 'bloqueado' && antes.email) {
      const html = templateContaReativada(antes.nome_loja);
      enviarEmail(antes.email, '✅ Sua conta foi reativada', html).catch(err => {
        console.error('[EMAIL] Erro ao notificar reativação:', err.message);
      });
      console.log(`[NOTIF] Cliente ${antes.nome_loja} (${antes.email}) foi reativado`);
    }

    res.json({ sucesso: true, status, notificacao: houveMudanca ? 'Email enviado ao cliente' : null });
  } catch (err) {
    console.error('[ADMIN] Erro ao atualizar cliente:', err);
    return res.status(500).json({ erro: 'Erro ao atualizar' });
  }
});

// --- DELETE /clientes/:id → deletar cliente (hard delete com cascata + AUDITORIA) ---
router.delete('/clientes/:id', exigirAdminBackoffice, (req, res) => {
  const clienteId = req.params.id;

  try {
    // Buscar dados ANTES de deletar (para auditoria)
    const tenant = db.prepare('SELECT * FROM tenants WHERE id = ?').get(clienteId);
    if (***REMOVED***tenant) {
      return res.status(404).json({ erro: 'Cliente não encontrado' });
    }

    // Deletar tudo relacionado ao tenant (cascata)
    db.transaction(() => {
      // Deletar dados do tenant
      db.prepare('DELETE FROM tokens_verificacao WHERE usuario_id IN (SELECT id FROM usuarios WHERE tenant_id = ?)').run(clienteId);
      db.prepare('DELETE FROM usuarios WHERE tenant_id = ?').run(clienteId);
      db.prepare('DELETE FROM cobracas WHERE assinatura_id IN (SELECT id FROM assinaturas WHERE tenant_id = ?)').run(clienteId);
      db.prepare('DELETE FROM assinaturas WHERE tenant_id = ?').run(clienteId);
      db.prepare('DELETE FROM clientes WHERE tenant_id = ?').run(clienteId);
      db.prepare('DELETE FROM produtos WHERE tenant_id = ?').run(clienteId);
      db.prepare('DELETE FROM vendas WHERE tenant_id = ?').run(clienteId);
      db.prepare('DELETE FROM trocas WHERE tenant_id = ?').run(clienteId);
      db.prepare('DELETE FROM despesas WHERE tenant_id = ?').run(clienteId);
      db.prepare('DELETE FROM config WHERE tenant_id = ?').run(clienteId);

      // Por fim, deletar o tenant
      db.prepare('DELETE FROM tenants WHERE id = ?').run(clienteId);
    })();

    // ✅ AUDITORIA: registrar a deleção
    auditarAcao(req, {
      acao: 'DELETE_tenant',
      recurso: 'tenants',
      recurso_id: clienteId,
      antes: tenant,
      depois: null,
      status: 200,
    });

    console.log(`[ADMIN] Cliente deletado: ${clienteId} (por ${req.session?.nome || 'admin-env'})`);
    res.json({ sucesso: true, mensagem: 'Cliente deletado permanentemente' });
  } catch (err) {
    console.error('[ADMIN] Erro ao deletar cliente:', err);
    return res.status(500).json({ erro: 'Erro ao deletar cliente' });
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

// --- GET /auditoria → histórico de ações administrativas (LGPD/GDPR compliance) ---
// Query params: recurso, recurso_id, usuario_id, dias (default 90)
router.get('/auditoria', exigirAdminBackoffice, (req, res) => {
  try {
    const filtros = {
      recurso: req.query.recurso || null,
      recurso_id: req.query.recurso_id ? parseInt(req.query.recurso_id, 10) : null,
      usuario_id: req.query.usuario_id ? parseInt(req.query.usuario_id, 10) : null,
      tenant_id: req.query.tenant_id ? parseInt(req.query.tenant_id, 10) : null,
      dias: req.query.dias ? parseInt(req.query.dias, 10) : 90,
    };

    const registros = buscarAuditoria(filtros);
    res.json({ auditoria: registros, total: registros.length });
  } catch (err) {
    console.error('[ADMIN] Erro ao buscar auditoria:', err);
    return res.status(500).json({ erro: 'Erro ao buscar auditoria' });
  }
});

// --- GET /auditoria/:id → detalhes completos de um registro de auditoria ---
router.get('/auditoria/:id', exigirAdminBackoffice, (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    const registro = db.prepare('SELECT * FROM auditoria WHERE id = ?').get(id);

    if (***REMOVED***registro) {
      return res.status(404).json({ erro: 'Registro de auditoria não encontrado' });
    }

    // Parse JSON antes e depois (pode ser nulo)
    if (registro.antes) {
      try {
        registro.antes = JSON.parse(registro.antes);
      } catch (e) { /* deixar como string */ }
    }
    if (registro.depois) {
      try {
        registro.depois = JSON.parse(registro.depois);
      } catch (e) { /* deixar como string */ }
    }

    res.json({ auditoria: registro });
  } catch (err) {
    console.error('[ADMIN] Erro ao buscar registro de auditoria:', err);
    return res.status(500).json({ erro: 'Erro ao buscar registro' });
  }
});

module.exports = router;
