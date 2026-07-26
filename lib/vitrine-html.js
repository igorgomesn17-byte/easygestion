// ============================================================
// VITRINE — blocos de HTML montados no SERVIDOR
//
// Aqui moram os pedaços que o SSR emite: <head> (meta/OG/JSON-LD), card de
// produto, e os dados JSON pra hidratação.
//
// ⚠️ O CARD TEM QUE SER IDÊNTICO ao que renderizarProdutos() gera no front.
// O servidor pinta a grade uma vez; a partir do primeiro filtro, quem repinta é
// o JS. Se o HTML divergir, a página "pula" no primeiro clique de busca — o
// bug clássico de hidratação. Qualquer mudança de layout de card muda os DOIS.
// ============================================================
const { esc, jsonSeguro, corHexSegura } = require('./vitrine-render');
const { urlFoto, urlAbsoluta, urlProduto } = require('./vitrine-publica');

const COR_PADRAO = 'Unica';   // espelha public/vitrine/js/vitrine.js e lib/sku.js

function moeda(v) {
  return Number(v || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

// ------------------------------------------------------------
// <head> — meta, Open Graph, tema da loja
//
// POR QUE ISSO É O CORAÇÃO DA FASE: as meta tags eram injetadas por JS
// (atualizarMetaTags). O crawler do WhatsApp NÃO executa JS — todo link de loja
// compartilhado saía sem preview. Isto aqui é o conserto.
//
// og:image PRECISA ser URL absoluta: o crawler descarta caminho relativo, e o
// preview sai sem foto (que é o problema que viemos resolver).
// ------------------------------------------------------------
function blocoHead({ titulo, descricao, ogImagem, url, loja, jsonLd, noindex, canonical }) {
  const cor = corHexSegura(loja.config.marca_cor);
  const nomeLoja = loja.config.loja_nome || loja.tenant.nome_loja || 'Loja';

  const partes = [
    `<title>${esc(titulo)}</title>`,
    `<meta name="description" content="${esc(descricao)}">`,
    noindex
      ? '<meta name="robots" content="noindex,nofollow">'
      : '<meta name="robots" content="index,follow,max-image-preview:large">',
    canonical ? `<link rel="canonical" href="${esc(canonical)}">` : '',
    // Open Graph — o que o WhatsApp/Instagram/Facebook leem pro preview
    `<meta property="og:type" content="${jsonLd && jsonLd['@type'] === 'Product' ? 'product' : 'website'}">`,
    `<meta property="og:site_name" content="${esc(nomeLoja)}">`,
    `<meta property="og:locale" content="pt_BR">`,
    `<meta property="og:title" content="${esc(titulo)}">`,
    `<meta property="og:description" content="${esc(descricao)}">`,
    url ? `<meta property="og:url" content="${esc(url)}">` : '',
    ogImagem ? `<meta property="og:image" content="${esc(ogImagem)}">` : '',
    // width/height ajudam o WhatsApp a decidir entre preview grande e miniatura
    ogImagem ? '<meta property="og:image:width" content="1200">' : '',
    ogImagem ? '<meta property="og:image:height" content="630">' : '',
    `<meta name="twitter:card" content="summary_large_image">`,
    `<meta name="twitter:title" content="${esc(titulo)}">`,
    `<meta name="twitter:description" content="${esc(descricao)}">`,
    ogImagem ? `<meta name="twitter:image" content="${esc(ogImagem)}">` : '',
    `<meta name="theme-color" content="${cor}">`,
    // Tema da loja: sai pronto do servidor, sem o flash de cor errada que o
    // caminho por JS produzia. corHexSegura é obrigatória — isto entra em <style>,
    // onde escape de HTML não protege de `red;}body{display:none`.
    `<style id="temaLoja">:root{--marca:${cor} !important;--marca-escura:${escurecer(cor, 30)} !important;--marca-clara:${clarear(cor, 30)} !important;}</style>`,
    jsonLd ? `<script type="application/ld+json">${jsonSeguro(jsonLd)}</script>` : '',
  ];
  return partes.filter(Boolean).join('\n  ');
}

// Variações da cor da marca. Portadas do front (escurecerCor/clareaarCor em
// vitrine.js), com a correção do hex de 3 dígitos: `#f00` fazia parseInt ler
// 0x0f00 e devolvia uma cor completamente diferente.
function expandirHex(cor) {
  const h = String(cor).replace('#', '');
  return h.length === 3 ? h.split('').map((c) => c + c).join('') : h.slice(0, 6);
}
function ajustar(cor, delta) {
  const num = parseInt(expandirHex(cor), 16);
  if (Number.isNaN(num)) return cor;
  const lim = (v) => Math.max(0, Math.min(255, v));
  const r = lim((num >> 16) + delta);
  const g = lim(((num >> 8) & 0xff) + delta);
  const b = lim((num & 0xff) + delta);
  return '#' + ((1 << 24) + (r << 16) + (g << 8) + b).toString(16).slice(1);
}
const escurecer = (cor, pct) => ajustar(cor, -Math.round(2.55 * pct));
const clarear = (cor, pct) => ajustar(cor, Math.round(2.55 * pct));

// ------------------------------------------------------------
// Card de produto
//
// Com site: <a href> pra página da peça (link real que o Google segue e que a
// lojista manda no zap). Sem site: <div> que abre o modal, como sempre foi.
// ------------------------------------------------------------
function cardProduto(p, { slug, temSite, primeiro = false } = {}) {
  const nome = p.titulo || p.nome || '';
  const cores = (p.cores || []).filter((c) => c && c !== COR_PADRAO);
  const legenda = cores.length
    ? cores.slice(0, 3).join(' • ') + (cores.length > 3 ? ' +' + (cores.length - 3) : '')
    : `${(p.tamanhos || []).length} tamanho(s)`;

  // A PRIMEIRA foto é o elemento LCP da página: fetchpriority alto e SEM lazy.
  // Lazy-load acima da dobra é o erro clássico — piora justamente a métrica que
  // se queria melhorar. Da segunda em diante, lazy.
  const attrsImg = primeiro
    ? 'fetchpriority="high" decoding="async"'
    : 'loading="lazy" decoding="async"';

  const interno = `
      <img src="${esc(urlFoto(p.foto))}" alt="${esc(nome)}" class="card-produto-foto" ${attrsImg}>
      <div class="card-produto-info">
        <h3 class="card-produto-nome">${esc(nome)}</h3>
        <p class="card-produto-categoria">${esc(p.categoria || '')}</p>
        <p class="card-produto-preco">R$ ${moeda(p.preco_venda)}</p>
        <p class="card-produto-tamanhos">${esc(legenda)}</p>
      </div>`;

  return temSite
    ? `<a class="card-produto" href="${esc(urlProduto(slug, p))}" data-id="${p.id}">${interno}</a>`
    : `<div class="card-produto" data-id="${p.id}">${interno}</div>`;
}

function gradeProdutos(produtos, opts) {
  if (!produtos.length) {
    return '<p class="vitrine-vazio">Nenhuma peça disponível no momento.</p>';
  }
  return produtos.map((p, i) => cardProduto(p, { ...opts, primeiro: i === 0 })).join('\n');
}

// ------------------------------------------------------------
// JSON-LD
// ------------------------------------------------------------

// Preço tem que ser número em string: "189.90", nunca "R$ 189,90".
// É o erro nº1 de dado estruturado de e-commerce — o Google descarta o item.
function precoSchema(v) {
  return Number(v || 0).toFixed(2);
}

function schemaProduto(p, { slug, loja }) {
  const emEstoque = (p.grade || []).some((g) => g.quantidade > 0);
  return {
    '@context': 'https://schema.org',
    '@type': 'Product',
    name: p.titulo || p.nome,
    description: p.descricao || `${p.titulo || p.nome} — ${loja.config.loja_nome || ''}`.trim(),
    image: [urlAbsoluta(p.foto), ...(p.galeria || []).map(urlAbsoluta)].filter(Boolean).slice(0, 5),
    sku: String(p.id),
    ...(p.categoria ? { category: p.categoria } : {}),
    brand: { '@type': 'Brand', name: loja.config.loja_nome || loja.tenant.nome_loja || '' },
    offers: {
      '@type': 'Offer',
      price: precoSchema(p.preco_venda),
      priceCurrency: 'BRL',
      availability: emEstoque ? 'https://schema.org/InStock' : 'https://schema.org/OutOfStock',
      url: urlAbsoluta(urlProduto(slug, p)),
      seller: { '@type': 'Organization', name: loja.config.loja_nome || '' },
    },
  };
}

// ClothingStore (subtipo de Store): é o que conecta a loja ao Google Business
// Profile e ao pacote local — o canal que realmente rende pra loja de cidade
// pequena, mais que disputar "vestido midi" com Shein e Renner.
function schemaLoja(loja) {
  const c = loja.config;
  const nome = c.loja_nome || loja.tenant.nome_loja || 'Loja';
  const out = {
    '@context': 'https://schema.org',
    '@type': 'ClothingStore',
    name: nome,
    url: urlAbsoluta('/' + loja.slug),
    ...(c.loja_logo ? { logo: urlAbsoluta(c.loja_logo), image: urlAbsoluta(c.loja_logo) } : {}),
    ...(c.vitrine_frase ? { description: c.vitrine_frase } : {}),
    ...(c.loja_whatsapp ? { telephone: String(c.loja_whatsapp).replace(/\D/g, '') } : {}),
    ...(c.loja_endereco ? { address: { '@type': 'PostalAddress', streetAddress: c.loja_endereco } } : {}),
  };
  const redes = [c.loja_instagram_url, c.loja_maps].filter(Boolean);
  if (redes.length) out.sameAs = redes;
  return out;
}

function schemaBreadcrumb(itens) {
  return {
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: itens.map((it, i) => ({
      '@type': 'ListItem',
      position: i + 1,
      name: it.nome,
      item: urlAbsoluta(it.url),
    })),
  };
}

// ------------------------------------------------------------
// Hidratação — os dados que o front recebe já prontos
//
// Mata os DOIS fetches em cascata do boot (HTML -> JS -> fetch loja -> fetch
// produtos -> render). Vira: HTML já com tudo.
// ------------------------------------------------------------
function blocoDados(payload) {
  return `<script>window.__VITRINE__=${jsonSeguro(payload)};</script>`;
}

module.exports = {
  COR_PADRAO,
  moeda,
  blocoHead,
  cardProduto,
  gradeProdutos,
  schemaProduto,
  schemaLoja,
  schemaBreadcrumb,
  blocoDados,
  escurecer,
  clarear,
  precoSchema,
};
