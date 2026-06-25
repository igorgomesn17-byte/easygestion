# AUDITORIA: Sistema de Trocas + CMVR

## ✅ O QUE EXISTE

### Schema (db/schema.sql)
- ✅ Tabela `trocas` (linhas 302-312)
  - `id, venda_origem_id, data_hora, valor_devolvido, valor_levado, diferenca, forma_pagamento_diferenca, obs`
  - Foreign key com vendas
- ✅ Tabela `troca_itens` (linhas 314-326)
  - `id, troca_id, tipo, variacao_id, produto_id, descricao, qtd, valor_unit`
  - Rastreia itens "devolvido" e "levado"

### Routes (routes/trocas.js)
- ✅ `GET /api/trocas` — lista trocas com filtro de data
- ✅ `GET /api/trocas/:id` — detalhe com itens
- ✅ `GET /api/trocas/prazo/:vendaId` — verifica se está dentro de 7 dias úteis
- ✅ `POST /api/trocas` — cria troca + ajusta estoque + caixa
  - Devolvidos voltam ao estoque (entrada)
  - Levados saem do estoque (saída)
  - Diferença ajusta caixa (suprimento/sangria em dinheiro)
- ✅ `PATCH /api/trocas/:id/cancelar` — cancela e reverte tudo

### Lógica de Estoque
- ✅ **Devolvidos**: `UPDATE variacoes SET quantidade = quantidade + qtd`
- ✅ **Levados**: `UPDATE variacoes SET quantidade = quantidade - qtd`
- ✅ Rastreia em `movimentos_estoque` com motivo

### Lógica de Caixa (diferença)
- ✅ Se `diferenca > 0` e forma='dinheiro' → entra como **suprimento**
- ✅ Se `diferenca < 0` e forma='dinheiro' → sai como **sangria**
- ✅ Registra movimento em `caixa_movimentos`

---

## ❌ O QUE FALTA (CRÍTICO)

### 1. CMVR (Custo de Mercadorias Vendidas + Trocadas) — NÃO INCLUÍDO NO DRE

**Problema:**
- DRE (routes/financeiro.js, linha 75) calcula CMV apenas de **vendas**:
  ```sql
  COALESCE(SUM(custo_total),0) AS cmv FROM vendas
  ```
- **TROCAS NÃO SÃO INCLUÍDAS** no cálculo de CMV
- Quando uma peça é trocada (levada), o custo dela deveria ser contabilizado como CMV adicional
- Quando uma peça é devolvida (trocada), há uma REVERSÃO de CMV

**Impacto:**
- Lucro bruto está **SUPER-INFLADO** (falta abater custos de peças trocadas)
- Margem operacional está **FALSA**
- Relatório financeiro **NÃO BATE** com realidade

**Exemplo:**
- Venda de vestido por R$100 (custo R$40) → CMV = R$40 ✅
- Cliente troca → leva outro vestido (custo R$35) → CMV deveria abater mais R$35 ❌ (não abate)
- Resultado: sistema ignora R$35 de custo, lucro fictício +R$35

### 2. Custo Unitário em `troca_itens`

**Problema:**
- `troca_itens.valor_unit` armazena o **preço de venda**, não o custo
- Quando levado é inserido: `valor_unit: v.preco_venda` (linha 152)
- Quando devolvido: `valor_unit` é informado manualmente (linha 179)
- **Custo real não está sendo capturado**

**Impacto:**
- Impossível calcular CMV correto das trocas mesmo se incluir na query
- Necessário refazer trocas já registradas para ter dados corretos

### 3. Sem Rastreamento de "Custo Abatido" na Troca

**Problema:**
- Tabela `trocas` tem `valor_devolvido` e `valor_levado` (preços de venda)
- **Faltam colunas** para rastrear:
  - `custo_devolvido` — custo real das peças que voltaram ao estoque
  - `custo_levado` — custo real das peças que saíram
  - `cmvr_bruto` — impacto total no CMVR (custo_levado - custo_devolvido)

**Impacto:**
- Sem essas colunas, impossível fazer auditoria depois
- DRE fica sem dados para incluir trocas

---

## 🔧 SOLUÇÃO (MVP)

### Passo 1: Adicionar Colunas na Tabela `trocas`
```sql
ALTER TABLE trocas ADD COLUMN custo_devolvido REAL NOT NULL DEFAULT 0;
ALTER TABLE trocas ADD COLUMN custo_levado REAL NOT NULL DEFAULT 0;
ALTER TABLE trocas ADD COLUMN cmvr_bruto REAL NOT NULL DEFAULT 0; -- custo_levado - custo_devolvido
```

### Passo 2: Capturar Custo em `troca_itens`
```sql
ALTER TABLE troca_itens ADD COLUMN custo_unit REAL NOT NULL DEFAULT 0;
```

### Passo 3: Atualizar POST /api/trocas
```javascript
// Quando registra devolvido: buscar custo do produto
// Quando registra levado: buscar custo do produto
// Somar totais: custo_devolvido, custo_levado
// Calcular: cmvr_bruto = custo_levado - custo_devolvido
```

### Passo 4: Atualizar DRE
```sql
SELECT 
  COALESCE(SUM(v.custo_total), 0) +                    -- CMV de vendas normais
  COALESCE(SUM(t.cmvr_bruto), 0) AS cmv                -- + impacto de trocas
FROM vendas v
LEFT JOIN trocas t ON substr(t.data_hora, 1, 7) = ? 
WHERE substr(v.data_hora, 1, 7) = ? AND v.tenant_id = ?
```

---

## 📊 IMPACTO NA VIABILIDADE

**Situação Atual (sem trocas no CMV):**
- Loja vende R$1000/mês (custo R$400)
- Sistema mostra: Lucro Bruto = R$600
- Mas 10% das vendas viram trocas (R$100 em custo)
- Lucro real: R$600 - R$100 = **R$500** (não R$600)
- **Erro: +16.7% de lucro inflacionado**

**Com Trocas Incluídas:**
- DRE mostraria a verdade
- Dona entenderia o real impacto das trocas

---

## ✅ CHECKLIST PARA DEPLOY

- [ ] Adicionar colunas em `trocas` (custo_devolvido, custo_levado, cmvr_bruto)
- [ ] Adicionar coluna em `troca_itens` (custo_unit)
- [ ] Atualizar POST /api/trocas para capturar custos
- [ ] Atualizar GET /api/financeiro/dre para incluir cmvr_bruto de trocas
- [ ] Testar: criar troca, verificar DRE, confirmar que CMV aumentou
- [ ] Backfill: popular custos de trocas antigas (ou aceitar que anteriores estão erradas)

---

## STATUS

**Implementação Atual:** 70% (estoque OK, caixa OK, CMV ❌)
**Bloqueio para Produção:** SIM — números estão errados

**Prioridade:** ALTA
- Dona não pode confiar em relatórios de lucro se trocas não estão incluídas
