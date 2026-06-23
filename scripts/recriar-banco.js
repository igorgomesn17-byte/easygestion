const sqlite3 = require('sqlite3');
const path = require('path');
const fs = require('fs');

const dbPath = path.join(__dirname, '..', 'dados.db');

// Deletar banco antigo
if (fs.existsSync(dbPath)) {
  fs.unlinkSync(dbPath);
  console.log('❌ Banco antigo deletado');
}

const db = new sqlite3.Database(dbPath);

console.log('✅ Criando novo banco...');

const sql = `
-- Tabela de tenants (clientes do SaaS)
CREATE TABLE tenants (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  nome_loja TEXT NOT NULL,
  email TEXT UNIQUE NOT NULL,
  senha_hash TEXT,
  nome_responsavel TEXT,
  telefone TEXT,
  plano TEXT DEFAULT 'basico',
  status TEXT DEFAULT 'ativo' CHECK(status IN ('ativo', 'bloqueado')),
  data_criacao DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Tabela de usuários (colaboradores de cada tenant)
CREATE TABLE usuarios (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  tenant_id INTEGER NOT NULL,
  nome TEXT NOT NULL,
  email TEXT NOT NULL,
  papel TEXT DEFAULT 'vendedor' CHECK(papel IN ('admin', 'vendedor', 'gestor')),
  senha_hash TEXT,
  ativo INTEGER DEFAULT 1,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY(tenant_id) REFERENCES tenants(id),
  UNIQUE(tenant_id, email)
);

-- Tabela de assinaturas
CREATE TABLE assinaturas (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  tenant_id INTEGER NOT NULL,
  plano TEXT DEFAULT 'basico',
  status TEXT DEFAULT 'ativa',
  data_inicio DATE DEFAULT CURRENT_DATE,
  data_fim DATE,
  FOREIGN KEY(tenant_id) REFERENCES tenants(id)
);

-- Tabela de cobranças
CREATE TABLE cobracas (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  assinatura_id INTEGER NOT NULL,
  valor REAL DEFAULT 0,
  status TEXT DEFAULT 'pendente' CHECK(status IN ('pendente', 'pago', 'vencido')),
  data_vencimento DATE,
  data_pagamento DATE,
  data_criacao DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY(assinatura_id) REFERENCES assinaturas(id)
);

-- Tabela de vendas (operacional)
CREATE TABLE vendas (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  tenant_id INTEGER DEFAULT 1,
  data_criacao DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY(tenant_id) REFERENCES tenants(id)
);

-- Tabela de produtos
CREATE TABLE produtos (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  tenant_id INTEGER DEFAULT 1,
  nome TEXT,
  preco REAL DEFAULT 0,
  FOREIGN KEY(tenant_id) REFERENCES tenants(id)
);

-- Tabela de clientes
CREATE TABLE clientes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  tenant_id INTEGER DEFAULT 1,
  nome TEXT,
  email TEXT,
  FOREIGN KEY(tenant_id) REFERENCES tenants(id)
);

-- Índices de performance
CREATE INDEX idx_usuarios_tenant ON usuarios(tenant_id);
CREATE INDEX idx_usuarios_email ON usuarios(email);
CREATE INDEX idx_vendas_tenant ON vendas(tenant_id);
CREATE INDEX idx_produtos_tenant ON produtos(tenant_id);
CREATE INDEX idx_clientes_tenant ON clientes(tenant_id);
`;

db.exec(sql, (err) => {
  if (err) {
    console.error('❌ Erro ao criar tabelas:', err);
    db.close();
    process.exit(1);
  }

  console.log('✅ Tabelas criadas com sucesso!');
  db.close();
  process.exit(0);
});
