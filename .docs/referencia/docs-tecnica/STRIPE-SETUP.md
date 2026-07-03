# Configuração Stripe

## 1. Criar conta Stripe

1. Vá para https://stripe.com e crie uma conta
2. Complete KYC (verificação de identidade)
3. Ative as chaves de API

## 2. Variáveis de Ambiente

Adicione ao seu `.env`:

```bash
# Stripe API Keys
STRIPE_SECRET_KEY=sk_live_... (ou sk_test_... em desenvolvimento)
STRIPE_PUBLIC_KEY=pk_live_... (ou pk_test_...)
STRIPE_WEBHOOK_SECRET=whsec_... (gerado na Dashboard)

# Redirect para após pagamento bem-sucedido
STRIPE_REDIRECT_URL=https://seu-dominio.com (em produção)
```

## 3. Gerar Webhook Secret

1. Vá para **Dashboard > Developers > Webhooks**
2. Clique em **Add endpoint**
3. URL: `https://seu-dominio.com/api/pagamentos/webhook`
4. Eventos a registrar:
   - `checkout.session.completed`
   - `payment_intent.succeeded`
   - `payment_intent.payment_failed`
5. Copie o **Signing secret** para `STRIPE_WEBHOOK_SECRET`

## 4. Testar Localmente

Use Stripe CLI para testar webhooks em desenvolvimento:

```bash
# 1. Instalar Stripe CLI
# https://stripe.com/docs/stripe-cli

# 2. Login
stripe login

# 3. Forwarding de webhooks
stripe listen --forward-to localhost:3000/api/pagamentos/webhook

# 4. A CLI vai mostrar seu webhook secret (STRIPE_WEBHOOK_SECRET)
```

## 5. Flow do Pagamento

### 1️⃣ Cliente tenta pagar
```
POST /api/pagamentos/checkout
{
  "cobranca_id": 123  (opcional; se vazio, é primeira assinatura)
}
```

### 2️⃣ Sistema cria sessão Stripe
```javascript
// Retorna
{
  "sucesso": true,
  "checkoutUrl": "https://checkout.stripe.com/pay/...",
  "sessionId": "cs_test_..."
}
```

### 3️⃣ Cliente é redirecionado para Stripe
- Preenche cartão
- Stripe processa pagamento
- Stripe redireciona para `/dashboard?pagamento=sucesso&session_id=...`

### 4️⃣ Webhook registra pagamento
```
Stripe → POST /api/pagamentos/webhook
  → checkout.session.completed
  → pagarCobranca(cobranca_id)
  → reativarAposPagamento(tenant_id)
```

## 6. Status de Webhook

- ✅ `checkout.session.completed` → Pagamento confirmado
- ✅ `payment_intent.succeeded` → Intent bem-sucedido
- ⚠️ `payment_intent.payment_failed` → Falha; incrementa tentativas

## 7. Renovações Automáticas

O job `/lib/renovacao-scheduler.js` roda todo dia às **03:00 AM**:

1. ✅ Encontra assinaturas que venceram **hoje**
2. ✅ Cria cobrança pendente
3. ✅ Atualiza data de próxima renovação
4. ✅ Registra alerta de cobrança pendente

**Não há retry automático** — é responsabilidade do admin/sistema.

## 8. Admin Dashboard (Cobranças)

`/admin-dashboard.html` mostra:

- **GET /api/pagamentos/admin/cobrancas** → Todas as cobranças
- **GET /api/pagamentos/admin/cobrancas/:id** → Detalhes
- **PATCH /api/pagamentos/admin/cobrancas/:id/marcar-paga** → Marcar como paga manualmente

## 9. Teste no Stripe Dashboard

Números de cartão:
- ✅ 4242 4242 4242 4242 → Sucesso
- ❌ 4000 0000 0000 0002 → Cartão recusado
- ⚠️ 4000 0025 0000 3155 → Requer autenticação 3D Secure

## 10. Checklist Antes do Deploy

- [ ] `STRIPE_SECRET_KEY` configurado
- [ ] `STRIPE_PUBLIC_KEY` configurado
- [ ] `STRIPE_WEBHOOK_SECRET` configurado
- [ ] `STRIPE_REDIRECT_URL` apontando para domínio correto
- [ ] npm install (para instalar stripe)
- [ ] Webhook testado com Stripe CLI
- [ ] Job de renovação está rodando
- [ ] Admin consegue ver cobranças em `/api/pagamentos/admin/cobrancas`
