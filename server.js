// ============================================================
// DS SISTEMA - Servidor principal (com camada de segurança)
// Inicie com:  node server.js  (ou npm start)
// ============================================================
const express = require('express');
const path = require('path');
const os = require('os');
const session = require('express-session');
const helmet = require('helmet');
const cors = require('cors');

const { exigirLogin, injetarTenant, validarTenantAtivo, garantirTenantId, apenasAdmin, exigirPapel, limiteGlobal, limiteLogin } = require('./middleware/seguranca');
const { middlewareAuditoria } = require('./middleware/auditoria');
// PDV: admin OU vendedor (vendedor só vende e opera o caixa)
const pdvOuAdmin = exigirPapel('admin', 'vendedor');
const configRouter = require('./routes/config');
const { iniciar_backup_scheduler } = require('./lib/backup-scheduler');

const app = express();
const PORT = process.env.PORT || 3000;
const EM_PRODUCAO = process.env.NODE_ENV === 'production';

app.set('trust proxy', 1); // atrás do proxy do Render/Cloudflare (IP real p/ rate limit)

// ---------- Segurança: headers (Helmet + CSP) ----------
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      styleSrc: ["'self'", "'unsafe-inline'", 'https://fonts.googleapis.com'],
      fontSrc: ["'self'", 'https://fonts.gstatic.com'],
      scriptSrc: ["'self'", "'unsafe-inline'"],
      scriptSrcAttr: ["'unsafe-inline'"],
      imgSrc: ["'self'", 'data:', 'blob:'],
      connectSrc: ["'self'"],
      frameAncestors: ["'self'"],
      objectSrc: ["'none'"],
      baseUri: ["'self'"],
      formAction: ["'self'"],
    },
  },
  crossOriginEmbedderPolicy: false,
  frameguard: { action: 'deny' },
  hsts: { maxAge: 31536000, includeSubDomains: true, preload: true },
  referrerPolicy: { policy: 'strict-origin-when-cross-origin' },
  xContentTypeOptions: true,
  xDNSPrefetchControl: true,
  xDownloadOptions: true,
  xPoweredBy: false,
  xXssProtection: true,
}));

// ---------- CORS (restrito ao próprio domínio) ----------
const ORIGIN = process.env.ORIGIN || (EM_PRODUCAO ? false : 'http://localhost:3000');
if (***REMOVED***ORIGIN && EM_PRODUCAO) {
  console.error('❌ ERRO: ORIGIN deve estar configurado em produção***REMOVED***');
  process.exit(1);
}
app.use(cors({ origin: ORIGIN, credentials: true }));

// ---------- Body parsers ----------
// guarda o corpo cru (raw) p/ validar a assinatura HMAC dos webhooks da Meta
app.use(express.json({ limit: '8mb', verify: (req, _res, buf) => { req.rawBody = buf.toString('utf8'); } }));
app.use(express.urlencoded({ extended: true, limit: '8mb' }));

// ---------- Sessão ----------
if (***REMOVED***process.env.SESSION_SECRET || process.env.SESSION_SECRET.length < 32) {
  console.error('❌ ERRO: SESSION_SECRET deve ter no mínimo 32 caracteres***REMOVED***');
  process.exit(1);
}
app.use(session({
  name: 'ds.sid',
  secret: process.env.SESSION_SECRET,
  resave: false,
  saveUninitialized: false,
  cookie: {
    httpOnly: true,
    secure: EM_PRODUCAO,            // só via HTTPS em produção
    sameSite: 'lax',
    maxAge: 12 * 60 * 60 * 1000,    // 12h
  },
}));

// ---------- Rate limit global ----------
app.use('/api', limiteGlobal);

// ---------- Middleware de Auditoria (registra todas as ações admin) ----------
app.use('/api/admin', middlewareAuditoria);

// ---------- Rotas PÚBLICAS (sem login) ----------
app.use('/api/login', limiteLogin);              // brute force
app.use('/api', require('./routes/auth'));        // /login /logout /me (auth decide)
app.get('/api/loja-publica', configRouter.lojaPublica);

// ✅ Admin login PÚBLICO (mas com rate limit agressivo)
// POST /api/admin/login → autentica admin via senha
// POST /api/admin/logout → encerra sessão admin
// GET /admin → redireciona pra login se não está autenticado
app.use('/api/admin', require('./routes/admin')); // POST /login, POST /logout SEM autenticação
app.use('/admin', require('./routes/admin'));     // GET / com autenticação de session

// ---------- Middleware de autenticação (protege o resto) ----------
app.use('/api', exigirLogin);

// ---------- Middleware de tenant (injeta req.tenantId em rotas protegidas) ----------
app.use('/api', injetarTenant);

// ✅ CRÍTICO: Garante que req.tenantId foi injetado (previne cross-tenant attacks)
// Rotas públicas são excluídas automaticamente
app.use('/api', garantirTenantId);

// ✅ Validar se tenant foi bloqueado (impede acesso se status = 'bloqueado')
app.use('/api', validarTenantAtivo);

// ---------- Rotas da API (protegidas) ----------
app.use('/api/produtos',   require('./routes/produtos'));   // admin + vendedor (busca)
app.use('/api/clientes',   require('./routes/clientes'));   // admin + vendedor (busca/cria)
app.use('/api/config',     configRouter);                   // GET filtra por papel; POST só admin
app.use('/api/codigo-barras', require('./routes/codigoBarras'));

// SÓ ADMIN — financeiro, vendas, custos, gestão:
app.use('/api/estoque',    apenasAdmin, require('./routes/estoque'));
app.use('/api/vendas',     pdvOuAdmin, require('./routes/vendas'));   // vendedor: só POST (vender)
app.use('/api/vendedores', pdvOuAdmin, require('./routes/vendedores')); // PDV precisa da lista
app.use('/api/caixa',      pdvOuAdmin, require('./routes/caixa'));      // vendedor opera o caixa
app.use('/api/trocas',     apenasAdmin, require('./routes/trocas'));     // trocas e devoluções
app.use('/api/despesas',   apenasAdmin, require('./routes/despesas'));
app.use('/api/financeiro', apenasAdmin, require('./routes/financeiro'));
app.use('/api/nfce',       apenasAdmin, require('./routes/nfce'));      // NFC-e fiscal
app.use('/api/dashboard',  apenasAdmin, require('./routes/dashboard'));
app.use('/api/backup',     apenasAdmin, require('./routes/backup'));
app.use('/api/usuarios',   apenasAdmin, require('./routes/usuarios'));

// ---------- Arquivos estáticos (telas + fotos no disco persistente) ----------
const UPLOADS_DIR = process.env.UPLOADS_DIR || path.join(__dirname, 'public', 'img', 'produtos');
app.use('/img/produtos', express.static(UPLOADS_DIR));
// logo da loja (personalização da marca) — disco persistente em produção
const MARCA_DIR = process.env.UPLOADS_DIR
  ? path.join(process.env.UPLOADS_DIR, 'marca')
  : path.join(__dirname, 'public', 'img', 'marca');
app.use('/img/marca', express.static(MARCA_DIR));
// comprovantes (print do Pix por chave) — disco persistente em produção
const COMPROVANTES_DIR = process.env.UPLOADS_DIR
  ? path.join(process.env.UPLOADS_DIR, 'comprovantes')
  : path.join(__dirname, 'public', 'img', 'comprovantes');
app.use('/img/comprovantes', express.static(COMPROVANTES_DIR));
// HTML/JS sem cache (garante que o navegador sempre pegue a versão nova das telas)
app.use(express.static(path.join(__dirname, 'public'), {
  setHeaders: (res, filePath) => {
    if (filePath.endsWith('.html') || filePath.endsWith('.js')) {
      res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
    }
  },
}));

// ---------- Tratamento de erro centralizado (NÃO vaza stack/detalhe) ----------
app.use((err, req, res, next) => {
  console.error('[ERRO]', err.message);                 // log interno completo
  const publico = err.status && err.status < 500 ? err.message : 'Erro interno do servidor';
  res.status(err.status || 500).json({ erro: publico });  // resposta sanitizada
});

function getLocalIP() {
  const ifaces = os.networkInterfaces();
  for (const name of Object.keys(ifaces)) {
    for (const iface of ifaces[name]) {
      if (iface.family === 'IPv4' && ***REMOVED***iface.internal) return iface.address;
    }
  }
  return 'localhost';
}

app.listen(PORT, '0.0.0.0', () => {
  const ip = getLocalIP();
  console.log('\n========================================');
  console.log('   DS SISTEMA no ar***REMOVED***' + (EM_PRODUCAO ? ' (produção)' : ' (local)'));
  console.log('========================================');
  console.log(`   Neste PC:     http://localhost:${PORT}`);
  if (***REMOVED***EM_PRODUCAO) console.log(`   No celular:   http://${ip}:${PORT}`);
  console.log('========================================\n');

  // Iniciar agendador de backup automático
  iniciar_backup_scheduler();
});
