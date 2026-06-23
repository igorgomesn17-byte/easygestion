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

const { limiteAdminPassword, verificarSenha, hashSenha } = require('../middleware/seguranca');

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

// --- POST /login → autentica admin (usuário admin real na tabela DE usuarios) ---
router.post('/login', limiteAdminPassword, (req, res) => {
  const { nome, senha } = req.body;

  if (!nome || !senha) {
    return res.status(400).json({ erro: 'Nome de usuário e senha obrigatórios.' });
  }

  try {
    // 1️⃣ Tentar buscar usuário admin na TABELA (novo sistema LGPD-compliant)
    let usuario = db.prepare(
      'SELECT id, tenant_id, nome, email, senha_hash, papel FROM usuarios WHERE nome = ? AND papel = ? AND ativo = 1'
    ).get(nome, 'admin');

    // 2️⃣ Se não encontrou na tabela, tentar ADMIN_SENHA_HASH do .env (compatibilidade)
    let eh_admin_env = false;
    let senha_valida = false;

    if (!usuario) {
      const hashAdmin = process.env.ADMIN_SENHA_HASH || null;
      if (hashAdmin && verificarSenha(String(senha), hashAdmin)) {
        eh_admin_env = true;
        senha_valida = true;
      }
    } else {
      // 3️⃣ Se encontrou usuário na tabela, validar senha
      if (verificarSenha(String(senha), usuario.senha_hash)) {
        senha_valida = true;
      }
    }

    // ❌ Se senha inválida, retornar erro
    if (!senha_valida) {
      // Log detalhado (sem expor senha)
      const motivo = !usuario ? 'usuário não encontrado' : 'senha incorreta';
      console.warn(`[ADMIN] Login falhou: ${nome} (${motivo}) • IP: ${req.ip} • ${new Date().toISOString()}`);
      return res.status(401).json({
        erro: 'Usuário ou senha incorretos.',
        dica: usuario ? 'Verifique a senha.' : 'Usuário admin não existe. Use o script: node scripts/criar-admin.js'
      });
    }

    // ✅ Autenticação bem-sucedida: criar sessão
    req.session.logado = true;
    req.session.usuario_id = usuario?.id || null;
    req.session.nome = nome;
    req.session.email = usuario?.email || null;
    req.session.papel = 'admin';
    req.session.tenant_id = usuario?.tenant_id || 1; // admin sempre é tenant 1
    req.session.login_em = new Date().toISOString();

    const origem = eh_admin_env ? 'env (ADMIN_SENHA_HASH)' : 'database';
    console.log(`[ADMIN] ✅ Login bem-sucedido: ${nome} (${origem}) • IP: ${req.ip} • ${new Date().toISOString()}`);

    res.json({
      sucesso: true,
      mensagem: 'Logado como administrador',
      usuario: nome,
      origen: eh_admin_env ? 'env' : 'db'
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
    if (!tenant) {
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
router.post('/deploy-secret', limiteAdminPassword, (req, res) => {
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

module.exports = router;
