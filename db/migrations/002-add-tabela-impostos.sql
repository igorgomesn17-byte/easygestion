-- Migration: Criar tabela de impostos por estado e categoria
-- Data: 2026-06-25

CREATE TABLE IF NOT EXISTS impostos (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  tenant_id INTEGER NOT NULL,
  estado TEXT NOT NULL,                -- UF (BA, SP, MG, etc) ou 'default' para padrão
  categoria TEXT NOT NULL,             -- categoria do produto (ou 'default')
  icms_pct REAL NOT NULL DEFAULT 0,    -- ICMS %
  ipi_pct REAL NOT NULL DEFAULT 0,     -- IPI %
  pis_pct REAL NOT NULL DEFAULT 0,     -- PIS %
  cofins_pct REAL NOT NULL DEFAULT 0,  -- COFINS %
  criado_em TEXT NOT NULL DEFAULT (datetime('now','localtime')),
  atualizado_em TEXT,

  UNIQUE(tenant_id, estado, categoria)
);

CREATE INDEX IF NOT EXISTS idx_impostos ON impostos(tenant_id, estado, categoria);
