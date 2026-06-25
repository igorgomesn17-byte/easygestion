# 🧪 QA HANDOFF — EASYGESTION PRÉ-DEPLOY

**Data:** 2026-06-24  
**Commit:** `98bd34f` — 🔒 FASE 4: Auditoria Crítica — 6 Fixes Pré-Deploy (LGPD + Encryption)  
**Responsável Dev:** Igor (Claude Code)  
**Status:** ✅ Pronto para QA  

---

## 📋 O QUE FOI ENTREGUE

Implementação de 6 tarefas críticas da auditoria 2026-06-23:

| # | Descrição | Arquivo(s) | Prioridade |
|---|-----------|-----------|-----------|
| 1 | Schema com colunas faltantes | `db/schema.sql`, `db/database.js` | 🔴 CRÍTICO |
| 2 | Criptografia AES-256-CBC | `scripts/backup-s3.js` | 🔴 CRÍTICO |
| 3 | Health check endpoint | `server.js` | 🟠 ALTO |
| 4 | DELETE conta (LGPD grace period) | `routes/auth.js` | 🔴 CRÍTICO |
| 5 | Webhook `customer.updated` | `lib/stripe.js` | 🟠 ALTO |
| 6 | .env.example corrigido | `.env.example` | 🟡 MÉDIO |

---

## 🧪 FASE 1: TESTES MANUAIS (Hoje - 2h)

### ✅ TAREFA 1 — Validar Schema

**O quê testar:**
- Banco novo criado com todas as colunas
- Banco existente recebe as colunas via migração

**Como fazer:**

```bash
# 1. Remover banco existente
rm db/dsstore.db db/dsstore.db-shm db/dsstore.db-wal 2>/dev/null || true

# 2. Iniciar servidor (cria banco novo)
node server.js

# 3. Verificar colunas (abrir outro terminal)
node -e "
const {db} = require('./db/database');
const cols = db.prepare('PRAGMA table_info(assinaturas)').all().map(c => c.name);
console.log('✓ Colunas assinaturas:', cols);
console.log('✓ Tem em_teste?', cols.includes('em_teste') ? 'SIM' : 'NÃO');
console.log('✓ Tem cartao_salvo?', cols.includes('cartao_salvo') ? 'SIM' : 'NÃO');
console.log('✓ Tem stripe_subscription_id?', cols.includes('stripe_subscription_id') ? 'SIM' : 'NÃO');

const cols2 = db.prepare('PRAGMA table_info(tenants)').all().map(c => c.name);
console.log('✓ Colunas tenants:', cols2);
console.log('✓ Tem stripe_customer_id?', cols2.includes('stripe_customer_id') ? 'SIM' : 'NÃO');
"
```

**✅ Passou se:**
- Sem erros de coluna faltante
- Todas as 6 colunas presentes

---

### ✅ TAREFA 2 — Testar Criptografia de Backup

**O quê testar:**
- Backup é gerado com extensão `.db.enc`
- Arquivo é ilegível (criptografado)
- Restore consegue descriptografar

**Como fazer:**

```bash
# 1. Configurar chave no .env
BACKUP_ENCRYPT_KEY=$(node -e "console.log(require('crypto').randomBytes(32).toString('hex'))")
echo "BACKUP_ENCRYPT_KEY=$BACKUP_ENCRYPT_KEY" >> .env

# 2. Rodar backup manualmente
npm run backup-s3 2>&1 | tee backup.log

# 3. Verificar no S3
# Verificar que arquivo é .db.enc (não .db)
# Verificar que arquivo é ilegível (binary, não SQLite magic bytes)
```

**✅ Passou se:**
- Log mostra: "🔐 Criptografando com AES-256-CBC..."
- Arquivo S3 tem extensão `.db.enc`
- Arquivo não começa com "SQLite format 3" (magic bytes)
- Metadata do S3 contém: `cipher: aes-256-cbc`, `kdf: pbkdf2`

---

### ✅ TAREFA 3 — Testar Health Check

**O quê testar:**
- Endpoint `/health` retorna 200
- Não precisa estar logado
- Contém `status`, `ts`, `uptime`

**Como fazer:**

```bash
# Servidor rodando em localhost:3000
curl http://localhost:3000/health

# Esperado:
# {"status":"ok","ts":"2026-06-24T10:30:45.123Z","uptime":125.456}
```

**✅ Passou se:**
- Status 200 OK
- JSON válido com os 3 campos

---

### ✅ TAREFA 4 — Testar DELETE /api/me/conta (LGPD Grace Period)

**O quê testar:**
- Cliente consegue solicitar deleção
- Deleção é agendada (não imediata)
- Status do tenant muda para 'cancelado'
- Entrada em `delecoes_agendadas` é criada com data correta

**Como fazer:**

```bash
# 1. Registrar cliente teste
curl -X POST http://localhost:3000/api/registro \
  -H "Content-Type: application/json" \
  -d '{
    "email": "teste-delete@lgpd.test",
    "senha": "SenhaForte123***REMOVED***@#",
    "nome_loja": "Loja Teste Delete",
    "nome_responsavel": "João",
    "telefone": "11999999999"
  }'
# Vai retornar tenant_id (ex: 2)

# 2. Login como esse cliente
curl -X POST http://localhost:3000/api/login \
  -H "Content-Type: application/json" \
  -d '{
    "email": "teste-delete@lgpd.test",
    "senha": "SenhaForte123***REMOVED***@#"
  }' \
  -c cookies.txt

# 3. Solicitar deleção de conta
curl -X DELETE http://localhost:3000/api/me/conta \
  -H "Content-Type: application/json" \
  -b cookies.txt \
  -d '{"senha": "SenhaForte123***REMOVED***@#"}'

# Esperado:
# {"ok":true,"mensagem":"Deleção agendada para 30 dias...","agendado_para":"2026-07-24T..."}

# 4. Verificar no banco
node -e "
const {db} = require('./db/database');
const tenant = db.prepare('SELECT status FROM tenants WHERE email = ?').get('teste-delete@lgpd.test');
console.log('Status tenant:', tenant.status); // 'cancelado'

const delecao = db.prepare('SELECT agendado_para FROM delecoes_agendadas WHERE tenant_id = (SELECT id FROM tenants WHERE email = ?)').get('teste-delete@lgpd.test');
console.log('Agendado para:', delecao.agendado_para); // aprox 30 dias no futuro
"

# 5. Tentar fazer login com a conta (deve falhar)
curl -X POST http://localhost:3000/api/login \
  -H "Content-Type: application/json" \
  -d '{
    "email": "teste-delete@lgpd.test",
    "senha": "SenhaForte123***REMOVED***@#"
  }'
# Esperado: erro (conta cancelada)
```

**✅ Passou se:**
- Response da deleção contém `agendado_para`
- Status do tenant é `'cancelado'`
- Entrada em `delecoes_agendadas` existe
- Login falha após deleção

---

### ✅ TAREFA 5 — Testar Webhook customer.updated

**O quê testar:**
- Webhook disparado quando cliente adiciona cartão no Stripe Portal
- Campo `cartao_salvo` muda para 1

**Como fazer:**

```bash
# 1. Simular webhook (em dev, sem verificar assinatura)
# Nota: Em produção, use stripe CLI (stripe listen --forward-to localhost:3000/api/webhooks/stripe)

curl -X POST http://localhost:3000/api/webhooks/stripe \
  -H "Content-Type: application/json" \
  -d '{
    "type": "customer.updated",
    "data": {
      "object": {
        "id": "cus_test123",
        "invoice_settings": {
          "default_payment_method": "pm_card_visa"
        }
      }
    }
  }'

# 2. Verificar no banco
node -e "
const {db} = require('./db/database');
const assinatura = db.prepare('SELECT cartao_salvo FROM assinaturas WHERE tenant_id = (SELECT id FROM tenants WHERE stripe_customer_id = ?)').get('cus_test123');
console.log('cartao_salvo:', assinatura.cartao_salvo); // deve ser 1
"
```

**✅ Passou se:**
- Log mostra: "💳 [Webhook] Cartão salvo para tenant..."
- Campo `cartao_salvo` é 1

---

## 🧪 FASE 2: LOAD TESTING (Dia 2 - 2h)

### Simular 50 clientes simultâneos

```bash
# Usar ferramenta: k6 ou Apache JMeter
# Teste: 50 req/seg por 10 minutos

# Endpoints críticos:
# - POST /api/registro
# - POST /api/login
# - GET /api/me/dados
# - DELETE /api/me/conta
# - GET /health

# Métricas esperadas:
# - CPU: < 70%
# - Memory: < 80%
# - DB connections: < 50
# - Latência média: < 2s
# - P99: < 5s
# - Sem erro 500
```

---

## 🧪 FASE 3: SECURITY REVIEW (Dia 3 - 2h)

### Checklist de Segurança

- [ ] Senhas de teste NÃO estão em logs
- [ ] `BACKUP_ENCRYPT_KEY` NÃO aparece em console.log()
- [ ] SQL injection: prepared statements em todos os lugares
- [ ] CORS: restrito a ORIGIN
- [ ] Rate limit: 100 req/15min ativo
- [ ] Headers de segurança: Helmet ativo
- [ ] HTTPS em produção: `secure: true` no cookie
- [ ] Session secret: 32+ chars aleatório

**Como verificar:**

```bash
# 1. Verificar logs
grep -r "senha\|password\|key\|secret" server.js lib/ routes/ 2>/dev/null | grep -v ".test\|exemplo\|#" || echo "✓ Sem secrets em logs"

# 2. Testar CORS
curl -H "Origin: http://evil.com" http://localhost:3000/api/me
# Esperado: erro CORS (sem ORIGIN válida)

# 3. Verificar rate limit
for i in {1..150}; do curl -s http://localhost:3000/health > /dev/null; done
# Esperado: após 100 requests em 15min, 429 Too Many Requests
```

---

## 📊 CHECKLIST FINAL (QA)

### Antes de aprovar para Staging:

- [ ] **TAREFA 1:** Schema validado (todas colunas presentes)
- [ ] **TAREFA 2:** Backup criptografado (.db.enc, ilegível)
- [ ] **TAREFA 3:** Health check retorna 200 OK
- [ ] **TAREFA 4:** DELETE conta agenda deleção em 30 dias
- [ ] **TAREFA 5:** Webhook customer.updated sincroniza cartao_salvo
- [ ] **TAREFA 6:** .env.example tem variáveis corretas

### Testes de Regressão:

- [ ] Login ainda funciona
- [ ] Pagamentos Stripe ainda funcionam
- [ ] Cobrança automática ainda funciona
- [ ] Bloqueio por atraso ainda funciona
- [ ] Backup diário ainda funciona
- [ ] Webhooks ainda recebem eventos
- [ ] Nenhum erro 500 em logs

### Performance:

- [ ] Latência média < 2s
- [ ] CPU < 70% sob carga
- [ ] Memory < 80%
- [ ] Sem memory leak (uptime > 1h sem crescimento)

---

## 📞 BLOQUEADORES

Se algum teste falhar, **bloqueador = não passa para Staging.**

| Teste | Bloqueador? | Ação |
|-------|------------|------|
| Schema faltando coluna | 🔴 SIM | Volta pro dev |
| Backup não criptografado | 🔴 SIM | Volta pro dev |
| Health check falha | 🟠 NÃO (pode seguir, fix rápido) | Escalona |
| LGPD grace period não funciona | 🔴 SIM | Volta pro dev |
| Webhook não sincroniza | 🟠 NÃO (pode ser integração) | Nota e segue |

---

## 📝 OBSERVAÇÕES DO DEV

**Notas para o QA:**

1. **Criptografia é novo:** Se backup falhar, pode ser falta de `BACKUP_ENCRYPT_KEY` no `.env`. Sem ela, sistema avisa mas envia sem criptografia (dev mode).

2. **Webhook signature:** Em dev, webhook não valida assinatura HMAC. Em produção, só aceita se assinado pelo Stripe.

3. **Grace period:** 30 dias é fixo. Não é configurável por tenant.

4. **Tenant status:** Quando deleção é solicitada, `status = 'cancelado'` **imediatamente**. Acesso é bloqueado no dia 0, não no dia 30.

5. **Reversível:** Cliente pode cancelar deleção nos 30 dias (endpoint a implementar, não está neste commit).

---

## ✅ PRÓXIMO PASSO

Quando **TODOS os testes da FASE 1 passarem**, QA aprova e passa para **FASE 2: Staging Deploy** (Dia 4).

**Timeline esperada:**
- Dia 1 (hoje): Testes manuais + load testing
- Dia 2: Security review
- Dia 3: Staging deploy
- Dia 4: Production deploy gradual

---

**Boa sorte***REMOVED*** 🚀**

Qualquer dúvida, me chama (Claude Code está aqui).
