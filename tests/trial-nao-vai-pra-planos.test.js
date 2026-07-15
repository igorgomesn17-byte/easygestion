// ============================================================
// O trial ativo NÃO pode ser expulso do PDV/config pra tela de planos.
//
// O bug: o PDV sonda /api/maquininha/status no load pra saber se a loja tem maquininha.
// Essa feature (maquininha_integrada) é false até no Growth, então a sonda dá 403+upgrade.
// O api() do comum.js trata TODO 403+upgrade como "vá pra planos" e redirecionava —
// EXPULSANDO o trial do PDV inteiro por causa de uma feature que ele nem tentou usar.
//
// Conserto: as SONDAS de feature (só querem saber "existe?") passam { semUpgrade: true }
// e o 403 vira erro comum, tratado localmente, sem redirect.
//
//   node tests/trial-nao-vai-pra-planos.test.js   (usa Chrome via playwright-core)
// ============================================================
const { chromium } = require('playwright-core');
const { DatabaseSync } = require('node:sqlite');
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');

const PORT = 3012;
const BASE = `http://localhost:${PORT}`;
const DB_DIR = path.join(__dirname, '.tmp-trial-planos');
const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';

let servidor;
function subir() {
  if (fs.existsSync(DB_DIR)) { try { fs.rmSync(DB_DIR, { recursive: true, force: true }); } catch {} }
  fs.mkdirSync(DB_DIR, { recursive: true });
  const secret = 'teste-trial-planos-com-mais-de-32-caracteres-ok';
  servidor = spawn('node', ['server.js'], {
    env: { ...process.env, DB_DIR, PORT: String(PORT), NODE_ENV: 'development', SESSION_SECRET: secret, TOKEN_SECRET: secret },
    stdio: 'ignore',
  });
  return new Promise((resolve, reject) => {
    const t0 = Date.now();
    (async function ping() {
      try { if ((await fetch(BASE + '/health')).ok) return resolve(); } catch {}
      if (Date.now() - t0 > 20000) return reject(new Error('servidor não subiu'));
      setTimeout(ping, 400);
    })();
  });
}

function semearTrial() {
  const { hashSenha } = require('../middleware/seguranca');
  const db = new DatabaseSync(path.join(DB_DIR, 'dsstore.db'));
  const hoje = new Date().toISOString().split('T')[0];
  const fim = new Date(Date.now() + 14 * 864e5).toISOString().split('T')[0];
  const t = Number(db.prepare(`INSERT INTO tenants (nome_loja,nome_responsavel,telefone,email,senha_hash,plano,status)
    VALUES ('Trial','R','739','trial@x.com',?,'growth','teste')`).run(hashSenha('x')).lastInsertRowid);
  db.prepare(`INSERT INTO usuarios (nome,email,senha_hash,papel,tenant_id,ativo,email_verificado)
    VALUES ('Dono','trial@x.com',?,'admin',?,1,1)`).run(hashSenha('TrialAtivo#2026'), t);
  db.prepare(`INSERT INTO assinaturas (tenant_id,plano,valor_mensal,data_inicio,data_proxima_renovacao,em_teste,data_inicio_teste,data_fim_teste)
    VALUES (?,'growth',119.90,?,?,1,?,?)`).run(t, hoje, fim, hoje, fim);
  db.close();
}

let falhas = 0;
const ok = (d, c, e = '') => { if (c) console.log(`  ✅ ${d}`); else { console.log(`  ❌ ${d}${e ? ' → ' + e : ''}`); falhas++; } };

async function rodar() {
  console.log('\n🎟️  TESTE: trial ativo NÃO é expulso do PDV/config pra planos\n');
  await subir();
  semearTrial();

  const r = await fetch(BASE + '/api/login', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'trial@x.com', senha: 'TrialAtivo#2026' }), redirect: 'manual',
  });
  const ck = r.headers.get('set-cookie').split(';')[0];
  const [n, v] = ck.split('=');

  const b = await chromium.launch({ executablePath: CHROME, headless: true });
  const ctx = await b.newContext();
  await ctx.addCookies([{ name: n, value: v, domain: 'localhost', path: '/' }]);

  for (const pagina of ['pdv.html', 'config.html']) {
    const page = await ctx.newPage();
    await page.goto(BASE + '/' + pagina, { waitUntil: 'networkidle' }).catch(() => {});
    await page.waitForTimeout(3500);   // dá tempo do redirect (setTimeout 1800ms) disparar, se fosse
    const url = page.url().replace(BASE, '');
    ok(`${pagina}: o trial FICA na tela (não vai pra planos)`, url.endsWith('/' + pagina), `foi parar em ${url}`);
    await page.close();
  }

  await b.close();
  servidor.kill();
  console.log(falhas === 0 ? '\n✅ O TRIAL USA PDV E CONFIG NORMALMENTE\n' : `\n❌ ${falhas} falha(s)\n`);
  process.exit(falhas === 0 ? 0 : 1);
}

rodar().catch((e) => { console.error('\n❌ ERRO:', e.message, '\n'); if (servidor) servidor.kill(); process.exit(1); });
