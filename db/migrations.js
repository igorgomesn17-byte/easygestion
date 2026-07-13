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

// migration029 e' exportada pro teste conseguir roda-la contra um banco povoado.
// E' a unica migration que mexe na identidade de uma tabela com 5 FKs apontando
// pra ela — precisa de prova, nao de confianca.
module.exports = { executarMigrations, migration029 };
