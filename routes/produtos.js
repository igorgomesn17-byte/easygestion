// ============================================================
// API de PRODUTOS (cadastro, grade de tamanhos, precificacao)
// ============================================================
const express = require('express');
const router = express.Router();
const fs = require('fs');
const path = require('path');
const { db } = require('../db/database');
const { sugerirPreco, analisarPreco } = require('../lib/calculos');
const { limiteUploadPorTenant, limiteUploadFrequencia } = require('../middleware/rate-limit-custoso');

// Guard de papel: GET (busca/consulta) liberado a qualquer logado (PDV usa).
// Escrita (POST/PUT/DELETE) e precificação com custo (sugerir/analisar) = só admin.
// /vitrine é público e já foi tratado no middleware global antes daqui.
router.use((req, res, next) => {
  const papel = req.session && req.session.papel;
  if (papel === 'admin') return next();
  const ehLeitura = req.method === 'GET';
  const ehPrecoComCusto = req.method === 'POST' && (req.path === '/sugerir-preco' || req.path === '/analisar-preco');
  if (ehLeitura && !ehPrecoComCusto) return next();
  return res.status(403).json({ erro: 'Sem permissão para esta área' });
});

// UPLOADS_DIR configurável por env (disco persistente na nuvem); default = pasta local.
const DIR_FOTOS = process.env.UPLOADS_DIR || path.join(__dirname, '..', 'public', 'img', 'produtos');
if (!fs.existsSync(DIR_FOTOS)) fs.mkdirSync(DIR_FOTOS, { recursive: true });

const MAX_FOTO_BYTES = 3 * 1024 * 1024; // 3MB por foto

// Salva uma foto base64 (data URL) com validação de segurança.
// Aceita SÓ raster (png/jpg/webp) — BLOQUEIA svg (pode conter script) e limita tamanho.
function salvarFotoBase64(dataUrl, codigo) {
  if (!dataUrl || typeof dataUrl !== 'string') return null;
  const m = dataUrl.match(/^data:image\/(png|jpe?g|webp);base64,([A-Za-z0-9+/=]+)$/i);
  if (!m) return null; // formato não permitido (inclui svg, gif, etc.)
  const buf = Buffer.from(m[2], 'base64');
  if (buf.length === 0 || buf.length > MAX_FOTO_BYTES) return null;
  const ext = m[1].toLowerCase() === 'jpeg' ? 'jpg' : m[1].toLowerCase();
  const codigoLimpo = String(codigo).replace(/[^A-Za-z0-9_-]/g, ''); // evita path traversal no nome
  // sufixo aleatório evita colisão quando várias fotos são salvas no mesmo ms
  const nome = `${codigoLimpo}-${Date.now()}-${Math.floor(Math.random()*1e6)}.${ext}`;
  fs.writeFileSync(path.join(DIR_FOTOS, nome), buf);
  return 'img/produtos/' + nome;
}

const MAX_FOTOS = 5; // 1 capa + até 4 extras

// Salva as fotos EXTRAS de um produto (galeria). Substitui as existentes.
// fotosExtras: array de base64 (novas) ou caminhos (mantidas). Máx MAX_FOTOS-1 extras.
function salvarFotosExtras(produtoId, codigo, fotosExtras) {
  if (!Array.isArray(fotosExtras)) return;
  db.prepare('DELETE FROM produto_fotos WHERE produto_id = ?').run(produtoId);
  const ins = db.prepare('INSERT INTO produto_fotos (produto_id, caminho, ordem) VALUES (?, ?, ?)');
  let ordem = 0;
  for (const f of fotosExtras.slice(0, MAX_FOTOS - 1)) {
    let caminho = null;
    if (typeof f === 'string' && f.startsWith('data:image')) caminho = salvarFotoBase64(f, codigo);
    else if (typeof f === 'string' && f.startsWith('img/produtos/')) caminho = f; // mantida
    if (caminho) ins.run(produtoId, caminho, ordem++);
  }
}

// Retorna as fotos extras de um produto (array de caminhos)
function fotosExtrasDe(produtoId) {
  return db.prepare('SELECT caminho FROM produto_fotos WHERE produto_id = ? ORDER BY ordem, id').all(produtoId).map(r => r.caminho);
}

// Valida que o produto pertence ao tenant logado
function validarTenantProduto(produtoId, tenantId) {
  const p = db.prepare('SELECT tenant_id FROM produtos WHERE id = ?').get(produtoId);
  return p && p.tenant_id === tenantId;
}

// Gera proximo codigo sequencial por categoria (ex: VES001)
function proximoCodigo(prefixo, tenantId = 1) {
  const row = db.prepare(
    "SELECT codigo FROM produtos WHERE codigo LIKE ? AND tenant_id = ? ORDER BY id DESC LIMIT 1"
  ).get(prefixo + '%', tenantId);
  let n = 1;
  if (row) {
    const num = parseInt(row.codigo.replace(prefixo, ''), 10);
    if (!isNaN(num)) n = num + 1;
  }
  return prefixo + String(n).padStart(3, '0');
}

// Gera codigo de barras EAN-13 simples (prefixo 200 = uso interno) + digito verificador
function gerarEAN13() {
  // base: 200 + timestamp parcial + aleatorio (12 digitos), calcula verificador
  let base = '200' + String(Date.now()).slice(-6) + String(Math.floor(Math.random() * 1000)).padStart(3, '0');
  base = base.slice(0, 12);
  let soma = 0;
  for (let i = 0; i < 12; i++) {
    soma += parseInt(base[i], 10) * (i % 2 === 0 ? 1 : 3);
  }
  const verificador = (10 - (soma % 10)) % 10;
  return base + verificador;
}

// GET /api/produtos  -> lista produtos com estoque total e grade
router.get('/', (req, res) => {
  const { busca, categoria, colecao } = req.query;
  const tenantId = req.tenantId;
  let sql = 'SELECT * FROM produtos WHERE ativo = 1 AND tenant_id = ?';
  const params = [tenantId];
  if (busca) {
    sql += ' AND (nome LIKE ? OR codigo LIKE ? OR codigo_barras = ?)';
    params.push(`%${busca}%`, `%${busca}%`, busca);
  }
  if (categoria) { sql += ' AND categoria = ?'; params.push(categoria); }
  if (colecao) { sql += ' AND colecao = ?'; params.push(colecao); }
  sql += ' ORDER BY criado_em DESC';

  const ehAdmin = req.session && req.session.papel === 'admin';
  const produtos = db.prepare(sql).all(...params);
  const getVariacoes = db.prepare('SELECT id, tamanho, quantidade FROM variacoes WHERE produto_id = ? ORDER BY id');
  for (const p of produtos) {
    p.grade = getVariacoes.all(p.id);
    p.estoque_total = p.grade.reduce((s, v) => s + v.quantidade, 0);
    if (ehAdmin) p.margem = analisarPreco(p.custo, p.preco_venda);
    else { delete p.custo; } // não-admin (PDV/relacionamento) não vê custo/margem
  }
  res.json(produtos);
});

// GET /api/produtos/vitrine -> catalogo publico (so com estoque, SEM custo/lucro)
router.get('/vitrine', (req, res) => {
  const { busca, categoria, colecao } = req.query;
  let sql = 'SELECT id, codigo, nome, categoria, cor, preco_venda, foto, colecao FROM produtos WHERE ativo = 1';
  const params = [];
  if (busca) { sql += ' AND nome LIKE ?'; params.push(`%${busca}%`); }
  if (categoria) { sql += ' AND categoria = ?'; params.push(categoria); }
  if (colecao) { sql += ' AND colecao = ?'; params.push(colecao); }
  sql += ' ORDER BY criado_em DESC';
  const produtos = db.prepare(sql).all(...params);
  const getVar = db.prepare('SELECT tamanho, quantidade FROM variacoes WHERE produto_id = ? AND quantidade > 0 ORDER BY id');
  const comEstoque = [];
  for (const p of produtos) {
    const grade = getVar.all(p.id);
    if (grade.length === 0) continue; // so mostra o que tem em estoque
    p.tamanhos = grade.map(g => g.tamanho);
    // galeria: capa (foto) + extras, na ordem. Só caminhos válidos.
    p.galeria = [p.foto, ...fotosExtrasDe(p.id)].filter(Boolean);
    // titulo pra vitrine (A14): se o nome for o proprio codigo (cadastro sem nome),
    // mostra Categoria + Cor pra cliente, nunca o codigo cru.
    if (p.nome === p.codigo) {
      const cat = p.categoria ? (p.categoria.charAt(0).toUpperCase() + p.categoria.slice(1)) : 'Peça';
      p.titulo = (cat + (p.cor ? ' ' + p.cor : '')).trim();
    } else {
      p.titulo = p.nome;
    }
    comEstoque.push(p);
  }
  // categorias e coleções disponiveis (pra montar os filtros)
  const cats = [...new Set(comEstoque.map(p => p.categoria).filter(Boolean))];
  const colecoes = [...new Set(comEstoque.map(p => p.colecao).filter(Boolean))];
  res.json({ produtos: comEstoque, categorias: cats, colecoes });
});

// GET /api/produtos/:id
router.get('/:id', (req, res) => {
  const tenantId = req.tenantId;
  const p = db.prepare('SELECT * FROM produtos WHERE id = ? AND tenant_id = ?').get(req.params.id, tenantId);
  if (!p) return res.status(404).json({ erro: 'Produto nao encontrado' });
  p.grade = db.prepare('SELECT id, tamanho, quantidade FROM variacoes WHERE produto_id = ? ORDER BY id').all(p.id);
  p.estoque_total = p.grade.reduce((s, v) => s + v.quantidade, 0);
  p.fotos = fotosExtrasDe(p.id); // fotos extras da galeria (a capa fica em p.foto)
  if (req.session && req.session.papel === 'admin') p.margem = analisarPreco(p.custo, p.preco_venda);
  else { delete p.custo; } // não-admin não vê custo/margem
  res.json(p);
});

// POST /api/produtos/rapido -> cadastro EXPRESSO no PDV (nome + preço + 1 tamanho)
// Cria o produto com 1 unidade do tamanho e devolve a VARIAÇÃO pronta pro carrinho.
// O resto (custo, categoria, foto) o admin completa depois em Produtos.
router.post('/rapido', (req, res) => {
  const tenantId = req.tenantId;
  const nome = String(req.body.nome || '').trim();
  const preco = parseFloat(req.body.preco_venda) || 0;
  const tamanho = String(req.body.tamanho || 'U').trim().toUpperCase() || 'U';
  const qtd = parseInt(req.body.quantidade, 10) || 1;
  if (!nome) return res.status(400).json({ erro: 'Informe o nome da peça' });
  if (preco <= 0) return res.status(400).json({ erro: 'Informe o preço de venda' });

  const codigo = proximoCodigo('PRD', tenantId);
  const codigo_barras = gerarEAN13();
  const tx = db.transaction(() => {
    const info = db.prepare(`INSERT INTO produtos (codigo, codigo_barras, nome, preco_venda, tenant_id) VALUES (?, ?, ?, ?, ?)`)
      .run(codigo, codigo_barras, nome, preco, tenantId);
    const produtoId = info.lastInsertRowid;
    const vinfo = db.prepare('INSERT INTO variacoes (produto_id, tamanho, quantidade, tenant_id) VALUES (?, ?, ?, ?)')
      .run(produtoId, tamanho, qtd, tenantId);
    if (qtd > 0) db.prepare("INSERT INTO movimentos_estoque (variacao_id, tipo, qtd, motivo) VALUES (?, 'entrada', ?, 'cadastro rápido no PDV')")
      .run(vinfo.lastInsertRowid, qtd);
    return { produtoId, variacaoId: vinfo.lastInsertRowid };
  });
  try {
    const r = tx();
    // devolve no formato que o PDV usa pra adicionar ao carrinho
    res.status(201).json({
      produto_id: r.produtoId, variacao_id: r.variacaoId, codigo,
      nome, preco_venda: preco, custo: 0, tamanho, quantidade: qtd
    });
  } catch (e) {
    res.status(500).json({ erro: e.message });
  }
});

// POST /api/produtos  -> cadastra produto + grade
// body: { nome, categoria, descricao, cor, custo, preco_venda, foto, fotos:[base64...], grade: [{tamanho, quantidade}] }
router.post('/', limiteUploadPorTenant, limiteUploadFrequencia, (req, res) => {
  const tenantId = req.tenantId;
  const { nome, categoria, descricao, cor, custo, preco_venda, foto, fotos, grade, colecao } = req.body;

  const prefixo = (categoria || 'PRD').slice(0, 3).toUpperCase();
  const codigo = proximoCodigo(prefixo, tenantId);
  const codigo_barras = gerarEAN13();

  // Nome opcional (A14): se vazio, usa o proprio codigo gerado como nome (controle interno).
  // A vitrine mostra categoria+cor pra cliente quando nome == codigo.
  const nomeFinal = (nome && String(nome).trim()) ? String(nome).trim() : codigo;

  // salva foto principal/capa (se enviada em base64)
  let fotoPath = null;
  if (foto) { try { fotoPath = salvarFotoBase64(foto, codigo); } catch (e) { /* ignora foto invalida */ } }

  const insertProduto = db.prepare(`
    INSERT INTO produtos (codigo, codigo_barras, nome, categoria, descricao, cor, custo, preco_venda, foto, colecao, tenant_id)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  const insertVar = db.prepare('INSERT INTO variacoes (produto_id, tamanho, quantidade, tenant_id) VALUES (?, ?, ?, ?)');
  const insertMov = db.prepare("INSERT INTO movimentos_estoque (variacao_id, tipo, qtd, motivo) VALUES (?, 'entrada', ?, 'cadastro inicial')");

  const tx = db.transaction(() => {
    const info = insertProduto.run(codigo, codigo_barras, nomeFinal, categoria || null, descricao || null, cor || null,
      parseFloat(custo) || 0, parseFloat(preco_venda) || 0, fotoPath, colecao || null, tenantId);
    const produtoId = info.lastInsertRowid;
    if (Array.isArray(grade)) {
      for (const g of grade) {
        if (!g.tamanho) continue;
        const qtd = parseInt(g.quantidade, 10) || 0;
        const vinfo = insertVar.run(produtoId, String(g.tamanho).toUpperCase(), qtd, tenantId);
        if (qtd > 0) insertMov.run(vinfo.lastInsertRowid, qtd);
      }
    }
    if (Array.isArray(fotos)) salvarFotosExtras(produtoId, codigo, fotos); // galeria
    return produtoId;
  });

  try {
    const id = tx();
    res.status(201).json({ id, codigo, codigo_barras });
  } catch (e) {
    res.status(500).json({ erro: e.message });
  }
});

// PUT /api/produtos/:id -> edita dados (nao mexe na grade aqui; estoque e via /api/estoque)
router.put('/:id', limiteUploadPorTenant, limiteUploadFrequencia, (req, res) => {
  const tenantId = req.tenantId;
  const { nome, categoria, descricao, cor, custo, preco_venda, foto, fotos, grade, colecao } = req.body;
  const p = db.prepare('SELECT id, codigo, foto FROM produtos WHERE id = ? AND tenant_id = ?').get(req.params.id, tenantId);
  if (!p) return res.status(404).json({ erro: 'Produto nao encontrado' });

  // foto: se vier base64 nova, salva; se vier caminho existente, mantem; se vazio, mantem o atual
  let fotoPath = p.foto;
  if (foto && foto.startsWith('data:image')) {
    try { fotoPath = salvarFotoBase64(foto, p.codigo); } catch (e) { /* mantem atual */ }
  } else if (foto === '') {
    fotoPath = null; // remocao explicita
  }

  const tx = db.transaction(() => {
    db.prepare(`
      UPDATE produtos SET nome=?, categoria=?, descricao=?, cor=?, custo=?, preco_venda=?, foto=?, colecao=?
      WHERE id=? AND tenant_id=?
    `).run(nome, categoria || null, descricao || null, cor || null,
      parseFloat(custo) || 0, parseFloat(preco_venda) || 0, fotoPath, colecao || null, req.params.id, tenantId);
    // só mexe na galeria se 'fotos' foi enviado (undefined = não alterar)
    if (Array.isArray(fotos)) salvarFotosExtras(p.id, p.codigo, fotos);
    // atualizar grade de tamanhos/quantidades se enviada
    if (Array.isArray(grade)) {
      const updateVar = db.prepare('UPDATE variacoes SET quantidade = ? WHERE produto_id = ? AND tamanho = ?');
      const insertVar = db.prepare('INSERT INTO variacoes (produto_id, tamanho, quantidade, tenant_id) VALUES (?, ?, ?, ?)');
      for (const g of grade) {
        if (!g.tamanho) continue;
        const qtd = parseInt(g.quantidade, 10) || 0;
        const tamanho = String(g.tamanho).toUpperCase();
        // tenta atualizar; se não encontrar, cria nova variação
        const updated = db.prepare('UPDATE variacoes SET quantidade = ? WHERE produto_id = ? AND tamanho = ?')
          .run(qtd, req.params.id, tamanho);
        if (updated.changes === 0) {
          insertVar.run(req.params.id, tamanho, qtd, tenantId);
        }
      }
    }
  });
  tx();
  res.json({ ok: true });
});

// DELETE /api/produtos/:id -> inativa (nao apaga, preserva historico de vendas)
router.delete('/:id', (req, res) => {
  const tenantId = req.tenantId;
  db.prepare('UPDATE produtos SET ativo = 0 WHERE id = ? AND tenant_id = ?').run(req.params.id, tenantId);
  res.json({ ok: true });
});

// POST /api/produtos/sugerir-preco  body: { custo }
router.post('/sugerir-preco', (req, res) => {
  const custo = parseFloat(req.body.custo) || 0;
  const preco = sugerirPreco(custo, req.tenantId);
  res.json({ preco, analise: analisarPreco(custo, preco, { tenantId: req.tenantId }) });
});

// POST /api/produtos/analisar-preco  body: { custo, preco_venda }
router.post('/analisar-preco', (req, res) => {
  const custo = parseFloat(req.body.custo) || 0;
  const preco = parseFloat(req.body.preco_venda) || 0;
  res.json(analisarPreco(custo, preco, { tenantId: req.tenantId }));
});

// DELETE /api/produtos/:id — deleta um produto e suas variações
router.delete('/:id', (req, res) => {
  const id = parseInt(req.params.id, 10);
  const p = db.prepare('SELECT tenant_id FROM produtos WHERE id = ?').get(id);
  if (!p || p.tenant_id !== req.tenantId) {
    return res.status(404).json({ erro: 'Produto não encontrado' });
  }
  const tx = db.transaction(() => {
    db.prepare('DELETE FROM movimentos_estoque WHERE variacao_id IN (SELECT id FROM variacoes WHERE produto_id = ?)').run(id);
    db.prepare('DELETE FROM variacoes WHERE produto_id = ?').run(id);
    db.prepare('DELETE FROM produto_fotos WHERE produto_id = ?').run(id);
    db.prepare('DELETE FROM produtos WHERE id = ?').run(id);
  });
  tx();
  res.json({ ok: true });
});

module.exports = router;
