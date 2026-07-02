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
  if (!armazenado || !armazenado.startsWith('scrypt$')) return false;
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
  '/api/logout',
  '/api/me',              // decide sozinho se está logado (retorna 401 se não)
  '/api/loja-publica',
  '/api/lead-vitrine',    // captura de lead na vitrine (POST público)
  '/api/produtos/vitrine',
  '/api/codigo-barras',   // imagens dos códigos (prefixo)
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

module.exports = { hashSenha, verificarSenha, exigirLogin, exigirPapel, apenasAdmin, limiteGlobal, limiteLogin, ehPublica };
