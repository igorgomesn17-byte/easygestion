-- Migration: Adicionar CPF/CNPJ em clientes
-- Data: 2026-06-25

ALTER TABLE clientes ADD COLUMN cpf_cnpj TEXT;
CREATE INDEX IF NOT EXISTS idx_clientes_cpf_cnpj ON clientes(tenant_id, cpf_cnpj);
