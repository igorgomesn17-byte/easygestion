// ============================================================
// TESTE DA MIGRATION 029 (grade cor x tamanho)
//
// O que este teste existe pra provar: a 029 muda a IDENTIDADE da tabela
// `variacoes` (rebuild pra trocar o UNIQUE inline). Rebuild em SQLite e' a
// operacao que perde dado em silencio, por dois caminhos:
//
//   1. movimentos_estoque.variacao_id tem ON DELETE CASCADE. Com foreign_keys=ON,
//      o DROP TABLE variacoes apaga TODO o historico de movimento sem avisar.
//   2. Se o INSERT..SELECT nao copiar o `id` explicitamente, o AUTOINCREMENT
//      renumera as linhas — e venda_itens/troca_itens/movimentos passam a apontar
//      pra variacao ERRADA. O banco fica integro e os dados, mentirosos.
//
// Por isso o teste nao roda contra o banco de producao (que hoje esta vazio):
// ele SEMEIA um banco com venda, movimento e troca de verdade, tira uma
// fotografia (contagens + conjunto de ids + checksum de estoque), roda a
// migration, e compara. Um banco vazio passaria em qualquer migration, inclusive
// numa que apaga tudo.
// ============================================================
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { DatabaseSync } = require('node:sqlite');

const { migration029 } = require('../db/migrations');

const SCHEMA_PATH = path.join(__dirname, '..', 'db', 'schema.sql');

// ------------------------------------------------------------
// Monta um banco no formato ANTIGO (pre-029) e povoa com dado real.
// Nao usa o schema.sql atual pra `variacoes`: o schema.sql ja vai estar
// atualizado com cor/codigo_barras, e o teste precisa migrar a tabela VELHA.
// ------------------------------------------------------------
function bancoAntigoPovoado() {
  const arquivo = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'mig029-')), 'teste.db');
  const db = new DatabaseSync(arquivo);
  db.exec('PRAGMA foreign_keys = ON;');

  // Schema no formato EXATO que existe hoje em producao (conferido via
  // sqlite_master no EC2): tenant_id entrou por ALTER, entao vem depois de
  // quantidade, e o UNIQUE inline e' (produto_id, tamanho).
  db.exec(`
    CREATE TABLE produtos (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      tenant_id INTEGER NOT NULL DEFAULT 1,
      codigo TEXT NOT NULL,
      codigo_barras TEXT,
      nome TEXT NOT NULL,
      cor TEXT,
      custo REAL NOT NULL DEFAULT 0,
      preco_venda REAL NOT NULL DEFAULT 0,
      ativo INTEGER NOT NULL DEFAULT 1
    );
    CREATE TABLE variacoes (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      produto_id  INTEGER NOT NULL,
      tamanho     TEXT NOT NULL,
      quantidade  INTEGER NOT NULL DEFAULT 0, tenant_id INTEGER,
      FOREIGN KEY (produto_id) REFERENCES produtos(id) ON DELETE CASCADE,
      UNIQUE (produto_id, tamanho)
    );
    CREATE TABLE vendas (id INTEGER PRIMARY KEY AUTOINCREMENT, tenant_id INTEGER, total REAL);
    CREATE TABLE venda_itens (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      venda_id INTEGER NOT NULL,
      variacao_id INTEGER,
      produto_id INTEGER,
      descricao TEXT,
      qtd INTEGER NOT NULL DEFAULT 1,
      FOREIGN KEY (venda_id)    REFERENCES vendas(id)    ON DELETE CASCADE,
      FOREIGN KEY (variacao_id) REFERENCES variacoes(id) ON DELETE SET NULL,
      FOREIGN KEY (produto_id)  REFERENCES produtos(id)  ON DELETE SET NULL
    );
    -- O CASCADE. Este e' o que evapora se a migration errar.
    CREATE TABLE movimentos_estoque (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      variacao_id INTEGER NOT NULL,
      tipo TEXT NOT NULL,
      qtd INTEGER NOT NULL,
      motivo TEXT,
      FOREIGN KEY (variacao_id) REFERENCES variacoes(id) ON DELETE CASCADE
    );
    CREATE TABLE trocas (id INTEGER PRIMARY KEY AUTOINCREMENT, tenant_id INTEGER);
    CREATE TABLE troca_itens (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      troca_id INTEGER NOT NULL,
      tipo TEXT NOT NULL,
      variacao_id INTEGER,
      qtd INTEGER NOT NULL DEFAULT 1,
      FOREIGN KEY (troca_id)    REFERENCES trocas(id)    ON DELETE CASCADE,
      FOREIGN KEY (variacao_id) REFERENCES variacoes(id) ON DELETE SET NULL
    );
    CREATE INDEX idx_variacoes_produto ON variacoes(produto_id);
    CREATE INDEX idx_variacoes_tenant  ON variacoes(tenant_id);
    CREATE INDEX idx_mov_variacao      ON movimentos_estoque(variacao_id);
  `);

  // --- dado real ---
  // p1: tem cor ("Preto")   -> as variacoes devem herdar "Preto"
  // p2: cor NULL            -> deve virar 'Unica' (NUNCA NULL: no SQLite NULL != NULL
  //                            e o UNIQUE nao protegeria contra duplicata)
  // p3: cor '' (vazio)      -> mesmo caso do NULL
  // p4: de OUTRO tenant     -> a migration nao pode ignorar quem nao e' tenant 1
  db.exec(`
    INSERT INTO produtos (id, tenant_id, codigo, nome, cor, custo, preco_venda) VALUES
      (1, 1, 'VES001', 'Vestido Amanda', 'Preto', 40, 120),
      (2, 1, 'BLU001', 'Blusa Lisa',      NULL,   20,  60),
      (3, 1, 'CAL001', 'Calca Jeans',     '',     50, 150),
      (4, 2, 'SAI001', 'Saia Midi',       'Bege', 30,  90);
  `);

  // IDs com BURACO (7, 9, 12...) de proposito: e' o que acontece num banco real
  // depois de deletes. Se o rebuild renumerar, o teste pega — uma sequencia
  // 1,2,3 sobreviveria a uma renumeracao por acidente e nao provaria nada.
  db.exec(`
    INSERT INTO variacoes (id, produto_id, tamanho, quantidade, tenant_id) VALUES
      (3,  1, 'P',  2, 1),
      (7,  1, 'M',  5, 1),
      (9,  1, 'G',  0, 1),
      (12, 2, 'M',  3, 1),
      (13, 2, 'G',  1, 1),
      (20, 3, 'U',  4, 1),
      (25, 4, 'P',  6, 2);
  `);

  // Venda antiga apontando pra variacao 7 (Vestido Amanda / M).
  // O teste vai reabrir essa venda DEPOIS da migration e exigir que ela ainda
  // resolva o mesmo produto e o mesmo tamanho.
  db.exec(`
    INSERT INTO vendas (id, tenant_id, total) VALUES (100, 1, 120);
    INSERT INTO venda_itens (id, venda_id, variacao_id, produto_id, descricao, qtd)
      VALUES (500, 100, 7, 1, 'Vestido Amanda (M)', 1);
    INSERT INTO trocas (id, tenant_id) VALUES (200, 1);
    INSERT INTO troca_itens (id, troca_id, tipo, variacao_id, qtd)
      VALUES (600, 200, 'devolvido', 12, 1);
    INSERT INTO movimentos_estoque (variacao_id, tipo, qtd, motivo) VALUES
      (3,  'entrada',  2, 'cadastro inicial'),
      (7,  'entrada',  6, 'cadastro inicial'),
      (7,  'saida',   -1, 'venda #100'),
      (9,  'entrada',  0, 'cadastro inicial'),
      (12, 'entrada',  3, 'cadastro inicial'),
      (13, 'entrada',  1, 'cadastro inicial'),
      (20, 'entrada',  4, 'cadastro inicial'),
      (25, 'entrada',  6, 'cadastro inicial');
  `);

  return { db, arquivo };
}

// Fotografia do que NAO pode mudar.
function fotografar(db) {
  return {
    variacoes:   db.prepare('SELECT COUNT(*) n FROM variacoes').get().n,
    estoque:     db.prepare('SELECT COALESCE(SUM(quantidade),0) s FROM variacoes').get().s,
    // o conjunto de IDs, nao so a contagem: uma renumeracao preserva a contagem
    ids:         db.prepare('SELECT id FROM variacoes ORDER BY id').all().map(r => r.id).join(','),
    // (id -> produto_id|tamanho|quantidade): pega renumeracao que embaralhou o vinculo
    vinculos:    db.prepare('SELECT id, produto_id, tamanho, quantidade FROM variacoes ORDER BY id')
                   .all().map(r => `${r.id}:${r.produto_id}|${r.tamanho}|${r.quantidade}`).join(','),
    movimentos:  db.prepare('SELECT COUNT(*) n FROM movimentos_estoque').get().n,
    venda_itens: db.prepare('SELECT COUNT(*) n FROM venda_itens WHERE variacao_id IS NOT NULL').get().n,
    troca_itens: db.prepare('SELECT COUNT(*) n FROM troca_itens WHERE variacao_id IS NOT NULL').get().n,
  };
}

test('029: nao perde variacao, estoque nem historico de movimento', (t) => {
  const { db, arquivo } = bancoAntigoPovoado();
  t.after(() => { db.close(); fs.rmSync(path.dirname(arquivo), { recursive: true, force: true }); });

  const antes = fotografar(db);
  assert.equal(antes.variacoes, 7, 'sanidade: o banco semeado tem 7 variacoes');
  assert.equal(antes.movimentos, 8, 'sanidade: o banco semeado tem 8 movimentos');

  migration029(db);

  const depois = fotografar(db);

  assert.equal(depois.variacoes,   antes.variacoes,   'perdeu (ou criou) variacao');
  assert.equal(depois.estoque,     antes.estoque,     'o total de pecas em estoque mudou');
  assert.equal(depois.ids,         antes.ids,         'os IDs das variacoes MUDARAM (renumeracao) — isso quebra venda_itens/movimentos');
  assert.equal(depois.vinculos,    antes.vinculos,    'um id passou a apontar pra outro produto/tamanho/qtd');
  assert.equal(depois.movimentos,  antes.movimentos,  'o CASCADE comeu o historico de movimento de estoque');
  assert.equal(depois.venda_itens, antes.venda_itens, 'venda_itens perdeu o vinculo com a variacao (SET NULL disparou)');
  assert.equal(depois.troca_itens, antes.troca_itens, 'troca_itens perdeu o vinculo com a variacao');
});

test('029: integridade referencial intacta (nenhuma FK orfa)', (t) => {
  const { db, arquivo } = bancoAntigoPovoado();
  t.after(() => { db.close(); fs.rmSync(path.dirname(arquivo), { recursive: true, force: true }); });

  migration029(db);

  assert.deepEqual(db.prepare('PRAGMA foreign_key_check').all(), [], 'sobraram FKs apontando pra lugar nenhum');
  assert.equal(db.prepare('PRAGMA integrity_check').get().integrity_check, 'ok');
  // a migration desliga foreign_keys pra fazer o rebuild sem disparar CASCADE.
  // Se ela esquecer de religar, o servidor segue rodando SEM integridade referencial.
  assert.equal(db.prepare('PRAGMA foreign_keys').get().foreign_keys, 1, 'a migration deixou foreign_keys DESLIGADO');
});

test('029: uma venda antiga ainda resolve o produto e a variacao certos', (t) => {
  const { db, arquivo } = bancoAntigoPovoado();
  t.after(() => { db.close(); fs.rmSync(path.dirname(arquivo), { recursive: true, force: true }); });

  migration029(db);

  // A venda 100 vendeu a variacao 7 = Vestido Amanda, tamanho M, cor Preto.
  const item = db.prepare(`
    SELECT vi.descricao, p.nome, v.cor, v.tamanho
    FROM venda_itens vi
    JOIN variacoes v ON v.id = vi.variacao_id
    JOIN produtos  p ON p.id = v.produto_id
    WHERE vi.id = 500
  `).get();

  assert.ok(item, 'a venda antiga perdeu o vinculo com a variacao');
  assert.equal(item.nome,    'Vestido Amanda');
  assert.equal(item.tamanho, 'M');
  assert.equal(item.cor,     'Preto', 'a variacao nao herdou a cor do produto pai');
});

test('029: backfill da cor (herda do produto; sem cor vira "Unica", nunca NULL)', (t) => {
  const { db, arquivo } = bancoAntigoPovoado();
  t.after(() => { db.close(); fs.rmSync(path.dirname(arquivo), { recursive: true, force: true }); });

  migration029(db);

  const semCor = db.prepare("SELECT COUNT(*) n FROM variacoes WHERE cor IS NULL OR TRIM(cor) = ''").get().n;
  assert.equal(semCor, 0, 'ficou variacao com cor NULL/vazia — o UNIQUE(produto_id,cor,tamanho) nao protege contra NULL');

  const cor = (id) => db.prepare('SELECT cor FROM variacoes WHERE id = ?').get(id).cor;
  assert.equal(cor(7),  'Preto',  'nao herdou a cor do produto pai');
  assert.equal(cor(12), 'Unica',  'produto com cor NULL deveria virar "Unica"');
  assert.equal(cor(20), 'Unica',  'produto com cor vazia deveria virar "Unica"');
  assert.equal(cor(25), 'Bege',   'variacao de OUTRO tenant ficou de fora do backfill');
});

test('029: o UNIQUE novo permite mesma cor+tamanho diferentes, e barra duplicata', (t) => {
  const { db, arquivo } = bancoAntigoPovoado();
  t.after(() => { db.close(); fs.rmSync(path.dirname(arquivo), { recursive: true, force: true }); });

  migration029(db);

  // O ponto da migration inteira: o produto 1 ja tem (Preto, M). Antes da 029 isto
  // era IMPOSSIVEL — o UNIQUE(produto_id, tamanho) barrava um segundo "M".
  db.prepare("INSERT INTO variacoes (produto_id, cor, tamanho, quantidade, tenant_id) VALUES (1, 'Vermelho', 'M', 4, 1)").run();
  const m = db.prepare("SELECT COUNT(*) n FROM variacoes WHERE produto_id = 1 AND tamanho = 'M'").get().n;
  assert.equal(m, 2, 'nao deu pra ter o mesmo tamanho em duas cores — o UNIQUE antigo ainda esta la');

  // Mas o par (cor, tamanho) continua unico dentro do produto.
  assert.throws(
    () => db.prepare("INSERT INTO variacoes (produto_id, cor, tamanho, quantidade, tenant_id) VALUES (1, 'Vermelho', 'M', 1, 1)").run(),
    /UNIQUE|constraint/i,
    'aceitou (Vermelho, M) duplicado no mesmo produto'
  );
});

test('029: idempotente — rodar duas vezes nao muda nada nem quebra', (t) => {
  const { db, arquivo } = bancoAntigoPovoado();
  t.after(() => { db.close(); fs.rmSync(path.dirname(arquivo), { recursive: true, force: true }); });

  migration029(db);
  const depoisDe1 = fotografar(db);

  // O runner de migrations nao roda 2x (checa a tabela `migrations`), mas o corpo
  // precisa aguentar: producao esta 4 migrations atrasada e alguem pode rodar na mao.
  assert.doesNotThrow(() => migration029(db), 'a migration explodiu na segunda execucao');

  assert.deepEqual(fotografar(db), depoisDe1, 'a segunda execucao alterou o banco');
  assert.deepEqual(db.prepare('PRAGMA foreign_key_check').all(), []);
});

test('029: schema.sql (banco NOVO) nasce com cor, codigo_barras e tenant_id', (t) => {
  // Um cliente novo nao passa pela 029 — ele nasce do schema.sql. Se os dois
  // divergirem, a loja nova quebra no primeiro cadastro de produto e a antiga nao.
  // Esse desencontro ja derrubou o boot antes (CREATE INDEX sobre coluna que so
  // existia via migration), entao aqui ele fica travado por teste.
  const arquivo = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'mig029-novo-')), 'novo.db');
  const db = new DatabaseSync(arquivo);
  t.after(() => { db.close(); fs.rmSync(path.dirname(arquivo), { recursive: true, force: true }); });

  db.exec('PRAGMA foreign_keys = ON;');
  db.exec(fs.readFileSync(SCHEMA_PATH, 'utf8'));

  const cols = db.prepare('PRAGMA table_info(variacoes)').all().map(c => c.name);
  for (const col of ['cor', 'tamanho', 'quantidade', 'tenant_id', 'codigo_barras']) {
    assert.ok(cols.includes(col), `schema.sql: variacoes nasce SEM a coluna "${col}"`);
  }

  // E a 029 tem que ser inofensiva num banco que ja nasceu certo.
  assert.doesNotThrow(() => migration029(db), '029 quebra quando roda sobre um banco novo');
  assert.equal(db.prepare('PRAGMA foreign_keys').get().foreign_keys, 1);
});
