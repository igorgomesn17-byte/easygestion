# 💳 Assinaturas e Cobrança Recorrente (SaaS)

## Visão Geral

Sistema completo de gerenciamento de planos e pagamentos para SaaS multi-tenant.

**Status:** ✅ Implementado  
**Integração Stripe:** ⏳ Próximo passo

---

## Arquitetura

### Tabelas do Banco

#### `assinaturas`
```sql
id                       INTEGER PRIMARY KEY
tenant_id                INTEGER UNIQUE  -- 1 assinatura por cliente
plano                    TEXT            -- 'basico', 'pro', 'enterprise'
valor_mensal             REAL            -- R$ por mês
data_inicio              TEXT            -- quando começou
data_proxima_renovacao   TEXT            -- próxima cobrança
cancelada_em             TEXT            -- NULL = ativa
cancelado_por            TEXT
motivo_cancelamento      TEXT
```

#### `cobracas`
```sql
id                       INTEGER PRIMARY KEY
tenant_id                INTEGER
assinatura_id            INTEGER
data_cobranca            TEXT            -- quando deve cobrar
valor                    REAL
status                   TEXT            -- 'pendente' | 'pago' | 'falhou'
metodo_pagamento        TEXT            -- 'stripe', etc
referencia              TEXT            -- ID da transação Stripe
data_pagamento          TEXT            -- quando foi pago
tentativas              INTEGER         -- quantas vezes tentou cobrar
```

### Módulo `lib/assinatura.js`

**Funções principais:**

```javascript
// Obter status atual da assinatura
obterStatusAssinatura(tenantId)
// → {
//   status: 'ativa' | 'vencida' | 'pagamento_pendente' | 'cancelada' | 'trial',
//   motivo: string,
//   bloqueado: boolean,
//   diasRestantes: number
// }

// Criar assinatura (novo cliente)
criarAssinatura(tenantId, plano='basico')

// Criar cobrança (quando assinatura vence)
criarCobranca(tenantId, valor)

// Marcar cobrança como paga (webhook Stripe)
pagarCobranca(cobrancaId, metodoPagamento='stripe')

// Renovar assinatura (próximos 30 dias)
renovarAssinatura(tenantId)

// Cancelar assinatura
cancelarAssinatura(tenantId, motivo)

// Bloquear cliente automaticamente por atraso
verificarEBloquearPorAtraso(tenantId, diasAtrasoLimite=7)

// Reativar após pagamento
reativarAposPagamento(tenantId)
```

---

## Fluxo de Cobrança

### Cenário 1: Novo Cliente (Trial)

```
1. Cliente se registra
   ↓
2. Cria assinatura com plano='basico' (ou outro)
   ↓
3. data_proxima_renovacao = hoje + 30 dias
   ↓
4. Cliente acessa durante 30 dias
   ↓
5. (Dia 24) Email: "Sua assinatura vence em 7 dias" 📧
   ↓
6. (Dia 29) Email: "Amanhã vence***REMOVED*** Confirme seu cartão" 📧
   ↓
7. (Dia 30) Sistema cria cobranca com status='pendente'
   ↓
8. Webhook Stripe: pagamento confirmado
   ↓
9. Sistema marca cobranca.status='pago'
   ↓
10. Sistema renova assinatura
    (data_proxima_renovacao = dia 60)
```

### Cenário 2: Pagamento Falha

```
1. Dia 30: Cobrança criada (status='pendente')
   ↓
2. Webhook Stripe: pagamento FALHOU
   ↓
3. Sistema não marca como pago
   ↓
4. (Dia 31) Status: "pagamento_pendente" + email de alerta 📧
   ↓
5. (Dia 37) Após 7 dias de atraso:
   - Sistema bloqueia tenant (status='bloqueado')
   - Email ⚠️: "Sua conta foi bloqueada por falta de pagamento"
   ↓
6. Cliente paga
   ↓
7. Webhook Stripe: pagamento OK
   ↓
8. Sistema:
   - Marca cobranca.status='pago'
   - Renova assinatura
   - Reativa tenant (status='ativo')
   - Email ✅: "Sua conta foi reativada"
```

### Cenário 3: Cliente Cancela

```
1. Cliente acessa GET /api/assinaturas/minha
   ↓
2. Vê status da assinatura
   ↓
3. Clica "Cancelar assinatura"
   ↓
4. POST /api/assinaturas/cancelar
   ↓
5. Sistema: UPDATE assinaturas SET cancelada_em=now()
   ↓
6. Email: "Sua assinatura foi cancelada"
   ↓
7. Acesso bloqueado imediatamente
```

---

## API de Assinaturas

### Cliente (Logado)

#### GET /api/assinaturas/minha
Detalhes da assinatura do cliente logado.

```bash
curl http://localhost:3000/api/assinaturas/minha \
  -H "Cookie: ds.sid=..."

# Response:
{
  "assinatura": {
    "id": 1,
    "tenant_id": 1,
    "plano": "basico",
    "valor_mensal": 99,
    "data_inicio": "2026-06-22",
    "data_proxima_renovacao": "2026-07-22",
    "cancelada_em": null
  },
  "status": {
    "status": "ativa",
    "motivo": "Assinatura ativa",
    "bloqueado": false,
    "diasRestantes": 30
  }
}
```

#### GET /api/assinaturas/pagamentos
Histórico de cobranças do cliente.

```bash
curl http://localhost:3000/api/assinaturas/pagamentos \
  -H "Cookie: ds.sid=..."

# Response:
{
  "cobracas": [
    {
      "id": 1,
      "tenant_id": 1,
      "data_cobranca": "2026-06-22",
      "valor": 99,
      "status": "pago",
      "data_pagamento": "2026-06-22",
      "metodo_pagamento": "stripe"
    }
  ],
  "resumo": {
    "total_pago": 99,
    "total_pendente": 0,
    "proxima_cobranca": null
  }
}
```

### Admin

#### GET /api/admin/assinaturas
Lista todas as assinaturas.

```bash
curl http://localhost:3000/api/admin/assinaturas \
  -H "Cookie: ds.sid=..."

# Response:
{
  "assinaturas": [
    {
      "id": 1,
      "tenant_id": 1,
      "nome_loja": "Loja XYZ",
      "email": "loja@example.com",
      "plano": "basico",
      "valor_mensal": 99,
      "status_atual": {
        "status": "ativa",
        "motivo": "Assinatura ativa",
        "bloqueado": false,
        "diasRestantes": 8
      }
    }
  ]
}
```

#### GET /api/admin/assinaturas/:id
Detalhes e histórico de cobranças de uma assinatura.

```bash
curl http://localhost:3000/api/admin/assinaturas/1 \
  -H "Cookie: ds.sid=..."

# Response:
{
  "assinatura": {...},
  "status_atual": {...},
  "cobracas": [...]
}
```

#### PATCH /api/admin/assinaturas/:id
Alterar plano de um cliente.

```bash
curl -X PATCH http://localhost:3000/api/admin/assinaturas/1 \
  -H "Content-Type: application/json" \
  -d '{"plano":"pro","valor_mensal":299}' \
  -H "Cookie: ds.sid=..."

# Response:
{
  "sucesso": true,
  "assinatura": {
    "plano": "pro",
    "valor_mensal": 299,
    ...
  }
}
```

#### DELETE /api/admin/assinaturas/:id
Cancelar assinatura de um cliente.

```bash
curl -X DELETE http://localhost:3000/api/admin/assinaturas/1 \
  -H "Content-Type: application/json" \
  -d '{"motivo":"Pagamento fraudulento"}' \
  -H "Cookie: ds.sid=..."

# Response:
{
  "sucesso": true,
  "mensagem": "Assinatura cancelada",
  "motivo": "Pagamento fraudulento"
}
```

---

## Emails Automáticos

### 1. Aviso de Renovação (7 dias antes)

```
Para: loja@example.com
Assunto: ⏰ Sua Assinatura Vence em 7 Dias

Oi Loja XYZ,

Sua assinatura do plano Básico vence em 29/06/2026.

Valor: R$ 99,00/mês

✅ Verifique se seus dados de pagamento estão atualizados
✅ A cobrança será realizada automaticamente
```

### 2. Último Aviso (1 dia antes)

```
Para: loja@example.com
Assunto: 🚨 AMANHÃ Sua Assinatura Vence***REMOVED***

Oi Loja XYZ,

Sua assinatura vence AMANHÃ (30/06/2026).

⚠️ IMPORTANTE:
• Certificar-se de que seu cartão está válido
• Ter saldo suficiente para a cobrança de R$ 99,00
```

### 3. Bloqueio por Falta de Pagamento

```
Para: loja@example.com
Assunto: ⚠️ Sua Conta Foi Bloqueada

Oi Loja XYZ,

Sua conta foi bloqueada porque há um pagamento pendente.

💳 Como Resolver Este Problema?
[Efetuar Pagamento Agora]

Após o pagamento ser confirmado:
✅ Sua conta será reativada automaticamente
✅ Você terá acesso total à plataforma
```

### 4. Reativação Após Pagamento

```
Para: loja@example.com
Assunto: ✅ Sua Conta Foi Reativada

Oi Loja XYZ,

Bem-vindo de volta***REMOVED*** Sua conta foi reativada.

✅ Você agora pode acessar normalmente.
```

---

## Estados de Uma Assinatura

```
TRIAL (0 dias pagos)
  ↓
ATIVA (pagamento confirmado)
  ↓ (cobrança criada mas não paga)
PAGAMENTO_PENDENTE
  ↓ (7+ dias sem pagar)
BLOQUEADA (cliente é bloqueado)
  ↓ (cliente paga)
ATIVA
  ↓
... (próximos 30 dias)
  ↓ (cliente clica cancelar)
CANCELADA
```

---

## Como Integrar com Stripe

### 1. Setup Stripe

```bash
npm install stripe
export STRIPE_SECRET_KEY="sk_live_xxxxx"
export STRIPE_PUBLIC_KEY="pk_live_xxxxx"
```

### 2. Webhook de Pagamento

Stripe → Seu servidor:

```
POST /webhook/stripe/pagamento
{
  "type": "charge.succeeded" | "charge.failed",
  "data": {
    "object": {
      "id": "ch_xxxxx",
      "amount": 9900,  // em centavos
      "customer": "cus_xxxxx",
      "metadata": {
        "cobranca_id": "1"
      }
    }
  }
}
```

Seu server precisa:
1. Validar assinatura do webhook (STRIPE_SECRET_KEY)
2. Buscar cobranca_id do metadata
3. Chamar `pagarCobranca(cobranca_id, 'stripe')`
4. Chamar `renovarAssinatura(tenant_id)`
5. Chamar `reativarAposPagamento(tenant_id)`

### 3. Criar Pagamento no Frontend

```javascript
// Quando assinatura vence
const cobranca = await fetch('/api/assinaturas/pagar', {
  method: 'POST',
  body: JSON.stringify({
    cobranca_id: 1,
    stripe_token: stripeToken // do Stripe.js
  })
});
```

---

## Job Automático: Verificar Renovações

Este job deve rodar **diariamente** (cron job):

```javascript
// scripts/renovar-assinaturas.js
const { db } = require('./db/database');
const { criarCobranca, enviarEmail, templateAvisoRenovacao } = require('./lib');

function renovarAssinaturasVencidas() {
  const hoje = new Date().toISOString().split('T')[0];

  // Encontrar assinaturas que vencem hoje
  const assinaturasVencidas = db.prepare(`
    SELECT a.*, t.email, t.nome_loja
    FROM assinaturas a
    JOIN tenants t ON t.id = a.tenant_id
    WHERE a.data_proxima_renovacao = ?
    AND a.cancelada_em IS NULL
  `).all(hoje);

  assinaturasVencidas.forEach(a => {
    // Criar cobrança
    criarCobranca(a.tenant_id, a.valor_mensal, hoje);

    // Enviar email
    const html = templateAvisoUltimoDia(a.nome_loja, a.data_proxima_renovacao, a.plano, a.valor_mensal);
    enviarEmail(a.email, '🚨 AMANHÃ Sua Assinatura Vence***REMOVED***', html);

    console.log(`[RENOVACAO] Cobrança criada para tenant ${a.tenant_id}`);
  });
}

// Executar diariamente
cron.schedule('0 0 * * *', renovarAssinaturasVencidas);
```

---

## Casos de Uso

### Caso 1: Cliente Quer Mudar de Plano

```
Cliente: GET /api/assinaturas/minha
  ↓ vê plano="basico"
  ↓
Admin: PATCH /api/admin/assinaturas/1
  {"plano":"pro","valor_mensal":299}
  ↓
Sistema: muda plano, próxima cobrança usa novo valor
```

### Caso 2: Investigar Atraso de Pagamento

```
Admin: GET /api/admin/assinaturas/1
  ↓ vê status_atual.status="pagamento_pendente"
  ↓ vê lista de cobracas
  ↓
Admin: verifica história do cliente, vê tentativas falhadas
  ↓
Admin: DELETE /api/admin/assinaturas/1
  {"motivo":"Problemas persistentes de pagamento"}
  ↓
Sistema: cancela, bloqueia, email de cancellation
```

### Caso 3: Reativar Manualmente (Superusuário)

```
Admin: Percebe que cliente pagou fora do sistema
Admin: PATCH /api/admin/clientes/1
  {"status":"ativo"}
  ↓
Sistema: libera acesso imediatamente
  Email: "Sua conta foi reativada"
```

---

## Segurança

✅ **Idempotência:** Webhook pode ser chamado 2x, cobrança só marca como paga 1x  
✅ **Auditoria:** Todas as mudanças de assinatura são logged  
✅ **Isolamento:** Cliente vê apenas sua própria assinatura  
✅ **Autenticação:** Endpoints admin exigem papel='admin'  

---

## Próximos Passos

1. [ ] Integrar Stripe (API key, webhook)
2. [ ] Job cron para renovações diárias
3. [ ] Frontend para gerenciar plano
4. [ ] Email de pagamento recusado
5. [ ] Retry automático de pagamento
6. [ ] Desconto por período (anual = 10% off)
7. [ ] Função de upgrade imediato (paga a diferença pro-rata)

---

**Documentação relacionada:**
- [BLOQUEIO-CLIENTE-FUNCIONAL.md](BLOQUEIO-CLIENTE-FUNCIONAL.md) — Bloqueio por atraso
- [AUDITORIA-LGPD.md](AUDITORIA-LGPD.md) — Rastreamento
