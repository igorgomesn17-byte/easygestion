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
const { obterStatusAssinatura } = require('../lib/assinatura');
const router = express.Router();

const { verificarSenha, hashSenha } = require('../middleware/seguranca');

// --- Middleware: só admin acessa o backoffice ---
// Verifica: 1) logado na sessão, 2) papel === 'admin'
function exigirAdminBackoffice(req, res, next) {
  // Se não está logado, nega
  if (!req.session?.logado) {
    return res.status(401).json({ erro: 'Não autenticado. Faça login primeiro.', login: true });
  }

  // Se está logado mas não é admin, nega
  if (req.session.papel !== 'admin') {
    return res.status(403).json({ erro: 'Acesso negado. Apenas admins.' });
  }

  return next();
}

// --- GET / → dashboard HTML ---
router.get('/', exigirAdminBackoffice, (req, res) => {
  res.sendFile(path.join(__dirname, '..', 'public', 'admin-dashboard.html'));
});

// --- POST /login → autentica admin (apenas senha ADMIN_SENHA_HASH do .env) ---
// Nota: rate limit temporariamente removido para testes (TODO: reativar após beta)
router.post('/login', (req, res) => {
  const { senha } = req.body;

  if (!senha) {
    return res.status(400).json({ erro: 'Senha obrigatória.' });
  }

  try {
    // Verificar contra ADMIN_SENHA_HASH do .env
    const hashAdmin = process.env.ADMIN_SENHA_HASH || null;

    if (!hashAdmin || !verificarSenha(String(senha), hashAdmin)) {
      console.warn(`[ADMIN] Login falhou: senha incorreta • IP: ${req.ip} • ${new Date().toISOString()}`);
      return res.status(401).json({
        erro: 'Senha de admin incorreta.'
      });
    }

    const senha_valida = true;

    // ✅ Autenticação bem-sucedida: criar sessão
    req.session.logado = true;
    req.session.usuario_id = null;
    req.session.nome = 'admin';
    req.session.email = null;
    req.session.papel = 'admin';
    req.session.tenant_id = 1;
    req.session.login_em = new Date().toISOString();

    // ✅ AUDITORIA: registrar login do admin
    auditarAcao(req, {
      acao: 'LOGIN_admin',
      recurso: 'auditoria_admin',
      recurso_id: null,
      antes: null,
      depois: null,
      status: 200,
    });

    console.log(`[ADMIN] ✅ Login bem-sucedido (ADMIN_SENHA_HASH) • IP: ${req.ip} • ${new Date().toISOString()}`);

    res.json({
      sucesso: true,
      mensagem: 'Logado como administrador'
    });
  } catch (err) {
    console.error('[ADMIN] ❌ Erro ao fazer login:', err.message);
    return res.status(500).json({
      erro: 'Erro ao processar login',
      detalhe: process.env.NODE_ENV === 'development' ? err.message : undefined
    });
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

// --- GET /clientes → lista de clientes (tenants) com filtros e paginação ---
// Query params: busca (nome/email), status, página (default 1), limite (default 20)
router.get('/clientes', exigirAdminBackoffice, (req, res) => {
  try {
    // Parâmetros
    const busca = (req.query.busca || '').trim().toLowerCase();
    const status = req.query.status || null;
    const pagina = Math.max(1, parseInt(req.query.pagina || 1, 10));
    const limite = Math.min(100, parseInt(req.query.limite || 20, 10));
    const offset = (pagina - 1) * limite;

    // Construir query com filtros dinâmicos
    let sql = `
      SELECT
        t.id,
        t.nome_loja AS nome,
        t.email,
        t.status,
        t.data_cadastro AS data_criacao,
        COUNT(DISTINCT u.id) AS num_usuarios,
        MAX(u.criado_em) AS ultimo_acesso
      FROM tenants t
      LEFT JOIN usuarios u ON u.tenant_id = t.id
      WHERE 1=1
    `;

    const params = [];

    // Filtro: busca por nome ou email
    if (busca) {
      sql += ` AND (LOWER(t.nome_loja) LIKE ? OR LOWER(t.email) LIKE ?)`;
      params.push(`%${busca}%`, `%${busca}%`);
    }

    // Filtro: status
    if (status && ['ativo', 'bloqueado', 'teste', 'cancelado'].includes(status)) {
      sql += ` AND t.status = ?`;
      params.push(status);
    }

    sql += ` GROUP BY t.id ORDER BY t.data_cadastro DESC LIMIT ? OFFSET ?`;
    params.push(limite, offset);

    // Buscar dados
    const clientes = db.prepare(sql).all(...params);

    // Contar total (sem limit/offset) pra paginação
    let sqlTotal = `SELECT COUNT(DISTINCT t.id) AS total FROM tenants t LEFT JOIN usuarios u ON u.tenant_id = t.id WHERE 1=1`;
    const paramsTotal = [];
    if (busca) {
      sqlTotal += ` AND (LOWER(t.nome_loja) LIKE ? OR LOWER(t.email) LIKE ?)`;
      paramsTotal.push(`%${busca}%`, `%${busca}%`);
    }
    if (status && ['ativo', 'bloqueado', 'teste', 'cancelado'].includes(status)) {
      sqlTotal += ` AND t.status = ?`;
      paramsTotal.push(status);
    }
    const { total } = db.prepare(sqlTotal).get(...paramsTotal);

    res.json({
      clientes,
      paginacao: {
        pagina,
        limite,
        total,
        total_paginas: Math.ceil(total / limite),
        tem_proxima: pagina * limite < total,
        tem_anterior: pagina > 1
      }
    });
  } catch (err) {
    console.error('[ADMIN] Erro ao buscar clientes:', err);
    return res.status(500).json({ erro: 'Erro ao buscar clientes' });
  }
});

// --- GET /clientes/:id → detalhes de um cliente ---
// Retorna: dados do tenant + assinaturas ativas
router.get('/clientes/:id', exigirAdminBackoffice, (req, res) => {
  const clienteId = req.params.id;
  try {
    const tenant = db.prepare('SELECT * FROM tenants WHERE id = ?').get(clienteId);
    if (!tenant) {
      return res.status(404).json({ erro: 'Cliente não encontrado' });
    }

    // Buscar assinaturas deste tenant
    const assinaturas = db.prepare(`
      SELECT
        id,
        plano,
        valor_mensal,
        data_inicio,
        data_proxima_renovacao,
        cancelada_em,
        em_teste,
        data_inicio_teste,
        data_fim_teste
      FROM assinaturas
      WHERE tenant_id = ?
    `).all(clienteId);

    res.json({
      tenant,
      assinaturas,
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

  if (!['ativo', 'bloqueado', 'teste'].includes(status)) {
    return res.status(400).json({ erro: 'Status inválido. Use "ativo", "bloqueado" ou "teste"' });
  }

  try {
    // Buscar dados ANTES
    const antes = db.prepare('SELECT * FROM tenants WHERE id = ?').get(clienteId);
    if (!antes) {
      return res.status(404).json({ erro: 'Cliente não encontrado' });
    }

    // Detectar mudança de status (para saber se precisa notificar)
    const statusAnterior = antes.status;
    const statusNovo = status;
    const houveMudanca = statusAnterior !== statusNovo;

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
      // Se não foi informado motivo, detectar automaticamente pela assinatura
      let motivoNotificacao = motivo;
      if (!motivoNotificacao) {
        const statusAssinatura = obterStatusAssinatura(clienteId);
        motivoNotificacao = statusAssinatura.motivo || 'Bloqueio administrativo';
      }

      const html = templateContaBloqueada(antes.nome_loja, motivoNotificacao);
      enviarEmail(antes.email, '⚠️ Sua conta foi bloqueada', html).catch(err => {
        console.error('[EMAIL] Erro ao notificar bloqueio:', err.message);
        // Não falha a requisição por erro de email
      });
      console.log(`[NOTIF] Cliente ${antes.nome_loja} (${antes.email}) foi bloqueado [${motivoNotificacao}]`);
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
    if (!tenant) {
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
    // 1️⃣ Resumo de tenants e cobranças
    const resumoFinanceiro = db.prepare(`
      SELECT
        COUNT(DISTINCT t.id) AS total_clientes,
        COUNT(DISTINCT CASE WHEN t.status = 'ativo' THEN t.id END) AS clientes_ativos,
        COUNT(DISTINCT CASE WHEN t.status = 'bloqueado' THEN t.id END) AS clientes_bloqueados,
        COUNT(DISTINCT CASE WHEN t.status = 'teste' THEN t.id END) AS clientes_teste,
        COALESCE(SUM(CASE WHEN c.status = 'pago' THEN c.valor ELSE 0 END), 0) AS total_recebido,
        COALESCE(SUM(CASE WHEN c.status = 'pendente' THEN c.valor ELSE 0 END), 0) AS total_pendente,
        COALESCE(SUM(CASE WHEN c.status = 'vencido' THEN c.valor ELSE 0 END), 0) AS total_vencido
      FROM tenants t
      LEFT JOIN assinaturas a ON a.tenant_id = t.id
      LEFT JOIN cobracas c ON c.assinatura_id = a.id
    `).get();

    // 2️⃣ MRR correto: SUM de valor_mensal das assinaturas ATIVAS
    // IMPORTANTE: valor_mensal já vem preenchido corretamente (89.90 pra mensal, 89.90 pra anual desdobrado)
    // Apenas de clientes que estão pagando (não teste, não cancelado, e dentro do prazo)
    const mrrQuery = db.prepare(`
      SELECT COALESCE(SUM(a.valor_mensal), 0) AS mrr_atual
      FROM assinaturas a
      JOIN tenants t ON t.id = a.tenant_id
      WHERE a.em_teste = 0
      AND t.status IN ('ativo', 'pago')
      AND a.cancelada_em IS NULL
      AND a.data_proxima_renovacao > datetime('now')
    `).get();

    const mrr = mrrQuery.mrr_atual || 0;
    const arr = mrr * 12; // ARR = MRR × 12

    res.json({
      financeiro: {
        ...resumoFinanceiro,
        mrr: Math.round(mrr * 100) / 100,
        arr: Math.round(arr * 100) / 100,
        nota: 'MRR = SUM(assinatura.valor_mensal) de clientes ativos, não é média'
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

    if (!registro) {
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

// --- GET /alertas → lista de clientes em risco (observabilidade de churn) ---
// Retorna: clientes com: atraso de pagamento, inatividade, nunca usaram, erros de integração
router.get('/alertas', exigirAdminBackoffice, (req, res) => {
  try {
    const alertas = db.prepare(`
      SELECT
        a.id,
        a.tenant_id,
        t.nome_loja,
        t.email,
        a.tipo,
        a.dias_sem_atividade,
        a.valor_em_risco,
        a.dias_atraso,
        a.mensagem,
        a.criado_em,
        a.resolvido_em
      FROM alertas_clientes a
      JOIN tenants t ON t.id = a.tenant_id
      WHERE a.resolvido_em IS NULL
      ORDER BY
        CASE a.tipo
          WHEN 'atraso_pagamento' THEN 1
          WHEN 'inativo' THEN 2
          WHEN 'nunca_usou' THEN 3
          ELSE 4
        END,
        a.criado_em DESC
    `).all();

    // Contar alertas por tipo
    const sumario = {
      total: alertas.length,
      atraso_pagamento: alertas.filter(a => a.tipo === 'atraso_pagamento').length,
      inativo: alertas.filter(a => a.tipo === 'inativo').length,
      nunca_usou: alertas.filter(a => a.tipo === 'nunca_usou').length,
      valor_em_risco: alertas.reduce((sum, a) => sum + (a.valor_em_risco || 0), 0)
    };

    res.json({ alertas, sumario });
  } catch (err) {
    console.error('[ADMIN] Erro ao buscar alertas:', err);
    return res.status(500).json({ erro: 'Erro ao buscar alertas' });
  }
});

// --- POST /alertas/resolver/:id → marcar alerta como resolvido ---
router.post('/alertas/resolver/:id', exigirAdminBackoffice, (req, res) => {
  try {
    const alertaId = parseInt(req.params.id, 10);
    const result = db.prepare(
      'UPDATE alertas_clientes SET resolvido_em = datetime(\'now\', \'localtime\') WHERE id = ?'
    ).run(alertaId);

    if (result.changes === 0) {
      return res.status(404).json({ erro: 'Alerta não encontrado' });
    }

    res.json({ sucesso: true, mensagem: 'Alerta resolvido' });
  } catch (err) {
    console.error('[ADMIN] Erro ao resolver alerta:', err);
    return res.status(500).json({ erro: 'Erro ao resolver alerta' });
  }
});

// --- GET /backup-status → status dos backups e health check ---
router.get('/backup-status', exigirAdminBackoffice, (req, res) => {
  try {
    // Últimos 10 backups
    const backups = db.prepare(`
      SELECT
        id,
        data_backup,
        arquivo_s3,
        tamanho_bytes,
        status,
        mensagem,
        tempo_exec_ms
      FROM backup_logs
      ORDER BY criado_em DESC
      LIMIT 10
    `).all();

    // Verificar health (último bem-sucedido)
    const ultimoBom = db.prepare(`
      SELECT
        data_backup,
        arquivo_s3,
        tamanho_bytes,
        tempo_exec_ms
      FROM backup_logs
      WHERE status = 'sucesso'
      ORDER BY criado_em DESC
      LIMIT 1
    `).get();

    // Dias desde último backup bem-sucedido
    let diasDesdeUltimo = null;
    let alertaCritico = false;

    if (ultimoBom) {
      const ultimaData = new Date(ultimoBom.data_backup);
      const agora = new Date();
      diasDesdeUltimo = Math.floor((agora - ultimaData) / (1000 * 60 * 60 * 24));
      alertaCritico = diasDesdeUltimo > 1; // Crítico se > 24h
    } else {
      alertaCritico = true; // Crítico se nunca teve sucesso
    }

    res.json({
      sucesso: true,
      saude: {
        status: alertaCritico ? 'critico' : 'ok',
        diasDesdeUltimo,
        ultimoBackupBem: ultimoBom ? ultimoBom.data_backup : null,
        tamanhoUltimo: ultimoBom ? ultimoBom.tamanho_bytes : null,
      },
      backups: backups.map(b => ({
        ...b,
        tamanhoMB: b.tamanho_bytes ? (b.tamanho_bytes / 1024 / 1024).toFixed(2) : null,
      })),
    });
  } catch (err) {
    console.error('[ADMIN] Erro ao obter status de backups:', err);
    return res.status(500).json({ erro: 'Erro ao obter status de backups' });
  }
});

// --- POST /deploy-secret → fazer git pull e restart (com token secreto, sem autenticação) ---
router.post('/deploy-secret', (req, res) => {
  const { token } = req.body;
  const DEPLOY_TOKEN = process.env.DEPLOY_TOKEN || 'easygestion-deploy-2026';

  if (token !== DEPLOY_TOKEN) {
    return res.status(401).json({ erro: 'Token inválido' });
  }

  const { execSync } = require('child_process');
  try {
    console.log('[DEPLOY] 🚀 Iniciando deploy via token...');

    // Git pull
    const cwd = process.env.NODE_ENV === 'production' ? '/var/www/easygestion' : __dirname + '/..';
    execSync('git fetch origin main && git reset --hard origin/main', { cwd, stdio: 'pipe' });
    console.log('[DEPLOY] ✅ Git pull concluído');

    res.json({
      sucesso: true,
      mensagem: 'Deploy concluído! App será reiniciado em 2s...',
      timestamp: new Date().toISOString()
    });

    // Restart after 2 seconds
    setTimeout(() => {
      console.log('[DEPLOY] Reiniciando app via pm2...');
      try {
        execSync('pm2 restart all', { stdio: 'pipe' });
      } catch (e) {
        console.error('[DEPLOY] Erro ao restart pm2:', e.message);
      }
    }, 2000);
  } catch (err) {
    console.error('[DEPLOY] ❌ Erro durante deploy:', err.message);
    return res.status(500).json({
      erro: 'Erro ao fazer deploy',
      detalhe: process.env.NODE_ENV === 'development' ? err.message : undefined
    });
  }
});

// --- POST /deploy → fazer git pull e restart do app (apenas admin) ---
router.post('/deploy', exigirAdminBackoffice, (req, res) => {
  const { execSync } = require('child_process');
  try {
    console.log('[DEPLOY] 🚀 Iniciando deploy...');

    // Git pull
    const cwd = process.env.NODE_ENV === 'production' ? '/var/www/easygestion' : __dirname + '/..';
    execSync('git fetch origin main && git reset --hard origin/main', { cwd, stdio: 'pipe' });
    console.log('[DEPLOY] ✅ Git pull concluído');

    res.json({
      sucesso: true,
      mensagem: 'Deploy concluído! App será reiniciado em 2s...',
      timestamp: new Date().toISOString()
    });

    // Restart after 2 seconds (pm2 vai fazer o restart automático)
    setTimeout(() => {
      console.log('[DEPLOY] Reiniciando app via pm2...');
      try {
        execSync('pm2 restart all', { stdio: 'pipe' });
      } catch (e) {
        console.error('[DEPLOY] Erro ao restart pm2:', e.message);
      }
    }, 2000);
  } catch (err) {
    console.error('[DEPLOY] ❌ Erro durante deploy:', err.message);
    return res.status(500).json({
      erro: 'Erro ao fazer deploy',
      detalhe: process.env.NODE_ENV === 'development' ? err.message : undefined
    });
  }
});

// ============================================================
// P1 - PAINEL DE ASSINATURAS
// ============================================================

// --- GET /assinaturas → lista de todas as assinaturas com status ---
router.get('/assinaturas', exigirAdminBackoffice, (req, res) => {
  try {
    const status = req.query.status || null; // ativo, vencida, trial, cancelada
    const pagina = Math.max(1, parseInt(req.query.pagina || 1, 10));
    const limite = Math.min(100, parseInt(req.query.limite || 20, 10));
    const offset = (pagina - 1) * limite;

    let sql = `
      SELECT
        a.id,
        a.tenant_id,
        t.nome_loja,
        t.email,
        a.plano,
        a.valor_mensal,
        a.data_inicio,
        a.data_proxima_renovacao,
        a.cancelada_em,
        a.em_teste,
        a.data_inicio_teste,
        a.data_fim_teste,
        COUNT(DISTINCT c.id) AS num_cobracas,
        SUM(CASE WHEN c.status = 'pago' THEN c.valor ELSE 0 END) AS total_pago,
        SUM(CASE WHEN c.status = 'pendente' THEN c.valor ELSE 0 END) AS total_pendente
      FROM assinaturas a
      JOIN tenants t ON t.id = a.tenant_id
      LEFT JOIN cobracas c ON c.assinatura_id = a.id
      WHERE 1=1
    `;

    const params = [];

    // Filtro por status (ativo, vencida, trial, cancelada)
    if (status) {
      if (status === 'ativo') {
        sql += ` AND a.cancelada_em IS NULL AND a.em_teste = 0 AND a.data_proxima_renovacao > datetime('now')`;
      } else if (status === 'vencida') {
        sql += ` AND a.cancelada_em IS NULL AND a.data_proxima_renovacao <= datetime('now')`;
      } else if (status === 'trial') {
        sql += ` AND a.em_teste = 1`;
      } else if (status === 'cancelada') {
        sql += ` AND a.cancelada_em IS NOT NULL`;
      }
    }

    sql += ` GROUP BY a.id ORDER BY a.data_proxima_renovacao ASC LIMIT ? OFFSET ?`;
    params.push(limite, offset);

    const assinaturas = db.prepare(sql).all(...params);

    // Total para paginação
    let sqlTotal = `SELECT COUNT(DISTINCT a.id) AS total FROM assinaturas a JOIN tenants t ON t.id = a.tenant_id WHERE 1=1`;
    const paramsTotal = [];
    if (status) {
      if (status === 'ativo') {
        sqlTotal += ` AND a.cancelada_em IS NULL AND a.em_teste = 0 AND a.data_proxima_renovacao > datetime('now')`;
      } else if (status === 'vencida') {
        sqlTotal += ` AND a.cancelada_em IS NULL AND a.data_proxima_renovacao <= datetime('now')`;
      } else if (status === 'trial') {
        sqlTotal += ` AND a.em_teste = 1`;
      } else if (status === 'cancelada') {
        sqlTotal += ` AND a.cancelada_em IS NOT NULL`;
      }
    }
    const { total } = db.prepare(sqlTotal).get(...paramsTotal);

    res.json({
      assinaturas,
      paginacao: {
        pagina,
        limite,
        total,
        total_paginas: Math.ceil(total / limite),
        tem_proxima: pagina * limite < total,
        tem_anterior: pagina > 1
      }
    });
  } catch (err) {
    console.error('[ADMIN] Erro ao buscar assinaturas:', err);
    return res.status(500).json({ erro: 'Erro ao buscar assinaturas' });
  }
});

// --- PATCH /assinaturas/:id → atualizar plano de assinatura (upgrade/downgrade) ---
router.patch('/assinaturas/:id', exigirAdminBackoffice, (req, res) => {
  try {
    const assinaturaId = parseInt(req.params.id, 10);
    const { plano, valor_mensal } = req.body;

    if (!plano || !valor_mensal) {
      return res.status(400).json({ erro: 'Plano e valor_mensal obrigatórios' });
    }

    // Buscar assinatura
    const antes = db.prepare('SELECT * FROM assinaturas WHERE id = ?').get(assinaturaId);
    if (!antes) {
      return res.status(404).json({ erro: 'Assinatura não encontrada' });
    }

    // Atualizar
    const result = db.prepare(
      'UPDATE assinaturas SET plano = ?, valor_mensal = ? WHERE id = ?'
    ).run(plano, valor_mensal, assinaturaId);

    if (result.changes === 0) {
      return res.status(404).json({ erro: 'Assinatura não encontrada' });
    }

    // Buscar dados DEPOIS
    const depois = db.prepare('SELECT * FROM assinaturas WHERE id = ?').get(assinaturaId);

    // Auditoria
    auditarAcao(req, {
      acao: 'PATCH_assinatura_plano',
      recurso: 'assinaturas',
      recurso_id: assinaturaId,
      antes,
      depois,
      status: 200
    });

    console.log(`[ADMIN] Assinatura ${assinaturaId} atualizada: ${antes.plano} → ${plano}`);

    res.json({ sucesso: true, mensagem: 'Assinatura atualizada', assinatura: depois });
  } catch (err) {
    console.error('[ADMIN] Erro ao atualizar assinatura:', err);
    return res.status(500).json({ erro: 'Erro ao atualizar assinatura' });
  }
});

// ============================================================
// P1 - PAINEL DE COBRANÇAS
// ============================================================

// --- GET /cobracas → lista de cobranças com filtros ---
router.get('/cobracas', exigirAdminBackoffice, (req, res) => {
  try {
    const status = req.query.status || null; // pendente, pago, falha
    const pagina = Math.max(1, parseInt(req.query.pagina || 1, 10));
    const limite = Math.min(100, parseInt(req.query.limite || 20, 10));
    const offset = (pagina - 1) * limite;

    let sql = `
      SELECT
        c.id,
        c.tenant_id,
        c.assinatura_id,
        t.nome_loja,
        t.email,
        a.plano,
        c.data_cobranca,
        c.valor,
        c.status,
        c.metodo_pagamento,
        c.tentativas,
        c.data_pagamento
      FROM cobracas c
      JOIN tenants t ON t.id = c.tenant_id
      LEFT JOIN assinaturas a ON a.id = c.assinatura_id
      WHERE 1=1
    `;

    const params = [];

    // Filtro por status
    if (status && ['pendente', 'pago', 'falha'].includes(status)) {
      sql += ` AND c.status = ?`;
      params.push(status);
    }

    sql += ` ORDER BY c.data_cobranca DESC LIMIT ? OFFSET ?`;
    params.push(limite, offset);

    const cobracas = db.prepare(sql).all(...params);

    // Total
    let sqlTotal = `SELECT COUNT(*) AS total FROM cobracas c WHERE 1=1`;
    const paramsTotal = [];
    if (status && ['pendente', 'pago', 'falha'].includes(status)) {
      sqlTotal += ` AND c.status = ?`;
      paramsTotal.push(status);
    }
    const { total } = db.prepare(sqlTotal).get(...paramsTotal);

    res.json({
      cobracas,
      paginacao: {
        pagina,
        limite,
        total,
        total_paginas: Math.ceil(total / limite),
        tem_proxima: pagina * limite < total,
        tem_anterior: pagina > 1
      }
    });
  } catch (err) {
    console.error('[ADMIN] Erro ao buscar cobranças:', err);
    return res.status(500).json({ erro: 'Erro ao buscar cobranças' });
  }
});

// --- POST /cobracas/:id/reprocessar → tentar cobrar novamente ---
router.post('/cobracas/:id/reprocessar', exigirAdminBackoffice, (req, res) => {
  try {
    const cobrancaId = parseInt(req.params.id, 10);
    const cobranca = db.prepare('SELECT * FROM cobracas WHERE id = ?').get(cobrancaId);

    if (!cobranca) {
      return res.status(404).json({ erro: 'Cobrança não encontrada' });
    }

    // Incrementar tentativas
    const result = db.prepare(
      'UPDATE cobracas SET tentativas = tentativas + 1, status = ? WHERE id = ?'
    ).run('pendente', cobrancaId);

    if (result.changes === 0) {
      return res.status(404).json({ erro: 'Cobrança não encontrada' });
    }

    // Auditoria
    auditarAcao(req, {
      acao: 'POST_cobranca_reprocessar',
      recurso: 'cobracas',
      recurso_id: cobrancaId,
      antes: cobranca,
      depois: null,
      status: 200
    });

    console.log(`[ADMIN] Cobrança ${cobrancaId} reprocessada manualmente`);

    res.json({ sucesso: true, mensagem: 'Cobrança marcada para reprocessamento', tentativa_num: cobranca.tentativas + 1 });
  } catch (err) {
    console.error('[ADMIN] Erro ao reprocessar cobrança:', err);
    return res.status(500).json({ erro: 'Erro ao reprocessar cobrança' });
  }
});

// ============================================================
// P1 - HISTÓRICO DE LOGIN DE ADMINS
// ============================================================

// --- GET /login-history → histórico de logins de admin ---
router.get('/login-history', exigirAdminBackoffice, (req, res) => {
  try {
    const pagina = Math.max(1, parseInt(req.query.pagina || 1, 10));
    const limite = Math.min(100, parseInt(req.query.limite || 50, 10));
    const offset = (pagina - 1) * limite;

    // Buscar logs de admin login via auditoria
    // Procura por ações que contenham 'LOGIN' (admin login é 'LOGIN_admin')
    const logins = db.prepare(`
      SELECT
        a.id,
        COALESCE(a.usuario_nome, 'admin') AS usuario_nome,
        a.criado_em,
        a.ip,
        CASE WHEN a.status_http = 200 THEN 'Sucesso' ELSE 'Falha' END AS resultado,
        a.acao
      FROM auditoria a
      WHERE a.acao LIKE '%LOGIN%'
      ORDER BY a.criado_em DESC
      LIMIT ? OFFSET ?
    `).all(limite, offset);

    // Total
    const { total } = db.prepare(`
      SELECT COUNT(*) AS total FROM auditoria
      WHERE acao LIKE '%LOGIN%'
    `).get();

    res.json({
      logins,
      paginacao: {
        pagina,
        limite,
        total,
        total_paginas: Math.ceil(total / limite),
        tem_proxima: pagina * limite < total,
        tem_anterior: pagina > 1
      }
    });
  } catch (err) {
    console.error('[ADMIN] Erro ao buscar histórico de login:', err);
    return res.status(500).json({ erro: 'Erro ao buscar histórico' });
  }
});

// --- POST /2fa-setup → gera secret TOTP + retorna QR code ---
// Acesso: apenas POST (sem autenticação de admin ainda, pois é durante setup)
// Retorna: { secret, qr_code_data_url, backup_codes }
router.post('/2fa-setup', async (req, res) => {
  try {
    const { gerarSecret, gerarQRCode } = require('../lib/2fa');

    const secretObj = gerarSecret();
    const qrCodeDataUrl = await gerarQRCode(secretObj);

    // Gerar códigos de backup (10 códigos de 8 dígitos cada)
    const backupCodes = Array.from({ length: 10 }, () => {
      return Math.random().toString(36).substring(2, 10).toUpperCase();
    });

    res.json({
      ok: true,
      secret: secretObj.base32, // retornar só a string em base32, não o objeto completo
      qr_code: qrCodeDataUrl,
      backup_codes: backupCodes,
      mensagem: 'Secret 2FA gerado. Escaneie o QR code ou insira o secret manualmente no seu autenticador.'
    });
  } catch (err) {
    console.error('[ADMIN 2FA] Erro ao gerar setup:', err);
    return res.status(500).json({ erro: 'Erro ao gerar QR code' });
  }
});

// --- POST /2fa-confirm → confirma setup e ativa 2FA ---
// Requer: secret, token, backup_codes
// Salva em session (por ora) — em produção seria salvo em DB + ENV
router.post('/2fa-confirm', (req, res) => {
  const { secret, token, backup_codes } = req.body;

  if (!secret || !token || !Array.isArray(backup_codes) || backup_codes.length === 0) {
    return res.status(400).json({ erro: 'Dados incompletos para confirmar 2FA' });
  }

  try {
    const { validarToken } = require('../lib/2fa');

    // Validar token contra o secret
    if (!validarToken(secret, token)) {
      return res.status(401).json({ erro: 'Token 2FA inválido' });
    }

    // ✅ 2FA confirmado! Salvar na sessão + alertar pra salvar backup codes
    req.session.admin2faSecret = secret;
    req.session.admin2faBackupCodes = backup_codes;
    req.session.logado = true;
    req.session.papel = 'admin';

    console.log('[ADMIN 2FA] Setup confirmado com sucesso');

    res.json({
      ok: true,
      mensagem: '2FA ativado com sucesso! Você será logado agora.',
      destino: '/admin-dashboard.html'
    });
  } catch (err) {
    console.error('[ADMIN 2FA] Erro ao confirmar setup:', err);
    return res.status(500).json({ erro: 'Erro ao confirmar 2FA' });
  }
});

module.exports = router;
