// ============================================================
// A foto do iPhone (HEIC) sobe no cadastro de produto — convertida no SERVIDOR.
//
// Dois bugs de mobile em public/produtos.html:
//   1. `capture="environment"` no input forçava a CÂMERA; o celular nem oferecia a
//      galeria. Removido.
//   2. HEIC (formato padrão do iPhone) travava em silêncio: o navegador não decodifica
//      HEIC, então o canvas (que redimensiona no front) nunca resolvia. A foto "não ia".
//
// A solução: o front manda o HEIC CRU; o servidor converte pra JPEG (heic-convert, JS
// puro, sem dependência nativa) antes de salvar. Este teste faz o cadastro de verdade
// com um HEIC real e confirma que o arquivo salvo é JPG.
//
//   SCRATCH=<pasta com sample.heic> node tests/foto-heic-iphone.test.js
// ============================================================
const { DatabaseSync } = require('node:sqlite');
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');

const PORT = 3009;
const BASE = `http://localhost:${PORT}`;
const DB_DIR = path.join(__dirname, '.tmp-heic-e2e');
const UPLOADS = path.join(DB_DIR, 'uploads');
const SAMPLE = path.join(process.env.SCRATCH || __dirname, 'sample.heic');

let servidor;
function subirServidor() {
  if (fs.existsSync(DB_DIR)) fs.rmSync(DB_DIR, { recursive: true, force: true });
  fs.mkdirSync(UPLOADS, { recursive: true });
  const secret = 'teste-heic-e2e-com-mais-de-32-caracteres-ok-1234';
  servidor = spawn('node', ['server.js'], {
    env: { ...process.env, DB_DIR, UPLOADS_DIR: UPLOADS, PORT: String(PORT), NODE_ENV: 'development', SESSION_SECRET: secret, TOKEN_SECRET: secret },
    stdio: 'ignore',
  });
  return new Promise((resolve, reject) => {
    const t0 = Date.now();
    (async function ping() {
      try { const r = await fetch(BASE + '/health'); if (r.ok) return resolve(); } catch {}
      if (Date.now() - t0 > 20000) return reject(new Error('servidor não subiu'));
      setTimeout(ping, 400);
    })();
  });
}

function semear() {
  const { hashSenha } = require('../middleware/seguranca');
  const db = new DatabaseSync(path.join(DB_DIR, 'dsstore.db'));
  const t = Number(db.prepare(`INSERT INTO tenants (nome_loja,nome_responsavel,telefone,email,senha_hash,plano,status)
    VALUES ('Loja','R','739','heic@x.com',?,'growth','ativo')`).run(hashSenha('x')).lastInsertRowid);
  db.prepare(`INSERT INTO usuarios (nome,email,senha_hash,papel,tenant_id,ativo,email_verificado)
    VALUES ('D','heic@x.com',?,'admin',?,1,1)`).run(hashSenha('SenhaHeic#2026'), t);
  db.close();
}

let falhas = 0;
const ok = (d, c, e = '') => { if (c) console.log(`  ✅ ${d}`); else { console.log(`  ❌ ${d}${e ? ' → ' + e : ''}`); falhas++; } };

async function rodar() {
  console.log('\n📷 TESTE: foto HEIC do iPhone sobe no cadastro (convertida no servidor)\n');
  if (!fs.existsSync(SAMPLE)) {
    console.log(`  ⚠️  falta o HEIC de amostra em ${SAMPLE} — pulei (não é falha do código)`);
    process.exit(0);
  }

  await subirServidor();
  semear();

  // login
  const r = await fetch(BASE + '/api/login', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'heic@x.com', senha: 'SenhaHeic#2026' }), redirect: 'manual',
  });
  const cookie = r.headers.get('set-cookie').split(';')[0];

  // o HEIC vai CRU, como data:image/heic (é o que o front manda pra foto do iPhone)
  const heicB64 = 'data:image/heic;base64,' + fs.readFileSync(SAMPLE).toString('base64');

  const resp = await fetch(BASE + '/api/produtos', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Cookie: cookie },
    body: JSON.stringify({
      nome: 'Vestido do iPhone', categoria: 'Vestido', preco_venda: 100,
      foto: heicB64,
      grade: [{ cor: 'Preto', tamanho: 'M', quantidade: 1 }],
    }),
  });
  const corpo = await resp.json().catch(() => null);
  ok('o cadastro com foto HEIC completa (não trava, não dá 400)', resp.status === 201, `status ${resp.status} ${JSON.stringify(corpo)}`);

  // confere no banco: a foto salva é um .jpg
  const db = new DatabaseSync(path.join(DB_DIR, 'dsstore.db'), { readOnly: true });
  const prod = db.prepare("SELECT foto FROM produtos WHERE nome = 'Vestido do iPhone'").get();
  db.close();
  ok('a foto foi salva como JPG (o HEIC foi convertido no servidor)',
    prod && /\.jpg$/i.test(prod.foto || ''), prod ? prod.foto : '(sem produto)');

  // e o arquivo no disco é um JPEG de verdade (começa com FF D8)
  if (prod && prod.foto) {
    const arq = path.join(UPLOADS, path.basename(prod.foto));
    const buf = fs.existsSync(arq) ? fs.readFileSync(arq) : Buffer.alloc(0);
    ok('o arquivo no disco é um JPEG válido (FF D8)', buf[0] === 0xFF && buf[1] === 0xD8, `${buf.length} bytes`);
  }

  servidor.kill();
  console.log(falhas === 0 ? '\n✅ A FOTO DO IPHONE SOBE E VIRA JPG\n' : `\n❌ ${falhas} falha(s)\n`);
  process.exit(falhas === 0 ? 0 : 1);
}

rodar().catch((e) => { console.error('\n❌ ERRO:', e.message, '\n'); if (servidor) servidor.kill(); process.exit(1); });
