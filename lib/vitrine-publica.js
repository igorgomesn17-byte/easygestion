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

// ------------------------------------------------------------
// Catálogo público
//
// Uma função só, usada pela API JSON *e* pelo SSR — se fossem duas, a página
// mostraria um catálogo e o JSON outro, e ninguém descobriria até a cliente
// reclamar que a peça do link não existe.
//
// SEM N+1: a versão anterior rodava 2 queries POR PRODUTO dentro de um .map()
// (grade + galeria). Com 300 peças isso são 601 queries por request — e a
// vitrine é a página que vai receber tráfego de anúncio. Aqui são 3 no total,
// agrupando em memória. Mesmo padrão que routes/produtos.js já usa.
// ------------------------------------------------------------
function catalogoPublico(tenantId) {
  // p.cor está DEPRECADA (a cor mora na variação) — não selecionada.
  const produtos = db.prepare(`
    SELECT p.id, p.nome, p.categoria, p.preco_venda, p.foto, p.colecao,
           p.descricao, p.medidas, p.modelo_veste, p.composicao, p.destaque
    FROM produtos p
    WHERE p.ativo = 1 AND p.tenant_id = ?
    ORDER BY p.nome ASC
  `).all(tenantId);

  if (!produtos.length) return { produtos: [], categorias: [], colecoes: [] };

  // A grade só com o que TEM estoque: a cliente não pode escolher o que não existe.
  // codigo_barras NÃO sai daqui — é rota pública e o SKU é informação interna.
  const grades = db.prepare(`
    SELECT produto_id, cor, tamanho, quantidade
    FROM variacoes
    WHERE tenant_id = ? AND quantidade > 0
    ORDER BY cor, CAST(tamanho AS TEXT)
  `).all(tenantId);

  const galerias = db.prepare(`
    SELECT produto_id, caminho FROM produto_fotos WHERE tenant_id = ? ORDER BY id
  `).all(tenantId);

  const porProduto = (linhas) => linhas.reduce((mapa, l) => {
    (mapa[l.produto_id] = mapa[l.produto_id] || []).push(l);
    return mapa;
  }, {});
  const gradePor = porProduto(grades);
  const galeriaPor = porProduto(galerias);

  const completos = produtos.map((p) => {
    const grade = gradePor[p.id] || [];
    const cores = [...new Set(grade.map((g) => g.cor))];
    return {
      id: p.id,
      titulo: p.nome,
      nome: p.nome,
      categoria: p.categoria,
      // uma peça pode existir em várias cores: a vitrine mostra todas e a cliente
      // escolhe. `cor` (singular) segue preenchida quando só há uma, pro layout antigo.
      cores,
      cor: cores.length === 1 ? cores[0] : null,
      preco_venda: p.preco_venda,
      foto: urlFoto(p.foto),
      colecao: p.colecao,
      descricao: p.descricao || '',
      medidas: p.medidas || '',
      modelo_veste: p.modelo_veste || '',
      composicao: p.composicao || '',
      destaque: p.destaque || 0,
      grade: grade.map((g) => ({ cor: g.cor, tamanho: g.tamanho, quantidade: g.quantidade })),
      tamanhos: [...new Set(grade.map((g) => g.tamanho))].map((t) => ({ tamanho: t })),
      galeria: (galeriaPor[p.id] || []).map((g) => urlFoto(g.caminho)),
    };
  });

  // Só entra quem tem pelo menos uma peça em estoque.
  const comEstoque = completos.filter((p) => p.grade.length > 0);

  return {
    produtos: comEstoque,
    categorias: [...new Set(comEstoque.filter((p) => p.categoria).map((p) => p.categoria))].sort(),
    colecoes: [...new Set(comEstoque.filter((p) => p.colecao).map((p) => p.colecao))].sort(),
  };
}

// Uma peça só. Reusa o catálogo de propósito: garante que a PDP mostre
// exatamente o que a grade mostra (mesma regra de estoque, mesmas cores).
// Peça sem estoque devolve null → 404, e não uma página que promete o que não há.
function produtoPublico(tenantId, produtoId) {
  const id = Number(produtoId);
  if (!Number.isInteger(id) || id <= 0) return null;
  return catalogoPublico(tenantId).produtos.find((p) => p.id === id) || null;
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
  catalogoPublico,
  produtoPublico,
};
