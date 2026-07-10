// ============================================================
// PLANOS — Fonte ÚNICA de verdade dos tiers do SaaS.
// Antes desta lib, os planos estavam definidos em 3 lugares divergentes
// (marketing, registro gravando 'basico', e const em assinatura.js). Tudo que
// precisa saber preço, limite ou feature de um plano DEVE importar daqui.
// ============================================================
const { db } = require('../db/database');

// Ordem de nível (para comparar "plano X tem pelo menos o nível Y").
const ORDEM = ['starter', 'growth', 'enterprise'];

// Planos exibidos na vitrine pública. O Enterprise existe no código (limites,
// features, price IDs) mas está CONGELADO fora da venda no lançamento (decisão
// Igor 06/07/2026 — lançar com 2 planos). Para religar, some 'enterprise' aqui.
const PLANOS_PUBLICOS = ['starter', 'growth'];

// Definição dos tiers. Limite Infinity = sem teto.
const PLANOS = {
  starter: {
    id: 'starter',
    nome: 'Starter',
    preco_mensal: 69.90,
    preco_anual: 699.00,
    // usuarios: Infinity nos DOIS planos. O custo marginal de um assento a mais e' zero
    // e todo concorrente cobra por usuario — nao cobrar e' o diferencial de preco.
    // exigirDentroDoLimite('usuarios') continua aplicado em routes/usuarios.js: com
    // Infinity ele passa direto (seguranca.js), mantendo o mecanismo vivo.
    limites: { produtos: 1000, usuarios: Infinity },
    features: { vale_credito: false, recorrentes: false, export: false, relatorios_avancados: false, vitrine_publica: false, personalizacao: false, precificacao: false, maquininha: false, multiplas_lojas: false, api: false },
  },
  growth: {
    id: 'growth',
    nome: 'Growth',
    preco_mensal: 119.90,
    preco_anual: 1199.00,
    limites: { produtos: 5000, usuarios: Infinity },
    features: { vale_credito: true, recorrentes: true, export: true, relatorios_avancados: true, vitrine_publica: true, personalizacao: true, precificacao: true, maquininha: true, multiplas_lojas: false, api: false },
  },
  enterprise: {
    id: 'enterprise',
    nome: 'Enterprise',
    preco_mensal: 249.90,
    preco_anual: 2249.00,
    limites: { produtos: Infinity, usuarios: Infinity },
    features: { vale_credito: true, recorrentes: true, export: true, relatorios_avancados: true, vitrine_publica: true, personalizacao: true, precificacao: true, maquininha: true, multiplas_lojas: true, api: true },
  },
};

const PLANO_PADRAO = 'starter';

// Normaliza um nome de plano vindo do banco para uma chave válida.
// Cobre valores legados ('basico' → starter, 'pro' → growth) para não quebrar
// tenants antigos antes da migração rodar.
function normalizarPlano(plano) {
  const p = String(plano || '').toLowerCase().trim();
  if (PLANOS[p]) return p;
  const legado = { basico: 'starter', gratis: 'starter', pro: 'growth' };
  return legado[p] || PLANO_PADRAO;
}

// Retorna a definição completa de um plano (sempre válida — cai no padrão).
function definicaoPlano(plano) {
  return PLANOS[normalizarPlano(plano)];
}

// Lê o plano ATUAL de um tenant a partir do banco. Fonte: tenants.plano.
function planoDoTenant(tenantId) {
  const t = db.prepare('SELECT plano FROM tenants WHERE id = ?').get(tenantId);
  return normalizarPlano(t?.plano);
}

// Limite de um recurso ('produtos' | 'usuarios') para um plano. Infinity = sem teto.
function limiteDe(plano, recurso) {
  const def = definicaoPlano(plano);
  const v = def.limites[recurso];
  return v === undefined ? Infinity : v;
}

// O plano tem determinada feature? (vale_credito, recorrentes, export, ...)
function temFeature(plano, feature) {
  return !!definicaoPlano(plano).features[feature];
}

// Índice de nível (para comparar). starter=0, growth=1, enterprise=2.
function ordem(plano) {
  return ORDEM.indexOf(normalizarPlano(plano));
}

// plano tem PELO MENOS o nível de outro? (ex.: peloMenos('growth','growth') true)
function peloMenos(plano, nivelMinimo) {
  return ordem(plano) >= ordem(nivelMinimo);
}

// Lista de definições dos planos vendáveis na vitrine (na ordem de nível).
function planosPublicos() {
  return PLANOS_PUBLICOS.map((k) => PLANOS[k]);
}

module.exports = {
  PLANOS, PLANOS_PUBLICOS, ORDEM, PLANO_PADRAO,
  normalizarPlano, definicaoPlano, planoDoTenant, planosPublicos,
  limiteDe, temFeature, ordem, peloMenos,
};
