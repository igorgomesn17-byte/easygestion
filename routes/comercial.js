// ============================================================
// CRM COMERCIAL — o Comercial 1 (levantada de mão → primeira compra).
// ------------------------------------------------------------
// O Easy já era uma máquina de Comercial 2: régua de recompra, RFM, clube,
// reativação. O que faltava era o C1 inteiro — três dos nove públicos do MCC não
// tinham onde morar: levantada de mão, em atendimento e **não cliente** (a que foi
// atendida, não comprou, e ninguém mais falou com ela; a mais cara de todas,
// porque o marketing pagou pra trazer).
//
// Aqui vive: o kanban de prospecção, as conversas e o placar por pessoa.
// O gate `crm_avancado` e o papel ficam no app.use (server.js), não rota a rota —
// assim rota nova nasce protegida sem ninguém precisar lembrar.
// ============================================================
const express = require('express');
const router = express.Router();
const { db } = require('../db/database');
const conversas = require('../lib/conversas');
const whatsapp = require('../lib/whatsapp');
const logger = require('../lib/logger');

// As colunas do funil. Ordem é a do processo, não alfabética — a tela desenha
// nesta sequência e mover o card é sempre "pra direita".
const ESTAGIOS = [
  { id: 'novo',        nome: 'A abordar' },
  { id: 'falei',       nome: 'Falei' },
  { id: 'catalogo',    nome: 'Mandei catálogo' },
  { id: 'negociando',  nome: 'Negociando' },
  { id: 'comprou',     nome: 'Virou cliente' },
  { id: 'nao_levou',   nome: 'Não levou' },
];
const IDS_ESTAGIO = new Set(ESTAGIOS.map((e) => e.id));

// Quantos dias sem mover antes de o card virar cobrança. Card parado é o que o
// MCC chama de "não cliente" — foi atendido, não fechou, e some se ninguém voltar.
const DIAS_PARADO = 3;

function usuarioDaSessao(req) {
  return req.session?.usuario_id || null;
}

// ------------------------------------------------------------
// GET /kanban — o funil inteiro
// ------------------------------------------------------------
router.get('/kanban', (req, res) => {
  const t = req.tenantId;
  const meu = req.query.meu === '1' ? usuarioDaSessao(req) : null;

  // Filtro por departamento (?depto=c1|c2). Cada comercial abre na SUA fila, mas
  // alcança a do colega — férias e picos se resolvem sem o dono mexer no cadastro.
  const depto = ['c1', 'c2'].includes(req.query.depto) ? req.query.depto : null;

  const linhas = db.prepare(`
    SELECT c.id, c.estagio, c.ordem_kanban, c.telefone, c.contato_nome, c.origem,
           c.usuario_id, c.ultima_interacao, c.criado_em, c.departamento,
           cl.id AS cliente_id, cl.nome AS cliente_nome, cl.cidade,
           cl.total_gasto, cl.num_compras, cl.tipo AS cliente_tipo,
           u.nome AS dono_nome,
           (SELECT texto   FROM mensagens m WHERE m.conversa_id = c.id ORDER BY m.id DESC LIMIT 1) AS ultima_msg,
           (SELECT direcao FROM mensagens m WHERE m.conversa_id = c.id ORDER BY m.id DESC LIMIT 1) AS ultima_direcao,
           -- Dias sem NENHUM movimento. É isto que transforma "card esquecido" em
           -- tarefa visível, em vez de linha num relatório que ninguém abre.
           CAST(julianday('now','localtime') - julianday(c.ultima_interacao) AS INTEGER) AS dias_parado
      FROM conversas c
      LEFT JOIN clientes cl ON cl.id = c.cliente_id AND cl.tenant_id = c.tenant_id
      LEFT JOIN usuarios u  ON u.id  = c.usuario_id AND u.tenant_id = c.tenant_id
     WHERE c.tenant_id = ? AND c.arquivada = 0
       AND (? IS NULL OR c.usuario_id = ?)
       AND (? IS NULL OR COALESCE(c.departamento, 'c1') = ?)
     ORDER BY c.ordem_kanban ASC, c.ultima_interacao DESC
  `).all(t, meu, meu, depto, depto);

  const colunas = ESTAGIOS.map((e) => ({
    ...e,
    cards: linhas
      .filter((l) => (l.estagio || 'novo') === e.id)
      .map((l) => ({
        ...l,
        // "Esperando resposta" = a última mensagem é DELA. Sem marcar nada.
        esperando: l.ultima_direcao === 'recebida',
        // Card parado só cobra no meio do funil: quem virou cliente ou não levou
        // já terminou, e ficar cobrando o que acabou vira ruído.
        travado: l.dias_parado >= DIAS_PARADO && !['comprou', 'nao_levou'].includes(l.estagio || 'novo'),
      })),
  }));

  // Contagem por departamento SEM o filtro aplicado — senão o número do filtro
  // sumiria assim que ele fosse usado, e a pessoa perderia a noção de quanto tem
  // do outro lado.
  const porDepto = db.prepare(`
    SELECT COALESCE(departamento, 'c1') AS d, COUNT(*) AS n
      FROM conversas WHERE tenant_id = ? AND arquivada = 0 GROUP BY 1
  `).all(t).reduce((m, r) => ({ ...m, [r.d]: r.n }), { c1: 0, c2: 0 });

  res.json({
    colunas, total: linhas.length, tem_canal: whatsapp.temCanal(t),
    depto, por_depto: porDepto,
    // O papel decide em qual fila a tela ABRE. `relacionamento`/`admin` veem tudo.
    meu_papel: req.session?.papel || 'admin',
  });
});

// ------------------------------------------------------------
// POST /kanban/:id/estagio — mover o card
// ------------------------------------------------------------
router.post('/kanban/:id/estagio', (req, res) => {
  const t = req.tenantId;
  const { estagio, ordem } = req.body || {};
  if (!IDS_ESTAGIO.has(estagio)) return res.status(400).json({ erro: 'Etapa inválida' });

  const conversa = db.prepare('SELECT * FROM conversas WHERE id = ? AND tenant_id = ?')
    .get(req.params.id, t);
  if (!conversa) return res.status(404).json({ erro: 'Conversa não encontrada' });

  db.transaction(() => {
    db.prepare(`
      UPDATE conversas SET estagio = ?, ordem_kanban = COALESCE(?, ordem_kanban),
             usuario_id = COALESCE(usuario_id, ?),
             ultima_interacao = datetime('now','localtime')
       WHERE id = ? AND tenant_id = ?
    `).run(estagio, ordem ?? null, usuarioDaSessao(req), conversa.id, t);

    // VIROU CLIENTE: aqui o kanban ENTREGA PRA FILA. O prospect deixa de ser
    // prospect e passa a existir pro RFM, pra régua e pro clube — é o ponto onde
    // o Comercial 1 encontra o Comercial 2.
    //
    // Só tira o rótulo 'prospect'. Não inventa compra: total_gasto e num_compras
    // continuam zerados até uma venda de verdade acontecer. Marcar como cliente
    // sem venda envenenaria o RFM com gente que nunca comprou.
    if (estagio === 'comprou' && conversa.cliente_id) {
      db.prepare(`UPDATE clientes SET tipo = NULL WHERE id = ? AND tenant_id = ? AND tipo = 'prospect'`)
        .run(conversa.cliente_id, t);
    }
  })();

  res.json({ ok: true, id: conversa.id, estagio });
});

// Assumir a conversa. Sem roubo: quem já tem dono continua com ele — é o que
// impede dois comerciais atenderem a mesma pessoa ao mesmo tempo.
router.post('/kanban/:id/assumir', (req, res) => {
  const u = usuarioDaSessao(req);
  if (!u) return res.status(400).json({ erro: 'Sessão sem usuário' });

  const okAssumiu = conversas.assumir(req.tenantId, Number(req.params.id), u);
  if (!okAssumiu) {
    const dono = db.prepare(`
      SELECT u.nome FROM conversas c JOIN usuarios u ON u.id = c.usuario_id
       WHERE c.id = ? AND c.tenant_id = ?
    `).get(req.params.id, req.tenantId);
    return res.status(409).json({ erro: `${dono?.nome || 'Outra pessoa'} já está atendendo`, dono: dono?.nome });
  }
  res.json({ ok: true });
});

// Transferir de propósito (férias, pedido da cliente). Diferente de assumir:
// aqui a troca é explícita, então ela SOBRESCREVE o dono.
router.post('/kanban/:id/transferir', (req, res) => {
  const { usuario_id } = req.body || {};
  const destino = db.prepare('SELECT id FROM usuarios WHERE id = ? AND tenant_id = ? AND ativo = 1')
    .get(usuario_id, req.tenantId);
  if (!destino) return res.status(400).json({ erro: 'Usuário inválido' });

  const r = db.prepare('UPDATE conversas SET usuario_id = ? WHERE id = ? AND tenant_id = ?')
    .run(usuario_id, req.params.id, req.tenantId);
  if (!r.changes) return res.status(404).json({ erro: 'Conversa não encontrada' });
  res.json({ ok: true });
});

// ------------------------------------------------------------
// Prospect novo, cadastrado à mão (achou no Instagram, passou na rua)
// ------------------------------------------------------------
router.post('/prospect', (req, res) => {
  const t = req.tenantId;
  const { nome, telefone, cidade, origem, obs } = req.body || {};
  if (!nome || !telefone) return res.status(400).json({ erro: 'Preencha o nome e o telefone' });

  const tel = whatsapp.normalizarTelefone(telefone);
  if (!tel) return res.status(400).json({ erro: 'Telefone inválido' });

  try {
    const r = db.transaction(() => {
      // Já existe? Casa pelo telefone pra não criar cadastro duplicado — e se ela
      // já é CLIENTE, isso precisa aparecer: prospectar quem já compra é gafe.
      const existente = conversas.clientePorTelefone(t, tel);

      const clienteId = existente ? existente.id : Number(db.prepare(`
        INSERT INTO clientes (tenant_id, nome, telefone, cidade, tipo, origem, observacoes)
        VALUES (?, ?, ?, ?, 'prospect', ?, ?)
      `).run(t, String(nome).slice(0, 120), tel, cidade || null, origem || 'prospeccao', obs || null).lastInsertRowid);

      const conversa = conversas.acharOuCriarConversa(t, {
        telefone: tel, nome, origem: origem || 'prospeccao',
      });
      db.prepare('UPDATE conversas SET cliente_id = ?, usuario_id = COALESCE(usuario_id, ?) WHERE id = ? AND tenant_id = ?')
        .run(clienteId, usuarioDaSessao(req), conversa.id, t);

      return { clienteId, conversaId: conversa.id, jaExistia: !!existente, jaEcliente: existente && !existente.tipo };
    })();

    res.status(201).json({ ok: true, ...r });
  } catch (err) {
    logger.error('[COMERCIAL] erro ao criar prospect:', err.message);
    res.status(500).json({ erro: 'Não foi possível cadastrar' });
  }
});

// ------------------------------------------------------------
// GET /buscar-clientes?q= — procurar na base pra começar uma conversa
// ------------------------------------------------------------
// Sem isto, a única porta de entrada era "cadastrar contato novo" — inútil para
// quem já tem 1.235 clientes. Iniciar conversa com quem JÁ compra é o trabalho
// principal do Comercial 2, e não havia por onde.
router.get('/buscar-clientes', (req, res) => {
  const q = String(req.query.q || '').trim();
  if (q.length < 2) return res.json([]);

  const t = req.tenantId;
  const like = `%${q}%`;
  const soDigitos = q.replace(/\D/g, '');

  const linhas = db.prepare(`
    SELECT c.id, c.nome, c.telefone, c.cidade, c.total_gasto, c.num_compras,
           c.ultima_compra, c.tipo, c.nao_perturbe,
           -- Já existe conversa aberta? A tela abre a que existe em vez de criar
           -- outra: duas conversas com a mesma pessoa é o começo de dois
           -- comerciais atendendo em paralelo sem saber.
           (SELECT id FROM conversas v
             WHERE v.cliente_id = c.id AND v.tenant_id = c.tenant_id AND v.arquivada = 0
             ORDER BY v.ultima_interacao DESC LIMIT 1) AS conversa_id
      FROM clientes c
     WHERE c.tenant_id = ? AND c.arquivado = 0
       -- 'balcao' fora: é o "Consumidor não identificado", não é pessoa.
       AND (c.tipo IS NULL OR c.tipo <> 'balcao')
       -- COLLATE NOCASE: sem ele "ma" não acha "Modas Cristina". O LIKE do SQLite
       -- só é case-insensitive em ASCII por padrão — e quem digita numa busca não
       -- escreve com maiúscula.
       AND (c.nome LIKE ? COLLATE NOCASE
            OR (? <> '' AND replace(replace(replace(replace(c.telefone,' ',''),'-',''),'(',''),')','') LIKE ?))
     ORDER BY c.num_compras DESC, c.total_gasto DESC
     LIMIT 20
  `).all(t, like, soDigitos, '%' + soDigitos + '%');

  res.json(linhas);
});

// POST /conversa-com/:clienteId — abre (ou cria) a conversa com quem já é cliente.
router.post('/conversa-com/:clienteId', (req, res) => {
  const t = req.tenantId;
  const cli = db.prepare('SELECT * FROM clientes WHERE id = ? AND tenant_id = ? AND arquivado = 0')
    .get(req.params.clienteId, t);
  if (!cli) return res.status(404).json({ erro: 'Cliente não encontrada' });
  if (!cli.telefone) return res.status(400).json({ erro: 'Esta cliente não tem telefone cadastrado' });

  // "Não perturbe" é escolha dela (LGPD) — bloqueia aqui, não só na régua.
  // Deixar passar porque o contato é manual seria burlar o próprio opt-out.
  if (cli.nao_perturbe) return res.status(403).json({ erro: 'Esta cliente pediu para não receber contato' });

  try {
    const conversa = conversas.acharOuCriarConversa(t, {
      telefone: cli.telefone, nome: cli.nome, origem: 'manual',
    });
    // Amarra na cliente (acharOuCriarConversa pode não ter casado o telefone se
    // ele estiver cadastrado num formato diferente) e assume, sem roubar de quem
    // já estava atendendo.
    db.prepare(`
      UPDATE conversas SET cliente_id = COALESCE(cliente_id, ?), usuario_id = COALESCE(usuario_id, ?)
       WHERE id = ? AND tenant_id = ?
    `).run(cli.id, usuarioDaSessao(req), conversa.id, t);

    res.json({ ok: true, conversa_id: conversa.id });
  } catch (e) {
    logger.error('[COMERCIAL] erro ao abrir conversa:', e.message);
    res.status(500).json({ erro: 'Não foi possível abrir a conversa' });
  }
});

// ------------------------------------------------------------
// Conversa: ler e responder
// ------------------------------------------------------------
router.get('/conversas/:id', (req, res) => {
  const t = req.tenantId;
  const c = db.prepare(`
    SELECT c.*, cl.nome AS cliente_nome, cl.total_gasto, cl.num_compras, cl.ultima_compra,
           cl.cidade, cl.tipo AS cliente_tipo, u.nome AS dono_nome
      FROM conversas c
      LEFT JOIN clientes cl ON cl.id = c.cliente_id AND cl.tenant_id = c.tenant_id
      LEFT JOIN usuarios u  ON u.id  = c.usuario_id AND u.tenant_id = c.tenant_id
     WHERE c.id = ? AND c.tenant_id = ?
  `).get(req.params.id, t);
  if (!c) return res.status(404).json({ erro: 'Conversa não encontrada' });

  res.json({ conversa: c, mensagens: conversas.mensagensDa(t, c.id), tem_canal: whatsapp.temCanal(t) });
});

// POST /conversas/:id/mensagem — responder pelo sistema.
router.post('/conversas/:id/mensagem', async (req, res) => {
  const t = req.tenantId;
  const { texto, nota } = req.body || {};
  if (!texto || !String(texto).trim()) return res.status(400).json({ erro: 'Escreva a mensagem' });

  const c = db.prepare('SELECT * FROM conversas WHERE id = ? AND tenant_id = ?').get(req.params.id, t);
  if (!c) return res.status(404).json({ erro: 'Conversa não encontrada' });

  // NOTA INTERNA: fica na conversa, a cliente nunca vê. É onde mora "ela disse que
  // volta depois do dia 20" — a informação que hoje se perde entre uma conversa e outra.
  if (nota) {
    conversas.registrarNota(t, { conversaId: c.id, texto: String(texto), usuarioId: usuarioDaSessao(req) });
    return res.json({ ok: true, nota: true });
  }

  const envio = await whatsapp.enviarTexto(t, c.telefone, String(texto));
  if (!envio.ok) {
    return res.status(envio.semCanal ? 400 : 502).json({
      erro: envio.semCanal ? 'Conecte o WhatsApp para responder por aqui' : (envio.erro || 'Não consegui enviar'),
      sem_canal: !!envio.semCanal,
    });
  }

  conversas.registrarEnviada(t, {
    conversaId: c.id, externalId: envio.externalId, texto: String(texto),
    usuarioId: usuarioDaSessao(req),
  });

  res.json({ ok: true });
});

// ------------------------------------------------------------
// GET /placar — o relatório do dono
// ------------------------------------------------------------
// TUDO derivado do que já aconteceu. Nenhum número depende de alguém preencher
// status, que é a doença que mata todo CRM.
router.get('/placar', (req, res) => {
  const t = req.tenantId;
  const dias = Math.min(365, Math.max(1, parseInt(req.query.dias, 10) || 30));
  const desde = `-${dias} days`;

  const porPessoa = db.prepare(`
    SELECT u.id, u.nome,
           -- Contatos: ações da régua que ESTA pessoa enviou.
           (SELECT COUNT(*) FROM crm_acoes a
             WHERE a.tenant_id = u.tenant_id AND a.usuario_id = u.id
               AND a.status = 'enviada' AND date(a.resolvido_em) >= date('now', ?)) AS contatos,
           -- Responderam: a taxa que diz se a mensagem CONVENCE.
           (SELECT COUNT(*) FROM crm_acoes a
             WHERE a.tenant_id = u.tenant_id AND a.usuario_id = u.id
               AND a.respondeu_em IS NOT NULL AND date(a.resolvido_em) >= date('now', ?)) AS responderam,
           -- Prospects que ela trouxe pro funil e os que fecharam.
           (SELECT COUNT(*) FROM conversas c
             WHERE c.tenant_id = u.tenant_id AND c.usuario_id = u.id
               AND date(c.criado_em) >= date('now', ?)) AS prospects,
           (SELECT COUNT(*) FROM conversas c
             WHERE c.tenant_id = u.tenant_id AND c.usuario_id = u.id
               AND c.estagio = 'comprou' AND date(c.ultima_interacao) >= date('now', ?)) AS fecharam,
           -- Conversa parada: a última mensagem é DELA e ninguém voltou. É o custo
           -- escondido de atender rápido sem fechar.
           (SELECT COUNT(*) FROM conversas c
             WHERE c.tenant_id = u.tenant_id AND c.usuario_id = u.id AND c.arquivada = 0
               AND (SELECT direcao FROM mensagens m WHERE m.conversa_id = c.id ORDER BY m.id DESC LIMIT 1) = 'recebida') AS paradas
      FROM usuarios u
     WHERE u.tenant_id = ? AND u.ativo = 1
     ORDER BY u.nome
  `).all(desde, desde, desde, desde, t);

  // VALOR RECUPERADO: vendas de clientes que foram contatadas ANTES da compra,
  // dentro da janela. Não prova causa — algumas voltariam de qualquer jeito — mas
  // prova CONTATO, e é o número honesto pra pagar comissão sobre resultado em vez
  // de sobre volume de mensagem enviada.
  const recuperado = db.prepare(`
    SELECT a.usuario_id, COUNT(DISTINCT v.id) AS vendas, COALESCE(SUM(v.total), 0) AS valor
      FROM crm_acoes a
      JOIN vendas v ON v.cliente_id = a.cliente_id AND v.tenant_id = a.tenant_id
                   AND COALESCE(v.deletado, 0) = 0
                   AND datetime(v.data_hora) > datetime(a.resolvido_em)
                   AND julianday(v.data_hora) - julianday(a.resolvido_em) <= 30
     WHERE a.tenant_id = ? AND a.status = 'enviada' AND a.usuario_id IS NOT NULL
       AND date(a.resolvido_em) >= date('now', ?)
     GROUP BY a.usuario_id
  `).all(t, desde);
  const mapaRec = new Map(recuperado.map((r) => [r.usuario_id, r]));

  const pessoas = porPessoa.map((p) => {
    const rec = mapaRec.get(p.id) || { vendas: 0, valor: 0 };
    return {
      ...p,
      taxa_resposta: p.contatos ? Math.round((p.responderam / p.contatos) * 100) : 0,
      conversao: p.prospects ? Math.round((p.fecharam / p.prospects) * 100) : 0,
      vendas_recuperadas: rec.vendas,
      valor_recuperado: rec.valor,
      ticket: rec.vendas ? +(rec.valor / rec.vendas).toFixed(2) : 0,
    };
  });

  const soma = (campo) => pessoas.reduce((s, p) => s + (p[campo] || 0), 0);
  const loja = {
    contatos: soma('contatos'), responderam: soma('responderam'),
    prospects: soma('prospects'), fecharam: soma('fecharam'),
    paradas: soma('paradas'),
    vendas_recuperadas: soma('vendas_recuperadas'), valor_recuperado: soma('valor_recuperado'),
  };
  loja.taxa_resposta = loja.contatos ? Math.round((loja.responderam / loja.contatos) * 100) : 0;
  loja.conversao = loja.prospects ? Math.round((loja.fecharam / loja.prospects) * 100) : 0;
  loja.ticket = loja.vendas_recuperadas ? +(loja.valor_recuperado / loja.vendas_recuperadas).toFixed(2) : 0;

  // O NÚMERO MAIS HONESTO: contatos que venceram sem resposta. Parece ruim e não é —
  // "mandei 40, 30 ninguém respondeu" corrige o TEXTO, não a pessoa que enviou.
  const semResposta = db.prepare(`
    SELECT a.tipo, COUNT(*) AS enviadas,
           SUM(CASE WHEN a.respondeu_em IS NULL THEN 1 ELSE 0 END) AS sem_resposta
      FROM crm_acoes a
     WHERE a.tenant_id = ? AND a.status = 'enviada' AND date(a.resolvido_em) >= date('now', ?)
     GROUP BY a.tipo
     ORDER BY sem_resposta DESC
  `).all(t, desde);

  res.json({ dias, pessoas, loja, por_tipo: semResposta });
});

// ------------------------------------------------------------
// GET /ficha/:clienteId — a cliente inteira numa tela
// ------------------------------------------------------------
// Os dados dela sempre existiram, espalhados em cinco lugares: compras em
// `vendas`, selos derivados de `clientes.gasto_sem_selo`, cupons em `crm_cupons`,
// pedidos em `vitrine_pedidos` e conversas em `conversas`. Cinco tabelas, nenhuma
// tela que juntasse — e sem isso o comercial abre a conversa sem saber com quem
// está falando.
router.get('/ficha/:id', (req, res) => {
  const t = req.tenantId;
  const id = Number(req.params.id);

  const cliente = db.prepare(`
    SELECT c.*, e.nome AS excursao_nome
      FROM clientes c
      LEFT JOIN excursoes e ON e.id = c.excursao_id AND e.tenant_id = c.tenant_id
     WHERE c.id = ? AND c.tenant_id = ?
  `).get(id, t);
  if (!cliente) return res.status(404).json({ erro: 'Cliente não encontrada' });

  // COALESCE(deletado,0)=0 em toda leitura de venda: venda cancelada já contou no
  // faturamento uma vez neste projeto, em 9 queries diferentes.
  const compras = db.prepare(`
    SELECT id, data_hora, total, forma_pagamento, origem
      FROM vendas
     WHERE cliente_id = ? AND tenant_id = ? AND COALESCE(deletado, 0) = 0
     ORDER BY data_hora DESC LIMIT 20
  `).all(id, t);

  const pedidos = db.prepare(`
    SELECT codigo, status, total, qtd_itens, criado_em, venda_id, despachado_em
      FROM vitrine_pedidos WHERE cliente_id = ? AND tenant_id = ?
     ORDER BY criado_em DESC LIMIT 10
  `).all(id, t);

  const contatos = db.prepare(`
    SELECT tipo, label, status, data, resolvido_em, respondeu_em, cupom
      FROM crm_acoes WHERE cliente_id = ? AND tenant_id = ?
     ORDER BY COALESCE(resolvido_em, data) DESC LIMIT 15
  `).all(id, t);

  let cupons = [];
  try {
    cupons = db.prepare(`
      SELECT codigo, pct, status, validade, usado_em
        FROM crm_cupons WHERE cliente_id = ? AND tenant_id = ?
       ORDER BY id DESC LIMIT 10
    `).all(id, t);
  } catch (_) { /* loja sem o motor de cupom */ }

  const conversa = db.prepare(`
    SELECT id, estagio, ultima_interacao FROM conversas
     WHERE cliente_id = ? AND tenant_id = ? AND arquivada = 0
     ORDER BY ultima_interacao DESC LIMIT 1
  `).get(id, t);

  // Selos e segmento vêm do motor do CRM, não recalculados aqui — duplicar a
  // regra faria a ficha divergir da fila no dia em que uma das duas mudasse.
  let selos = null, segmento = null;
  try {
    const crm = require('../lib/crm');
    if (crm.clubeAtivo(t)) selos = crm.selosDe(t, cliente);
    segmento = crm.rfmDoCliente(cliente, new Date().toISOString().slice(0, 10));
  } catch (_) { /* sem relacionamento no plano */ }

  res.json({ cliente, compras, pedidos, contatos, cupons, conversa, selos, segmento });
});

router.get('/usuarios', (req, res) => {
  res.json(db.prepare(
    "SELECT id, nome, papel FROM usuarios WHERE tenant_id = ? AND ativo = 1 ORDER BY nome"
  ).all(req.tenantId));
});

module.exports = router;
module.exports.ESTAGIOS = ESTAGIOS;
