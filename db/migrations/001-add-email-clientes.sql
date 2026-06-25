-- Migration: Adicionar email em clientes (LGPD + password reset)
-- Data: 2026-06-25

ALTER TABLE clientes ADD COLUMN email TEXT;
ALTER TABLE clientes ADD COLUMN email_verificado INTEGER DEFAULT 0;
CREATE UNIQUE INDEX IF NOT EXISTS idx_clientes_email_unique ON clientes(tenant_id, email) WHERE email IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_clientes_email ON clientes(email);
