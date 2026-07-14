// ============================================================
// API de ESTOQUE (consulta, ajuste, entrada de mercadoria, grade)
// ============================================================
const express = require('express');
const router = express.Router();
const { db } = require('../db/database');
const { validarQuantidade } = require('../lib/validadores');
const { exigirFeature } = require('../middleware/seguranca');
const { normalizarCor, normalizarTamanho, resolverCodigoBarras } = require('../lib/sku');

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
  // A cor agora vem da VARIACAO. Um produto pode ter varias — entao a linha do
  // relatorio (que e' por produto) lista as cores que ele tem em estoque.
  let sql = `
    SELECT p.id AS produto_id, p.codigo, p.nome, p.categoria, p.colecao,
           p.custo, p.preco_venda,
           COALESCE(SUM(v.quantidade),0) AS qtd,
           GROUP_CONCAT(DISTINCT CASE WHEN v.quantidade > 0 THEN v.cor END) AS cores
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
      categoria: r.categoria, colecao: r.colecao,
      cor: r.cores || '',   // "Preto,Vermelho" — mantem o nome do campo pro front antigo
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
  // Uma linha por SKU (cor x tamanho). v.cor substitui p.cor: um produto pode ter
  // varias cores, e a tela agrupa por produto e depois por cor.
  let sql = `
    SELECT p.id AS produto_id, p.codigo, p.nome, p.categoria, p.colecao,
           p.custo, p.preco_venda,
           v.id AS variacao_id, v.cor, v.tamanho, v.quantidade, v.codigo_barras
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
    // busca tambem pelo codigo de barras do SKU: bipar a etiqueta aqui acha a peca
    sql += ' AND (LOWER(p.nome) LIKE ? OR LOWER(p.codigo) LIKE ? OR v.codigo_barras = ?)';
    params.push(term, term, busca.trim());
  }

  sql += ' ORDER BY p.nome, v.cor, v.id LIMIT 500';
  const rows = db.prepare(sql).all(...params);
  res.json(rows);
});

// GET /api/estoque/baixo -> tamanhos em ruptura ou estoque minimo
router.get('/baixo', (req, res) => {
  const min = parseInt(db.prepare("SELECT valor FROM config WHERE chave='estoque_minimo_alerta' AND tenant_id = ?").get(req.tenantId)?.valor || '1', 10);
  const rows = db.prepare(`
    SELECT p.codigo, p.nome, v.cor, v.tamanho, v.quantidade
    FROM produtos p JOIN variacoes v ON v.produto_id = p.id
    WHERE p.ativo = 1 AND p.tenant_id = ? AND v.quantidade <= ?
    ORDER BY v.quantidade ASC, p.nome, v.cor
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
    db.prepare(`UPDATE variacoes SET quantidade = ? WHERE id = ? AND produto_id IN (SELECT id FROM produtos WHERE tenant_id = ?)`).run(nova, variacao_id, req.tenantId);
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
    db.prepare(`UPDATE variacoes SET quantidade = quantidade + ? WHERE id = ? AND produto_id IN (SELECT id FROM produtos WHERE tenant_id = ?)`).run(add, variacao_id, req.tenantId);
    db.prepare("INSERT INTO movimentos_estoque (variacao_id, tipo, qtd, motivo) VALUES (?, 'entrada', ?, ?)")
      .run(variacao_id, add, motivo || 'entrada de mercadoria');
  });
  tx();
  res.json({ ok: true });
});

// POST /api/estoque/adicionar-tamanho body: { produto_id, cor, tamanho, quantidade, codigo_barras? }
// Adiciona um SKU (cor + tamanho) a um produto ja cadastrado.
// A rota mantem o nome antigo pra nao quebrar quem ja chama; o que ela cria agora
// e' um par (cor, tamanho), nao so um tamanho.
router.post('/adicionar-tamanho', (req, res, next) => {
  const { produto_id, quantidade } = req.body;
  const tamanho = normalizarTamanho(req.body.tamanho);
  const cor = normalizarCor(req.body.cor);   // sem cor -> 'Unica'
  if (!produto_id || !tamanho) return res.status(400).json({ erro: 'Informe o produto e o tamanho' });
  const qtd = Math.max(0, parseInt(quantidade, 10) || 0);

  const produtoValido = db.prepare('SELECT id FROM produtos WHERE id = ? AND tenant_id = ?')
    .get(produto_id, req.tenantId);
  if (!produtoValido) return res.status(403).json({ erro: 'Produto não encontrado ou acesso negado' });

  const jaExiste = db.prepare('SELECT id FROM variacoes WHERE produto_id = ? AND cor = ? AND tamanho = ?')
    .get(produto_id, cor, tamanho);
  if (jaExiste) return res.status(400).json({ erro: `A peça "${cor} / ${tamanho}" já existe nesse produto` });

  try {
    const codigoBarras = resolverCodigoBarras(req.body.codigo_barras, req.tenantId);
    const tx = db.transaction(() => {
      const info = db.prepare('INSERT INTO variacoes (produto_id, cor, tamanho, quantidade, codigo_barras, tenant_id) VALUES (?, ?, ?, ?, ?, ?)')
        .run(produto_id, cor, tamanho, qtd, codigoBarras, req.tenantId);
      if (qtd > 0) {
        db.prepare("INSERT INTO movimentos_estoque (variacao_id, tipo, qtd, motivo) VALUES (?, 'entrada', ?, 'nova peça na grade')")
          .run(info.lastInsertRowid, qtd);
      }
      return info.lastInsertRowid;
    });
    const id = tx();
    res.status(201).json({ id, cor, tamanho, quantidade: qtd, codigo_barras: codigoBarras });
  } catch (e) {
    if (e.status === 400) return res.status(400).json({ erro: e.message });
    next(e);
  }
});

// POST /api/estoque/lote  body: [{ codigo ou nome, cor?, tamanho, quantidade, motivo? }]
// Entrada de estoque em lote (importação CSV).
// Aceita busca por CÓDIGO ou por NOME do produto, e agora por COR.
// Retorna { ok: true, processados: N, erros: [{ codigo, cor, tamanho, motivo }] }
router.post('/lote', (req, res) => {
  const itens = Array.isArray(req.body) ? req.body : [];
  if (!itens.length) return res.status(400).json({ erro: 'Nenhum item para processar' });

  const processados = [];
  const erros = [];

  // Query que busca o SKU por (CÓDIGO OU NOME) + cor + tamanho
  const getVarId = db.prepare(`
    SELECT v.id, v.cor, p.codigo, p.nome FROM variacoes v
    JOIN produtos p ON p.id = v.produto_id
    WHERE (p.codigo = ? OR LOWER(p.nome) = LOWER(?))
      AND v.cor = ? AND v.tamanho = ?
      AND p.ativo = 1
      AND p.tenant_id = ?
  `);
  // Fallback: a planilha nao trouxe coluna de cor e o produto so tem UMA cor.
  // E' o caso comum de quem migrou (tudo 'Unica') e de quem so vende uma cor por
  // modelo. Com 2+ cores, exigir a coluna — adivinhar aqui daria entrada na peca errada.
  const getVarSemCor = db.prepare(`
    SELECT v.id, v.cor, p.codigo, p.nome FROM variacoes v
    JOIN produtos p ON p.id = v.produto_id
    WHERE (p.codigo = ? OR LOWER(p.nome) = LOWER(?))
      AND v.tamanho = ?
      AND p.ativo = 1
      AND p.tenant_id = ?
  `);

  const tx = db.transaction(() => {
    for (const item of itens) {
      const { codigo, nome, quantidade, motivo } = item;
      const identificador = codigo || nome; // aceita tanto codigo quanto nome
      const tamanho = normalizarTamanho(item.tamanho);
      const corInformada = String(item.cor == null ? '' : item.cor).trim();
      const qtd = parseInt(quantidade, 10);

      // validações básicas
      if (!identificador || !tamanho || isNaN(qtd) || qtd <= 0) {
        erros.push({
          codigo: identificador || '?', cor: corInformada, tamanho: item.tamanho,
          motivo: 'Dados inválidos (código OU nome, tamanho e quantidade > 0 obrigatórios)'
        });
        continue;
      }

      const cod = String(codigo || '').trim();
      const nom = String(nome || '').trim();

      let v;
      if (corInformada) {
        v = getVarId.get(cod, nom, normalizarCor(corInformada), tamanho, req.tenantId);
      } else {
        const achadas = getVarSemCor.all(cod, nom, tamanho, req.tenantId);
        if (achadas.length > 1) {
          erros.push({
            codigo: identificador, cor: '', tamanho,
            motivo: `Esse produto tem ${achadas.length} cores nesse tamanho (${achadas.map(a => a.cor).join(', ')}). Informe a coluna "cor".`
          });
          continue;
        }
        v = achadas[0];
      }

      if (!v) {
        erros.push({
          codigo: identificador, cor: corInformada, tamanho,
          motivo: corInformada ? 'Produto/cor/tamanho não encontrado' : 'Código ou nome não encontrado'
        });
        continue;
      }

      // adiciona ao estoque
      try {
        db.prepare(`UPDATE variacoes SET quantidade = quantidade + ? WHERE id = ? AND produto_id IN (SELECT id FROM produtos WHERE tenant_id = ?)`).run(qtd, v.id, req.tenantId);
        db.prepare("INSERT INTO movimentos_estoque (variacao_id, tipo, qtd, motivo) VALUES (?, 'entrada', ?, ?)")
          .run(v.id, qtd, motivo || 'entrada em lote');
        processados.push({ codigo: v.codigo, nome: v.nome, cor: v.cor, tamanho, quantidade: qtd });
      } catch (e) {
        erros.push({ codigo: identificador, cor: corInformada, tamanho, motivo: e.message });
      }
    }
  });

  tx();
  res.json({ ok: true, processados: processados.length, itens_processados: processados, erros });
});

module.exports = router;
