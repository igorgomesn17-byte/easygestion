// ============================================================
// API PÚBLICA da vitrine: catálogo de produtos por slug
// ============================================================
const express = require('express');
const router = express.Router();
const { db, getConfig } = require('../db/database');
const { temFeature } = require('../lib/planos');

// Resolver tenant pelo slug (público, sem autenticação)
function resolverTenantPorSlug(slug) {
  if (!slug || typeof slug !== 'string') return null;
  return db.prepare('SELECT id, nome_loja, email, slug, plano FROM tenants WHERE slug = ?').get(slug.toLowerCase());
}

// Vitrine pública é exclusiva do Growth+ (feature 'vitrine_publica'). Como esta é
// uma API pública por slug (sem sessão do dono), o gate é slug→tenant→plano, não
// via middleware de sessão. Starter cai aqui e é tratado como loja inexistente
// (404 — não revela que a loja existe mas está num plano inferior).
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

    // Buscar dados públicos da loja (mesmo padrão de /api/loja-publica, mas filtrado)
    // Defaults por chave para quando o tenant ainda não preencheu (nunca herda de outro tenant).
    const CHAVES_PUBLICAS = [
      'loja_nome', 'loja_endereco', 'loja_instagram', 'loja_telefone',
      'vitrine_frase', 'loja_whatsapp', 'loja_whatsapp_link', 'loja_instagram_url',
      'loja_maps', 'loja_logo', 'marca_cor'
    ];
    const DEFAULTS_PUBLICOS = { marca_cor: '#1a6f5e' };

    const dados = {
      slug: tenant.slug,
      vitrineAtiva: true,
      email: tenant.email
    };

    for (const chave of CHAVES_PUBLICAS) {
      // SEMPRE filtrado por tenant_id; sem registro usa default local, nunca de outro tenant.
      const config = db.prepare('SELECT valor FROM config WHERE chave = ? AND tenant_id = ?')
        .get(chave, tenant.id);
      dados[chave] = config?.valor || DEFAULTS_PUBLICOS[chave] || '';
    }

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
    const produtos = db.prepare(`
      SELECT
        p.id, p.nome, p.categoria, p.preco_venda, p.foto, p.colecao
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
        foto: p.foto,
        colecao: p.colecao,
        grade: grade.map(g => ({ cor: g.cor, tamanho: g.tamanho, quantidade: g.quantidade })),
        tamanhos: [...new Set(grade.map(g => g.tamanho))].map(t => ({ tamanho: t })),
        galeria: galeria.map(g => g.caminho)
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
