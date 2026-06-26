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
          `).run(1, 'EasyGestão Admin', 'admin@easygestion.com', 'admin', 'Admin', '00000000000', 'ativo', 'admin');
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
              INSERT INTO caixa_dia_new SELECT * FROM caixa_dia;
              DROP TABLE caixa_dia;
              ALTER TABLE caixa_dia_new RENAME TO caixa_dia;
            `);
          }
        } catch (e) {
          // Se tabela não existir, schema.sql a criará com constraint certo
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

module.exports = { executarMigrations };
