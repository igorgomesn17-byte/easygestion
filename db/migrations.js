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
