// ============================================================
// MIGRATIONS - Sistema de versionamento do banco
// NUNCA rodam 2x. NUNCA deletam dados. NUNCA perdem clientes.
// Cada migration tem: nome único, hash, data de execução
// ============================================================
const { DatabaseSync } = require('node:sqlite');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');

// Helper: hashear senha com scrypt (mesmo formato da app)
function hashSenha(senha) {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(String(senha), salt, 64).toString('hex');
  return `scrypt$${salt}$${hash}`;
}

const DB_DIR = process.env.DB_DIR || path.join(__dirname);
const DB_PATH = path.join(DB_DIR, 'easygestion.db');

// ============================================================
// MIGRATION 029 — a grade vira matriz COR x TAMANHO
//
// Antes: a cor era um campo do PRODUTO e a grade so tinha tamanho. O "Vestido
// Amanda preto" e o "Vestido Amanda vermelho" eram dois cadastros separados —
// entao era impossivel responder "o preto vende e o amarelo encalha" dentro do
// mesmo modelo, que e' metade da decisao de recompra em moda.
// Depois: um produto (o modelo) tem N variacoes, cada uma sendo o par (cor, tamanho),
// com estoque e codigo de barras proprios. Cada par e' um SKU.
//
// Esta migration esta separada e EXPORTADA porque ela mexe na identidade de uma
// tabela referenciada por 5 FKs — o teste (tests/migration-029-grade.test.js)
// precisa chama-la contra um banco povoado pra provar que nada se perdeu.
//
// -- POR QUE E' PERIGOSA, e o que a torna segura --
//
// O UNIQUE(produto_id, tamanho) e' INLINE no CREATE TABLE. ALTER TABLE nao remove
// constraint inline, entao trocar pra UNIQUE(produto_id, cor, tamanho) exige
// recriar a tabela. E recriar `variacoes` tem duas armadilhas silenciosas:
//
//   1. movimentos_estoque.variacao_id tem ON DELETE CASCADE, e o boot roda com
//      PRAGMA foreign_keys = ON. Um DROP TABLE variacoes apagaria TODO o historico
//      de movimento de estoque sem uma linha de erro.
//      -> Defesa: PRAGMA foreign_keys = OFF durante o rebuild. Com as FKs
//         desligadas o DROP nao propaga CASCADE. E' o procedimento oficial do
//         SQLite pra alteracao de schema (sqlite.org/lang_altertable.html).
//
//   2. Se o INSERT..SELECT nao copiar o `id` EXPLICITAMENTE, o AUTOINCREMENT
//      renumera as linhas. O banco continua integro — e venda_itens, troca_itens
//      e movimentos_estoque passam a apontar pra variacao ERRADA. Dado mentiroso
//      e' pior que dado perdido, porque ninguem percebe.
//      -> Defesa: o SELECT abaixo copia `id` na primeira coluna. Os ids sobrevivem.
//
// O PRAGMA foreign_keys e' IGNORADO em silencio dentro de uma transacao, entao
// ele fica fora do BEGIN. O runner de migrations nao abre transacao — por isso
// isto funciona aqui, e nao funcionaria se alguem envelopasse tudo num db.transaction().
// ============================================================
function migration029(db) {
  const colunas = () => db.prepare('PRAGMA table_info(variacoes)').all().map((c) => c.name);

  // ---- 1. Colunas novas (ADD COLUMN: nao toca na identidade da tabela) ----
  // Idempotente: em banco novo (schema.sql ja atualizado) elas ja existem.
  //
  // `cor` nasce NULL de proposito e e' preenchida no backfill logo abaixo. Um
  // DEFAULT 'Unica' aqui mascararia produtos que TEM cor cadastrada e ainda nao
  // foram backfillados — e o NOT NULL so pode entrar depois que todo mundo tem valor.
  if (!colunas().includes('cor')) {
    db.exec(`ALTER TABLE variacoes ADD COLUMN cor TEXT;`);
  }
  // O EAN passa a ser por VARIACAO: cada cor+tamanho e' um SKU distinto e merece o
  // proprio codigo. produtos.codigo_barras continua existindo (os antigos usam).
  if (!colunas().includes('codigo_barras')) {
    db.exec(`ALTER TABLE variacoes ADD COLUMN codigo_barras TEXT;`);
  }
  // tenant_id: existe em producao (entrou por um ALTER solto) mas NUNCA foi
  // declarado no schema.sql. Ou seja: um cliente NOVO nascia com variacoes sem
  // tenant_id, e o INSERT de routes/produtos.js (que passa tenant_id) quebrava no
  // primeiro cadastro. Mesmo padrao do bug das colunas de clientes (migration 028).
  // Corrigido no schema.sql; aqui fica o ALTER pros bancos que ainda nao tem.
  if (!colunas().includes('tenant_id')) {
    db.exec(`ALTER TABLE variacoes ADD COLUMN tenant_id INTEGER;`);
  }

  // ---- 2. Backfill ----
  // Cada variacao herda a cor do produto pai. Onde o produto nao tem cor, vira
  // 'Unica' — NUNCA NULL: no SQLite NULL != NULL, entao UNIQUE(produto_id, cor,
  // tamanho) NAO barraria dois (produto=1, cor=NULL, tamanho='M'). O UNIQUE viraria
  // decorativo justamente no caso mais comum (produto sem cor cadastrada).
  db.exec(`
    UPDATE variacoes
    SET cor = COALESCE(
      NULLIF(TRIM((SELECT p.cor FROM produtos p WHERE p.id = variacoes.produto_id)), ''),
      'Unica'
    )
    WHERE cor IS NULL OR TRIM(cor) = '';
  `);
  // tenant_id orfao (bancos que pegaram o ALTER sem backfill): puxa do produto dono.
  db.exec(`
    UPDATE variacoes
    SET tenant_id = (SELECT p.tenant_id FROM produtos p WHERE p.id = variacoes.produto_id)
    WHERE tenant_id IS NULL;
  `);

  // ---- 3. Indices ----
  // Moram AQUI e nao no schema.sql de proposito: o schema.sql roda ANTES das
  // migrations e, num banco que ja existe, o CREATE TABLE IF NOT EXISTS nao recria
  // a tabela — as colunas cor/codigo_barras/tenant_id so passam a existir depois dos
  // ALTERs la em cima. Um CREATE INDEX sobre elas no schema.sql derruba o boot com
  // "no such column" (ja aconteceu, e aconteceu de novo enquanto eu escrevia isto).
  const criarIndices = () => {
    db.exec(`CREATE INDEX IF NOT EXISTS idx_variacoes_produto ON variacoes(produto_id);`);
    db.exec(`CREATE INDEX IF NOT EXISTS idx_variacoes_tenant  ON variacoes(tenant_id);`);
    // EAN unico por SKU. Parcial (WHERE NOT NULL) porque as variacoes antigas nao tem
    // codigo proprio — e deixar isso explicito e' melhor do que depender do fato de
    // que, no SQLite, NULL nunca colide num UNIQUE.
    db.exec(`CREATE UNIQUE INDEX IF NOT EXISTS idx_variacoes_ean ON variacoes(codigo_barras) WHERE codigo_barras IS NOT NULL;`);
  };

  // ---- 4. O rebuild (so pra trocar o UNIQUE inline) ----
  // Se a tabela ja tem o UNIQUE novo, nao ha o que rebuildar: e' um banco criado do
  // schema.sql ja atualizado. So garante os indices e sai. E' isto que torna a
  // migration idempotente e inofensiva num banco novo.
  const ddl = db.prepare(`SELECT sql FROM sqlite_master WHERE type='table' AND name='variacoes'`).get();
  const precisaRebuild = ddl && /UNIQUE\s*\(\s*produto_id\s*,\s*tamanho\s*\)/i.test(ddl.sql);
  if (!precisaRebuild) {
    criarIndices();
    return;
  }

  // Colisao: se dois produtos-cor foram cadastrados como o MESMO produto (nao deveria
  // acontecer, o UNIQUE antigo impedia), o UNIQUE novo falharia no meio do rebuild e
  // deixaria a tabela pela metade. Checa ANTES de derrubar qualquer coisa.
  const colisao = db.prepare(`
    SELECT produto_id, cor, tamanho, COUNT(*) n
    FROM variacoes GROUP BY produto_id, cor, tamanho HAVING n > 1
  `).all();
  if (colisao.length) {
    throw new Error(
      `029 abortada: ${colisao.length} par(es) (produto, cor, tamanho) duplicados. ` +
      `Resolva antes de migrar — o rebuild perderia esses registros. Ex: ` +
      JSON.stringify(colisao[0])
    );
  }

  const antes = db.prepare('SELECT COUNT(*) n, COALESCE(SUM(quantidade),0) s FROM variacoes').get();
  const movAntes = db.prepare('SELECT COUNT(*) n FROM movimentos_estoque').get().n;

  // FKs OFF: e' o que impede o DROP de disparar o CASCADE de movimentos_estoque.
  // Fica FORA do BEGIN — dentro de transacao o PRAGMA e' ignorado sem avisar.
  db.exec('PRAGMA foreign_keys = OFF;');
  try {
    db.exec('BEGIN IMMEDIATE;');
    try {
      db.exec(`
        CREATE TABLE variacoes_nova (
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
      `);
      // `id` copiado EXPLICITAMENTE. Sem isso o AUTOINCREMENT renumera e
      // venda_itens/movimentos/troca_itens passam a apontar pra peca errada.
      db.exec(`
        INSERT INTO variacoes_nova (id, produto_id, cor, tamanho, quantidade, codigo_barras, tenant_id)
        SELECT id, produto_id, COALESCE(NULLIF(TRIM(cor), ''), 'Unica'), tamanho, quantidade, codigo_barras, tenant_id
        FROM variacoes;
      `);
      db.exec(`DROP TABLE variacoes;`);          // nao propaga CASCADE: FKs estao OFF
      db.exec(`ALTER TABLE variacoes_nova RENAME TO variacoes;`);

      criarIndices();  // o DROP levou os indices antigos junto

      // Preserva o AUTOINCREMENT: sem isto, o proximo INSERT poderia reciclar um id
      // ja usado por uma variacao apagada — e colidir com o historico que aponta pra ele.
      db.exec(`
        INSERT OR REPLACE INTO sqlite_sequence (name, seq)
        VALUES ('variacoes', (SELECT COALESCE(MAX(id), 0) FROM variacoes));
      `);

      // -- Provas, ainda DENTRO da transacao: se qualquer uma falhar, ROLLBACK. --
      const depois = db.prepare('SELECT COUNT(*) n, COALESCE(SUM(quantidade),0) s FROM variacoes').get();
      if (depois.n !== antes.n) throw new Error(`029: perdeu variacao (${antes.n} -> ${depois.n})`);
      if (depois.s !== antes.s) throw new Error(`029: o estoque total mudou (${antes.s} -> ${depois.s})`);

      const movDepois = db.prepare('SELECT COUNT(*) n FROM movimentos_estoque').get().n;
      if (movDepois !== movAntes) throw new Error(`029: o CASCADE comeu movimentos_estoque (${movAntes} -> ${movDepois})`);

      const orfas = db.prepare('PRAGMA foreign_key_check').all();
      if (orfas.length) throw new Error(`029: ${orfas.length} FK(s) orfa(s) apos o rebuild`);

      db.exec('COMMIT;');
    } catch (e) {
      db.exec('ROLLBACK;');
      throw e;
    }
  } finally {
    // SEMPRE religa, mesmo se explodiu no meio: um servidor rodando com
    // foreign_keys OFF aceita silenciosamente qualquer lixo referencial.
    db.exec('PRAGMA foreign_keys = ON;');
  }
}

// ============================================================
// MIGRATION 034 — o codigo do produto passa a ser unico POR LOJA
//
// BUG (500 no cadastro de produto, "Erro interno do servidor"): em producao a
// tabela `produtos` e' de antes do multi-tenant e tem
//
//     codigo        TEXT UNIQUE NOT NULL      <- UNIQUE GLOBAL, entre TODAS as lojas
//     codigo_barras TEXT UNIQUE               <- idem
//
// enquanto o schema.sql (que so vale pra banco NOVO — CREATE TABLE IF NOT EXISTS
// nao altera tabela existente) ja diz UNIQUE(tenant_id, codigo). O codigo assume o
// schema novo: proximoCodigo() em routes/produtos.js procura o ultimo codigo DA
// LOJA e gera o proximo. Com a UNIQUE global, a loja B tentando cadastrar 'TES003'
// batia no 'TES003' que a loja A ja tinha — e o INSERT morria com
// "UNIQUE constraint failed: produtos.codigo". A loja B simplesmente nao conseguia
// mais cadastrar produto, e o motivo estava na base de OUTRA loja.
//
// Nao e' so um 500: e' vazamento entre lojas. Cada loja nova encostava na anterior.
//
// -- POR QUE E' PERIGOSA, e o que a torna segura --
//
// UNIQUE inline nao sai com ALTER TABLE: a tabela precisa ser recriada. E `produtos`
// e' referenciada por 5 FKs — DUAS delas ON DELETE CASCADE:
//
//   produto_fotos.produto_id     -> CASCADE   (apagaria a galeria inteira)
//   variacoes.produto_id         -> CASCADE   (apagaria a grade... e o CASCADE de
//                                              movimentos_estoque.variacao_id atras dela)
//   venda_itens.produto_id       -> SET NULL  (o historico de venda perderia a peca)
//   troca_itens.produto_id       -> SET NULL
//   encomendas.produto_id        -> SET NULL
//
// Um DROP TABLE produtos com as FKs ligadas nao daria erro nenhum: levaria junto a
// grade, as fotos e o historico de movimento, e zeraria a peca das vendas passadas.
// As duas defesas sao as mesmas da migration 029, pelos mesmos motivos:
//
//   1. PRAGMA foreign_keys = OFF durante o rebuild (procedimento oficial do SQLite,
//      sqlite.org/lang_altertable.html). Sem CASCADE, o DROP nao propaga.
//      O PRAGMA e' IGNORADO em silencio dentro de transacao -> fica FORA do BEGIN.
//   2. O INSERT..SELECT copia `id` EXPLICITAMENTE. Sem isso o AUTOINCREMENT renumera
//      e variacoes/venda_itens passam a apontar pro produto ERRADO — dado mentiroso,
//      que e' pior que dado perdido porque ninguem percebe.
//
// Idempotente: so roda se a UNIQUE global antiga ainda estiver la.
// ============================================================
function migration034(db) {
  // A assinatura do bug: `codigo TEXT UNIQUE` na propria coluna. No schema correto
  // a palavra UNIQUE so aparece nas constraints de tabela, no fim do CREATE.
  const tabela = db.prepare(
    `SELECT sql FROM sqlite_master WHERE type='table' AND name='produtos'`
  ).get();
  if (!tabela) return;                                   // banco sem produtos: nada a fazer
  const temUniqueGlobal = /codigo\s+TEXT\s+UNIQUE/i.test(tabela.sql);
  if (!temUniqueGlobal) return;                          // banco novo: ja nasceu certo

  // Colisoes REAIS de (tenant_id, codigo) impediriam a UNIQUE nova de ser criada.
  // A UNIQUE global antiga tornava isso impossivel dentro do mesmo tenant, mas
  // conferimos antes de derrubar a tabela — falhar aqui e' falhar ANTES do DROP.
  const dup = db.prepare(`
    SELECT COALESCE(tenant_id, 1) t, codigo, COUNT(*) n FROM produtos
    GROUP BY COALESCE(tenant_id, 1), codigo HAVING n > 1 LIMIT 1
  `).get();
  if (dup) {
    throw new Error(`034: loja ${dup.t} tem o codigo '${dup.codigo}' repetido ${dup.n}x — resolva antes`);
  }

  const antes = db.prepare('SELECT COUNT(*) n FROM produtos').get().n;
  const varAntes = db.prepare('SELECT COUNT(*) n FROM variacoes').get().n;
  const movAntes = db.prepare('SELECT COUNT(*) n FROM movimentos_estoque').get().n;
  const fotosAntes = db.prepare('SELECT COUNT(*) n FROM produto_fotos').get().n;
  // Quantos itens de venda apontam pra um produto: se um SET NULL escapar, isto cai.
  const itensAntes = db.prepare('SELECT COUNT(*) n FROM venda_itens WHERE produto_id IS NOT NULL').get().n;

  // As colunas que a tabela REALMENTE tem hoje: `ncm` entrou por ALTER TABLE em
  // producao e nao existe no schema.sql. Copiar uma coluna que nao existe (ou
  // esquecer uma que existe) quebraria o INSERT..SELECT.
  const colunas = db.prepare('PRAGMA table_info(produtos)').all().map((c) => c.name);
  const temNcm = colunas.includes('ncm');

  // FKs OFF: e' o que impede o DROP de comer variacoes, produto_fotos e o historico.
  // FORA do BEGIN — dentro de transacao o PRAGMA e' ignorado sem avisar.
  db.exec('PRAGMA foreign_keys = OFF;');
  try {
    db.exec('BEGIN IMMEDIATE;');
    try {
      db.exec(`
        CREATE TABLE produtos_nova (
          id            INTEGER PRIMARY KEY AUTOINCREMENT,
          tenant_id     INTEGER NOT NULL DEFAULT 1,
          codigo        TEXT NOT NULL,
          codigo_barras TEXT,
          nome          TEXT NOT NULL,
          categoria     TEXT,
          descricao     TEXT,
          cor           TEXT,
          custo         REAL NOT NULL DEFAULT 0,
          preco_venda   REAL NOT NULL DEFAULT 0,
          foto          TEXT,
          colecao       TEXT,
          ativo         INTEGER NOT NULL DEFAULT 1,
          criado_em     TEXT NOT NULL DEFAULT (datetime('now','localtime')),
          ncm           TEXT,
          UNIQUE(tenant_id, codigo),
          UNIQUE(tenant_id, codigo_barras)
        );
      `);

      // `id` copiado EXPLICITAMENTE (ver o cabecalho). tenant_id COALESCE pra 1:
      // a coluna e' nullable na tabela antiga e NOT NULL na nova.
      db.exec(`
        INSERT INTO produtos_nova (id, tenant_id, codigo, codigo_barras, nome, categoria,
                                   descricao, cor, custo, preco_venda, foto, colecao,
                                   ativo, criado_em, ncm)
        SELECT id, COALESCE(tenant_id, 1), codigo, codigo_barras, nome, categoria,
               descricao, cor, custo, preco_venda, foto, colecao,
               ativo, criado_em, ${temNcm ? 'ncm' : 'NULL'}
        FROM produtos;
      `);

      db.exec('DROP TABLE produtos;');                   // nao propaga CASCADE: FKs OFF
      db.exec('ALTER TABLE produtos_nova RENAME TO produtos;');

      // O DROP levou os indices junto.
      db.exec(`
        CREATE INDEX IF NOT EXISTS idx_produtos_tenant ON produtos(tenant_id);
        CREATE INDEX IF NOT EXISTS idx_produtos_tenant_categoria ON produtos(tenant_id, categoria);
        CREATE INDEX IF NOT EXISTS idx_produtos_tenant_colecao ON produtos(tenant_id, colecao);
      `);

      // Preserva o AUTOINCREMENT: senao o proximo INSERT recicla um id ja usado e
      // colide com o historico que aponta pra ele.
      db.exec(`
        INSERT OR REPLACE INTO sqlite_sequence (name, seq)
        VALUES ('produtos', (SELECT COALESCE(MAX(id), 0) FROM produtos));
      `);

      // -- Provas, ainda DENTRO da transacao: se qualquer uma falhar, ROLLBACK. --
      const depois = db.prepare('SELECT COUNT(*) n FROM produtos').get().n;
      if (depois !== antes) throw new Error(`034: perdeu produto (${antes} -> ${depois})`);

      const varDepois = db.prepare('SELECT COUNT(*) n FROM variacoes').get().n;
      if (varDepois !== varAntes) throw new Error(`034: o CASCADE comeu a grade (${varAntes} -> ${varDepois})`);

      const movDepois = db.prepare('SELECT COUNT(*) n FROM movimentos_estoque').get().n;
      if (movDepois !== movAntes) throw new Error(`034: o CASCADE comeu movimentos_estoque (${movAntes} -> ${movDepois})`);

      const fotosDepois = db.prepare('SELECT COUNT(*) n FROM produto_fotos').get().n;
      if (fotosDepois !== fotosAntes) throw new Error(`034: o CASCADE comeu produto_fotos (${fotosAntes} -> ${fotosDepois})`);

      const itensDepois = db.prepare('SELECT COUNT(*) n FROM venda_itens WHERE produto_id IS NOT NULL').get().n;
      if (itensDepois !== itensAntes) throw new Error(`034: um SET NULL apagou a peca do historico de venda (${itensAntes} -> ${itensDepois})`);

      const orfas = db.prepare('PRAGMA foreign_key_check').all();
      if (orfas.length) throw new Error(`034: ${orfas.length} FK(s) orfa(s) apos o rebuild`);

      db.exec('COMMIT;');
    } catch (e) {
      db.exec('ROLLBACK;');
      throw e;
    }
  } finally {
    // SEMPRE religa, mesmo se explodiu no meio: um servidor rodando com
    // foreign_keys OFF aceita silenciosamente qualquer lixo referencial.
    db.exec('PRAGMA foreign_keys = ON;');
  }
}

// ============================================================
// MIGRATION 035 — o nome do usuario passa a ser unico POR LOJA (o email continua global)
//
// Mesma familia de bug da 024 (caixa_dia) e da 034 (produtos): em producao a tabela
// e' de antes do multi-tenant e tem
//
//     nome  TEXT UNIQUE NOT NULL    <- UNIQUE GLOBAL, entre TODAS as lojas
//     email TEXT UNIQUE
//
// Efeito: a loja A cadastra uma vendedora "Maria" e NENHUMA outra loja consegue
// cadastrar a Maria dela. E "Maria", "Joao", "Caixa" sao exatamente os nomes que se
// repetem entre lojas. routes/usuarios.js:40 ja valida como se fosse unico-por-loja
// ("Ja existe um usuario com esse nome" checando AND tenant_id = ?) — o schema e' que
// ficou pra tras. Nao estourou ainda so porque o signup grava o EMAIL no campo nome.
//
// -- POR QUE `nome` PODE virar por-loja e `email` NAO --
//
// nome: nao autentica nada (o login e' por email), nao e' FK de ninguem, e nao tem
//   relacao com o vendedor da venda (vendas.vendedor_id -> tabela `vendedores`, outra
//   coisa). No front e' so rotulo. -> UNIQUE(tenant_id, nome).
//
// email: E' a identidade de login. routes/auth.js faz
//   `SELECT * FROM usuarios WHERE LOWER(email) = LOWER(?)` SEM tenant_id — a tela de
//   login pede so email+senha, nao tem seletor de loja. Se dois usuarios de lojas
//   diferentes tivessem o mesmo email, o .get() pegaria um dos dois por ordem de
//   rowid e a pessoa entraria na LOJA ERRADA. -> o email continua UNIQUE GLOBAL.
//   ATENCAO: db/schema.sql dizia UNIQUE(tenant_id, email), que e' MAIS FRACO que a
//   producao. Copiar o schema.sql como estava aqui teria RELAXADO a garantia do email.
//
// De brinde, o UNIQUE global de email vira um indice sobre LOWER(email): a coluna era
// case-sensitive, entao 'Maria@x.com' e 'maria@x.com' cabiam as duas na tabela — e o
// login, que busca com LOWER(), pegava uma delas arbitrariamente.
//
// -- POR QUE E' PERIGOSA --
//
// UNIQUE inline nao sai com ALTER TABLE: a tabela precisa ser recriada. E DUAS FKs
// CASCADE apontam pra usuarios (tokens_verificacao.usuario_id, email_verifications.
// usuario_id): um DROP com as FKs ligadas apagaria os tokens em silencio. Defesas
// identicas as da 034 — foreign_keys OFF fora do BEGIN, e id copiado explicitamente
// (auditoria.usuario_id aponta pra ca; renumerar faria a auditoria acusar a pessoa
// errada). Idempotente: so roda se a UNIQUE global antiga ainda estiver la.
//
// PRE-REQUISITO (mesmo deploy): routes/auth.js buscava o usuario logado por
// `WHERE nome = ?` sem tenant (PATCH /me/senha e DELETE /me/conta). Com o nome
// repetindo entre lojas, isso deixaria a Maria da loja B trocar a senha da Maria da
// loja A. Agora a sessao guarda usuario_id e a busca e' por id.
// ============================================================
function migration035(db) {
  const tabela = db.prepare(
    `SELECT sql FROM sqlite_master WHERE type='table' AND name='usuarios'`
  ).get();
  if (!tabela) return;

  // O indice unico do email e' criado AQUI (e nao no schema.sql) porque e' UNIQUE:
  // num banco com dois emails que diferem so no maiusculo/minusculo — o UNIQUE antigo
  // era case-SENSITIVE e deixava passar — cria-lo no boot derrubaria o servidor. Aqui
  // da pra conferir antes. Roda ANTES do guard abaixo de proposito: banco NOVO ja
  // nasce com o schema certo (nao cai no rebuild) mas tambem precisa deste indice.
  const criarIndiceEmailGlobal = () => {
    const dupEmail = db.prepare(`
      SELECT LOWER(email) e, COUNT(*) n FROM usuarios
      WHERE email IS NOT NULL AND TRIM(email) <> ''
      GROUP BY LOWER(email) HAVING n > 1 LIMIT 1
    `).get();
    if (dupEmail) {
      throw new Error(`035: o email '${dupEmail.e}' aparece ${dupEmail.n}x (o login ficaria ambiguo) — resolva antes`);
    }
    db.exec(`
      CREATE UNIQUE INDEX IF NOT EXISTS idx_usuarios_email_global
      ON usuarios(LOWER(email)) WHERE email IS NOT NULL AND TRIM(email) <> '';
    `);
  };

  // Assinatura do bug: UNIQUE colado na propria coluna.
  if (!/nome\s+TEXT\s+UNIQUE/i.test(tabela.sql)) {
    criarIndiceEmailGlobal();   // banco novo/ja migrado: so garante o indice
    return;
  }

  // Falhar ANTES do DROP, nao depois. (nome e' case-insensitive na checagem porque
  // routes/usuarios.js:40 compara com LOWER().)
  const dupNome = db.prepare(`
    SELECT COALESCE(tenant_id, 1) t, nome, COUNT(*) n FROM usuarios
    GROUP BY COALESCE(tenant_id, 1), LOWER(nome) HAVING n > 1 LIMIT 1
  `).get();
  if (dupNome) {
    throw new Error(`035: loja ${dupNome.t} tem o usuario '${dupNome.nome}' repetido ${dupNome.n}x — resolva antes`);
  }

  const antes = db.prepare('SELECT COUNT(*) n FROM usuarios').get().n;
  const tokensAntes = db.prepare('SELECT COUNT(*) n FROM tokens_verificacao').get().n;
  const verifAntes = db.prepare('SELECT COUNT(*) n FROM email_verifications').get().n;
  // A auditoria aponta pra usuarios com SET NULL: se um id sumir, ela perde o autor.
  const audAntes = db.prepare('SELECT COUNT(*) n FROM auditoria WHERE usuario_id IS NOT NULL').get().n;

  const colunas = db.prepare('PRAGMA table_info(usuarios)').all().map((c) => c.name);
  const temVerificado = colunas.includes('email_verificado');   // entrou por ALTER (014)

  db.exec('PRAGMA foreign_keys = OFF;');   // FORA do BEGIN — dentro dele o PRAGMA e' ignorado
  try {
    db.exec('BEGIN IMMEDIATE;');
    try {
      db.exec(`
        CREATE TABLE usuarios_nova (
          id               INTEGER PRIMARY KEY AUTOINCREMENT,
          tenant_id        INTEGER NOT NULL DEFAULT 1,
          nome             TEXT NOT NULL,
          email            TEXT,
          senha_hash       TEXT NOT NULL,
          papel            TEXT NOT NULL DEFAULT 'relacionamento',
          ativo            INTEGER NOT NULL DEFAULT 1,
          email_verificado INTEGER NOT NULL DEFAULT 0,
          criado_em        TEXT NOT NULL DEFAULT (datetime('now','localtime')),
          UNIQUE(tenant_id, nome)
        );
      `);

      // `id` copiado EXPLICITAMENTE: auditoria.usuario_id aponta pra ca.
      db.exec(`
        INSERT INTO usuarios_nova (id, tenant_id, nome, email, senha_hash, papel, ativo, email_verificado, criado_em)
        SELECT id, COALESCE(tenant_id, 1), nome, email, senha_hash, papel, ativo,
               ${temVerificado ? 'COALESCE(email_verificado, 0)' : '0'}, criado_em
        FROM usuarios;
      `);

      db.exec('DROP TABLE usuarios;');     // nao propaga CASCADE: FKs OFF
      db.exec('ALTER TABLE usuarios_nova RENAME TO usuarios;');

      db.exec(`
        CREATE INDEX IF NOT EXISTS idx_usuarios_nome ON usuarios(nome);
        CREATE INDEX IF NOT EXISTS idx_usuarios_email ON usuarios(email);
        CREATE INDEX IF NOT EXISTS idx_usuarios_tenant ON usuarios(tenant_id);
        CREATE INDEX IF NOT EXISTS idx_usuarios_email_verificado ON usuarios(email_verificado);
      `);

      // O email continua GLOBAL (o login nao filtra por loja), agora tambem
      // case-insensitive. Confere duplicata antes de criar — se houver, estoura aqui
      // dentro da transacao e o ROLLBACK desfaz o rebuild inteiro.
      criarIndiceEmailGlobal();

      db.exec(`
        INSERT OR REPLACE INTO sqlite_sequence (name, seq)
        VALUES ('usuarios', (SELECT COALESCE(MAX(id), 0) FROM usuarios));
      `);

      // -- Provas, DENTRO da transacao: qualquer perda, ROLLBACK. --
      const depois = db.prepare('SELECT COUNT(*) n FROM usuarios').get().n;
      if (depois !== antes) throw new Error(`035: perdeu usuario (${antes} -> ${depois})`);

      const tokensDepois = db.prepare('SELECT COUNT(*) n FROM tokens_verificacao').get().n;
      if (tokensDepois !== tokensAntes) throw new Error(`035: o CASCADE comeu tokens_verificacao (${tokensAntes} -> ${tokensDepois})`);

      const verifDepois = db.prepare('SELECT COUNT(*) n FROM email_verifications').get().n;
      if (verifDepois !== verifAntes) throw new Error(`035: o CASCADE comeu email_verifications (${verifAntes} -> ${verifDepois})`);

      const audDepois = db.prepare('SELECT COUNT(*) n FROM auditoria WHERE usuario_id IS NOT NULL').get().n;
      if (audDepois !== audAntes) throw new Error(`035: um SET NULL apagou o autor na auditoria (${audAntes} -> ${audDepois})`);

      const orfas = db.prepare('PRAGMA foreign_key_check').all();
      if (orfas.length) throw new Error(`035: ${orfas.length} FK(s) orfa(s) apos o rebuild`);

      db.exec('COMMIT;');
    } catch (e) {
      db.exec('ROLLBACK;');
      throw e;
    }
  } finally {
    db.exec('PRAGMA foreign_keys = ON;');
  }
}

// ============================================================
// MIGRATION 036 — o codigo do vale passa a ser unico POR LOJA
//
// Mesma familia: em producao `codigo TEXT UNIQUE NOT NULL` — global entre lojas.
//
// O agravante aqui e' COMO o codigo nasce: ele e' SORTEADO ('VALE-' + 6 chars de um
// alfabeto de 32) e gravado sem checar se ja existe. Com a UNIQUE global, o sorteio
// disputa espaco com TODAS as lojas somadas — o risco de colisao cresce com o numero
// de clientes do SaaS, nao com o tamanho de cada loja. E o estrago e' desproporcional:
// o vale do clube e' emitido DENTRO da transacao da venda (lib/clube.js), entao uma
// colisao derruba a VENDA INTEIRA na frente da cliente.
//
// Isolar por loja da a cada uma seu proprio espaco de ~1 bilhao de codigos. E nao
// quebra leitura nenhuma: TODA busca de vale por codigo ja filtra por tenant
// (routes/vales.js, routes/vendas.js) — a UNIQUE global nao estava protegendo nada,
// so causando INSERT que falha.
//
// A trava de vez esta no par: aqui (o espaco) + o retry em lib/clube.js
// gerarCodigoVale() (que agora confere antes de gravar, no molde de lib/sku.js).
//
// Rebuild mais tranquilo que o da 035: NINGUEM aponta FK pra vales. Mas as defesas
// ficam de pe do mesmo jeito — vales.troca_id/cliente_id apontam pra FORA, e o id
// e' referenciado por vendas.vale_id... nao: por nada. Ainda assim copiamos o id
// explicitamente (o codigo do vale circula impresso no cupom; renumerar seria feio).
// ============================================================
function migration036(db) {
  const tabela = db.prepare(
    `SELECT sql FROM sqlite_master WHERE type='table' AND name='vales'`
  ).get();
  if (!tabela) return;
  if (!/codigo\s+TEXT\s+UNIQUE/i.test(tabela.sql)) return;   // ja migrado

  const dup = db.prepare(`
    SELECT COALESCE(tenant_id, 1) t, codigo, COUNT(*) n FROM vales
    GROUP BY COALESCE(tenant_id, 1), codigo HAVING n > 1 LIMIT 1
  `).get();
  if (dup) {
    throw new Error(`036: loja ${dup.t} tem o vale '${dup.codigo}' repetido ${dup.n}x — resolva antes`);
  }

  const antes = db.prepare('SELECT COUNT(*) n FROM vales').get().n;
  const saldoAntes = db.prepare('SELECT COALESCE(SUM(saldo), 0) s FROM vales').get().s;

  // A tabela ganhou colunas por ALTER (migrations 012, 025, 030) que NAO estao no
  // CREATE original da 006. Copiar so o que existe de fato.
  const colunas = db.prepare('PRAGMA table_info(vales)').all().map((c) => c.name);
  const extras = ['venda_utilizacao_id', 'data_utilizacao', 'origem', 'clube_ciclo']
    .filter((c) => colunas.includes(c));

  db.exec('PRAGMA foreign_keys = OFF;');
  try {
    db.exec('BEGIN IMMEDIATE;');
    try {
      db.exec(`
        CREATE TABLE vales_nova (
          id                  INTEGER PRIMARY KEY AUTOINCREMENT,
          tenant_id           INTEGER NOT NULL DEFAULT 1,
          codigo              TEXT NOT NULL,
          valor               REAL NOT NULL DEFAULT 0,
          saldo               REAL NOT NULL DEFAULT 0,
          utilizado           REAL NOT NULL DEFAULT 0,
          troca_id            INTEGER,
          cliente_id          INTEGER,
          data_geracao        TEXT NOT NULL DEFAULT (datetime('now','localtime')),
          validade            TEXT,
          ativo               INTEGER NOT NULL DEFAULT 1,
          notas               TEXT,
          venda_utilizacao_id INTEGER,
          data_utilizacao     TEXT,
          origem              TEXT NOT NULL DEFAULT 'troca',
          clube_ciclo         INTEGER,
          UNIQUE (tenant_id, codigo),
          FOREIGN KEY (troca_id) REFERENCES trocas(id) ON DELETE SET NULL,
          FOREIGN KEY (cliente_id) REFERENCES clientes(id) ON DELETE SET NULL
        );
      `);

      const base = ['id', 'tenant_id', 'codigo', 'valor', 'saldo', 'utilizado', 'troca_id',
        'cliente_id', 'data_geracao', 'validade', 'ativo', 'notas'];
      const destino = [...base, ...extras].join(', ');
      // COALESCE no tenant_id: a coluna e' nullable na antiga e NOT NULL na nova.
      const origem = ['id', 'COALESCE(tenant_id, 1)', 'codigo', 'valor', 'saldo', 'utilizado',
        'troca_id', 'cliente_id', 'data_geracao', 'validade', 'ativo', 'notas',
        ...extras.map((c) => (c === 'origem' ? "COALESCE(origem, 'troca')" : c))].join(', ');

      db.exec(`INSERT INTO vales_nova (${destino}) SELECT ${origem} FROM vales;`);
      db.exec('DROP TABLE vales;');
      db.exec('ALTER TABLE vales_nova RENAME TO vales;');

      db.exec(`
        CREATE INDEX IF NOT EXISTS idx_vales_codigo ON vales(codigo);
        CREATE INDEX IF NOT EXISTS idx_vales_cliente ON vales(cliente_id);
        CREATE INDEX IF NOT EXISTS idx_vales_ativo ON vales(ativo);
      `);
      // O indice parcial do clube (migration 030): e' o que impede emitir dois premios
      // no mesmo ciclo pro mesmo cliente. O DROP levou junto — recria.
      db.exec(`
        CREATE INDEX IF NOT EXISTS idx_vales_clube
        ON vales(tenant_id, cliente_id, clube_ciclo) WHERE origem = 'clube';
      `);

      db.exec(`
        INSERT OR REPLACE INTO sqlite_sequence (name, seq)
        VALUES ('vales', (SELECT COALESCE(MAX(id), 0) FROM vales));
      `);

      const depois = db.prepare('SELECT COUNT(*) n FROM vales').get().n;
      if (depois !== antes) throw new Error(`036: perdeu vale (${antes} -> ${depois})`);
      const saldoDepois = db.prepare('SELECT COALESCE(SUM(saldo), 0) s FROM vales').get().s;
      if (saldoDepois !== saldoAntes) throw new Error(`036: o saldo em vales mudou (${saldoAntes} -> ${saldoDepois})`);

      const orfas = db.prepare('PRAGMA foreign_key_check').all();
      if (orfas.length) throw new Error(`036: ${orfas.length} FK(s) orfa(s) apos o rebuild`);

      db.exec('COMMIT;');
    } catch (e) {
      db.exec('ROLLBACK;');
      throw e;
    }
  } finally {
    db.exec('PRAGMA foreign_keys = ON;');
  }
}

function executarMigrations(db) {
  // 1. Criar tabela de controle (se não existir)
  db.exec(`
    CREATE TABLE IF NOT EXISTS migrations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      nome TEXT UNIQUE NOT NULL,
      hash TEXT,
      executada_em DATETIME DEFAULT CURRENT_TIMESTAMP
    );
  `);

  // 2. Lista de todas as migrations (idempotentes)
  const migrations = [
    {
      nome: '001_create_tables',
      hash: 'v1-schema',
      exec: (db) => {
        // Schema já foi criado por schema.sql
        // Apenas garantir que impostos existe
        db.exec(`
          CREATE TABLE IF NOT EXISTS impostos (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            tenant_id INTEGER NOT NULL,
            estado TEXT NOT NULL,
            categoria TEXT,
            icms_pct REAL DEFAULT 0,
            ipi_pct REAL DEFAULT 0,
            pis_pct REAL DEFAULT 0,
            cofins_pct REAL DEFAULT 0,
            criado_em DATETIME DEFAULT CURRENT_TIMESTAMP,
            UNIQUE(tenant_id, estado, categoria),
            FOREIGN KEY(tenant_id) REFERENCES tenants(id)
          );
        `);
      }
    },
    {
      nome: '002_add_audit_columns',
      hash: 'v2-audit',
      exec: (db) => {
        // Adicionar colunas de auditoria se não existirem
        const colunas = db.prepare(`PRAGMA table_info(vendas)`).all().map(c => c.name);
        if (!colunas.includes('auditoria_id')) {
          db.exec(`ALTER TABLE vendas ADD COLUMN auditoria_id INTEGER`);
        }
      }
    },
    {
      nome: '003_seed_admin_tenant',
      hash: 'v3-seed',
      exec: (db) => {
        // Garantir que Admin tenant existe (ID 1) - NUNCA deleta existentes
        const temAdmin = db.prepare('SELECT 1 FROM tenants WHERE id = 1').get();
        if (!temAdmin) {
          db.prepare(`
            INSERT INTO tenants (id, nome_loja, email, senha_hash, nome_responsavel, telefone, status, plano)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)
          `).run(1, 'EasyGestão Admin', 'admin@easygestao.com', 'admin', 'Admin', '00000000000', 'ativo', 'admin');
        }
      }
    },
    {
      nome: '004_ensure_ds_store_exists',
      hash: 'v4-ds-store',
      exec: (db) => {
        // Garantir que DS Store existe - NUNCA deleta, apenas cria se não existir
        const temDSStore = db.prepare('SELECT 1 FROM tenants WHERE nome_loja = ?').get('DS Store');
        if (!temDSStore) {
          const senhaHasheada = hashSenha('Id172725D@');
          const infoTenant = db.prepare(`
            INSERT INTO tenants (nome_loja, email, senha_hash, nome_responsavel, telefone, status, plano)
            VALUES (?, ?, ?, ?, ?, ?, ?)
          `).run('DS Store', 'offdsstore@gmail.com', senhaHasheada, 'Daisy', '73999999999', 'ativo', 'profissional');

          // Criar usuário admin para a DS Store
          const dsStoreId = infoTenant.lastInsertRowid;
          db.prepare(`
            INSERT INTO usuarios (nome, email, tenant_id, papel, senha_hash, ativo)
            VALUES (?, ?, ?, ?, ?, 1)
          `).run('Daisy', 'offdsstore@gmail.com', dsStoreId, 'admin', senhaHasheada);
        }
      }
    },
    {
      nome: '005_fix_ds_store_password',
      hash: 'v5-fix-password',
      exec: (db) => {
        // Se a DS Store existe mas tem senha errada, atualiza para a correta
        const dsStore = db.prepare('SELECT id, senha_hash FROM tenants WHERE nome_loja = ?').get('DS Store');
        if (dsStore && (!dsStore.senha_hash || dsStore.senha_hash === 'hashed-password')) {
          const senhaCorreta = hashSenha('Id172725D@');
          db.prepare('UPDATE tenants SET senha_hash = ? WHERE id = ?').run(senhaCorreta, dsStore.id);
          db.prepare('UPDATE usuarios SET senha_hash = ? WHERE tenant_id = ?').run(senhaCorreta, dsStore.id);
        }
      }
    },
    {
      nome: '006_create_vales_table',
      hash: 'v6-vales',
      exec: (db) => {
        db.exec(`
          CREATE TABLE IF NOT EXISTS vales (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            tenant_id INTEGER NOT NULL DEFAULT 1,
            codigo TEXT UNIQUE NOT NULL,           -- VALE-XXXXXX (gerado)
            valor REAL NOT NULL DEFAULT 0,         -- valor do crédito
            saldo REAL NOT NULL DEFAULT 0,         -- saldo disponível (valor - utilizado)
            utilizado REAL NOT NULL DEFAULT 0,     -- quanto já foi gasto
            troca_id INTEGER,                      -- vem de qual troca
            cliente_id INTEGER,                    -- cliente que recebeu o vale
            data_geracao TEXT NOT NULL DEFAULT (datetime('now','localtime')),
            validade TEXT,                         -- data de expiração (opcional, ex: 30 dias)
            ativo INTEGER NOT NULL DEFAULT 1,      -- 1 ativo, 0 cancelado
            notas TEXT,
            FOREIGN KEY (troca_id) REFERENCES trocas(id) ON DELETE SET NULL,
            FOREIGN KEY (cliente_id) REFERENCES clientes(id) ON DELETE SET NULL
          );
          CREATE INDEX IF NOT EXISTS idx_vales_codigo ON vales(codigo);
          CREATE INDEX IF NOT EXISTS idx_vales_cliente ON vales(cliente_id);
          CREATE INDEX IF NOT EXISTS idx_vales_ativo ON vales(ativo);
        `);
      }
    },
    {
      nome: '007_add_tenant_to_trocas',
      hash: 'v7-trocas-tenant',
      exec: (db) => {
        // Adicionar tenant_id à tabela trocas
        const colunas = db.prepare(`PRAGMA table_info(trocas)`).all().map(c => c.name);
        if (!colunas.includes('tenant_id')) {
          db.exec(`ALTER TABLE trocas ADD COLUMN tenant_id INTEGER NOT NULL DEFAULT 1;`);
        }
      }
    },
    {
      nome: '008_ensure_caixa_dia_unique_constraint',
      hash: 'v8-caixa-dia-unique',
      exec: (db) => {
        // Garantir UNIQUE constraint em caixa_dia (data, tenant_id)
        // SQLite não permite adicionar constraint via ALTER, então recria a tabela se necessário
        try {
          const constraint = db.prepare(`
            SELECT sql FROM sqlite_master
            WHERE type='table' AND name='caixa_dia' AND sql LIKE '%UNIQUE%tenant_id%data%'
          `).get();
          if (!constraint) {
            // Tabela existe mas sem constraint — precisa recriar
            db.exec(`
              CREATE TABLE caixa_dia_new (
                id              INTEGER PRIMARY KEY AUTOINCREMENT,
                tenant_id       INTEGER NOT NULL DEFAULT 1,
                data            TEXT NOT NULL,
                total_pix       REAL NOT NULL DEFAULT 0,
                total_debito    REAL NOT NULL DEFAULT 0,
                total_credito   REAL NOT NULL DEFAULT 0,
                total_dinheiro  REAL NOT NULL DEFAULT 0,
                total_vale      REAL NOT NULL DEFAULT 0,
                total_bruto     REAL NOT NULL DEFAULT 0,
                total_liquido   REAL NOT NULL DEFAULT 0,
                lucro_dia       REAL NOT NULL DEFAULT 0,
                num_vendas      INTEGER NOT NULL DEFAULT 0,
                conciliado      INTEGER NOT NULL DEFAULT 0,
                obs             TEXT,
                saldo_conta_inicial REAL,
                conta_conferida REAL,
                fundo_troco     REAL NOT NULL DEFAULT 0,
                sangrias        REAL NOT NULL DEFAULT 0,
                suprimentos     REAL NOT NULL DEFAULT 0,
                dinheiro_contado REAL,
                diferenca       REAL,
                aberto_em       TEXT,
                fechado_em      TEXT,
                aberto          INTEGER NOT NULL DEFAULT 0,
                fechado         INTEGER NOT NULL DEFAULT 0,
                UNIQUE(tenant_id, data)
              );
              INSERT INTO caixa_dia_new SELECT id, tenant_id, data, total_pix, total_debito, total_credito, total_dinheiro, 0, total_bruto, total_liquido, lucro_dia, num_vendas, conciliado, obs, saldo_conta_inicial, conta_conferida, fundo_troco, sangrias, suprimentos, dinheiro_contado, diferenca, aberto_em, fechado_em, aberto, fechado FROM caixa_dia;
              DROP TABLE caixa_dia;
              ALTER TABLE caixa_dia_new RENAME TO caixa_dia;
            `);
          }
        } catch (e) {
          // Se tabela não existir, schema.sql a criará com constraint certo
        }
      }
    },
    {
      nome: '009_add_total_vale_to_caixa_dia',
      hash: 'v9-caixa-dia-vale',
      exec: (db) => {
        // Adicionar coluna total_vale em caixa_dia (se não existir)
        const colunas = db.prepare(`PRAGMA table_info(caixa_dia)`).all().map(c => c.name);
        if (!colunas.includes('total_vale')) {
          db.exec(`ALTER TABLE caixa_dia ADD COLUMN total_vale REAL NOT NULL DEFAULT 0;`);
        }
      }
    },
    {
      nome: '010_add_troca_id_to_vendas',
      hash: 'v10-vendas-troca-id',
      exec: (db) => {
        // Adicionar coluna venda_troca_id em vendas (rastreia se venda já tem troca)
        const colunas = db.prepare(`PRAGMA table_info(vendas)`).all().map(c => c.name);
        if (!colunas.includes('venda_troca_id')) {
          db.exec(`ALTER TABLE vendas ADD COLUMN venda_troca_id INTEGER;`);
        }
      }
    },
    {
      nome: '011_add_deletado_to_vendas',
      hash: 'v11-vendas-deletado',
      exec: (db) => {
        // Adicionar coluna deletado em vendas (marca vendas canceladas)
        const colunas = db.prepare(`PRAGMA table_info(vendas)`).all().map(c => c.name);
        if (!colunas.includes('deletado')) {
          db.exec(`ALTER TABLE vendas ADD COLUMN deletado INTEGER NOT NULL DEFAULT 0;`);
        }
      }
    },
    {
      nome: '012_add_venda_utilizacao_to_vales',
      hash: 'v12-vales-rastreamento',
      exec: (db) => {
        // Adicionar coluna venda_utilizacao_id em vales (rastreia em qual venda foi usado)
        const colunas = db.prepare(`PRAGMA table_info(vales)`).all().map(c => c.name);
        if (!colunas.includes('venda_utilizacao_id')) {
          db.exec(`ALTER TABLE vales ADD COLUMN venda_utilizacao_id INTEGER;`);
        }
      }
    },
    {
      nome: '013_split_credito_in_caixa_dia',
      hash: 'v13-caixa-dia-credito-split',
      exec: (db) => {
        // Separar total_credito em total_credito_vista e total_credito_parcelado
        const colunas = db.prepare(`PRAGMA table_info(caixa_dia)`).all().map(c => c.name);
        if (!colunas.includes('total_credito_vista')) {
          db.exec(`ALTER TABLE caixa_dia ADD COLUMN total_credito_vista REAL NOT NULL DEFAULT 0;`);
        }
        if (!colunas.includes('total_credito_parcelado')) {
          db.exec(`ALTER TABLE caixa_dia ADD COLUMN total_credito_parcelado REAL NOT NULL DEFAULT 0;`);
        }
      }
    },
    {
      nome: '014_email_verification',
      hash: 'v14-email-verification',
      exec: (db) => {
        // Criar tabela de tokens de verificação de email
        db.exec(`
          CREATE TABLE IF NOT EXISTS email_verifications (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            usuario_id INTEGER NOT NULL,
            token TEXT UNIQUE NOT NULL,
            criado_em DATETIME DEFAULT CURRENT_TIMESTAMP,
            expira_em DATETIME NOT NULL,
            verificado INTEGER DEFAULT 0,
            verificado_em DATETIME,
            FOREIGN KEY (usuario_id) REFERENCES usuarios(id) ON DELETE CASCADE
          );
          CREATE INDEX IF NOT EXISTS idx_email_verifications_token ON email_verifications(token);
          CREATE INDEX IF NOT EXISTS idx_email_verifications_usuario ON email_verifications(usuario_id);
        `);

        // Adicionar coluna email_verificado em usuarios
        const colunas = db.prepare(`PRAGMA table_info(usuarios)`).all().map(c => c.name);
        if (!colunas.includes('email_verificado')) {
          db.exec(`ALTER TABLE usuarios ADD COLUMN email_verificado INTEGER DEFAULT 0;`);
          // Marcar usuários existentes como verificados (retrocompat)
          db.prepare('UPDATE usuarios SET email_verificado = 1 WHERE ativo = 1').run();
        }

        // Adicionar índice em usuarios(email_verificado)
        const indices = db.prepare(`
          SELECT name FROM sqlite_master
          WHERE type='index' AND name='idx_usuarios_email_verificado'
        `).get();
        if (!indices) {
          db.exec(`CREATE INDEX IF NOT EXISTS idx_usuarios_email_verificado ON usuarios(email_verificado);`);
        }
      }
    },
    {
      nome: '015_tenant_slug',
      hash: 'v15-tenant-slug',
      exec: (db) => {
        const { gerarSlugUnico } = require('../lib/helpers');

        // Adicionar coluna slug em tenants
        const colunas = db.prepare(`PRAGMA table_info(tenants)`).all().map(c => c.name);
        if (!colunas.includes('slug')) {
          db.exec(`ALTER TABLE tenants ADD COLUMN slug TEXT;`);
        }

        // Backfill: gerar slug único para cada tenant que não tem
        const tenantsSemSlug = db.prepare('SELECT id, nome_loja FROM tenants WHERE slug IS NULL OR slug = ?').all('');
        for (const tenant of tenantsSemSlug) {
          const slugUnico = gerarSlugUnico(db, tenant.nome_loja || `loja-${tenant.id}`, tenant.id);
          db.prepare('UPDATE tenants SET slug = ? WHERE id = ?').run(slugUnico, tenant.id);
        }

        // Criar índice único em slug (após backfill estar completo)
        const indiceExiste = db.prepare(`
          SELECT name FROM sqlite_master
          WHERE type='index' AND name='idx_tenants_slug'
        `).get();
        if (!indiceExiste) {
          db.exec(`CREATE UNIQUE INDEX IF NOT EXISTS idx_tenants_slug ON tenants(slug);`);
        }
      }
    },
    {
      nome: '016_add_cpf_cnpj_to_tenants',
      hash: 'v16-tenant-cpf-cnpj',
      exec: (db) => {
        // Adicionar coluna cpf_cnpj em tenants (se não existir)
        const colunas = db.prepare(`PRAGMA table_info(tenants)`).all().map(c => c.name);
        if (!colunas.includes('cpf_cnpj')) {
          db.exec(`ALTER TABLE tenants ADD COLUMN cpf_cnpj TEXT;`);
        }

        // Criar índice único em cpf_cnpj (após coluna estar garantida)
        const indiceExiste = db.prepare(`
          SELECT name FROM sqlite_master
          WHERE type='index' AND name='idx_tenants_cpf_cnpj'
        `).get();
        if (!indiceExiste) {
          db.exec(`CREATE UNIQUE INDEX IF NOT EXISTS idx_tenants_cpf_cnpj ON tenants(cpf_cnpj);`);
        }
      }
    },
    {
      nome: '017_create_admins_table',
      hash: 'v17-admins-table',
      exec: (db) => {
        db.exec(`
          CREATE TABLE IF NOT EXISTS admins (
            id                        INTEGER PRIMARY KEY AUTOINCREMENT,
            email                     TEXT NOT NULL UNIQUE,
            nome                      TEXT NOT NULL,
            senha_hash                TEXT NOT NULL,
            papel                     TEXT NOT NULL DEFAULT 'super_admin',
            totp_secret               TEXT,
            totp_backup_codes_hash    TEXT,
            totp_ativado              INTEGER NOT NULL DEFAULT 0,
            ativo                     INTEGER NOT NULL DEFAULT 1,
            criado_em                 TEXT NOT NULL DEFAULT (datetime('now','localtime')),
            ultimo_login_em           TEXT
          );
        `);
        db.exec(`CREATE INDEX IF NOT EXISTS idx_admins_email ON admins(email);`);
      }
    },
    {
      nome: '018_seed_admin_from_env',
      hash: 'v18-seed-admin',
      exec: (db) => {
        const temAdmin = db.prepare('SELECT 1 FROM admins WHERE 1=1').get();
        if (!temAdmin) {
          const adminSenha = process.env.ADMIN_SENHA_HASH || (process.env.ADMIN_SENHA ? hashSenha(process.env.ADMIN_SENHA) : hashSenha('dsstore'));
          const adminEmail = process.env.ADMIN_EMAIL || 'admin@easygestao.com';

          if (!process.env.ADMIN_EMAIL && !process.env.ADMIN_SENHA_HASH && !process.env.ADMIN_SENHA) {
            console.warn(`[MIGRATION] ⚠️ Nenhuma senha de admin configurada (.env). Usando fallback 'dsstore' — configure ADMIN_SENHA ou ADMIN_SENHA_HASH em produção!`);
          }

          if (!process.env.ADMIN_EMAIL) {
            console.warn(`[MIGRATION] ⚠️ ADMIN_EMAIL não configurado. Usando fallback 'admin@easygestao.com' — configure ADMIN_EMAIL em produção!`);
          }

          db.prepare(`
            INSERT INTO admins (email, nome, senha_hash, papel, ativo)
            VALUES (?, ?, ?, ?, ?)
          `).run(adminEmail, 'Admin', adminSenha, 'super_admin', 1);

          console.log(`✅ Admin seed: ${adminEmail}`);
        }
      }
    },
    {
      nome: '019_stripe_webhooks_idempotency',
      hash: 'v19-stripe-webhooks',
      exec: (db) => {
        db.exec(`
          CREATE TABLE IF NOT EXISTS stripe_webhooks (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            event_id TEXT UNIQUE NOT NULL,
            event_type TEXT NOT NULL,
            processed_at INTEGER NOT NULL,
            created_at INTEGER DEFAULT (cast(strftime('%s', 'now') as integer)),
            manual_review INTEGER DEFAULT 0
          );
        `);
        db.exec(`CREATE INDEX IF NOT EXISTS idx_stripe_event_id ON stripe_webhooks(event_id);`);
        db.exec(`CREATE INDEX IF NOT EXISTS idx_stripe_created_at ON stripe_webhooks(created_at DESC);`);
      }
    },
    {
      nome: '020_caixa_unique_abertura',
      hash: 'v20-caixa-unique',
      exec: (db) => {
        // Criar índice único para evitar múltiplas aberturas do mesmo dia
        const indiceExiste = db.prepare(`
          SELECT name FROM sqlite_master
          WHERE type='index' AND name='idx_caixa_tenant_data_aberto'
        `).get();
        if (!indiceExiste) {
          db.exec(`CREATE UNIQUE INDEX idx_caixa_tenant_data_aberto ON caixa_dia(tenant_id, data) WHERE aberto = 1;`);
        }
      }
    },
    {
      nome: '021_add_primeira_login_to_tenants',
      hash: 'v21-primeira-login',
      exec: (db) => {
        // Adicionar coluna primeira_login à tabela tenants
        const colunaExiste = db.prepare(`
          PRAGMA table_info(tenants)
        `).all().some(col => col.name === 'primeira_login');
        if (!colunaExiste) {
          db.exec(`ALTER TABLE tenants ADD COLUMN primeira_login INTEGER NOT NULL DEFAULT 1;`);
        }
      }
    },
    {
      nome: '022_add_onboarding_estado_to_tenants',
      hash: 'v22-onboarding-estado',
      exec: (db) => {
        // Adicionar coluna onboarding_estado à tabela tenants (JSON serializado)
        // Estrutura: {"etapa":"identidade"|"produto"|"concluido","concluido":boolean,"pulado":boolean,"banner_dispensado":boolean}
        const colunaExiste = db.prepare(`
          PRAGMA table_info(tenants)
        `).all().some(col => col.name === 'onboarding_estado');
        if (!colunaExiste) {
          db.exec(`ALTER TABLE tenants ADD COLUMN onboarding_estado TEXT NOT NULL DEFAULT '{"etapa":"identidade","concluido":false,"pulado":false,"banner_dispensado":false}';`);
        }
      }
    },
    {
      nome: '023_fix_alertas_clientes_unique_constraint',
      hash: 'v23-alertas-tenant-tipo-unique',
      exec: (db) => {
        // BUG: tenant_id era UNIQUE sozinho, mas lib/alertas.js gera um alerta por
        // (tenant_id, tipo) — um tenant pode estar 'atraso_pagamento' E 'inativo' ao
        // mesmo tempo. O INSERT do segundo tipo violava o UNIQUE e o scheduler
        // logava "UNIQUE constraint failed: alertas_clientes.tenant_id" toda vez
        // que rodava. Recria a tabela sem o UNIQUE solto na coluna e adiciona um
        // índice único parcial em (tenant_id, tipo) só para alertas ainda ativos
        // (resolvido_em IS NULL), que é a unicidade real que o código espera.
        try {
          const constraintAntigo = db.prepare(`
            SELECT sql FROM sqlite_master
            WHERE type='table' AND name='alertas_clientes' AND sql LIKE '%tenant_id INTEGER NOT NULL UNIQUE%'
          `).get();
          if (constraintAntigo) {
            db.exec(`
              CREATE TABLE alertas_clientes_new (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                tenant_id INTEGER NOT NULL,
                tipo TEXT NOT NULL,
                dias_sem_atividade INTEGER DEFAULT 0,
                valor_em_risco REAL DEFAULT 0,
                dias_atraso INTEGER DEFAULT 0,
                mensagem TEXT,
                criado_em TEXT NOT NULL DEFAULT (datetime('now','localtime')),
                resolvido_em TEXT,
                FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE
              );
              INSERT INTO alertas_clientes_new SELECT id, tenant_id, tipo, dias_sem_atividade, valor_em_risco, dias_atraso, mensagem, criado_em, resolvido_em FROM alertas_clientes;
              DROP TABLE alertas_clientes;
              ALTER TABLE alertas_clientes_new RENAME TO alertas_clientes;
              CREATE INDEX IF NOT EXISTS idx_alertas_tipo ON alertas_clientes(tipo);
              CREATE INDEX IF NOT EXISTS idx_alertas_ativo ON alertas_clientes(resolvido_em);
              CREATE INDEX IF NOT EXISTS idx_alertas_tenant ON alertas_clientes(tenant_id);
            `);
          }
          // Índice único parcial: só um alerta ATIVO por (tenant_id, tipo).
          // Idempotente — roda mesmo se a tabela já tiver sido recriada acima.
          db.exec(`
            CREATE UNIQUE INDEX IF NOT EXISTS idx_alertas_tenant_tipo_ativo
            ON alertas_clientes(tenant_id, tipo) WHERE resolvido_em IS NULL;
          `);
        } catch (e) {
          console.error('Migration 023 (alertas_clientes) falhou:', e.message);
          throw e;
        }
      }
    },
    {
      nome: '024_fix_caixa_dia_unique_por_tenant',
      hash: 'v24-caixa-dia-unique-tenant-data',
      exec: (db) => {
        // BUG CRÍTICO: caixa_dia tinha `data TEXT UNIQUE NOT NULL` — uma UNIQUE GLOBAL
        // na coluna data sozinha (legado pré-multitenancy). Efeito: quando QUALQUER
        // tenant abria caixa numa data, NENHUM outro tenant conseguia abrir no mesmo
        // dia (o INSERT OR IGNORE em routes/caixa.js era engolido pela UNIQUE(data), o
        // SELECT seguinte não achava a linha do próprio tenant e retornava undefined,
        // e caixa.fechado quebrava com TypeError → 500 "Erro ao abrir caixa").
        // Recria a tabela com a UNIQUE correta (tenant_id, data). Idempotente: só roda
        // se a UNIQUE global antiga em `data` ainda existir.
        try {
          const temUniqueAntigo = db.prepare(`
            SELECT sql FROM sqlite_master
            WHERE type='table' AND name='caixa_dia' AND sql LIKE '%data%TEXT UNIQUE%'
          `).get();
          if (temUniqueAntigo) {
            // Uma tentativa anterior de corrigir este bug deixou uma tabela órfã
            // 'caixa_dia_new' vazia em produção. Se ela existir, o CREATE abaixo
            // falharia ("already exists") e travaria o boot. Removemos primeiro.
            db.exec('DROP TABLE IF EXISTS caixa_dia_new;');
            db.exec(`
              CREATE TABLE caixa_dia_new (
                id              INTEGER PRIMARY KEY AUTOINCREMENT,
                data            TEXT NOT NULL,
                tenant_id       INTEGER NOT NULL DEFAULT 1,
                total_pix       REAL NOT NULL DEFAULT 0,
                total_debito    REAL NOT NULL DEFAULT 0,
                total_credito   REAL NOT NULL DEFAULT 0,
                total_dinheiro  REAL NOT NULL DEFAULT 0,
                total_vale      REAL NOT NULL DEFAULT 0,
                total_credito_vista     REAL NOT NULL DEFAULT 0,
                total_credito_parcelado REAL NOT NULL DEFAULT 0,
                total_bruto     REAL NOT NULL DEFAULT 0,
                total_liquido   REAL NOT NULL DEFAULT 0,
                lucro_dia       REAL NOT NULL DEFAULT 0,
                num_vendas      INTEGER NOT NULL DEFAULT 0,
                conciliado      INTEGER NOT NULL DEFAULT 0,
                obs             TEXT,
                fundo_troco     REAL NOT NULL DEFAULT 0,
                sangrias        REAL NOT NULL DEFAULT 0,
                suprimentos     REAL NOT NULL DEFAULT 0,
                dinheiro_contado REAL,
                diferenca       REAL,
                saldo_conta_inicial REAL,
                conta_conferida REAL,
                aberto_em       TEXT,
                fechado_em      TEXT,
                aberto          INTEGER NOT NULL DEFAULT 0,
                fechado         INTEGER NOT NULL DEFAULT 0,
                UNIQUE(tenant_id, data)
              );
              INSERT INTO caixa_dia_new (
                id, data, tenant_id, total_pix, total_debito, total_credito, total_dinheiro,
                total_vale, total_credito_vista, total_credito_parcelado, total_bruto, total_liquido,
                lucro_dia, num_vendas, conciliado, obs, fundo_troco, sangrias, suprimentos,
                dinheiro_contado, diferenca, saldo_conta_inicial, conta_conferida, aberto_em, fechado_em, aberto, fechado
              )
              SELECT
                id, data, COALESCE(tenant_id, 1), total_pix, total_debito, total_credito, total_dinheiro,
                total_vale, total_credito_vista, total_credito_parcelado, total_bruto, total_liquido,
                lucro_dia, num_vendas, conciliado, obs, fundo_troco, sangrias, suprimentos,
                dinheiro_contado, diferenca, saldo_conta_inicial, conta_conferida, aberto_em, fechado_em, aberto, fechado
              FROM caixa_dia;
              DROP TABLE caixa_dia;
              ALTER TABLE caixa_dia_new RENAME TO caixa_dia;
              CREATE INDEX IF NOT EXISTS idx_caixa_dia_tenant ON caixa_dia(tenant_id);
              CREATE UNIQUE INDEX IF NOT EXISTS idx_caixa_tenant_data_aberto ON caixa_dia(tenant_id, data) WHERE aberto = 1;
            `);
          }
        } catch (e) {
          console.error('Migration 024 (caixa_dia) falhou:', e.message);
          throw e;
        }
      }
    },
    {
      nome: '025_add_data_utilizacao_to_vales',
      hash: 'v25-vale-data-utilizacao',
      exec: (db) => {
        // A tabela vales guardava venda_utilizacao_id mas nenhuma data: o historico
        // nao tinha como mostrar QUANDO o vale foi usado. Preenchida na baixa
        // (routes/vendas.js), junto com venda_utilizacao_id.
        const colunaExiste = db.prepare(`
          PRAGMA table_info(vales)
        `).all().some(col => col.name === 'data_utilizacao');
        if (!colunaExiste) {
          db.exec(`ALTER TABLE vales ADD COLUMN data_utilizacao TEXT;`);
        }
      }
    },
    {
      nome: '026_add_tenant_id_to_produto_fotos',
      hash: 'v26-produto-fotos-tenant',
      exec: (db) => {
        // produto_fotos nao guardava a qual loja a foto pertence: as queries filtravam
        // so por produto_id. Nao havia vazamento (toda leitura passa antes pelo produto,
        // que e' filtrado por tenant), mas a tabela dependia de uma protecao que mora em
        // outro arquivo. Uma query nova que buscasse foto direto vazaria entre lojas.
        //
        // Sem DEFAULT: um default de tenant e' exatamente o que produz bug silencioso
        // (ver getConfig(chave, fallback, tenantId = 1)). A coluna nasce NULL e o
        // backfill preenche a partir do produto dono.
        const colunaExiste = db.prepare(`
          PRAGMA table_info(produto_fotos)
        `).all().some(col => col.name === 'tenant_id');
        if (!colunaExiste) {
          db.exec(`ALTER TABLE produto_fotos ADD COLUMN tenant_id INTEGER;`);
        }
        // backfill idempotente: so mexe em quem esta NULL
        db.exec(`
          UPDATE produto_fotos
          SET tenant_id = (SELECT p.tenant_id FROM produtos p WHERE p.id = produto_fotos.produto_id)
          WHERE tenant_id IS NULL;
        `);
        // orfas (produto ja apagado) nao tem dono possivel: nao ha o que preservar
        db.exec(`DELETE FROM produto_fotos WHERE tenant_id IS NULL;`);
        db.exec(`CREATE INDEX IF NOT EXISTS idx_produto_fotos_tenant ON produto_fotos(tenant_id, produto_id);`);
      }
    },
    {
      nome: '027_create_crediario',
      hash: 'v27-crediario-carne',
      exec: (db) => {
        // CREDIARIO (o carne): a loja financia, a cliente leva a peca hoje e paga
        // em N parcelas direto pra loja. NAO e' parcelamento de cartao — aqui o
        // risco de calote e' do lojista. Hoje isso vive num caderno de papel.
        //
        // Tres tabelas, nao duas. O obvio seria guardar so valor_pago na parcela,
        // mas pagamento PARCIAL e' o caso normal ("pago um pouco agora e o resto
        // depois") — e valor_pago = 50 nao diz ao caixa QUAL DIA entrou quanto, em
        // QUAL FORMA. Se a cliente paga R$30 hoje em dinheiro e R$20 semana que vem
        // no pix, sao dois dias de caixa diferentes. Dai crediario_recebimentos.
        // parcelas.valor_pago fica como cache derivado (a soma dos recebimentos).
        db.exec(`
          CREATE TABLE IF NOT EXISTS crediarios (
            id           INTEGER PRIMARY KEY AUTOINCREMENT,
            tenant_id    INTEGER NOT NULL,
            venda_id     INTEGER NOT NULL,
            cliente_id   INTEGER NOT NULL,          -- crediario sem cliente nao existe
            valor_total  REAL NOT NULL DEFAULT 0,   -- o que foi financiado (total - entrada)
            entrada      REAL NOT NULL DEFAULT 0,   -- pago na hora (pode ser 0)
            num_parcelas INTEGER NOT NULL DEFAULT 1,
            status       TEXT NOT NULL DEFAULT 'aberto',  -- aberto | quitado | cancelado
            criado_em    TEXT NOT NULL DEFAULT (datetime('now','localtime')),
            FOREIGN KEY (venda_id)   REFERENCES vendas(id)   ON DELETE RESTRICT,
            FOREIGN KEY (cliente_id) REFERENCES clientes(id) ON DELETE RESTRICT
          );
        `);

        // status guarda so o que foi DECIDIDO (aberta/parcial/paga). 'atrasada' e'
        // DERIVADO na leitura (vencimento < hoje AND status <> 'paga'): uma parcela
        // vira atrasada sozinha a meia-noite. Job noturno seria uma engrenagem a
        // mais pra falhar — e ficaria errada o dia seguinte inteiro se falhasse.
        db.exec(`
          CREATE TABLE IF NOT EXISTS crediario_parcelas (
            id             INTEGER PRIMARY KEY AUTOINCREMENT,
            tenant_id      INTEGER NOT NULL,
            crediario_id   INTEGER NOT NULL,
            numero         INTEGER NOT NULL,
            valor          REAL NOT NULL DEFAULT 0,
            vencimento     TEXT NOT NULL,                  -- YYYY-MM-DD
            valor_pago     REAL NOT NULL DEFAULT 0,        -- cache: SUM(crediario_recebimentos.valor)
            data_pagamento TEXT,                           -- do recebimento que quitou
            status         TEXT NOT NULL DEFAULT 'aberta', -- aberta | parcial | paga
            UNIQUE (crediario_id, numero),
            FOREIGN KEY (crediario_id) REFERENCES crediarios(id) ON DELETE CASCADE
          );
        `);

        db.exec(`
          CREATE TABLE IF NOT EXISTS crediario_recebimentos (
            id         INTEGER PRIMARY KEY AUTOINCREMENT,
            tenant_id  INTEGER NOT NULL,
            parcela_id INTEGER NOT NULL,
            data       TEXT NOT NULL,                     -- YYYY-MM-DD: a data do CAIXA
            valor      REAL NOT NULL DEFAULT 0,
            forma      TEXT NOT NULL DEFAULT 'dinheiro',  -- dinheiro | pix | pix_chave | debito | credito_vista
            criado_em  TEXT NOT NULL DEFAULT (datetime('now','localtime')),
            FOREIGN KEY (parcela_id) REFERENCES crediario_parcelas(id) ON DELETE CASCADE
          );
        `);

        // Sem DEFAULT em tenant_id nas tres: um default de tenant e' exatamente o
        // que produz vazamento silencioso entre lojas (a licao da migration 026).
        db.exec(`CREATE INDEX IF NOT EXISTS idx_crediarios_tenant  ON crediarios(tenant_id, status);`);
        db.exec(`CREATE INDEX IF NOT EXISTS idx_crediarios_cliente ON crediarios(tenant_id, cliente_id);`);
        db.exec(`CREATE INDEX IF NOT EXISTS idx_crediarios_venda   ON crediarios(venda_id);`);
        // o indice que a tela de Cobranca usa: ela varre por data de vencimento
        db.exec(`CREATE INDEX IF NOT EXISTS idx_parcelas_venc      ON crediario_parcelas(tenant_id, vencimento, status);`);
        db.exec(`CREATE INDEX IF NOT EXISTS idx_parcelas_crediario ON crediario_parcelas(crediario_id);`);
        // o indice que atualizarCaixaDia usa: ela varre os recebimentos DO DIA
        db.exec(`CREATE INDEX IF NOT EXISTS idx_receb_data         ON crediario_recebimentos(tenant_id, data);`);
        db.exec(`CREATE INDEX IF NOT EXISTS idx_receb_parcela      ON crediario_recebimentos(parcela_id);`);
      }
    },
    {
      nome: '028_clientes_email_cpf_em_banco_novo',
      hash: 'v28-clientes-email-cpf',
      exec: (db) => {
        // BUG DE BANCO NOVO: routes/clientes.js INSERE em email/email_verificado/cpf_cnpj,
        // mas essas colunas so existiam nos arquivos db/migrations/*.sql — o mecanismo
        // LEGADO, que ninguem executa mais. schema.sql tambem nao as cria. Resultado:
        // num banco criado do zero, POST /api/clientes SEMPRE dava 500
        // ("table clientes has no column named email"). Em producao passa despercebido
        // porque o banco e' antigo e pegou esses ALTERs quando o mecanismo .sql rodava.
        //
        // Idempotente: em producao as colunas ja existem e isto nao faz nada.
        const colunas = db.prepare('PRAGMA table_info(clientes)').all().map(c => c.name);
        if (!colunas.includes('email')) {
          db.exec(`ALTER TABLE clientes ADD COLUMN email TEXT;`);
        }
        if (!colunas.includes('email_verificado')) {
          db.exec(`ALTER TABLE clientes ADD COLUMN email_verificado INTEGER DEFAULT 0;`);
        }
        if (!colunas.includes('cpf_cnpj')) {
          db.exec(`ALTER TABLE clientes ADD COLUMN cpf_cnpj TEXT;`);
        }
        db.exec(`CREATE UNIQUE INDEX IF NOT EXISTS idx_clientes_email_unique ON clientes(tenant_id, email) WHERE email IS NOT NULL;`);
        db.exec(`CREATE INDEX IF NOT EXISTS idx_clientes_email    ON clientes(email);`);
        db.exec(`CREATE INDEX IF NOT EXISTS idx_clientes_cpf_cnpj ON clientes(tenant_id, cpf_cnpj);`);
      }
    },
    {
      nome: '029_grade_cor_tamanho',
      hash: 'v29-grade-cor-tamanho',
      exec: migration029
    },
    {
      nome: '030_clube_vale_origem',
      hash: 'v30-clube-vale-origem',
      exec: (db) => {
        // O vale so nascia de TROCA. Agora nasce tambem do clube de fidelidade
        // (cartao de selo cheio -> vale-credito). Sao dinheiros diferentes:
        //
        // - `origem` distingue os dois. O vale do clube e' um PREMIO que a loja da';
        //   o de troca e' dinheiro que ja era da cliente. So o do clube tem regra de
        //   compra minima e so ele bloqueia selo novo (ver gasto_sem_selo abaixo).
        // - `clube_ciclo` e' o numero do cartao (1o, 2o, 3o...). E' o high-water mark
        //   da idempotencia: MAX(clube_ciclo) nunca anda pra tras. Precisa ser assim
        //   porque DELETE /api/vendas devolve o total_gasto da cliente (vendas.js) —
        //   cancelar uma venda FAZ OS SELOS DIMINUIREM. Um controle ingenuo
        //   ("selos % total === 0") reemitiria o mesmo premio na proxima compra.
        const colVales = db.prepare('PRAGMA table_info(vales)').all().map(c => c.name);
        if (!colVales.includes('origem')) {
          // DEFAULT 'troca' ja faz o backfill: todo vale que existe hoje veio de troca.
          db.exec(`ALTER TABLE vales ADD COLUMN origem TEXT NOT NULL DEFAULT 'troca';`);
        }
        if (!colVales.includes('clube_ciclo')) {
          db.exec(`ALTER TABLE vales ADD COLUMN clube_ciclo INTEGER;`);
        }
        db.exec(`CREATE INDEX IF NOT EXISTS idx_vales_clube ON vales(tenant_id, cliente_id, clube_ciclo) WHERE origem = 'clube';`);

        // ANTI-FARMING. Sem esta coluna o clube financia a si mesmo: a cliente
        // ganha R$50 de vale, paga com ele, os R$50 entram no total_gasto, viram
        // 1 selo — e ela acumula premio em cima do premio. `gasto_sem_selo` guarda
        // quanto do total_gasto foi pago com vale DO CLUBE; o calculo de selos
        // subtrai isso. Nao dava pra so descontar do total_gasto: esse campo e' o
        // historico de faturamento que a RFM, os relatorios e a tela de clientes leem.
        const colCli = db.prepare('PRAGMA table_info(clientes)').all().map(c => c.name);
        if (!colCli.includes('gasto_sem_selo')) {
          db.exec(`ALTER TABLE clientes ADD COLUMN gasto_sem_selo REAL NOT NULL DEFAULT 0;`);
        }
      }
    },
    {
      nome: '031_crm_acoes',
      hash: 'v31-crm-acoes-materializadas',
      exec: (db) => {
        // A REGUA DE RELACIONAMENTO — as tarefas de contato do dia.
        //
        // No sistema antigo (DS Store) nao havia tabela: a tela recalculava a regua
        // a cada visita. O preco disso era caro e silencioso — os gatilhos de dia
        // EXATO (pos-venda no dia 3, avaliacao no dia 5, indicacao no dia 10) so
        // existiam no dia deles. Loja fechada na segunda? Todo mundo que comprou na
        // sexta perdeu o pos-venda, pra sempre.
        //
        // Materializar resolve isso e ainda paga tres coisas de graca: adiar (snooze),
        // historico do que foi enviado, e a contagem de pendentes pro badge do menu.
        //
        // A `mensagem` e' gravada JA INTERPOLADA de proposito: o texto que a lojista
        // leu ontem e' o que ela manda hoje. Se o template mudar no meio, a acao que
        // ja esta na fila nao pode mudar debaixo dela.
        db.exec(`
          CREATE TABLE IF NOT EXISTS crm_acoes (
            id           INTEGER PRIMARY KEY AUTOINCREMENT,
            tenant_id    INTEGER NOT NULL,        -- SEM DEFAULT: default de tenant e' o bug
            data         TEXT NOT NULL,           -- YYYY-MM-DD em que a acao nasceu
            cliente_id   INTEGER NOT NULL,
            tipo         TEXT NOT NULL,           -- DIA1 | REAT_2 | ANIVERSARIO | ...
            prioridade   INTEGER NOT NULL DEFAULT 5,
            label        TEXT,
            detalhe      TEXT,
            mensagem     TEXT NOT NULL,           -- ja interpolada (o que vai pro wa.me)
            segmento     TEXT,                    -- RFM congelado no dia da geracao
            cupom        TEXT,
            status       TEXT NOT NULL DEFAULT 'pendente',  -- pendente|enviada|adiada|ignorada
            adiada_para  TEXT,                    -- snooze: reabre a MESMA linha, nao cria outra
            resolvido_em TEXT,
            criado_em    TEXT NOT NULL DEFAULT (datetime('now','localtime')),
            UNIQUE (tenant_id, data, cliente_id, tipo),
            FOREIGN KEY (cliente_id) REFERENCES clientes(id) ON DELETE CASCADE
          );
        `);
        // O UNIQUE acima e' o que torna o scheduler idempotente: rodar 5x no mesmo dia
        // nao duplica, e o INSERT OR IGNORE nao ressuscita acao ja enviada/ignorada.
        db.exec(`CREATE INDEX IF NOT EXISTS idx_crm_acoes_pend    ON crm_acoes(tenant_id, status, data);`);
        db.exec(`CREATE INDEX IF NOT EXISTS idx_crm_acoes_cliente ON crm_acoes(tenant_id, cliente_id);`);
      }
    },
    {
      nome: '032_crm_templates',
      hash: 'v32-crm-templates',
      exec: (db) => {
        // As mensagens da regua nasceram chumbadas no codigo, no tom da DS Store
        // ("Clube DS Lover"). Num SaaS multi-loja isso nao serve: cada loja tem voz.
        //
        // Sem seed. Loja que nunca editou nao tem NENHUMA linha aqui e roda com os
        // defaults de lib/crm-templates.js. So grava quem personaliza. Se semeassemos
        // 17 linhas por tenant, uma melhoria futura no texto padrao nunca chegaria em
        // ninguem — ficaria enterrada sob copias velhas.
        //
        // `ativo = 0` e' como a lojista DESLIGA um gatilho ("nao quero pedir avaliacao
        // no Google") sem precisar de outra tabela pra isso.
        //
        // ATENCAO: cupom aqui e' TEXTO, nao motor. O sistema nao tem tabela de cupom
        // nem aplica desconto por codigo no PDV — na DS o "VOLTE20" era combinado
        // verbal com a cliente. Nao construir motor de cupom em cima disto sem decidir.
        db.exec(`
          CREATE TABLE IF NOT EXISTS crm_templates (
            id         INTEGER PRIMARY KEY AUTOINCREMENT,
            tenant_id  INTEGER NOT NULL,
            tipo       TEXT NOT NULL,       -- DIA1, CLUBE_BV, REAT_2...
            texto      TEXT NOT NULL,       -- com {nome} {loja} {clube} {valor_premio} {cupom}
            cupom      TEXT,
            cupom_pct  INTEGER,
            cupom_dias INTEGER,
            ativo      INTEGER NOT NULL DEFAULT 1,   -- 0 = esta acao nao e' gerada nesta loja
            criado_em  TEXT NOT NULL DEFAULT (datetime('now','localtime')),
            UNIQUE (tenant_id, tipo)
          );
        `);
        db.exec(`CREATE INDEX IF NOT EXISTS idx_crm_templates_tenant ON crm_templates(tenant_id);`);
      }
    },
    {
      nome: '033_seed_config_clube_por_tenant',
      hash: 'v33-seed-clube-todos-tenants',
      exec: (db) => {
        // As configs do clube (valor do selo, quantos selos, valor do premio) eram
        // semeadas com tenant_id = 1 chumbado. Toda loja diferente da primeira nao
        // tinha config nenhuma e caia no fallback do codigo — que e' justamente o
        // bug de getConfig(chave, fallback, tenantId = 1): a loja B lendo a config da A.
        //
        // INSERT OR IGNORE nao sobrescreve: quem ja configurou mantem o que tem.
        //
        // datas_comerciais nasce '[]' de proposito. As datas da DS ("Natal na DS
        // Store...") NAO podem vazar pra base de outra loja — a lojista cadastra as
        // dela. Um seed com texto da DS apareceria como mensagem pronta na tela de
        // uma loja que nunca ouviu falar da DS.
        //
        // A lista de defaults mora em lib/config-relacionamento.js porque o signup
        // (routes/auth.js) tambem precisa dela, pros tenants que nascerem DEPOIS
        // desta migration. Duas listas divergem; uma so, nao.
        const { semearConfigRelacionamento } = require('../lib/config-relacionamento');
        for (const t of db.prepare('SELECT id FROM tenants').all()) {
          semearConfigRelacionamento(db, t.id);
        }
      }
    },
    {
      nome: '034_produtos_codigo_unico_por_tenant',
      hash: 'v34-produtos-unique-tenant-codigo',
      exec: migration034
    },
    {
      nome: '035_usuarios_nome_unico_por_tenant',
      hash: 'v35-usuarios-unique-tenant-nome',
      exec: migration035
    },
    {
      nome: '036_vales_codigo_unico_por_tenant',
      hash: 'v36-vales-unique-tenant-codigo',
      exec: migration036
    },
    {
      nome: '037_crm_cupons',
      hash: 'v37-crm-cupons-nominais',
      exec: (db) => {
        // O CUPOM DA REGUA — o que transforma "mandei 40 mensagens" em
        // "6 clientes voltaram e trouxeram R$ 2.400".
        //
        // Ate aqui o VOLTE20 era so TEXTO na mensagem: nao existia tabela, nao
        // validava no PDV, nao descontava. Era combinado verbal com a cliente — e,
        // pior, era CEGO: nao dava pra saber se a regua funcionava.
        //
        // -- POR QUE NOMINAL (um codigo por cliente, nao um por campanha) --
        //
        // Codigo fixo (VOLTE20 pra todo mundo) tem dois furos: vaza (uma cliente
        // posta no grupo do WhatsApp e vira desconto geral) e nao atribui — nao da'
        // pra saber se a Maria voltou por causa DA mensagem dela ou porque ouviu
        // falar. Nominal (VOLTE20-K3P9, so da Maria, uso unico) fecha os dois.
        //
        // -- CUPOM NAO E' VALE --
        //
        // Cupom = DESCONTO (reduz o total da venda antes do pagamento; entra em
        // vendas.desconto e e' distribuido nos itens). Vale = DINHEIRO (forma de
        // pagamento, taxa 0, entra em caixa_dia.total_vale). Sao canos diferentes e
        // podem coexistir na mesma venda.
        db.exec(`
          CREATE TABLE IF NOT EXISTS crm_cupons (
            id             INTEGER PRIMARY KEY AUTOINCREMENT,
            tenant_id      INTEGER NOT NULL,      -- SEM DEFAULT: default de tenant e' o bug
            codigo         TEXT NOT NULL,         -- 'VOLTE20-K3P9' (sempre maiusculo)
            cliente_id     INTEGER NOT NULL,      -- NOMINAL: so ELA usa
            acao_id        INTEGER,               -- crm_acoes.id que gerou (a cadeia de atribuicao)
            tipo           TEXT NOT NULL,         -- REAT_2 | REAT_3 | ANIVERSARIO | PRE_ANIV | manual
            pct            REAL NOT NULL,         -- 20 = 20% de desconto
            min_compra     REAL NOT NULL DEFAULT 0,
            validade       TEXT NOT NULL,         -- YYYY-MM-DD (inclusivo)
            emitido_em     TEXT NOT NULL DEFAULT (datetime('now','localtime')),
            -- rascunho: nasceu com a acao mas a lojista ainda nao enviou -> NAO vale no PDV
            -- ativo:    foi enviado, a cliente pode usar
            -- usado:    consumido numa venda
            -- cancelado: a lojista ignorou o contato
            -- (NAO existe 'expirado': expirado e' ativo + validade < hoje. Estado
            --  derivado, nao gravado — assim nenhum job precisa rodar pra ele valer.)
            status         TEXT NOT NULL DEFAULT 'rascunho',
            venda_id       INTEGER,               -- venda que consumiu
            valor_desconto REAL,                  -- R$ concedido (congelado no uso)
            usado_em       TEXT,
            UNIQUE (tenant_id, codigo),           -- por TENANT: duas lojas podem ter o mesmo sufixo
            FOREIGN KEY (cliente_id) REFERENCES clientes(id) ON DELETE CASCADE
          );
        `);
        db.exec(`CREATE INDEX IF NOT EXISTS idx_crm_cupons_lookup  ON crm_cupons(tenant_id, codigo);`);
        db.exec(`CREATE INDEX IF NOT EXISTS idx_crm_cupons_cliente ON crm_cupons(tenant_id, cliente_id, status);`);
        db.exec(`CREATE INDEX IF NOT EXISTS idx_crm_cupons_tipo    ON crm_cupons(tenant_id, tipo, emitido_em);`);
        db.exec(`CREATE INDEX IF NOT EXISTS idx_crm_cupons_venda   ON crm_cupons(tenant_id, venda_id);`);
        db.exec(`CREATE INDEX IF NOT EXISTS idx_crm_cupons_acao    ON crm_cupons(tenant_id, acao_id);`);

        // crm_acoes.cupom (migration 031) ja existe e guardava o prefixo fixo
        // ('VOLTE20'). Passa a guardar o codigo NOMINAL ('VOLTE20-K3P9'). O cupom_id
        // e' o ponteiro forte — a coluna de texto fica pra tela exibir sem JOIN.
        const cols = db.prepare('PRAGMA table_info(crm_acoes)').all().map((c) => c.name);
        if (!cols.includes('cupom_id')) {
          db.exec(`ALTER TABLE crm_acoes ADD COLUMN cupom_id INTEGER;`);
        }
        // Indice sobre a coluna nova mora AQUI, na mesma migration do ALTER: no
        // schema.sql ele rodaria ANTES da coluna existir e derrubaria o boot.
        db.exec(`CREATE INDEX IF NOT EXISTS idx_crm_acoes_cupom ON crm_acoes(tenant_id, cupom_id);`);
      }
    },
    {
      nome: '038_maquininha_integrada',
      hash: 'v38-maquininha-mercadopago-point',
      exec: (db) => {
        // A MAQUININHA DEIXA DE SER UMA CAIXA PRETA AO LADO DO COMPUTADOR.
        //
        // Ate aqui a taxa de cartao era um PALPITE: a lojista digitava
        // `taxa_credito_vista: 3.15` na config e o sistema calculava lucro, margem e
        // DRE em cima disso — sem NUNCA confrontar com o que a adquirente cobrou de
        // verdade. Nao tinha com o que confrontar: venda_pagamentos nao guardava nem
        // NSU, nem bandeira, nem taxa real. Se a taxa real fosse 3,49% e ela digitou
        // 3,15%, todo o resultado da loja estava errado — em silencio, pra sempre.
        //
        // Bench test com cobranca REAL na Point da DS (14/07) provou que da' pra saber:
        // a API devolve fee_details (a taxa) e net_received_amount (o liquido).
        //
        // -- O ESTIMADO CONTINUA, AO LADO DO REAL --
        //
        // taxa_pct/valor_taxa/valor_liquido (o estimado) NAO saem. Venda digitada
        // continua funcionando identica — as colunas novas sao NULL nela. A COMPARACAO
        // entre os dois e' que e' a feature: "voce acha que paga 3,15%, voce paga 3,49%".
        const cols = db.prepare('PRAGMA table_info(venda_pagamentos)').all().map((c) => c.name);
        const add = (nome, tipo) => {
          if (!cols.includes(nome)) {
            db.exec(`ALTER TABLE venda_pagamentos ADD COLUMN ${nome} ${tipo};`);
            cols.push(nome);   // mantem o cache coerente pra quem consultar depois
          }
        };

        // ⚠️ tenant_id PRIMEIRO — o indice la embaixo depende dele.
        //
        // venda_pagamentos NAO tem tenant_id no schema.sql: quem a adiciona e' o
        // garantirColuna() do db/database.js, que roda DEPOIS das migrations. Num banco
        // NOVO a ordem era: schema cria a tabela sem a coluna -> esta migration tenta
        // indexar tenant_id -> "no such column: tenant_id" -> BOOT MORRE. Em producao
        // passava batido so porque o banco de la ja tinha a coluna de um boot anterior;
        // qualquer banco novo (ou um restore de backup) nao subia.
        //
        // E' a armadilha de sempre: schema.sql roda ANTES das migrations. Se a migration
        // depende de uma coluna, ela mesma tem que garanti-la.
        add('tenant_id', 'INTEGER');

        add('adquirente', 'TEXT');          // 'mercadopago' (prepara p/ outros)
        add('nsu', 'TEXT');                 // reference_id do MP (o id numerico classico)
        add('autorizacao', 'TEXT');         // authorization_code — o que resolve disputa no balcao
        add('bandeira', 'TEXT');            // 'master', 'visa', 'elo'...
        add('cartao_final', 'TEXT');        // ultimos 4 digitos
        add('mp_order_id', 'TEXT');         // ORD01K... (rastreio)
        add('mp_payment_id', 'TEXT');       // PAY01K... (rastreio)
        add('status_transacao', 'TEXT');    // aprovado | recusado | cancelado
        // O PAR QUE VALE OURO: o real ao lado do estimado.
        add('taxa_real_pct', 'REAL');       // % efetivo cobrado (derivado do liquido)
        add('valor_taxa_real', 'REAL');     // fee_details[].amount somado
        // net_received_amount: o que DE FATO cai na conta. Gravamos ELE, nunca
        // (valor - taxa): no bench test R$1,00 - R$0,02 dava 0,98, mas o liquido
        // real era 0,96. So o MP sabe compor a conta dele.
        add('valor_liquido_real', 'REAL');

        // Busca por NSU (conferir com o extrato da adquirente) e por order (webhook).
        db.exec(`CREATE INDEX IF NOT EXISTS idx_vpag_nsu   ON venda_pagamentos(tenant_id, nsu);`);
        db.exec(`CREATE INDEX IF NOT EXISTS idx_vpag_order ON venda_pagamentos(mp_order_id);`);

        // ------------------------------------------------------------
        // CREDENCIAL DA ADQUIRENTE — por tenant, cifrada.
        //
        // NAO vai na tabela `config` de proposito: la o token da Focus esta em
        // PLAINTEXT (routes/config.js:271, com TODO admitindo). Um token que move o
        // dinheiro da loja nao repete esse erro.
        //
        // Hoje o token e' COLADO (plano interno, so a DS usa). Quando a feature virar
        // produto, a lojista nao pode manusear um Access Token — entra OAuth, e os
        // campos refresh_token/expires_at (ja aqui, vazios) passam a ser usados. O que
        // muda e' COMO o token entra; nao onde ele mora. Por isso a tabela ja nasce
        // com o formato final.
        // ------------------------------------------------------------
        db.exec(`
          CREATE TABLE IF NOT EXISTS integracoes_pagamento (
            id            INTEGER PRIMARY KEY AUTOINCREMENT,
            tenant_id     INTEGER NOT NULL,          -- SEM DEFAULT: default de tenant e' o bug
            adquirente    TEXT NOT NULL,             -- 'mercadopago'
            access_token  TEXT NOT NULL,             -- CIFRADO (AES-256-CBC, CERT_CIPHER_KEY)
            refresh_token TEXT,                      -- OAuth (vazio enquanto for token colado)
            expires_at    TEXT,                      -- OAuth: token do MP dura 180 dias
            mp_user_id    TEXT,                      -- id do lojista no MP
            terminal_id   TEXT,                      -- 'PAX_A910__SMARTPOS...'
            terminal_nome TEXT,                      -- rotulo amigavel p/ a tela
            ativo         INTEGER NOT NULL DEFAULT 1,
            criado_em     TEXT NOT NULL DEFAULT (datetime('now','localtime')),
            atualizado_em TEXT,
            -- uma credencial por adquirente por loja (reconectar faz UPSERT, nao duplica)
            UNIQUE(tenant_id, adquirente),
            FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE
          );
        `);
      }
    },
    {
      nome: '039_clientes_instagram_observacoes',
      hash: 'v39-clientes-instagram-observacoes',
      exec: (db) => {
        // A ficha da cliente ganha dois campos que a lojista pedia: o @ do Instagram
        // (o canal real por onde ela fala com a cliente no varejo de moda) e um espaco
        // livre de OBSERVACOES (tamanho que veste, prefere entrega, deve fiado, etc).
        // ALTER idempotente no molde das outras — checa antes pra nao quebrar rerun.
        const cols = db.prepare('PRAGMA table_info(clientes)').all().map((c) => c.name);
        if (!cols.includes('instagram'))   db.exec(`ALTER TABLE clientes ADD COLUMN instagram TEXT;`);
        if (!cols.includes('observacoes')) db.exec(`ALTER TABLE clientes ADD COLUMN observacoes TEXT;`);
      }
    }
  ];

  // 3. Executar migrations que ainda não rodaram
  for (const mig of migrations) {
    const jáFez = db.prepare('SELECT 1 FROM migrations WHERE nome = ?').get(mig.nome);
    if (!jáFez) {
      try {
        mig.exec(db);
        db.prepare('INSERT INTO migrations (nome, hash) VALUES (?, ?)').run(mig.nome, mig.hash);
        console.log(`✅ Migration: ${mig.nome}`);
      } catch (err) {
        console.error(`❌ Migration ${mig.nome} falhou:`, err.message);
        throw err; // Interrompe boot se migration falhar
      }
    }
  }

  // 4. Validar integridade (tabelas críticas)
  const tabelasCriticas = ['tenants', 'usuarios', 'produtos', 'vendas', 'migrations'];
  for (const tabela of tabelasCriticas) {
    const existe = db.prepare(
      `SELECT name FROM sqlite_master WHERE type='table' AND name=?`
    ).get(tabela);
    if (!existe) {
      throw new Error(`❌ INTEGRIDADE: Tabela crítica ${tabela} desapareceu!`);
    }
  }

  console.log('✅ Todas as migrations executadas com sucesso');
}

// 029, 034, 035 e 036 sao exportadas pros testes conseguirem roda-las contra um banco
// povoado. Sao as que RECRIAM uma tabela (unico jeito de trocar UNIQUE inline), e todas
// tem CASCADE ou SET NULL apontando pra elas — rebuild assim nao da erro quando da
// errado, apaga em silencio. Precisa de prova, nao de confianca.
module.exports = { executarMigrations, migration029, migration034, migration035, migration036 };
