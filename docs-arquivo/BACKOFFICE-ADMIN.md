# Backoffice Administrativo — EasyGestão SaaS

## 📊 O que foi criado

Seu painel de controle do SaaS — onde você gerencia clientes, monitora receita e bloqueia inadimplentes.

### 1️⃣ Rota Principal: `/admin`
- **URL:** `http://localhost:3000/admin`
- **Acesso:** via header `x-admin-password: teste123` (ou sessão logada com papel admin)
- **Função:** Dashboard HTML com 7 cards de métricas + tabela de clientes

### 2️⃣ APIs de Backoffice

#### `GET /api/admin/financeiro`
Resumo financeiro em tempo real.
```json
{
  "financeiro": {
    "total_clientes": 1,
    "clientes_ativos": 1,
    "clientes_bloqueados": 0,
    "total_recebido": 49.90,
    "total_pendente": 0,
    "total_vencido": 0,
    "ticket_medio": 49.90,
    "mrr": 49.90,      // Receita Mensal Recorrente
    "arr": 598.80      // Receita Anual (MRR × 12)
  }
}
```

#### `GET /api/admin/clientes`
Lista de todos os clientes (tenants).
```json
{
  "clientes": [
    {
      "id": 1,
      "nome": "Loja Teste",
      "email": "teste@email.com",
      "status": "ativo",
      "data_criacao": "2026-06-19 18:46:27",
      "num_usuarios": 0,
      "ultima_venda": null,
      "ultimo_acesso": null
    }
  ]
}
```

#### `GET /api/admin/clientes/:id`
Detalhes de um cliente + histórico de assinaturas e cobranças.
```json
{
  "tenant": { ... },
  "assinaturas": [
    {
      "id": 1,
      "plano": "basico",
      "status": "ativa",
      "data_inicio": "2026-06-19",
      "data_fim": null,
      "cobracas": [
        {
          "id": 1,
          "valor": 49.90,
          "status": "pago",
          "data_vencimento": "2026-06-19",
          "data_pagamento": null,
          "data_criacao": "2026-06-19 18:46:27"
        }
      ]
    }
  ]
}
```

#### `PATCH /api/admin/clientes/:id`
Bloquear ou desbloquear um cliente.
```bash
curl -X PATCH http://localhost:3000/api/admin/clientes/1 \
  -H "x-admin-password: teste123" \
  -H "Content-Type: application/json" \
  -d '{"status": "bloqueado"}'
```

---

## 🔐 Autenticação

### Método 1: Senha (Desenvolvimento)
```bash
# Via header
curl http://localhost:3000/admin -H "x-admin-password: teste123"

# Via query string
curl http://localhost:3000/admin?admin_password=teste123
```

### Método 2: Sessão (Produção)
Se você está logado como usuário com `papel = 'admin'` e `tenant_id = 1`, acessa automático.

Configurar em `.env`:
```
ADMIN_PASSWORD=sua-senha-super-segura-aqui
```

---

## 📈 Dashboard — Cards de Métrica

| Card | Descrição |
|------|-----------|
| **Clientes Ativos** | Quantos clientes estão com status `ativo` |
| **Total de Clientes** | Quantos clientes se cadastraram |
| **MRR** | Receita mensal recorrente (Average × Clientes ativos) |
| **ARR** | Receita anual (MRR × 12) |
| **Recebido** | Total cobrado com status `pago` |
| **Pendente** | Total em aberto com status `pendente` |
| **Vencido** | Total em atraso com status `vencido` |

---

## 🎯 Tabela de Clientes

Mostra:
- Nome, Email, Status
- Data de cadastro
- Quantidade de usuários
- Última venda
- Botões de ação:
  - **Detalhes** → abre modal com assinaturas e cobranças
  - **Bloquear / Desbloquear** → PATCH status

---

## 🛠️ Como Usar

### 1. Acessar o painel
```
http://localhost:3000/admin
Senha: teste123
```

### 2. Monitorar receita
Os cards no topo mostram MRR, ARR, e status financeiro em tempo real.

### 3. Bloquear cliente inadimplente
- Clica em **Detalhes** → vê o histórico de pagamentos
- Se vencido, clica em **Bloquear**
- Cliente fica com status `bloqueado` e perde acesso

### 4. Ver detalhes de um cliente
- Clica em **Detalhes** → abre modal com:
  - Planos/assinaturas
  - Histórico de cobranças (datas, valores, status)

---

## 📁 Arquivos Criados

```
routes/admin.js                    ← APIs de backoffice (4 endpoints)
public/admin-dashboard.html        ← Interface do dashboard
scripts/criar-banco-teste.js       ← Script para criar banco com dados de teste
dados.db                           ← Banco SQLite (criado automaticamente)
```

---

## 🔧 Estrutura do Banco

As tabelas do SaaS foram criadas:

```sql
-- Clientes
tenants (id, nome, email, status, data_criacao)

-- Assinaturas
assinaturas (id, tenant_id, plano, status, data_inicio, data_fim)

-- Cobranças
cobracas (id, assinatura_id, valor, status, data_vencimento, data_pagamento, data_criacao)

-- Operacionais (com tenant_id)
usuarios (id, tenant_id, ...)
vendas (id, tenant_id, ...)
```

---

## ⚙️ Próximos Passos

1. **Integrar com Stripe/Pagar.me** — gerar boletos automáticos
2. **Webhook de pagamento** — atualizar status da cobrança automaticamente
3. **Email de cobrança** — aviso quando estiver vencendo
4. **Relatórios avançados** — CSV, PDF, gráficos de trend
5. **Painel multi-idioma** — suportar espanhol, inglês

---

## 🎓 Exemplo de Fluxo Completo

```
1. Cliente novo se cadastra via /api/registro
   ↓ (Cria tenant novo)
2. Sistema gera assinatura automática (plano basico)
3. Cron diário gera boleto de cobrança
4. Cliente paga via banco
5. Webhook confirma pagamento
6. Status da cobrança = "pago"
7. No admin, você vê MRR aumentar
```

---

## 📞 Suporte

Se o dashboard não carregar:
1. Verifique se o servidor está rodando: `npm start`
2. Verifique senha em `.env` → `ADMIN_PASSWORD`
3. Confirme que `dados.db` foi criado: `ls dados.db`

Erros de banco de dados? Recrie:
```bash
node scripts/criar-banco-teste.js
```
