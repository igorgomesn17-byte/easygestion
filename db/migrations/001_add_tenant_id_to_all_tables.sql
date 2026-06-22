-- ============================================================
-- MIGRAÇÃO CRÍTICA: Adiciona tenant_id a todas as tabelas de dados
-- ============================================================
--
-- Problema: Sem tenant_id no schema, não há isolamento multi-tenant no banco.
-- Qualquer query que filtra por req.tenantId é inútil se a coluna não existe.
--
-- Solução:
--   1. Adiciona tenant_id INTEGER NOT NULL DEFAULT 1 em todas as tabelas
--   2. Popula com tenant 1 (cliente atual/padrão)
--   3. Cria índices compound (tenant_id, id) para performance
--   4. Redefine UNIQUEs para incluir tenant_id (cada tenant pode ter seu próprio código)
--
-- Execution: sqlite3 db/dsstore.db < migrations/001_add_tenant_id_to_all_tables.sql
-- ============================================================

PRAGMA foreign_keys = ON;

-- ============================================================
-- 1. PRODUTOS - adiciona tenant_id
-- ============================================================
ALTER TABLE produtos ADD COLUMN tenant_id INTEGER NOT NULL DEFAULT 1;

-- Index compound para queries rápidas por tenant
CREATE INDEX IF NOT EXISTS idx_produtos_tenant_id ON produtos(tenant_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_produtos_tenant_codigo ON produtos(tenant_id, codigo);

-- ============================================================
-- 2. VARIACOES - referencia a produto (herda isolamento via FK)
-- ============================================================
-- O isolamento aqui vem da FK com produtos.tenant_id
-- Mas adicionamos também para queries diretas:
ALTER TABLE variacoes ADD COLUMN tenant_id INTEGER NOT NULL DEFAULT 1;
CREATE INDEX IF NOT EXISTS idx_variacoes_tenant_id ON variacoes(tenant_id);

-- ============================================================
-- 3. PRODUTO_FOTOS - mesmo padrão
-- ============================================================
ALTER TABLE produto_fotos ADD COLUMN tenant_id INTEGER NOT NULL DEFAULT 1;
CREATE INDEX IF NOT EXISTS idx_produto_fotos_tenant ON produto_fotos(tenant_id, produto_id);

-- ============================================================
-- 4. CLIENTES - isolamento crítico
-- ============================================================
ALTER TABLE clientes ADD COLUMN tenant_id INTEGER NOT NULL DEFAULT 1;
ALTER TABLE clientes ADD COLUMN indicada_por INTEGER;  -- para suportar referral (faltava)
ALTER TABLE clientes ADD COLUMN arquivado INTEGER NOT NULL DEFAULT 0;
ALTER TABLE clientes ADD COLUMN nao_perturbe INTEGER NOT NULL DEFAULT 0;

CREATE INDEX IF NOT EXISTS idx_clientes_tenant_id ON clientes(tenant_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_clientes_tenant_telefone ON clientes(tenant_id, telefone) WHERE telefone IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_clientes_indicada_por ON clientes(tenant_id, indicada_por);

-- ============================================================
-- 5. VENDEDORES - isolamento
-- ============================================================
ALTER TABLE vendedores ADD COLUMN tenant_id INTEGER NOT NULL DEFAULT 1;

CREATE INDEX IF NOT EXISTS idx_vendedores_tenant_id ON vendedores(tenant_id);

-- ============================================================
-- 6. VENDAS - isolamento CRÍTICO
-- ============================================================
ALTER TABLE vendas ADD COLUMN tenant_id INTEGER NOT NULL DEFAULT 1;

CREATE INDEX IF NOT EXISTS idx_vendas_tenant_id ON vendas(tenant_id);
CREATE INDEX IF NOT EXISTS idx_vendas_tenant_data ON vendas(tenant_id, data_hora);
CREATE INDEX IF NOT EXISTS idx_vendas_tenant_cliente ON vendas(tenant_id, cliente_id);

-- ============================================================
-- 7. VENDA_ITENS - referencia vendas
-- ============================================================
ALTER TABLE venda_itens ADD COLUMN tenant_id INTEGER NOT NULL DEFAULT 1;

CREATE INDEX IF NOT EXISTS idx_venda_itens_tenant ON venda_itens(tenant_id, venda_id);

-- ============================================================
-- 8. VENDA_PAGAMENTOS - referencia vendas
-- ============================================================
ALTER TABLE venda_pagamentos ADD COLUMN tenant_id INTEGER NOT NULL DEFAULT 1;

CREATE INDEX IF NOT EXISTS idx_venda_pagamentos_tenant ON venda_pagamentos(tenant_id, venda_id);

-- ============================================================
-- 9. PERMUTAS - isolamento
-- ============================================================
ALTER TABLE permutas ADD COLUMN tenant_id INTEGER NOT NULL DEFAULT 1;

CREATE INDEX IF NOT EXISTS idx_permutas_tenant_id ON permutas(tenant_id);

-- ============================================================
-- 10. PERMUTA_ITENS - referencia permutas
-- ============================================================
ALTER TABLE permuta_itens ADD COLUMN tenant_id INTEGER NOT NULL DEFAULT 1;

CREATE INDEX IF NOT EXISTS idx_permuta_itens_tenant ON permuta_itens(tenant_id, permuta_id);

-- ============================================================
-- 11. ENCOMENDAS - isolamento crítico
-- ============================================================
ALTER TABLE encomendas ADD COLUMN tenant_id INTEGER NOT NULL DEFAULT 1;

CREATE INDEX IF NOT EXISTS idx_encomendas_tenant_id ON encomendas(tenant_id);
CREATE INDEX IF NOT EXISTS idx_encomendas_tenant_status ON encomendas(tenant_id, status);

-- ============================================================
-- 12. NFCE - referencia vendas
-- ============================================================
ALTER TABLE nfce ADD COLUMN tenant_id INTEGER NOT NULL DEFAULT 1;

CREATE INDEX IF NOT EXISTS idx_nfce_tenant_id ON nfce(tenant_id);
CREATE INDEX IF NOT EXISTS idx_nfce_tenant_status ON nfce(tenant_id, status);

-- ============================================================
-- 13. MOVIMENTOS_ESTOQUE - isolamento (via FK com variacoes)
-- ============================================================
ALTER TABLE movimentos_estoque ADD COLUMN tenant_id INTEGER NOT NULL DEFAULT 1;

CREATE INDEX IF NOT EXISTS idx_movimentos_estoque_tenant ON movimentos_estoque(tenant_id);

-- ============================================================
-- 14. CAIXA_DIA - isolamento crítico
-- ============================================================
ALTER TABLE caixa_dia ADD COLUMN tenant_id INTEGER NOT NULL DEFAULT 1;

-- Remover constraint UNIQUE antiga e criar nova com tenant
DROP INDEX IF EXISTS caixa_dia_data;
CREATE UNIQUE INDEX IF NOT EXISTS idx_caixa_dia_tenant_data ON caixa_dia(tenant_id, data);

CREATE INDEX IF NOT EXISTS idx_caixa_dia_tenant_id ON caixa_dia(tenant_id);

-- ============================================================
-- 15. CAIXA_MOVIMENTOS - referencia caixa_dia
-- ============================================================
ALTER TABLE caixa_movimentos ADD COLUMN tenant_id INTEGER NOT NULL DEFAULT 1;

CREATE INDEX IF NOT EXISTS idx_caixa_movimentos_tenant ON caixa_movimentos(tenant_id, data);

-- ============================================================
-- 16. TROCAS - referencia vendas
-- ============================================================
ALTER TABLE trocas ADD COLUMN tenant_id INTEGER NOT NULL DEFAULT 1;

CREATE INDEX IF NOT EXISTS idx_trocas_tenant_id ON trocas(tenant_id);

-- ============================================================
-- 17. TROCA_ITENS - referencia trocas
-- ============================================================
ALTER TABLE troca_itens ADD COLUMN tenant_id INTEGER NOT NULL DEFAULT 1;

CREATE INDEX IF NOT EXISTS idx_troca_itens_tenant ON troca_itens(tenant_id, troca_id);

-- ============================================================
-- 18. CRM_ACOES_ENVIADAS - isolamento de CRM por tenant
-- ============================================================
ALTER TABLE crm_acoes_enviadas ADD COLUMN tenant_id INTEGER NOT NULL DEFAULT 1;

CREATE INDEX IF NOT EXISTS idx_crm_acoes_tenant ON crm_acoes_enviadas(tenant_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_crm_acoes_tenant_key ON crm_acoes_enviadas(tenant_id, data, cliente_id, tipo);

-- ============================================================
-- 19. DESPESAS - isolamento financeiro
-- ============================================================
ALTER TABLE despesas ADD COLUMN tenant_id INTEGER NOT NULL DEFAULT 1;

CREATE INDEX IF NOT EXISTS idx_despesas_tenant_id ON despesas(tenant_id);
CREATE INDEX IF NOT EXISTS idx_despesas_tenant_competencia ON despesas(tenant_id, data_competencia);

-- ============================================================
-- 20. CONVERSAS - isolamento de conversas/CRM
-- ============================================================
ALTER TABLE conversas ADD COLUMN tenant_id INTEGER NOT NULL DEFAULT 1;

CREATE INDEX IF NOT EXISTS idx_conversas_tenant_id ON conversas(tenant_id);
CREATE INDEX IF NOT EXISTS idx_conversas_tenant_cliente ON conversas(tenant_id, cliente_id);

-- ============================================================
-- 21. MENSAGENS - referencia conversas
-- ============================================================
ALTER TABLE mensagens ADD COLUMN tenant_id INTEGER NOT NULL DEFAULT 1;

CREATE INDEX IF NOT EXISTS idx_mensagens_tenant ON mensagens(tenant_id, conversa_id);

-- ============================================================
-- 22. CONVERSA_FOLLOWUPS - referencia conversas
-- ============================================================
ALTER TABLE conversa_followups ADD COLUMN tenant_id INTEGER NOT NULL DEFAULT 1;

CREATE INDEX IF NOT EXISTS idx_conversa_followups_tenant ON conversa_followups(tenant_id, conversa_id);

-- ============================================================
-- 23. CONVERSA_TAGS - referencia conversas
-- ============================================================
ALTER TABLE conversa_tags ADD COLUMN tenant_id INTEGER NOT NULL DEFAULT 1;

CREATE INDEX IF NOT EXISTS idx_conversa_tags_tenant ON conversa_tags(tenant_id, conversa_id);

-- ============================================================
-- 24. USUARIOS - adiciona tenant_id (usuários por tenant)
-- ============================================================
ALTER TABLE usuarios ADD COLUMN tenant_id INTEGER NOT NULL DEFAULT 1;

CREATE INDEX IF NOT EXISTS idx_usuarios_tenant_id ON usuarios(tenant_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_usuarios_tenant_nome ON usuarios(tenant_id, nome);
CREATE UNIQUE INDEX IF NOT EXISTS idx_usuarios_tenant_email ON usuarios(tenant_id, email) WHERE email IS NOT NULL;

-- ============================================================
-- Verificação final
-- ============================================================
-- Todas as tabelas agora têm isolamento tenant_id.
-- Próximo passo: atualizar todas as queries nas rotas para usar tenant_id.
-- Já foi feito em server.js com middleware garantirTenantId().

PRAGMA foreign_keys = ON;
