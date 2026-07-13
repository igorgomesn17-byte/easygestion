// Migrations 035 (usuarios) e 036 (vales): unicidade que enxerga a LOJA.
//
// As duas recriam a tabela — unico jeito de trocar um UNIQUE inline. Rebuild com
// CASCADE atras nao da erro quando da errado: apaga em silencio. `usuarios` tem DUAS
// FKs CASCADE apontando pra ela (tokens_verificacao, email_verifications) e uma
// SET NULL (auditoria). Por isso estes testes contam linha por linha.
//
// Cada teste REPRODUZ o bug antes de provar o conserto: um teste que so verifica o
// estado final passaria mesmo que a migration nao tivesse feito nada.

const { test } = require('node:test');
const assert = require('node:assert');
const { DatabaseSync } = require('node:sqlite');
const { migration035, migration036 } = require('../db/migrations');

// Schema como esta em PRODUCAO: UNIQUE global colado na coluna, tenant_id enfiado
// depois por ALTER (nullable), email_verificado idem.
function bancoAntigo() {
  const db = new DatabaseSync(':memory:');
  db.exec('PRAGMA foreign_keys = ON;');
  db.exec(`
    CREATE TABLE usuarios (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      nome       TEXT UNIQUE NOT NULL,
      email      TEXT UNIQUE,
      senha_hash TEXT NOT NULL,
      papel      TEXT NOT NULL DEFAULT 'relacionamento',
      ativo      INTEGER NOT NULL DEFAULT 1,
      criado_em  TEXT NOT NULL DEFAULT (datetime('now','localtime'))
    , tenant_id INTEGER, email_verificado INTEGER DEFAULT 0);

    CREATE TABLE tokens_verificacao (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      usuario_id INTEGER NOT NULL,
      token      TEXT NOT NULL,
      tipo       TEXT,
      FOREIGN KEY (usuario_id) REFERENCES usuarios(id) ON DELETE CASCADE
    );
    CREATE TABLE email_verifications (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      usuario_id INTEGER NOT NULL,
      token      TEXT NOT NULL,
      verificado INTEGER NOT NULL DEFAULT 0,
      FOREIGN KEY (usuario_id) REFERENCES usuarios(id) ON DELETE CASCADE
    );
    CREATE TABLE auditoria (
      id           INTEGER PRIMARY KEY AUTOINCREMENT,
      usuario_id   INTEGER,
      usuario_nome TEXT,
      tenant_id    INTEGER,
      acao         TEXT,
      FOREIGN KEY (usuario_id) REFERENCES usuarios(id) ON DELETE SET NULL
    );

    CREATE TABLE trocas   (id INTEGER PRIMARY KEY AUTOINCREMENT, tenant_id INTEGER);
    CREATE TABLE clientes (id INTEGER PRIMARY KEY AUTOINCREMENT, tenant_id INTEGER, nome TEXT);

    CREATE TABLE vales (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      tenant_id INTEGER NOT NULL DEFAULT 1,
      codigo TEXT UNIQUE NOT NULL,
      valor REAL NOT NULL DEFAULT 0,
      saldo REAL NOT NULL DEFAULT 0,
      utilizado REAL NOT NULL DEFAULT 0,
      troca_id INTEGER,
      cliente_id INTEGER,
      data_geracao TEXT NOT NULL DEFAULT (datetime('now','localtime')),
      validade TEXT,
      ativo INTEGER NOT NULL DEFAULT 1,
      notas TEXT, venda_utilizacao_id INTEGER, data_utilizacao TEXT,
      origem TEXT NOT NULL DEFAULT 'troca', clube_ciclo INTEGER,
      FOREIGN KEY (troca_id) REFERENCES trocas(id) ON DELETE SET NULL,
      FOREIGN KEY (cliente_id) REFERENCES clientes(id) ON DELETE SET NULL
    );
  `);

  // Duas lojas (30 e 31). Como em producao, o signup grava o email no campo nome.
  const insU = db.prepare(
    'INSERT INTO usuarios (id, nome, email, senha_hash, papel, tenant_id, email_verificado) VALUES (?, ?, ?, ?, ?, ?, 1)'
  );
  insU.run(1, 'dona@lojaA.com', 'dona@lojaA.com', 'hash-da-loja-A', 'admin', 30);
  insU.run(2, 'dona@lojaB.com', 'dona@lojaB.com', 'hash-da-loja-B', 'admin', 31);

  db.prepare('INSERT INTO tokens_verificacao (usuario_id, token, tipo) VALUES (?, ?, ?)').run(1, 'tok-A', 'reset');
  db.prepare('INSERT INTO email_verifications (usuario_id, token) VALUES (?, ?)').run(2, 'ver-B');
  db.prepare('INSERT INTO auditoria (usuario_id, usuario_nome, tenant_id, acao) VALUES (?, ?, ?, ?)')
    .run(1, 'dona@lojaA.com', 30, 'DELETE');

  db.prepare('INSERT INTO clientes (id, tenant_id, nome) VALUES (?, ?, ?)').run(500, 30, 'Cliente da A');
  const insV = db.prepare(
    'INSERT INTO vales (id, tenant_id, codigo, valor, saldo, cliente_id, origem, clube_ciclo) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
  );
  insV.run(10, 30, 'VALE-AAAAAA', 50, 50, 500, 'troca', null);
  insV.run(11, 31, 'VALE-BBBBBB', 70, 70, null, 'clube', 1);

  return db;
}

// ============================================================
// 035 — usuarios
// ============================================================

test('035: cada loja pode ter a SUA "Maria" (antes, a segunda loja travava)', () => {
  const db = bancoAntigo();

  // ANTES: o bug. A loja 31 nao consegue cadastrar uma Maria porque a 30 tem uma.
  db.prepare('INSERT INTO usuarios (nome, email, senha_hash, tenant_id) VALUES (?, ?, ?, ?)')
    .run('Maria', 'maria@lojaA.com', 'h', 30);
  assert.throws(
    () => db.prepare('INSERT INTO usuarios (nome, email, senha_hash, tenant_id) VALUES (?, ?, ?, ?)')
      .run('Maria', 'maria@lojaB.com', 'h', 31),
    /UNIQUE constraint failed/,
    'o teste precisa reproduzir o bug antes de provar o conserto'
  );

  migration035(db);

  // DEPOIS: a Maria da loja B entra.
  db.prepare('INSERT INTO usuarios (nome, email, senha_hash, tenant_id) VALUES (?, ?, ?, ?)')
    .run('Maria', 'maria@lojaB.com', 'h', 31);
  const marias = db.prepare("SELECT tenant_id FROM usuarios WHERE nome = 'Maria' ORDER BY tenant_id")
    .all().map((u) => u.tenant_id);
  assert.deepStrictEqual(marias, [30, 31], 'cada loja tem que poder ter a sua Maria');

  // ...e continua barrando duas Marias DENTRO da mesma loja.
  assert.throws(
    () => db.prepare('INSERT INTO usuarios (nome, email, senha_hash, tenant_id) VALUES (?, ?, ?, ?)')
      .run('Maria', 'outra@lojaB.com', 'h', 31),
    /UNIQUE constraint failed/,
    'duplicar nome DENTRO da mesma loja continua proibido'
  );
});

test('035: o email continua unico GLOBAL — senao o login nao sabe em qual loja entrar', () => {
  const db = bancoAntigo();
  migration035(db);

  // O login (routes/auth.js) busca so por email, sem tenant. Dois usuarios de lojas
  // diferentes com o mesmo email fariam a pessoa cair na loja errada.
  assert.throws(
    () => db.prepare('INSERT INTO usuarios (nome, email, senha_hash, tenant_id) VALUES (?, ?, ?, ?)')
      .run('Fulana', 'dona@lojaA.com', 'h', 31),
    /UNIQUE constraint failed/,
    'o mesmo email em duas lojas tornaria o login ambiguo'
  );

  // E agora tambem pega variacao de maiuscula/minuscula: o UNIQUE antigo era
  // case-sensitive, mas o login busca com LOWER() — 'Dona@LojaA.com' passava e o
  // login pegava uma das duas linhas por acaso.
  assert.throws(
    () => db.prepare('INSERT INTO usuarios (nome, email, senha_hash, tenant_id) VALUES (?, ?, ?, ?)')
      .run('Fulana', 'DONA@LOJAA.COM', 'h', 31),
    /UNIQUE constraint failed/,
    'email igual so mudando o caixa alto tem que ser barrado'
  );
});

test('035: o rebuild nao dispara CASCADE nem SET NULL (tokens, verificacoes, auditoria)', () => {
  const db = bancoAntigo();
  const antes = {
    usuarios: db.prepare('SELECT COUNT(*) n FROM usuarios').get().n,
    tokens: db.prepare('SELECT COUNT(*) n FROM tokens_verificacao').get().n,
    verif: db.prepare('SELECT COUNT(*) n FROM email_verifications').get().n,
    audit: db.prepare('SELECT COUNT(*) n FROM auditoria WHERE usuario_id IS NOT NULL').get().n,
  };

  migration035(db);

  assert.strictEqual(db.prepare('SELECT COUNT(*) n FROM usuarios').get().n, antes.usuarios, 'perdeu usuario');
  assert.strictEqual(db.prepare('SELECT COUNT(*) n FROM tokens_verificacao').get().n, antes.tokens,
    'o CASCADE de tokens_verificacao.usuario_id comeu os tokens de reset de senha');
  assert.strictEqual(db.prepare('SELECT COUNT(*) n FROM email_verifications').get().n, antes.verif,
    'o CASCADE de email_verifications.usuario_id comeu as verificacoes de email');
  assert.strictEqual(db.prepare('SELECT COUNT(*) n FROM auditoria WHERE usuario_id IS NOT NULL').get().n, antes.audit,
    'o SET NULL de auditoria.usuario_id apagou o autor da acao (a auditoria LGPD perde o rastro)');

  assert.strictEqual(db.prepare('PRAGMA foreign_key_check').all().length, 0, 'ficou FK orfa');
});

test('035: os ids sobrevivem — a senha e a auditoria continuam da pessoa CERTA', () => {
  const db = bancoAntigo();
  migration035(db);

  // Se o AUTOINCREMENT renumerasse, o banco ficaria integro e MENTINDO: a senha da
  // loja A grudaria no usuario da loja B, e a auditoria acusaria a pessoa errada.
  const u1 = db.prepare('SELECT nome, senha_hash, tenant_id FROM usuarios WHERE id = 1').get();
  assert.strictEqual(u1.senha_hash, 'hash-da-loja-A', 'o id 1 tem que continuar com a senha da loja A');
  assert.strictEqual(u1.tenant_id, 30);

  const token = db.prepare(`
    SELECT u.nome FROM tokens_verificacao t JOIN usuarios u ON u.id = t.usuario_id WHERE t.token = 'tok-A'
  `).get();
  assert.strictEqual(token.nome, 'dona@lojaA.com', 'o token de reset passou a valer pra outra pessoa');

  const aud = db.prepare(`
    SELECT u.tenant_id FROM auditoria a JOIN usuarios u ON u.id = a.usuario_id LIMIT 1
  `).get();
  assert.strictEqual(aud.tenant_id, 30, 'a auditoria passou a acusar alguem de outra loja');
});

test('035: idempotente — a segunda passada nao mexe em nada', () => {
  const db = bancoAntigo();
  migration035(db);
  const schema = db.prepare("SELECT sql FROM sqlite_master WHERE name = 'usuarios'").get().sql;

  migration035(db);
  assert.strictEqual(db.prepare("SELECT sql FROM sqlite_master WHERE name = 'usuarios'").get().sql, schema,
    'recriou a tabela de novo — nao e idempotente');
  assert.strictEqual(db.prepare('SELECT COUNT(*) n FROM usuarios').get().n, 2, 'a segunda passada mexeu nos dados');

  const novo = db.prepare('INSERT INTO usuarios (nome, email, senha_hash, tenant_id) VALUES (?, ?, ?, ?)')
    .run('Nova', 'nova@x.com', 'h', 30);
  assert.strictEqual(Number(novo.lastInsertRowid), 3, 'o AUTOINCREMENT reciclou um id ja usado');
});

// ============================================================
// 036 — vales
// ============================================================

test('036: duas lojas podem sortear o mesmo codigo de vale', () => {
  const db = bancoAntigo();

  // ANTES: o bug. O codigo e' sorteado; se a loja B tirar o mesmo da A, o INSERT
  // morre — e como o vale do clube nasce dentro da transacao da venda, a VENDA cai.
  assert.throws(
    () => db.prepare('INSERT INTO vales (tenant_id, codigo, valor, saldo) VALUES (?, ?, ?, ?)')
      .run(31, 'VALE-AAAAAA', 30, 30),
    /UNIQUE constraint failed/,
    'o teste precisa reproduzir o bug antes de provar o conserto'
  );

  migration036(db);

  db.prepare('INSERT INTO vales (tenant_id, codigo, valor, saldo) VALUES (?, ?, ?, ?)')
    .run(31, 'VALE-AAAAAA', 30, 30);
  const dois = db.prepare("SELECT tenant_id FROM vales WHERE codigo = 'VALE-AAAAAA' ORDER BY tenant_id")
    .all().map((v) => v.tenant_id);
  assert.deepStrictEqual(dois, [30, 31], 'o mesmo codigo tem que caber uma vez em cada loja');

  // Dentro da MESMA loja continua unico (senao dois vales dividiriam o mesmo saldo).
  assert.throws(
    () => db.prepare('INSERT INTO vales (tenant_id, codigo, valor, saldo) VALUES (?, ?, ?, ?)')
      .run(31, 'VALE-AAAAAA', 99, 99),
    /UNIQUE constraint failed/,
    'duplicar codigo DENTRO da mesma loja continua proibido'
  );
});

test('036: o rebuild preserva vales, saldo, ids e o indice do clube', () => {
  const db = bancoAntigo();
  const antes = db.prepare('SELECT COUNT(*) n, COALESCE(SUM(saldo),0) s FROM vales').get();

  migration036(db);

  const depois = db.prepare('SELECT COUNT(*) n, COALESCE(SUM(saldo),0) s FROM vales').get();
  assert.strictEqual(depois.n, antes.n, 'perdeu vale');
  assert.strictEqual(depois.s, antes.s, 'o saldo em vales mudou — e dinheiro da cliente');

  // id preservado: o codigo circula impresso no cupom.
  const v10 = db.prepare('SELECT codigo, tenant_id, origem, clube_ciclo FROM vales WHERE id = 10').get();
  assert.strictEqual(v10.codigo, 'VALE-AAAAAA');
  assert.strictEqual(v10.tenant_id, 30);
  const v11 = db.prepare('SELECT origem, clube_ciclo FROM vales WHERE id = 11').get();
  assert.strictEqual(v11.origem, 'clube', 'a coluna origem (que veio por ALTER) nao foi copiada');
  assert.strictEqual(v11.clube_ciclo, 1, 'clube_ciclo (idempotencia do premio) nao foi copiado');

  // O indice parcial do clube tem que voltar: e' ele que impede emitir o mesmo premio 2x.
  const idx = db.prepare("SELECT sql FROM sqlite_master WHERE type='index' AND name='idx_vales_clube'").get();
  assert.ok(idx && /origem/.test(idx.sql), 'o idx_vales_clube nao foi recriado apos o DROP');

  assert.strictEqual(db.prepare('PRAGMA foreign_key_check').all().length, 0, 'ficou FK orfa');
});

test('036: idempotente', () => {
  const db = bancoAntigo();
  migration036(db);
  const schema = db.prepare("SELECT sql FROM sqlite_master WHERE name = 'vales'").get().sql;
  migration036(db);
  assert.strictEqual(db.prepare("SELECT sql FROM sqlite_master WHERE name = 'vales'").get().sql, schema,
    'recriou a tabela de novo — nao e idempotente');
  assert.strictEqual(db.prepare('SELECT COUNT(*) n FROM vales').get().n, 2);
});
