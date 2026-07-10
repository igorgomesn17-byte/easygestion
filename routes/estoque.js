// ============================================================
// API de ESTOQUE (consulta, ajuste, entrada de mercadoria, grade)
// ============================================================
const express = require('express');
const router = express.Router();
const { db } = require('../db/database');
const { validarQuantidade } = require('../lib/validadores');
const { exigirFeature } = require('../middleware/seguranca');

// GET /api/estoque/resumo -> totais de estoque (cards)
router.get('/resumo', (req, res) => {
  const e = db.prepare(`
    SELECT COALESCE(SUM(v.quantidade * p.custo),0) AS valor_custo,
           COALESCE(SUM(v.quantidade * p.preco_venda),0) AS valor_venda,
           COALESCE(SUM(v.quantidade),0) AS pecas
    FROM variacoes v JOIN produtos p ON p.id = v.produto_id
    WHERE p.ativo = 1 AND p.tenant_id = ?
  `).get(req.tenantId);
  const produtos = db.prepare('SELECT COUNT(*) AS n FROM produtos WHERE ativo = 1 AND tenant_id = ?').get(req.tenantId).n;
  res.json({ ...e, produtos });
});

// GET /api/estoque/relatorio?colecao=&categoria= -> quanto tem parado e quanto vira lucro
// Uma linha por PRODUTO (soma a grade), nao por tamanho: o GET / devolve uma linha por
// tamanho e corta em 500, o que serve pra tela operacional mas nao pra um relatorio.
// "potencial" porque e' o que a peca rende SE vender pelo preco de tabela.
router.get('/relatorio', exigirFeature('relatorios_avancados'), (req, res) => {
  const { categoria, colecao } = req.query;
  let sql = `
    SELECT p.id AS produto_id, p.codigo, p.nome, p.categoria, p.colecao, p.cor,
           p.custo, p.preco_venda,
           COALESCE(SUM(v.quantidade),0) AS qtd
    FROM produtos p
    LEFT JOIN variacoes v ON v.produto_id = p.id
    WHERE p.ativo = 1 AND p.tenant_id = ?
  `;
  const params = [req.tenantId];
  if (categoria) { sql += ' AND p.categoria = ?'; params.push(categoria); }
  if (colecao)   { sql += ' AND p.colecao = ?';   params.push(colecao); }
  sql += ' GROUP BY p.id ORDER BY p.nome';

  const itens = db.prepare(sql).all(...params).map(r => {
    const custoTotal = +(r.qtd * (r.custo || 0)).toFixed(2);
    const vendaTotal = +(r.qtd * (r.preco_venda || 0)).toFixed(2);
    const lucroTotal = +(vendaTotal - custoTotal).toFixed(2);
    return {
      produto_id: r.produto_id, codigo: r.codigo, nome: r.nome,
      categoria: r.categoria, colecao: r.colecao, cor: r.cor,
      qtd: r.qtd,
      custo_unit: +(r.custo || 0).toFixed(2),
      preco_venda: +(r.preco_venda || 0).toFixed(2),
      custo_total: custoTotal,
      venda_total: vendaTotal,
      lucro_total: lucroTotal,
      margem: vendaTotal > 0 ? +((lucroTotal / vendaTotal) * 100).toFixed(1) : 0,
    };
  });

  const soma = (campo) => +itens.reduce((s, i) => s + i[campo], 0).toFixed(2);
  const custoTotal = soma('custo_total');
  const vendaTotal = soma('venda_total');
  const lucroTotal = soma('lucro_total');
  res.json({
    itens,
    total: {
      produtos: itens.length,
      pecas: itens.reduce((s, i) => s + i.qtd, 0),
      custo: custoTotal,
      venda: vendaTotal,
      lucro: lucroTotal,
      margem: vendaTotal > 0 ? +((lucroTotal / vendaTotal) * 100).toFixed(1) : 0,
    },
  });
});

// GET /api/estoque -> visao geral por produto/tamanho com filtros
router.get('/', (req, res) => {
  const { categoria, colecao, busca } = req.query;
  let sql = `
    SELECT p.id AS produto_id, p.codigo, p.nome, p.categoria, p.colecao, p.cor,
           p.custo, p.preco_venda,
           v.id AS variacao_id, v.tamanho, v.quantidade
    FROM produtos p
    JOIN variacoes v ON v.produto_id = p.id
    WHERE p.ativo = 1 AND p.tenant_id = ?
  `;
  const params = [req.tenantId];

  if (categoria) {
    sql += ' AND p.categoria = ?';
    params.push(categoria);
  }
  if (colecao) {
    sql += ' AND p.colecao = ?';
    params.push(colecao);
  }
  if (busca) {
    const term = '%' + busca.trim().toLowerCase() + '%';
    sql += ' AND (LOWER(p.nome) LIKE ? OR LOWER(p.codigo) LIKE ?)';
    params.push(term, term);
  }

  sql += ' ORDER BY p.nome, v.id LIMIT 500';
  const rows = db.prepare(sql).all(...params);
  res.json(rows);
});

// GET /api/estoque/baixo -> tamanhos em ruptura ou estoque minimo
router.get('/baixo', (req, res) => {
  const min = parseInt(db.prepare("SELECT valor FROM config WHERE chave='estoque_minimo_alerta' AND tenant_id = ?").get(req.tenantId)?.valor || '1', 10);
  const rows = db.prepare(`
    SELECT p.codigo, p.nome, v.tamanho, v.quantidade
    FROM produtos p JOIN variacoes v ON v.produto_id = p.id
    WHERE p.ativo = 1 AND p.tenant_id = ? AND v.quantidade <= ?
    ORDER BY v.quantidade ASC, p.nome
  `).all(req.tenantId, min);
  res.json(rows);
});

// POST /api/estoque/ajuste  body: { variacao_id, nova_quantidade, motivo }
router.post('/ajuste', (req, res) => {
  const { variacao_id, nova_quantidade, motivo } = req.body;
  const v = db.prepare(`
    SELECT v.quantidade FROM variacoes v
    JOIN produtos p ON p.id = v.produto_id
    WHERE v.id = ? AND p.tenant_id = ?
  `).get(variacao_id, req.tenantId);
  if (!v) return res.status(404).json({ erro: 'Variacao nao encontrada' });

  // Validar quantidade (aceita 0, diferente de entrada)
  const valQtd = validarQuantidade(nova_quantidade, 'Nova quantidade');
  if (!valQtd.valido) {
    // Ajuste pode ser 0 (zerar estoque), então aceitar
    const nova = parseInt(nova_quantidade, 10);
    if (isNaN(nova) || nova < 0) return res.status(400).json({ erro: 'Quantidade deve ser um número >= 0' });
  }
  const nova = parseInt(nova_quantidade, 10);
  const diff = nova - v.quantidade;
  const tx = db.transaction(() => {
    db.prepare('UPDATE variacoes SET quantidade = ? WHERE id = ?').run(nova, variacao_id);
    db.prepare("INSERT INTO movimentos_estoque (variacao_id, tipo, qtd, motivo) VALUES (?, 'ajuste', ?, ?)")
      .run(variacao_id, diff, motivo || 'ajuste manual');
  });
  tx();
  res.json({ ok: true, quantidade: nova });
});

// POST /api/estoque/entrada  body: { variacao_id, qtd, motivo }  (adiciona ao estoque)
router.post('/entrada', (req, res) => {
  const { variacao_id, qtd, motivo } = req.body;
  const v = db.prepare(`
    SELECT v.quantidade FROM variacoes v
    JOIN produtos p ON p.id = v.produto_id
    WHERE v.id = ? AND p.tenant_id = ?
  `).get(variacao_id, req.tenantId);
  if (!v) return res.status(404).json({ erro: 'Variacao nao encontrada' });

  // Validar quantidade (entrada deve ser > 0)
  const valQtd = validarQuantidade(qtd, 'Quantidade entrada');
  if (!valQtd.valido) return res.status(400).json({ erro: valQtd.erro });
  const add = valQtd.valor;
  const tx = db.transaction(() => {
    db.prepare('UPDATE variacoes SET quantidade = quantidade + ? WHERE id = ?').run(add, variacao_id);
    db.prepare("INSERT INTO movimentos_estoque (variacao_id, tipo, qtd, motivo) VALUES (?, 'entrada', ?, ?)")
      .run(variacao_id, add, motivo || 'entrada de mercadoria');
  });
  tx();
  res.json({ ok: true });
});

// POST /api/estoque/adicionar-tamanho body: { produto_id, tamanho, quantidade }
router.post('/adicionar-tamanho', (req, res) => {
  const { produto_id, tamanho, quantidade } = req.body;
  if (!produto_id || !tamanho) return res.status(400).json({ erro: 'Dados incompletos' });
  const qtd = parseInt(quantidade, 10) || 0;

  const produtoValido = db.prepare('SELECT id FROM produtos WHERE id = ? AND tenant_id = ?')
    .get(produto_id, req.tenantId);
  if (!produtoValido) return res.status(403).json({ erro: 'Produto não encontrado ou acesso negado' });

  try {
    const info = db.prepare('INSERT INTO variacoes (produto_id, tamanho, quantidade, tenant_id) VALUES (?, ?, ?, ?)')
      .run(produto_id, String(tamanho).toUpperCase(), qtd, req.tenantId);
    if (qtd > 0) {
      db.prepare("INSERT INTO movimentos_estoque (variacao_id, tipo, qtd, motivo) VALUES (?, 'entrada', ?, 'novo tamanho')")
        .run(info.lastInsertRowid, qtd);
    }
    res.status(201).json({ id: info.lastInsertRowid });
  } catch (e) {
    res.status(400).json({ erro: 'Esse tamanho ja existe nesse produto' });
  }
});

// POST /api/estoque/lote  body: [{ codigo ou nome, tamanho, quantidade, motivo? }]
// Entrada de estoque em lote (importação CSV).
// Aceita busca por CÓDIGO ou por NOME do produto.
// Retorna { ok: true, processados: N, erros: [{ codigo, tamanho, motivo }] }
router.post('/lote', (req, res) => {
  const itens = Array.isArray(req.body) ? req.body : [];
  if (!itens.length) return res.status(400).json({ erro: 'Nenhum item para processar' });

  const processados = [];
  const erros = [];

  // Query que busca por CÓDIGO OU NOME
  const getVarId = db.prepare(`
    SELECT v.id, p.codigo, p.nome FROM variacoes v
    JOIN produtos p ON p.id = v.produto_id
    WHERE (p.codigo = ? OR LOWER(p.nome) = LOWER(?))
      AND v.tamanho = ?
      AND p.ativo = 1
      AND p.tenant_id = ?
  `);

  const tx = db.transaction(() => {
    for (const item of itens) {
      const { codigo, nome, tamanho, quantidade, motivo } = item;
      const identificador = codigo || nome; // aceita tanto codigo quanto nome
      const qtd = parseInt(quantidade, 10);

      // validações básicas
      if (!identificador || !tamanho || isNaN(qtd) || qtd <= 0) {
        erros.push({
          codigo: identificador || '?',
          tamanho,
          motivo: 'Dados inválidos (código OU nome, tamanho e quantidade > 0 obrigatórios)'
        });
        continue;
      }

      // busca a variação (por código OU nome, o SQL tenta os dois com OR)
      const v = getVarId.get(
        String(codigo || '').trim(),
        String(nome || '').trim(),
        String(tamanho).trim().toUpperCase(),
        req.tenantId
      );

      if (!v) {
        erros.push({
          codigo: identificador,
          tamanho,
          motivo: 'Código ou nome não encontrado'
        });
        continue;
      }

      // adiciona ao estoque
      try {
        db.prepare('UPDATE variacoes SET quantidade = quantidade + ? WHERE id = ?').run(qtd, v.id);
        db.prepare("INSERT INTO movimentos_estoque (variacao_id, tipo, qtd, motivo) VALUES (?, 'entrada', ?, ?)")
          .run(v.id, qtd, motivo || 'entrada em lote');
        processados.push({ codigo: v.codigo, nome: v.nome, tamanho, quantidade: qtd });
      } catch (e) {
        erros.push({ codigo: identificador, tamanho, motivo: e.message });
      }
    }
  });

  tx();
  res.json({ ok: true, processados: processados.length, itens_processados: processados, erros });
});

module.exports = router;
