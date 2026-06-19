const sqlite3 = require('sqlite3');
const path = require('path');

const dbPath = path.join(__dirname, '..', 'dados.db');
const db = new sqlite3.Database(dbPath);

console.log('Criando banco de dados...');

const sql = `
-- Tabelas do SaaS
CREATE TABLE IF NOT EXISTS tenants (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  nome TEXT NOT NULL,
  email TEXT UNIQUE NOT NULL,
  status TEXT DEFAULT 'ativo' CHECK(status IN ('ativo', 'bloqueado')),
  data_criacao DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS assinaturas (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  tenant_id INTEGER NOT NULL,
  plano TEXT DEFAULT 'basico',
  status TEXT DEFAULT 'ativa',
  data_inicio DATE DEFAULT CURRENT_DATE,
  data_fim DATE,
  FOREIGN KEY(tenant_id) REFERENCES tenants(id)
);

CREATE TABLE IF NOT EXISTS cobracas (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  assinatura_id INTEGER NOT NULL,
  valor REAL DEFAULT 0,
  status TEXT DEFAULT 'pendente' CHECK(status IN ('pendente', 'pago', 'vencido')),
  data_vencimento DATE,
  data_pagamento DATE,
  data_criacao DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY(assinatura_id) REFERENCES assinaturas(id)
);

CREATE TABLE IF NOT EXISTS usuarios (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  tenant_id INTEGER DEFAULT 1,
  nome TEXT,
  email TEXT,
  papel TEXT,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY(tenant_id) REFERENCES tenants(id)
);

CREATE TABLE IF NOT EXISTS vendas (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  tenant_id INTEGER DEFAULT 1,
  data_criacao DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY(tenant_id) REFERENCES tenants(id)
);
`;

// Executar DDL
db.exec(sql, (err) => {
  if (err) {
    console.error('Erro ao criar tabelas:', err);
    db.close();
    process.exit(1);
  }

  // Inserir dados de teste
  db.run('INSERT OR IGNORE INTO tenants (id, nome, email, status) VALUES (1, ?, ?, ?)',
    ['Loja Teste', 'teste@email.com', 'ativo'],
    (err) => {
      if (err) console.error('Erro ao inserir tenant:', err);

      db.run('INSERT OR IGNORE INTO assinaturas (tenant_id, plano, status) VALUES (1, ?, ?)',
        ['basico', 'ativa'],
        (err) => {
          if (err) console.error('Erro ao inserir assinatura:', err);

          db.run('INSERT INTO cobracas (assinatura_id, valor, status, data_vencimento) VALUES (1, ?, ?, date("now"))',
            [49.90, 'pago'],
            (err) => {
              if (err) console.error('Erro ao inserir cobrança:', err);

              console.log('✅ Banco criado com sucesso em', dbPath);
              db.close();
              process.exit(0);
            }
          );
        }
      );
    }
  );
});
