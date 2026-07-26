// ============================================================
// PEDIDOS DA VITRINE — a intenção de compra que vem da loja online
//
// O QUE ISTO NÃO É: não é venda, não é checkout, não reserva estoque.
// Venda existe quando a lojista confirma no PDV e o estoque baixa. Isto aqui é
// o que a cliente montou ANTES de abrir o WhatsApp.
//
// POR QUE EXISTE: o carrinho abria o wa.me e se apagava. A lojista não sabia
// quantos pedidos a vitrine gerou, quais peças foram abandonadas, nem quem era
// a cliente. Sem esse número, não há como provar que a loja online funciona —
// e é ele que justifica o plano.
//
// NÃO RESERVA ESTOQUE de propósito: duas clientes PODEM pedir a última peça.
// Reservar sem pagamento travaria estoque de quem nunca vai fechar. A tela da
// lojista mostra a disponibilidade ATUAL na hora de abrir o pedido.
// ============================================================
const crypto = require('crypto');
const { db } = require('../db/database');

// Alfabeto sem ambiguidade visual: fora 0/O, 1/I/L. O código é lido em voz alta
// no balcão e digitado errado por telefone — cada caractere ambíguo é uma
// discussão com a cliente.
const ALFABETO = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
const TAMANHO_CODIGO = 4;   // 31^4 = 923k combinações por loja

function gerarCodigo(tamanho = TAMANHO_CODIGO) {
  let s = '';
  for (let i = 0; i < tamanho; i++) s += ALFABETO[crypto.randomInt(ALFABETO.length)];
  return s;
}

// Código único DENTRO da loja (o UNIQUE é composto com tenant_id). Tenta 10x e
// cresce pra 5 caracteres — sem retry, dois pedidos simultâneos com o mesmo
// código dariam 500 na cara da cliente no momento da compra.
function codigoDisponivel(tenantId) {
  const existe = db.prepare('SELECT 1 FROM vitrine_pedidos WHERE tenant_id = ? AND codigo = ?');
  for (let i = 0; i < 10; i++) {
    const c = gerarCodigo();
    if (!existe.get(tenantId, c)) return c;
  }
  for (let i = 0; i < 10; i++) {
    const c = gerarCodigo(5);
    if (!existe.get(tenantId, c)) return c;
  }
  throw new Error('Não foi possível gerar código de pedido');
}

// ------------------------------------------------------------
// Criar pedido
//
// O PREÇO VEM DO BANCO, nunca do cliente. Aceitar preço do body deixaria
// qualquer um pedir um vestido por R$ 1 — e a lojista veria "R$ 1" na tela
// achando que foi promoção dela.
//
// Nome e preço são COPIADOS (snapshot): se a lojista mudar o preço amanhã, o
// pedido de hoje tem que continuar dizendo o que a cliente viu, senão a
// mensagem do zap e o caixa divergem.
// ------------------------------------------------------------
function criarPedido(tenantId, { itens, cliente_nome, cliente_tel, origem, obs }) {
  if (!tenantId) throw new Error('criarPedido: tenantId obrigatorio');
  if (!Array.isArray(itens) || !itens.length) {
    return { ok: false, erro: 'Pedido sem itens' };
  }
  if (itens.length > 50) {
    return { ok: false, erro: 'Pedido com itens demais' };
  }

  const buscarProduto = db.prepare(
    'SELECT id, nome, preco_venda FROM produtos WHERE id = ? AND tenant_id = ? AND ativo = 1',
  );
  const buscarVariacao = db.prepare(
    'SELECT id, cor, tamanho, quantidade FROM variacoes WHERE produto_id = ? AND tenant_id = ? AND cor = ? AND tamanho = ?',
  );

  const resolvidos = [];
  for (const bruto of itens) {
    const produto = buscarProduto.get(Number(bruto.produto_id), tenantId);
    // Produto de OUTRA loja ou inativo simplesmente não resolve — o filtro por
    // tenant_id no WHERE é o que impede pedir peça da loja vizinha.
    if (!produto) continue;

    const qtd = Math.max(1, Math.min(99, parseInt(bruto.qtd, 10) || 1));
    const cor = bruto.cor || 'Unica';
    const variacao = bruto.tamanho ? buscarVariacao.get(produto.id, tenantId, cor, String(bruto.tamanho)) : null;

    resolvidos.push({
      produto_id: produto.id,
      variacao_id: variacao ? variacao.id : null,
      produto_nome: produto.nome,
      cor: cor === 'Unica' ? null : cor,
      tamanho: bruto.tamanho ? String(bruto.tamanho) : null,
      qtd,
      preco_unit: produto.preco_venda,
    });
  }

  if (!resolvidos.length) return { ok: false, erro: 'Nenhum item válido' };

  const total = resolvidos.reduce((s, i) => s + i.preco_unit * i.qtd, 0);
  const qtdItens = resolvidos.reduce((s, i) => s + i.qtd, 0);
  const codigo = codigoDisponivel(tenantId);

  // Transação: pedido e itens entram juntos ou não entram. Um pedido sem itens
  // apareceria na tela da lojista como "R$ 120,00" sem dizer de quê.
  db.exec('BEGIN');
  try {
    const r = db.prepare(`
      INSERT INTO vitrine_pedidos (tenant_id, codigo, cliente_nome, cliente_tel, total, qtd_itens, origem, obs)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      tenantId, codigo,
      cliente_nome ? String(cliente_nome).slice(0, 120) : null,
      cliente_tel ? String(cliente_tel).replace(/\D/g, '').slice(0, 20) : null,
      total, qtdItens,
      origem ? String(origem).slice(0, 60) : 'direto',
      obs ? String(obs).slice(0, 500) : null,
    );
    const pedidoId = Number(r.lastInsertRowid);

    const ins = db.prepare(`
      INSERT INTO vitrine_pedido_itens
        (tenant_id, pedido_id, produto_id, variacao_id, produto_nome, cor, tamanho, qtd, preco_unit)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    for (const i of resolvidos) {
      ins.run(tenantId, pedidoId, i.produto_id, i.variacao_id, i.produto_nome, i.cor, i.tamanho, i.qtd, i.preco_unit);
    }
    db.exec('COMMIT');
    return { ok: true, id: pedidoId, codigo, total, itens: resolvidos };
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
}

// ------------------------------------------------------------
// Leitura para a tela da lojista
// ------------------------------------------------------------

// `disponivel_agora` é calculado NA LEITURA, não gravado: o estoque muda entre
// o pedido e a conversa, e a lojista precisa saber o que tem AGORA — não o que
// tinha quando a cliente clicou.
function listarPedidos(tenantId, { status, limite = 100 } = {}) {
  const filtro = status ? 'AND p.status = ?' : '';
  const args = status ? [tenantId, status, limite] : [tenantId, limite];
  const pedidos = db.prepare(`
    SELECT p.*, c.nome AS cliente_cadastrado
    FROM vitrine_pedidos p
    LEFT JOIN clientes c ON c.id = p.cliente_id AND c.tenant_id = p.tenant_id
    WHERE p.tenant_id = ? ${filtro}
    ORDER BY p.criado_em DESC
    LIMIT ?
  `).all(...args);

  if (!pedidos.length) return [];

  // Uma query pros itens de todos os pedidos (sem N+1).
  const ids = pedidos.map((p) => p.id);
  const itens = db.prepare(`
    SELECT i.*, v.quantidade AS disponivel_agora
    FROM vitrine_pedido_itens i
    LEFT JOIN variacoes v ON v.id = i.variacao_id AND v.tenant_id = i.tenant_id
    WHERE i.tenant_id = ? AND i.pedido_id IN (${ids.map(() => '?').join(',')})
    ORDER BY i.id
  `).all(tenantId, ...ids);

  const porPedido = itens.reduce((m, i) => {
    (m[i.pedido_id] = m[i.pedido_id] || []).push(i);
    return m;
  }, {});

  return pedidos.map((p) => ({ ...p, itens: porPedido[p.id] || [] }));
}

function pedidoPorCodigo(tenantId, codigo) {
  const p = db.prepare('SELECT * FROM vitrine_pedidos WHERE tenant_id = ? AND codigo = ?')
    .get(tenantId, String(codigo || '').toUpperCase());
  if (!p) return null;
  p.itens = db.prepare('SELECT * FROM vitrine_pedido_itens WHERE tenant_id = ? AND pedido_id = ? ORDER BY id')
    .all(tenantId, p.id);
  return p;
}

const STATUS_VALIDOS = ['novo', 'respondido', 'fechado', 'perdido'];

function mudarStatus(tenantId, pedidoId, status) {
  if (!STATUS_VALIDOS.includes(status)) return { ok: false, erro: 'Status inválido' };
  // O tenant_id no WHERE é o que impede uma loja mexer no pedido da outra.
  // `changes` é conferido: sem isso a rota responderia {ok:true} pra id alheio.
  const r = db.prepare(`
    UPDATE vitrine_pedidos SET status = ?, atualizado_em = datetime('now','localtime')
    WHERE id = ? AND tenant_id = ?
  `).run(status, Number(pedidoId), tenantId);
  return r.changes ? { ok: true } : { ok: false, erro: 'Pedido não encontrado' };
}

// ------------------------------------------------------------
// Leads
//
// NÃO grava direto em `clientes`: jogar todo visitante que digita um telefone
// na base do CRM poluiria o RFM e a régua com gente que nunca comprou — o mesmo
// problema que a migration 040 resolveu. Vira cliente quando a lojista promove.
// ------------------------------------------------------------
function registrarLead(tenantId, { nome, telefone, email, fonte, consentiu, ip }) {
  const tel = String(telefone || '').replace(/\D/g, '');
  if (tel.length < 10 || tel.length > 15) return { ok: false, erro: 'Telefone inválido' };

  // IP nunca em claro (LGPD). O hash serve pra detectar abuso, não pra
  // identificar pessoa — e sem o SESSION_SECRET não dá pra reverter.
  const ipHash = ip
    ? crypto.createHash('sha256').update(String(ip) + (process.env.SESSION_SECRET || '')).digest('hex').slice(0, 32)
    : null;

  // ON CONFLICT: a mesma pessoa mandando o formulário 5 vezes é UM lead.
  // COALESCE preserva o que já havia — reenviar sem nome não apaga o nome antigo.
  db.prepare(`
    INSERT INTO vitrine_leads (tenant_id, nome, telefone, email, fonte, consentiu, ip_hash)
    VALUES (?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(tenant_id, telefone) DO UPDATE SET
      nome      = COALESCE(excluded.nome, vitrine_leads.nome),
      email     = COALESCE(excluded.email, vitrine_leads.email),
      consentiu = MAX(excluded.consentiu, vitrine_leads.consentiu)
  `).run(
    tenantId,
    nome ? String(nome).slice(0, 120) : null,
    tel,
    email ? String(email).slice(0, 160) : null,
    fonte ? String(fonte).slice(0, 30) : 'newsletter',
    consentiu ? 1 : 0,
    ipHash,
  );
  return { ok: true };
}

function listarLeads(tenantId, limite = 200) {
  return db.prepare(`
    SELECT l.*, c.nome AS cliente_cadastrado
    FROM vitrine_leads l
    LEFT JOIN clientes c ON c.id = l.cliente_id AND c.tenant_id = l.tenant_id
    WHERE l.tenant_id = ?
    ORDER BY l.criado_em DESC
    LIMIT ?
  `).all(tenantId, limite);
}

module.exports = {
  ALFABETO,
  STATUS_VALIDOS,
  gerarCodigo,
  codigoDisponivel,
  criarPedido,
  listarPedidos,
  pedidoPorCodigo,
  mudarStatus,
  registrarLead,
  listarLeads,
};
