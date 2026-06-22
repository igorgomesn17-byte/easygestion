// ============================================================
// Middleware de segurança: autenticação, autorização e rate limit
// ============================================================
const crypto = require('crypto');
const rateLimit = require('express-rate-limit');

// --- Hash de senha (scrypt nativo — sem libs de build nativo) ---
// formato armazenado: scrypt$<salt-hex>$<hash-hex>
function hashSenha(senha) {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(String(senha), salt, 64).toString('hex');
  return `scrypt$${salt}$${hash}`;
}
function verificarSenha(senha, armazenado) {
  if (***REMOVED***armazenado || ***REMOVED***armazenado.startsWith('scrypt$')) return false;
  const [, salt, hashEsperado] = armazenado.split('$');
  const hash = crypto.scryptSync(String(senha), salt, 64).toString('hex');
  // comparação em tempo constante (evita timing attack)
  const a = Buffer.from(hash, 'hex');
  const b = Buffer.from(hashEsperado, 'hex');
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

// --- Rotas/prefixos PÚBLICOS (não exigem login) ---
const PUBLICAS = [
  '/api/login',
  '/api/registro',              // novo: cadastro de contas (SaaS)
  '/api/logout',
  '/api/me',                    // decide sozinho se está logado (retorna 401 se não)
  '/api/forgot-password',       // redefinir senha
  '/api/reset-senha',           // confirmar redefinição
  '/api/loja-publica',
  '/api/lead-vitrine',          // captura de lead na vitrine (POST público)
  '/api/produtos/vitrine',
  '/api/codigo-barras',         // imagens dos códigos (prefixo)
  '/api/admin',                 // backoffice admin (protegido por password/sessão)
];
function ehPublica(caminho) {
  return PUBLICAS.some(p => caminho === p || caminho.startsWith(p));
}

// --- Middleware: exige login para tudo que não for público ---
function exigirLogin(req, res, next) {
  // req.path aqui é relativo ao mount /api (ex: '/financeiro/dre')
  const full = '/api' + req.path;
  if (ehPublica(full)) return next();
  if (req.session && req.session.logado) return next();
  return res.status(401).json({ erro: 'Não autenticado', login: true });
}

// --- Middleware: injeta tenant_id em req.tenantId ---
// Admin do .env → sempre tenant 1
// Usuários de tabela → tenant_id da sessão
// Rotas públicas (sem login) → não injeta, deixa passar
function injetarTenant(req, res, next) {
  // Se não está logado, deixar passar (rotas públicas)
  if (***REMOVED***req.session?.logado) {
    return next();
  }

  // Se é admin do .env e ainda não tem tenant_id, assume tenant 1
  if (req.session?.papel === 'admin' && ***REMOVED***req.session?.tenant_id) {
    req.tenantId = 1;
    return next();
  }

  // Se tem tenant_id na sessão, injetar
  const tid = req.session?.tenant_id;
  if (tid) {
    req.tenantId = tid;
    return next();
  }

  // Se chegou aqui, é logado mas sem tenant_id (erro)
  return res.status(401).json({ erro: 'Tenant não identificado' });
}

// --- Middleware: valida se tenant está bloqueado ---
// Verifica se o tenant do usuário logado foi bloqueado
// Se bloqueado, desconecta a sessão e retorna erro
function validarTenantAtivo(req, res, next) {
  if (***REMOVED***req.session?.logado || ***REMOVED***req.session?.tenant_id) {
    return next(); // rotas públicas, deixa passar
  }

  const { db } = require('../db/database');
  const tenant = db.prepare('SELECT status FROM tenants WHERE id = ?').get(req.session.tenant_id);

  if (***REMOVED***tenant) {
    return res.status(400).json({ erro: 'Tenant não encontrado' });
  }

  if (tenant.status === 'bloqueado') {
    req.session.destroy(() => {
      return res.status(403).json({ erro: 'Sua conta foi bloqueada pelo administrador' });
    });
  }

  next();
}

// --- Autorização por PAPEL ---
// Factory: devolve um middleware que só deixa passar quem tem um dos papéis.
// Admin SEMPRE passa (superusuário). Sessão antiga sem papel = tratada como admin
// só se for o usuário admin do env (compat); senão, negada.
function exigirPapel(...papeis) {
  return (req, res, next) => {
    if (***REMOVED***req.session || ***REMOVED***req.session.logado) {
      return res.status(401).json({ erro: 'Não autenticado', login: true });
    }
    const papel = req.session.papel;
    if (papel === 'admin') return next();
    if (papeis.includes(papel)) return next();
    return res.status(403).json({ erro: 'Sem permissão para esta área' });
  };
}
// Atalho: só admin
const apenasAdmin = exigirPapel('admin');

// --- Rate limiters ---
// Global: protege a API toda contra abuso/DDoS leve
const limiteGlobal = rateLimit({
  windowMs: 15 * 60 * 1000,   // 15 min
  max: 600,                    // 600 req / 15min por IP (uso normal cabe folgado)
  standardHeaders: true,
  legacyHeaders: false,
  message: { erro: 'Muitas requisições. Tente novamente em alguns minutos.' },
});
// Login: estrito contra brute force
const limiteLogin = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 6,                      // 6 tentativas / 15min por IP
  standardHeaders: true,
  legacyHeaders: false,
  message: { erro: 'Muitas tentativas de login. Aguarde 15 minutos.' },
});

// Admin password: estrito contra brute force
const limiteAdminPassword = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 5,                      // 5 tentativas / 15min por IP
  standardHeaders: true,
  legacyHeaders: false,
  message: { erro: 'Muitas tentativas de admin. Aguarde 15 minutos.' },
});

// Forgot password: previne email enumeration
const limiteForgotPassword = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 5,                      // 5 pedidos / hora por IP
  standardHeaders: true,
  legacyHeaders: false,
  message: { erro: 'Muitos pedidos de redefinição. Tente novamente mais tarde.' },
});

// Reset senha: evita brute force no token
const limiteResetSenha = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,                     // 10 tentativas / 15min por IP
  standardHeaders: true,
  legacyHeaders: false,
  message: { erro: 'Muitas tentativas de reset. Aguarde 15 minutos.' },
});

module.exports = { hashSenha, verificarSenha, exigirLogin, injetarTenant, validarTenantAtivo, exigirPapel, apenasAdmin, limiteGlobal, limiteLogin, limiteAdminPassword, limiteForgotPassword, limiteResetSenha, ehPublica };
