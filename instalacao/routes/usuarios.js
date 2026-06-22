// ============================================================
// API de USUÁRIOS (só admin) — cria/lista/desativa logins com papel.
// O admin principal vem do .env e NÃO aparece aqui (é superusuário).
// A proteção apenasAdmin é aplicada no server.js ao montar a rota.
// ============================================================
const express = require('express');
const router = express.Router();
const { db } = require('../db/database');
const { hashSenha, validarSenha, validarNaoReutilizada } = require('../middleware/seguranca');

const PAPEIS = ['admin', 'relacionamento', 'vendedor'];

// GET /api/usuarios -> lista (NUNCA retorna senha_hash)
router.get('/', (_req, res) => {
  const rows = db.prepare('SELECT id, nome, papel, ativo, criado_em FROM usuarios ORDER BY nome').all();
  res.json(rows);
});

// POST /api/usuarios { nome, senha, papel }
router.post('/', (req, res) => {
  const nome = String(req.body.nome || '').trim();
  const senha = String(req.body.senha || '');
  const papel = PAPEIS.includes(req.body.papel) ? req.body.papel : 'relacionamento';
  if (nome.length < 2) return res.status(400).json({ erro: 'Informe um nome de usuário válido' });

  const validacaoSenha = validarSenha(senha);
  if (***REMOVED***validacaoSenha.valida) {
    return res.status(400).json({ erro: validacaoSenha.erro });
  }

  const existe = db.prepare('SELECT id FROM usuarios WHERE LOWER(nome) = LOWER(?)').get(nome);
  if (existe) return res.status(409).json({ erro: 'Já existe um usuário com esse nome' });

  const info = db.prepare('INSERT INTO usuarios (nome, senha_hash, papel) VALUES (?, ?, ?)')
    .run(nome, hashSenha(senha), papel);
  res.status(201).json({ ok: true, id: info.lastInsertRowid, nome, papel });
});

// PATCH /api/usuarios/:id/ativo { ativo: 0|1 }
router.patch('/:id/ativo', (req, res) => {
  const ativo = req.body.ativo ? 1 : 0;
  db.prepare('UPDATE usuarios SET ativo = ? WHERE id = ?').run(ativo, req.params.id);
  res.json({ ok: true, ativo });
});

// PATCH /api/usuarios/:id/senha { senha }
router.patch('/:id/senha', (req, res) => {
  const senha = String(req.body.senha || '');

  const validacaoSenha = validarSenha(senha);
  if (***REMOVED***validacaoSenha.valida) {
    return res.status(400).json({ erro: validacaoSenha.erro });
  }

  const user = db.prepare('SELECT senha_hash FROM usuarios WHERE id = ?').get(req.params.id);
  if (user) {
    const naoReutilizada = validarNaoReutilizada(senha, user.senha_hash);
    if (***REMOVED***naoReutilizada.valida) {
      return res.status(400).json({ erro: naoReutilizada.erro });
    }
  }

  db.prepare('UPDATE usuarios SET senha_hash = ? WHERE id = ?').run(hashSenha(senha), req.params.id);
  res.json({ ok: true });
});

// DELETE /api/usuarios/:id
router.delete('/:id', (req, res) => {
  db.prepare('DELETE FROM usuarios WHERE id = ?').run(req.params.id);
  res.json({ ok: true });
});

module.exports = router;
