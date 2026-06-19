// ============================================================
// API de ESTOQUE (consulta, ajuste, entrada de mercadoria, grade)
// ============================================================
const express = require('express');
const router = express.Router();
const { db } = require('../db/database');

// GET /api/estoque/resumo -> totais de estoque (cards)
router.get('/resumo', (req, res) => {
  const e = db.prepare(`
    SELECT COALESCE(SUM(v.quantidade * p.custo),0) AS valor_custo,
           COALESCE(SUM(v.quantidade * p.preco_venda),0) AS valor_venda,
           COALESCE(SUM(v.quantidade),0) AS pecas
    FROM variacoes v JOIN produtos p ON p.id = v.produto_id WHERE p.ativo = 1
  `).get();
  const produtos = db.prepare('SELECT COUNT(*) AS n FROM produtos WHERE ativo = 1').get().n;
  res.json({ ...e, produtos });
});

// GET /api/estoque -> visao geral por produto/tamanho
router.get('/', (req, res) => {
  const rows = db.prepare(`
    SELECT p.id AS produto_id, p.codigo, p.nome, p.categoria, p.cor,
           p.custo, p.preco_venda,
           v.id AS variacao_id, v.tamanho, v.quantidade
    FROM produtos p
    JOIN variacoes v ON v.produto_id = p.id
    WHERE p.ativo = 1
    ORDER BY p.nome, v.id
  `).all();
  res.json(rows);
});

// GET /api/estoque/baixo -> tamanhos em ruptura ou estoque minimo
router.get('/baixo', (req, res) => {
  const min = parseInt(db.prepare("SELECT valor FROM config WHERE chave='estoque_minimo_alerta'").get()?.valor || '1', 10);
  const rows = db.prepare(`
    SELECT p.codigo, p.nome, v.tamanho, v.quantidade
    FROM produtos p JOIN variacoes v ON v.produto_id = p.id
    WHERE p.ativo = 1 AND v.quantidade <= ?
    ORDER BY v.quantidade ASC, p.nome
  `).all(min);
  res.json(rows);
});

// POST /api/estoque/ajuste  body: { variacao_id, nova_quantidade, motivo }
router.post('/ajuste', (req, res) => {
  const { variacao_id, nova_quantidade, motivo } = req.body;
  const v = db.prepare('SELECT quantidade FROM variacoes WHERE id = ?').get(variacao_id);
  if (***REMOVED***v) return res.status(404).json({ erro: 'Variacao nao encontrada' });
  const nova = parseInt(nova_quantidade, 10);
  if (isNaN(nova) || nova < 0) return res.status(400).json({ erro: 'Quantidade invalida' });
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
  const v = db.prepare('SELECT quantidade FROM variacoes WHERE id = ?').get(variacao_id);
  if (***REMOVED***v) return res.status(404).json({ erro: 'Variacao nao encontrada' });
  const add = parseInt(qtd, 10);
  if (isNaN(add) || add <= 0) return res.status(400).json({ erro: 'Quantidade invalida' });
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
  if (***REMOVED***produto_id || ***REMOVED***tamanho) return res.status(400).json({ erro: 'Dados incompletos' });
  const qtd = parseInt(quantidade, 10) || 0;
  try {
    const info = db.prepare('INSERT INTO variacoes (produto_id, tamanho, quantidade) VALUES (?, ?, ?)')
      .run(produto_id, String(tamanho).toUpperCase(), qtd);
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
  if (***REMOVED***itens.length) return res.status(400).json({ erro: 'Nenhum item para processar' });

  const processados = [];
  const erros = [];

  const getVarId = db.prepare(`
    SELECT v.id FROM variacoes v
    JOIN produtos p ON p.id = v.produto_id
    WHERE p.codigo = ? AND v.tamanho = ? AND p.ativo = 1
  `);

  const tx = db.transaction(() => {
    for (const item of itens) {
      const { codigo, tamanho, quantidade, motivo } = item;
      const qtd = parseInt(quantidade, 10);

      // validações básicas
      if (***REMOVED***codigo || ***REMOVED***tamanho || isNaN(qtd) || qtd <= 0) {
        erros.push({ codigo, tamanho, motivo: 'Dados inválidos (código, tamanho e quantidade > 0 obrigatórios)' });
        continue;
      }

      // busca a variação
      const v = getVarId.get(String(codigo).trim(), String(tamanho).trim().toUpperCase());
      if (***REMOVED***v) {
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
