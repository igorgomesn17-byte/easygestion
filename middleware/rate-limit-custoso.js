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
    // 'anon' e' um balde proprio: com `|| 1`, uma requisicao sem tenant consumia a
    // cota de upload DA LOJA 1 (e podia esgota-la).
    const tenantId = req.tenantId || 'anon';
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

    // Calcular tamanho total de arquivos na requisição.
    // Conta a CAPA (`foto`) e a galeria (`fotos`) — a capa estava de fora, então o
    // maior upload do cadastro não era contabilizado. Requisição sem foto soma 0 e
    // passa direto (o que é o caso da maioria: cadastrar peça não é upload).
    const bytesDe = (f) => (typeof f === 'string' && f.startsWith('data:'))
      ? Buffer.byteLength(f, 'utf8') * 0.75   // base64 é ~4/3 do binário
      : 0;

    let totalBytes = 0;
    if (req.body) {
      totalBytes += bytesDe(req.body.foto);
      if (Array.isArray(req.body.fotos)) {
        for (const f of req.body.fotos) totalBytes += bytesDe(f);
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

    // Invalidar todo cache do tenant (DRE, Curva ABC, etc)
    invalidarTudo(tenantId) {
      for (const k of [...cache.keys()]) {
        if (k.startsWith(`${tenantId}:`)) cache.delete(k);
      }
    },

    // Limpar tudo (dev/teste)
    limpar() {
      cache.clear();
    },
  };
})();

// --- Middleware: DRE com cache ---
function middlewareRelatorioComCache(req, res, next) {
  // Sem tenant NAO ha cache a consultar. O `|| 1` que estava aqui fazia uma
  // requisicao sem tenant ler o cache DA LOJA 1 — e responder com o DRE dela.
  if (!req.tenantId) return next();
  const tenantId = req.tenantId;
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
  if (!req.tenantId) return next();   // ver a nota no middlewareRelatorioComCache
  const tenantId = req.tenantId;
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
    return `${req.tenantId || 'anon'}-export`;
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
    return `${req.tenantId || 'anon'}-calc`;
  },
  windowMs: 60 * 1000, // 1 minuto
  max: 30,
  standardHeaders: true,
  legacyHeaders: false,
  message: { erro: 'Muitas requisições. Aguarde um pouco antes de tentar novamente.' },
});

// --- Rate Limit: Upload (mais agressivo) ---
// ⚠️ O limitador de FREQUÊNCIA de upload (era 10/hora) foi REMOVIDO em 14/07/2026.
//
// Ele existia pra proteger a CPU de um pico de processamento de imagem. Mas:
//   - o processamento é trivial (decodifica base64, grava o arquivo);
//   - quem protege o disco de verdade é o limiteUploadPorTenant (100MB/dia), que
//     continua de pé — e um teto de BYTES já cobre o cenário de abuso.
//
// O de frequência só duplicava a defesa, e o preço era alto: montado no POST/PUT de
// produtos, ele contava TODA requisição como upload (não tinha `skip`), então
// cadastrar 10 peças sem foto nenhuma travava a lojista com "Muitos uploads neste
// período" no meio do cadastro do catálogo. Punia exatamente o que o sistema mais
// quer que ela faça. Aconteceu de verdade.
//
// Se um dia o processamento de imagem ficar caro (resize, thumbnail, conversão),
// reavaliar — mas aí com um `skip` que só conte requisição COM foto nova (base64 no
// corpo), nunca cru. Contar toda requisição foi o erro original.

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
  limiteExport,
  limiteCálculoCustoso,
  cacheRelatorioPorTenant,
  middlewareRelatorioComCache,
  middlewareCurvaAbcComCache,
  invalidarCachesPeriodo,
};
