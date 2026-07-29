// ============================================================
// PLANOS — Fonte ÚNICA de verdade dos tiers do SaaS.
// Antes desta lib, os planos estavam definidos em 3 lugares divergentes
// (marketing, registro gravando 'basico', e const em assinatura.js). Tudo que
// precisa saber preço, limite ou feature de um plano DEVE importar daqui.
// ============================================================
const { db } = require('../db/database');

// Ordem de nível (para comparar "plano X tem pelo menos o nível Y").
// 'interno' precisa estar AQUI, mesmo não sendo vendável: fora da lista,
// ordem('interno') = -1 e peloMenos('interno', qualquer coisa) = false.
const ORDEM = ['starter', 'growth', 'enterprise', 'interno'];

// Planos exibidos na vitrine pública. O Enterprise existe no código (limites,
// features, price IDs) mas está CONGELADO fora da venda no lançamento (decisão
// Igor 06/07/2026 — lançar com 2 planos). Para religar, some 'enterprise' aqui.
// 'interno' NUNCA entra aqui: é o plano do dono (uso próprio na loja), sem preço
// e sem Price ID no Stripe. É esta lista que o checkout usa como allowlist.
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
    // Régua nova (17/07/2026): o Starter faz a loja VENDER. Vitrine pública (canal de
    // aquisição), personalização (logo/cor — a vitrine precisa dela pra não sair crua)
    // e precificação (calcular preço de venda é operação básica) descem pro Starter.
    // DRE/relatórios/relacionamento/vale/recorrentes sobem pro Growth (lucrar e reter).
    features: { vale_credito: false, recorrentes: false, export: false, relatorios_avancados: false, vitrine_publica: true, vitrine_site: false, personalizacao: true, precificacao: true, maquininha: false, maquininha_integrada: false, base_importada: false, relacionamento: false, crm_avancado: false, atacado: false, multiplas_lojas: false, api: false },
  },
  growth: {
    id: 'growth',
    nome: 'Growth',
    preco_mensal: 119.90,
    preco_anual: 1199.00,
    limites: { produtos: 5000, usuarios: Infinity },
    // Growth = lucrar e reter. Relacionamento (RFM + régua de contato + clube de
    // fidelidade) é a BANDEIRA do plano: o sistema diz quem sumiu e escreve a mensagem.
    features: { vale_credito: true, recorrentes: true, export: true, relatorios_avancados: true, vitrine_publica: true, vitrine_site: false, personalizacao: true, precificacao: true, maquininha: true, maquininha_integrada: false, base_importada: false, relacionamento: true, crm_avancado: false, atacado: false, multiplas_lojas: false, api: false },
  },
  // ENTERPRISE — CONGELADO (fora de PLANOS_PUBLICOS desde 06/07/2026), e continua.
  // É onde moram, desde 28/07/2026, as features do CRM comercial e do atacado:
  // `crm_avancado` (kanban de prospecção, bot de SAC, placar por comercial) e
  // `atacado` (portal com cadastro no fechamento, Pix, reserva, excursões).
  //
  // As duas são SEPARADAS de propósito, e não uma flag só: o plano pode virar dois
  // — um de varejo (crm_avancado sem atacado) e um de atacadista (as duas) — com
  // preços diferentes. Juntá-las agora obrigaria a refatorar os gates naquele dia.
  // Pelo mesmo motivo não existe feature "pacote": o gate pergunta pela CAPACIDADE,
  // nunca pelo nome comercial do plano.
  enterprise: {
    id: 'enterprise',
    nome: 'Enterprise',
    preco_mensal: 249.90,
    preco_anual: 2249.00,
    limites: { produtos: Infinity, usuarios: Infinity },
    features: { vale_credito: true, recorrentes: true, export: true, relatorios_avancados: true, vitrine_publica: true, vitrine_site: true, personalizacao: true, precificacao: true, maquininha: true, maquininha_integrada: false, base_importada: false, relacionamento: true, crm_avancado: true, atacado: true, multiplas_lojas: true, api: true },
  },
  // INTERNO — o plano do dono. Uso próprio na loja, NÃO é vendável:
  // está fora de PLANOS_PUBLICOS (some da vitrine e do checkout) e não tem
  // Price ID no Stripe. Só o admin do backoffice atribui, via PATCH.
  // O Relacionamento (régua + RFM + clube) já virou produto: mora no growth
  // desde 17/07/2026. Ainda são EXCLUSIVOS do interno: a maquininha integrada
  // (falar com a maquininha de verdade) e a `vitrine_site` — pra liberar
  // qualquer um dos dois, ligar a flag no growth.
  interno: {
    id: 'interno',
    nome: 'Interno (uso próprio)',
    preco_mensal: 0,
    preco_anual: 0,
    limites: { produtos: Infinity, usuarios: Infinity },
    features: { vale_credito: true, recorrentes: true, export: true, relatorios_avancados: true, vitrine_publica: true, vitrine_site: true, personalizacao: true, precificacao: true, maquininha: true, maquininha_integrada: true, base_importada: true, relacionamento: true, crm_avancado: true, atacado: true, multiplas_lojas: true, api: true },
  },
};

// ------------------------------------------------------------
// `maquininha` x `maquininha_integrada` — NÃO são a mesma coisa. Confundi-las
// libera cobrança real no cartão pra quem nunca testou:
//
//   maquininha            = ver/editar os PERCENTUAIS de taxa (config.html,
//                           roteado por chave.startsWith('taxa_') em routes/config.js).
//                           É só tela de configuração. true no Growth.
//
//   base_importada        = a tela de REATIVACAO da base migrada de outro sistema
//                           (clientes.tipo='importado'). SO no interno porque hoje e'
//                           ferramenta da campanha da DS, nao produto: a lojista
//                           Growth ganharia uma aba que nao faz sentido pra loja dela.
//                           Pra virar produto, ligar base_importada:true no growth — a
//                           tela ja nasce generica ("base importada", nunca "Camacan").
//
//   vitrine_publica       = TER loja online por slug (easygestao.com/ds-store):
//                           grid de produtos, modal da peça, carrinho que fecha no
//                           WhatsApp. É o canal de aquisição. true em TODOS os planos
//                           desde 17/07/2026.
//
//   vitrine_site          = a vitrine ser um SITE: página por peça com URL própria,
//                           preview de link no WhatsApp (og:image), Google indexando
//                           (SSR + JSON-LD + sitemap), pedido gravado no sistema,
//                           pixel, filtro por tamanho/cor. true SÓ no interno enquanto
//                           a DS Store é o cliente-zero — mesmo caminho da
//                           base_importada. Pra virar produto, ligar no growth: a
//                           tela e as mensagens já nascem genéricas (nunca citam a
//                           loja da campanha), então não há texto pra reescrever.
//
//   maquininha_integrada  = FALAR com a maquininha de verdade (Mercado Pago Point:
//                           manda a cobrança, o cartão é passado, volta NSU/bandeira/taxa).
//                           Move dinheiro real. true SÓ no interno enquanto a DS Store
//                           é o cliente-zero.
// ------------------------------------------------------------

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

// TODOS os planos que o admin do backoffice pode atribuir manualmente — inclui os
// que não estão à venda (enterprise congelado, interno). É o que popula o dropdown
// do admin: planosPublicos() serve a vitrine e esconderia o 'interno' do próprio dono.
function planosAtribuiveis() {
  return ORDEM.map((k) => PLANOS[k]);
}

// O plano pode ser contratado no checkout? Só os públicos têm Price ID no Stripe.
function ehVendavel(plano) {
  return PLANOS_PUBLICOS.includes(normalizarPlano(plano));
}

module.exports = {
  PLANOS, PLANOS_PUBLICOS, ORDEM, PLANO_PADRAO,
  normalizarPlano, definicaoPlano, planoDoTenant, planosPublicos, planosAtribuiveis,
  limiteDe, temFeature, ordem, peloMenos, ehVendavel,
};
