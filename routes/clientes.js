// ============================================================
// API de CLIENTES (cadastro, historico, busca, arquivar, indicação)
// ============================================================
const express = require('express');
const router = express.Router();
const { db } = require('../db/database');
const { cpf, cnpj } = require('cpf-cnpj-validator');

// Validar email (RFC 5322 simplificado)
function validarEmail(email) {
  if (!email || email.trim() === '') return { valido: true, erro: null };
  const regex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!regex.test(email)) {
    return { valido: false, erro: 'Email inválido' };
  }
  if (email.length > 255) {
    return { valido: false, erro: 'Email muito longo' };
  }
  return { valido: true, erro: null };
}

// Validar CPF ou CNPJ
function validarCPFCNPJ(valor) {
  if (!valor || valor.trim() === '') return { valido: true, erro: null, tipo: null };

  // Remove caracteres especiais
  const limpo = valor.replace(/\D/g, '');

  // Testa CPF (11 dígitos)
  if (limpo.length === 11) {
    if (cpf.isValid(limpo)) {
      return { valido: true, erro: null, tipo: 'CPF', valor: limpo };
    }
    return { valido: false, erro: 'CPF inválido', tipo: 'CPF' };
  }

  // Testa CNPJ (14 dígitos)
  if (limpo.length === 14) {
    if (cnpj.isValid(limpo)) {
      return { valido: true, erro: null, tipo: 'CNPJ', valor: limpo };
    }
    return { valido: false, erro: 'CNPJ inválido', tipo: 'CNPJ' };
  }

  return { valido: false, erro: 'CPF ou CNPJ inválido (deve ter 11 ou 14 dígitos)', tipo: null };
}

// Guard de papel: o VENDEDOR (PDV) só pode buscar (GET) e cadastrar (POST /) cliente.
// Editar, excluir, arquivar, opt-out e rankings são de admin + relacionamento.
router.use((req, res, next) => {
  const papel = req.session && req.session.papel;
  if (papel !== 'vendedor') return next(); // admin e relacionamento: acesso pleno
  const ehBusca = req.method === 'GET';
  const ehCadastro = req.method === 'POST' && (req.path === '/' || req.path === '');
  if (ehBusca || ehCadastro) return next();
  return res.status(403).json({ erro: 'Sem permissão para esta área' });
});

// GET /api/clientes?busca=&arquivados=1
router.get('/', (req, res) => {
  const { busca, arquivados } = req.query;
  let sql = 'SELECT * FROM clientes WHERE tenant_id = ?';
  const params = [req.tenantId];
  // por padrão esconde arquivados; ?arquivados=1 mostra também
  if (arquivados !== '1') sql += ' AND arquivado = 0';
  if (busca) { sql += ' AND (nome LIKE ? OR telefone LIKE ?)'; params.push(`%${busca}%`, `%${busca}%`); }
  sql += ' ORDER BY nome';
  res.json(db.prepare(sql).all(...params));
});

// GET /api/clientes/ranking-indicacoes -> quem mais indica (top)
router.get('/ranking-indicacoes', (req, res) => {
  const rows = db.prepare(`
    SELECT c.id, c.nome, c.telefone, COUNT(i.id) AS indicou
    FROM clientes c JOIN clientes i ON i.indicada_por = c.id AND i.tenant_id = c.tenant_id
    WHERE c.tenant_id = ?
    GROUP BY c.id ORDER BY indicou DESC, c.nome LIMIT 20
  `).all(req.tenantId);
  res.json(rows);
});

// GET /api/clientes/:id -> dados + historico de compras + quem ela indicou
router.get('/:id', (req, res) => {
  const c = db.prepare('SELECT * FROM clientes WHERE id = ? AND tenant_id = ?').get(req.params.id, req.tenantId);
  if (!c) return res.status(404).json({ erro: 'Cliente nao encontrado' });
  c.compras = db.prepare(`
    SELECT id, data_hora, total, forma_pagamento, origem FROM vendas WHERE cliente_id = ? AND tenant_id = ? ORDER BY data_hora DESC
  `).all(c.id, req.tenantId);
  const getItens = db.prepare('SELECT descricao, qtd, preco_unit FROM venda_itens WHERE venda_id = ? AND tenant_id = ?');
  for (const compra of c.compras) compra.itens = getItens.all(compra.id, req.tenantId);
  // quem indicou esta cliente (nome) e quantas ela já indicou
  if (c.indicada_por) {
    const ind = db.prepare('SELECT nome FROM clientes WHERE id = ? AND tenant_id = ?').get(c.indicada_por, req.tenantId);
    c.indicada_por_nome = ind ? ind.nome : null;
  }
  c.indicou = db.prepare('SELECT COUNT(*) AS n FROM clientes WHERE indicada_por = ? AND tenant_id = ?').get(c.id, req.tenantId).n;
  res.json(c);
});

// POST /api/clientes
// Anti-duplicado: se já existe cliente com o MESMO telefone (comparando só dígitos),
// não cria de novo — devolve o existente com a flag `ja_existia` pro PDV já selecioná-lo.
router.post('/', (req, res) => {
  const { nome, telefone, cidade, aniversario, origem, indicada_por, email, cpf_cnpj } = req.body;
  if (!nome) return res.status(400).json({ erro: 'Nome obrigatorio' });

  // Validar email (se fornecido)
  const valEmail = validarEmail(email);
  if (!valEmail.valido) return res.status(400).json({ erro: valEmail.erro });

  // Validar CPF/CNPJ (se fornecido)
  const valCPFCNPJ = validarCPFCNPJ(cpf_cnpj);
  if (!valCPFCNPJ.valido) return res.status(400).json({ erro: valCPFCNPJ.erro });
  const cpf_cnpj_limpo = valCPFCNPJ.valor || null;

  const telDigitos = String(telefone || '').replace(/\D/g, '');
  if (telDigitos.length >= 8) {
    // procura cliente (não arquivado) com o mesmo telefone, ignorando formatação
    const existente = db.prepare(
      `SELECT * FROM clientes WHERE tenant_id = ? AND arquivado = 0 AND REPLACE(REPLACE(REPLACE(REPLACE(telefone,'(',''),')',''),'-',''),' ','') LIKE ?`
    ).get(req.tenantId, '%' + telDigitos + '%');
    if (existente) {
      return res.json({ id: existente.id, nome: existente.nome, telefone: existente.telefone, ja_existia: true });
    }
  }

  // Verificar email duplicado (se fornecido)
  if (email && email.trim() !== '') {
    const emailExistente = db.prepare(
      'SELECT id FROM clientes WHERE email = ? AND tenant_id = ? AND id != ?'
    ).get(email.toLowerCase(), req.tenantId, 0);
    if (emailExistente) {
      return res.status(400).json({ erro: 'Este email já está cadastrado' });
    }
  }

  const info = db.prepare('INSERT INTO clientes (tenant_id, nome, telefone, cidade, aniversario, origem, indicada_por, email, email_verificado, cpf_cnpj) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
    .run(req.tenantId, nome, telefone || null, cidade || null, aniversario || null, origem || null, indicada_por || null, email ? email.toLowerCase() : null, 0, cpf_cnpj_limpo);
  res.status(201).json({ id: info.lastInsertRowid, nome, email: email || null, cpf_cnpj: cpf_cnpj_limpo || null, ja_existia: false });
});

// PUT /api/clientes/:id
router.put('/:id', (req, res) => {
  const { nome, telefone, cidade, aniversario, origem, indicada_por, email, cpf_cnpj } = req.body;

  // Validar email (se fornecido)
  const valEmail = validarEmail(email);
  if (!valEmail.valido) return res.status(400).json({ erro: valEmail.erro });

  // Validar CPF/CNPJ (se fornecido)
  const valCPFCNPJ = validarCPFCNPJ(cpf_cnpj);
  if (!valCPFCNPJ.valido) return res.status(400).json({ erro: valCPFCNPJ.erro });
  const cpf_cnpj_limpo = valCPFCNPJ.valor || null;

  // Verificar email duplicado (se fornecido)
  if (email && email.trim() !== '') {
    const emailExistente = db.prepare(
      'SELECT id FROM clientes WHERE email = ? AND tenant_id = ? AND id != ?'
    ).get(email.toLowerCase(), req.tenantId, req.params.id);
    if (emailExistente) {
      return res.status(400).json({ erro: 'Este email já está cadastrado' });
    }
  }

  db.prepare('UPDATE clientes SET nome=?, telefone=?, cidade=?, aniversario=?, origem=?, indicada_por=?, email=?, cpf_cnpj=? WHERE id=? AND tenant_id=?')
    .run(nome, telefone || null, cidade || null, aniversario || null, origem || null, indicada_por || null, email ? email.toLowerCase() : null, cpf_cnpj_limpo, req.params.id, req.tenantId);
  res.json({ ok: true });
});

// PATCH /api/clientes/:id/arquivar   body: { arquivado: 0|1 }
router.patch('/:id/arquivar', (req, res) => {
  const v = req.body.arquivado ? 1 : 0;
  db.prepare('UPDATE clientes SET arquivado = ? WHERE id = ? AND tenant_id = ?').run(v, req.params.id, req.tenantId);
  res.json({ ok: true, arquivado: v });
});

// PATCH /api/clientes/:id/nao-perturbe   body: { nao_perturbe: 0|1 }
router.patch('/:id/nao-perturbe', (req, res) => {
  const v = req.body.nao_perturbe ? 1 : 0;
  db.prepare('UPDATE clientes SET nao_perturbe = ? WHERE id = ? AND tenant_id = ?').run(v, req.params.id, req.tenantId);
  res.json({ ok: true, nao_perturbe: v });
});

// DELETE /api/clientes/:id  -> só permite excluir quem NÃO tem compras (senão, arquivar)
router.delete('/:id', (req, res) => {
  const id = req.params.id;
  const temVenda = db.prepare('SELECT COUNT(*) AS n FROM vendas WHERE cliente_id = ? AND tenant_id = ?').get(id, req.tenantId).n;
  if (temVenda > 0) {
    return res.status(400).json({ erro: `Este cliente tem ${temVenda} compra(s) no histórico. Em vez de excluir (que apagaria o vínculo das vendas), arquive o cliente.` });
  }
  // limpa indicações que apontavam pra ele (não quebra os indicados)
  db.prepare('UPDATE clientes SET indicada_por = NULL WHERE indicada_por = ? AND tenant_id = ?').run(id, req.tenantId);
  db.prepare('DELETE FROM clientes WHERE id = ? AND tenant_id = ?').run(id, req.tenantId);
  res.json({ ok: true });
});

module.exports = router;
