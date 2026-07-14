// ============================================================
// O dono de uma loja NAO pode entrar no backoffice do SaaS.
//
// O guard exigirAdminBackoffice checava `papel === 'admin'`. Mas TODO dono de loja e'
// gravado com papel='admin' (e' o admin da loja dele). Entao qualquer cliente pagante
// logado alcancava /api/admin/*: mudava o proprio plano pra Growth de graca, lia a
// base de clientes de TODAS as lojas (email, telefone, CPF, faturamento) e via o MRR.
//
// A marca do admin de VERDADE e' session.admin_id, gravado so apos senha + 2FA contra
// a tabela `admins`. O dono de loja nunca tem admin_id.
//
// Sobe o servidor de verdade. Rodar: node tests/backoffice-so-admin.test.js
// ============================================================

const assert = require('assert');
const { DatabaseSync } = require('node:sqlite');
const path = require('path');

const BASE = process.env.BASE_URL || 'http://localhost:3004';
const DB_PATH = path.join(process.env.DB_DIR || path.join(__dirname, '.tmp-backoffice'), 'dsstore.db');

const SENHA = 'DonaDaLoja#2026';

function semearDonoDeLoja() {
  const { hashSenha } = require('../middleware/seguranca');
  const db = new DatabaseSync(DB_PATH);
  const t = Number(db.prepare(`
    INSERT INTO tenants (nome_loja, nome_responsavel, telefone, email, senha_hash, plano, status)
    VALUES (?, ?, ?, ?, ?, 'starter', 'ativo')
  `).run('Loja do Fulano', 'Fulano', '73999990009', 'fulano@loja.com', hashSenha('x')).lastInsertRowid);

  // Dono de loja: papel='admin' (o admin da loja DELE), como o registro real grava.
  db.prepare(`
    INSERT INTO usuarios (nome, email, senha_hash, papel, tenant_id, ativo, email_verificado)
    VALUES (?, ?, ?, 'admin', ?, 1, 1)
  `).run('Fulano', 'fulano@loja.com', hashSenha(SENHA), t);
  db.close();
}

async function req(caminho, opts = {}, cookie = null) {
  const headers = { 'Content-Type': 'application/json', ...(opts.headers || {}) };
  if (cookie) headers.Cookie = cookie;
  const r = await fetch(BASE + caminho, { ...opts, headers, redirect: 'manual' });
  const setCookie = r.headers.get('set-cookie');
  let corpo = null;
  try { corpo = await r.json(); } catch { /* ok */ }
  return { status: r.status, corpo, cookie: setCookie ? setCookie.split(';')[0] : cookie };
}

async function rodar() {
  console.log('\n🔒 TESTE: dono de loja NAO acessa o backoffice do SaaS\n');
  semearDonoDeLoja();

  // O dono de loja loga normalmente (login de LOJA, nao de backoffice).
  const login = await req('/api/login', {
    method: 'POST',
    body: JSON.stringify({ email: 'fulano@loja.com', senha: SENHA }),
  });
  assert.strictEqual(login.status, 200, `login do dono falhou: ${JSON.stringify(login.corpo)}`);
  assert.ok(login.cookie, 'login nao devolveu cookie');
  console.log('  ✓ dono de loja logou (papel=admin, mas SEM admin_id)');

  // As portas do backoffice que vazariam dado de TODAS as lojas ou dariam upgrade gratis.
  const rotasProibidas = [
    ['GET',   '/api/admin/clientes'],           // base de clientes de todo mundo
    ['GET',   '/api/admin/financeiro'],          // MRR do negocio
    ['GET',   '/api/admin/assinaturas'],
    ['PATCH', '/api/admin/assinaturas/1'],       // upgrade gratis
    ['DELETE','/api/admin/clientes/1'],          // deletar concorrente
    ['GET',   '/api/assinaturas/admin/assinaturas'],  // a rota redundante
  ];

  for (const [metodo, rota] of rotasProibidas) {
    const r = await req(rota, { method: metodo, body: metodo === 'GET' ? undefined : '{}' }, login.cookie);
    assert.strictEqual(
      r.status, 403,
      `💥 VAZAMENTO: ${metodo} ${rota} respondeu ${r.status} (esperado 403). O dono de loja alcancou o backoffice.`
    );
    console.log(`  ✓ ${metodo} ${rota} -> 403 (bloqueado)`);
  }

  // Sanidade: o dono AINDA acessa o que e' DELE (o guard nao pode ter fechado demais).
  const meu = await req('/api/assinaturas/minha', {}, login.cookie);
  assert.strictEqual(meu.status, 200, 'o dono perdeu acesso a PROPRIA assinatura — o guard fechou demais');
  console.log('  ✓ o dono ainda ve a PROPRIA assinatura (nao fechou demais)');

  console.log('\n✅ PASSOU: o backoffice so aceita admin de verdade (admin_id)\n');
}

rodar().then(() => process.exit(0)).catch((e) => {
  console.error('\n❌ FALHOU:', e.message, '\n');
  process.exit(1);
});
