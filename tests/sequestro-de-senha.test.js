// ============================================================
// O teste que mais importa desta leva: a Maria da loja B NAO pode trocar a senha da
// Maria da loja A.
//
// PATCH /api/me/senha e DELETE /api/me/conta buscavam o usuario logado assim:
//
//     SELECT * FROM usuarios WHERE nome = ?     <- req.session.usuario
//
// SEM filtrar a loja. Isso funcionava por ACIDENTE: `nome` era UNIQUE global, entao
// so existia uma linha. A migration 035 (nome unico POR LOJA) tira esse acidente do
// caminho — e sem a correcao do auth.js, o SELECT passaria a devolver a primeira
// "Maria" por ordem de rowid, e o UPDATE gravaria a senha nova na conta de OUTRA LOJA.
//
// Ou seja: consertar so o schema ABRIRIA um buraco de sequestro de conta. Este teste
// e' a prova de que os dois consertos andam juntos.
//
// Sobe o servidor de verdade (nao um mock) contra um banco temporario, como faz o
// test:cross-tenant. Rodar: node tests/sequestro-de-senha.test.js
// ============================================================

const assert = require('assert');
const { DatabaseSync } = require('node:sqlite');
const path = require('path');
const fs = require('fs');

const BASE = process.env.BASE_URL || 'http://localhost:3003';
const DB_DIR = process.env.DB_DIR || path.join(__dirname, '.tmp-sequestro');
const DB_PATH = path.join(DB_DIR, 'dsstore.db');

const SENHA_A = 'SenhaDaLojaA#2026';
const SENHA_B = 'SenhaDaLojaB#2026';

// Cria as duas lojas com uma "Maria" cada — o cenario que so passa a existir DEPOIS
// da migration 035, e que e' exatamente onde o bug moraria.
function semear() {
  const { hashSenha } = require('../middleware/seguranca');
  const db = new DatabaseSync(DB_PATH);

  const tenant = db.prepare(`
    INSERT INTO tenants (nome_loja, nome_responsavel, telefone, email, senha_hash, plano, status)
    VALUES (?, ?, ?, ?, ?, 'growth', 'ativo')
  `);
  const tA = Number(tenant.run('Loja A', 'Maria A', '73999990001', 'lojaA@teste.com', hashSenha('x')).lastInsertRowid);
  const tB = Number(tenant.run('Loja B', 'Maria B', '73999990002', 'lojaB@teste.com', hashSenha('x')).lastInsertRowid);

  const insU = db.prepare(`
    INSERT INTO usuarios (nome, email, senha_hash, papel, tenant_id, ativo, email_verificado)
    VALUES (?, ?, ?, 'admin', ?, 1, 1)
  `);
  // MESMO NOME nas duas lojas. Antes da 035 este segundo INSERT nem passava.
  const idA = Number(insU.run('Maria', 'maria@lojaA.com', hashSenha(SENHA_A), tA).lastInsertRowid);
  const idB = Number(insU.run('Maria', 'maria@lojaB.com', hashSenha(SENHA_B), tB).lastInsertRowid);

  db.close();
  return { idA, idB };
}

function hashDe(id) {
  const db = new DatabaseSync(DB_PATH, { readOnly: true });
  const h = db.prepare('SELECT senha_hash FROM usuarios WHERE id = ?').get(id).senha_hash;
  db.close();
  return h;
}

// fetch guardando o cookie de sessao
async function req(caminho, opts = {}, cookie = null) {
  const headers = { 'Content-Type': 'application/json', ...(opts.headers || {}) };
  if (cookie) headers.Cookie = cookie;
  const r = await fetch(BASE + caminho, { ...opts, headers, redirect: 'manual' });
  const setCookie = r.headers.get('set-cookie');
  let corpo = null;
  try { corpo = await r.json(); } catch { /* pode nao ter corpo */ }
  return { status: r.status, corpo, cookie: setCookie ? setCookie.split(';')[0] : cookie };
}

async function rodar() {
  console.log('\n🔒 TESTE: sequestro de senha entre lojas\n');
  const { idA, idB } = semear();

  // 1. A Maria da loja B entra.
  const login = await req('/api/login', {
    method: 'POST',
    body: JSON.stringify({ email: 'maria@lojaB.com', senha: SENHA_B }),
  });
  assert.strictEqual(login.status, 200, `login da loja B falhou: ${JSON.stringify(login.corpo)}`);
  assert.ok(login.cookie, 'login nao devolveu cookie de sessao');
  console.log('  ✓ Maria da loja B logou');

  const hashAntesA = hashDe(idA);
  const hashAntesB = hashDe(idB);

  // 2. Ela troca a PROPRIA senha.
  const novaSenhaB = 'NovaSenhaDaB#2026';
  const troca = await req('/api/me/senha', {
    method: 'PATCH',
    body: JSON.stringify({ senha_atual: SENHA_B, senha_nova: novaSenhaB }),
  }, login.cookie);
  assert.strictEqual(troca.status, 200, `a troca de senha da propria conta falhou: ${JSON.stringify(troca.corpo)}`);
  console.log('  ✓ trocou a propria senha');

  // 3. A PROVA: a senha da loja A NAO pode ter sido tocada.
  const hashDepoisA = hashDe(idA);
  const hashDepoisB = hashDe(idB);

  assert.strictEqual(
    hashDepoisA, hashAntesA,
    '💥 SEQUESTRO: a troca de senha da loja B alterou a senha da MARIA DA LOJA A'
  );
  assert.notStrictEqual(
    hashDepoisB, hashAntesB,
    'a senha da propria loja B nao mudou — a rota nao fez o que devia'
  );
  console.log('  ✅ a senha da loja A ficou INTACTA (o sequestro nao acontece)');

  // 4. E a Maria da loja A ainda entra com a senha VELHA dela.
  const loginA = await req('/api/login', {
    method: 'POST',
    body: JSON.stringify({ email: 'maria@lojaA.com', senha: SENHA_A }),
  });
  assert.strictEqual(loginA.status, 200, 'a Maria da loja A perdeu o acesso — a senha dela foi mexida');
  console.log('  ✓ Maria da loja A continua entrando com a senha dela');

  // 5. A sessao guarda o usuario_id (e' o que torna a busca inequivoca — e o que a
  //    auditoria LGPD sempre leu e nunca recebia).
  const me = await req('/api/me', {}, login.cookie);
  assert.strictEqual(me.status, 200);
  console.log('  ✓ sessao valida apos a troca');

  console.log('\n✅ PASSOU: uma loja nao alcanca a senha da outra\n');
}

// O banco temporario e' criado (e limpo) por quem sobe o servidor — ver o comando no
// topo. Nao apagamos daqui: no Windows o arquivo esta aberto pelo servidor e o rm
// falha com EPERM.

rodar().then(() => process.exit(0)).catch((e) => {
  console.error('\n❌ FALHOU:', e.message, '\n');
  process.exit(1);
});
