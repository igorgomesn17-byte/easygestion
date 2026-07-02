# Configuração Stripe — Fase 1 (Planos)

## ✅ O que você precisa fazer agora:

### 1. Criar Product no Stripe Dashboard
- Nome: `EasyGestão`
- Descrição: `Sistema de gestão de lojas`

### 2. Criar Price Mensal
- Product: EasyGestão
- Preço: **R$ 99,90**
- Moeda: BRL
- Recorrência: **Monthly** (a cada mês)
- **Copy o ID do price aqui:** `price_xxxxx_mensal`

### 3. Criar Price Anual
- Product: EasyGestão
- Preço: **R$ 1.078,80** (R$ 89,90 × 12)
- Moeda: BRL
- Recorrência: **Yearly** (a cada ano)
- **Copy o ID do price aqui:** `price_xxxxx_anual`

---

## Após criar, me retorna:

```
PRICE_ID_MENSAL=price_xxxxxxxxxxxxx
PRICE_ID_ANUAL=price_xxxxxxxxxxxxx
```

Daí eu vou:
1. Atualizar `lib/stripe.js` com os IDs
2. Criar `planos.html` com as 2 abas (mensal/anual)
3. Fazer o checkout redirecionar para a página certa

---

## Observações:

- Os prices que você criar AGORA já ficam salvos no Stripe
- Se precisar mudar o valor depois, cria um novo price (não edita o antigo)
- Webhook de Stripe já está pronto para processar os pagamentos
