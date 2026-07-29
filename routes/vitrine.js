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
const reserva = require('../lib/reserva');
const pix = require('../lib/pix');
const { normalizarTelefone } = require('../lib/whatsapp');
const { cnpj: cnpjValidador, cpf: cpfValidador } = require('cpf-cnpj-validator');
const rateLimit = require('express-rate-limit');

const cnpjValido = (v) => cnpjValidador.isValid(v);
const cpfValido = (v) => cpfValidador.isValid(v);

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

    res.status(201).json({ ok: true, id: r.id, codigo: r.codigo, total: r.total });
  } catch (err) {
    console.error('[VITRINE] Erro em POST /:slug/pedido:', err);
    res.status(500).json({ erro: 'Não foi possível registrar o pedido' });
  }
});

// ============================================================
// ATACADO — cadastro no fechamento e Pix.
// ============================================================
// POST /api/vitrine/:slug/pedido/:codigo/cadastro
//
// A cliente navega e monta o carrinho SEM login. O cadastro só aparece na hora de
// fechar — pedir antes é o que faz desistir na porta. Aqui ela vira cliente de
// verdade, com CNPJ e excursão.
router.post('/:slug/pedido/:codigo/cadastro', limiteEscritaPublica, (req, res) => {
  try {
    const loja = resolverLojaPublica(req.params.slug);
    if (!loja || !loja.temAtacado) return res.status(404).json({ erro: 'Loja não encontrada' });
    const t = loja.tenant.id;

    const pedido = db.prepare(
      "SELECT * FROM vitrine_pedidos WHERE tenant_id = ? AND codigo = ? AND status = 'novo'"
    ).get(t, String(req.params.codigo || '').toUpperCase());
    if (!pedido) return res.status(404).json({ erro: 'Pedido não encontrado' });

    const { nome, cnpj, telefone, cidade, uf, endereco, cep, excursao, email } = req.body || {};
    if (!nome || !telefone) return res.status(400).json({ erro: 'Preencha o nome e o telefone' });

    const tel = normalizarTelefone(telefone);
    if (!tel) return res.status(400).json({ erro: 'Telefone inválido' });

    const doc = String(cnpj || '').replace(/\D/g, '');
    if (doc && !(cnpjValido(doc) || cpfValido(doc))) {
      return res.status(400).json({ erro: 'CNPJ inválido' });
    }

    // A EXCURSÃO É TABELA, não texto: o mesmo destino escrito de três jeitos
    // ("Excursão do João", "exc joao", "Van do João") impediria agrupar o despacho,
    // que é justamente onde essa informação serve. Digitar uma nova cria a linha —
    // a cliente não pode ficar presa porque a excursão dela ainda não existe.
    let excursaoId = null;
    if (excursao && String(excursao).trim()) {
      const nomeExc = String(excursao).trim().slice(0, 80);
      const achada = db.prepare('SELECT id FROM excursoes WHERE tenant_id = ? AND nome = ? COLLATE NOCASE').get(t, nomeExc);
      excursaoId = achada
        ? achada.id
        : Number(db.prepare('INSERT INTO excursoes (tenant_id, nome, cidade) VALUES (?, ?, ?)').run(t, nomeExc, cidade || null).lastInsertRowid);
    }

    // Já é cliente? Casa pelo telefone (8 dígitos finais — o mesmo número chega em
    // formatos diferentes) pra não criar cadastro duplicado a cada pedido.
    const sufixo = tel.slice(-8);
    let cli = db.prepare(`
      SELECT id FROM clientes
       WHERE tenant_id = ? AND arquivado = 0
         AND replace(replace(replace(replace(telefone,' ',''),'-',''),'(',''),')','') LIKE ?
       ORDER BY num_compras DESC LIMIT 1
    `).get(t, '%' + sufixo);

    if (cli) {
      // Atualiza o que ela informou agora, sem apagar o que já existia.
      db.prepare(`
        UPDATE clientes SET nome = ?, cidade = COALESCE(?, cidade), uf = COALESCE(?, uf),
               endereco = COALESCE(?, endereco), cep = COALESCE(?, cep),
               cpf_cnpj = COALESCE(?, cpf_cnpj), email = COALESCE(?, email),
               excursao_id = COALESCE(?, excursao_id),
               tipo = CASE WHEN tipo = 'prospect' THEN NULL ELSE tipo END
         WHERE id = ? AND tenant_id = ?
      `).run(String(nome).slice(0, 120), cidade || null, uf || null, endereco || null, cep || null,
             doc || null, email ? String(email).toLowerCase() : null, excursaoId, cli.id, t);
    } else {
      cli = { id: Number(db.prepare(`
        INSERT INTO clientes (tenant_id, nome, telefone, cidade, uf, endereco, cep, cpf_cnpj, email, excursao_id, origem)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'vitrine')
      `).run(t, String(nome).slice(0, 120), tel, cidade || null, uf || null, endereco || null,
             cep || null, doc || null, email ? String(email).toLowerCase() : null, excursaoId).lastInsertRowid) };
    }

    db.prepare(`
      UPDATE vitrine_pedidos SET cliente_id = ?, cliente_nome = ?, cliente_tel = ?, excursao_id = ?,
             atualizado_em = datetime('now','localtime')
       WHERE id = ? AND tenant_id = ?
    `).run(cli.id, String(nome).slice(0, 120), tel, excursaoId, pedido.id, t);

    res.json({ ok: true, cliente_id: cli.id });
  } catch (err) {
    console.error('[VITRINE] Erro no cadastro do pedido:', err);
    res.status(500).json({ erro: 'Não foi possível salvar seus dados' });
  }
});

// POST /api/vitrine/:slug/pedido/:codigo/pix — reserva o estoque e gera o QR.
//
// A ORDEM importa: reserva PRIMEIRO, cobra depois. Gerar o Pix antes de garantir a
// peça é o caminho pra cliente pagar por algo que já foi vendido no balcão.
router.post('/:slug/pedido/:codigo/pix', limiteEscritaPublica, async (req, res) => {
  try {
    const loja = resolverLojaPublica(req.params.slug);
    if (!loja || !loja.temAtacado) return res.status(404).json({ erro: 'Loja não encontrada' });
    const t = loja.tenant.id;

    const pedido = db.prepare(
      "SELECT * FROM vitrine_pedidos WHERE tenant_id = ? AND codigo = ?"
    ).get(t, String(req.params.codigo || '').toUpperCase());
    if (!pedido) return res.status(404).json({ erro: 'Pedido não encontrado' });
    if (pedido.venda_id) return res.status(409).json({ erro: 'Este pedido já foi pago' });

    const rr = reserva.reservar(t, pedido.id, pix.MINUTOS_EXPIRA);
    if (!rr.ok) {
      // Diz QUAL peça faltou: "não deu" sem explicação faz a cliente achar que o
      // site quebrou, quando na verdade a peça acabou enquanto ela escolhia.
      return res.status(409).json({ erro: rr.erro, faltando: rr.faltando || [] });
    }

    const cob = await pix.criarCobranca(t, pedido.id, { email: req.body?.email });
    if (!cob.ok) {
      // Cobrança falhou: solta a peça na hora. Deixar reservada travaria o estoque
      // por 45 minutos por causa de um erro do provedor.
      reserva.liberar(t, pedido.id);
      return res.status(502).json({ erro: cob.erro || 'Não foi possível gerar o Pix' });
    }

    res.json({
      ok: true, codigo: pedido.codigo, total: cob.total,
      copia_cola: cob.copia_cola, qr_base64: cob.qr_base64, expira_em: cob.expira_em,
    });
  } catch (err) {
    console.error('[VITRINE] Erro ao gerar Pix:', err);
    res.status(500).json({ erro: 'Não foi possível gerar o pagamento' });
  }
});

// GET /api/vitrine/:slug/pedido/:codigo/status — a tela pergunta "já caiu?".
// O webhook é o caminho normal; isto é a rede de segurança pra quando ele atrasa.
router.get('/:slug/pedido/:codigo/status', (req, res) => {
  try {
    const loja = resolverLojaPublica(req.params.slug);
    if (!loja || !loja.temAtacado) return res.status(404).json({ erro: 'Loja não encontrada' });

    const p = db.prepare(
      'SELECT codigo, status, venda_id, pagamento_status, pix_expira_em FROM vitrine_pedidos WHERE tenant_id = ? AND codigo = ?'
    ).get(loja.tenant.id, String(req.params.codigo || '').toUpperCase());
    if (!p) return res.status(404).json({ erro: 'Pedido não encontrado' });

    res.json({
      codigo: p.codigo,
      pago: !!p.venda_id,
      status: p.status,
      expira_em: p.pix_expira_em,
    });
  } catch (err) {
    res.status(500).json({ erro: 'Erro ao consultar' });
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
