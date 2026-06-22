// ============================================================
// API de VENDAS (PDV) - registra venda, baixa estoque, atualiza caixa e cliente
// ============================================================
const express = require('express');
const router = express.Router();
const { db, getConfig } = require('../db/database');
const { resultadoVenda, acrescimoParcelamento, taxaPorForma } = require('../lib/calculos');
const { hojeLocal } = require('../lib/datas');
const { salvarComprovanteBase64 } = require('../lib/comprovantes');

// O vendedor só pode CRIAR venda (POST /). Toda leitura/edição (histórico com
// lucro/custo, detalhe, cancelamento) é exclusiva do admin. Bloqueia aqui dentro
// porque o mount libera 'vendedor' (pro POST funcionar).
router.use((req, res, next) => {
  if (req.session && req.session.papel === 'vendedor') {
    const ehCriarVenda = req.method === 'POST' && (req.path === '/' || req.path === '');
    if (***REMOVED***ehCriarVenda) return res.status(403).json({ erro: 'Sem permissão para esta área' });
  }
  next();
});

// POST /api/vendas  -> registra uma venda completa
// body: {
//   itens: [{ variacao_id, qtd }],
//   forma_pagamento, parcelas, desconto, cliente_id, observacao
// }
router.post('/', (req, res) => {
  const { itens, forma_pagamento, parcelas = 1, desconto = 0, cliente_id = null, vendedor_id = null, observacao = null, origem = 'loja', pagamentos = null, comprovante = null, troco = 0, troco_forma = null, repassar_taxa = true } = req.body;
  if (***REMOVED***Array.isArray(itens) || itens.length === 0) return res.status(400).json({ erro: 'Venda sem itens' });
  // pagamento: aceita split (array `pagamentos`) ou forma unica (compatibilidade).
  const temSplit = Array.isArray(pagamentos) && pagamentos.length > 0;
  if (***REMOVED***temSplit && ***REMOVED***forma_pagamento) return res.status(400).json({ erro: 'Forma de pagamento obrigatoria' });

  // A19: exige caixa do dia aberto pra registrar venda
  const cxHoje = db.prepare('SELECT aberto, fechado FROM caixa_dia WHERE data = ? AND tenant_id = ?').get(hojeLocal(), req.tenantId);
  if (***REMOVED***cxHoje || ***REMOVED***cxHoje.aberto) {
    return res.status(400).json({ erro: 'Abra o caixa do dia antes de vender.' });
  }

  // comissao do vendedor (se houver)
  let comissaoPct = 0;
  if (vendedor_id) {
    const vend = db.prepare('SELECT comissao_pct FROM vendedores WHERE id = ? AND tenant_id = ?').get(vendedor_id, req.tenantId);
    if (vend) comissaoPct = vend.comissao_pct;
  }
  const embalagemUnit = parseFloat(getConfig('embalagem_unit', '1')) || 0;

  // Busca dados de cada item (preco, custo, estoque) e valida disponibilidade
  const getVar = db.prepare(`
    SELECT v.id AS variacao_id, v.quantidade, v.tamanho, v.produto_id,
           p.nome, p.preco_venda, p.custo
    FROM variacoes v JOIN produtos p ON p.id = v.produto_id
    WHERE v.id = ?
  `);

  const linhas = [];
  for (const it of itens) {
    const v = getVar.get(it.variacao_id);
    if (***REMOVED***v) return res.status(400).json({ erro: `Item invalido (id ${it.variacao_id})` });
    const qtd = parseInt(it.qtd, 10) || 1;
    if (v.quantidade < qtd) {
      return res.status(400).json({ erro: `Estoque insuficiente: ${v.nome} tam ${v.tamanho} (tem ${v.quantidade}, pediu ${qtd})` });
    }
    linhas.push({ ...v, qtd, preco_unit: v.preco_venda, custo_unit: v.custo });
  }

  const qtdItens = linhas.reduce((s, l) => s + l.qtd, 0);
  const subtotal = linhas.reduce((s, l) => s + l.preco_unit * l.qtd, 0);
  const desc = parseFloat(desconto) || 0;
  // acrescimo: parcelamento 4x+ repassa a taxa ao cliente (so na forma unica).
  // OPCIONAL: se repassar_taxa=false, a loja absorve (sem acrescimo; a taxa entra no lucro).
  const baseAposDesc = +(subtotal - desc).toFixed(2);
  const acrescimo = (temSplit || repassar_taxa === false) ? 0 : acrescimoParcelamento(baseAposDesc, parcelas);
  const total = +(baseAposDesc + acrescimo).toFixed(2);
  const custoTotal = linhas.reduce((s, l) => s + l.custo_unit * l.qtd, 0);
  const embalagemTotal = +(embalagemUnit * qtdItens).toFixed(2);

  // Monta as partes de pagamento (normaliza forma unica como 1 parte).
  // Cada parte calcula a propria taxa SOBRE O VALOR DELA.
  let partes;
  if (temSplit) {
    partes = pagamentos.map(p => {
      const valor = +(parseFloat(p.valor) || 0).toFixed(2);
      const parc = parseInt(p.parcelas, 10) || 1;
      const taxaPct = taxaPorForma(p.forma, parc);
      const valorTaxa = +(valor * taxaPct / 100).toFixed(2);
      return { forma: p.forma, parcelas: parc, valor, taxaPct, valorTaxa, liquido: +(valor - valorTaxa).toFixed(2) };
    });
    // validacoes do split: formas validas e soma == total
    const formasValidas = ['pix', 'pix_chave', 'dinheiro', 'debito', 'credito_vista', 'credito_parcelado'];
    for (const p of partes) {
      if (***REMOVED***formasValidas.includes(p.forma)) return res.status(400).json({ erro: `Forma de pagamento invalida: ${p.forma}` });
      if (p.valor <= 0) return res.status(400).json({ erro: 'Cada pagamento precisa ter valor maior que zero' });
    }
    const somaPartes = +partes.reduce((s, p) => s + p.valor, 0).toFixed(2);
    if (Math.abs(somaPartes - total) > 0.01) {
      return res.status(400).json({ erro: `A soma dos pagamentos (${somaPartes.toFixed(2)}) nao bate com o total (${total.toFixed(2)})` });
    }
  } else {
    const taxaPct = taxaPorForma(forma_pagamento, parcelas);
    const valorTaxa = +(total * taxaPct / 100).toFixed(2);
    partes = [{ forma: forma_pagamento, parcelas, valor: total, taxaPct, valorTaxa, liquido: +(total - valorTaxa).toFixed(2) }];
  }

  // forma "principal" gravada na venda: a unica forma, ou 'misto' no split
  const formaPrincipal = partes.length === 1 ? partes[0].forma : 'misto';
  const parcelasPrincipal = partes.length === 1 ? partes[0].parcelas : 1;
  // taxa total = soma das taxas das partes; resultado financeiro usa o liquido real
  const valorTaxaTotal = +partes.reduce((s, p) => s + p.valorTaxa, 0).toFixed(2);
  const liquidoTotal = +(total - valorTaxaTotal).toFixed(2);
  const impostoPct = parseFloat(getConfig('imposto_simples', '7.30')) || 0;
  const imposto = +(total * impostoPct / 100).toFixed(2);
  const comissao = +(total * comissaoPct / 100).toFixed(2);
  const lucro = +(liquidoTotal - imposto - comissao - custoTotal - embalagemTotal).toFixed(2);
  const taxaPctEfetiva = total > 0 ? +(valorTaxaTotal / total * 100).toFixed(2) : 0;
  const r = {
    taxaPct: taxaPctEfetiva, valorTaxa: valorTaxaTotal, impostoPct, imposto, comissaoPct, comissao,
    liquido: liquidoTotal, custoTotal: +custoTotal.toFixed(2), embalagemTotal: +embalagemTotal.toFixed(2),
    freteTotal: 0, lucro
  };

  const hoje = hojeLocal();

  // salva o comprovante (se veio) ANTES da transacao — escrita em disco fora do BEGIN/COMMIT
  const comprovantePath = comprovante ? salvarComprovanteBase64(comprovante) : null;

  const tx = db.transaction(() => {
    // 1. grava venda
    const trocoVal = +(parseFloat(troco) || 0).toFixed(2);
    const trocoForma = trocoVal > 0 ? (troco_forma === 'pix' ? 'pix' : 'dinheiro') : null;
    const info = db.prepare(`
      INSERT INTO vendas (tenant_id, cliente_id, vendedor_id, subtotal, desconto, acrescimo, total, forma_pagamento, origem, parcelas,
                          taxa_aplicada, valor_liquido, imposto, comissao_valor, embalagem_total, custo_total, lucro, observacao, comprovante, troco, troco_forma)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(req.tenantId, cliente_id || null, vendedor_id || null, subtotal, desc, acrescimo, total, formaPrincipal, origem || 'loja', parcelasPrincipal,
           r.taxaPct, r.liquido, r.imposto, r.comissao, r.embalagemTotal, r.custoTotal, r.lucro, observacao, comprovantePath, trocoVal, trocoForma);
    const vendaId = info.lastInsertRowid;

    // 1b. grava as formas de pagamento (1 linha por forma; forma unica tambem cai aqui)
    const insPgto = db.prepare(`INSERT INTO venda_pagamentos (venda_id, tenant_id, forma, parcelas, valor, taxa_pct, valor_taxa, valor_liquido)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)`);
    for (const p of partes) {
      insPgto.run(vendaId, req.tenantId, p.forma, p.parcelas, p.valor, p.taxaPct, p.valorTaxa, p.liquido);
    }

    // 2. itens + baixa de estoque + movimento
    const insItem = db.prepare(`INSERT INTO venda_itens (venda_id, tenant_id, variacao_id, produto_id, descricao, qtd, preco_unit, custo_unit)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)`);
    const baixa = db.prepare('UPDATE variacoes SET quantidade = quantidade - ? WHERE id = ?');
    const mov = db.prepare("INSERT INTO movimentos_estoque (variacao_id, tipo, qtd, motivo) VALUES (?, 'saida', ?, ?)");
    for (const l of linhas) {
      insItem.run(vendaId, req.tenantId, l.variacao_id, l.produto_id, `${l.nome} (${l.tamanho})`, l.qtd, l.preco_unit, l.custo_unit);
      baixa.run(l.qtd, l.variacao_id);
      mov.run(l.variacao_id, -l.qtd, `venda #${vendaId}`);
    }

    // 3. atualiza cliente (se informado)
    if (cliente_id) {
      db.prepare(`UPDATE clientes SET total_gasto = total_gasto + ?, num_compras = num_compras + 1, ultima_compra = ?
                  WHERE id = ? AND tenant_id = ?`).run(total, hoje, cliente_id, req.tenantId);
    }

    // 3b. troco devolvido por PIX: a gaveta ficou com a sobra física (cliente pagou em
    // espécie a mais), mas o troco saiu da CONTA via pix. Registra os dois lados pra
    // o fechamento bater: +suprimento dinheiro (sobra real na gaveta) e −sangria pix (conta).
    if (trocoForma === 'pix' && trocoVal > 0) {
      db.prepare(`INSERT INTO caixa_movimentos (data, tenant_id, tipo, valor, forma, motivo) VALUES (?, ?, 'suprimento', ?, 'dinheiro', ?)`)
        .run(hoje, req.tenantId, trocoVal, `Troco da venda #${vendaId} ficou na gaveta (devolvido por Pix)`);
      db.prepare(`INSERT INTO caixa_movimentos (data, tenant_id, tipo, valor, forma, motivo) VALUES (?, ?, 'sangria', ?, 'pix', ?)`)
        .run(hoje, req.tenantId, trocoVal, `Troco da venda #${vendaId} devolvido por Pix`);
      // recalcula sangrias/suprimentos do caixa contando só dinheiro (mesma regra do caixa.js)
      const m = db.prepare(`SELECT
          COALESCE(SUM(CASE WHEN tipo='sangria'    AND forma='dinheiro' THEN valor END),0) AS s,
          COALESCE(SUM(CASE WHEN tipo='suprimento' AND forma='dinheiro' THEN valor END),0) AS u
        FROM caixa_movimentos WHERE data = ? AND tenant_id = ?`).get(hoje, req.tenantId);
      db.prepare('UPDATE caixa_dia SET sangrias = ?, suprimentos = ? WHERE data = ? AND tenant_id = ?')
        .run(+m.s.toFixed(2), +m.u.toFixed(2), hoje, req.tenantId);
    }

    // 4. atualiza caixa do dia
    atualizarCaixaDia(hoje, req.tenantId);

    return vendaId;
  });

  try {
    const vendaId = tx();
    res.status(201).json({ id: vendaId, total, ...r });
  } catch (e) {
    res.status(500).json({ erro: e.message });
  }
});

// Mapeia uma forma de pagamento para o bucket do caixa do dia.
// pix_chave conta como Pix; creditos contam como Credito.
function acumularForma(acc, forma, valor) {
  if (forma === 'pix' || forma === 'pix_chave') acc.pix += valor;
  else if (forma === 'debito') acc.debito += valor;
  else if (forma === 'dinheiro') acc.dinheiro += valor;
  else acc.credito += valor; // credito_vista, credito_parcelado, link_pagamento
}

// Recalcula o caixa do dia a partir das vendas (idempotente)
function atualizarCaixaDia(data, tenantId = 1) {
  const vendas = db.prepare("SELECT * FROM vendas WHERE date(data_hora) = ? AND tenant_id = ?").all(data, tenantId);
  const acc = { pix: 0, debito: 0, credito: 0, dinheiro: 0, bruto: 0, liquido: 0, lucro: 0, n: 0 };
  // soma por forma a partir das partes de pagamento (cobre vendas 'misto' corretamente)
  const partesDe = db.prepare('SELECT forma, valor FROM venda_pagamentos WHERE venda_id = ? AND tenant_id = ?');
  for (const v of vendas) {
    acc.bruto += v.total; acc.liquido += v.valor_liquido; acc.lucro += v.lucro; acc.n++;
    const partes = partesDe.all(v.id, tenantId);
    if (partes.length) {
      for (const p of partes) acumularForma(acc, p.forma, p.valor);
    } else {
      // vendas antigas (antes do split): usa a forma unica da venda
      acumularForma(acc, v.forma_pagamento, v.total);
    }
  }
  db.prepare(`
    INSERT INTO caixa_dia (data, tenant_id, total_pix, total_debito, total_credito, total_dinheiro, total_bruto, total_liquido, lucro_dia, num_vendas)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(data, tenant_id) DO UPDATE SET
      total_pix=excluded.total_pix, total_debito=excluded.total_debito, total_credito=excluded.total_credito,
      total_dinheiro=excluded.total_dinheiro, total_bruto=excluded.total_bruto, total_liquido=excluded.total_liquido,
      lucro_dia=excluded.lucro_dia, num_vendas=excluded.num_vendas
  `).run(data, tenantId, +acc.pix.toFixed(2), +acc.debito.toFixed(2), +acc.credito.toFixed(2), +acc.dinheiro.toFixed(2),
         +acc.bruto.toFixed(2), +acc.liquido.toFixed(2), +acc.lucro.toFixed(2), acc.n);
}

// GET /api/vendas -> lista com filtros (data, de/ate, vendedor, cliente, forma)
router.get('/', (req, res) => {
  const { data, de, ate, vendedor_id, cliente_id, forma, origem } = req.query;
  let sql = `SELECT v.*, c.nome AS cliente_nome, vd.nome AS vendedor_nome
             FROM vendas v
             LEFT JOIN clientes c ON c.id = v.cliente_id
             LEFT JOIN vendedores vd ON vd.id = v.vendedor_id WHERE v.tenant_id = ?`;
  const params = [req.tenantId];
  if (data) { sql += ' AND date(v.data_hora) = ?'; params.push(data); }
  if (de)   { sql += ' AND date(v.data_hora) >= ?'; params.push(de); }
  if (ate)  { sql += ' AND date(v.data_hora) <= ?'; params.push(ate); }
  if (vendedor_id) { sql += ' AND v.vendedor_id = ?'; params.push(vendedor_id); }
  if (cliente_id)  { sql += ' AND v.cliente_id = ?'; params.push(cliente_id); }
  if (forma)       { sql += ' AND v.forma_pagamento = ?'; params.push(forma); }
  if (origem)      { sql += ' AND v.origem = ?'; params.push(origem); }
  sql += ' ORDER BY v.data_hora DESC LIMIT 500';
  const vendas = db.prepare(sql).all(...params);
  // resumo
  const resumo = vendas.reduce((a, v) => ({
    total: a.total + v.total, lucro: a.lucro + v.lucro, comissao: a.comissao + v.comissao_valor, n: a.n + 1
  }), { total: 0, lucro: 0, comissao: 0, n: 0 });
  resumo.total = +resumo.total.toFixed(2);
  resumo.lucro = +resumo.lucro.toFixed(2);
  resumo.comissao = +resumo.comissao.toFixed(2);
  resumo.ticketMedio = resumo.n > 0 ? +(resumo.total / resumo.n).toFixed(2) : 0;
  res.json({ vendas, resumo });
});

// POST /api/vendas/impacto-desconto -> calcula impacto do desconto no lucro (preview no PDV)
router.post('/impacto-desconto', (req, res) => {
  const { subtotal, desconto, custoTotal, forma, parcelas = 1, comissaoPct = 0, embalagemTotal = 0 } = req.body;
  const { impactoDesconto } = require('../lib/calculos');
  res.json(impactoDesconto(parseFloat(subtotal)||0, parseFloat(desconto)||0, parseFloat(custoTotal)||0,
    forma, parseInt(parcelas)||1, parseFloat(comissaoPct)||0, parseFloat(embalagemTotal)||0, 0));
});

// PATCH /api/vendas/:id/vendedor  body: { vendedor_id }
// Troca/define o vendedor de uma venda já feita e RECALCULA a comissão e o lucro
// com o % do novo vendedor (vendedor_id null = remover vendedor, comissão zera).
router.patch('/:id/vendedor', (req, res) => {
  const v = db.prepare('SELECT * FROM vendas WHERE id = ? AND tenant_id = ?').get(req.params.id, req.tenantId);
  if (***REMOVED***v) return res.status(404).json({ erro: 'Venda não encontrada' });
  const vendedorId = req.body.vendedor_id || null;

  let comissaoPct = 0;
  if (vendedorId) {
    const vend = db.prepare('SELECT comissao_pct FROM vendedores WHERE id = ? AND tenant_id = ?').get(vendedorId, req.tenantId);
    if (***REMOVED***vend) return res.status(400).json({ erro: 'Vendedor inválido' });
    comissaoPct = vend.comissao_pct || 0;
  }
  const novaComissao = +(v.total * comissaoPct / 100).toFixed(2);
  // lucro ajustado: devolve a comissão antiga e desconta a nova
  const novoLucro = +(v.lucro + v.comissao_valor - novaComissao).toFixed(2);
  const hoje = v.data_hora.slice(0, 10);
  const tx = db.transaction(() => {
    db.prepare('UPDATE vendas SET vendedor_id = ?, comissao_valor = ?, lucro = ? WHERE id = ? AND tenant_id = ?')
      .run(vendedorId, novaComissao, novoLucro, v.id, req.tenantId);
    atualizarCaixaDia(hoje, req.tenantId); // lucro do dia muda
  });
  tx();
  res.json({ ok: true, comissao_valor: novaComissao, lucro: novoLucro });
});

// GET /api/vendas/:id -> detalhe com itens, cliente e vendedor
router.get('/:id', (req, res) => {
  const v = db.prepare(`SELECT v.*, c.nome AS cliente_nome, c.telefone AS cliente_tel,
                               vd.nome AS vendedor_nome
                        FROM vendas v
                        LEFT JOIN clientes c ON c.id = v.cliente_id
                        LEFT JOIN vendedores vd ON vd.id = v.vendedor_id
                        WHERE v.id = ? AND v.tenant_id = ?`).get(req.params.id, req.tenantId);
  if (***REMOVED***v) return res.status(404).json({ erro: 'Venda nao encontrada' });
  v.itens = db.prepare('SELECT * FROM venda_itens WHERE venda_id = ? AND tenant_id = ?').all(v.id, req.tenantId);
  v.pagamentos = db.prepare('SELECT forma, parcelas, valor FROM venda_pagamentos WHERE venda_id = ? AND tenant_id = ?').all(v.id, req.tenantId);
  res.json(v);
});

// DELETE /api/vendas/:id -> cancela venda (devolve estoque)
router.delete('/:id', (req, res) => {
  const v = db.prepare('SELECT * FROM vendas WHERE id = ? AND tenant_id = ?').get(req.params.id, req.tenantId);
  if (***REMOVED***v) return res.status(404).json({ erro: 'Venda nao encontrada' });
  const itens = db.prepare('SELECT * FROM venda_itens WHERE venda_id = ? AND tenant_id = ?').all(v.id, req.tenantId);
  const hoje = v.data_hora.slice(0, 10);
  const tx = db.transaction(() => {
    for (const it of itens) {
      if (it.variacao_id) {
        db.prepare('UPDATE variacoes SET quantidade = quantidade + ? WHERE id = ?').run(it.qtd, it.variacao_id);
        db.prepare("INSERT INTO movimentos_estoque (variacao_id, tipo, qtd, motivo) VALUES (?, 'entrada', ?, ?)")
          .run(it.variacao_id, it.qtd, `cancelamento venda #${v.id}`);
      }
    }
    if (v.cliente_id) {
      db.prepare('UPDATE clientes SET total_gasto = total_gasto - ?, num_compras = MAX(num_compras - 1, 0) WHERE id = ? AND tenant_id = ?')
        .run(v.total, v.cliente_id, req.tenantId);
    }
    db.prepare('DELETE FROM vendas WHERE id = ? AND tenant_id = ?').run(v.id, req.tenantId);
    atualizarCaixaDia(hoje, req.tenantId);
  });
  tx();
  res.json({ ok: true });
});

module.exports = router;
module.exports.atualizarCaixaDia = atualizarCaixaDia;
