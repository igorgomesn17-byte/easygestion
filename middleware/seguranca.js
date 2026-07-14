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
// Requisitos: 8+ chars, 1 maiúscula, 1 minúscula, 1 número, 1 símbolo
// Retorna: { valida: bool, erro: string|null }
function validarSenha(senha) {
  if (!senha || typeof senha !== 'string') {
    return { valida: false, erro: 'Senha obrigatória' };
  }
  const s = String(senha).trim();

  // 1. Mínimo 8 caracteres
  if (s.length < 8) {
    return { valida: false, erro: 'Senha deve ter no mínimo 8 caracteres' };
  }

  // 2. Pelo menos 1 letra maiúscula
  if (!/[A-Z]/.test(s)) {
    return { valida: false, erro: 'Incluir pelo menos 1 letra maiúscula (A-Z)' };
  }

  // 3. Pelo menos 1 letra minúscula
  if (!/[a-z]/.test(s)) {
    return { valida: false, erro: 'Incluir pelo menos 1 letra minúscula (a-z)' };
  }

  // 4. Pelo menos 1 número
  if (!/\d/.test(s)) {
    return { valida: false, erro: 'Incluir pelo menos 1 número (0-9)' };
  }

  // 5. Pelo menos 1 símbolo
  if (!/[!@#$%^&*()_+\-=\[\]{};':"\\|,.<>\/?]/.test(s)) {
    return { valida: false, erro: 'Incluir pelo menos 1 símbolo (!@#$%^&*...)' };
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
  '/api/registro',              // signup de novo tenant
  '/api/verify-email',          // verificar email após signup
  '/api/resend-verification',   // reenviar link de verificação
  '/api/logout',
  '/api/me',                    // decide sozinho se está logado (retorna 401 se não)
  '/api/forgot-password',       // redefinir senha
  '/api/reset-senha',           // confirmar redefinição
  '/api/loja-publica',
  '/api/lead-vitrine',          // captura de lead na vitrine (POST público)
  '/api/produtos/vitrine',
  '/api/vitrine',               // vitrine pública por slug (GET /:slug, GET /:slug/produtos)
  '/api/codigo-barras',         // imagens dos códigos (prefixo)
  '/api/admin',                 // backoffice admin (protegido por password/sessão)
  '/api/assinaturas/checkout',  // iniciar checkout Stripe (requer autenticação mas é chamada via fetch)
  '/api/assinaturas/planos',    // catálogo público de planos (vitrine de preços, sem login)
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
// Usuários de loja → tenant_id da sessão (gravado no login, routes/auth.js)
// Admin do backoffice → NÃO tem loja. Não entra aqui (ver o guard abaixo).
// Rotas públicas (sem login) → não injeta, deixa passar
function injetarTenant(req, res, next) {
  // Se não está logado, deixar passar (rotas públicas)
  if (!req.session?.logado) {
    return next();
  }

  // ⚠️ O ADMIN DO BACKOFFICE NÃO TEM LOJA.
  //
  // O login dele (routes/admin.js) grava `logado=true` na MESMA sessão do navegador
  // que o sistema da loja usa. Antes, ele também gravava `tenant_id = 1` — e o
  // fallback logo abaixo completava o estrago: ao voltar pro sistema depois de abrir
  // o /admin, o navegador entrava na LOJA DO TENANT 1 (uma conta-fantasma vazia).
  //
  // Aconteceu de verdade em 14/07/2026: o Igor abriu o backoffice, voltou pro sistema
  // e viu "a loja vazia, tudo sumiu". Nada tinha sumido — ele estava vendo outra conta.
  //
  // E o risco maior nem era esse: com tenantId=1 injetado, o admin podia CADASTRAR
  // PRODUTO ou LANÇAR VENDA no tenant 1 sem perceber.
  //
  // Sessão de backoffice serve só pro /api/admin/* (que tem seu próprio guard,
  // exigirAdminBackoffice, e não usa req.tenantId). Nas rotas da loja, ela não passa.
  if (req.session.admin_id) {
    return res.status(403).json({
      erro: 'Você está logado como administrador do sistema. Para usar uma loja, entre com a conta dela.',
      admin_backoffice: true,
    });
  }

  // Sessao criada ANTES de o login passar a gravar usuario_id: reidrata o id aqui,
  // em vez de deslogar quem ja estava dentro no dia do deploy. Busca por
  // (nome, tenant) — o par e' unico (UNIQUE(tenant_id, nome)), entao acha a pessoa
  // certa; buscar so por nome e' que pegaria a de outra loja.
  if (!req.session.usuario_id && req.session.usuario && req.session.tenant_id) {
    const { db } = require('../db/database');
    const u = db.prepare('SELECT id FROM usuarios WHERE nome = ? AND tenant_id = ?')
      .get(req.session.usuario, req.session.tenant_id);
    if (u) req.session.usuario_id = u.id;
  }

  // O tenant vem SEMPRE da sessão, gravado no login (routes/auth.js).
  //
  // Não há mais fallback pro tenant 1. O que existia aqui —
  //   if (papel === 'admin' && !tenant_id) { req.tenantId = 1; }
  // — parecia inofensivo, mas TODO dono de loja tem papel='admin' (é o admin da loja
  // DELE). Qualquer sessão sem tenant caía silenciosamente na loja do tenant 1, em vez
  // de falhar. Um default de tenant é a mesma classe de bug do
  // getConfig(chave, fallback, tenantId = 1): ele não quebra — ele mente.
  const tid = req.session?.tenant_id;
  if (tid) {
    req.tenantId = tid;
    return next();
  }

  // Logado mas sem tenant: estado inválido. Falha alto, não adivinha.
  return res.status(401).json({ erro: 'Sessão inválida. Entre novamente.' });
}

// --- Middleware: valida se tenant está bloqueado ou trial vencido ---
// Verifica se o tenant do usuário logado foi bloqueado ou está em trial vencido
// Se bloqueado, desconecta a sessão e retorna erro
// Se trial vencido, redireciona para planos.html
function validarTenantAtivo(req, res, next) {
  if (!req.session?.logado || !req.session?.tenant_id) {
    return next(); // rotas públicas, deixa passar
  }

  const { db } = require('../db/database');
  const { obterStatusAssinatura } = require('../lib/assinatura');
  const { normalizarPlano } = require('../lib/planos');
  const tenant = db.prepare('SELECT status, plano FROM tenants WHERE id = ?').get(req.session.tenant_id);

  if (!tenant) {
    return res.status(400).json({ erro: 'Tenant não encontrado' });
  }

  // Plano interno (uso próprio do dono): não tem assinatura no Stripe nem data de
  // renovação, então obterStatusAssinatura o veria como 'vencida' e o expulsaria pra
  // /planos.html — dentro do sistema dele mesmo. Só o bloqueio manual do admin
  // (status='bloqueado', logo abaixo) continua valendo; a régua de cobrança, não.
  const ehInterno = normalizarPlano(tenant.plano) === 'interno';

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

  // Verificar se trial venceu ou assinatura está vencida (bloqueia acesso)
  // NOTA: trial ATIVO não bloqueia — o cliente usa o Growth completo nos 14 dias.
  // Quando o trial VENCE, cai aqui: o acesso trava e ele é levado à tela de planos
  // pra escolher e pagar. É bloqueio de porta, não punição — quem punia era o
  // cobranca-scheduler marcando status='bloqueado' ("conta bloqueada pelo
  // administrador"), o que foi corrigido em lib/stripe.js.
  const statusAssinatura = ehInterno ? { status: 'ativa', bloqueado: false } : obterStatusAssinatura(req.session.tenant_id);
  if (statusAssinatura.status === 'vencida' || statusAssinatura.bloqueado) {
    // ⚠️ Este middleware é montado com app.use('/api', ...), então req.path é RELATIVO
    // ao mount: numa chamada a /api/produtos, req.path é '/produtos'. O teste antigo
    // (`req.path.startsWith('/api')`) era SEMPRE FALSO — nenhuma rota de API era
    // barrada, e o trial vencido continuava usando o sistema inteiro. Caía no redirect
    // logo abaixo, que um fetch() de API não sabe seguir.
    // O exigirLogin (acima) já tinha aprendido isso: ele reconstrói com '/api' + req.path.
    const rota = req.baseUrl + req.path;   // baseUrl='/api' quando montado assim

    // O cliente bloqueado precisa conseguir SAIR do bloqueio. Barrar tudo o prenderia
    // numa tela de planos que não carrega e num botão de pagar que não funciona.
    // Estas são as rotas que a própria /planos.html usa pra ele escolher e pagar.
    const ROTAS_DE_SAIDA = [
      '/api/me',                      // quem sou eu (a tela monta o cabeçalho com isso)
      '/api/assinaturas/planos',      // o catálogo de preços
      '/api/assinaturas/checkout',    // o botão de pagar
      '/api/assinaturas/minha',       // status da própria assinatura
      '/api/assinaturas/portal',      // portal do Stripe (trocar cartão)
      '/api/logout',
    ];
    if (ROTAS_DE_SAIDA.some((r) => rota === r || rota.startsWith(r + '/'))) {
      return next();
    }

    if (rota.startsWith('/api')) {
      return res.status(403).json({
        erro: 'Seu teste grátis terminou. Escolha um plano para continuar.',
        redirecionar: '/planos.html',
        trial_expirado: true
      });
    }
    // Requisição de página: redireciona pro checkout de planos.
    if (!rota.startsWith('/planos.html') && !rota.startsWith('/login.html') && !rota.startsWith('/logout')) {
      return res.redirect('/planos.html');
    }
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
// Atalho: só admin DA LOJA (o dono). CUIDADO: todo dono de loja tem papel='admin'
// (e' o admin da loja DELE). Use isto pra proteger o que e' do dono — estoque,
// financeiro, usuarios da loja. NAO use pra proteger dado de TODAS as lojas: pra isso
// existe exigirAdminBackoffice abaixo.
const apenasAdmin = exigirPapel('admin');

// Só o admin do BACKOFFICE (SaaS), que enxerga TODAS as lojas. A marca e'
// `session.admin_id`, gravado so pelo login de backoffice (senha + 2FA contra a
// tabela `admins`, em routes/admin.js). O dono de loja tem papel='admin' mas NUNCA
// admin_id — por isso `apenasAdmin` (que olha papel) o deixaria entrar aqui, e uma
// rota que lista/edita assinaturas ou clientes de todas as lojas nao pode permitir
// isso. Duplicado do guard de routes/admin.js, centralizado aqui pra reuso.
function exigirAdminBackoffice(req, res, next) {
  if (!req.session?.admin_id) {
    return res.status(403).json({ erro: 'Acesso negado. Apenas administradores do sistema.' });
  }
  return next();
}

// --- Autorização por PLANO (gate de features e limites por tier) ---
// Fonte única: lib/planos.js. Requer req.tenantId já injetado (injetarTenant).

// exigirFeature('vale_credito') → 403 {upgrade:true} se o plano do tenant não tem a feature.
function exigirFeature(feature) {
  return (req, res, next) => {
    const { planoDoTenant, temFeature } = require('../lib/planos');
    if (!req.tenantId) return res.status(401).json({ erro: 'Tenant não identificado' });
    const plano = planoDoTenant(req.tenantId);
    if (temFeature(plano, feature)) return next();
    return res.status(403).json({
      erro: 'Este recurso não está disponível no seu plano.',
      upgrade: true,
      feature,
      plano_atual: plano,
    });
  };
}

// exigirDentroDoLimite('produtos', contarFn) → 403 {upgrade:true} se já atingiu o teto.
// contarFn(tenantId) deve devolver a contagem atual do recurso.
// Usa >= porque a checagem roda ANTES de inserir o novo registro.
function exigirDentroDoLimite(recurso, contarFn) {
  return (req, res, next) => {
    const { planoDoTenant, limiteDe } = require('../lib/planos');
    if (!req.tenantId) return res.status(401).json({ erro: 'Tenant não identificado' });
    const plano = planoDoTenant(req.tenantId);
    const limite = limiteDe(plano, recurso);
    if (limite === Infinity) return next();
    let atual;
    try { atual = contarFn(req.tenantId); } catch (e) { return next(e); }
    if (atual >= limite) {
      return res.status(403).json({
        erro: `Seu plano permite até ${limite} ${recurso}. Faça upgrade para adicionar mais.`,
        upgrade: true,
        recurso,
        limite,
        atual,
        plano_atual: plano,
      });
    }
    return next();
  };
}

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
  skip: (req, res) => false,   // ✅ ATIVADO: protege contra brute force
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

module.exports = { hashSenha, verificarSenha, validarSenha, validarNaoReutilizada, exigirLogin, injetarTenant, validarTenantAtivo, validarTenantId, garantirTenantId, exigirPapel, apenasAdmin, exigirAdminBackoffice, exigirFeature, exigirDentroDoLimite, limiteGlobal, limiteLogin, limiteAdminPassword, limiteForgotPassword, limiteResetSenha, ehPublica };
