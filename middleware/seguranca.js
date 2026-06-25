// ============================================================
// Middleware de segurança: autenticação, autorização e rate limit
// ============================================================
const crypto = require('crypto');
const rateLimit = require('express-rate-limit');
const { ipKeyGenerator } = require('express-rate-limit');

// --- Hash de senha (scrypt nativo — sem libs de build nativo) ---
// formato armazenado: scrypt$<salt-hex>$<hash-hex>
function hashSenha(senha) {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(String(senha), salt, 64).toString('hex');
  return `scrypt$${salt}$${hash}`;
}
function verificarSenha(senha, armazenado) {
  if (!armazenado || !armazenado.startsWith('scrypt$')) return false;
  const [, salt, hashEsperado] = armazenado.split('$');
  const hash = crypto.scryptSync(String(senha), salt, 64).toString('hex');
  // comparação em tempo constante (evita timing attack)
  const a = Buffer.from(hash, 'hex');
  const b = Buffer.from(hashEsperado, 'hex');
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

// --- Validação de força de senha ---
// Regra simples: mínimo 8 caracteres (sem requisitos de maiúscula, número ou símbolo)
// Retorna: { valida: bool, erro: string|null }
function validarSenha(senha) {
  if (!senha || typeof senha !== 'string') {
    return { valida: false, erro: 'Senha obrigatória' };
  }
  const s = String(senha).trim();
  if (s.length < 8) {
    return { valida: false, erro: 'Senha deve ter no mínimo 8 caracteres' };
  }
  return { valida: true, erro: null };
}

// --- Verificar reutilização de senha (sem histórico, mas valida complexidade) ---
// No futuro, integrar com tabela de histórico se necessário
function validarNaoReutilizada(novaSenha, senhaAntigaHash) {
  // Comparação rápida: se forem exatamente o mesmo hash, é reutilização
  if (senhaAntigaHash && verificarSenha(novaSenha, senhaAntigaHash)) {
    return { valida: false, erro: 'Nova senha não pode ser igual à senha anterior' };
  }
  return { valida: true, erro: null };
}

// --- Rotas/prefixos PÚBLICOS (não exigem login) ---
const PUBLICAS = [
  '/api/login',
  '/api/admin/login',           // novo: login admin por senha
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
  if (!req.session?.logado) {
    return next();
  }

  // Se é admin do .env e ainda não tem tenant_id, assume tenant 1
  if (req.session?.papel === 'admin' && !req.session?.tenant_id) {
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
  if (!req.session?.logado || !req.session?.tenant_id) {
    return next(); // rotas públicas, deixa passar
  }

  const { db } = require('../db/database');
  const tenant = db.prepare('SELECT status FROM tenants WHERE id = ?').get(req.session.tenant_id);

  if (!tenant) {
    return res.status(400).json({ erro: 'Tenant não encontrado' });
  }

  // ✅ CRÍTICO: Se tenant foi bloqueado, destruir sessão e negar acesso
  if (tenant.status === 'bloqueado') {
    req.session.destroy((err) => {
      // Não importa se destroy() falhar, nega acesso mesmo assim
      return res.status(403).json({
        erro: 'Sua conta foi bloqueada pelo administrador',
        bloqueado: true
      });
    });
    return; // NÃO chama next()!
  }

  next();
}

// --- Validação de tenant (CRÍTICO para multi-tenancy) ---
// NUNCA use req.tenantId || fallback — isso quebra isolamento de tenant!
// Use esta função ou middleware para validar antes de qualquer query
function validarTenantId(req) {
  if (!req.tenantId) {
    const err = new Error('Tenant não identificado');
    err.status = 401;
    throw err;
  }
  return req.tenantId;
}

// Middleware que garante req.tenantId está presente em rotas protegidas
function garantirTenantId(req, res, next) {
  const full = '/api' + req.path;
  // Rotas públicas não precisam de tenant (pode ser undefined)
  if (ehPublica(full)) return next();
  // Rotas protegidas EXIGEM tenant
  if (!req.tenantId) {
    return res.status(401).json({ erro: 'Tenant não identificado' });
  }
  next();
}

// --- Autorização por PAPEL ---
// Factory: devolve um middleware que só deixa passar quem tem um dos papéis.
// Admin SEMPRE passa (superusuário). Sessão antiga sem papel = tratada como admin
// só se for o usuário admin do env (compat); senão, negada.
function exigirPapel(...papeis) {
  return (req, res, next) => {
    if (!req.session || !req.session.logado) {
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
// Chave combina IP + tenant_id para isolamento multi-tenant (um tenant não afeta outros)
const limiteGlobal = rateLimit({
  windowMs: 15 * 60 * 1000,   // 15 min
  max: 600,                    // 600 req / 15min por tenant+IP
  standardHeaders: true,
  legacyHeaders: false,
  message: { erro: 'Muitas requisições. Tente novamente em alguns minutos.' },
  keyGenerator: (req) => {
    // Se logado, usar tenant_id como parte da chave; senão, só IP
    const tenant = req.session?.tenant_id || 'anon';
    // Usar ipKeyGenerator para suportar IPv6 corretamente
    const ip = req.ip || req.connection.remoteAddress || '';
    return `${ip}-${tenant}`;
  },
  skip: (req) => {
    // Pula o rate limit global para /api/admin/login (tem seu próprio limite)
    // req.path aqui é relativo ao mount `/api`, então será `/admin/login`
    return req.path?.startsWith('/admin/login');
  },
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
  max: 6,                      // 6 tentativas / 15min por IP
  standardHeaders: true,
  legacyHeaders: false,
  message: { erro: 'Muitas tentativas de login admin. Aguarde 15 minutos.' },
  skip: (req, res) => false, // Não pular nenhuma requisição
  keyGenerator: ipKeyGenerator // Use IPv6-safe helper
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

module.exports = { hashSenha, verificarSenha, validarSenha, validarNaoReutilizada, exigirLogin, injetarTenant, validarTenantAtivo, validarTenantId, garantirTenantId, exigirPapel, apenasAdmin, limiteGlobal, limiteLogin, limiteAdminPassword, limiteForgotPassword, limiteResetSenha, ehPublica };
