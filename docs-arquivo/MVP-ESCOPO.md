# 🎯 DRE Express — MVP Escopo Enxuto

> **Versão:** 0.1.0 (MVP)  
> **Data:** Junho 2026  
> **Status:** Em desenvolvimento

---

## ✅ O QUE ENTRA NO MVP

### 1. **PDV** — Vender peças (em tempo real)
- Busca e seleção de produto por tamanho
- Carrinho de compras com desconto
- Múltiplas formas de pagamento (Pix, dinheiro, débito, crédito parcelado)
- Troco (dinheiro ou Pix)
- Pagamento dividido (2+ formas)
- Cliente opcional (busca/novo)
- **Cupom impresso** + **Recibo WhatsApp** automático
- Comissão de vendedor

### 2. **Estoque** — Gerenciar quantidade
- Visão por produto + tamanho
- Ajustes manuais (contagem, perda, etc)
- **Entrada de estoque via NFC-e** (novo)
- Alertas de itens zerados
- Exportar para CSV

### 3. **Caixa** — Abertura/Fechamento
- Fundo de troco
- Sangrias (saques)
- Suprimentos (adições)
- Conciliação do dinheiro físico
- Histórico de movimentações

### 4. **Clientes** — Cadastro + Histórico
- Nome, telefone, cidade, aniversário
- Origem (de onde veio)
- Histórico de compras
- Total gasto + número de compras
- Última compra
- Busca por nome

### 5. **Financeiro** (Core do DRE Express)
- **Despesas:** contas fixas/variáveis, recorrentes, categorias
- **Fluxo de Caixa:** entradas vs saídas do mês
- **DRE:** Demonstração de Resultado (receita bruta, impostos, CMV, lucro, despesas)
- Fechamento mensal

### 6. **NFC-e** — Emissão Fiscal
- **Config Fiscal:** upload certificado A1, IE, série (criado nesta sessão)
- **Emissão na venda:** botão "Finalizar + NFC-e" no PDV
- **Histórico:** relatório de notas emitidas (status, chave, DANFE)
- Integração com Focus (Opção B: cliente paga Focus separadamente)

### 7. **Histórico de vendas**
- Listar todas as vendas realizadas
- Filtro por data
- Busca por cliente
- Detalhe com itens, pagamento, totais
- Botão "Emitir NFC-e" por venda
- Botão "Registrar troca" direcionando pra tela de trocas

### 8. **Trocas e devoluções**
- Registra trocas (cliente leva outro produto) e devoluções (recebe dinheiro de volta)
- Motivos: defeito, tamanho, arrependimento, cor, outro
- Para trocas: busca e seleciona qual produto o cliente quer
- Para devoluções: informa o valor que será devolvido
- Listagem de trocas/devoluções realizadas

### 9. **Recibo WhatsApp**
- Automático após venda finalizada
- Formata itens, total, forma pagamento
- Botão manual em cupom.html

### 10. **Configurações**
- Identidade da loja (logo, cor)
- Dados da loja (nome, endereço, CNPJ, IE)
- Taxas de maquininha (Pix, débito, crédito 1x-6x)
- Impostos e comissão padrão
- Metas de venda
- Precificação (markup, embalagem, frete)
- **Certificado A1 (novo)**
- Categorias, coleções, canais de venda
- Datas comerciais (sazonais)

---

## ❌ O QUE SAI DO MVP (v2+)

- ❌ **CRM/Régua** — automações de relacionamento
- ❌ **Inbox** — WhatsApp/Instagram integrado (responder msgs)
- ❌ **Relacionamento** — painel de vendas/contatos
- ❌ **Vitrine** — site público
- ❌ **Clube fidelidade** — selos + prêmios
- ❌ **Encomendas** — pedidos sob encomenda
- ❌ **Trocas/Devoluções** — gerenciar trocas
- ❌ **Permutas** — marketing (blogueiras)
- ❌ **Curva ABC** — análise de produtos
- ❌ **Etiquetas** — impressão em lote
- ❌ **Cadastro em lote** — import CSV de produtos
- ❌ **IA** — qualquer inteligência artificial

---

## 📊 Rotas API (Backend)

### Autenticação
- `POST /api/login` — fazer login
- `POST /api/logout` — sair

### PDV/Vendas
- `POST /api/vendas` — registrar venda
- `GET /api/vendas/{id}` — detalhe da venda
- `GET /api/vendas` — histórico

### Estoque
- `GET /api/estoque` — listar quantidade por tamanho
- `POST /api/estoque/ajuste` — ajuste manual
- `POST /api/estoque/entrada` — entrada simples

### Caixa
- `POST /api/caixa/abrir` — abrir dia
- `POST /api/caixa/sangria` — retirada
- `POST /api/caixa/suprimento` — adição
- `POST /api/caixa/fechar` — fechar e conciliar

### Histórico
- `GET /api/vendas` — listar todas as vendas (com filtros de data)
- `GET /api/vendas/{id}` — detalhe de uma venda

### Trocas
- `GET /api/trocas` — listar trocas/devoluções
- `POST /api/trocas` — registrar troca ou devolução
- `GET /api/trocas/{vendaId}` — trocas de uma venda específica

### Clientes
- `GET /api/clientes` — listar
- `POST /api/clientes` — criar
- `GET /api/clientes/{id}` — detalhe

### Financeiro
- `GET /api/financeiro/fluxo` — entradas vs saídas
- `GET /api/financeiro/dre` — DRE mensal

### Despesas
- `GET /api/despesas` — listar (com filtros)
- `POST /api/despesas` — criar
- `PUT /api/despesas/{id}` — editar
- `POST /api/despesas/{id}/pagar` — marcar como paga
- `POST /api/despesas/gerar-mes` — gerar recorrentes

### NFC-e
- `GET /api/nfce/config` — status da integração
- `POST /api/nfce/emitir/{vendaId}` — emitir nota da venda
- `GET /api/nfce/relatorio` — histórico de emissões

### Config
- `GET /api/config` — ler configurações
- `POST /api/config` — salvar configurações
- `POST /api/config/certificado-a1` — upload cert
- `DELETE /api/config/certificado-a1` — remover cert

---

## 🧭 Telas Disponíveis

| Tela | Arquivo | Status |
|------|---------|--------|
| Login | `login.html` | ✅ |
| Painel | `index.html` | ✅ |
| Vender (PDV) | `pdv.html` | ✅ |
| Cupom/Recibo | `cupom.html` | ✅ |
| Histórico de vendas | `historico.html` | ✅ |
| Trocas e devoluções | `trocas.html` | ✅ |
| Estoque | `estoque.html` | ✅ |
| Produtos | `produtos.html` | ✅ |
| Clientes | `clientes.html` | ✅ |
| Caixa | `caixa.html` | ✅ |
| Fechamento | `fechamento-caixa.html` | ✅ |
| Despesas | `financeiro.html` | ✅ |
| Fluxo & DRE | `fluxo.html` | ✅ |
| Notas Fiscais | `nfce-relatorio.html` | ✅ |
| Vendedores | `vendedores.html` | ✅ |
| Configurações | `config.html` | ✅ |

**Telas deletadas:** crm, inbox, relacionamento, vitrine, encomendas, permuta, troca, rfm, curva-abc, etiquetas, lote, recibo-encomenda

---

## 🚀 Próximas Etapas

1. ✅ **Config Fiscal:** Upload cert A1, IE, série [FEITO]
2. ✅ **Entrada NFC-e:** Registrar estoque via nota fiscal [FEITO]
3. ⏳ **Integração real Focus:** Trocar API mock por real
4. ⏳ **Testes:** PDV, Caixa, Financeiro, NFC-e
5. ⏳ **Deploy:** Render + domínio drexpress.com.br
6. ⏳ **Landing page**
7. ⏳ **Beta com 5-10 clientes**

---

## 📝 Checklist de Conclusão

- [x] Deletar rotas desnecessárias (CRM, Inbox, Permutas, Encomendas, Webhooks, Lead Vitrine)
- [x] Deletar telas desnecessárias (14 arquivos HTML)
- [x] Limpar menu (comum.js) — só MVP
- [x] Limpar server.js — remover registros de rotas deletadas
- [x] Criar tela **Histórico de vendas**
- [x] Criar tela **Trocas e devoluções**
- [x] Registrar rotas de trocas no backend
- [x] Atualizar escopo (MVP-ESCOPO.md)
- [ ] Testar servidor (npm start)
- [ ] Testar PDV completo
- [ ] Testar Histórico e Trocas
- [ ] Testar Caixa
- [ ] Testar Financeiro/DRE
- [ ] Testar NFC-e (venda)
- [ ] Build final

---

**Status MVP:** ~90% pronto para testes com clientes reais

