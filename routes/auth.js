// ============================================================
// API de AUTENTICAÇÃO: login, logout, quem-sou
// Senha admin vem da variável de ambiente ADMIN_SENHA (nunca no código).
// ============================================================
const express = require('express');
const router = express.Router();
const { db, getConfig } = require('../db/database');
const { hashSenha, verificarSenha, validarSenha, validarNaoReutilizada, limiteForgotPassword, limiteResetSenha, limiteAdminPassword } = require('../middleware/seguranca');
const jwt = require('jsonwebtoken');
const { enviarEmail, templateResetSenha } = require('../lib/email');

const TOKEN_SECRET = process.env.TOKEN_SECRET || 'dev-secret';

// Validação de email (RFC 5322 simplificado)
function validarEmail(email) {
  const regex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  return regex.test(email) && email.length <= 255;
}

// Sanitização básica (remove caracteres perigosos)
function sanitizar(texto) {
  if (!texto) return '';
  return String(texto)
    .trim()
    .substring(0, 500)
    .replace(/[<>]/g, '');
}

// Resolve o hash da senha admin:
// 1) ADMIN_SENHA_HASH (já em hash) tem prioridade;
// 2) senão ADMIN_SENHA (texto) é hasheada em memória no boot;
// 3) senão (dev local sem env) usa fallback 'dsstore' — APENAS local.
let HASH_ADMIN = null;
function hashAdmin() {
  if (HASH_ADMIN) return HASH_ADMIN;
  if (process.env.ADMIN_SENHA_HASH) HASH_ADMIN = process.env.ADMIN_SENHA_HASH;
  else if (process.env.ADMIN_SENHA) HASH_ADMIN = hashSenha(process.env.ADMIN_SENHA);
  else HASH_ADMIN = hashSenha('dsstore'); // fallback DEV — em produção sempre setar ADMIN_SENHA
  return HASH_ADMIN;
}

function usuarioAdmin() { return getConfig('admin_usuario', 'igor'); }

// POST /api/admin/login  body: { senha }
// Login admin (apenas senha — sem email)
// Nota: rate limit temporariamente removido para testes (TODO: reativar após beta)
router.post('/admin/login', (req, res) => {
  console.log('[AUTH] POST /admin/login chegou na rota!');
  const { senha } = req.body || {};

  if (!senha) {
    return res.status(400).json({ erro: 'Senha é obrigatória' });
  }

  console.log(`[AUTH] Testando senha. Comprimento: ${String(senha).length}`);
  const hash = hashAdmin();
  console.log(`[AUTH] Hash do admin: ${hash.substring(0, 30)}...`);
  const match = verificarSenha(senha, hash);
  console.log(`[AUTH] Verificação: ${match}`);

  if (match) {
    req.session.logado = true;
    req.session.usuario = usuarioAdmin();
    req.session.papel = 'admin';
    req.session.tenant_id = 1;
    console.log(`[ADMIN LOGIN OK] ${usuarioAdmin()} • ${req.ip} • SESSION ID: ${req.sessionID}`);
    return req.session.save((err) => {
      if (err) {
        console.error('[SESSION SAVE ERROR]', err);
        return res.status(500).json({ erro: 'Erro ao salvar sessão' });
      }
      console.log(`[SESSION SAVED] ${req.sessionID} → ${usuarioAdmin()}`);
      // Force set cookie header manually ANTES de res.json()
      res.set('Set-Cookie', `ds.sid=${req.sessionID}; Path=/; HttpOnly; SameSite=Lax; Max-Age=43200${process.env.NODE_ENV === 'production' ? '; Secure' : ''}`);
      return res.json({ ok: true, usuario: usuarioAdmin(), papel: 'admin', destino: 'index.html' });
    });
  }

  console.warn(`[ADMIN LOGIN FALHA] ${req.ip} • ${new Date().toISOString()}`);
  return res.status(401).json({ erro: 'Senha de admin incorreta' });
});

// POST /api/login  body: { email, senha }
// Login por email + senha (para SaaS multi-tenant)
router.post('/login', (req, res) => {
  const { email, senha } = req.body || {};

  // Se vier vazio (compatibilidade com admin do .env)
  if (!email && senha && verificarSenha(senha, hashAdmin())) {
    req.session.logado = true;
    req.session.usuario = usuarioAdmin();
    req.session.papel = 'admin';
    req.session.tenant_id = 1;  // admin do .env sempre é tenant 1
    console.log(`[LOGIN OK] ${usuarioAdmin()} (admin env) • ${req.ip} • ${new Date().toISOString()}`);
    return req.session.save((err) => {
      if (err) {
        console.error('[SESSION SAVE ERROR]', err);
        return res.status(500).json({ erro: 'Erro ao salvar sessão' });
      }
      res.set('Set-Cookie', `ds.sid=${req.sessionID}; Path=/; HttpOnly; SameSite=Lax; Max-Age=43200${process.env.NODE_ENV === 'production' ? '; Secure' : ''}`);
      return res.json({ ok: true, usuario: usuarioAdmin(), papel: 'admin', destino: 'index.html' });
    });
  }

  // Login por email (tabela de usuários)
  if (!email || !senha) {
    return res.status(400).json({ erro: 'Email e senha são obrigatórios' });
  }

  const u = db.prepare('SELECT * FROM usuarios WHERE LOWER(email) = LOWER(?) AND ativo = 1').get(email.trim());
  if (u && verificarSenha(senha, u.senha_hash)) {
    // ⚠️ tenant_id deve estar sempre presente em DB (NOT NULL)
    if (!u.tenant_id) {
      console.error(`[LOGIN ERRO] ${u.email} não tem tenant_id no DB! Bloqueando login.`);
      return res.status(500).json({ erro: 'Erro de configuração (contate suporte)' });
    }

    // ✅ Verificar se o tenant está bloqueado
    const tenant = db.prepare('SELECT status FROM tenants WHERE id = ?').get(u.tenant_id);
    if (tenant && tenant.status === 'bloqueado') {
      console.warn(`[LOGIN BLOQUEADO] ${u.email} (tenant ${u.tenant_id} bloqueado) • ${req.ip} • ${new Date().toISOString()}`);
      return res.status(403).json({ erro: 'Sua conta foi bloqueada pelo administrador' });
    }

    req.session.logado = true;
    req.session.usuario = u.nome;
    req.session.email = u.email;
    req.session.papel = u.papel;
    req.session.tenant_id = u.tenant_id;
    const destino = u.papel === 'admin' ? 'index.html'
      : u.papel === 'vendedor' ? 'pdv.html'
      : 'relacionamento.html';
    console.log(`[LOGIN OK] ${u.email} (${u.papel}) • ${req.ip} • ${new Date().toISOString()}`);
    return req.session.save((err) => {
      if (err) {
        console.error('[SESSION SAVE ERROR]', err);
        return res.status(500).json({ erro: 'Erro ao salvar sessão' });
      }
      res.set('Set-Cookie', `ds.sid=${req.sessionID}; Path=/; HttpOnly; SameSite=Lax; Max-Age=43200${process.env.NODE_ENV === 'production' ? '; Secure' : ''}`);
      return res.json({ ok: true, usuario: u.nome, email: u.email, papel: u.papel, destino });
    });
  }

  console.warn(`[LOGIN FALHA] ${email} • ${req.ip} • ${new Date().toISOString()}`);
  return res.status(401).json({ erro: 'Email ou senha inválidos' });
});

// POST /api/auth/registro  body: { email, senha, nome_loja, nome_responsavel, telefone }
// Cria novo tenant + usuário admin (LGPD terms já foram aceitos no form)
router.post('/registro', (req, res) => {
  const { email, senha, nome_loja, nome_responsavel, telefone } = req.body || {};

  // Validações
  if (!validarEmail(email)) {
    return res.status(400).json({ erro: 'Email inválido' });
  }
  const validacaoSenha = validarSenha(senha);
  if (!validacaoSenha.valida) {
    return res.status(400).json({ erro: validacaoSenha.erro });
  }
  const nomeLoja = sanitizar(nome_loja);
  const nomeResponsavel = sanitizar(nome_responsavel);
  const telefoneLimpo = sanitizar(telefone);

  if (!nomeLoja) {
    return res.status(400).json({ erro: 'Nome da loja é obrigatório' });
  }
  if (!nomeResponsavel) {
    return res.status(400).json({ erro: 'Nome do responsável é obrigatório' });
  }
  if (!telefoneLimpo) {
    return res.status(400).json({ erro: 'Telefone é obrigatório' });
  }
  if (!/^\d{10,11}$/.test(telefoneLimpo.replace(/\D/g, ''))) {
    return res.status(400).json({ erro: 'Telefone deve ter 10 ou 11 dígitos' });
  }

  // Verificar se email já existe
  const existe = db.prepare('SELECT id FROM usuarios WHERE LOWER(email) = LOWER(?)').get(email.trim());
  if (existe) {
    return res.status(409).json({ erro: 'Este email já está cadastrado' });
  }

  try {
    const tx = db.transaction(() => {
      // (1) Criar novo tenant
      const infoTenant = db.prepare(`
        INSERT INTO tenants (nome_loja, email, senha_hash, nome_responsavel, telefone, plano)
        VALUES (?, ?, ?, ?, ?, 'basico')
      `).run(nomeLoja, email.trim(), hashSenha(senha), nomeResponsavel, telefoneLimpo);
      const tenantId = infoTenant.lastInsertRowid;

      // (2) Criar usuário admin do tenant (usar email como nome, pois é único por tenant)
      const infoUser = db.prepare(`
        INSERT INTO usuarios (nome, email, tenant_id, papel, senha_hash, ativo)
        VALUES (?, ?, ?, 'admin', ?, 1)
      `).run(email.trim(), email.trim(), tenantId, hashSenha(senha));
      const userId = infoUser.lastInsertRowid;

      // (3) Criar assinatura em TESTE (14 dias grátis)
      const hoje = new Date();
      const dataInicio = hoje.toISOString().split('T')[0];
      const dataFim = new Date(hoje.getTime() + 14 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
      db.prepare(`
        INSERT INTO assinaturas (tenant_id, plano, valor_mensal, data_inicio, data_proxima_renovacao, em_teste, data_inicio_teste, data_fim_teste)
        VALUES (?, 'basico', 79.90, ?, ?, 1, ?, ?)
      `).run(tenantId, dataInicio, dataFim, dataInicio, dataFim);

      return { tenantId, userId };
    });

    const r = tx();
    req.session.logado = true;
    req.session.usuario = nome_loja.trim();
    req.session.email = email.trim();
    req.session.papel = 'admin';
    req.session.tenant_id = r.tenantId;

    console.log(`[REGISTRO OK] ${email} (tenant ${r.tenantId}) • ${req.ip} • ${new Date().toISOString()}`);
    return res.status(201).json({
      ok: true,
      mensagem: 'Conta criada com sucesso!',
      usuario: nome_loja.trim(),
      email: email.trim(),
      papel: 'admin',
      destino: 'onboarding.html'
    });
  } catch (e) {
    console.error('Erro ao registrar:', e.message);
    return res.status(500).json({ erro: 'Erro ao criar conta. Tente novamente.' });
  }
});

// POST /api/logout
router.post('/logout', (req, res) => {
  req.session.destroy(() => res.json({ ok: true }));
});

// GET /api/me  -> quem está logado (usado pela guarda de páginas)
router.get('/me', (req, res) => {
  if (req.session && req.session.logado)
    return res.json({ logado: true, usuario: req.session.usuario, papel: req.session.papel || 'admin' });
  return res.status(401).json({ logado: false });
});

// POST /api/auth/forgot-password { email }
// Envia email com link para redefinir senha
router.post('/forgot-password', limiteForgotPassword, async (req, res) => {
  const { email } = req.body;
  if (!email || !email.includes('@')) {
    return res.status(400).json({ erro: 'Email inválido' });
  }

  // Procura usuário
  const user = db.prepare('SELECT * FROM usuarios WHERE LOWER(email) = LOWER(?)').get(email.trim());
  if (!user) {
    // NÃO expor se existe ou não (segurança)
    return res.json({ ok: true, mensagem: 'Se existe uma conta com este email, um link foi enviado.' });
  }

  // Gera JWT token válido por 1h
  const token = jwt.sign(
    { id: user.id, tipo: 'reset' },
    TOKEN_SECRET,
    { expiresIn: '1h' }
  );

  // Salva token no BD
  const expires = new Date(Date.now() + 3600000).toISOString();
  db.prepare(`
    INSERT INTO tokens_verificacao (usuario_id, token, tipo, criado_em, expires_em)
    VALUES (?, ?, ?, ?, ?)
  `).run(user.id, token, 'reset-senha', new Date().toISOString(), expires);

  // Envia email
  const resetLink = `${process.env.SITE_URL || 'http://localhost:3000'}/reset-senha.html?token=${token}`;
  await enviarEmail(user.email, 'Redefinir sua senha', templateResetSenha(user.nome, resetLink));

  return res.json({ ok: true, mensagem: 'Email de redefinição enviado' });
});

// POST /api/auth/reset-senha { token, nova_senha }
// Reseta a senha com token válido
router.post('/reset-senha', limiteResetSenha, (req, res) => {
  const { token, nova_senha } = req.body;
  if (!token) {
    return res.status(400).json({ erro: 'Token ausente' });
  }
  const validacaoSenha = validarSenha(nova_senha);
  if (!validacaoSenha.valida) {
    return res.status(400).json({ erro: validacaoSenha.erro });
  }

  try {
    // (1) Valida token JWT
    const decoded = jwt.verify(token, TOKEN_SECRET);
    if (decoded.tipo !== 'reset') throw new Error('Token inválido');

    // (2) Procura usuário
    const user = db.prepare('SELECT * FROM usuarios WHERE id = ?').get(decoded.id);
    if (!user) return res.status(404).json({ erro: 'Usuário não encontrado' });

    // (3) Valida token no BD
    const tokenRec = db.prepare('SELECT * FROM tokens_verificacao WHERE token = ? AND tipo = ?')
      .get(token, 'reset-senha');
    if (!tokenRec || tokenRec.usado_em) {
      return res.status(400).json({ erro: 'Token já foi usado ou expirou' });
    }

    // (4) Atualiza senha
    db.transaction(() => {
      db.prepare('UPDATE usuarios SET senha_hash = ? WHERE id = ?')
        .run(hashSenha(nova_senha), user.id);
      db.prepare('UPDATE tokens_verificacao SET usado_em = ? WHERE id = ?')
        .run(new Date().toISOString(), tokenRec.id);
    })();

    return res.json({ ok: true, mensagem: 'Senha redefinida com sucesso!' });
  } catch (err) {
    console.error('Reset error:', err.message);
    return res.status(400).json({ erro: 'Token inválido ou expirado' });
  }
});

// PATCH /api/me/senha { senha_atual, senha_nova }
// Usuário altera sua própria senha
router.patch('/me/senha', (req, res) => {
  if (!req.session || !req.session.logado) {
    return res.status(401).json({ erro: 'Não autenticado' });
  }

  const { senha_atual, senha_nova } = req.body;
  if (!senha_atual) {
    return res.status(400).json({ erro: 'Senha atual é obrigatória' });
  }

  const validacaoSenha = validarSenha(senha_nova);
  if (!validacaoSenha.valida) {
    return res.status(400).json({ erro: validacaoSenha.erro });
  }

  // Procura usuário
  const user = db.prepare('SELECT * FROM usuarios WHERE nome = ? AND ativo = 1')
    .get(req.session.usuario);
  if (!user) return res.status(404).json({ erro: 'Usuário não encontrado' });

  // Valida senha atual
  if (!verificarSenha(senha_atual, user.senha_hash)) {
    return res.status(403).json({ erro: 'Senha atual incorreta' });
  }

  // Valida que a nova senha é diferente da antiga
  const naoReutilizada = validarNaoReutilizada(senha_nova, user.senha_hash);
  if (!naoReutilizada.valida) {
    return res.status(400).json({ erro: naoReutilizada.erro });
  }

  // Atualiza
  db.prepare('UPDATE usuarios SET senha_hash = ? WHERE id = ?')
    .run(hashSenha(senha_nova), user.id);

  res.json({ ok: true, mensagem: 'Senha alterada com sucesso!' });
});

// GET /api/me/dados
// Exportar dados do usuário em JSON (LGPD - direito de portabilidade)
router.get('/me/dados', (req, res) => {
  if (!req.session || !req.session.logado) {
    return res.status(401).json({ erro: 'Não autenticado' });
  }

  if (!req.tenantId) {
    return res.status(401).json({ erro: 'Tenant não identificado' });
  }
  const usuario = db.prepare('SELECT id, nome, email, papel, criado_em FROM usuarios WHERE nome = ? AND tenant_id = ?')
    .get(req.session.usuario, req.tenantId);

  const dados = {
    usuario,
    vendas: db.prepare('SELECT * FROM vendas WHERE tenant_id = ? ORDER BY data_hora DESC LIMIT 100').all(req.tenantId),
    clientes: db.prepare('SELECT * FROM clientes WHERE tenant_id = ? ORDER BY criado_em DESC').all(req.tenantId),
    produtos: db.prepare('SELECT * FROM produtos WHERE tenant_id = ?').all(req.tenantId),
  };

  res.json(dados);
});

// DELETE /api/me/conta { senha }
// Usuário solicita deleção de conta (LGPD - direito ao esquecimento)
// Grace period: 30 dias antes da deleção efetiva (cancelável nesse período)
router.delete('/me/conta', (req, res) => {
  if (!req.session || !req.session.logado) {
    return res.status(401).json({ erro: 'Não autenticado' });
  }

  const { senha } = req.body;
  const user = db.prepare('SELECT * FROM usuarios WHERE nome = ?')
    .get(req.session.usuario);

  if (!verificarSenha(senha, user.senha_hash)) {
    return res.status(403).json({ erro: 'Senha incorreta' });
  }

  const tenantId = req.session.tenantId;
  const dataDelecao = new Date();
  dataDelecao.setDate(dataDelecao.getDate() + 30);
  const agendadoPara = dataDelecao.toISOString();

  db.transaction(() => {
    // Marcar tenant como cancelado (acesso bloqueado imediatamente)
    db.prepare('UPDATE tenants SET status = ? WHERE id = ?')
      .run('cancelado', tenantId);

    // Agendar hard-delete em 30 dias (LGPD grace period)
    db.prepare('INSERT OR REPLACE INTO delecoes_agendadas (tenant_id, agendado_para) VALUES (?, ?)')
      .run(tenantId, agendadoPara);
  })();

  req.session.destroy(() => {
    res.json({
      ok: true,
      mensagem: 'Deleção agendada para 30 dias. A conta será permanentemente deletada em ' + new Date(agendadoPara).toLocaleDateString('pt-BR'),
      agendado_para: agendadoPara,
    });
  });
});

module.exports = router;
