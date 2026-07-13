// Migration 034: o codigo do produto passa a ser unico POR LOJA.
//
// A migration recria `produtos`, que e' referenciada por 5 FKs — duas delas
// ON DELETE CASCADE (variacoes, produto_fotos) e tres ON DELETE SET NULL
// (venda_itens, troca_itens, encomendas). Um rebuild feito errado nao da erro:
// ele apaga a grade, a galeria e o historico de movimento em silencio, e zera a
// peca das vendas passadas. Por isso este teste existe.
//
// Roda contra um banco montado com o schema ANTIGO (o de producao, com a UNIQUE
// global) e povoado com duas lojas que colidem — que e' o bug real.

const { test } = require('node:test');
const assert = require('node:assert');
const { DatabaseSync } = require('node:sqlite');
const { migration034 } = require('../db/migrations');

// Reproduz o schema como ele esta em PRODUCAO: `codigo TEXT UNIQUE` (global),
// tenant_id enfiado depois por ALTER TABLE (nullable, sem default), `ncm` idem.
function bancoAntigoPovoado() {
  const db = new DatabaseSync(':memory:');
  db.exec('PRAGMA foreign_keys = ON;');
  db.exec(`
    CREATE TABLE produtos (
      id            INTEGER PRIMARY KEY AUTOINCREMENT,
      codigo        TEXT UNIQUE NOT NULL,
      codigo_barras TEXT UNIQUE,
      nome          TEXT NOT NULL,
      categoria     TEXT,
      descricao     TEXT,
      cor           TEXT,
      custo         REAL NOT NULL DEFAULT 0,
      preco_venda   REAL NOT NULL DEFAULT 0,
      foto          TEXT,
      colecao       TEXT,
      ativo         INTEGER NOT NULL DEFAULT 1,
      criado_em     TEXT NOT NULL DEFAULT (datetime('now','localtime'))
    , ncm TEXT, tenant_id INTEGER);

    CREATE TABLE variacoes (
      id            INTEGER PRIMARY KEY AUTOINCREMENT,
      produto_id    INTEGER NOT NULL,
      cor           TEXT NOT NULL DEFAULT 'Unica',
      tamanho       TEXT NOT NULL,
      quantidade    INTEGER NOT NULL DEFAULT 0,
      codigo_barras TEXT,
      tenant_id     INTEGER,
      FOREIGN KEY (produto_id) REFERENCES produtos(id) ON DELETE CASCADE,
      UNIQUE (produto_id, cor, tamanho)
    );

    CREATE TABLE produto_fotos (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      produto_id INTEGER NOT NULL,
      caminho    TEXT NOT NULL,
      ordem      INTEGER NOT NULL DEFAULT 0,
      tenant_id  INTEGER NOT NULL,
      FOREIGN KEY (produto_id) REFERENCES produtos(id) ON DELETE CASCADE
    );

    CREATE TABLE movimentos_estoque (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      variacao_id INTEGER,
      tipo        TEXT NOT NULL,
      qtd         INTEGER NOT NULL,
      motivo      TEXT,
      FOREIGN KEY (variacao_id) REFERENCES variacoes(id) ON DELETE CASCADE
    );

    CREATE TABLE venda_itens (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      venda_id    INTEGER,
      produto_id  INTEGER,
      variacao_id INTEGER,
      qtd         INTEGER NOT NULL DEFAULT 1,
      FOREIGN KEY (variacao_id) REFERENCES variacoes(id) ON DELETE SET NULL,
      FOREIGN KEY (produto_id) REFERENCES produtos(id) ON DELETE SET NULL
    );
  `);

  // Duas lojas. A loja 30 cadastrou TES001; a loja 31 cadastrou TES002 e TES003.
  // Sob a UNIQUE global elas ja disputam o mesmo espaco de codigo — que e' o bug.
  const insP = db.prepare(
    'INSERT INTO produtos (id, codigo, codigo_barras, nome, preco_venda, tenant_id, ncm) VALUES (?, ?, ?, ?, ?, ?, ?)'
  );
  insP.run(1, 'TES001', '7890000000017', 'Vestido da loja 30', 100, 30, '6204');
  insP.run(2, 'TES002', '7890000000024', 'Blusa da loja 31', 80, 31, null);
  insP.run(3, 'TES003', '7890000000031', 'Saia da loja 31', 90, 31, null);

  const insV = db.prepare(
    'INSERT INTO variacoes (id, produto_id, cor, tamanho, quantidade, codigo_barras, tenant_id) VALUES (?, ?, ?, ?, ?, ?, ?)'
  );
  insV.run(10, 1, 'Preto', 'M', 3, '7891111111118', 30);
  insV.run(11, 2, 'Branco', 'P', 5, '7892222222229', 31);
  insV.run(12, 2, 'Branco', 'G', 2, '7893333333330', 31);

  db.prepare('INSERT INTO produto_fotos (produto_id, caminho, tenant_id) VALUES (?, ?, ?)')
    .run(1, '/img/produtos/TES001.jpg', 30);
  db.prepare("INSERT INTO movimentos_estoque (variacao_id, tipo, qtd, motivo) VALUES (?, 'entrada', ?, 'cadastro')")
    .run(10, 3);
  db.prepare("INSERT INTO movimentos_estoque (variacao_id, tipo, qtd, motivo) VALUES (?, 'entrada', ?, 'cadastro')")
    .run(11, 5);
  db.prepare('INSERT INTO venda_itens (id, venda_id, produto_id, variacao_id, qtd) VALUES (?, ?, ?, ?, ?)')
    .run(100, 1, 1, 10, 1);

  return db;
}

test('034: a loja B consegue cadastrar um codigo que a loja A ja usa', () => {
  const db = bancoAntigoPovoado();

  // ANTES: o bug. A loja 30 tenta usar TES002, que e' da loja 31 -> estoura.
  assert.throws(
    () => db.prepare('INSERT INTO produtos (codigo, nome, preco_venda, tenant_id) VALUES (?, ?, ?, ?)')
      .run('TES002', 'Peca nova da loja 30', 50, 30),
    /UNIQUE constraint failed/,
    'o teste precisa reproduzir o bug antes de provar o conserto'
  );

  migration034(db);

  // DEPOIS: cada loja tem seu proprio espaco de codigo.
  db.prepare('INSERT INTO produtos (codigo, nome, preco_venda, tenant_id) VALUES (?, ?, ?, ?)')
    .run('TES002', 'Peca nova da loja 30', 50, 30);

  const doisTES002 = db.prepare("SELECT tenant_id FROM produtos WHERE codigo = 'TES002' ORDER BY tenant_id").all();
  assert.deepStrictEqual(doisTES002.map((p) => p.tenant_id), [30, 31],
    'o mesmo codigo tem que poder existir uma vez em cada loja');

  // ...e continua unico DENTRO da loja.
  assert.throws(
    () => db.prepare('INSERT INTO produtos (codigo, nome, preco_venda, tenant_id) VALUES (?, ?, ?, ?)')
      .run('TES002', 'Duplicata na mesma loja', 50, 30),
    /UNIQUE constraint failed/,
    'duplicar codigo DENTRO da mesma loja continua proibido'
  );
});

test('034: o rebuild nao dispara CASCADE nem SET NULL (grade, fotos, historico intactos)', () => {
  const db = bancoAntigoPovoado();

  const antes = {
    produtos: db.prepare('SELECT COUNT(*) n FROM produtos').get().n,
    variacoes: db.prepare('SELECT COUNT(*) n FROM variacoes').get().n,
    fotos: db.prepare('SELECT COUNT(*) n FROM produto_fotos').get().n,
    movimentos: db.prepare('SELECT COUNT(*) n FROM movimentos_estoque').get().n,
    itens: db.prepare('SELECT COUNT(*) n FROM venda_itens WHERE produto_id IS NOT NULL').get().n,
  };

  migration034(db);

  assert.strictEqual(db.prepare('SELECT COUNT(*) n FROM produtos').get().n, antes.produtos, 'perdeu produto');
  assert.strictEqual(db.prepare('SELECT COUNT(*) n FROM variacoes').get().n, antes.variacoes,
    'o CASCADE de variacoes.produto_id comeu a grade');
  assert.strictEqual(db.prepare('SELECT COUNT(*) n FROM produto_fotos').get().n, antes.fotos,
    'o CASCADE de produto_fotos.produto_id comeu a galeria');
  assert.strictEqual(db.prepare('SELECT COUNT(*) n FROM movimentos_estoque').get().n, antes.movimentos,
    'o CASCADE encadeado (produtos -> variacoes -> movimentos) comeu o historico de estoque');
  assert.strictEqual(
    db.prepare('SELECT COUNT(*) n FROM venda_itens WHERE produto_id IS NOT NULL').get().n, antes.itens,
    'o SET NULL de venda_itens.produto_id apagou a peca do historico de venda'
  );

  assert.strictEqual(db.prepare('PRAGMA foreign_key_check').all().length, 0, 'ficou FK orfa');
});

test('034: os ids sobrevivem — venda e grade continuam apontando pra peca CERTA', () => {
  const db = bancoAntigoPovoado();
  migration034(db);

  // Se o AUTOINCREMENT tivesse renumerado, o banco continuaria integro e MENTINDO:
  // a venda passaria a apontar pra outra peca. Por isso conferimos o par id->codigo.
  const p1 = db.prepare('SELECT codigo, nome, tenant_id, ncm FROM produtos WHERE id = 1').get();
  assert.strictEqual(p1.codigo, 'TES001', 'o id 1 tem que continuar sendo o TES001');
  assert.strictEqual(p1.tenant_id, 30);
  assert.strictEqual(p1.ncm, '6204', 'a coluna ncm (que so existe em producao) nao foi copiada');

  // O item de venda 100 foi vendido do produto 1 (TES001, loja 30).
  const item = db.prepare(`
    SELECT p.codigo FROM venda_itens vi JOIN produtos p ON p.id = vi.produto_id WHERE vi.id = 100
  `).get();
  assert.strictEqual(item.codigo, 'TES001', 'a venda passou a apontar pra outra peca');

  // A grade do produto 2 (loja 31) continua sendo a dele.
  // (node:sqlite devolve linhas com prototype nulo — por isso o map, e nao um
  // deepStrictEqual direto na linha.)
  const grade = db.prepare('SELECT cor, tamanho FROM variacoes WHERE produto_id = 2 ORDER BY id')
    .all().map((v) => `${v.cor}/${v.tamanho}`);
  assert.deepStrictEqual(grade, ['Branco/P', 'Branco/G']);
});

test('034: rodar de novo nao faz nada (idempotente) e o proximo id nao recicla', () => {
  const db = bancoAntigoPovoado();
  migration034(db);

  const schemaDepois = db.prepare("SELECT sql FROM sqlite_master WHERE name = 'produtos'").get().sql;
  migration034(db);  // segunda passada: tem que ser no-op
  assert.strictEqual(
    db.prepare("SELECT sql FROM sqlite_master WHERE name = 'produtos'").get().sql, schemaDepois,
    'a migration recriou a tabela de novo — nao e idempotente'
  );
  assert.strictEqual(db.prepare('SELECT COUNT(*) n FROM produtos').get().n, 3, 'a segunda passada mexeu nos dados');

  // O AUTOINCREMENT foi preservado: o proximo produto nasce com id 4, nao reciclando
  // um id antigo (que colidiria com o historico apontando pra ele).
  const novo = db.prepare('INSERT INTO produtos (codigo, nome, preco_venda, tenant_id) VALUES (?, ?, ?, ?)')
    .run('TES004', 'Peca nova', 70, 31);
  assert.strictEqual(Number(novo.lastInsertRowid), 4, 'o AUTOINCREMENT reciclou um id ja usado');
});
