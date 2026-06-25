// ============================================================
// API de ESTOQUE (consulta, ajuste, entrada de mercadoria, grade)
// ============================================================
const express = require('express');
const router = express.Router();
const { db } = require('../db/database');
const { validarQuantidade } = require('../lib/validadores');

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

// POST /api/estoque/lote  body: [{ codigo, tamanho, quantidade, motivo? }]
// Entrada de estoque em lote (importação CSV).
// Retorna { ok: true, processados: N, erros: [{ codigo, tamanho, motivo }] }
router.post('/lote', (req, res) => {
  const itens = Array.isArray(req.body) ? req.body : [];
  if (!itens.length) return res.status(400).json({ erro: 'Nenhum item para processar' });

  const processados = [];
  const erros = [];

  const getVarId = db.prepare(`
    SELECT v.id FROM variacoes v
    JOIN produtos p ON p.id = v.produto_id
    WHERE p.codigo = ? AND v.tamanho = ? AND p.ativo = 1 AND p.tenant_id = ?
  `);

  const tx = db.transaction(() => {
    for (const item of itens) {
      const { codigo, tamanho, quantidade, motivo } = item;
      const qtd = parseInt(quantidade, 10);

      // validações básicas
      if (!codigo || !tamanho || isNaN(qtd) || qtd <= 0) {
        erros.push({ codigo, tamanho, motivo: 'Dados inválidos (código, tamanho e quantidade > 0 obrigatórios)' });
        continue;
      }

      // busca a variação
      const v = getVarId.get(String(codigo).trim(), String(tamanho).trim().toUpperCase(), req.tenantId);
      if (!v) {
        erros.push({ codigo, tamanho, motivo: 'Código/tamanho não encontrado' });
        continue;
      }

      // adiciona ao estoque
      try {
        db.prepare('UPDATE variacoes SET quantidade = quantidade + ? WHERE id = ?').run(qtd, v.id);
        db.prepare("INSERT INTO movimentos_estoque (variacao_id, tipo, qtd, motivo) VALUES (?, 'entrada', ?, ?)")
          .run(v.id, qtd, motivo || 'entrada em lote');
        processados.push({ codigo, tamanho, quantidade: qtd });
      } catch (e) {
        erros.push({ codigo, tamanho, motivo: e.message });
      }
    }
  });

  tx();
  res.json({ ok: true, processados: processados.length, itens_processados: processados, erros });
});

module.exports = router;
