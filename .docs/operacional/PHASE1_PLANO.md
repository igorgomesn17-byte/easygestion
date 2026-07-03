# 🚀 Phase 1 — Preparar Go-Live (1-2 semanas)

**Objetivo:** Validar que o sistema é estável em produção antes de aceitar clientes reais.

---

## ✅ Checklist Phase 1

### 1️⃣ Stripe Webhook (CRÍTICO — 30 min)

**Status:** ❌ Não configurado

**O que é:**
- Stripe envia notificações pra você quando algo acontece (pagamento aprovado, cancelamento, etc)
- Sem isso, sistema não sabe quando cliente pagou

**Como configurar:**

1. Ir em: https://dashboard.stripe.com/webhooks
2. Clicar em "Add endpoint"
3. URL do webhook: `https://easygestion.com.br/api/webhooks/stripe` (usar seu domínio)
4. Selecionar eventos:
   - `invoice.payment_succeeded`
   - `invoice.payment_failed`
   - `customer.subscription.updated`
   - `customer.subscription.deleted`
5. Copiar o "Signing Secret" (começa com `whsec_`)
6. Colar em `.env` → `STRIPE_WEBHOOK_SECRET=whsec_...`
7. Deploy

**Teste rápido após configurar:**
```bash
curl https://easygestion.com.br/api/webhooks/stripe \
  -H "stripe-signature: xxx" \
  -d '{"type":"invoice.payment_succeeded"}'
# Deve retornar 200
```

**Impacto se não fizer:** Cliente paga, Stripe aprova, mas sua app não sabe → acesso bloqueado mesmo pagando ❌

---

### 2️⃣ Testar Fluxo Completo (trial → checkout → pago)

**Status:** ⚠️ Parcial (falta teste em produção)

**Roteiro:**

a) **Trial (30 dias)**
   - [ ] Ir em `/registro.html` → criar conta
   - [ ] Logar
   - [ ] Verificar que acesso funciona (PDV, estoque, clientes)
   - [ ] Conferir no banco: `SELECT status, trial_ate FROM tenants WHERE email='seu-email'`
   - [ ] Esperado: `status='trial', trial_ate=hoje+30dias`

b) **Checkout (dia 31)**
   - [ ] Avançar a data do trial pra hoje (hacky, mas valida)
   - [ ] Logar → deve redirecionar pra `/planos.html`
   - [ ] Clicar "Contratar agora"
   - [ ] Deve abrir Stripe checkout (cartão de teste: `4242 4242 4242 4242`, qualquer data futura, qualquer CVV)
   - [ ] Inserir cartão → clicar "Pay"

c) **Webhook (Stripe notifica você)**
   - [ ] Verificar logs: `pm2 logs easygestion | grep -i webhook`
   - [ ] Stripe deve ter enviado `invoice.payment_succeeded`
   - [ ] Seu sistema deve ter recebido e atualizado status

d) **Acesso Restaurado**
   - [ ] Logar novamente
   - [ ] PDV deve estar acessível (não bloqueado)
   - [ ] Verificar no banco: `SELECT status, data_proxima_renovacao FROM assinaturas WHERE tenant_id='...'`

**Tempo:** 20-30 min (teste manual)

**Impacto se falhar:** Clientes não conseguem convertir trial → pago 🚨

---

### 3️⃣ Teste de Carga (100 vendas/dia simultâneas)

**Status:** ❌ Não feito

**Por quê:**
- Quer ter certeza que se 2 clientes fazem venda ao mesmo tempo, não trava
- Quer saber se banco SQLite aguenta

**Como testar:**

**Opção A — Manual (rápido):**
```bash
# Terminal 1: começar a rodar vendas em loop
for i in {1..50}; do
  curl -X POST http://localhost:3001/api/vendas \
    -H "Content-Type: application/json" \
    -d '{"cliente_id":1,"itens":[{"produto_id":1,"quantidade":1,"preco":100}]}'
done
```

**Opção B — Load test profissional (melhor):**
```bash
npm install -g artillery
artillery quick --count 100 --num 10 http://localhost:3001/api/vendas
```

**O que observar:**
- Response time < 500ms pra 95% das requisições
- Nenhum erro 500
- Banco não corrupta

**Tempo:** 15-20 min

**Impacto se falhar:** Loja fica lenta/cai no horário de pico 🐢

---

### 4️⃣ Backup — Testar Restore de S3

**Status:** ⚠️ Parcial (backup funciona, restore não testado)

**O que verificar:**

a) **Backup tá funcionando?**
```bash
ssh ubuntu@54.232.77.5
tail -50 /opt/easygestion/pm2.log | grep -i backup
# Deve mostrar: "Backup enviado pra S3: dsstore-2026-07-02T20:30:00.db.enc"
```

b) **Listar backups no S3:**
```bash
aws s3 ls s3://easygestion-backups/ --profile default
```

c) **Testar restore** (em dev local):
```bash
# 1. Deletar banco local
rm db/dsstore.db

# 2. Baixar backup do S3
aws s3 cp s3://easygestion-backups/dsstore-2026-07-02T20:30:00.db.enc ./db/

# 3. Descriptografar
openssl enc -aes-256-cbc -d -in db/dsstore-2026-07-02T20:30:00.db.enc \
  -out db/dsstore.db -k $BACKUP_ENCRYPT_KEY

# 4. Iniciar app
npm start

# 5. Verificar dados (deve ter clientes, vendas, tudo igual)
sqlite3 db/dsstore.db "SELECT COUNT(*) FROM vendas;"
```

**Tempo:** 30 min

**Impacto se falhar:** Perde dados → startup acaba 💀

---

### 5️⃣ Monitorar Logs em Produção (erro patterns)

**Status:** ⚠️ Parcial (logs existem, monitoring manual)

**O que fazer:**

a) **Ver logs em tempo real:**
```bash
ssh ubuntu@54.232.77.5
pm2 logs easygestion --lines 100
# Procurar por: "ERROR", "CRITICAL", "ECONNREFUSED", "TIMEOUT"
```

b) **Configurar alerta automático** (pino logger):

Se houver erros recorrentes, configure email alert:

Editar `lib/logger.js`:
```javascript
if (level === 'error' || level === 'fatal') {
  // enviar email pra admin
  enviarEmail(ADMIN_EMAIL, 'Erro em produção', 'admin-alerta-erro', { erro: msg })
}
```

c) **Checklist de erros conhecidos:**
- ❌ `ENOENT db/dsstore.db` → Banco corrompeu/deletou
- ❌ `CORS blocked` → Origin não configurado corretamente
- ❌ `Cannot GET /api/...` → Rota não registrada
- ❌ `Stripe API Error 401` → Secret key expirou/trocou

**Tempo:** 15 min setup + monitoramento contínuo

**Impacto se ignorar:** Bugs silenciosos passam despercebidos 🦗

---

## 📋 Ordem Recomendada

1. **Stripe Webhook** (PRIMEIRO — sem isso nada funciona) — 30 min
2. **Testar Fluxo Completo** (validar pagamento) — 30 min
3. **Monitorar Logs** (detectar erros) — 15 min
4. **Teste de Carga** (preparar pra escala) — 20 min
5. **Backup Restore** (último — fundo de reserva) — 30 min

**Total:** ~2 horas de trabalho concentrado

---

## ✅ Definição de "Pronto para Clientes"

Você pode aceitar clientes reais quando:

- [ ] Stripe webhook respondendo corretamente
- [ ] Fez trial → checkout → pago → acesso restaurado (sem manualmente mexer)
- [ ] Teste de carga passou (0 crashes)
- [ ] Backup testado (conseguiu restaurar)
- [ ] Monitoramento ligado (recebe alerta de erro)

---

## 🚨 Se Algo Quebrar

| Problema | Diagnóstico | Fix |
|----------|-----------|-----|
| Cliente não consegue pagar | Checkout não abre | Verificar STRIPE_PUBLISHABLE_KEY em .env |
| Pagou mas acesso bloqueado | Webhook não dispara | Verificar STRIPE_WEBHOOK_SECRET correto + URL configurada no Stripe dashboard |
| Banco corrupta após teste | Versão SQLite incompatível | Fazer restore de S3 |
| Logs inundados de erro | Muitas requisições simultâneas | Aumentar rate limit em middleware/seguranca.js |

---

**Próxima fase:** Depois que Phase 1 passar, chamar 5-10 clientes reais pra testar (Phase 2).

