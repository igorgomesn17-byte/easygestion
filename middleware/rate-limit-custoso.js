// ============================================================
// Rate Limit para Operações Custosas
// Limita uploads de fotos, gera de relatórios, exports
// ============================================================

const rateLimit = require('express-rate-limit');

// --- UPLOADS: 100MB por tenant por dia (limite de storage + processamento) ---
// Rastreia por tenant_id em vez de IP
const limiteUploadPorTenant = (() => {
  const store = new Map(); // { tenantId -> { bytes, resetTime } }

  return (req, res, next) => {
    const tenantId = req.tenantId || 1;
    const hoje = new Date().toDateString();
    const chave = `${tenantId}-${hoje}`;

    if (!store.has(chave)) {
      store.set(chave, { bytes: 0, resetTime: Date.now() + 24 * 60 * 60 * 1000 });
    }

    const entry = store.get(chave);

    // Limpar se passou 24h
    if (Date.now() > entry.resetTime) {
      store.set(chave, { bytes: 0, resetTime: Date.now() + 24 * 60 * 60 * 1000 });
    }

    // Calcular tamanho total de arquivos na requisição
    let totalBytes = 0;
    if (req.body && req.body.fotos && Array.isArray(req.body.fotos)) {
      for (const foto of req.body.fotos) {
        if (typeof foto === 'string' && foto.startsWith('data:')) {
          // Tamanho aproximado: base64 é ~4/3 do tamanho do binário
          const size = Buffer.byteLength(foto, 'utf8') * 0.75;
          totalBytes += size;
        }
      }
    }

    const LIMITE_DIARIO = 100 * 1024 * 1024; // 100MB por dia
    const bytesUsados = entry.bytes + totalBytes;

    if (bytesUsados > LIMITE_DIARIO) {
      const mbUsados = Math.round(entry.bytes / 1024 / 1024);
      const mbLimite = Math.round(LIMITE_DIARIO / 1024 / 1024);
      return res.status(429).json({
        erro: `Limite de upload excedido (${mbUsados}/${mbLimite}MB). Tente novamente amanhã.`,
      });
    }

    // Incrementar uso
    entry.bytes = bytesUsados;

    // Passar tamanho para o handler se quiser auditar
    req.uploadBytes = totalBytes;

    next();
  };
})();

// --- CACHE para relatórios (DRE, Curva ABC, etc) ---
// TTL: 5 minutos. Invalida se mudança no período afeta o resultado
const cacheRelatorioPorTenant = (() => {
  const cache = new Map(); // { `${tenantId}:${mes/periodo}` -> { data, timestamp } }
  const TTL = 5 * 60 * 1000; // 5 minutos

  return {
    // Obter do cache (null se expirado)
    get(tenantId, chave) {
      const k = `${tenantId}:${chave}`;
      const entry = cache.get(k);
      if (!entry) return null;
      if (Date.now() - entry.timestamp > TTL) {
        cache.delete(k);
        return null;
      }
      return entry.data;
    },

    // Armazenar no cache
    set(tenantId, chave, data) {
      const k = `${tenantId}:${chave}`;
      cache.set(k, { data, timestamp: Date.now() });
    },

    // Invalidar um período (quando venda/despesa é alterada)
    invalidar(tenantId, mes) {
      const k = `${tenantId}:${mes}`;
      cache.delete(k);
    },

    // Limpar tudo (dev/teste)
    limpar() {
      cache.clear();
    },
  };
})();

// --- Middleware: DRE com cache ---
function middlewareRelatorioComCache(req, res, next) {
  const tenantId = req.tenantId || 1;
  const mes = req.query.mes || new Date().toISOString().slice(0, 7);
  const cacheKey = `dre:${mes}`;

  const emCache = cacheRelatorioPorTenant.get(tenantId, cacheKey);
  if (emCache) {
    res.json({ ...emCache, _cached: true, _cacheAge: 'recente' });
    return;
  }

  next();
}

// --- Middleware: Curva ABC com cache ---
function middlewareCurvaAbcComCache(req, res, next) {
  const tenantId = req.tenantId || 1;
  const de = req.query.de || new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
  const ate = req.query.ate || new Date().toISOString().slice(0, 10);
  const cacheKey = `curva-abc:${de}:${ate}`;

  const emCache = cacheRelatorioPorTenant.get(tenantId, cacheKey);
  if (emCache) {
    res.json({ ...emCache, _cached: true, _cacheAge: 'recente' });
    return;
  }

  next();
}

// --- Rate Limit: Exports/Backups (protege CPU) ---
// 5 exports por hora por tenant
const limiteExport = rateLimit({
  keyGenerator: (req, _res) => {
    return `${req.tenantId || 1}-export`;
  },
  windowMs: 60 * 60 * 1000, // 1 hora
  max: 5,
  standardHeaders: true,
  legacyHeaders: false,
  message: { erro: 'Muitos exports neste período. Máx 5 por hora. Tente novamente depois.' },
  skip: (req) => {
    // Skip para users que não são admin (só admin pode exportar)
    return req.session?.papel !== 'admin';
  },
});

// --- Rate Limit: DRE/Curva ABC (calcs custosos) ---
// 30 requisições por minuto por tenant
const limiteCálculoCustoso = rateLimit({
  keyGenerator: (req, _res) => {
    return `${req.tenantId || 1}-calc`;
  },
  windowMs: 60 * 1000, // 1 minuto
  max: 30,
  standardHeaders: true,
  legacyHeaders: false,
  message: { erro: 'Muitas requisições. Aguarde um pouco antes de tentar novamente.' },
});

// --- Rate Limit: Upload (mais agressivo) ---
// 10 uploads por hora por tenant
const limiteUploadFrequencia = rateLimit({
  keyGenerator: (req, _res) => {
    return `${req.tenantId || 1}-upload`;
  },
  windowMs: 60 * 60 * 1000, // 1 hora
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { erro: 'Muitos uploads neste período. Máx 10 por hora.' },
});

// --- Função para invalidar cache quando dados mudam ---
function invalidarCachesPeriodo(tenantId, mes) {
  // Quando uma venda/despesa é criada/editada/deletada naquele mês
  cacheRelatorioPorTenant.invalidar(tenantId, `dre:${mes}`);
  // Invalidar também períodos que incluem esse mês
  const [ano, mesNum] = mes.split('-');
  const mesAnterior = mesNum === '01' ? `${parseInt(ano) - 1}-12` : `${ano}-${String(parseInt(mesNum) - 1).padStart(2, '0')}`;
  cacheRelatorioPorTenant.invalidar(tenantId, `dre:${mesAnterior}`);
}

module.exports = {
  limiteUploadPorTenant,
  limiteUploadFrequencia,
  limiteExport,
  limiteCálculoCustoso,
  cacheRelatorioPorTenant,
  middlewareRelatorioComCache,
  middlewareCurvaAbcComCache,
  invalidarCachesPeriodo,
};
