# 🔧 PLANO DE CORREÇÃO — PASSO A PASSO

**Objetivo:** Tornar EasyGestão vendável em 2 semanas  
**Status:** 🔴 3 bloqueadores críticos  
**Tempo Total Estimado:** 45 horas

---

## FASE 1: CRÍTICO (45 minutos) — HOJE

### 1.1 Ativar Rate Limit Admin [5 min]

**Problema:** `middleware/seguranca.js:204` tem rate limit admin como `() => next()` (noop)

**Solução:**
```javascript
// ANTES (linha 204):
const limiteAdminPassword = (req, res, next) => next();

// DEPOIS:
const limiteAdminPassword = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutos
  max: 6, // 6 tentativas
  keyGenerator: (req, res) => req.ip || req.connection.remoteAddress,
  handler: (req, res) => {
    res.status(429).json({ 
      erro: 'Muitas tentativas de login. Tente novamente em 15 minutos.' 
    });
  },
  skip: (req, res) => process.env.NODE_ENV !== 'production'
});
```

**Onde usar:**
```javascript
// routes/admin.js:12
app.post('/api/admin/login', limiteAdminPassword, async (req, res) => {
```

**Teste:**
```bash
for i in {1..7}; do curl -X POST http://localhost:3001/api/admin/login; done
# Esperado: resposta 429 na 7ª tentativa
```

---

### 1.2 Validar TOKEN_SECRET no Boot [10 min]

**Problema:** `routes/auth.js:12` tem fallback `'dev-secret'`

**Solução:**

Adicionar após linhas 49-50 em `server.js`:

```javascript
// ============================================================
// ✅ VALIDAÇÃO 2: Secrets de Produção
// ============================================================
const SECRETS_OBRIGATORIOS = ['TOKEN_SECRET', 'CERT_CIPHER_KEY', 'DEPLOY_TOKEN'];

SECRETS_OBRIGATORIOS.forEach(secret => {
  if (EM_PRODUCAO && !process.env[secret]) {
    console.error(`
❌ ERRO CRÍTICO: Secret não configurado!

Faltando variável de ambiente: ${secret}

Em produção, TODOS os secrets abaixo são obrigatórios:
  • TOKEN_SECRET (mínimo 32 caracteres aleatórios)
  • CERT_CIPHER_KEY (mínimo 32 caracteres aleatórios)
  • DEPLOY_TOKEN (token secreto para webhook de deploy)

Gere com:
  node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"

Adicione ao .env em produção.
    `);
    process.exit(1);
  }
});
```

**Remover fallback:**

Em `routes/auth.js:12`:
```javascript
// ANTES:
const TOKEN_SECRET = process.env.TOKEN_SECRET || 'dev-secret';

// DEPOIS:
const TOKEN_SECRET = process.env.TOKEN_SECRET;
if (!TOKEN_SECRET && process.env.NODE_ENV === 'production') {
  throw new Error('TOKEN_SECRET não configurado em produção');
}
```

**Teste:**
```bash
# Remova TOKEN_SECRET do .env
NODE_ENV=production npm start
# Esperado: erro "TOKEN_SECRET não configurado"
```

---

### 1.3 Validar CERT_CIPHER_KEY no Boot [10 min]

**Problema:** `routes/config.js:93` tem fallback inseguro

**Solução:**

Em `routes/config.js:93`:
```javascript
// ANTES:
const CERT_CIPHER = process.env.CERT_CIPHER_KEY || 'change-this-secret-key-in-env';

// DEPOIS:
const CERT_CIPHER = process.env.CERT_CIPHER_KEY;
if (!CERT_CIPHER && process.env.NODE_ENV === 'production') {
  throw new Error('CERT_CIPHER_KEY não configurado em produção');
}
```

Remover também em `server.js` boot validation (será feito em bloco anterior).

---

### 1.4 Validar DEPLOY_TOKEN no Boot [10 min]

**Problema:** `routes/deploy.js:8` tem fallback `'seu-token-secreto-aqui'`

**Solução:**

Em `routes/deploy.js:8`:
```javascript
// ANTES:
const secretToken = process.env.DEPLOY_TOKEN || 'seu-token-secreto-aqui';

// DEPOIS:
const secretToken = process.env.DEPLOY_TOKEN;
if (!secretToken && process.env.NODE_ENV === 'production') {
  throw new Error('DEPLOY_TOKEN não configurado em produção');
}
```

---

### 1.5 Verificar Credenciais AWS Rotacionadas [10 min]

**Ação:** 
1. Verificar memory: `[🔐 Incidente AWS 2026-06-23](security-incident-aws-2026-06-23.md)`
2. Confirmar que credenciais foram rotacionadas
3. Se não, rotacionar AGORA:
   - AWS_ACCESS_KEY_ID novo
   - AWS_SECRET_ACCESS_KEY novo
   - SENDGRID_API_KEY novo
   - STRIPE_SECRET_KEY novo

**Teste:**
```bash
# Verificar que velhas keys não funcionam
aws s3 ls --profile old_key
# Esperado: erro "Invalid credentials"
```

---

## FASE 2: ALTO (3 horas) — PRÓXIMOS 3 DIAS

### 2.1 Validar CORS ORIGIN no Boot [10 min]

**Problema:** `server.js:86` não valida ORIGIN em produção

**Solução:**

Em `server.js:86-91`:
```javascript
// ANTES:
const ORIGIN = process.env.ORIGIN || (EM_PRODUCAO ? false : 'http://localhost:3000');
if (!ORIGIN && EM_PRODUCAO) {
  console.error('❌ ERRO: ORIGIN deve estar configurado em produção!');
  process.exit(1);
}

// DEPOIS:
const ORIGIN = process.env.ORIGIN || (EM_PRODUCAO ? false : 'http://localhost:3000');
if (!ORIGIN) {
  if (EM_PRODUCAO) {
    console.error(`
❌ ERRO CRÍTICO: ORIGIN não configurado!

Em produção, ORIGIN é obrigatório para CORS funcionar.

Adicione ao .env:
  ORIGIN=https://oficialdsstore.com.br
  (sem barra final)
    `);
    process.exit(1);
  }
}
```

---

### 2.2 Forçar NODE_ENV = production [5 min]

**Problema:** NODE_ENV pode estar 'development' mesmo em produção

**Solução:**

Em `.env` de produção:
```bash
NODE_ENV=production
```

Verificar em `server.js:30`:
```javascript
const EM_PRODUCAO = process.env.NODE_ENV === 'production';
console.log(`🚀 Iniciando EasyGestão em modo ${EM_PRODUCAO ? 'PRODUÇÃO' : 'DESENVOLVIMENTO'}...`);
```

**Teste:**
```bash
NODE_ENV=production npm start 2>&1 | grep PRODUÇÃO
# Esperado: "🚀 Iniciando EasyGestão em modo PRODUÇÃO"
```

---

### 2.3 Validar Desconto Máximo 100% [1 hora]

**Problema:** `routes/vendas.js` não valida desconto > 100%

**Solução:**

Em `routes/vendas.js` (onde cria venda, linha ~80):
```javascript
// Validar desconto antes de processar
const desconto = parseFloat(req.body.desconto || 0);
if (desconto < 0 || desconto > subtotal) {
  return res.status(400).json({ 
    erro: 'Desconto deve ser entre 0 e o valor total da venda' 
  });
}

// Validar acréscimo (parcelamento)
const acrescimo = parseFloat(req.body.acrescimo || 0);
if (acrescimo < 0) {
  return res.status(400).json({ 
    erro: 'Acréscimo não pode ser negativo' 
  });
}
```

**Teste:**
```bash
# Tentar desconto de 200% em venda de 100
curl -X POST http://localhost:3001/api/vendas \
  -H "Content-Type: application/json" \
  -d '{
    "desconto": 200,
    "items": [{"produto_id": 1, "qtd": 1, "preco": 100}]
  }'
# Esperado: erro "Desconto deve ser entre 0 e..."
```

---

### 2.4 Validar Quantidade Positiva [1 hora]

**Problema:** `routes/estoque.js` não valida qtd negativa

**Solução:**

Em `routes/estoque.js` (linhas ~60):
```javascript
// Validar quantidade
const quantidade = parseInt(req.body.quantidade, 10);
if (isNaN(quantidade) || quantidade <= 0) {
  return res.status(400).json({ 
    erro: 'Quantidade deve ser um número positivo' 
  });
}
```

Adicionar também em:
- `routes/vendas.js` (qtd de item)
- `routes/estoque.js` (ajuste, entrada)
- `routes/trocas.js` (qtd trocada)

---

### 2.5 Removar Logger Console.log em Produção [1 hora]

**Problema:** 39 arquivos usam console.log (expõe IPs, emails, operações)

**Solução Rápida:**

Substituir console.log por logger:
```javascript
// NO TOPO DE CADA ARQUIVO:
const logger = {
  debug: (msg) => process.env.NODE_ENV !== 'production' && console.log('[DEBUG]', msg),
  info: (msg) => console.log('[INFO]', msg),
  warn: (msg) => console.warn('[WARN]', msg),
  error: (msg, err) => console.error('[ERROR]', msg, err?.message || err),
};

// SUBSTITUIR:
// console.log('User logged in:', email) 
// → logger.info('User logged in');

// console.error('DB error:', err)
// → logger.error('DB error:', err);
```

Criar `lib/logger.js`:
```javascript
module.exports = {
  debug: (msg) => process.env.NODE_ENV !== 'production' && console.log('[DEBUG]', msg),
  info: (msg) => console.log('[INFO]', msg),
  warn: (msg) => console.warn('[WARN]', msg),
  error: (msg, err) => console.error('[ERROR]', msg, err?.message || err),
};
```

**Script para substituição:**
```bash
# Em lib/ e routes/ e middleware/:
sed -i "s/console.log(/logger.info(/g" *.js
sed -i "s/console.error(/logger.error(/g" *.js
sed -i "1i const logger = require('../lib/logger');" *.js
```

---

## FASE 3: MÉDIO (10 horas) — PRÓXIMAS 2 SEMANAS

### 3.1 Adicionar Email de Cliente [2 horas]

**Problema:** Cliente não tem email, password reset é impossível

**Solução:**

1. **Schema Migration:**
```sql
-- scripts/migrations/001-add-email-clientes.sql
ALTER TABLE clientes ADD COLUMN email TEXT UNIQUE;
ALTER TABLE clientes ADD COLUMN email_verificado INTEGER DEFAULT 0;
CREATE INDEX idx_clientes_email ON clientes(email);
```

2. **Executar migration:**
```bash
node scripts/executar-migracao.js
```

3. **Atualizar routes/clientes.js:**
```javascript
// POST /api/clientes (criar)
const email = req.body.email?.trim().toLowerCase();
if (email && !validarEmail(email)) {
  return res.status(400).json({ erro: 'Email inválido' });
}

db.prepare('INSERT INTO clientes (..., email) VALUES (..., ?)').run(..., email);
```

4. **Adicionar email verification:**
```javascript
// POST /api/clientes/:id/verificar-email
// - Envia email com token
// - PUT /api/clientes/:id/email-verificado (verifica token)
```

---

### 3.2 Implementar Imposto Dinamicamente [3 horas]

**Problema:** Imposto é hardcoded 17%

**Solução:**

1. **Criar tabela de impostos:**
```sql
CREATE TABLE IF NOT EXISTS impostos (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  tenant_id INTEGER NOT NULL,
  estado TEXT NOT NULL,
  categoria TEXT NOT NULL,
  icms_pct REAL NOT NULL DEFAULT 0,
  ipi_pct REAL NOT NULL DEFAULT 0,
  pis_pct REAL NOT NULL DEFAULT 0,
  cofins_pct REAL NOT NULL DEFAULT 0,
  criado_em TEXT DEFAULT (datetime('now','localtime')),
  UNIQUE(tenant_id, estado, categoria)
);
```

2. **Carregar imposto ao vender:**
```javascript
// routes/vendas.js
const estado = req.body.estado || config.estado_padrao;
const categoria = produto.categoria;
const imposto = db.prepare(
  'SELECT * FROM impostos WHERE tenant_id = ? AND estado = ? AND categoria = ?'
).get(req.tenantId, estado, categoria);

const taxa_imposto = (imposto?.icms_pct || 17) / 100;
const imposto_total = subtotal * taxa_imposto;
```

3. **Admin config de impostos:**
```javascript
// routes/config.js
// GET /api/config/impostos - lista impostos do tenant
// POST /api/config/impostos - atualiza imposto
```

---

### 3.3 Adicionar Validação CPF/CNPJ [30 min]

**Problema:** Sem validação CPF/CNPJ

**Solução:**

1. **Instalar lib:**
```bash
npm install cpf-cnpj-validator
```

2. **Usar em routes/clientes.js:**
```javascript
const { cpf, cnpj } = require('cpf-cnpj-validator');

const cpf_cliente = req.body.cpf;
if (cpf_cliente && !cpf.isValid(cpf_cliente)) {
  return res.status(400).json({ erro: 'CPF inválido' });
}
```

---

### 3.4 Limite de Tamanho de Upload [30 min]

**Problema:** Sem limite de tamanho de imagem

**Solução:**

Em `routes/produtos.js` (upload):
```javascript
const MAX_UPLOAD_SIZE = 2 * 1024 * 1024; // 2MB

if (req.body.foto) {
  const buffer = Buffer.from(req.body.foto, 'base64');
  if (buffer.length > MAX_UPLOAD_SIZE) {
    return res.status(413).json({ 
      erro: 'Imagem muito grande (máximo 2MB)' 
    });
  }
}
```

---

### 3.5 Remover CSP 'unsafe-inline' [30 min]

**Problema:** CSP contém `'unsafe-inline'`

**Solução:**

Em `server.js:64`:
```javascript
// ANTES:
scriptSrc: ["'self'", "'unsafe-inline'"],

// DEPOIS:
scriptSrc: ["'self'"], // Remover inline scripts
```

Se o sistema precisa de scripts inline, usar nonce:
```javascript
// server.js (gerar nonce por requisição)
app.use((req, res, next) => {
  const crypto = require('crypto');
  res.locals.nonce = crypto.randomBytes(16).toString('hex');
  next();
});

// CSP com nonce
scriptSrc: [`'nonce-${res.locals.nonce}'`],
```

---

## FASE 4: TESTES & ESCALA (20 horas) — SEMANAS 3-4

### 4.1 Testar UX com Usuário Real [8 horas]

**Objetivo:** Validar que o sistema é utilizável

**Protocolo:**
1. Receber uma lojista voluntária (de preferência similar ao avatar)
2. Dar acesso à aplicação (ambiente de teste)
3. Pedir que faça:
   - Login
   - Cadastro de 5 produtos
   - Cadastro de 3 clientes
   - Realizar 1 venda completa
   - Fechar caixa do dia
   - Gerar DRE
4. Observar:
   - Aonde ela fica confusa?
   - Qual fluxo é lento?
   - Quais mensagens não entende?
5. Coletar feedback
6. Iteração rápida (bug fixes)

---

### 4.2 Teste de Carga [4 horas]

**Objetivo:** Validar que sistema aguenta 10 lojas simultâneas

```bash
# Simular 10 lojas fazendo operações
npm install autocannon # ou k6

# Test script (k6)
import http from 'k6/http';
import { check } from 'k6';

export let options = {
  stages: [
    { duration: '1m', target: 10 },   // 10 lojas
    { duration: '5m', target: 10 },   // Manter 5min
    { duration: '1m', target: 0 },    // Ramp down
  ],
};

export default function () {
  let res = http.get('http://localhost:3001/api/financeiro/dre');
  check(res, { 'status is 200': (r) => r.status === 200 });
}

# Rodar:
k6 run test.js
```

---

### 4.3 Migrar SQLite → PostgreSQL [8 horas]

**Objetivo:** Preparar para escala 100+ lojas

**Plano:**
1. Instalar PostgreSQL
2. Criar schema equivalente em PostgreSQL
3. Script de migração de dados
4. Atualizar `lib/database.js` para usar PostgreSQL
5. Testar com os testes existentes
6. Deploy em staging

**Timeline:**
- Dia 1: Schema PostgreSQL + migração scripts
- Dia 2: Atualizar código + testes
- Dia 3: Staging + testes de escala

---

## CHECKLIST DE DEPLOY FINAL

### Segurança
- [ ] Rate limit admin ativado
- [ ] NODE_ENV = production
- [ ] TOKEN_SECRET configurado + não exposto
- [ ] CERT_CIPHER_KEY configurado + não exposto
- [ ] DEPLOY_TOKEN configurado + não exposto
- [ ] ORIGIN configurado
- [ ] .env não é público
- [ ] HTTPS obrigatório
- [ ] Backups diários testados

### Funcionalidade
- [ ] Validação ranges (desconto, qtd)
- [ ] Email de cliente capturado
- [ ] Imposto calculado corretamente
- [ ] Nenhum console.log em produção
- [ ] CPF/CNPJ validado
- [ ] Limite tamanho upload
- [ ] Todas features P0+P1 implementadas

### Performance
- [ ] Dashboard < 1s
- [ ] DRE com 1000 vendas < 2s
- [ ] Teste de carga passou (10 lojas)
- [ ] Cache de relatórios funciona
- [ ] DB indexes criados

### Operacional
- [ ] Logger estruturado implementado
- [ ] Alertas de erro configurados
- [ ] Monitoramento ativo
- [ ] Plano de disaster recovery
- [ ] Documentação de suporte

### Produto
- [ ] UX testada com usuário real
- [ ] Feedback loop implementado
- [ ] Mensagens de erro são amigáveis
- [ ] Onboarding funciona

---

## ESTIMATIVA FINAL

| Fase | Tarefas | Horas | Timeline |
|------|---------|-------|----------|
| 1. CRÍTICO | 5 tarefas | 0.75h | Hoje |
| 2. ALTO | 5 tarefas | 3.5h | Próximos 3 dias |
| 3. MÉDIO | 5 tarefas | 10h | Próximas 2 semanas |
| 4. ESCALA | Testes + migração | 20h | Semanas 3-4 |
| **TOTAL** | | **34h** | **4 semanas** |

**Com 1 dev full-time: 1 semana**  
**Com 2 devs: 5 dias**

---

## ORDEM RECOMENDADA DE EXECUÇÃO

### Dia 1 (2h)
- [ ] Fase 1: Crítico (45 min)
- [ ] Fase 2.1-2.2: Boot validation + ORIGIN (20 min)
- [ ] Teste com credenciais (5 min)
- [ ] Atualizar .env de produção (10 min)
- [ ] Deploy em staging (30 min)

### Dias 2-3 (5h)
- [ ] Fase 2.3-2.5: Validações + logger (3h)
- [ ] Teste de cada validação (1h)
- [ ] Deploy em staging (1h)

### Semanas 2-3 (10h)
- [ ] Fase 3.1-3.5: Features (10h)
- [ ] Testes + bug fixes (4h)

### Semanas 3-4 (20h)
- [ ] Fase 4: Testes reais + escala (20h)

---

**Próximo Passo:** Iniciar Fase 1 agora mesmo. São apenas 45 minutos.

