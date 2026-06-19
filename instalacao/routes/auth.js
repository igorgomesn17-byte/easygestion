// ============================================================
// API de AUTENTICAÇÃO: login, logout, quem-sou
// Senha admin vem da variável de ambiente ADMIN_SENHA (nunca no código).
// ============================================================
const express = require('express');
const router = express.Router();
const { db, getConfig } = require('../db/database');
const { hashSenha, verificarSenha } = require('../middleware/seguranca');

// Resolve o hash da senha admin:
// 1) ADMIN_SENHA_HASH (já em hash) tem prioridade;
// 2) senão ADMIN_SENHA (texto) é hasheada em memória no boot;
// 3) senão (dev local sem env) usa fallback 'dsstore' — APENAS local.
let HASH_ADMIN = null;
function hashAdmin() {
  if (HASH_ADMIN) return HASH_ADMIN;
  if (process.env.ADMIN_SENHA_HASH) HASH_ADMIN = process.env.ADMIN_SENHA_HASH;
  else if (process.env.ADMIN_SENHA) HASH_ADMIN = hashSenha(process.env.ADMIN_SENHA);
  else HASH_ADMIN = hashSenha('dsstore'); // fallback DEV — em produção sempre setar ADMIN_SENHA
  return HASH_ADMIN;
}

function usuarioAdmin() { return getConfig('admin_usuario', 'igor'); }

// POST /api/login  body: { usuario?, senha }
// Precedência: (1) admin do .env (superusuário, como sempre); (2) usuário da tabela.
router.post('/login', (req, res) => {
  const { usuario, senha } = req.body || {};

  // (1) admin do ambiente — usuário vazio ou batendo com o admin
  const ehAdminEnv = ***REMOVED***usuario || String(usuario).toLowerCase() === usuarioAdmin().toLowerCase();
  if (ehAdminEnv && senha && verificarSenha(senha, hashAdmin())) {
    req.session.logado = true;
    req.session.usuario = usuarioAdmin();
    req.session.papel = 'admin';
    console.log(`[LOGIN OK] ${usuarioAdmin()} (admin) • ${req.ip} • ${new Date().toISOString()}`);
    return res.json({ ok: true, usuario: usuarioAdmin(), papel: 'admin', destino: 'index.html' });
  }

  // (2) usuário nomeado na tabela (ativo)
  if (usuario && senha) {
    const u = db.prepare('SELECT * FROM usuarios WHERE LOWER(nome) = LOWER(?) AND ativo = 1').get(String(usuario).trim());
    if (u && verificarSenha(senha, u.senha_hash)) {
      req.session.logado = true;
      req.session.usuario = u.nome;
      req.session.papel = u.papel;
      const destino = u.papel === 'admin' ? 'index.html'
        : u.papel === 'vendedor' ? 'pdv.html'
        : 'relacionamento.html';
      console.log(`[LOGIN OK] ${u.nome} (${u.papel}) • ${req.ip} • ${new Date().toISOString()}`);
      return res.json({ ok: true, usuario: u.nome, papel: u.papel, destino });
    }
  }

  console.warn(`[LOGIN FALHA] ${usuario || '(admin)'} • ${req.ip} • ${new Date().toISOString()}`);
  return res.status(401).json({ erro: 'Usuário ou senha inválidos' });
});

// POST /api/logout
router.post('/logout', (req, res) => {
  req.session.destroy(() => res.json({ ok: true }));
});

// GET /api/me  -> quem está logado (usado pela guarda de páginas)
router.get('/me', (req, res) => {
  if (req.session && req.session.logado)
    return res.json({ logado: true, usuario: req.session.usuario, papel: req.session.papel || 'admin' });
  return res.status(401).json({ logado: false });
});

// POST /api/login-sem-senha  body: { usuario? }
// Login sem necessidade de senha - apenas usuário
router.post('/login-sem-senha', (req, res) => {
  const usuario = (req.body?.usuario || '').trim();

  // Se vazio ou "admin", loga como admin
  if (***REMOVED***usuario || usuario.toLowerCase() === 'admin') {
    req.session.logado = true;
    req.session.usuario = 'admin';
    req.session.papel = 'admin';
    console.log(`[LOGIN OK] admin (sem senha) • ${req.ip} • ${new Date().toISOString()}`);
    return res.json({ ok: true, usuario: 'admin', papel: 'admin', destino: 'index.html' });
  }

  // Tenta buscar usuário na tabela
  const u = db.prepare('SELECT * FROM usuarios WHERE LOWER(nome) = LOWER(?) AND ativo = 1').get(usuario);
  if (u) {
    req.session.logado = true;
    req.session.usuario = u.nome;
    req.session.papel = u.papel;
    const destino = u.papel === 'admin' ? 'index.html'
      : u.papel === 'vendedor' ? 'pdv.html'
      : 'relacionamento.html';
    console.log(`[LOGIN OK] ${u.nome} (${u.papel}, sem senha) • ${req.ip} • ${new Date().toISOString()}`);
    return res.json({ ok: true, usuario: u.nome, papel: u.papel, destino });
  }

  // Cria usuário ad-hoc como admin se não existir
  req.session.logado = true;
  req.session.usuario = usuario;
  req.session.papel = 'admin';
  console.log(`[LOGIN OK] ${usuario} (admin ad-hoc, sem senha) • ${req.ip} • ${new Date().toISOString()}`);
  return res.json({ ok: true, usuario: usuario, papel: 'admin', destino: 'index.html' });
});

module.exports = router;
