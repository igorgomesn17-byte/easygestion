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

// ============================================================
// DESPACHO POR EXCURSÃO
// ============================================================
// GET /api/vitrine-pedidos/despacho — o que sai hoje, agrupado por destino.
//
// Sem isto a lojista olha uma lista solta de pedidos e despacha o mesmo destino
// em duas viagens. "3 pedidos vão na Excursão do João" é a informação que
// transforma a lista em roteiro de despacho.
//
// Só pedidos PAGOS: pedido em aberto não é despacho, é expectativa.
router.get('/despacho', (req, res) => {
  const t = req.tenantId;

  const pedidos = db.prepare(`
    SELECT p.id, p.codigo, p.total, p.qtd_itens, p.cliente_nome, p.cliente_tel,
           p.atualizado_em, p.venda_id,
           c.nome AS cliente_real, c.cidade, c.endereco,
           e.id AS excursao_id, e.nome AS excursao_nome, e.responsavel, e.telefone AS excursao_tel
      FROM vitrine_pedidos p
      LEFT JOIN clientes  c ON c.id = p.cliente_id  AND c.tenant_id = p.tenant_id
      LEFT JOIN excursoes e ON e.id = COALESCE(p.excursao_id, c.excursao_id) AND e.tenant_id = p.tenant_id
     WHERE p.tenant_id = ? AND p.venda_id IS NOT NULL
       AND (p.despachado_em IS NULL OR date(p.despachado_em) = date('now','localtime'))
     ORDER BY e.nome IS NULL, e.nome, p.atualizado_em DESC
  `).all(t);

  // Agrupa por excursão. Quem não tem vai pro grupo "sem excursão" — que não é
  // erro: retira na loja e entrega própria são casos legítimos, mas precisam
  // aparecer separados pra não sumirem no meio do roteiro.
  const grupos = new Map();
  for (const p of pedidos) {
    const chave = p.excursao_id || 'sem';
    if (!grupos.has(chave)) {
      grupos.set(chave, {
        excursao_id: p.excursao_id || null,
        excursao: p.excursao_nome || null,
        responsavel: p.responsavel || null,
        telefone: p.excursao_tel || null,
        pedidos: [], total: 0, pecas: 0,
      });
    }
    const g = grupos.get(chave);
    g.pedidos.push({
      id: p.id, codigo: p.codigo, cliente: p.cliente_real || p.cliente_nome,
      cidade: p.cidade, total: p.total, qtd_itens: p.qtd_itens,
      despachado: !!p.despachado_em,
    });
    g.total += Number(p.total || 0);
    g.pecas += Number(p.qtd_itens || 0);
  }

  res.json({ grupos: [...grupos.values()], total_pedidos: pedidos.length });
});

// POST /:id/despachar — marca que o pacote saiu.
router.post('/:id/despachar', apenasAdmin, (req, res) => {
  const r = db.prepare(`
    UPDATE vitrine_pedidos SET despachado_em = datetime('now','localtime')
     WHERE id = ? AND tenant_id = ? AND venda_id IS NOT NULL
  `).run(req.params.id, req.tenantId);
  // 404 quando não muda nada: o pedido é de outra loja ou ainda não foi pago.
  // Responder ok sem ter feito nada faria a lojista achar que despachou.
  if (!r.changes) return res.status(404).json({ erro: 'Pedido não encontrado ou não pago' });
  res.json({ ok: true });
});

// ============================================================
// EXCURSÕES — CRUD da lojista
// ============================================================
router.get('/excursoes', (req, res) => {
  res.json(db.prepare(`
    SELECT e.*,
           (SELECT COUNT(*) FROM clientes c WHERE c.excursao_id = e.id AND c.tenant_id = e.tenant_id) AS clientes
      FROM excursoes e WHERE e.tenant_id = ? ORDER BY e.ativo DESC, e.nome
  `).all(req.tenantId));
});

router.post('/excursoes', apenasAdmin, (req, res) => {
  const { nome, responsavel, telefone, cidade, obs } = req.body || {};
  if (!nome || !String(nome).trim()) return res.status(400).json({ erro: 'Dê um nome à excursão' });
  try {
    const r = db.prepare(`
      INSERT INTO excursoes (tenant_id, nome, responsavel, telefone, cidade, obs)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(req.tenantId, String(nome).trim().slice(0, 80), responsavel || null,
           telefone || null, cidade || null, obs || null);
    res.status(201).json({ ok: true, id: Number(r.lastInsertRowid) });
  } catch (e) {
    // UNIQUE(tenant_id, nome) — é o que impede a duplicata que essa tela existe
    // pra combater.
    if (String(e.message).includes('UNIQUE')) return res.status(409).json({ erro: 'Já existe uma excursão com esse nome' });
    res.status(500).json({ erro: 'Não foi possível salvar' });
  }
});

router.patch('/excursoes/:id', apenasAdmin, (req, res) => {
  const { nome, responsavel, telefone, cidade, obs, ativo } = req.body || {};
  const r = db.prepare(`
    UPDATE excursoes SET
      nome        = COALESCE(?, nome),
      responsavel = COALESCE(?, responsavel),
      telefone    = COALESCE(?, telefone),
      cidade      = COALESCE(?, cidade),
      obs         = COALESCE(?, obs),
      ativo       = COALESCE(?, ativo)
     WHERE id = ? AND tenant_id = ?
  `).run(nome ? String(nome).trim().slice(0, 80) : null, responsavel ?? null, telefone ?? null,
         cidade ?? null, obs ?? null, ativo === undefined ? null : (ativo ? 1 : 0),
         req.params.id, req.tenantId);
  if (!r.changes) return res.status(404).json({ erro: 'Excursão não encontrada' });
  res.json({ ok: true });
});

// POST /excursoes/:id/fundir — junta duas que são a mesma coisa.
//
// A duplicata é inevitável: a cliente digita "Van do João" e outra digita
// "Excursão João". Sem fundir, o despacho continua vendo dois destinos pro mesmo
// lugar — e é justamente o problema que agrupar por excursão deveria resolver.
router.post('/excursoes/:id/fundir', apenasAdmin, (req, res) => {
  const t = req.tenantId;
  const destino = Number(req.params.id);
  const origem = Number((req.body || {}).origem_id);
  if (!origem || origem === destino) return res.status(400).json({ erro: 'Escolha outra excursão' });

  const ok = db.prepare('SELECT COUNT(*) n FROM excursoes WHERE tenant_id = ? AND id IN (?, ?)')
    .get(t, destino, origem).n === 2;
  if (!ok) return res.status(404).json({ erro: 'Excursão não encontrada' });

  db.transaction(() => {
    db.prepare('UPDATE clientes SET excursao_id = ? WHERE excursao_id = ? AND tenant_id = ?').run(destino, origem, t);
    db.prepare('UPDATE vitrine_pedidos SET excursao_id = ? WHERE excursao_id = ? AND tenant_id = ?').run(destino, origem, t);
    // Desativa em vez de apagar: o histórico continua legível, e um DELETE com
    // FK apontando pra cá falharia de qualquer forma.
    db.prepare('UPDATE excursoes SET ativo = 0 WHERE id = ? AND tenant_id = ?').run(origem, t);
  })();

  res.json({ ok: true });
});

module.exports = router;
