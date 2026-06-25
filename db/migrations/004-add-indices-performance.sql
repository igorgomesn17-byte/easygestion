-- Migration: Adicionar índices para performance
-- Data: 2026-06-25

-- Produtos: busca por tenant + categoria
CREATE INDEX IF NOT EXISTS idx_produtos_tenant_categoria ON produtos(tenant_id, categoria);
CREATE INDEX IF NOT EXISTS idx_produtos_tenant_colecao ON produtos(tenant_id, colecao);

-- Vendas: filtro por tenant + data
CREATE INDEX IF NOT EXISTS idx_vendas_tenant_data ON vendas(tenant_id, data_hora DESC);
CREATE INDEX IF NOT EXISTS idx_vendas_tenant_cliente ON vendas(tenant_id, cliente_id);
CREATE INDEX IF NOT EXISTS idx_vendas_cliente ON vendas(cliente_id);

-- Clientes: busca por tenant + status
CREATE INDEX IF NOT EXISTS idx_clientes_tenant_arquivado ON clientes(tenant_id, arquivado);

-- Variacoes: busca por produto + tamanho
CREATE INDEX IF NOT EXISTS idx_variacoes_produto ON variacoes(produto_id);

-- Venda Itens: busca por venda
CREATE INDEX IF NOT EXISTS idx_venda_itens_venda ON venda_itens(venda_id);

-- Config: acesso rápido de chaves
CREATE INDEX IF NOT EXISTS idx_config_tenant_chave ON config(tenant_id, chave);

-- Estoque: rastreio de movimentos
CREATE INDEX IF NOT EXISTS idx_movimentos_estoque_variacao ON movimentos_estoque(variacao_id);

-- Auditoría: filtro por recurso
CREATE INDEX IF NOT EXISTS idx_auditoria_tenant_recurso ON auditoria(tenant_id, recurso, recurso_id);
CREATE INDEX IF NOT EXISTS idx_auditoria_tenant_usuario ON auditoria(tenant_id, usuario_id);

-- Despesas: filtro por data (se tabela existir)
-- CREATE INDEX IF NOT EXISTS idx_despesas_tenant_data ON despesas(tenant_id, data DESC);

-- Impostos: busca por estado/categoria
CREATE INDEX IF NOT EXISTS idx_impostos_tenant_estado_categoria ON impostos(tenant_id, estado, categoria);
