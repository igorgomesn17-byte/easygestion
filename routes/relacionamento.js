// ============================================================
// RELACIONAMENTO — a regua (quem contatar hoje), os segmentos (RFM),
// o clube de fidelidade e os templates de mensagem.
//
// O gate exigirFeature('relacionamento') e o apenasAdmin ficam no app.use do
// server.js, valendo pro router INTEIRO — nao rota a rota. Rota nova nasce
// protegida sem ninguem precisar lembrar. E' admin porque a tela expoe a base de
// clientes com telefone: nao e' tela de vendedora.
//
// A regua NAO envia nada. Ela monta a fila do dia com a mensagem pronta; o envio
// e' um clique humano no WhatsApp. Automatizar o disparo seria a diferenca entre
// "a loja lembrou de mim" e spam.
// ============================================================
const express = require('express');
const { db, getConfig, setConfig } = require('../db/database');
const {
  segmentarRFM, urlWhatsApp, clubeCfg, clubeAtivo, selosDe, SEGMENTOS, campanhaSegmento, templateDe,
} = require('../lib/crm');
const { ativarCupomDaAcao, cancelarCupomDaAcao, MAX_PCT } = require('../lib/cupons');
const { DEFAULT_TEMPLATES, ROTULOS, VARIAVEIS_DISPONIVEIS } = require('../lib/crm-templates');
const { gerarAcoesDoTenant, hojeLocal } = require('../lib/relacionamento-scheduler');

const router = express.Router();

// ============================================================
// ACOES DO DIA — a fila de contatos
// ============================================================

// GET /acoes — o que contatar hoje.
// Pega tambem as ADIADAS cujo dia chegou, e as pendentes de dias anteriores (o
// scheduler as materializou; nao e' porque a lojista nao abriu a tela ontem que a
// tarefa deixa de existir — era exatamente esse o furo do sistema antigo).
router.get('/acoes', (req, res) => {
  const hoje = hojeLocal();
  const acoes = db.prepare(`
    SELECT a.*, c.nome, c.telefone, c.nao_perturbe,
           c.total_gasto, c.num_compras, c.ultima_compra,
           cp.pct AS cupom_pct, cp.validade AS cupom_validade
    FROM crm_acoes a
    JOIN clientes c ON c.id = a.cliente_id AND c.tenant_id = a.tenant_id
    LEFT JOIN crm_cupons cp ON cp.id = a.cupom_id AND cp.tenant_id = a.tenant_id
    WHERE a.tenant_id = ?
      AND c.arquivado = 0
      AND (
        (a.status = 'pendente' AND a.data <= ?)
        OR (a.status = 'adiada' AND a.adiada_para <= ?)
      )
    ORDER BY a.prioridade ASC, a.data ASC, a.id ASC
  `).all(req.tenantId, hoje, hoje);

  // O cliente pode ter pedido "nao perturbe" DEPOIS que a acao nasceu: respeita agora.
  const visiveis = acoes.filter((a) => !a.nao_perturbe);

  res.json({
    data: hoje,
    total: visiveis.length,
    acoes: visiveis.map((a) => ({
      id: a.id, cliente_id: a.cliente_id, nome: a.nome, telefone: a.telefone,
      tipo: a.tipo, label: a.label, detalhe: a.detalhe, prioridade: a.prioridade,
      mensagem: a.mensagem,
      // O codigo NOMINAL desta cliente (VOLTE20-K3P9). A tela mostra num chip FORA do
      // textarea: se a lojista apagar o codigo do texto sem querer, ela precisa ver
      // que ele existe (e o sistema avisa antes de enviar).
      cupom: a.cupom, cupom_pct: a.cupom_pct, cupom_validade: a.cupom_validade,
      // Contexto de VALOR: a lojista precisa saber com quem esta falando ANTES de
      // apertar enviar. "Gastou R$2.400 em 11 compras" muda o cuidado da conversa —
      // e e' o que justifica o desconto maior que essa cliente esta recebendo.
      total_gasto: a.total_gasto || 0,
      num_compras: a.num_compras || 0,
      ultima_compra: a.ultima_compra,
      segmento: a.segmento,
      segmento_nome: a.segmento && SEGMENTOS[a.segmento] ? SEGMENTOS[a.segmento].nome : null,
      segmento_cor: a.segmento && SEGMENTOS[a.segmento] ? SEGMENTOS[a.segmento].cor : null,
      data: a.data, status: a.status, adiada_para: a.adiada_para,
      wa_url: urlWhatsApp(a.telefone, a.mensagem),
    })),
  });
});

// GET /acoes/contagem — badge do menu
router.get('/acoes/contagem', (req, res) => {
  const hoje = hojeLocal();
  const r = db.prepare(`
    SELECT COUNT(*) AS n FROM crm_acoes a
    JOIN clientes c ON c.id = a.cliente_id AND c.tenant_id = a.tenant_id
    WHERE a.tenant_id = ? AND c.arquivado = 0 AND c.nao_perturbe = 0
      AND ((a.status = 'pendente' AND a.data <= ?) OR (a.status = 'adiada' AND a.adiada_para <= ?))
  `).get(req.tenantId, hoje, hoje);
  res.json({ pendentes: r.n });
});

// Muda o status de uma acao. O `AND tenant_id = ?` no UPDATE e' o que impede uma
// loja de mexer na fila de outra passando um id chutado.
function resolver(req, res, status, adiadaPara = null) {
  const id = parseInt(req.params.id, 10);
  const r = db.prepare(`
    UPDATE crm_acoes SET status = ?, adiada_para = ?, resolvido_em = datetime('now','localtime')
    WHERE id = ? AND tenant_id = ?
  `).run(status, adiadaPara, id, req.tenantId);
  if (r.changes !== 1) return res.status(404).json({ erro: 'Ação não encontrada' });
  res.json({ ok: true, id, status });
}

// A mensagem pode ter sido editada na tela antes do envio — guarda o texto REAL
// que foi mandado, senao o historico mente.
//
// E' AQUI que o cupom passa a valer. Ele nasceu 'rascunho' junto com a acao; so
// agora, que a cliente de fato recebeu o codigo, ele vira 'ativo' — e o relogio da
// validade comeca a correr a partir de HOJE. A mensagem diz "vale ate 20/07", e ela
// leu hoje: contar o prazo do dia em que o servidor gerou a fila seria roubo de dias.
router.post('/acoes/:id/enviada', (req, res) => {
  const id = parseInt(req.params.id, 10);
  const { mensagem } = req.body || {};

  const acao = db.prepare('SELECT tipo FROM crm_acoes WHERE id = ? AND tenant_id = ?').get(id, req.tenantId);
  if (!acao) return res.status(404).json({ erro: 'Ação não encontrada' });

  db.transaction(() => {
    if (mensagem) {
      db.prepare('UPDATE crm_acoes SET mensagem = ? WHERE id = ? AND tenant_id = ?')
        .run(String(mensagem), id, req.tenantId);
    }
    const tpl = templateDe(req.tenantId, acao.tipo);
    ativarCupomDaAcao(req.tenantId, id, (tpl && tpl.cupom_dias) || 7);
  })();

  resolver(req, res, 'enviada');
});

// Adiar NAO mexe no cupom: ele fica rascunho, e a validade so comeca a contar
// quando (e se) a lojista enviar.
router.post('/acoes/:id/adiar', (req, res) => {
  const dias = Math.max(1, Math.min(30, parseInt((req.body || {}).dias, 10) || 1));
  const d = new Date();
  d.setDate(d.getDate() + dias);
  resolver(req, res, 'adiada', d.toISOString().slice(0, 10));
});

// Tirou o contato da lista: o cupom morre junto. Senao ficaria um desconto valendo
// pra uma cliente que nunca recebeu o codigo.
router.post('/acoes/:id/ignorar', (req, res) => {
  const id = parseInt(req.params.id, 10);
  cancelarCupomDaAcao(req.tenantId, id);
  resolver(req, res, 'ignorada');
});

// POST /gerar — forca a geracao do dia pra ESTA loja, sem esperar as 06:00.
// Existe pra tres coisas: testar, recuperar um dia perdido, e disparar campanha de
// lancamento (que e' opcional e nao roda no scheduler).
router.post('/gerar', (req, res) => {
  const data = (req.query.data || req.body?.data || hojeLocal()).slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(data)) return res.status(400).json({ erro: 'Data inválida (use YYYY-MM-DD)' });
  try {
    const novas = gerarAcoesDoTenant(req.tenantId, data);
    res.json({ ok: true, data, novas });
  } catch (e) {
    res.status(500).json({ erro: e.message });
  }
});

// GET /historico — o que ja foi feito (prova pra lojista de que a regua trabalha)
router.get('/historico', (req, res) => {
  const limite = Math.min(200, parseInt(req.query.limite, 10) || 50);
  const itens = db.prepare(`
    SELECT a.id, a.data, a.tipo, a.label, a.status, a.resolvido_em, c.nome
    FROM crm_acoes a
    JOIN clientes c ON c.id = a.cliente_id AND c.tenant_id = a.tenant_id
    WHERE a.tenant_id = ? AND a.status IN ('enviada', 'ignorada')
    ORDER BY a.resolvido_em DESC LIMIT ?
  `).all(req.tenantId, limite);
  res.json({ itens });
});

// ============================================================
// RESULTADOS — "a régua se paga?"
//
// A pergunta que justifica o módulo inteiro. E a resposta tem que ser HONESTA: eu
// mostro quem voltou COM o cupom, não invento contrafactual. Algumas dessas clientes
// talvez voltassem de qualquer jeito — o cupom não prova causa, prova CONTATO.
//
// A linha mais valiosa da tela é a dos EXPIRADOS: "mandei 40, 30 expiraram" é o
// sinal de que a mensagem não funciona. Nenhuma métrica de vaidade esconde isso.
// ============================================================
router.get('/resultados', (req, res) => {
  const hoje = hojeLocal();
  const ate = (req.query.ate || hoje).slice(0, 10);
  const de = (req.query.de || (() => {
    const d = new Date(); d.setDate(d.getDate() - 90);   // 90d = a janela de retenção do scheduler
    return d.toISOString().slice(0, 10);
  })()).slice(0, 10);

  // A base é crm_acoes (o que foi ENVIADO), não crm_cupons — porque nem toda mensagem
  // tem cupom, e "enviei 30 boas-vindas" também é trabalho feito.
  // vendas.deletado = 0: venda cancelada devolve o cupom e sai do faturamento.
  const linhas = db.prepare(`
    SELECT a.tipo,
      COUNT(*)                                                              AS enviadas,
      COUNT(cp.id)                                                          AS cupons,
      SUM(CASE WHEN cp.status = 'usado'                          THEN 1 ELSE 0 END) AS usados,
      SUM(CASE WHEN cp.status = 'ativo' AND cp.validade <  ?     THEN 1 ELSE 0 END) AS expirados,
      SUM(CASE WHEN cp.status = 'ativo' AND cp.validade >= ?     THEN 1 ELSE 0 END) AS em_aberto,
      COALESCE(SUM(CASE WHEN v.deletado = 0 THEN v.total          END), 0) AS faturamento,
      COALESCE(SUM(CASE WHEN v.deletado = 0 THEN cp.valor_desconto END), 0) AS desconto,
      COALESCE(SUM(CASE WHEN v.deletado = 0 THEN v.lucro          END), 0) AS lucro
    FROM crm_acoes a
    LEFT JOIN crm_cupons cp ON cp.id = a.cupom_id AND cp.tenant_id = a.tenant_id
    LEFT JOIN vendas v      ON v.id = cp.venda_id AND v.tenant_id = cp.tenant_id
    WHERE a.tenant_id = ? AND a.status = 'enviada' AND a.data BETWEEN ? AND ?
    GROUP BY a.tipo
    ORDER BY faturamento DESC, enviadas DESC
  `).all(hoje, hoje, req.tenantId, de, ate);

  const itens = linhas.map((l) => ({
    tipo: l.tipo,
    label: (ROTULOS[l.tipo] || {}).label || l.tipo,
    quando: (ROTULOS[l.tipo] || {}).quando || '',
    enviadas: l.enviadas,
    cupons: l.cupons,
    usados: l.usados,
    expirados: l.expirados,
    em_aberto: l.em_aberto,
    taxa_uso: l.cupons > 0 ? +((l.usados / l.cupons) * 100).toFixed(1) : null,
    faturamento: +l.faturamento.toFixed(2),
    desconto: +l.desconto.toFixed(2),
    // O lucro do `vendas` já é líquido de custo, taxa, imposto e comissão — e já vem
    // depois do desconto. É o número mais honesto que existe aqui.
    lucro: +l.lucro.toFixed(2),
  }));

  const soma = (k) => itens.reduce((s, i) => s + (i[k] || 0), 0);
  res.json({
    de, ate,
    total: {
      enviadas: soma('enviadas'), cupons: soma('cupons'), usados: soma('usados'),
      expirados: soma('expirados'), em_aberto: soma('em_aberto'),
      faturamento: +soma('faturamento').toFixed(2),
      desconto: +soma('desconto').toFixed(2),
      lucro: +soma('lucro').toFixed(2),
    },
    itens,
  });
});

// Quem voltou — a lojista quer o NOME, não só o número.
router.get('/resultados/:tipo', (req, res) => {
  const vendas = db.prepare(`
    SELECT v.id, v.data_hora, v.total, cp.codigo, cp.pct, cp.valor_desconto, c.nome AS cliente
    FROM crm_cupons cp
    JOIN vendas v   ON v.id = cp.venda_id AND v.tenant_id = cp.tenant_id
    JOIN clientes c ON c.id = cp.cliente_id AND c.tenant_id = cp.tenant_id
    WHERE cp.tenant_id = ? AND cp.tipo = ? AND cp.status = 'usado' AND v.deletado = 0
    ORDER BY v.data_hora DESC
    LIMIT 100
  `).all(req.tenantId, req.params.tipo);
  res.json({ tipo: req.params.tipo, vendas });
});

// ============================================================
// SEGMENTOS (RFM)
// ============================================================
router.get('/segmentos', (req, res) => {
  const dados = segmentarRFM(req.tenantId, hojeLocal());
  // O resumo basta pra tela de cards; a lista completa vai no endpoint do segmento.
  res.json({ resumo: dados.resumo, total_clientes: dados.total_clientes });
});

router.get('/segmentos/:seg', (req, res) => {
  const seg = req.params.seg;
  if (!SEGMENTOS[seg]) return res.status(404).json({ erro: 'Segmento não existe' });
  const dados = segmentarRFM(req.tenantId, hojeLocal());
  const clientes = dados.clientes
    .filter((c) => c.segmento === seg)
    .sort((a, b) => b.total_gasto - a.total_gasto);
  res.json({ segmento: seg, ...SEGMENTOS[seg], n: clientes.length, clientes });
});

// ============================================================
// CLUBE DE FIDELIDADE
// ============================================================
router.get('/clube', (req, res) => {
  const cfg = clubeCfg(req.tenantId);
  const ativo = getConfig('clube_ativo', '1', req.tenantId) === '1';

  // Quantos vales o clube ja pagou — a lojista precisa ver o custo do programa.
  const vales = db.prepare(`
    SELECT COUNT(*) AS n, COALESCE(SUM(valor), 0) AS total,
           COALESCE(SUM(CASE WHEN ativo = 1 THEN saldo ELSE 0 END), 0) AS em_aberto
    FROM vales WHERE tenant_id = ? AND origem = 'clube'
  `).get(req.tenantId);

  res.json({
    ativo,
    valor_selo: cfg.valorSelo,
    total_selos: cfg.totalSelos,
    valor_premio: cfg.valorPremio,
    validade_dias: cfg.validadeDias,
    min_compra: cfg.minCompra,
    nome: cfg.nome,
    premios_emitidos: vales.n,
    valor_total_premios: +vales.total.toFixed(2),
    valor_em_aberto: +vales.em_aberto.toFixed(2),
  });
});

router.post('/clube', (req, res) => {
  const b = req.body || {};
  const num = (v) => (v === undefined || v === null || v === '' ? null : Number(v));

  const valorSelo = num(b.valor_selo);
  const totalSelos = num(b.total_selos);
  const valorPremio = num(b.valor_premio);

  // valor_selo = 0 faria Math.floor(gasto / 0) = Infinity — premio infinito.
  // A validacao mora aqui porque config invalida gravada e' bomba armada.
  if (valorSelo !== null && !(valorSelo > 0)) return res.status(400).json({ erro: 'O valor de cada selo precisa ser maior que zero.' });
  if (totalSelos !== null && !(Number.isInteger(totalSelos) && totalSelos >= 1)) return res.status(400).json({ erro: 'O cartão precisa ter pelo menos 1 selo.' });
  if (valorPremio !== null && !(valorPremio > 0)) return res.status(400).json({ erro: 'O prêmio precisa valer mais que zero.' });

  const campos = {
    clube_ativo: b.ativo === undefined ? null : (b.ativo ? '1' : '0'),
    clube_nome: b.nome || null,
    clube_valor_selo: valorSelo,
    clube_total_selos: totalSelos,
    clube_valor_premio: valorPremio,
    clube_vale_validade_dias: num(b.validade_dias),
    clube_vale_min_compra: num(b.min_compra),
  };
  for (const [chave, valor] of Object.entries(campos)) {
    if (valor !== null) setConfig(chave, String(valor), req.tenantId);
  }
  res.json({ ok: true });
});

// Progresso do cartao de uma cliente (cupom, ficha da cliente)
router.get('/clube/cliente/:id', (req, res) => {
  const cli = db.prepare('SELECT id, nome, total_gasto, gasto_sem_selo FROM clientes WHERE id = ? AND tenant_id = ?')
    .get(req.params.id, req.tenantId);
  if (!cli) return res.status(404).json({ erro: 'Cliente não encontrada' });

  const s = selosDe(req.tenantId, cli);
  const valesAtivos = db.prepare(`
    SELECT codigo, valor, saldo, validade FROM vales
    WHERE tenant_id = ? AND cliente_id = ? AND origem = 'clube' AND ativo = 1
    ORDER BY id DESC
  `).all(req.tenantId, cli.id);

  res.json({
    cliente: { id: cli.id, nome: cli.nome },
    ativo: s.ativo, selos_no_cartao: s.noCiclo, faltam: s.faltam,
    total_selos: s.totalSelos, valor_selo: s.valorSelo, valor_premio: s.valorPremio,
    premios_ganhos: s.premiosGanhos,
    vales_ativos: valesAtivos,
  });
});

// GET /clube/clientes -> lista de clientes com quantos selos cada um tem, ordenada
// por quem está MAIS PERTO do prêmio (o topo é quem vale a pena cutucar pra voltar).
//
// Os selos são DERIVADOS do gasto (não há tabela de pontos — selosDe faz a conta),
// então calculamos por cliente aqui. Só quem tem pelo menos 1 selo no cartão atual
// entra: quem nunca acumulou não é alvo de "falta pouco pro prêmio".
router.get('/clube/clientes', (req, res) => {
  const cfg = clubeCfg(req.tenantId);
  const clientes = db.prepare(`
    SELECT id, nome, telefone, total_gasto, gasto_sem_selo
    FROM clientes
    WHERE tenant_id = ? AND (arquivado IS NULL OR arquivado = 0)
  `).all(req.tenantId);

  const lista = [];
  for (const c of clientes) {
    const s = selosDe(req.tenantId, c);
    if (s.noCiclo < 1) continue; // sem selo no cartão atual: fora da lista
    lista.push({
      id: c.id,
      nome: c.nome,
      telefone: c.telefone || '',
      no_cartao: s.noCiclo,        // selos no cartão de agora (0..total)
      total_selos: s.totalSelos,   // quantos completam um cartão
      faltam: s.faltam,            // quantos faltam pro prêmio
      premios_ganhos: s.premiosGanhos,
    });
  }

  // Mais perto do prêmio primeiro (menos falta). Empate: quem tem mais selos no cartão.
  lista.sort((a, b) => a.faltam - b.faltam || b.no_cartao - a.no_cartao);

  res.json({
    ativo: clubeAtivo(req.tenantId),
    nome: cfg.nome,
    total_selos: cfg.totalSelos,
    valor_premio: cfg.valorPremio,
    clientes: lista,
  });
});

// ============================================================
// TEMPLATES DE MENSAGEM
// ============================================================

// Devolve os 17 tipos com o texto EFETIVO (override da loja, ou o default do
// codigo) — a tela precisa mostrar o que vai ser enviado de verdade, nao um campo
// vazio quando a loja nunca editou.
router.get('/templates', (req, res) => {
  const overrides = {};
  for (const row of db.prepare('SELECT * FROM crm_templates WHERE tenant_id = ?').all(req.tenantId)) {
    overrides[row.tipo] = row;
  }
  const itens = Object.entries(DEFAULT_TEMPLATES).map(([tipo, base]) => {
    const o = overrides[tipo] || {};
    return {
      tipo,
      label: (ROTULOS[tipo] || {}).label || tipo,
      quando: (ROTULOS[tipo] || {}).quando || '',
      texto: o.texto || base.texto,
      cupom: o.cupom ?? base.cupom ?? null,
      cupom_pct: o.cupom_pct ?? base.cupom_pct ?? null,
      cupom_dias: o.cupom_dias ?? base.cupom_dias ?? null,
      ativo: o.ativo === undefined ? 1 : o.ativo,
      personalizado: !!overrides[tipo],
      tem_cupom: base.cupom !== undefined,
    };
  });
  res.json({ itens, variaveis: VARIAVEIS_DISPONIVEIS });
});

router.put('/templates/:tipo', (req, res) => {
  const tipo = req.params.tipo;
  if (!DEFAULT_TEMPLATES[tipo]) return res.status(404).json({ erro: 'Tipo de mensagem não existe' });

  const b = req.body || {};
  const texto = String(b.texto || '').trim();
  if (!texto) return res.status(400).json({ erro: 'A mensagem não pode ficar vazia.' });

  // O cupom deixou de ser enfeite: ele DESCONTA de verdade no caixa. Config errada
  // gravada aqui vira dinheiro saindo — um cupom_pct de 100 salvo por engano seria a
  // loja dando tudo de graça, e ninguém perceberia até o fim do mês.
  const vazio = (v) => v === undefined || v === null || v === '';
  const prefixo = vazio(b.cupom) ? null : String(b.cupom).toUpperCase().trim();
  const pct = vazio(b.cupom_pct) ? null : Number(b.cupom_pct);
  const dias = vazio(b.cupom_dias) ? null : Number(b.cupom_dias);

  if (prefixo !== null) {
    // O hífen é o separador do sufixo nominal (VOLTE20-K3P9) — não pode vir no prefixo.
    if (!/^[A-Z0-9]{3,12}$/.test(prefixo)) {
      return res.status(400).json({ erro: 'O código do cupom deve ter de 3 a 12 letras/números, sem espaço nem hífen.' });
    }
    if (!(pct > 0)) {
      return res.status(400).json({ erro: 'Informe o desconto do cupom (em %).' });
    }
  }
  if (pct !== null && (!(pct > 0) || pct > MAX_PCT)) {
    return res.status(400).json({ erro: `O desconto precisa ficar entre 1% e ${MAX_PCT}%.` });
  }
  if (dias !== null && (!Number.isInteger(dias) || dias < 1 || dias > 90)) {
    return res.status(400).json({ erro: 'O prazo do cupom precisa ser de 1 a 90 dias.' });
  }

  db.prepare(`
    INSERT INTO crm_templates (tenant_id, tipo, texto, cupom, cupom_pct, cupom_dias, ativo)
    VALUES (?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(tenant_id, tipo) DO UPDATE SET
      texto = excluded.texto, cupom = excluded.cupom,
      cupom_pct = excluded.cupom_pct, cupom_dias = excluded.cupom_dias, ativo = excluded.ativo
  `).run(
    req.tenantId, tipo, texto, prefixo, pct, dias,
    b.ativo === undefined ? 1 : (b.ativo ? 1 : 0)
  );
  res.json({ ok: true, tipo });
});

// DELETE = "voltar ao padrao": apaga o override, e o default do codigo volta a valer.
router.delete('/templates/:tipo', (req, res) => {
  db.prepare('DELETE FROM crm_templates WHERE tenant_id = ? AND tipo = ?').run(req.tenantId, req.params.tipo);
  res.json({ ok: true, tipo: req.params.tipo });
});

module.exports = router;
