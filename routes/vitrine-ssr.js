// ============================================================
// VITRINE SSR — as PÁGINAS públicas da loja (HTML, não JSON)
//
// Estas rotas são montadas em server.js DEPOIS do express.static(public) e
// ANTES da catch-all /:slug. Não passam por exigirLogin (que só existe sob /api).
//
// Duas responsabilidades:
//   1. Entregar HTML com meta/OG/JSON-LD JÁ PRONTOS — o crawler do WhatsApp e o
//      do Google não executam JS. É por isso que a fase existe.
//   2. Aplicar o gate de plano. `vitrine_site` hoje é só do plano interno; quem
//      não tem cai em 404 (nunca 403 — 403 revelaria que a loja existe num
//      plano inferior).
// ============================================================
const path = require('path');
const { renderArquivo } = require('../lib/vitrine-render');
const {
  resolverLojaPublica, catalogoPublico, produtoPublico,
  urlAbsoluta, urlProduto, idDoProdutoNaUrl, urlFoto,
} = require('../lib/vitrine-publica');
const {
  blocoHead, blocoDados, gradeProdutos, blocosPixel, eventoPixel,
  schemaLoja, schemaProduto, schemaBreadcrumb, moeda,
} = require('../lib/vitrine-html');

// HTML da vitrine: `no-store` NÃO — o scraper do WhatsApp rebusca a página pra
// montar o preview, e proibir armazenamento atrapalha alguns intermediários.
// `max-age=0, must-revalidate` já garante conteúdo sempre fresco.
function cabecalhosHtml(res, { noindex = false } = {}) {
  res.set('Content-Type', 'text/html; charset=utf-8');
  res.set('Cache-Control', 'public, max-age=0, must-revalidate');
  if (noindex) res.set('X-Robots-Tag', 'noindex, nofollow');
}

// A descrição que vai no preview do WhatsApp e no resultado do Google.
// Cortada em ~155 chars: o que passa disso é truncado com reticências e some.
function resumo(texto, limite = 155) {
  const t = String(texto || '').replace(/\s+/g, ' ').trim();
  return t.length <= limite ? t : t.slice(0, limite - 1).trimEnd() + '…';
}

// ------------------------------------------------------------
// GET /:slug — home da loja
//
// RAMIFICA POR PLANO, e é isto que mantém o risco baixo: quem NÃO tem
// `vitrine_site` recebe a mesma página de sempre (só com o <head> preenchido, que
// é melhoria pura e não muda layout). O caminho de quem paga não foi reescrito.
// ------------------------------------------------------------
function ssrHome(req, res, next) {
  const loja = resolverLojaPublica(req.params.slug);
  // Sem loja: cai no next() e o server decide (404 padrão). Não inventa página.
  if (!loja) return next();

  const c = loja.config;
  const nomeLoja = c.loja_nome || loja.tenant.nome_loja || 'Loja';
  const catalogo = loja.temSite ? catalogoPublico(loja.tenant.id) : { produtos: [], categorias: [], colecoes: [] };

  // og:image em cascata. NUNCA deixar sem: sem og:image o WhatsApp escolhe uma
  // imagem qualquer da página, ou nenhuma — e link sem preview tem uma fração
  // do clique. A imagem dedicada (1200x630) vem primeiro; depois a logo; depois
  // a foto da primeira peça, que ao menos mostra que é uma loja de roupa.
  const ogImagem = loja.temSite
    ? urlAbsoluta(c.vitrine_og_imagem || c.loja_logo || catalogo.produtos[0]?.foto || '')
    : '';

  const url = urlAbsoluta('/' + loja.slug);
  const descricao = resumo(c.vitrine_frase || `Conheça as peças da ${nomeLoja}.`);

  const html = renderArquivo('index.html', {
    head: blocoHead({
      titulo: c.vitrine_frase ? `${nomeLoja} — ${c.vitrine_frase}` : nomeLoja,
      descricao,
      ogImagem,
      url,
      loja,
      // Loja sem site não é indexada: a página não tem conteúdo próprio pro
      // Google (o catálogo só existe depois que o JS roda).
      noindex: !loja.temSite,
      canonical: loja.temSite ? url : '',
      jsonLd: loja.temSite ? schemaLoja(loja) : null,
    }) + (loja.temSite ? '\n  ' + blocosPixel(c) : ''),
    grade: loja.temSite ? gradeProdutos(catalogo.produtos, { slug: loja.slug, temSite: true }) : '',
    dados: loja.temSite
      ? blocoDados({
          loja: { ...c, slug: loja.slug, tem_site: true, vitrineAtiva: true },
          produtos: catalogo.produtos,
          categorias: catalogo.categorias,
          colecoes: catalogo.colecoes,
        })
      : '',
  });

  cabecalhosHtml(res);
  res.send(html);
}

// ------------------------------------------------------------
// GET /:slug/p/:produto — a página da peça
//
// A razão de existir da fase inteira: hoje a peça vive num modal e não tem
// endereço. Sem endereço não dá pra mandar no zap, anunciar, nem indexar.
// ------------------------------------------------------------
function ssrProduto(req, res, next) {
  const loja = resolverLojaPublica(req.params.slug);
  if (!loja || !loja.temSite) return next();   // 404: não revela plano inferior

  const id = idDoProdutoNaUrl(req.params.produto);
  if (!id) return next();

  const p = produtoPublico(loja.tenant.id, id);
  // Peça inexistente, inativa ou SEM ESTOQUE some. Melhor 404 que uma página
  // que promete o que a loja não tem — o link vai circular no zap por meses.
  if (!p) return next();

  // Canônico: o slug do nome é decorativo, quem resolve é o id. Se a lojista
  // renomeou a peça, o link antigo continua valendo mas redireciona pro atual —
  // assim o Google indexa UM endereço só, não um por nome já usado.
  const canonicoPath = urlProduto(loja.slug, p);
  if (decodeURIComponent(req.path) !== canonicoPath) {
    return res.redirect(301, canonicoPath);
  }

  const c = loja.config;
  const nomeLoja = c.loja_nome || loja.tenant.nome_loja || 'Loja';
  const url = urlAbsoluta(canonicoPath);

  const html = renderArquivo('produto.html', {
    head: blocoHead({
      titulo: `${p.titulo} — ${nomeLoja}`,
      // A descrição do preview: a da peça se houver, senão preço + loja. Preço no
      // preview do zap é o que faz a cliente clicar.
      descricao: resumo(p.descricao || `${p.titulo} por R$ ${moeda(p.preco_venda)} na ${nomeLoja}.`),
      ogImagem: urlAbsoluta(p.foto),
      url,
      loja,
      canonical: url,
      jsonLd: schemaProduto(p, { slug: loja.slug, loja }),
    })
      + '\n  ' + blocosPixel(c)
      // ViewContent: é o evento que alimenta retargeting de peça ("você viu
      // este vestido"). Sem ele, anúncio de produto específico não tem público.
      + '\n  ' + eventoPixel('ViewContent', {
        content_ids: [String(p.id)],
        content_name: p.titulo,
        content_type: 'product',
        value: Number(p.preco_venda || 0),
        currency: 'BRL',
      }),
    breadcrumbJson: `<script type="application/ld+json">${require('../lib/vitrine-render').jsonSeguro(
      schemaBreadcrumb([
        { nome: nomeLoja, url: '/' + loja.slug },
        ...(p.categoria ? [{ nome: p.categoria, url: `/${loja.slug}?categoria=${encodeURIComponent(p.categoria)}` }] : []),
        { nome: p.titulo, url: canonicoPath },
      ]),
    )}</script>`,
    dados: blocoDados({
      loja: { ...c, slug: loja.slug, tem_site: true, vitrineAtiva: true },
      produto: p,
    }),
    slugLoja: loja.slug,
    nomeLoja,
    ...blocosDaPeca(p, loja),
  });

  cabecalhosHtml(res);
  res.send(html);
}

// Blocos de HTML da página de produto, montados aqui (e não no template) porque
// dependem do que a peça tem: cor só aparece se houver cor, medidas só se a
// lojista preencheu.
function blocosDaPeca(p, loja) {
  const { esc } = require('../lib/vitrine-render');
  const { COR_PADRAO } = require('../lib/vitrine-html');

  const cores = (p.cores || []).filter((c) => c && c !== COR_PADRAO);
  const galeria = [p.foto, ...(p.galeria || [])].filter(Boolean);

  // Galeria: a PRIMEIRA foto é o LCP da página. fetchpriority alto e sem lazy —
  // lazy acima da dobra piora justamente a métrica que se queria melhorar.
  const fotos = galeria.map((f, i) => (
    i === 0
      ? `<img id="fotoPrincipal" src="${esc(urlFoto(f))}" alt="${esc(p.titulo)}" class="pdp-foto" fetchpriority="high" decoding="async">`
      : `<img src="${esc(urlFoto(f))}" alt="" class="pdp-miniatura" loading="lazy" decoding="async" data-full="${esc(urlFoto(f))}">`
  )).join('\n');

  // Parcelamento: expectativa cultural forte no varejo brasileiro. Só mostra se
  // a parcela não ficar ridícula (mínimo R$ 20) — "12x de R$ 4,16" não vende.
  const maxParcelas = Number(loja.config.vitrine_parcelas_max || 0);
  const parcelas = maxParcelas > 1 ? melhorParcela(p.preco_venda, maxParcelas) : null;

  return {
    tituloPeca: p.titulo,
    precoPeca: `R$ ${moeda(p.preco_venda)}`,
    parcelamento: parcelas ? `ou ${parcelas.n}x de R$ ${moeda(parcelas.valor)}` : '',
    categoriaPeca: p.categoria || '',
    descricaoPeca: p.descricao || '',
    galeriaHtml: fotos,
    temCor: cores.length ? '' : 'style="display:none"',
    // Botões de cor e tamanho: BOTÃO, nunca dropdown. 70% das lojas de moda erram
    // isso, e o botão resolve dois problemas de uma vez — o seletor fica visível
    // e o esgotado aparece riscado sem precisar de clique.
    coresHtml: cores.map((cor, i) => (
      `<button class="btn-tamanho btn-cor${i === 0 ? ' selected' : ''}" data-cor="${esc(cor)}">${esc(cor)}</button>`
    )).join('\n'),
    tamanhosHtml: tamanhosDaCor(p, cores[0] || COR_PADRAO),
    medidasPeca: p.medidas || '',
    temMedidas: p.medidas ? '' : 'style="display:none"',
    modeloVeste: p.modelo_veste || '',
    temModelo: p.modelo_veste ? '' : 'style="display:none"',
    composicaoPeca: p.composicao || '',
    temComposicao: p.composicao ? '' : 'style="display:none"',
    // Política de troca na PRÓPRIA página: 60% das clientes procuram ali, e 44%
    // das lojas não exibem. Barato de preencher, caro de omitir.
    politicaTroca: loja.config.vitrine_politica_troca || '',
    temPolitica: loja.config.vitrine_politica_troca ? '' : 'style="display:none"',
    prazoEntrega: loja.config.vitrine_prazo_entrega || '',
    temPrazo: loja.config.vitrine_prazo_entrega ? '' : 'style="display:none"',
  };
}

function tamanhosDaCor(p, cor) {
  const { esc } = require('../lib/vitrine-render');
  const daCor = (p.grade || []).filter((g) => g.cor === cor);
  const lista = daCor.length ? daCor : (p.grade || []);
  return lista.map((g) => (
    `<button class="btn-tamanho" data-tamanho="${esc(g.tamanho)}" data-cor="${esc(g.cor)}">${esc(g.tamanho)}</button>`
  )).join('\n');
}

// Maior número de parcelas em que a parcela ainda faz sentido (>= R$ 20).
function melhorParcela(preco, max) {
  for (let n = Math.min(max, 12); n >= 2; n--) {
    const valor = Number(preco) / n;
    if (valor >= 20) return { n, valor };
  }
  return null;
}

// ------------------------------------------------------------
// GET /:slug/sitemap.xml — só para loja com site
// ------------------------------------------------------------
function sitemap(req, res, next) {
  const loja = resolverLojaPublica(req.params.slug);
  if (!loja || !loja.temSite) return next();

  const { produtos } = catalogoPublico(loja.tenant.id);
  const hoje = new Date().toISOString().slice(0, 10);
  const url = (loc, prio) =>
    `  <url><loc>${loc}</loc><lastmod>${hoje}</lastmod><priority>${prio}</priority></url>`;

  const linhas = [
    url(urlAbsoluta('/' + loja.slug), '1.0'),
    ...produtos.map((p) => url(urlAbsoluta(urlProduto(loja.slug, p)), '0.8')),
  ];

  res.set('Content-Type', 'application/xml; charset=utf-8');
  res.set('Cache-Control', 'public, max-age=3600');
  res.send(`<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${linhas.join('\n')}
</urlset>`);
}

// ------------------------------------------------------------
// GET /robots.txt — global
//
// O painel (/painel, /config, /admin) NUNCA deve ser indexado; as vitrines sim.
// ------------------------------------------------------------
function robots(req, res) {
  const base = String(process.env.ORIGIN || '').replace(/\/+$/, '');
  res.set('Content-Type', 'text/plain; charset=utf-8');
  res.set('Cache-Control', 'public, max-age=86400');
  res.send([
    'User-agent: *',
    'Disallow: /api/',
    'Disallow: /admin',
    'Disallow: /painel',
    'Disallow: /config.html',
    'Disallow: /login.html',
    'Disallow: /registro.html',
    'Allow: /',
    '',
    base ? `Sitemap: ${base}/sitemap.xml` : '',
  ].filter(Boolean).join('\n'));
}

module.exports = { ssrHome, ssrProduto, sitemap, robots, cabecalhosHtml, resumo };
