// ============================================================
// API PÚBLICA da vitrine: catálogo de produtos por slug
// ============================================================
const express = require('express');
const router = express.Router();
const { db, getConfig } = require('../db/database');
const { temFeature } = require('../lib/planos');
// Fonte ÚNICA da resolução pública (gate slug→tenant→plano, allowlist de config,
// normalização de URL de foto). Antes disso a CHAVES_PUBLICAS vivia duplicada aqui
// e em routes/config.js, e o gate era local — com o SSR seriam três cópias.
const { resolverLojaPublica, urlFoto } = require('../lib/vitrine-publica');

// Resolver tenant pelo slug (público, sem autenticação)
function resolverTenantPorSlug(slug) {
  if (!slug || typeof slug !== 'string') return null;
  return db.prepare('SELECT id, nome_loja, email, slug, plano FROM tenants WHERE slug = ?').get(slug.toLowerCase());
}

// Vitrine pública é liberada a partir do Starter (feature 'vitrine_publica' — desde
// 17/07/2026 vitrine desceu pro Starter como canal de aquisição). Como esta é uma API
// pública por slug (sem sessão do dono), o gate é slug→tenant→plano, não via middleware
// de sessão. Quem NÃO tem a feature (ex.: um tenant legado sem vitrine) cai aqui e é
// tratado como loja inexistente (404 — não revela que a loja existe num plano inferior).
function vitrineLiberadaParaPlano(tenant) {
  return !!tenant && temFeature(tenant.plano, 'vitrine_publica');
}

// GET /api/vitrine/:slug — dados públicos da loja (nome, logo, cor, whatsapp, etc)
router.get('/:slug', (req, res) => {
  try {
    const { slug } = req.params;
    const tenant = resolverTenantPorSlug(slug);

    if (!tenant || !vitrineLiberadaParaPlano(tenant)) {
      return res.status(404).json({ erro: 'Loja não encontrada' });
    }

    // Buscar vitrine_ativa: SEMPRE filtrada pelo tenant do slug.
    // ⚠️ NUNCA fazer fallback global (SELECT sem tenant_id): com 2+ lojas, isso
    // vazaria a config de OUTRA loja. Sem registro = tratado como inativa.
    const vitrineAtivaConfig = db.prepare('SELECT valor FROM config WHERE chave = ? AND tenant_id = ?')
      .get('vitrine_ativa', tenant.id);
    const vitrineAtiva = vitrineAtivaConfig?.valor === '1';

    if (!vitrineAtiva) {
      return res.status(200).json({
        vitrineAtiva: false,
        mensagem: 'Esta loja ainda não tem a vitrine disponível'
      });
    }

    // Dados públicos vêm da allowlist única em lib/vitrine-publica.js (antes esta
    // lista vivia duplicada aqui e em routes/config.js). resolverLojaPublica já
    // refez o gate e o vitrine_ativa acima — aqui não pode dar null, mas se der,
    // trata como loja inexistente em vez de estourar.
    const loja = resolverLojaPublica(slug);
    if (!loja) return res.status(404).json({ erro: 'Loja não encontrada' });

    const dados = {
      slug: tenant.slug,
      vitrineAtiva: true,
      email: tenant.email,
      // O front usa isto pra decidir se o card vira link pra pagina de produto
      // ou continua abrindo o modal (loja online x site completo).
      tem_site: loja.temSite,
      ...loja.config,
      // Logo normalizada: sem a barra inicial ela quebraria em /:slug/p/:peca.
      loja_logo: loja.config.loja_logo ? urlFoto(loja.config.loja_logo) : '',
    };

    res.json(dados);
  } catch (err) {
    console.error('[VITRINE] Erro em GET /:slug:', err);
    res.status(500).json({ erro: 'Erro interno do servidor' });
  }
});

// GET /api/vitrine/:slug/produtos — produtos da loja (público, filtrado por tenant_id)
router.get('/:slug/produtos', (req, res) => {
  try {
    const { slug } = req.params;
    const tenant = resolverTenantPorSlug(slug);

    if (!tenant || !vitrineLiberadaParaPlano(tenant)) {
      return res.status(404).json({ erro: 'Loja não encontrada' });
    }

    // Buscar vitrine_ativa: SEMPRE filtrada pelo tenant do slug (sem fallback global).
    const vitrineAtivaConfig = db.prepare('SELECT valor FROM config WHERE chave = ? AND tenant_id = ?')
      .get('vitrine_ativa', tenant.id);
    const vitrineAtiva = vitrineAtivaConfig?.valor === '1';

    if (!vitrineAtiva) {
      return res.status(403).json({ erro: 'Vitrine não está ativa' });
    }

    // Buscar produtos ativos com estoque (mesmo padrão do GET /api/produtos/vitrine,
    // mas FILTRADO por tenant_id do slug + sem expor código/SKU)
    // p.cor esta DEPRECADA (a cor mora na variacao) — nao selecionada.
    // descricao/medidas/modelo_veste/composicao alimentam a pagina de produto.
    // `descricao` ja existia no schema desde sempre e NUNCA era lida aqui — a peca
    // aparecia na vitrine so com nome e preco. Os outros 3 vieram na migration 044.
    const produtos = db.prepare(`
      SELECT
        p.id, p.nome, p.categoria, p.preco_venda, p.foto, p.colecao,
        p.descricao, p.medidas, p.modelo_veste, p.composicao, p.destaque
      FROM produtos p
      WHERE p.ativo = 1 AND p.tenant_id = ?
      ORDER BY p.nome ASC
    `).all(tenant.id);

    // Para cada produto, buscar a grade (cor x tamanho) + galeria
    const produtosCompletos = produtos.map(p => {
      // A grade so com o que tem em estoque: a cliente nao pode escolher o que nao existe.
      // codigo_barras NAO sai daqui — e' rota publica, e o SKU e' informacao interna.
      const grade = db.prepare(`
        SELECT cor, tamanho, quantidade
        FROM variacoes
        WHERE produto_id = ? AND tenant_id = ? AND quantidade > 0
        ORDER BY cor, CAST(tamanho AS TEXT)
      `).all(p.id, tenant.id);

      // Galeria de fotos. Rota PUBLICA (sem login): o filtro de tenant e' obrigatorio.
      const galeria = db.prepare(`
        SELECT caminho FROM produto_fotos WHERE produto_id = ? AND tenant_id = ? ORDER BY id
      `).all(p.id, tenant.id);

      const cores = [...new Set(grade.map(g => g.cor))];

      return {
        id: p.id,
        titulo: p.nome,
        nome: p.nome,
        categoria: p.categoria,
        // uma peca pode existir em varias cores: a vitrine mostra todas e a cliente
        // escolhe. `cor` (singular) segue preenchida quando so ha uma, pro layout antigo.
        cores,
        cor: cores.length === 1 ? cores[0] : null,
        preco_venda: p.preco_venda,
        // urlFoto normaliza 'img/produtos/x' -> '/img/produtos/x'. Sem a barra, o
        // caminho e' relativo a URL ATUAL: funciona em /minhaloja por acidente e
        // quebra em /minhaloja/p/vestido-142 (a pagina de produto). Corrigir aqui
        // conserta o front atual sem tocar em vitrine.js.
        foto: urlFoto(p.foto),
        colecao: p.colecao,
        descricao: p.descricao || '',
        medidas: p.medidas || '',
        modelo_veste: p.modelo_veste || '',
        composicao: p.composicao || '',
        destaque: p.destaque || 0,
        grade: grade.map(g => ({ cor: g.cor, tamanho: g.tamanho, quantidade: g.quantidade })),
        tamanhos: [...new Set(grade.map(g => g.tamanho))].map(t => ({ tamanho: t })),
        galeria: galeria.map(g => urlFoto(g.caminho))
      };
    });

    // Filtrar apenas produtos com pelo menos uma peça em estoque
    const produtosComEstoque = produtosCompletos.filter(p => p.grade.length > 0);

    // Categorias e coleções
    const categorias = [...new Set(produtosComEstoque.filter(p => p.categoria).map(p => p.categoria))];
    const colecoes = [...new Set(produtosComEstoque.filter(p => p.colecao).map(p => p.colecao))];

    res.json({
      produtos: produtosComEstoque,
      categorias: categorias.sort(),
      colecoes: colecoes.sort()
    });
  } catch (err) {
    console.error('[VITRINE] Erro em GET /:slug/produtos:', err);
    res.status(500).json({ erro: 'Erro ao carregar produtos' });
  }
});

module.exports = router;
