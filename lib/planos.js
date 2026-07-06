// ============================================================
// PLANOS — Fonte ÚNICA de verdade dos tiers do SaaS.
// Antes desta lib, os planos estavam definidos em 3 lugares divergentes
// (marketing, registro gravando 'basico', e const em assinatura.js). Tudo que
// precisa saber preço, limite ou feature de um plano DEVE importar daqui.
// ============================================================
const { db } = require('../db/database');

// Ordem de nível (para comparar "plano X tem pelo menos o nível Y").
const ORDEM = ['starter', 'growth', 'enterprise'];

// Definição dos tiers. Limite Infinity = sem teto.
const PLANOS = {
  starter: {
    id: 'starter',
    nome: 'Starter',
    preco_mensal: 99.90,
    preco_anual: 999.00,
    limites: { produtos: 1000, usuarios: 1 },
    features: { vale_credito: false, recorrentes: false, export: false, multiplas_lojas: false, api: false },
  },
  growth: {
    id: 'growth',
    nome: 'Growth',
    preco_mensal: 149.90,
    preco_anual: 1349.00,
    limites: { produtos: 5000, usuarios: 5 },
    features: { vale_credito: true, recorrentes: true, export: true, multiplas_lojas: false, api: false },
  },
  enterprise: {
    id: 'enterprise',
    nome: 'Enterprise',
    preco_mensal: 249.90,
    preco_anual: 2249.00,
    limites: { produtos: Infinity, usuarios: Infinity },
    features: { vale_credito: true, recorrentes: true, export: true, multiplas_lojas: true, api: true },
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

module.exports = {
  PLANOS, ORDEM, PLANO_PADRAO,
  normalizarPlano, definicaoPlano, planoDoTenant,
  limiteDe, temFeature, ordem, peloMenos,
};
