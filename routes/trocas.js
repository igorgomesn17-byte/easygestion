// ============================================================
// API de TROCAS / DEVOLUCOES
// Devolve pecas ao estoque, baixa as levadas, calcula a diferenca.
// A diferenca em DINHEIRO ajusta o caixa do dia (suprimento/sangria).
// ============================================================
const express = require('express');
const router = express.Router();
const { db, getConfig } = require('../db/database');

// Helper: calcula dias úteis entre duas datas (seg-sáb)
function diasUteisEntre(dataDe, dataAte) {
  const de = new Date(dataDe + 'T00:00:00');
  const ate = new Date(dataAte + 'T00:00:00');
  let dias = 0;
  let d = new Date(de);
  while (d <= ate) {
    const dow = d.getDay();
    if (dow >= 1 && dow <= 5) dias++; // seg-sex
    d.setDate(d.getDate() + 1);
  }
  return dias - 1; // não conta o dia 0
}

// Helper: hoje local em YYYY-MM-DD
function hojeLocal() {
  const d = new Date();
  return d.toISOString().split('T')[0];
}

// Helper: gerar código único de vale VALE-XXXXXX
function gerarCodigoVale() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // sem I,O,0,1 (confusão)
  let codigo = '';
  for (let i = 0; i < 6; i++) {
    codigo += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return 'VALE-' + codigo;
}

// Helper: calcular validade (30 dias por padrão)
function calcularValidade() {
  const d = new Date();
  d.setDate(d.getDate() + 30);
  return d.toISOString().slice(0, 10);
}


// GET /api/trocas -> lista (com filtros de data opcionais)
router.get('/', (req, res) => {
  const { de, ate } = req.query;
  let sql = `SELECT t.*, v.id AS venda_num FROM trocas t LEFT JOIN vendas v ON v.id = t.venda_id AND v.tenant_id = t.tenant_id WHERE t.tenant_id = ?`;
  const params = [req.tenantId];
  if (de)  { sql += ' AND date(t.data_hora) >= ?'; params.push(de); }
  if (ate) { sql += ' AND date(t.data_hora) <= ?'; params.push(ate); }
  sql += ' ORDER BY t.data_hora DESC LIMIT 300';
  res.json(db.prepare(sql).all(...params));
});

// GET /api/trocas/prazo/:vendaId -> diz se a venda ainda está no prazo de troca
router.get('/prazo/:vendaId', (req, res) => {
  const venda = db.prepare('SELECT id, data_hora FROM vendas WHERE id = ? AND tenant_id = ?').get(req.params.vendaId, req.tenantId);
  if (!venda) return res.status(404).json({ erro: 'Venda não encontrada' });
  const prazo = 7; // prazo fixo: 7 dias úteis
  const dias = diasUteisEntre(venda.data_hora.slice(0, 10), hojeLocal());
  res.json({ dias_passados: dias, prazo, dentro_prazo: dias <= prazo });
});

// GET /api/trocas/:id -> detalhe com itens
router.get('/:id', (req, res) => {
  const t = db.prepare('SELECT * FROM trocas WHERE id = ? AND tenant_id = ?').get(req.params.id, req.tenantId);
  if (!t) return res.status(404).json({ erro: 'Troca não encontrada' });
  const itens = db.prepare('SELECT * FROM troca_itens WHERE troca_id = ? AND tenant_id = ?').all(t.id, req.tenantId);
  t.itens = itens;

  // Buscar código do vale se houver
  if (t.diferenca < 0) {
    const vale = db.prepare('SELECT codigo FROM vales WHERE troca_id = ? AND tenant_id = ? LIMIT 1').get(t.id, req.tenantId);
    if (vale) {
      t.vale_codigo = vale.codigo;
    }
  }

  res.json(t);
});

// PATCH /api/trocas/:id/cancelar -> cancela uma troca (reverte estoque e caixa)
router.patch('/:id/cancelar', (req, res) => {
  const troca = db.prepare('SELECT * FROM trocas WHERE id = ? AND tenant_id = ?').get(req.params.id, req.tenantId);
  if (!troca) return res.status(404).json({ erro: 'Troca não encontrada' });
  if (troca.cancelada) return res.status(400).json({ erro: 'Troca já foi cancelada' });

  const tx = db.transaction(() => {
    const itens = db.prepare('SELECT * FROM troca_itens WHERE troca_id = ? AND tenant_id = ?').all(troca.id, req.tenantId);
    const baixa = db.prepare('UPDATE variacoes SET quantidade = quantidade - ? WHERE id = ?');
    const sobe = db.prepare('UPDATE variacoes SET quantidade = quantidade + ? WHERE id = ?');
    const mov = db.prepare('INSERT INTO movimentos_estoque (variacao_id, tipo, qtd, motivo) VALUES (?, ?, ?, ?)');

    // reverte: devolução são "saidas" (baixa), levação são "entradas" (sobe)
    for (const it of itens) {
      if (it.tipo === 'devolvido' && it.variacao_id) {
        baixa.run(it.qtd, it.variacao_id);
        mov.run(it.variacao_id, 'saida', -it.qtd, `cancelamento troca #${troca.id} (devolução revertida)`);
      } else if (it.tipo === 'levado' && it.variacao_id) {
        sobe.run(it.qtd, it.variacao_id);
        mov.run(it.variacao_id, 'entrada', it.qtd, `cancelamento troca #${troca.id} (levação revertida)`);
      }
    }

    // reverte ajuste de caixa
    const dataTroca = (troca.data_troca || troca.data_hora || '').split('T')[0];
    if (dataTroca && troca.diferenca > 0 && troca.forma_pagamento_diferenca === 'dinheiro') {
      db.prepare('UPDATE caixa_dia SET suprimentos = suprimentos - ? WHERE data = ? AND tenant_id = ?')
        .run(troca.diferenca, dataTroca, req.tenantId);
    } else if (dataTroca && troca.diferenca < 0) {
      const aFavor = Math.abs(troca.diferenca);
      if (troca.forma_pagamento_diferenca === 'dinheiro') {
        db.prepare('UPDATE caixa_dia SET sangrias = sangrias - ? WHERE data = ? AND tenant_id = ?')
          .run(aFavor, dataTroca, req.tenantId);
      }
    }

    // marca como cancelada
    db.prepare('UPDATE trocas SET cancelada = 1 WHERE id = ? AND tenant_id = ?').run(troca.id, req.tenantId);
  });

  try {
    tx();
    res.json({ ok: true, mensagem: 'Troca cancelada e estoque/caixa revertidos' });
  } catch (e) {
    res.status(500).json({ erro: e.message });
  }
});

// POST /api/trocas
// body: {
//   venda_id,
//   devolvidos: [{ variacao_id, qtd, valor_unit, descricao }],
//   levados:    [{ variacao_id, qtd }],
//   forma_pagamento: 'dinheiro'|'pix'|'debito'|'credito_vista'
//   obs
// }
router.post('/', (req, res) => {
  const { venda_id = null, devolvidos = [], levados = [],
          forma_pagamento = null, obs = null, forcar_excecao = false } = req.body;

  if ((!devolvidos || !devolvidos.length) && (!levados || !levados.length)) {
    return res.status(400).json({ erro: 'Informe ao menos uma peça devolvida ou levada.' });
  }

  // Validação de prazo
  if (!venda_id) {
    return res.status(400).json({ erro: 'Informe a venda de origem para registrar a troca.' });
  }
  const venda = db.prepare('SELECT id, data_hora FROM vendas WHERE id = ? AND tenant_id = ?').get(venda_id, req.tenantId);
  if (!venda) return res.status(404).json({ erro: 'Venda de origem não encontrada.' });

  const diasPassados = diasUteisEntre(venda.data_hora.slice(0, 10), hojeLocal());
  const prazo = 7;
  if (diasPassados > prazo && !forcar_excecao) {
    return res.status(422).json({
      erro: `Prazo de troca expirado: a compra foi há ${diasPassados} dias úteis (limite ${prazo}).`,
      prazo_expirado: true, dias_passados: diasPassados, prazo: prazo,
    });
  }

  // resolve dados das pecas levadas (incluir custo para CMVR)
  const getVar = db.prepare(`
    SELECT v.id AS variacao_id, v.quantidade, v.tamanho, v.produto_id, p.nome, p.preco_venda, COALESCE(p.custo, 0) AS custo
    FROM variacoes v JOIN produtos p ON p.id = v.produto_id WHERE v.id = ?`);

  const levadosResolv = [];
  for (const it of levados) {
    const v = getVar.get(it.variacao_id);
    if (!v) return res.status(400).json({ erro: `Peça levada inválida (id ${it.variacao_id})` });
    const qtd = parseInt(it.qtd, 10) || 1;
    if (v.quantidade < qtd) {
      return res.status(400).json({ erro: `Estoque insuficiente: ${v.nome} tam ${v.tamanho} (tem ${v.quantidade})` });
    }
    levadosResolv.push({ ...v, qtd, valor_unit: v.preco_venda, descricao: `${v.nome} (${v.tamanho})` });
  }

  const valorDevolvido = devolvidos.reduce((s, d) => s + (parseFloat(d.valor_unit)||0) * (parseInt(d.qtd,10)||1), 0);
  const valorLevado = levadosResolv.reduce((s, l) => s + l.valor_unit * l.qtd, 0);
  const diferenca = +(valorLevado - valorDevolvido).toFixed(2);

  // Calcula custos (para CMVR na DRE)
  let custoDevolv = 0;
  const getVar2 = db.prepare(`
    SELECT COALESCE(p.custo, 0) AS custo
    FROM variacoes v JOIN produtos p ON p.id = v.produto_id WHERE v.id = ?`);
  for (const d of devolvidos) {
    if (d.variacao_id) {
      const p = getVar2.get(d.variacao_id);
      custoDevolv += (p?.custo || 0) * (parseInt(d.qtd, 10) || 1);
    }
  }
  let custoLeva = 0;
  for (const l of levadosResolv) {
    if (l.variacao_id) {
      const p = getVar2.get(l.variacao_id);
      custoLeva += (p?.custo || 0) * (parseInt(l.qtd, 10) || 1);
    }
  }
  const cmvrBruto = +(custoLeva - custoDevolv).toFixed(2);

  const hoje = hojeLocal();

  const tx = db.transaction(() => {
    // 1. registra a troca (com custos para CMVR)
    const info = db.prepare(`
      INSERT INTO trocas (tenant_id, venda_id, valor_devolvido, valor_levado, diferenca, forma_pagamento_diferenca, obs, custo_devolvido, custo_levado, cmvr_bruto, data_hora)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now','localtime'))
    `).run(req.tenantId, venda_id, +valorDevolvido.toFixed(2), +valorLevado.toFixed(2), diferenca, forma_pagamento, obs, +custoDevolv.toFixed(2), +custoLeva.toFixed(2), cmvrBruto);
    const trocaId = info.lastInsertRowid;

    const insItem = db.prepare(`INSERT INTO troca_itens (troca_id, tenant_id, tipo, variacao_id, produto_id, descricao, qtd, valor_unit, custo_unit)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`);

    const sobe = db.prepare('UPDATE variacoes SET quantidade = quantidade + ? WHERE id = ?');
    const baixa = db.prepare('UPDATE variacoes SET quantidade = quantidade - ? WHERE id = ?');
    const mov = db.prepare('INSERT INTO movimentos_estoque (variacao_id, tipo, qtd, motivo) VALUES (?, ?, ?, ?)');

    // 2. devolvidos -> voltam ao estoque
    for (const d of devolvidos) {
      const qtd = parseInt(d.qtd,10) || 1;
      let custoDev = 0;
      if (d.variacao_id) {
        const p = getVar2.get(d.variacao_id);
        custoDev = p?.custo || 0;
      }
      insItem.run(trocaId, req.tenantId, 'devolvido', d.variacao_id || null, d.produto_id || null, d.descricao || null, qtd, parseFloat(d.valor_unit)||0, +custoDev.toFixed(2));
      if (d.variacao_id) {
        sobe.run(qtd, d.variacao_id);
        mov.run(d.variacao_id, 'entrada', qtd, `troca #${trocaId} (devolução)`);
      }
    }

    // 3. levados -> saem do estoque
    for (const l of levadosResolv) {
      insItem.run(trocaId, req.tenantId, 'levado', l.variacao_id, l.produto_id, l.descricao, l.qtd, l.valor_unit, +l.custo.toFixed(2));
      baixa.run(l.qtd, l.variacao_id);
      mov.run(l.variacao_id, 'saida', -l.qtd, `troca #${trocaId} (saída)`);
    }

    // 4. resolve a diferença (ajusta caixa se necessário)
    if (diferenca > 0) {
      // Cliente paga a diferença -> registra como venda
      const vendaInfo = db.prepare(`
        INSERT INTO vendas (tenant_id, cliente_id, vendedor_id, subtotal, desconto, total, forma_pagamento, origem, parcelas, taxa_aplicada, valor_liquido, imposto, comissao_valor, custo_total, lucro, observacao)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        req.tenantId,
        venda_id ? db.prepare('SELECT cliente_id FROM vendas WHERE id = ?').get(venda_id)?.cliente_id : null,
        venda_id ? db.prepare('SELECT vendedor_id FROM vendas WHERE id = ?').get(venda_id)?.vendedor_id : null,
        diferenca, 0, diferenca, forma_pagamento, 'loja', 1,
        0, diferenca, 0, 0, 0, 0, `Diferença de troca #${trocaId}`
      );
      const vendaDifId = vendaInfo.lastInsertRowid;

      // Registrar itens da venda de diferença (os levados)
      const insVendaItem = db.prepare(`INSERT INTO venda_itens (venda_id, tenant_id, variacao_id, produto_id, descricao, qtd, preco_unit, custo_unit)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)`);
      for (const l of levadosResolv) {
        insVendaItem.run(vendaDifId, req.tenantId, l.variacao_id, l.produto_id, l.descricao, l.qtd, l.valor_unit, l.custo);
      }

      // Ajustar caixa com a forma de pagamento
      db.prepare('INSERT OR IGNORE INTO caixa_dia (data, tenant_id) VALUES (?, ?)').run(hoje, req.tenantId);
      if (forma_pagamento === 'dinheiro') {
        db.prepare('UPDATE caixa_dia SET total_dinheiro = total_dinheiro + ?, suprimentos = suprimentos + ? WHERE data = ? AND tenant_id = ?')
          .run(diferenca, diferenca, hoje, req.tenantId);
        db.prepare(`INSERT INTO caixa_movimentos (data, tenant_id, tipo, valor, forma, motivo) VALUES (?, ?, 'suprimento', ?, ?, ?)`)
          .run(hoje, req.tenantId, diferenca, 'dinheiro', `troca #${trocaId} (cliente pagou diferença)`);
      } else if (forma_pagamento === 'pix') {
        db.prepare('UPDATE caixa_dia SET total_pix = total_pix + ? WHERE data = ? AND tenant_id = ?').run(diferenca, hoje, req.tenantId);
      } else if (forma_pagamento === 'debito') {
        db.prepare('UPDATE caixa_dia SET total_debito = total_debito + ? WHERE data = ? AND tenant_id = ?').run(diferenca, hoje, req.tenantId);
      } else if (forma_pagamento === 'credito_vista') {
        db.prepare('UPDATE caixa_dia SET total_credito = total_credito + ? WHERE data = ? AND tenant_id = ?').run(diferenca, hoje, req.tenantId);
      }
    } else if (diferenca < 0) {
      const aFavor = Math.abs(diferenca);
      console.log('Vale: diferenca=', diferenca, 'aFavor=', aFavor, 'tipo=', typeof aFavor);

      // Cliente recebe em vale-crédito
      let clienteId = null;
      if (venda_id) {
        const vendaInfo = db.prepare('SELECT cliente_id FROM vendas WHERE id = ? AND tenant_id = ?').get(venda_id, req.tenantId);
        clienteId = vendaInfo?.cliente_id || null;
      }

      // Gera código único do vale (simples)
      const codigoVale = 'VALE-' + Math.random().toString(36).substr(2, 9).toUpperCase();

      // Calcula validade: hoje + 30 dias
      const hoje = new Date();
      const validade30 = new Date(hoje.getTime() + 30 * 24 * 60 * 60 * 1000);
      const validadeStr = validade30.toISOString().split('T')[0]; // YYYY-MM-DD

      console.log('Inserindo vale:', { codigo: codigoVale, valor: aFavor, saldo: aFavor, validade: validadeStr });

      // Insere o vale (direto no BD)
      const infoVale = db.prepare(`
        INSERT INTO vales (tenant_id, codigo, valor, saldo, troca_id, cliente_id, validade, notas, ativo)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1)
      `).run(req.tenantId, codigoVale, aFavor, aFavor, trocaId, clienteId, validadeStr, `Crédito da troca #${trocaId}`);

      console.log('Vale inserido com ID:', infoVale.lastInsertRowid);

      // Busca o vale que foi criado
      const valeGerado = db.prepare('SELECT id, codigo, valor, saldo, validade FROM vales WHERE id = ?').get(infoVale.lastInsertRowid);
      console.log('Vale encontrado:', valeGerado);

      return {
        trocaId,
        valeGerado,
      };
    }

    return { trocaId, valeGerado: null };
  });

  try {
    const resultado = tx();

    const resp = { id: resultado.trocaId, valor_devolvido: valorDevolvido, valor_levado: valorLevado, diferenca };
    if (resultado.valeGerado) {
      resp.vale = {
        codigo: resultado.valeGerado.codigo,
        valor: resultado.valeGerado.valor,
        validade: resultado.valeGerado.validade,
      };
    }
    res.status(201).json(resp);
  } catch (e) {
    res.status(500).json({ erro: e.message });
  }
});

module.exports = router;
