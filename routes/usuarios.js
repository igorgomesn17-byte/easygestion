// ============================================================
// API de USUÁRIOS (só admin) — cria/lista/desativa logins com papel.
// O admin principal vem do .env e NÃO aparece aqui (é superusuário).
// A proteção apenasAdmin é aplicada no server.js ao montar a rota.
// ============================================================
const express = require('express');
const router = express.Router();
const { db } = require('../db/database');
const { hashSenha, validarSenha, validarNaoReutilizada, exigirDentroDoLimite } = require('../middleware/seguranca');

// Conta usuários ativos do tenant (para o limite por plano).
const contarUsuarios = (tenantId) =>
  db.prepare('SELECT COUNT(*) AS n FROM usuarios WHERE tenant_id = ? AND ativo = 1').get(tenantId).n;

const PAPEIS = ['admin', 'relacionamento', 'vendedor'];

// GET /api/usuarios -> lista (NUNCA retorna senha_hash)
router.get('/', (req, res) => {
  const rows = db.prepare('SELECT id, nome, email, papel, ativo, criado_em FROM usuarios WHERE tenant_id = ? ORDER BY nome').all(req.tenantId);
  res.json(rows);
});

// POST /api/usuarios { nome, email, senha, papel }
// O EMAIL e' obrigatorio: o login (routes/auth.js) autentica por email e exige
// email_verificado=1. Sem isso, o usuario criado aqui nunca conseguia entrar.
// Como quem cria e' o admin da loja (nao e' autocadastro), ja nasce verificado.
router.post('/', exigirDentroDoLimite('usuarios', contarUsuarios), (req, res) => {
  const nome = String(req.body.nome || '').trim();
  const email = String(req.body.email || '').trim().toLowerCase();
  const senha = String(req.body.senha || '');
  const papel = PAPEIS.includes(req.body.papel) ? req.body.papel : 'relacionamento';
  if (nome.length < 2) return res.status(400).json({ erro: 'Informe um nome de usuário válido' });
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return res.status(400).json({ erro: 'Informe um email válido (é com ele que a pessoa entra no sistema)' });

  const validacaoSenha = validarSenha(senha);
  if (!validacaoSenha.valida) {
    return res.status(400).json({ erro: validacaoSenha.erro });
  }

  const existe = db.prepare('SELECT id FROM usuarios WHERE LOWER(nome) = LOWER(?) AND tenant_id = ?').get(nome, req.tenantId);
  if (existe) return res.status(409).json({ erro: 'Já existe um usuário com esse nome' });
  // email e' UNIQUE(tenant_id, email) no schema, mas o login busca por email SEM
  // filtrar tenant — dois tenants com o mesmo email brigariam. Checa global.
  const emailUsado = db.prepare('SELECT id FROM usuarios WHERE LOWER(email) = LOWER(?)').get(email);
  if (emailUsado) return res.status(409).json({ erro: 'Esse email já está em uso' });

  const info = db.prepare('INSERT INTO usuarios (nome, email, senha_hash, papel, tenant_id, email_verificado) VALUES (?, ?, ?, ?, ?, 1)')
    .run(nome, email, hashSenha(senha), papel, req.tenantId);
  res.status(201).json({ ok: true, id: info.lastInsertRowid, nome, email, papel });
});

// PATCH /api/usuarios/:id/ativo { ativo: 0|1 }
router.patch('/:id/ativo', (req, res) => {
  const ativo = req.body.ativo ? 1 : 0;
  const user = db.prepare('SELECT id FROM usuarios WHERE id = ? AND tenant_id = ?').get(req.params.id, req.tenantId);
  if (!user) return res.status(403).json({ erro: 'Usuário não encontrado ou acesso negado' });
  db.prepare('UPDATE usuarios SET ativo = ? WHERE id = ? AND tenant_id = ?').run(ativo, req.params.id, req.tenantId);
  res.json({ ok: true, ativo });
});

// PATCH /api/usuarios/:id/senha { senha }
router.patch('/:id/senha', (req, res) => {
  const senha = String(req.body.senha || '');

  const validacaoSenha = validarSenha(senha);
  if (!validacaoSenha.valida) {
    return res.status(400).json({ erro: validacaoSenha.erro });
  }

  const user = db.prepare('SELECT senha_hash FROM usuarios WHERE id = ? AND tenant_id = ?').get(req.params.id, req.tenantId);
  if (!user) return res.status(403).json({ erro: 'Usuário não encontrado ou acesso negado' });

  const naoReutilizada = validarNaoReutilizada(senha, user.senha_hash);
  if (!naoReutilizada.valida) {
    return res.status(400).json({ erro: naoReutilizada.erro });
  }

  db.prepare('UPDATE usuarios SET senha_hash = ? WHERE id = ? AND tenant_id = ?').run(hashSenha(senha), req.params.id, req.tenantId);
  res.json({ ok: true });
});

// DELETE /api/usuarios/:id
router.delete('/:id', (req, res) => {
  const user = db.prepare('SELECT id FROM usuarios WHERE id = ? AND tenant_id = ?').get(req.params.id, req.tenantId);
  if (!user) return res.status(403).json({ erro: 'Usuário não encontrado ou acesso negado' });
  db.prepare('DELETE FROM usuarios WHERE id = ? AND tenant_id = ?').run(req.params.id, req.tenantId);
  res.json({ ok: true });
});

module.exports = router;
