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

const { exigirLogin, apenasAdmin, exigirPapel, limiteGlobal, limiteLogin } = require('./middleware/seguranca');
// PDV: admin OU vendedor (vendedor só vende e opera o caixa)
const pdvOuAdmin = exigirPapel('admin', 'vendedor');
const configRouter = require('./routes/config');
const LicenseManager = require('./license');

const app = express();
const PORT = process.env.PORT || 3000;
const EM_PRODUCAO = process.env.NODE_ENV === 'production';

app.set('trust proxy', 1); // atrás do proxy do Render/Cloudflare (IP real p/ rate limit)

// ---------- Segurança: headers (Helmet + CSP) ----------
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      // a vitrine usa Google Fonts; inline styles existem nas telas (legado) → permitidos
      styleSrc: ["'self'", "'unsafe-inline'", 'https://fonts.googleapis.com'],
      fontSrc: ["'self'", 'https://fonts.gstatic.com'],
      scriptSrc: ["'self'", "'unsafe-inline'"],     // scripts inline das telas (legado)
      scriptSrcAttr: ["'unsafe-inline'"],            // handlers onclick="" inline (todo o sistema usa)
      imgSrc: ["'self'", 'data:', 'blob:'],
      connectSrc: ["'self'"],
      // 'self' permite a SPA de Relacionamento embutir as telas (inbox/crm/rfm) em iframe,
      // mas continua bloqueando sites externos (anti-clickjacking preservado).
      frameAncestors: ["'self'"],
      objectSrc: ["'none'"],
      baseUri: ["'self'"],
      formAction: ["'self'"],
    },
  },
  crossOriginEmbedderPolicy: false, // permite imagens/fontes externas
}));

// ---------- CORS (restrito ao próprio domínio em produção) ----------
const ORIGIN = process.env.ORIGIN || true; // em dev (sem env) reflete a origem
app.use(cors({ origin: ORIGIN, credentials: true }));

// ---------- Body parsers ----------
// guarda o corpo cru (raw) p/ validar a assinatura HMAC dos webhooks da Meta
app.use(express.json({ limit: '8mb', verify: (req, _res, buf) => { req.rawBody = buf.toString('utf8'); } }));
app.use(express.urlencoded({ extended: true, limit: '8mb' }));

// ---------- Sessão ----------
app.use(session({
  name: 'ds.sid',
  secret: process.env.SESSION_SECRET || 'ds-dev-secret-troque-em-producao',
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

// ---------- Rotas PÚBLICAS (sem login) ----------
app.use('/api/login', limiteLogin);              // brute force
app.use('/api', require('./routes/auth'));        // /login /logout /me (auth decide)
app.get('/api/loja-publica', configRouter.lojaPublica);

// ---------- Rotas de Licença (ANTES da autenticação) ----------
app.use('/api/license', require('./routes/license'));

// ---------- Middleware de verificação de licença ----------
app.use((req, res, next) => {
  // Permitir ativacao.html e rotas públicas
  if (req.path === '/ativacao.html' ||
      req.path.startsWith('/api/license') ||
      req.path === '/api/login' ||
      req.path.startsWith('/api/auth')) {
    return next();
  }

  // Para qualquer outra rota, verificar licença
  const license = LicenseManager.isLicensed();
  if (!license.licensed) {
    // Se é uma requisição JSON (API), retornar erro
    if (req.headers.accept && req.headers.accept.includes('application/json')) {
      return res.status(403).json({ error: 'Licença não ativada', redirect: '/ativacao.html' });
    }
    // Se é uma página HTML, redirecionar para ativação
    return res.redirect('/ativacao.html');
  }

  next();
});

// ---------- Middleware de autenticação (protege o resto) ----------
app.use('/api', exigirLogin);

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
      if (iface.family === 'IPv4' && !iface.internal) return iface.address;
    }
  }
  return 'localhost';
}

app.listen(PORT, '0.0.0.0', () => {
  const ip = getLocalIP();
  console.log('\n========================================');
  console.log('   DS SISTEMA no ar!' + (EM_PRODUCAO ? ' (produção)' : ' (local)'));
  console.log('========================================');
  console.log(`   Neste PC:     http://localhost:${PORT}`);
  if (!EM_PRODUCAO) console.log(`   No celular:   http://${ip}:${PORT}`);
  console.log('========================================\n');
});
