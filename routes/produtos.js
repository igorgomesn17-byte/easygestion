// ============================================================
// API de PRODUTOS (cadastro, grade de tamanhos, precificacao)
// ============================================================
const express = require('express');
const router = express.Router();
const fs = require('fs');
const path = require('path');
const { db } = require('../db/database');
const { exigirTenant } = require('../lib/tenant');
const { sugerirPreco, analisarPreco } = require('../lib/calculos');
const { limiteUploadPorTenant, limiteUploadFrequencia } = require('../middleware/rate-limit-custoso');
const { exigirDentroDoLimite, exigirFeature } = require('../middleware/seguranca');
const {
  COR_PADRAO, normalizarCor, normalizarTamanho,
  resolverCodigoBarras, gerarCodigoBarras, validarCodigoBarras, codigoEmUso,
} = require('../lib/sku');

// Conta produtos ativos do tenant (para o limite por plano).
const contarProdutos = (tenantId) =>
  db.prepare('SELECT COUNT(*) AS n FROM produtos WHERE tenant_id = ? AND ativo = 1').get(tenantId).n;

// Guard de papel: GET (busca/consulta) liberado a qualquer logado (PDV usa).
// Escrita (POST/PUT/DELETE) e precificação com custo (sugerir/analisar) = só admin.
// /vitrine é público e já foi tratado no middleware global antes daqui.
router.use((req, res, next) => {
  const papel = req.session && req.session.papel;
  if (papel === 'admin') return next();
  const ehLeitura = req.method === 'GET';
  // sugerir/analisar preço lidam com CUSTO e markup: só admin. O guard antigo
  // fazia o contrário do que o comentário acima diz — liberava pra não-admin.
  if (ehLeitura) return next();
  return res.status(403).json({ erro: 'Sem permissão para esta área' });
});

// UPLOADS_DIR configurável por env (disco persistente na nuvem); default = pasta local.
const DIR_FOTOS = process.env.UPLOADS_DIR || path.join(__dirname, '..', 'public', 'img', 'produtos');
if (!fs.existsSync(DIR_FOTOS)) fs.mkdirSync(DIR_FOTOS, { recursive: true });

const MAX_FOTO_BYTES = 2 * 1024 * 1024; // 2MB por foto

// Salva uma foto base64 (data URL) com validação de segurança.
// Aceita SÓ raster (png/jpg/webp) — BLOQUEIA svg (pode conter script) e limita tamanho.
function salvarFotoBase64(dataUrl, codigo) {
  if (!dataUrl || typeof dataUrl !== 'string') return { ok: false, erro: 'Imagem inválida' };
  const m = dataUrl.match(/^data:image\/(png|jpe?g|webp);base64,([A-Za-z0-9+/=]+)$/i);
  if (!m) return { ok: false, erro: 'Formato não suportado. Use PNG, JPG ou WEBP' };
  const buf = Buffer.from(m[2], 'base64');
  if (buf.length === 0) return { ok: false, erro: 'Imagem vazia' };
  if (buf.length > MAX_FOTO_BYTES) return { ok: false, erro: `Imagem muito grande (${(buf.length / 1024 / 1024).toFixed(1)}MB). Máximo: 2MB` };
  const ext = m[1].toLowerCase() === 'jpeg' ? 'jpg' : m[1].toLowerCase();
  const codigoLimpo = String(codigo).replace(/[^A-Za-z0-9_-]/g, ''); // evita path traversal no nome
  const nome = `${codigoLimpo}-${Date.now()}-${Math.floor(Math.random()*1e6)}.${ext}`;
  fs.writeFileSync(path.join(DIR_FOTOS, nome), buf);
  return { ok: true, erro: null, caminho: 'img/produtos/' + nome };
}

const MAX_FOTOS = 5; // 1 capa + até 4 extras

// Salva as fotos EXTRAS de um produto (galeria). Substitui as existentes.
// fotosExtras: array de base64 (novas) ou caminhos (mantidas). Máx MAX_FOTOS-1 extras.
// tenantId e' OBRIGATORIO: sem ele, a query cai em qualquer loja. Lança em vez de
// aceitar undefined — um default silencioso e' o que produz vazamento entre tenants.
function salvarFotosExtras(produtoId, codigo, fotosExtras, tenantId) {
  if (!tenantId) throw new Error('salvarFotosExtras: tenantId obrigatorio');
  if (!Array.isArray(fotosExtras)) return null;
  db.prepare('DELETE FROM produto_fotos WHERE produto_id = ? AND tenant_id = ?').run(produtoId, tenantId);
  const ins = db.prepare('INSERT INTO produto_fotos (produto_id, caminho, ordem, tenant_id) VALUES (?, ?, ?, ?)');
  let ordem = 0;
  for (const f of fotosExtras.slice(0, MAX_FOTOS - 1)) {
    let caminho = null;
    if (typeof f === 'string' && f.startsWith('data:image')) {
      const result = salvarFotoBase64(f, codigo);
      if (!result.ok) return result; // erro ao salvar foto
      caminho = result.caminho;
    } else if (typeof f === 'string' && f.startsWith('img/produtos/')) {
      caminho = f; // mantida
    }
    if (caminho) ins.run(produtoId, caminho, ordem++, tenantId);
  }
  return { ok: true, erro: null };
}

// Retorna as fotos extras de um produto (array de caminhos)
function fotosExtrasDe(produtoId, tenantId) {
  if (!tenantId) throw new Error('fotosExtrasDe: tenantId obrigatorio');
  return db.prepare('SELECT caminho FROM produto_fotos WHERE produto_id = ? AND tenant_id = ? ORDER BY ordem, id')
    .all(produtoId, tenantId).map(r => r.caminho);
}

// Valida que o produto pertence ao tenant logado
function validarTenantProduto(produtoId, tenantId) {
  const p = db.prepare('SELECT tenant_id FROM produtos WHERE id = ?').get(produtoId);
  return p && p.tenant_id === tenantId;
}

// Gera proximo codigo sequencial por categoria (ex: VES001)
function proximoCodigo(prefixo, tenantId) {
  tenantId = exigirTenant(tenantId, 'produtos.proximoCodigo');
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

// A geracao de codigo de barras mora em lib/sku.js (gerarCodigoBarras): o codigo
// agora e' por VARIACAO (cada cor+tamanho e' um SKU), e a mesma regra e' usada no
// cadastro, na edicao e na entrada de estoque. Havia aqui um gerarEAN13() local
// que so servia ao produto e nao checava colisao.

// Le a grade (matriz cor x tamanho) de um ou mais produtos de uma vez.
// Uma query so pros N produtos: o padrao N+1 aqui ja tinha sido corrigido antes.
function gradeDe(produtoIds, { somenteComEstoque = false } = {}) {
  const porProduto = new Map();
  if (!produtoIds.length) return porProduto;
  const ph = produtoIds.map(() => '?').join(',');
  const filtro = somenteComEstoque ? 'AND quantidade > 0' : '';
  const linhas = db.prepare(
    `SELECT id, produto_id, cor, tamanho, quantidade, codigo_barras
     FROM variacoes WHERE produto_id IN (${ph}) ${filtro}
     ORDER BY produto_id, cor, id`
  ).all(...produtoIds);
  for (const v of linhas) {
    if (!porProduto.has(v.produto_id)) porProduto.set(v.produto_id, []);
    porProduto.get(v.produto_id).push({
      id: v.id, cor: v.cor || COR_PADRAO, tamanho: v.tamanho,
      quantidade: v.quantidade, codigo_barras: v.codigo_barras,
    });
  }
  return porProduto;
}

// As cores distintas de um produto, na ordem em que aparecem na grade.
const coresDaGrade = (grade) => [...new Set(grade.map((g) => g.cor))];

// GET /api/produtos  -> lista produtos com estoque total e grade
router.get('/', (req, res) => {
  const { busca, categoria, colecao } = req.query;
  const tenantId = req.tenantId;
  let sql = 'SELECT * FROM produtos WHERE ativo = 1 AND tenant_id = ?';
  const params = [tenantId];
  if (busca) {
    // O codigo de barras agora e' da VARIACAO (cada cor+tamanho e' um SKU), entao a
    // busca tem que alcancar variacoes.codigo_barras — senao bipar a etiqueta no PDV
    // nao acha mais nada. produtos.codigo_barras continua na busca pelos cadastros
    // antigos, que ainda tem o codigo no produto.
    sql += ` AND (nome LIKE ? OR codigo LIKE ? OR codigo_barras = ?
                  OR id IN (SELECT produto_id FROM variacoes WHERE codigo_barras = ?))`;
    params.push(`%${busca}%`, `%${busca}%`, busca, busca);
  }
  if (categoria) { sql += ' AND categoria = ?'; params.push(categoria); }
  if (colecao) { sql += ' AND colecao = ?'; params.push(colecao); }
  sql += ' ORDER BY criado_em DESC';

  const ehAdmin = req.session && req.session.papel === 'admin';
  const produtos = db.prepare(sql).all(...params);

  const gradePorProduto = gradeDe(produtos.map((p) => p.id));

  for (const p of produtos) {
    p.grade = gradePorProduto.get(p.id) || [];
    p.cores = coresDaGrade(p.grade);
    p.estoque_total = p.grade.reduce((s, v) => s + v.quantidade, 0);
    // Se a busca foi por codigo de barras e ele bate com UM SKU, devolve qual: o PDV
    // usa isso pra jogar a peca certa no carrinho sem perguntar cor nem tamanho.
    if (busca) {
      const bipada = p.grade.find((g) => g.codigo_barras && g.codigo_barras === busca);
      if (bipada) p.variacao_bipada = bipada.id;
    }
    // Sem o tenant, a margem saia calculada com o frete, a embalagem, o imposto e a
    // comissao DA LOJA 1 — na tela em que a lojista decide o preco das peças dela.
    if (ehAdmin) p.margem = analisarPreco(p.custo, p.preco_venda, { tenantId: req.tenantId });
    else { delete p.custo; }
  }
  res.json(produtos);
});

// GET /api/produtos/vitrine -> catalogo publico (so com estoque, SEM custo/lucro)
// ⚠️ CRÍTICO: Agora filtra por tenant_id do usuário logado (se chamado de dentro do painel)
// ou retorna vazio se chamado sem autenticação (rotas públicas usam /api/vitrine/:slug/produtos)
router.get('/vitrine', (req, res) => {
  const { busca, categoria, colecao } = req.query;
  // Se não há tenant_id (rota pública chamada diretamente), retornar vazio
  if (!req.tenantId) {
    return res.json({ produtos: [], categorias: [], colecoes: [] });
  }
  // p.cor (do produto) esta DEPRECADA — a cor mora na variacao. Nao selecionada aqui.
  let sql = 'SELECT id, codigo, nome, categoria, preco_venda, foto, colecao FROM produtos WHERE ativo = 1 AND tenant_id = ?';
  const params = [req.tenantId];
  if (busca) { sql += ' AND nome LIKE ?'; params.push(`%${busca}%`); }
  if (categoria) { sql += ' AND categoria = ?'; params.push(categoria); }
  if (colecao) { sql += ' AND colecao = ?'; params.push(colecao); }
  sql += ' ORDER BY criado_em DESC';
  const produtos = db.prepare(sql).all(...params);

  const produtoIds = produtos.map(p => p.id);
  const gradePorProduto = gradeDe(produtoIds, { somenteComEstoque: true });
  const fotosPorProduto = new Map();

  if (produtoIds.length > 0) {
    const placeholders = produtoIds.map(() => '?').join(',');
    // Buscar fotos extras. Os produtoIds ja vieram de uma listagem filtrada por tenant,
    // mas a query filtra de novo: a tabela nao deve depender de quem a chama.
    // (este handler e' o GET /vitrine, que usa req.tenantId — nao ha `tenantId` local)
    const todasFotos = db.prepare(
      `SELECT produto_id, caminho FROM produto_fotos WHERE produto_id IN (${placeholders}) AND tenant_id = ? ORDER BY produto_id, ordem, id`
    ).all(...produtoIds, req.tenantId);
    for (const f of todasFotos) {
      if (!fotosPorProduto.has(f.produto_id)) fotosPorProduto.set(f.produto_id, []);
      fotosPorProduto.get(f.produto_id).push(f.caminho);
    }
  }

  const comEstoque = [];
  for (const p of produtos) {
    const grade = gradePorProduto.get(p.id) || [];
    if (grade.length === 0) continue;
    p.grade = grade;                       // a matriz cheia (cor x tamanho, com estoque)
    p.cores = coresDaGrade(grade);         // as cores disponiveis desta peca
    p.tamanhos = [...new Set(grade.map(g => g.tamanho))];  // mantido: quem so quer tamanho
    // galeria: capa (foto) + extras, na ordem. Só caminhos válidos.
    p.galeria = [p.foto, ...(fotosPorProduto.get(p.id) || [])].filter(Boolean);
    // titulo pra vitrine (A14): se o nome for o proprio codigo (cadastro sem nome),
    // mostra Categoria + Cor pra cliente, nunca o codigo cru. A cor agora vem da grade
    // — e so entra no titulo se a peca tiver UMA cor so (com varias, o titulo mentiria).
    if (p.nome === p.codigo) {
      const cat = p.categoria ? (p.categoria.charAt(0).toUpperCase() + p.categoria.slice(1)) : 'Peça';
      const corUnica = (p.cores.length === 1 && p.cores[0] !== COR_PADRAO) ? ' ' + p.cores[0] : '';
      p.titulo = (cat + corUnica).trim();
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

const COLUNAS_ETIQUETA = 'id, codigo, nome, preco_venda, codigo_barras';

// GET /api/produtos/etiquetas?ids=1,2,3 -> etiquetas de VÁRIOS produtos de uma vez.
// A mercadoria chega em lote: o lojista quer etiquetar a remessa inteira, nao abrir
// peca por peca.
//
// Registrada AQUI, antes do GET /:id: o Express casa na ordem de registro, e /:id
// capturaria a palavra "etiquetas" (virando id="etiquetas" -> 404).
router.get('/etiquetas', (req, res) => {
  const ids = String(req.query.ids || '')
    .split(',').map((s) => parseInt(s, 10)).filter(Boolean).slice(0, 200);
  if (!ids.length) return res.status(400).json({ erro: 'Informe os produtos (ids)' });

  const ph = ids.map(() => '?').join(',');
  const produtos = db.prepare(
    `SELECT ${COLUNAS_ETIQUETA} FROM produtos WHERE id IN (${ph}) AND tenant_id = ?`
  ).all(...ids, req.tenantId);

  const grades = gradeDe(produtos.map((p) => p.id));
  const etiquetas = produtos.flatMap((p) => etiquetasDe(p, grades.get(p.id) || []));
  res.json({
    produtos: produtos.map((p) => ({ id: p.id, nome: p.nome, codigo: p.codigo })),
    etiquetas,
  });
});

// GET /api/produtos/:id
router.get('/:id', (req, res) => {
  const tenantId = req.tenantId;
  const p = db.prepare('SELECT * FROM produtos WHERE id = ? AND tenant_id = ?').get(req.params.id, tenantId);
  if (!p) return res.status(404).json({ erro: 'Produto nao encontrado' });
  p.grade = gradeDe([p.id]).get(p.id) || [];
  p.cores = coresDaGrade(p.grade);
  p.tamanhos = [...new Set(p.grade.map((g) => g.tamanho))];
  p.estoque_total = p.grade.reduce((s, v) => s + v.quantidade, 0);
  p.fotos = fotosExtrasDe(p.id, tenantId); // fotos extras da galeria (a capa fica em p.foto)
  if (req.session && req.session.papel === 'admin') p.margem = analisarPreco(p.custo, p.preco_venda, { tenantId: req.tenantId });
  else { delete p.custo; } // não-admin não vê custo/margem
  res.json(p);
});

// POST /api/produtos/rapido -> cadastro EXPRESSO no PDV (nome + preço + 1 SKU)
// Cria o produto com 1 unidade e devolve a VARIAÇÃO pronta pro carrinho.
// O resto (custo, categoria, foto, outras cores) o admin completa depois em Produtos.
router.post('/rapido', exigirDentroDoLimite('produtos', contarProdutos), (req, res, next) => {
  const tenantId = req.tenantId;
  const nome = String(req.body.nome || '').trim();
  const preco = parseFloat(req.body.preco_venda) || 0;
  const cor = normalizarCor(req.body.cor);              // sem cor -> 'Unica'
  const tamanho = normalizarTamanho(req.body.tamanho) || 'U';
  const qtd = parseInt(req.body.quantidade, 10) || 1;
  if (!nome) return res.status(400).json({ erro: 'Informe o nome da peça' });
  if (preco <= 0) return res.status(400).json({ erro: 'Informe o preço de venda' });

  const codigo = proximoCodigo('PRD', tenantId);
  const tx = db.transaction(() => {
    // o codigo de barras e' do SKU, nao do produto: produtos.codigo_barras fica NULL
    // nos cadastros novos (a coluna so existe pelos antigos).
    const codigoBarras = resolverCodigoBarras(req.body.codigo_barras, tenantId);
    const info = db.prepare(`INSERT INTO produtos (codigo, nome, preco_venda, tenant_id) VALUES (?, ?, ?, ?)`)
      .run(codigo, nome, preco, tenantId);
    const produtoId = info.lastInsertRowid;
    const vinfo = db.prepare('INSERT INTO variacoes (produto_id, cor, tamanho, quantidade, codigo_barras, tenant_id) VALUES (?, ?, ?, ?, ?, ?)')
      .run(produtoId, cor, tamanho, qtd, codigoBarras, tenantId);
    if (qtd > 0) db.prepare("INSERT INTO movimentos_estoque (variacao_id, tipo, qtd, motivo) VALUES (?, 'entrada', ?, 'cadastro rápido no PDV')")
      .run(vinfo.lastInsertRowid, qtd);
    return { produtoId, variacaoId: vinfo.lastInsertRowid, codigoBarras };
  });
  try {
    const r = tx();
    // devolve no formato que o PDV usa pra adicionar ao carrinho
    res.status(201).json({
      id: r.produtoId, produto_id: r.produtoId, variacao_id: r.variacaoId, codigo,
      nome, preco_venda: preco, custo: 0, cor, tamanho, quantidade: qtd, estoque: qtd,
      cores: [cor],
      grade: [{ id: r.variacaoId, cor, tamanho, quantidade: qtd, codigo_barras: r.codigoBarras }]
    });
  } catch (e) {
    if (e.status === 400) return res.status(400).json({ erro: e.message });
    next(e);
  }
});

// POST /api/produtos  -> cadastra o produto (o MODELO) + a matriz cor x tamanho
// body: {
//   nome, categoria, descricao, custo, preco_venda, foto, fotos:[base64...], colecao,
//   grade: [{ cor, tamanho, quantidade, codigo_barras? }]   <- uma linha por SKU
// }
// Cada celula preenchida da matriz vira uma variacao (um SKU) com estoque e codigo
// de barras proprios. Celula vazia (qtd 0 e sem codigo) nao vira SKU: cadastrar
// "Vermelho / GG = 0" polui a arara com peca que a loja nem comprou.
router.post('/', exigirDentroDoLimite('produtos', contarProdutos), limiteUploadPorTenant, limiteUploadFrequencia, (req, res, next) => {
  const tenantId = req.tenantId;
  const { nome, categoria, descricao, custo, preco_venda, foto, fotos, grade, colecao } = req.body;

  const prefixo = (categoria || 'PRD').slice(0, 3).toUpperCase();
  const codigo = proximoCodigo(prefixo, tenantId);

  // Nome opcional (A14): se vazio, usa o proprio codigo gerado como nome (controle interno).
  // A vitrine mostra categoria+cor pra cliente quando nome == codigo.
  const nomeFinal = (nome && String(nome).trim()) ? String(nome).trim() : codigo;

  // salva foto principal/capa (se enviada em base64)
  let fotoPath = null;
  if (foto) {
    const resultFoto = salvarFotoBase64(foto, codigo);
    if (!resultFoto.ok) return res.status(400).json({ erro: resultFoto.erro });
    fotoPath = resultFoto.caminho;
  }

  // produtos.cor e codigos_barras nao sao mais preenchidos: os dois viraram atributo
  // do SKU. As colunas continuam existindo so pelos cadastros antigos.
  const insertProduto = db.prepare(`
    INSERT INTO produtos (codigo, nome, categoria, descricao, custo, preco_venda, foto, colecao, tenant_id)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  const insertVar = db.prepare('INSERT INTO variacoes (produto_id, cor, tamanho, quantidade, codigo_barras, tenant_id) VALUES (?, ?, ?, ?, ?, ?)');
  const insertMov = db.prepare("INSERT INTO movimentos_estoque (variacao_id, tipo, qtd, motivo) VALUES (?, 'entrada', ?, 'cadastro inicial')");

  const tx = db.transaction(() => {
    const info = insertProduto.run(codigo, nomeFinal, categoria || null, descricao || null,
      parseFloat(custo) || 0, parseFloat(preco_venda) || 0, fotoPath, colecao || null, tenantId);
    const produtoId = info.lastInsertRowid;

    const skus = [];
    const vistos = new Set();
    for (const g of (Array.isArray(grade) ? grade : [])) {
      const tamanho = normalizarTamanho(g.tamanho);
      if (!tamanho) continue;
      const cor = normalizarCor(g.cor);
      const qtd = Math.max(0, parseInt(g.quantidade, 10) || 0);

      // A mesma celula duas vezes estouraria o UNIQUE(produto_id, cor, tamanho) e
      // derrubaria o cadastro inteiro. Erro claro em vez de "constraint failed".
      const chave = `${cor}|${tamanho}`;
      if (vistos.has(chave)) {
        throw Object.assign(new Error(`A peça "${cor} / ${tamanho}" aparece duas vezes na grade.`), { status: 400 });
      }
      vistos.add(chave);

      const codigoBarras = resolverCodigoBarras(g.codigo_barras, tenantId);
      const vinfo = insertVar.run(produtoId, cor, tamanho, qtd, codigoBarras, tenantId);
      if (qtd > 0) insertMov.run(vinfo.lastInsertRowid, qtd);
      skus.push({ id: vinfo.lastInsertRowid, cor, tamanho, quantidade: qtd, codigo_barras: codigoBarras });
    }
    if (!skus.length) {
      throw Object.assign(new Error('Informe pelo menos uma peça na grade (cor e tamanho).'), { status: 400 });
    }

    // galeria (fotos extras)
    if (Array.isArray(fotos)) {
      const resultFotos = salvarFotosExtras(produtoId, codigo, fotos, tenantId);
      if (!resultFotos.ok) throw new Error(resultFotos.erro);
    }
    return { produtoId, skus };
  });

  try {
    const { produtoId, skus } = tx();
    res.status(201).json({ id: produtoId, codigo, grade: skus });
  } catch (e) {
    if (e.status === 400) return res.status(400).json({ erro: e.message });
    // sobe pro handler central (server.js), que loga rota + stack. Responder 500
    // aqui engolia a causa e o erro chegava ao lojista como "Erro interno".
    next(e);
  }
});

// PUT /api/produtos/:id -> edita o produto e a matriz cor x tamanho
// A grade enviada e' o estado DESEJADO: SKU novo e' criado, SKU existente tem a
// quantidade/codigo atualizados. SKU que sumiu da matriz e' ZERADO, nao apagado —
// ver o porque logo abaixo.
router.put('/:id', limiteUploadPorTenant, limiteUploadFrequencia, (req, res, next) => {
  const tenantId = req.tenantId;
  const { nome, categoria, descricao, custo, preco_venda, foto, fotos, grade, colecao } = req.body;
  const p = db.prepare('SELECT id, codigo, foto FROM produtos WHERE id = ? AND tenant_id = ?').get(req.params.id, tenantId);
  if (!p) return res.status(404).json({ erro: 'Produto nao encontrado' });

  // foto: se vier base64 nova, salva; se vier caminho existente, mantem; se vazio, mantem o atual
  let fotoPath = p.foto;
  if (foto && foto.startsWith('data:image')) {
    const resultFoto = salvarFotoBase64(foto, p.codigo);
    if (!resultFoto.ok) return res.status(400).json({ erro: resultFoto.erro });
    fotoPath = resultFoto.caminho;
  } else if (foto === '') {
    fotoPath = null; // remocao explicita
  }

  const tx = db.transaction(() => {
    // produtos.cor NAO e' mais escrita (deprecada — a cor mora na variacao).
    db.prepare(`
      UPDATE produtos SET nome=?, categoria=?, descricao=?, custo=?, preco_venda=?, foto=?, colecao=?
      WHERE id=? AND tenant_id=?
    `).run(nome, categoria || null, descricao || null,
      parseFloat(custo) || 0, parseFloat(preco_venda) || 0, fotoPath, colecao || null, req.params.id, tenantId);

    // só mexe na galeria se 'fotos' foi enviado (undefined = não alterar)
    if (Array.isArray(fotos)) {
      const resultFotos = salvarFotosExtras(p.id, p.codigo, fotos, tenantId);
      if (!resultFotos.ok) throw new Error(resultFotos.erro);
    }

    if (!Array.isArray(grade)) return;   // grade ausente = nao mexer na matriz

    const existentes = db.prepare('SELECT id, cor, tamanho, quantidade, codigo_barras FROM variacoes WHERE produto_id = ?')
      .all(p.id);
    const porChave = new Map(existentes.map((v) => [`${v.cor}|${v.tamanho}`, v]));
    const insertVar = db.prepare('INSERT INTO variacoes (produto_id, cor, tamanho, quantidade, codigo_barras, tenant_id) VALUES (?, ?, ?, ?, ?, ?)');
    const insertMov = db.prepare("INSERT INTO movimentos_estoque (variacao_id, tipo, qtd, motivo) VALUES (?, 'ajuste', ?, ?)");

    const enviados = new Set();
    for (const g of grade) {
      const tamanho = normalizarTamanho(g.tamanho);
      if (!tamanho) continue;
      const cor = normalizarCor(g.cor);
      const qtd = Math.max(0, parseInt(g.quantidade, 10) || 0);
      const chave = `${cor}|${tamanho}`;
      if (enviados.has(chave)) {
        throw Object.assign(new Error(`A peça "${cor} / ${tamanho}" aparece duas vezes na grade.`), { status: 400 });
      }
      enviados.add(chave);

      const atual = porChave.get(chave);
      if (atual) {
        // Codigo de barras so muda se o lojista mandou um. Undefined = nao mexer
        // (senao editar a quantidade apagaria a etiqueta ja colada na peca).
        let codigoBarras = atual.codigo_barras;
        if (g.codigo_barras !== undefined && String(g.codigo_barras || '').trim() !== String(atual.codigo_barras || '')) {
          codigoBarras = resolverCodigoBarras(g.codigo_barras, tenantId, { variacaoIdIgnorar: atual.id, gerar: !atual.codigo_barras });
        }
        if (qtd !== atual.quantidade) {
          db.prepare('UPDATE variacoes SET quantidade = ?, codigo_barras = ? WHERE id = ?').run(qtd, codigoBarras, atual.id);
          // o ajuste de estoque na edicao tambem e' movimento: sem isso, o estoque
          // muda e o historico nao sabe explicar por que.
          insertMov.run(atual.id, qtd - atual.quantidade, 'edição do produto');
        } else {
          db.prepare('UPDATE variacoes SET codigo_barras = ? WHERE id = ?').run(codigoBarras, atual.id);
        }
      } else {
        const codigoBarras = resolverCodigoBarras(g.codigo_barras, tenantId);
        const vinfo = insertVar.run(p.id, cor, tamanho, qtd, codigoBarras, tenantId);
        if (qtd > 0) {
          db.prepare("INSERT INTO movimentos_estoque (variacao_id, tipo, qtd, motivo) VALUES (?, 'entrada', ?, 'nova peça na grade')")
            .run(vinfo.lastInsertRowid, qtd);
        }
      }
    }

    // SKU que sumiu da matriz: ZERA o estoque, mas NAO apaga a variacao.
    // Apagar dispararia ON DELETE CASCADE em movimentos_estoque (o historico da peca
    // evapora) e SET NULL em venda_itens (a venda antiga perde o vinculo e o relatorio
    // por cor passa a mentir). Zerado, o SKU some das telas de venda do mesmo jeito.
    const zera = db.prepare('UPDATE variacoes SET quantidade = 0 WHERE id = ?');
    for (const v of existentes) {
      if (enviados.has(`${v.cor}|${v.tamanho}`) || v.quantidade === 0) continue;
      zera.run(v.id);
      insertMov.run(v.id, -v.quantidade, 'peça removida da grade');
    }
  });
  try {
    tx();
    res.json({ ok: true });
  } catch (e) {
    if (e.status === 400) return res.status(400).json({ erro: e.message });
    next(e); // handler central loga rota + stack
  }
});

// DELETE /api/produtos/:id -> inativa (nao apaga, preserva historico de vendas)
router.delete('/:id', (req, res) => {
  const tenantId = req.tenantId;
  // O `AND tenant_id` isola: a loja A não apaga o produto da B. Mas sem checar
  // `changes` a rota respondia {ok:true} mesmo afetando 0 linhas — mentia "apagado"
  // pra um id de outra loja (ou inexistente). 404 é a resposta honesta.
  const r = db.prepare('UPDATE produtos SET ativo = 0 WHERE id = ? AND tenant_id = ?').run(req.params.id, tenantId);
  if (r.changes === 0) return res.status(404).json({ erro: 'Produto não encontrado' });
  res.json({ ok: true });
});

// POST /api/produtos/codigo-barras/gerar -> devolve um EAN-13 interno livre
// O botao "gerar" da matriz chama isto pra preencher a celula ANTES de salvar
// (o lojista ve o codigo e pode imprimir a etiqueta sabendo o que vai sair).
router.post('/codigo-barras/gerar', (req, res, next) => {
  try {
    res.json({ codigo_barras: gerarCodigoBarras() });
  } catch (e) { next(e); }
});

// POST /api/produtos/codigo-barras/verificar  body: { codigo, variacao_id? }
// Valida o codigo que o lojista bipou/colou: formato, digito verificador e se ja
// esta em uso por outra peca. A tela chama no blur do campo, pra avisar na hora em
// vez de deixar o erro estourar so no salvar.
router.post('/codigo-barras/verificar', (req, res) => {
  const val = validarCodigoBarras(req.body.codigo);
  if (!val.ok) return res.json({ ok: false, erro: val.erro });
  if (!val.codigo) return res.json({ ok: true, codigo: null });
  const varId = parseInt(req.body.variacao_id, 10) || null;
  if (codigoEmUso(val.codigo, req.tenantId, varId)) {
    return res.json({ ok: false, erro: `O código "${val.codigo}" já está em uso por outra peça.` });
  }
  res.json({ ok: true, codigo: val.codigo });
});

// Monta as etiquetas de UM produto: uma por PEÇA em estoque.
// A tela antiga imprimia N copias iguais do codigo do produto. Com SKU por cor isso
// cola a etiqueta do preto na peca vermelha: se ha 3 pretos M e 2 vermelhos G, tem
// que sair 3 etiquetas do SKU preto-M e 2 do vermelho-G.
function etiquetasDe(produto, grade) {
  const etiquetas = [];
  for (const v of grade) {
    if (v.quantidade <= 0) continue;
    // Cadastro ANTIGO (pre-029) nao tem codigo no SKU: cai no codigo do produto, que
    // e' justamente o que ja esta impresso na etiqueta colada naquela peca. Sem o
    // fallback ela sairia sem codigo nenhum.
    const codigo = v.codigo_barras || produto.codigo_barras || null;
    for (let i = 0; i < v.quantidade; i++) {
      etiquetas.push({
        variacao_id: v.id, produto_id: produto.id,
        nome: produto.nome, codigo: produto.codigo,
        cor: v.cor, tamanho: v.tamanho,
        preco_venda: produto.preco_venda, codigo_barras: codigo,
      });
    }
  }
  return etiquetas;
}

// GET /api/produtos/:id/etiquetas -> uma etiqueta por PEÇA em estoque
// (o modo LOTE — /etiquetas?ids=1,2,3 — está registrado lá em cima, antes do
// GET /:id: o Express casa as rotas na ordem, e /:id capturaria a palavra "etiquetas")
router.get('/:id/etiquetas', (req, res) => {
  const p = db.prepare(`SELECT ${COLUNAS_ETIQUETA} FROM produtos WHERE id = ? AND tenant_id = ?`)
    .get(req.params.id, req.tenantId);
  if (!p) return res.status(404).json({ erro: 'Produto nao encontrado' });

  const grade = gradeDe([p.id]).get(p.id) || [];
  res.json({
    produto: { id: p.id, nome: p.nome, codigo: p.codigo },
    grade,                                   // a tela usa pra deixar ajustar a qtd por SKU
    etiquetas: etiquetasDe(p, grade),
  });
});

// POST /api/produtos/sugerir-preco  body: { custo }
router.post('/sugerir-preco', exigirFeature('precificacao'), (req, res) => {
  const custo = parseFloat(req.body.custo) || 0;
  const preco = sugerirPreco(custo, req.tenantId);
  res.json({ preco, analise: analisarPreco(custo, preco, { tenantId: req.tenantId }) });
});

// POST /api/produtos/analisar-preco  body: { custo, preco_venda }
router.post('/analisar-preco', exigirFeature('precificacao'), (req, res) => {
  const custo = parseFloat(req.body.custo) || 0;
  const preco = parseFloat(req.body.preco_venda) || 0;
  res.json(analisarPreco(custo, preco, { tenantId: req.tenantId }));
});

// NOTA: havia um segundo DELETE /:id aqui (hard-delete) que era CÓDIGO MORTO —
// o Express usa o primeiro handler registrado (o soft-delete `ativo=0` acima, que
// preserva o histórico de vendas). O segundo nunca rodava e contradizia o primeiro.
// Removido para não confundir manutenção. Se um dia precisar de hard-delete de
// produto, faça uma rota com verbo/caminho distinto (ex: DELETE /:id/permanente).

module.exports = router;
