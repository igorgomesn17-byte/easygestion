// ============================================================
// VITRINE PÚBLICA — resolução de loja por slug (SEM sessão)
//
// A vitrine é a única parte do sistema que responde a quem NÃO está logado.
// Não há `req.tenantId`, não há `exigirFeature` (que depende de sessão): o gate
// é sempre slug → tenant → plano. Este módulo é a fonte ÚNICA dessa resolução.
//
// POR QUE CENTRALIZAR: a lógica já vivia dentro de routes/vitrine.js, e a
// CHAVES_PUBLICAS já estava DUPLICADA entre routes/config.js e routes/vitrine.js
// (duas listas que precisam andar juntas e ninguém garante que andam). Com o SSR,
// um terceiro lugar precisaria da mesma coisa. Três cópias de um gate de
// segurança é como um deles fica pra trás.
// ============================================================
const { db } = require('../db/database');
const { temFeature } = require('./planos');

// Chaves de config que a vitrine expõe publicamente. É uma ALLOWLIST: só sai
// daqui o que está nesta lista. Adicionar chave aqui = tornar pública.
// ⚠️ NUNCA inclua chave de custo/margem (markup_*, imposto_*, comissao_*):
// é rota sem autenticação, e isso entregaria a estrutura de preço da loja
// pra qualquer concorrente que abrir a vitrine.
const CHAVES_PUBLICAS = [
  'loja_nome', 'loja_endereco', 'loja_instagram', 'loja_telefone',
  'vitrine_frase', 'loja_whatsapp', 'loja_whatsapp_link', 'loja_instagram_url',
  'loja_maps', 'loja_logo', 'marca_cor',
];

// Chaves que só existem quando o plano tem `vitrine_site`. Ficam separadas
// porque uma loja sem a feature não deve nem expor que elas existem.
const CHAVES_PUBLICAS_SITE = [
  'vitrine_banner', 'vitrine_og_imagem', 'vitrine_politica_troca',
  'vitrine_tabela_medidas', 'vitrine_prazo_entrega', 'vitrine_parcelas_max',
  'pixel_meta_id', 'pixel_google_id',
];

const DEFAULTS_PUBLICOS = { marca_cor: '#1a6f5e' };

// ------------------------------------------------------------
// URLs de imagem
//
// O BUG QUE ISTO RESOLVE: routes/produtos.js grava o caminho da foto como
// 'img/produtos/x.jpg' — RELATIVO e SEM barra inicial. Em /minhaloja (uma URL de
// um segmento só) o navegador resolve pra /img/produtos/x.jpg por ACIDENTE do
// algoritmo de URL relativa. Em /minhaloja/p/vestido-142 ele resolveria pra
// /minhaloja/p/img/produtos/x.jpg → 404 em TODAS as fotos da página de produto.
//
// A correção é na SAÍDA, nunca no banco. Normalizar a coluna quebraria
// salvarFotosExtras (routes/produtos.js), que só reconhece foto mantida quando
// ela começa com 'img/produtos/' — a foto cairia fora do if, o caminho viraria
// null, e ela SUMIRIA da galeria sem erro nenhum.
// ------------------------------------------------------------
const PLACEHOLDER = '/img/placeholder.png';

function urlFoto(caminho) {
  if (!caminho) return PLACEHOLDER;
  const c = String(caminho).trim();
  if (!c) return PLACEHOLDER;
  if (/^https?:\/\//i.test(c)) return c;      // já absoluta (CDN futuro)
  if (c.startsWith('//')) return c;            // protocol-relative
  return c.startsWith('/') ? c : '/' + c;
}

// URL completa com host. Obrigatória para og:image, JSON-LD e sitemap: o
// crawler do WhatsApp/Facebook descarta og:image relativa — o preview sai SEM
// FOTO, que é exatamente o problema que o SSR veio resolver.
// ORIGIN já é obrigatória em produção (server.js faz process.exit se faltar).
function urlAbsoluta(caminho) {
  const base = String(process.env.ORIGIN || '').replace(/\/+$/, '');
  const rel = urlFoto(caminho);
  if (/^https?:\/\//i.test(rel)) return rel;
  return base ? base + rel : rel;
}

// URL canônica de uma peça: /:slug/p/:nome-slug-:id
// O ID no fim é o que resolve — o slug do nome é decorativo. Assim a lojista
// pode renomear a peça sem quebrar o link que já circula no WhatsApp há meses.
function urlProduto(slug, produto) {
  const { gerarSlug } = require('./helpers');
  const nomeSlug = gerarSlug(String(produto?.titulo || produto?.nome || ''));
  const id = produto?.id;
  return `/${slug}/p/${nomeSlug ? nomeSlug + '-' : ''}${id}`;
}

// Extrai o ID de '/p/vestido-amanda-142' → 142. É o ID que manda; se o slug
// divergir do nome atual, o handler responde 301 pra URL canônica.
function idDoProdutoNaUrl(segmento) {
  const m = String(segmento || '').match(/(\d+)$/);
  return m ? Number(m[1]) : null;
}

// ------------------------------------------------------------
// Resolução da loja
// ------------------------------------------------------------

function resolverTenantPorSlug(slug) {
  if (!slug || typeof slug !== 'string') return null;
  return db.prepare('SELECT id, nome_loja, email, slug, plano FROM tenants WHERE slug = ?')
    .get(slug.toLowerCase());
}

// Resolve tudo o que uma página pública precisa saber, numa chamada só.
//
// Devolve null quando a loja não deve ser servida (não existe, plano sem
// vitrine, ou vitrine desligada). O chamador responde 404 — e 404, não 403,
// é deliberado: 403 revelaria que a loja existe mas está num plano inferior.
//
// `temSite` distingue os dois níveis:
//   vitrine_publica → a loja online que todo plano tem (grid + modal + carrinho)
//   vitrine_site    → o SITE (página por peça, og:image, Google, pedido gravado)
function resolverLojaPublica(slug) {
  const tenant = resolverTenantPorSlug(slug);
  if (!tenant) return null;
  if (!temFeature(tenant.plano, 'vitrine_publica')) return null;

  const temSite = temFeature(tenant.plano, 'vitrine_site');

  // vitrine_ativa: SEMPRE filtrada pelo tenant do slug.
  // ⚠️ NUNCA fazer fallback global (SELECT sem tenant_id): com 2+ lojas isso
  // vazaria a config de OUTRA loja. Sem registro = tratado como inativa.
  const lerConfig = db.prepare('SELECT valor FROM config WHERE chave = ? AND tenant_id = ?');
  const ativa = lerConfig.get('vitrine_ativa', tenant.id);
  if (ativa?.valor !== '1') return null;

  const chaves = temSite ? CHAVES_PUBLICAS.concat(CHAVES_PUBLICAS_SITE) : CHAVES_PUBLICAS;
  const config = {};
  for (const chave of chaves) {
    const row = lerConfig.get(chave, tenant.id);
    config[chave] = row?.valor || DEFAULTS_PUBLICOS[chave] || '';
  }

  return { tenant, config, temSite, slug: tenant.slug };
}

module.exports = {
  CHAVES_PUBLICAS,
  CHAVES_PUBLICAS_SITE,
  DEFAULTS_PUBLICOS,
  PLACEHOLDER,
  urlFoto,
  urlAbsoluta,
  urlProduto,
  idDoProdutoNaUrl,
  resolverTenantPorSlug,
  resolverLojaPublica,
};
