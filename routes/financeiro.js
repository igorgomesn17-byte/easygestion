// ============================================================
// API FINANCEIRO: fluxo de caixa (entradas vs saidas) e DRE
// Cruza VENDAS (entradas) com DESPESAS (saidas).
// ============================================================
const express = require('express');
const router = express.Router();
const { db, getConfig } = require('../db/database');
const { hojeLocal } = require('../lib/datas');
const { exigirPapel } = require('../middleware/seguranca');
const {
  limiteCálculoCustoso,
  cacheRelatorioPorTenant,
  middlewareRelatorioComCache,
  middlewareCurvaAbcComCache,
  invalidarCachesPeriodo,
} = require('../middleware/rate-limit-custoso');

// GET /api/financeiro/fluxo?mes=YYYY-MM -> resumo de entradas/saidas/saldo do mes
router.get('/fluxo', exigirPapel('admin'), (req, res) => {
  const mes = req.query.mes || hojeLocal().slice(0, 7);

  // ENTRADAS: vendas do mes (valor liquido = o que efetivamente cai, ja sem taxa)
  const vendas = db.prepare(`
    SELECT COALESCE(SUM(total),0) AS bruto, COALESCE(SUM(valor_liquido),0) AS liquido, COUNT(*) AS n
    FROM vendas WHERE substr(data_hora,1,7) = ? AND tenant_id = ?
  `).get(mes, req.tenantId);

  // SAIDAS: despesas do mes (competencia)
  const despPagas = db.prepare(`
    SELECT COALESCE(SUM(valor),0) AS v FROM despesas WHERE substr(data_competencia,1,7)=? AND recorrente=0 AND pago=1 AND tenant_id = ?
  `).get(mes, req.tenantId).v;
  const despApagar = db.prepare(`
    SELECT COALESCE(SUM(valor),0) AS v FROM despesas WHERE substr(data_competencia,1,7)=? AND recorrente=0 AND pago=0 AND tenant_id = ?
  `).get(mes, req.tenantId).v;
  const despEmpresa = db.prepare(`
    SELECT COALESCE(SUM(valor),0) AS v FROM despesas WHERE substr(data_competencia,1,7)=? AND recorrente=0 AND centro='empresa' AND tenant_id = ?
  `).get(mes, req.tenantId).v;
  const despPessoal = db.prepare(`
    SELECT COALESCE(SUM(valor),0) AS v FROM despesas WHERE substr(data_competencia,1,7)=? AND recorrente=0 AND centro='pessoal' AND tenant_id = ?
  `).get(mes, req.tenantId).v;

  const totalDespesas = +(despPagas + despApagar).toFixed(2);
  const entradas = +vendas.liquido.toFixed(2);
  const saldo = +(entradas - totalDespesas).toFixed(2);

  // despesas por categoria (pro grafico/lista)
  const porCategoria = db.prepare(`
    SELECT COALESCE(categoria,'sem categoria') AS categoria, SUM(valor) AS valor
    FROM despesas WHERE substr(data_competencia,1,7)=? AND recorrente=0 AND tenant_id = ?
    GROUP BY categoria ORDER BY valor DESC
  `).all(mes, req.tenantId);

  res.json({
    mes,
    entradas: { bruto: +vendas.bruto.toFixed(2), liquido: entradas, num_vendas: vendas.n },
    saidas: { total: totalDespesas, pago: +despPagas.toFixed(2), apagar: +despApagar.toFixed(2),
              empresa: +despEmpresa.toFixed(2), pessoal: +despPessoal.toFixed(2) },
    saldo,
    por_categoria: porCategoria.map(c => ({ ...c, valor: +c.valor.toFixed(2) }))
  });
});

// GET /api/financeiro/dre?mes=YYYY-MM -> Demonstracao de Resultado do mes
router.get('/dre', exigirPapel('admin'), limiteCálculoCustoso, middlewareRelatorioComCache, (req, res) => {
  const mes = req.query.mes || hojeLocal().slice(0, 7);

  // Busca regime fiscal configurado
  const regimeFiscal = getConfig('regime_fiscal', 'simples');

  // dados das vendas do mes
  const v = db.prepare(`
    SELECT COALESCE(SUM(total),0) AS receita_bruta,
           COALESCE(SUM(taxa_aplicada*total/100),0) AS taxas_cartao,
           COALESCE(SUM(comissao_valor),0) AS comissoes,
           COALESCE(SUM(custo_total),0) AS cmv,
           COALESCE(SUM(embalagem_total),0) AS embalagem,
           COUNT(*) AS num_vendas
    FROM vendas WHERE substr(data_hora,1,7) = ? AND tenant_id = ?
  `).get(mes, req.tenantId);

  // trocas do mes (impacto CMVR)
  const t = db.prepare(`
    SELECT COALESCE(SUM(cmvr_bruto),0) AS cmvr_trocas
    FROM trocas WHERE substr(data_hora,1,7) = ? AND tenant_id = ?
  `).get(mes, req.tenantId);

  // Despesas da EMPRESA (operacionais) — só centro='empresa'. Separadas em fixas/variáveis.
  const despFixas = db.prepare(`
    SELECT COALESCE(SUM(valor),0) AS v FROM despesas
    WHERE substr(data_competencia,1,7)=? AND recorrente=0 AND tipo='fixa' AND centro='empresa' AND tenant_id = ?
  `).get(mes, req.tenantId).v;
  const despVar = db.prepare(`
    SELECT COALESCE(SUM(valor),0) AS v FROM despesas
    WHERE substr(data_competencia,1,7)=? AND recorrente=0 AND tipo='variavel' AND centro='empresa' AND tenant_id = ?
  `).get(mes, req.tenantId).v;
  // Pró-labore / retiradas do dono (centro='pessoal') — abatem DEPOIS do operacional
  const proLabore = db.prepare(`
    SELECT COALESCE(SUM(valor),0) AS v FROM despesas
    WHERE substr(data_competencia,1,7)=? AND recorrente=0 AND centro='pessoal' AND tenant_id = ?
  `).get(mes, req.tenantId).v;

  const receitaBruta = +v.receita_bruta.toFixed(2);

  // Calcula imposto conforme regime fiscal
  let impostos = 0;
  if (regimeFiscal === 'mei') {
    // MEI: paga boleto fixo mensal (incluído em despesas como categoria 'mei')
    const meiBoleto = db.prepare(`
      SELECT COALESCE(SUM(valor),0) AS v FROM despesas
      WHERE substr(data_competencia,1,7)=? AND recorrente=0 AND categoria='mei' AND tenant_id = ?
    `).get(mes, req.tenantId).v;
    impostos = +meiBoleto.toFixed(2);
  } else if (regimeFiscal === 'simples') {
    // Simples Nacional: alíquota configurada pelo cliente sobre faturamento
    const impostoTaxa = parseFloat(getConfig('imposto_simples', '0')) || 0;
    impostos = impostoTaxa > 0 ? +(receitaBruta * impostoTaxa / 100).toFixed(2) : 0;
  }

  const receitaLiquida = +(receitaBruta - impostos).toFixed(2);
  const cmv = +(v.cmv + t.cmvr_trocas).toFixed(2); // CMV + impacto de trocas
  const lucroBruto = +(receitaLiquida - cmv).toFixed(2);
  const taxasCartao = +v.taxas_cartao.toFixed(2);
  const comissoes = +v.comissoes.toFixed(2);
  const embalagem = +v.embalagem.toFixed(2);
  const despesasFixas = +despFixas.toFixed(2);
  const despesasVar = +despVar.toFixed(2);
  const proLaboreTotal = +proLabore.toFixed(2);
  // RESULTADO OPERACIONAL = lucro bruto - taxas - comissoes (vendedor) - embalagem - despesas da empresa
  // Inclui COMISSÃO porque é despesa operacional (paga o vendedor por vender)
  const resultadoOperacional = +(lucroBruto - taxasCartao - comissoes - embalagem - despesasFixas - despesasVar).toFixed(2);
  // RESULTADO FINAL = resultado operacional - pró-labore (retiradas do dono, não são operacionais)
  const resultadoFinal = +(resultadoOperacional - proLaboreTotal).toFixed(2);
  const margemOperacional = receitaBruta > 0 ? +((resultadoOperacional / receitaBruta) * 100).toFixed(1) : 0;
  const margemFinal = receitaBruta > 0 ? +((resultadoFinal / receitaBruta) * 100).toFixed(1) : 0;

  const resultado = {
    mes, num_vendas: v.num_vendas,
    receita_bruta: receitaBruta,
    impostos,
    receita_liquida: receitaLiquida,
    cmv,
    lucro_bruto: lucroBruto,
    taxas_cartao: taxasCartao,
    comissoes,
    embalagem,
    despesas_fixas: despesasFixas,
    despesas_variaveis: despesasVar,
    // resultado operacional (lucro da loja operando = antes de retiradas do dono)
    resultado_operacional: resultadoOperacional,
    margem_operacional: margemOperacional,
    // retiradas do dono (pró-labore) e resultado final (lucro de verdade)
    pro_labore: proLaboreTotal,
    resultado_final: resultadoFinal,
    margem_final: margemFinal,
    // compat: 'resultado' continua = operacional (telas antigas não quebram)
    resultado: resultadoOperacional,
    margem_liquida: margemOperacional
  };

  // Cachear o resultado (TTL 5 min)
  const cacheKey = `dre:${mes}`;
  cacheRelatorioPorTenant.set(req.tenantId, cacheKey, resultado);

  res.json(resultado);
});

// GET /api/financeiro/curva-abc?de=YYYY-MM-DD&ate=YYYY-MM-DD
// Classifica produtos por faturamento: A (ate 80% do acumulado), B (80-95%), C (95-100%)
router.get('/curva-abc', limiteCálculoCustoso, middlewareCurvaAbcComCache, (req, res) => {
  const { de, ate } = req.query;
  let sql = `
    SELECT vi.produto_id, COALESCE(p.nome,'(produto removido)') AS nome, p.codigo, p.categoria,
           SUM(vi.qtd) AS qtd, SUM(vi.preco_unit*vi.qtd) AS faturamento,
           SUM(vi.custo_unit*vi.qtd) AS custo
    FROM venda_itens vi
    JOIN vendas v ON v.id = vi.venda_id AND v.tenant_id = vi.tenant_id
    LEFT JOIN produtos p ON p.id = vi.produto_id
    WHERE v.tenant_id = ?`;
  const params = [req.tenantId];
  if (de)  { sql += ' AND date(v.data_hora) >= ?'; params.push(de); }
  if (ate) { sql += ' AND date(v.data_hora) <= ?'; params.push(ate); }
  sql += ' GROUP BY vi.produto_id ORDER BY faturamento DESC';
  const rows = db.prepare(sql).all(...params);

  const totalFat = rows.reduce((s, r) => s + r.faturamento, 0);
  let acumulado = 0;
  const itens = rows.map(r => {
    acumulado += r.faturamento;
    const pctAcum = totalFat > 0 ? (acumulado / totalFat) * 100 : 0;
    const pctItem = totalFat > 0 ? (r.faturamento / totalFat) * 100 : 0;
    let classe = 'C';
    if (pctAcum <= 80) classe = 'A';
    else if (pctAcum <= 95) classe = 'B';
    return {
      produto_id: r.produto_id, nome: r.nome, codigo: r.codigo, categoria: r.categoria,
      qtd: r.qtd, faturamento: +r.faturamento.toFixed(2),
      lucro: +(r.faturamento - r.custo).toFixed(2),
      pct_item: +pctItem.toFixed(1), pct_acumulado: +pctAcum.toFixed(1), classe
    };
  });

  const resumo = { A:{n:0,fat:0}, B:{n:0,fat:0}, C:{n:0,fat:0} };
  for (const it of itens) { resumo[it.classe].n++; resumo[it.classe].fat += it.faturamento; }
  for (const k of ['A','B','C']) resumo[k].fat = +resumo[k].fat.toFixed(2);

  const resultado = { total_faturamento: +totalFat.toFixed(2), itens, resumo };

  // Cachear resultado (usar de/ate já declarados acima)
  const dePadrao = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
  const atePadrao = new Date().toISOString().slice(0, 10);
  const cacheKey = `curva-abc:${de || dePadrao}:${ate || atePadrao}`;
  cacheRelatorioPorTenant.set(req.tenantId, cacheKey, resultado);

  res.json(resultado);
});

// GET /api/financeiro/por-canal?de&ate -> faturamento por origem da venda
router.get('/por-canal', (req, res) => {
  const { de, ate } = req.query;
  let sql = `SELECT COALESCE(origem,'loja') AS canal, COUNT(*) AS n,
                    SUM(total) AS faturamento, SUM(lucro) AS lucro
             FROM vendas WHERE tenant_id = ?`;
  const params = [req.tenantId];
  if (de)  { sql += ' AND date(data_hora) >= ?'; params.push(de); }
  if (ate) { sql += ' AND date(data_hora) <= ?'; params.push(ate); }
  sql += ' GROUP BY canal ORDER BY faturamento DESC';
  const rows = db.prepare(sql).all(...params).map(r => ({
    canal: r.canal, n: r.n, faturamento: +r.faturamento.toFixed(2), lucro: +r.lucro.toFixed(2)
  }));
  res.json(rows);
});

// GET /api/financeiro/por-colecao?de&ate -> faturamento e lucro por coleção (via itens vendidos)
router.get('/por-colecao', (req, res) => {
  const { de, ate } = req.query;
  let sql = `
    SELECT COALESCE(p.colecao,'(sem coleção)') AS colecao,
           SUM(vi.qtd) AS pecas,
           SUM(vi.qtd * vi.preco_unit) AS faturamento,
           SUM(vi.qtd * (vi.preco_unit - COALESCE(p.custo,0))) AS lucro_bruto
    FROM venda_itens vi
    JOIN vendas v ON v.id = vi.venda_id AND v.tenant_id = vi.tenant_id
    LEFT JOIN produtos p ON p.id = vi.produto_id
    WHERE v.tenant_id = ?`;
  const params = [req.tenantId];
  if (de)  { sql += ' AND date(v.data_hora) >= ?'; params.push(de); }
  if (ate) { sql += ' AND date(v.data_hora) <= ?'; params.push(ate); }
  sql += ' GROUP BY colecao ORDER BY faturamento DESC';
  const rows = db.prepare(sql).all(...params).map(r => ({
    colecao: r.colecao, pecas: r.pecas,
    faturamento: +(r.faturamento || 0).toFixed(2),
    lucro_bruto: +(r.lucro_bruto || 0).toFixed(2),
  }));
  res.json(rows);
});

// GET /api/financeiro/por-vendedor?de&ate -> vendas, lucro e comissão por vendedor
router.get('/por-vendedor', (req, res) => {
  const { de, ate } = req.query;
  let sql = `
    SELECT v.vendedor_id, COALESCE(vd.nome,'(sem vendedor)') AS vendedor, vd.comissao_pct,
           COUNT(*) AS n,
           SUM(v.total) AS faturamento,
           SUM(v.lucro) AS lucro,
           SUM(v.comissao_valor) AS comissao
    FROM vendas v LEFT JOIN vendedores vd ON vd.id = v.vendedor_id AND vd.tenant_id = v.tenant_id
    WHERE v.tenant_id = ?`;
  const params = [req.tenantId];
  if (de)  { sql += ' AND date(v.data_hora) >= ?'; params.push(de); }
  if (ate) { sql += ' AND date(v.data_hora) <= ?'; params.push(ate); }
  sql += ' GROUP BY v.vendedor_id ORDER BY faturamento DESC';
  const rows = db.prepare(sql).all(...params).map(r => ({
    vendedor_id: r.vendedor_id, vendedor: r.vendedor, comissao_pct: r.comissao_pct,
    n: r.n,
    faturamento: +(r.faturamento || 0).toFixed(2),
    lucro: +(r.lucro || 0).toFixed(2),
    comissao: +(r.comissao || 0).toFixed(2),
    ticket_medio: r.n > 0 ? +((r.faturamento || 0) / r.n).toFixed(2) : 0,
  }));
  const total = rows.reduce((a, r) => ({
    faturamento: a.faturamento + r.faturamento, lucro: a.lucro + r.lucro, comissao: a.comissao + r.comissao, n: a.n + r.n
  }), { faturamento: 0, lucro: 0, comissao: 0, n: 0 });
  for (const k of ['faturamento','lucro','comissao']) total[k] = +total[k].toFixed(2);
  res.json({ vendedores: rows, total });
});

// GET /api/financeiro/conciliacao?data=YYYY-MM-DD -> conferência da CONTA bancária no dia
// Mostra: saldo informado + o que entrou/saiu pela conta = esperado, pra bater com o banco.
router.get('/conciliacao', exigirPapel('admin'), (req, res) => {
  const data = req.query.data || hojeLocal();
  const cx = db.prepare('SELECT saldo_conta_inicial, conta_conferida FROM caixa_dia WHERE data = ? AND tenant_id = ?').get(data, req.tenantId) || {};

  // vendas que caem na conta: pix cai na hora; cartão (débito/crédito) é "a receber"
  const vendasConta = db.prepare(`
    SELECT
      COALESCE(SUM(CASE WHEN forma_pagamento IN ('pix','pix_chave') THEN total END),0) AS pix,
      COALESCE(SUM(CASE WHEN forma_pagamento IN ('debito','credito_vista','credito_parcelado') THEN total END),0) AS cartao
    FROM vendas WHERE date(data_hora) = ? AND tenant_id = ?
  `).get(data, req.tenantId);
  // pagamentos divididos (venda 'misto'): soma por forma a partir de venda_pagamentos
  const splitConta = db.prepare(`
    SELECT
      COALESCE(SUM(CASE WHEN vp.forma IN ('pix','pix_chave') THEN vp.valor END),0) AS pix,
      COALESCE(SUM(CASE WHEN vp.forma IN ('debito','credito_vista','credito_parcelado') THEN vp.valor END),0) AS cartao
    FROM venda_pagamentos vp JOIN vendas v ON v.id = vp.venda_id AND v.tenant_id = vp.tenant_id
    WHERE date(v.data_hora) = ? AND v.forma_pagamento = 'misto' AND v.tenant_id = ?
  `).get(data, req.tenantId);
  const pixDia = +(vendasConta.pix + splitConta.pix).toFixed(2);
  const cartaoReceber = +(vendasConta.cartao + splitConta.cartao).toFixed(2);

  // movimentos do caixa que passaram pela CONTA (não-dinheiro): saídas e entradas
  const movs = db.prepare(`
    SELECT id, tipo, forma, valor, motivo, criado_em FROM caixa_movimentos
    WHERE data = ? AND tenant_id = ? AND forma <> 'dinheiro' ORDER BY criado_em
  `).all(data, req.tenantId);
  const saidasConta = +movs.filter(m => m.tipo === 'sangria').reduce((s, m) => s + m.valor, 0).toFixed(2);
  const entradasConta = +movs.filter(m => m.tipo === 'suprimento').reduce((s, m) => s + m.valor, 0).toFixed(2);

  const saldoIni = cx.saldo_conta_inicial;
  const temSaldo = saldoIni !== null && saldoIni !== undefined;
  const esperado = temSaldo
    ? +((saldoIni || 0) + pixDia + entradasConta - saidasConta).toFixed(2)
    : null;
  const conferido = cx.conta_conferida;
  const diferenca = (temSaldo && conferido != null) ? +(conferido - esperado).toFixed(2) : null;

  res.json({
    data,
    saldo_conta_inicial: temSaldo ? saldoIni : null,
    pix_dia: pixDia,
    cartao_receber: cartaoReceber,
    entradas_conta: entradasConta,
    saidas_conta: saidasConta,
    esperado,
    conferido,
    diferenca,
    movimentos: movs,
  });
});

// POST /api/financeiro/conciliacao  body: { data?, saldo_inicial?, conferido? }
// Salva o saldo inicial da conta e/ou o valor conferido no banco.
router.post('/conciliacao', exigirPapel('admin'), (req, res) => {
  const data = req.body.data || hojeLocal();
  db.prepare('INSERT OR IGNORE INTO caixa_dia (data, tenant_id) VALUES (?, ?)').run(data, req.tenantId);
  if ('saldo_inicial' in req.body) {
    const s = req.body.saldo_inicial === '' || req.body.saldo_inicial == null ? null : parseFloat(req.body.saldo_inicial);
    db.prepare('UPDATE caixa_dia SET saldo_conta_inicial = ? WHERE data = ? AND tenant_id = ?').run(s, data, req.tenantId);
  }
  if ('conferido' in req.body) {
    const c = req.body.conferido === '' || req.body.conferido == null ? null : parseFloat(req.body.conferido);
    db.prepare('UPDATE caixa_dia SET conta_conferida = ? WHERE data = ? AND tenant_id = ?').run(c, data, req.tenantId);
  }
  res.json({ ok: true });
});

// GET /api/financeiro/fluxo-caixa?mes=YYYY-MM -> Fluxo de caixa real (regime de caixa)
// Mostra quando o dinheiro realmente entra e sai (considerando prazos de cartão)
router.get('/fluxo-caixa', exigirPapel('admin'), (req, res) => {
  try {
    const mes = req.query.mes || hojeLocal().slice(0, 7);
    console.log('fluxo-caixa mes:', mes);
    const [ano, mesNum] = mes.split('-');
    console.log('ano:', ano, 'mesNum:', mesNum);

    // Lê prazos configurados (usa valores do config, não hardcoded)
    const prazoDeb = parseInt(getConfig('prazo_debito_dias', '1')) || 1;
    const tipoDebito = getConfig('prazo_debito_tipo', 'uteis');
    const prazoCredVista = parseInt(getConfig('prazo_credito_vista_dias', '1')) || 1;
    const tipoCredVista = getConfig('prazo_credito_vista_tipo', 'uteis');
    const prazoCredParc = parseInt(getConfig('prazo_credito_parc_dias', '1')) || 1;
    const tipoCredParc = getConfig('prazo_credito_parc_tipo', 'uteis');

    // Helper: soma dias úteis (seg-sex, ignorando finais de semana)
    function adicionarDiasUteis(dataStr, dias) {
      if (!dataStr || dataStr.length < 10) throw new Error('Data inválida: ' + dataStr);
      // Parse como data local (não UTC) para calcular o dia da semana correto
      const [ano, mes, dia] = dataStr.split('-');
      let d = new Date(parseInt(ano), parseInt(mes) - 1, parseInt(dia));
      let count = 0;
      const nomesDia = ['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sab'];
      console.log(`[adicionarDiasUteis] Entrada: ${dataStr} (${nomesDia[d.getDay()]}), +${dias} dias úteis`);
      while (count < dias) {
        d.setDate(d.getDate() + 1);
        console.log(`  -> ${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')} (${nomesDia[d.getDay()]}) getDay=${d.getDay()}`);
        if (d.getDay() >= 1 && d.getDay() <= 5) count++;
      }
      const y = d.getFullYear();
      const m = String(d.getMonth() + 1).padStart(2, '0');
      const day = String(d.getDate()).padStart(2, '0');
      console.log(`[adicionarDiasUteis] Saída: ${y}-${m}-${day}\n`);
      return `${y}-${m}-${day}`;
    }

    // Helper: soma dias corridos (seg-dom, incluindo finais de semana)
    function adicionarDiasCorretos(dataStr, dias) {
      if (!dataStr || dataStr.length < 10) throw new Error('Data inválida: ' + dataStr);
      // Parse como data local
      const [ano, mes, dia] = dataStr.split('-');
      let d = new Date(parseInt(ano), parseInt(mes) - 1, parseInt(dia));
      d.setDate(d.getDate() + dias);
      const y = d.getFullYear();
      const m = String(d.getMonth() + 1).padStart(2, '0');
      const day = String(d.getDate()).padStart(2, '0');
      return `${y}-${m}-${day}`;
    }

  // Usa dados já processados do caixa_dia (garante consistência com Caixa do dia)
  // O caixa_dia agrupa por DATA DA VENDA. Para prazos, recalcula a distribuição por data de recebimento.
  const caixaDias = db.prepare(`
    SELECT data, total_pix, total_dinheiro, total_debito, total_credito, total_vale
    FROM caixa_dia
    WHERE substr(data,1,7) = ? AND tenant_id = ?
    ORDER BY data ASC
  `).all(mes, req.tenantId);

  const recebimentos = {}; // data -> { pix_dinheiro: X, debito: X, credito_vista: X, credito_parc: [] }
  const aReceber = { credito_parcelado: 0, debito: 0, credito_vista: 0 }; // totais ainda não recebidos

  // Para cada dia de vendas, distribui nos dias de recebimento
  for (const cd of caixaDias) {
    const dataDaVenda = cd.data;

    // Pix e dinheiro HOJE (sem prazo, recebimento imediato)
    const pix_dinheiro = (cd.total_pix || 0) + (cd.total_dinheiro || 0);
    if (pix_dinheiro > 0) {
      recebimentos[dataDaVenda] = recebimentos[dataDaVenda] || { pix_dinheiro: 0, debito: 0, credito_vista: 0, credito_parc: [] };
      recebimentos[dataDaVenda].pix_dinheiro += pix_dinheiro;
    }

    // Vale HOJE (recebimento imediato, mas separado de pix/dinheiro na tabela)
    // Por enquanto vai em pix_dinheiro na "linha do tempo" porque não tem coluna específica
    if (cd.total_vale > 0) {
      recebimentos[dataDaVenda] = recebimentos[dataDaVenda] || { pix_dinheiro: 0, debito: 0, credito_vista: 0, credito_parc: [] };
      recebimentos[dataDaVenda].pix_dinheiro += cd.total_vale;
    }

    // Débito: aplica prazo (próximo dia útil)
    if (cd.total_debito > 0) {
      console.log(`[FLUXO] Dia ${dataDaVenda}: total_debito=${cd.total_debito}, tipo=${tipoDebito}, prazo=${prazoDeb}`);
      const dataRecebDebito = tipoDebito === 'uteis'
        ? adicionarDiasUteis(dataDaVenda, prazoDeb)
        : adicionarDiasCorretos(dataDaVenda, prazoDeb);
      console.log(`[FLUXO] Débito vai para: ${dataRecebDebito}`);
      recebimentos[dataRecebDebito] = recebimentos[dataRecebDebito] || { pix_dinheiro: 0, debito: 0, credito_vista: 0, credito_parc: [] };
      recebimentos[dataRecebDebito].debito += cd.total_debito;
    }

    // Crédito (combinado vista+parcelado no caixa_dia): aplica prazo (próximo dia útil)
    if (cd.total_credito > 0) {
      console.log(`[FLUXO] Dia ${dataDaVenda}: total_credito=${cd.total_credito}, tipo=${tipoCredVista}, prazo=${prazoCredVista}`);
      const dataRecebCredito = tipoCredVista === 'uteis'
        ? adicionarDiasUteis(dataDaVenda, prazoCredVista)
        : adicionarDiasCorretos(dataDaVenda, prazoCredVista);
      console.log(`[FLUXO] Crédito vai para: ${dataRecebCredito}`);
      recebimentos[dataRecebCredito] = recebimentos[dataRecebCredito] || { pix_dinheiro: 0, debito: 0, credito_vista: 0, credito_parc: [] };
      recebimentos[dataRecebCredito].credito_vista += cd.total_credito;
    }
  }

  // Despesas pagas no mês (regime de caixa = data_pagamento, não data_competencia)
  const despesas = db.prepare(`
    SELECT data_pagamento, valor, categoria FROM despesas
    WHERE substr(data_pagamento,1,7) = ? AND recorrente = 0 AND pago = 1 AND tenant_id = ?
    ORDER BY data_pagamento ASC
  `).all(mes, req.tenantId);

  const saidas = {}; // data -> valor total
  for (const d of despesas) {
    saidas[d.data_pagamento] = (saidas[d.data_pagamento] || 0) + d.valor;
  }

  // Monta linha do tempo: 1º ao último dia do mês
  const anoNum = parseInt(ano);
  const mesNumInt = parseInt(mesNum);
  const diasMes = new Date(anoNum, mesNumInt, 0).getDate(); // dia 0 do próximo mês = último dia deste mês
  const linhaDoTempo = [];
  let saldoAcumulado = 0;

  for (let dia = 1; dia <= diasMes; dia++) {
    const dataPad = `${ano}-${String(mesNum).padStart(2,'0')}-${String(dia).padStart(2,'0')}`;
    const entrada = recebimentos[dataPad] || { pix_dinheiro: 0, debito: 0, credito_vista: 0, credito_parc: [] };
    const totalEntrada = entrada.pix_dinheiro + entrada.debito + entrada.credito_vista +
      (entrada.credito_parc || []).reduce((s, p) => s + p.valor, 0);
    const totalSaida = saidas[dataPad] || 0;

    saldoAcumulado += totalEntrada - totalSaida;

    // Só inclui dias com movimento
    if (totalEntrada > 0 || totalSaida > 0) {
      linhaDoTempo.push({
        data: dataPad,
        entradas: +totalEntrada.toFixed(2),
        saidas: +totalSaida.toFixed(2),
        saldo_acumulado: +saldoAcumulado.toFixed(2),
        detalhes: {
          pix_dinheiro: +entrada.pix_dinheiro.toFixed(2),
          debito: +entrada.debito.toFixed(2),
          credito_vista: +entrada.credito_vista.toFixed(2),
          credito_parcelado: +(entrada.credito_parc || []).reduce((s,p)=>s+p.valor, 0).toFixed(2)
        }
      });
    }
  }

  // Calcula totais
  const totalRecebido = Object.values(recebimentos).reduce((s, r) =>
    s + r.pix_dinheiro + r.debito + r.credito_vista + (r.credito_parc || []).reduce((x,p)=>x+p.valor,0), 0);
  const totalPago = Object.values(saidas).reduce((s, v) => s + v, 0);
  const saldoMes = totalRecebido - totalPago;

  res.json({
    mes,
    prazos: {
      debito_dias: prazoDeb, debito_tipo: tipoDebito,
      credito_vista_dias: prazoCredVista, credito_vista_tipo: tipoCredVista,
      credito_parc_dias: prazoCredParc, credito_parc_tipo: tipoCredParc
    },
    resumo: {
      recebido: +totalRecebido.toFixed(2),
      aReceber: {
        debito: +aReceber.debito.toFixed(2),
        credito_vista: +aReceber.credito_vista.toFixed(2),
        credito_parcelado: +aReceber.credito_parcelado.toFixed(2)
      },
      pago: +totalPago.toFixed(2),
      saldo: +saldoMes.toFixed(2)
    },
    linha_do_tempo: linhaDoTempo
  });
  } catch (e) {
    console.error('Erro em fluxo-caixa:', e.message, e.stack);
    res.status(500).json({ erro: 'Erro ao carregar fluxo de caixa: ' + e.message });
  }
});

module.exports = router;
