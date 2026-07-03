# 🧪 Teste Fluxo Completo: Trial → Checkout → Pago

**Objetivo:** Validar que cliente consegue pagar e acesso é desbloqueado automaticamente via webhook.

---

## 📋 Roteiro de Teste

### Fase 1: Criar Conta (Trial)

1. Abra: https://www.easygestao.com/registro.html
2. Preencha:
   - Email: `teste-fase1@example.com`
   - Nome da Loja: `Loja Teste Phase 1`
   - Responsável: `Igor Teste`
   - Telefone: `11999999999`
3. Clique **"Criar Conta"**
4. Verifique email (procure por link de verificação)
5. Clique no link de verificação
6. Você deve ser logado automaticamente
7. Tela deve mostrar PDV/Dashboard (acesso concedido no trial)

**Verificar no banco:**
```bash
ssh ubuntu@54.232.77.5
sqlite3 /opt/easygestion/db/dsstore.db
SELECT id, email, status, trial_ate FROM tenants WHERE email='teste-fase1@example.com';
# Esperado: status='trial', trial_ate=2026-08-01 (hoje+30 dias)
```

---

### Fase 2: Tentar Acessar Após Trial Expirar

⚠️ **Para fins de teste, vamos simular que o trial expirou:**

```bash
ssh ubuntu@54.232.77.5
sqlite3 /opt/easygestion/db/dsstore.db
UPDATE tenants SET trial_ate='2026-06-30' WHERE email='teste-fase1@example.com';
```

Agora:
1. Faça logout: https://www.easygestao.com/login.html → logout
2. Login novamente com `teste-fase1@example.com`
3. Você deve ser **redirecionado para `/planos.html`** (página de contratação)
4. Página deve mostrar: "Seu trial expirou" + botão "Contratar Agora"

---

### Fase 3: Fazer Checkout (Simular Pagamento)

1. Na página `/planos.html`, clique **"Contratar Agora"** (botão verde)
2. Stripe Checkout deve abrir
3. Preencha cartão de teste:
   - **Número:** `4242 4242 4242 4242` (sempre aprovado)
   - **Validade:** `12/26` (qualquer futura)
   - **CVC:** `123` (qualquer número)
   - **Nome:** `Igor Test`
4. Clique **"Pagar"**
5. Stripe deve confirmar e redirecionar pra dashboard

**Verificar no banco após pagamento:**
```bash
sqlite3 /opt/easygestion/db/dsstore.db
SELECT status, data_ativado FROM tenants WHERE email='teste-fase1@example.com';
# Esperado: status='pago', data_ativado='2026-07-02' (hoje)

SELECT * FROM assinaturas WHERE tenant_id IN (SELECT id FROM tenants WHERE email='teste-fase1@example.com');
# Esperado: plano='mensal', data_proxima_renovacao='2026-08-02'

SELECT * FROM cobracas WHERE assinatura_id IN (SELECT id FROM assinaturas WHERE tenant_id IN (SELECT id FROM tenants WHERE email='teste-fase1@example.com'));
# Esperado: status='pago', valor=149 (ou seu plano)
```

---

### Fase 4: Verificar Webhook (Logs)

O webhook deve ter sido disparado por Stripe e o sistema deve ter recebido.

```bash
ssh ubuntu@54.232.77.5
pm2 logs easygestion --lines 50 | grep -i webhook
# Deve mostrar algo como:
# [20:30:45] Webhook recebido: invoice.payment_succeeded
# [20:30:45] Assinatura criada para tenant XXX
```

---

### Fase 5: Verificar Acesso Desbloqueado

1. Logout
2. Login novamente com `teste-fase1@example.com`
3. **Não** deve redirecionar pra `/planos.html`
4. **Deve** entrar no dashboard (`/index.html`)
5. PDV, estoque, clientes — tudo acessível

---

## ✅ Checklist de Sucesso

- [ ] Conta criada com status `trial`
- [ ] Trial expirou → redireciona pra `/planos.html`
- [ ] Checkout abriu sem erros
- [ ] Cartão aceito
- [ ] Status atualizado pra `pago` no banco
- [ ] Assinatura criada com data de renovação
- [ ] Cobrança registrada com status `pago`
- [ ] Webhook log aparece em `pm2 logs`
- [ ] Acesso desbloqueado após pagamento
- [ ] Dashboard acessível sem redirecionamento

---

## 🐛 Se Algo Quebrar

| Problema | Diagnóstico | Fix |
|----------|-----------|-----|
| Checkout não abre | `STRIPE_PUBLISHABLE_KEY` incorreta | Verificar em .env |
| Pagamento rejeitado | Chave secreta Stripe incorreta | Verificar `STRIPE_SECRET_KEY` |
| Status não muda pra "pago" | Webhook não disparou | Verificar `STRIPE_WEBHOOK_SECRET` no Stripe dashboard |
| Acesso continua bloqueado | Middleware não valida status | Verificar `middleware/seguranca.js` |
| Email de verificação não chega | SendGrid não configurado | Verificar `SENDGRID_API_KEY` |

---

## 🚀 Próximas Fases (se passar)

✅ Fase 1 (trial) — criar conta
✅ Fase 2 (expiração) — validar redirecionamento
✅ Fase 3 (checkout) — simular pagamento
✅ Fase 4 (webhook) — verificar notificação
✅ Fase 5 (acesso) — desbloqueio automático

**Quando todas passarem:** você pode aceitar clientes reais.

