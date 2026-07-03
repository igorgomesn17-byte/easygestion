// ============================================================
// API PÚBLICA da vitrine: catálogo de produtos por slug
// ============================================================
const express = require('express');
const router = express.Router();
const { db, getConfig } = require('../db/database');

// Resolver tenant pelo slug (público, sem autenticação)
function resolverTenantPorSlug(slug) {
  if (!slug || typeof slug !== 'string') return null;
  return db.prepare('SELECT id, nome_loja, email FROM tenants WHERE slug = ?').get(slug.toLowerCase());
}

// GET /api/vitrine/:slug — dados públicos da loja (nome, logo, cor, whatsapp, etc)
router.get('/:slug', (req, res) => {
  try {
    const { slug } = req.params;
    const tenant = resolverTenantPorSlug(slug);

    if (!tenant) {
      return res.status(404).json({ erro: 'Loja não encontrada' });
    }

    // Buscar vitrine_ativa: específica do tenant
    let vitrineAtivaConfig = db.prepare('SELECT valor FROM config WHERE chave = ? AND tenant_id = ?')
      .get('vitrine_ativa', tenant.id);
    // Se não encontrou específica do tenant, buscar global (qualquer tenant_id)
    if (!vitrineAtivaConfig) {
      vitrineAtivaConfig = db.prepare('SELECT valor FROM config WHERE chave = ?').get('vitrine_ativa');
    }
    const vitrineAtiva = vitrineAtivaConfig?.valor === '1';

    if (!vitrineAtiva) {
      return res.status(200).json({
        vitrineAtiva: false,
        mensagem: 'Esta loja ainda não tem a vitrine disponível'
      });
    }

    // Buscar dados públicos da loja (mesmo padrão de /api/loja-publica, mas filtrado)
    const CHAVES_PUBLICAS = [
      'loja_nome', 'loja_endereco', 'loja_instagram', 'loja_telefone',
      'vitrine_frase', 'loja_whatsapp', 'loja_whatsapp_link', 'loja_instagram_url',
      'loja_maps', 'loja_logo', 'marca_cor'
    ];

    const dados = {
      slug: tenant.slug,
      vitrineAtiva: true,
      email: tenant.email
    };

    for (const chave of CHAVES_PUBLICAS) {
      // Buscar config: primeiro específica do tenant, depois qualquer uma
      let config = db.prepare('SELECT valor FROM config WHERE chave = ? AND tenant_id = ?')
        .get(chave, tenant.id);
      if (!config) {
        config = db.prepare('SELECT valor FROM config WHERE chave = ?').get(chave);
      }
      dados[chave] = config?.valor || '';
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

    if (!tenant) {
      return res.status(404).json({ erro: 'Loja não encontrada' });
    }

    // Buscar vitrine_ativa: específica do tenant
    let vitrineAtivaConfig = db.prepare('SELECT valor FROM config WHERE chave = ? AND tenant_id = ?')
      .get('vitrine_ativa', tenant.id);
    // Se não encontrou específica do tenant, buscar global (qualquer tenant_id)
    if (!vitrineAtivaConfig) {
      vitrineAtivaConfig = db.prepare('SELECT valor FROM config WHERE chave = ?').get('vitrine_ativa');
    }
    const vitrineAtiva = vitrineAtivaConfig?.valor === '1';

    if (!vitrineAtiva) {
      return res.status(403).json({ erro: 'Vitrine não está ativa' });
    }

    // Buscar produtos ativos com estoque (mesmo padrão do GET /api/produtos/vitrine,
    // mas FILTRADO por tenant_id do slug + sem expor código/SKU)
    const produtos = db.prepare(`
      SELECT
        p.id, p.nome, p.categoria, p.cor, p.preco_venda, p.foto, p.colecao
      FROM produtos p
      WHERE p.ativo = 1 AND p.tenant_id = ?
      ORDER BY p.nome ASC
    `).all(tenant.id);

    // Para cada produto, buscar tamanhos + galeria
    const produtosCompletos = produtos.map(p => {
      // Tamanhos com quantidade > 0
      const tamanhos = db.prepare(`
        SELECT tamanho, quantidade
        FROM variacoes
        WHERE produto_id = ? AND tenant_id = ? AND quantidade > 0
        ORDER BY CAST(tamanho AS TEXT)
      `).all(p.id, tenant.id);

      // Galeria de fotos
      const galeria = db.prepare(`
        SELECT url FROM produto_fotos WHERE produto_id = ? AND tenant_id = ? ORDER BY id
      `).all(p.id, tenant.id);

      return {
        id: p.id,
        titulo: p.nome,
        nome: p.nome,
        categoria: p.categoria,
        cor: p.cor,
        preco_venda: p.preco_venda,
        foto: p.foto,
        colecao: p.colecao,
        tamanhos: tamanhos.map(t => ({ tamanho: t.tamanho, quantidade: t.quantidade })),
        galeria: galeria.map(g => g.url)
      };
    });

    // Filtrar apenas produtos com pelo menos um tamanho em estoque
    const produtosComEstoque = produtosCompletos.filter(p => p.tamanhos.length > 0);

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
