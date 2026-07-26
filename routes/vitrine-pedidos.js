// ============================================================
// PEDIDOS DA VITRINE — visão da LOJISTA (rota autenticada)
//
// Montada em server.js DEPOIS do exigirLogin, com exigirFeature('vitrine_site')
// no próprio app.use — assim rota nova nasce protegida, sem depender de alguém
// lembrar de gatear cada uma.
// ============================================================
const router = require('express').Router();
const { db } = require('../db/database');
const { apenasAdmin } = require('../middleware/seguranca');
const { listarPedidos, pedidoPorCodigo, mudarStatus, listarLeads } = require('../lib/vitrine-pedidos');

// GET /api/vitrine-pedidos — a fila de pedidos
router.get('/', (req, res) => {
  const status = req.query.status && req.query.status !== 'todos' ? String(req.query.status) : null;
  const pedidos = listarPedidos(req.tenantId, { status, limite: 200 });

  // O número que prova que a loja online funciona. É por isso que a fase existe.
  const resumo = db.prepare(`
    SELECT
      COUNT(1) AS total,
      SUM(CASE WHEN status = 'novo' THEN 1 ELSE 0 END) AS novos,
      SUM(CASE WHEN status = 'fechado' THEN 1 ELSE 0 END) AS fechados,
      SUM(CASE WHEN status = 'fechado' THEN total ELSE 0 END) AS valor_fechado,
      SUM(CASE WHEN criado_em >= date('now','localtime','-30 days') THEN 1 ELSE 0 END) AS ultimos_30
    FROM vitrine_pedidos WHERE tenant_id = ?
  `).get(req.tenantId);

  res.json({ pedidos, resumo });
});

// GET /api/vitrine-pedidos/leads — quem deixou contato na vitrine
router.get('/leads', (req, res) => {
  res.json({ leads: listarLeads(req.tenantId) });
});

// PATCH /api/vitrine-pedidos/:id — mudar status (respondido, fechado, perdido)
router.patch('/:id', apenasAdmin, (req, res) => {
  const r = mudarStatus(req.tenantId, req.params.id, String(req.body?.status || ''));
  // 404 quando `changes` é 0: id de OUTRA loja não pode receber {ok:true}.
  // O isolamento está no WHERE, mas responder "atualizado" pra id alheio é
  // mentira que esconde bug.
  if (!r.ok) return res.status(r.erro === 'Status inválido' ? 400 : 404).json({ erro: r.erro });
  res.json({ ok: true });
});

// POST /api/vitrine-pedidos/:id/cliente — promover o contato do pedido a cliente do CRM
//
// É AQUI que o lead entra na base: por decisão da lojista, não porque alguém
// digitou um telefone num formulário. Assim o RFM e a régua continuam falando
// só de quem realmente comprou.
router.post('/:id/cliente', apenasAdmin, (req, res) => {
  const pedido = db.prepare('SELECT * FROM vitrine_pedidos WHERE id = ? AND tenant_id = ?')
    .get(Number(req.params.id), req.tenantId);
  if (!pedido) return res.status(404).json({ erro: 'Pedido não encontrado' });
  if (pedido.cliente_id) return res.json({ ok: true, cliente_id: pedido.cliente_id, ja_existia: true });

  const nome = String(req.body?.nome || pedido.cliente_nome || '').trim();
  const tel = String(req.body?.telefone || pedido.cliente_tel || '').replace(/\D/g, '');
  if (!nome) return res.status(400).json({ erro: 'Nome é obrigatório' });

  // Cliente que já existe com esse telefone é reaproveitado — criar duplicata
  // quebraria o histórico de compras que o CRM usa.
  let cliente = tel
    ? db.prepare('SELECT id FROM clientes WHERE tenant_id = ? AND telefone = ?').get(req.tenantId, tel)
    : null;

  if (!cliente) {
    const r = db.prepare(`
      INSERT INTO clientes (tenant_id, nome, telefone, origem)
      VALUES (?, ?, ?, 'Vitrine/Site')
    `).run(req.tenantId, nome, tel || null);
    cliente = { id: Number(r.lastInsertRowid) };
  }

  db.prepare('UPDATE vitrine_pedidos SET cliente_id = ? WHERE id = ? AND tenant_id = ?')
    .run(cliente.id, pedido.id, req.tenantId);
  if (tel) {
    db.prepare('UPDATE vitrine_leads SET cliente_id = ? WHERE tenant_id = ? AND telefone = ?')
      .run(cliente.id, req.tenantId, tel);
  }

  res.json({ ok: true, cliente_id: cliente.id });
});

// GET /api/vitrine-pedidos/codigo/:codigo — busca pelo #A7K2 que a cliente mandou
router.get('/codigo/:codigo', (req, res) => {
  const p = pedidoPorCodigo(req.tenantId, req.params.codigo);
  if (!p) return res.status(404).json({ erro: 'Pedido não encontrado' });
  res.json(p);
});

module.exports = router;
