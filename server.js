// ============================================================
// DS SISTEMA - Servidor principal (com camada de segurança)
// Inicie com:  node server.js  (ou npm start)
// ============================================================
require('dotenv').config();
const express = require('express');
const path = require('path');
const os = require('os');
const session = require('express-session');
const helmet = require('helmet');
const cors = require('cors');
const https = require('https');
const fs = require('fs');

const logger = require('./lib/logger');
const loggerMiddleware = require('./middleware/logger-middleware');
const swaggerUi = require('swagger-ui-express');
const swaggerSpec = require('./lib/swagger-config');
const { db } = require('./db/database');
const { exigirLogin, injetarTenant, validarTenantAtivo, garantirTenantId, apenasAdmin, exigirPapel, limiteGlobal, limiteLogin } = require('./middleware/seguranca');
const { middlewareAuditoria } = require('./middleware/auditoria');
// PDV: admin OU vendedor (vendedor só vende e opera o caixa)
const pdvOuAdmin = exigirPapel('admin', 'vendedor');
const configRouter = require('./routes/config');
const { iniciar_backup_scheduler } = require('./lib/backup-scheduler');
const { iniciar_alertas_scheduler } = require('./lib/alertas-scheduler');
const { iniciar_renovacao_scheduler } = require('./lib/renovacao-scheduler');
const { iniciar_cobranca_scheduler } = require('./lib/cobranca-scheduler');

const app = express();
const PORT = process.env.PORT || 3000;
const NODE_ENV = process.env.NODE_ENV || 'development';
const EM_PRODUCAO = NODE_ENV === 'production';

// ============================================================
// ✅ VALIDAÇÃO DE BOOT: Verificar configurações obrigatórias
// ============================================================

// Logger de inicialização
if (EM_PRODUCAO) {
  logger.info('🚀 Iniciando EasyGestão em modo PRODUÇÃO');
} else {
  logger.debug(`⚠️  Iniciando EasyGestão em modo ${NODE_ENV}`);
}

// 1. ADMIN_SENHA_HASH obrigatório em produção
if (EM_PRODUCAO && !process.env.ADMIN_SENHA_HASH && !process.env.ADMIN_SENHA) {
  console.error(`
❌ ERRO CRÍTICO: Senha do admin não está configurada!

Em produção, você DEVE definir uma das variáveis de ambiente:
  • ADMIN_SENHA_HASH  (recomendado: já em hash scrypt)
  • ADMIN_SENHA       (alternativo: será hasheada ao boot)

Exemplo com ADMIN_SENHA_HASH (seguro):
  export ADMIN_SENHA_HASH="scrypt$<salt>$<hash>"

Exemplo com ADMIN_SENHA (simples):
  export ADMIN_SENHA="SuaSenhaForte123!@#"

NÃO use o fallback de desenvolvimento (dsstore) em produção!
`);
  process.exit(1);
}

// ============================================================
// ✅ VALIDAÇÃO 2: Secrets de Produção (TOKEN_SECRET, CERT_CIPHER_KEY, DEPLOY_TOKEN)
// ============================================================
if (EM_PRODUCAO) {
  const SECRETS_OBRIGATORIOS = ['TOKEN_SECRET', 'CERT_CIPHER_KEY', 'DEPLOY_TOKEN'];

  SECRETS_OBRIGATORIOS.forEach(secret => {
    if (!process.env[secret]) {
      console.error(`
❌ ERRO CRÍTICO: Secret não configurado!

Faltando variável de ambiente: ${secret}

Em produção, TODOS os secrets abaixo são obrigatórios:
  • TOKEN_SECRET (mínimo 32 caracteres aleatórios, para JWT)
  • CERT_CIPHER_KEY (mínimo 32 caracteres aleatórios, para certificado A1)
  • DEPLOY_TOKEN (token secreto para webhook de deploy)

Gere com:
  node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"

Adicione ao .env em produção.
      `);
      process.exit(1);
    }
  });
}

// 2. ORIGIN obrigatório em produção
// 3. SESSION_SECRET validado depois

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
if (EM_PRODUCAO && !ORIGIN) {
  console.error(`
❌ ERRO CRÍTICO: ORIGIN deve estar configurado em produção!

Configure a variável de ambiente ORIGIN com seu domínio:
  ORIGIN=https://oficialdsstore.com.br

Exemplos:
  - ORIGIN=https://oficialdsstore.com.br
  - ORIGIN=https://api.easygestion.com.br
  - ORIGIN=https://seu-dominio.com

⚠️  A ausência de ORIGIN causará falhas de CORS em produção!
  `);
  process.exit(1);
}
app.use(cors({ origin: ORIGIN, credentials: true }));

// ---------- Health check (público, sem autenticação) ----------
app.get('/health', (req, res) => {
  res.json({ status: 'ok', ts: new Date().toISOString(), uptime: process.uptime() });
});

// ---------- Swagger/OpenAPI Documentation ----------
app.use('/api/docs', swaggerUi.serve);
app.get('/api/docs', swaggerUi.setup(swaggerSpec, {
  swaggerOptions: {
    persistAuthorization: true
  }
}));

// ---------- Webhooks Stripe (ANTES do json parser — precisa do raw body) ----------
app.use('/api/webhooks/stripe', express.raw({type: 'application/json'}), (req, res, next) => {
  req.rawBody = req.body.toString('utf8');
  next();
});
app.use('/api/webhooks', require('./routes/webhooks'));

// ---------- Webhook de Deploy (puxar código + reiniciar) ----------
app.use('/api/deploy', require('./routes/deploy'));

// ---------- Body parsers ----------
// guarda o corpo cru (raw) p/ validar a assinatura HMAC dos webhooks da Meta
app.use(express.json({ limit: '8mb', verify: (req, _res, buf) => { req.rawBody = buf.toString('utf8'); } }));
app.use(express.urlencoded({ extended: true, limit: '8mb' }));

// ---------- Sessão com Store SQLite (persist entre restarts) ----------
if (!process.env.SESSION_SECRET || process.env.SESSION_SECRET.length < 32) {
  console.error('❌ ERRO: SESSION_SECRET deve ter no mínimo 32 caracteres!');
  process.exit(1);
}

// Store customizado: SQLite para express-session
class SQLiteSessionStore extends session.Store {
  constructor(db) {
    super();
    this.db = db;
  }

  get(sid, callback) {
    try {
      const row = this.db.prepare('SELECT sess FROM sessions WHERE sid = ? AND expire > ?').get(sid, Math.floor(Date.now() / 1000));
      if (!row) return callback(null, null);
      callback(null, JSON.parse(row.sess));
    } catch (err) {
      console.error('[SESSION STORE GET ERROR]', err);
      callback(err);
    }
  }

  set(sid, sess, callback) {
    try {
      const expire = Math.floor(Date.now() / 1000) + (sess.cookie.maxAge ? Math.floor(sess.cookie.maxAge / 1000) : 12 * 60 * 60);
      console.log(`[SESSION STORE SET] sid=${sid}, expire=${expire}`);
      this.db.prepare('INSERT OR REPLACE INTO sessions (sid, sess, expire) VALUES (?, ?, ?)').run(sid, JSON.stringify(sess), expire);
      console.log(`[SESSION STORE SET OK] sid=${sid}`);
      callback(null);
    } catch (err) {
      console.error('[SESSION STORE SET ERROR]', err);
      callback(err);
    }
  }

  destroy(sid, callback) {
    try {
      this.db.prepare('DELETE FROM sessions WHERE sid = ?').run(sid);
      callback(null);
    } catch (err) {
      console.error('[SESSION STORE DESTROY ERROR]', err);
      callback(err);
    }
  }

  clear(callback) {
    try {
      this.db.prepare('DELETE FROM sessions').run();
      callback(null);
    } catch (err) {
      console.error('[SESSION STORE CLEAR ERROR]', err);
      callback(err);
    }
  }
}

// Instanciar o store
const store = new SQLiteSessionStore(db);

app.use(session({
  name: 'ds.sid',
  secret: process.env.SESSION_SECRET,
  store: store,
  resave: false,
  saveUninitialized: true,  // CRITICAL: permite criar sessão vazia no início pra setar cookie
  cookie: {
    httpOnly: true,
    secure: false,  // será ativado via reverse proxy HTTPS em produção
    sameSite: 'lax',
    maxAge: 12 * 60 * 60 * 1000,    // 12h
  },
}));

// ---------- Desabilitar cache pra APIs (garante respostas sempre frescas) ----------
app.disable('etag');  // Desabilita ETag automaticamente
app.use('/api', (req, res, next) => {
  res.set('Cache-Control', 'no-cache, no-store, must-revalidate');
  res.set('Pragma', 'no-cache');
  res.set('Expires', '0');
  next();
});

// ---------- Rate limit específicos (ANTES do global) ----------
app.use('/api/login', limiteLogin);              // brute force na rota /login
// Nota: /api/admin/login tem rate limit específico na rota (limiteAdminPassword)

// ---------- Rotas PÚBLICAS (sem login) ----------
app.use('/api', require('./routes/auth'));        // /login /logout /me (auth decide)
app.get('/api/loja-publica', configRouter.lojaPublica);

// ✅ Admin login PÚBLICO (mas com rate limit agressivo)
// POST /api/admin/login → autentica admin via senha (rate limited em routes/admin.js)
// POST /api/admin/logout → encerra sessão admin
// GET /admin → redireciona pra login se não está autenticado
app.use('/api/admin', require('./routes/admin')); // POST /login, POST /logout SEM autenticação

// ---------- Rate limit global (DEPOIS dos específicos) ----------
app.use('/api', limiteGlobal);
app.use('/admin', require('./routes/admin'));     // GET / com autenticação de session

// ✅ Rotas públicas de token (ANTES de exigirLogin + com injetarTenant)
app.use('/api/config/focus-token', injetarTenant, (req, res, next) => {
  if (!req.session || !req.session.logado) {
    return res.status(401).json({ erro: 'Não autenticado' });
  }
  next();
});
app.use('/api/config/focus-token', require('./routes/focus-token'));

// ---------- Middleware de Logger (antes de autenticação) ----------
app.use(loggerMiddleware);

// ---------- Middleware de autenticação (protege o resto) ----------
app.use('/api', exigirLogin);

// ---------- Middleware de tenant (injeta req.tenantId em rotas protegidas) ----------
app.use('/api', injetarTenant);

// ✅ Rotas de config (DEPOIS de injetarTenant, recebem req.tenantId)
app.use('/api/config', configRouter);

// ✅ CRÍTICO: Garante que req.tenantId foi injetado (previne cross-tenant attacks)
// Rotas públicas são excluídas automaticamente
app.use('/api', garantirTenantId);

// ✅ Validar se tenant foi bloqueado (impede acesso se status = 'bloqueado')
app.use('/api', validarTenantAtivo);

// ---------- Middleware de Auditoria (registra mudanças em todas as rotas protegidas) ----------
// LGPD: rastreabilidade de quem fez o quê, quando e onde
app.use('/api', middlewareAuditoria);

// ---------- Rotas de Onboarding (antes das rotas normais) ----------
app.use('/api/onboarding', require('./routes/onboarding'));

// ---------- Rotas da API (protegidas) ----------
app.use('/api/produtos',   require('./routes/produtos'));   // admin + vendedor (busca)
app.use('/api/clientes',   require('./routes/clientes'));   // admin + vendedor (busca/cria)
app.use('/api/codigo-barras', require('./routes/codigoBarras'));

// SÓ ADMIN — financeiro, vendas, custos, gestão:
app.use('/api/estoque',       apenasAdmin, require('./routes/estoque'));
app.use('/api/vendas',        pdvOuAdmin, require('./routes/vendas'));   // vendedor: só POST (vender)
app.use('/api/vendedores',    pdvOuAdmin, require('./routes/vendedores')); // PDV precisa da lista
app.use('/api/caixa',         pdvOuAdmin, require('./routes/caixa'));      // vendedor opera o caixa
app.use('/api/trocas',        apenasAdmin, require('./routes/trocas'));     // trocas e devoluções
app.use('/api/vales',         pdvOuAdmin, require('./routes/vales'));       // vales usados no PDV
app.use('/api/despesas',      apenasAdmin, require('./routes/despesas'));
app.use('/api/financeiro',    apenasAdmin, require('./routes/financeiro'));
app.use('/api/nfce',          apenasAdmin, require('./routes/nfce'));      // NFC-e fiscal
app.use('/api/dashboard',     apenasAdmin, require('./routes/dashboard'));
app.use('/api/backup',        apenasAdmin, require('./routes/backup'));
app.use('/api/usuarios',      apenasAdmin, require('./routes/usuarios'));
app.use('/api/auditoria',     apenasAdmin, require('./routes/auditoria'));  // LGPD: logs de ações
app.use('/api/assinaturas',   require('./routes/assinaturas'));  // cliente pode ver sua, admin vê todas
app.use('/api/pagamentos',    require('./routes/pagamentos'));   // Stripe checkout + webhook

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

// ---------- Monitoring & Métricas ----------
const { getMonitor, getMetrics, getAlerts } = require('./lib/monitoring');

app.get('/api/monitoring/metrics', (req, res) => {
  // Apenas admin pode ver métricas
  if (!req.session || req.session.papel !== 'admin') {
    return res.status(403).json({ erro: 'Sem permissão' });
  }
  res.json(getMonitor().getMetrics());
});

app.get('/api/monitoring/alerts', (req, res) => {
  // Apenas admin pode ver alertas
  if (!req.session || req.session.papel !== 'admin') {
    return res.status(403).json({ erro: 'Sem permissão' });
  }
  const { type, severity } = req.query;
  res.json(getMonitor().getAlerts(type, severity));
});

// Landing page pública (raiz para visitantes não-autenticados)
app.get('/', (req, res, next) => {
  console.log('[ROUTE] GET / -> landing.html');
  res.sendFile(path.join(__dirname, 'public', 'landing.html'), (err) => {
    if (err) {
      console.error('[ROUTE] Erro ao servir landing.html:', err);
      next(err);
    }
  });
});

// Servir o painel em /painel em vez da raiz (para usuarios autenticados)
app.get('/painel', (req, res, next) => {
  console.log('[ROUTE] GET /painel -> index.html');
  res.sendFile(path.join(__dirname, 'public', 'index.html'), (err) => {
    if (err) {
      console.error('[ROUTE] Erro ao servir index.html:', err);
      next(err);
    }
  });
});

// HTML/JS sem cache (garante que o navegador sempre pegue a versão nova das telas)
// IMPORTANTE: index=false para nao servir index.html automaticamente na raiz
app.use(express.static(path.join(__dirname, 'public'), {
  index: false,
  setHeaders: (res, filePath) => {
    res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
    res.setHeader('Pragma', 'no-cache');
    res.setHeader('Expires', '0');
    if (filePath.endsWith('.html')) {
      res.setHeader('Content-Type', 'text/html; charset=utf-8');
    }
    res.setHeader('ETag', 'W/"' + Date.now() + '"');
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

// ============================================================
// Iniciar servidor com HTTPS se certificados existem
// ============================================================
const CERT_PATH = path.join(__dirname, 'certs', 'cert.pem');
const KEY_PATH = path.join(__dirname, 'certs', 'key.pem');
const USE_HTTPS = fs.existsSync(CERT_PATH) && fs.existsSync(KEY_PATH);
const HTTPS_PORT = 3443;  // porta alternativa (não precisa de root)

if (USE_HTTPS) {
  const httpsOptions = {
    cert: fs.readFileSync(CERT_PATH),
    key: fs.readFileSync(KEY_PATH)
  };
  https.createServer(httpsOptions, app).listen(HTTPS_PORT, '0.0.0.0', () => {
    const ip = getLocalIP();
    console.log('\n========================================');
    console.log('   DS SISTEMA no ar (HTTPS)' + (EM_PRODUCAO ? ' (produção)' : ' (local)'));
    console.log('========================================');
    console.log(`   Neste PC:     https://localhost:${HTTPS_PORT}`);
    if (!EM_PRODUCAO) console.log(`   No celular:   https://${ip}:${HTTPS_PORT}`);
    console.log('========================================\n');

    // Iniciar agendadores automáticos
    iniciar_backup_scheduler();
    iniciar_alertas_scheduler();
    iniciar_renovacao_scheduler();
    iniciar_cobranca_scheduler();
  });

  // HTTP também roda pra compatibilidade
  app.listen(PORT, '0.0.0.0', () => {
    const ip = getLocalIP();
    console.log(`   HTTP (compatibilidade): http://localhost:${PORT}`);
    if (!EM_PRODUCAO) console.log(`                          http://${ip}:${PORT}`);
  });
} else {
  app.listen(PORT, '0.0.0.0', () => {
    const ip = getLocalIP();
    console.log('\n========================================');
    console.log('   DS SISTEMA no ar (HTTP)' + (EM_PRODUCAO ? ' (produção)' : ' (local)'));
    console.log('========================================');
    console.log(`   Neste PC:     http://localhost:${PORT}`);
    if (!EM_PRODUCAO) console.log(`   No celular:   http://${ip}:${PORT}`);
    console.log('========================================\n');

    // Iniciar agendadores automáticos
    iniciar_backup_scheduler();
    iniciar_alertas_scheduler();
    iniciar_renovacao_scheduler();
    iniciar_cobranca_scheduler();
  });
}
