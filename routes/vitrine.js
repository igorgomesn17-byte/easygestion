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
const { resolverLojaPublica, urlFoto, catalogoPublico } = require('../lib/vitrine-publica');
const { criarPedido, registrarLead } = require('../lib/vitrine-pedidos');
const rateLimit = require('express-rate-limit');

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

    // Catálogo: a MESMA função que o SSR usa (lib/vitrine-publica.js). Se fossem
    // duas implementações, a página mostraria um catálogo e este JSON outro — e
    // ninguém descobriria até a cliente reclamar que a peça do link não existe.
    res.json(catalogoPublico(tenant.id));
  } catch (err) {
    console.error('[VITRINE] Erro em GET /:slug/produtos:', err);
    res.status(500).json({ erro: 'Erro ao carregar produtos' });
  }
});

// ============================================================
// ESCRITA PÚBLICA (sem sessão) — pedido e lead
//
// Estas rotas moram AQUI, e não num router novo, porque /api/vitrine já está
// montado antes do exigirLogin e já consta em PUBLICAS (middleware/seguranca.js).
// Router novo exigiria mexer nos dois lugares — e esquecer o segundo daria 401
// silencioso pra cliente tentando comprar.
// ============================================================

// Limite por IP: rota pública de ESCRITA sem autenticação. O limiteGlobal cobre
// /api, mas gravar pedido merece teto próprio — sem isso um script enche a tela
// da lojista de pedido falso e o sinal (quantos pedidos a vitrine gerou) morre.
const limiteEscritaPublica = rateLimit({
  windowMs: 10 * 60 * 1000,
  max: 30,
  standardHeaders: true,
  legacyHeaders: false,
  message: { erro: 'Muitas tentativas. Aguarde alguns minutos.' },
});

// POST /api/vitrine/:slug/pedido — grava a intenção ANTES de abrir o WhatsApp
router.post('/:slug/pedido', limiteEscritaPublica, (req, res) => {
  try {
    const loja = resolverLojaPublica(req.params.slug);
    // Pedido gravado é do plano com SITE. Sem ele, o carrinho segue funcionando
    // como sempre (abre o wa.me direto) — o front trata a falha e não trava a venda.
    if (!loja || !loja.temSite) return res.status(404).json({ erro: 'Loja não encontrada' });

    const r = criarPedido(loja.tenant.id, {
      itens: req.body?.itens,
      cliente_nome: req.body?.cliente_nome,
      cliente_tel: req.body?.cliente_tel,
      origem: req.body?.origem,
      obs: req.body?.obs,
    });
    if (!r.ok) return res.status(400).json({ erro: r.erro });

    // Se a cliente se identificou, o telefone vira lead — é o único momento em
    // que temos contato de quem comprou pela vitrine.
    if (req.body?.cliente_tel) {
      try {
        registrarLead(loja.tenant.id, {
          nome: req.body?.cliente_nome,
          telefone: req.body.cliente_tel,
          fonte: 'pedido',
          consentiu: 1,   // mandar o próprio contato pra fechar pedido é consentimento
          ip: req.ip,
        });
      } catch (e) { /* lead é bônus: nunca derruba o pedido */ }
    }

    res.status(201).json({ ok: true, codigo: r.codigo, total: r.total });
  } catch (err) {
    console.error('[VITRINE] Erro em POST /:slug/pedido:', err);
    res.status(500).json({ erro: 'Não foi possível registrar o pedido' });
  }
});

// POST /api/vitrine/:slug/lead — newsletter e "avise-me"
//
// LIBERADO EM TODOS OS PLANOS de propósito: o formulário de newsletter já existe
// na vitrine de quem paga e hoje não grava ninguém (só abre o wa.me). Corrigir
// isso só no plano com site seria manter um bug conhecido em quem paga.
router.post('/:slug/lead', limiteEscritaPublica, (req, res) => {
  try {
    const loja = resolverLojaPublica(req.params.slug);
    if (!loja) return res.status(404).json({ erro: 'Loja não encontrada' });

    const r = registrarLead(loja.tenant.id, {
      nome: req.body?.nome,
      telefone: req.body?.telefone,
      email: req.body?.email,
      fonte: req.body?.fonte || 'newsletter',
      consentiu: req.body?.consentiu ? 1 : 0,
      ip: req.ip,
    });
    if (!r.ok) return res.status(400).json({ erro: r.erro });
    res.status(201).json({ ok: true });
  } catch (err) {
    console.error('[VITRINE] Erro em POST /:slug/lead:', err);
    res.status(500).json({ erro: 'Não foi possível registrar' });
  }
});

module.exports = router;
