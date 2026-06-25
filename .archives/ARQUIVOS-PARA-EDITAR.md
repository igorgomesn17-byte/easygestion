# 📝 ARQUIVOS PARA EDITAR — CRÍTICO

Esta lista serve para que você invoque Claude Code para corrigir os problemas críticos em ordem.

---

## FASE 1: CRÍTICO (45 MIN)

### 1.1 middleware/seguranca.js [5 min]

**Linha 204 — Rate Limit Admin**

ANTES:
```javascript
const limiteAdminPassword = (req, res, next) => next();
```

DEPOIS:
```javascript
const limiteAdminPassword = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 6,
  keyGenerator: (req, res) => req.ip || req.connection.remoteAddress,
  handler: (req, res) => {
    res.status(429).json({ erro: 'Muitas tentativas. Tente novamente em 15 minutos.' });
  },
  skip: (req, res) => process.env.NODE_ENV !== 'production'
});
```

---

### 1.2 server.js [10 min]

**Linhas 49-51 — Adicionar Validação de Secrets**

DEPOIS DA LINHA 50:
```javascript
// ============================================================
// ✅ VALIDAÇÃO 2: Secrets de Produção
// ============================================================
const SECRETS_OBRIGATORIOS = ['TOKEN_SECRET', 'CERT_CIPHER_KEY', 'DEPLOY_TOKEN'];

SECRETS_OBRIGATORIOS.forEach(secret => {
  if (EM_PRODUCAO && !process.env[secret]) {
    console.error(`
❌ ERRO CRÍTICO: Secret não configurado!

Faltando: ${secret}

Em produção, configure no .env:
  ${secret}=<valor aleatório 32+ chars>

Gere com:
  node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
    `);
    process.exit(1);
  }
});

// ORIGIN também é obrigatório
if (EM_PRODUCAO && !process.env.ORIGIN) {
  console.error(`
❌ ERRO CRÍTICO: ORIGIN não configurado!

Configure no .env:
  ORIGIN=https://seu-dominio.com.br
    `);
  process.exit(1);
}
```

---

### 1.3 routes/auth.js [10 min]

**Linha 12 — Remover Fallback TOKEN_SECRET**

ANTES:
```javascript
const TOKEN_SECRET = process.env.TOKEN_SECRET || 'dev-secret';
```

DEPOIS:
```javascript
const TOKEN_SECRET = process.env.TOKEN_SECRET;
if (!TOKEN_SECRET && process.env.NODE_ENV === 'production') {
  throw new Error('TOKEN_SECRET não configurado em produção');
}
```

---

### 1.4 routes/config.js [10 min]

**Linha 93 — Remover Fallback CERT_CIPHER_KEY**

ANTES:
```javascript
const CERT_CIPHER = process.env.CERT_CIPHER_KEY || 'change-this-secret-key-in-env';
```

DEPOIS:
```javascript
const CERT_CIPHER = process.env.CERT_CIPHER_KEY;
if (!CERT_CIPHER && process.env.NODE_ENV === 'production') {
  throw new Error('CERT_CIPHER_KEY não configurado em produção');
}
```

---

### 1.5 routes/deploy.js [10 min]

**Linha 8 — Remover Fallback DEPLOY_TOKEN**

ANTES:
```javascript
const secretToken = process.env.DEPLOY_TOKEN || 'seu-token-secreto-aqui';
```

DEPOIS:
```javascript
const secretToken = process.env.DEPLOY_TOKEN;
if (!secretToken && process.env.NODE_ENV === 'production') {
  throw new Error('DEPLOY_TOKEN não configurado em produção');
}
```

---

## FASE 2: ALTO (3 HORAS)

### 2.1 routes/vendas.js [1h]

**Linha ~80 — Adicionar Validação de Desconto**

ADICIONAR ANTES DE PROCESSAR VENDA:
```javascript
// Validar desconto
const desconto = parseFloat(req.body.desconto || 0);
const subtotal = calcularSubtotal(req.body.itens);

if (isNaN(desconto) || desconto < 0 || desconto > subtotal) {
  return res.status(400).json({ 
    erro: 'Desconto deve estar entre 0 e R$ ' + subtotal.toFixed(2) 
  });
}

// Validar acréscimo
const acrescimo = parseFloat(req.body.acrescimo || 0);
if (isNaN(acrescimo) || acrescimo < 0) {
  return res.status(400).json({ 
    erro: 'Acréscimo não pode ser negativo' 
  });
}
```

---

### 2.2 routes/estoque.js [1h]

**Linha ~60 — Adicionar Validação de Quantidade**

ADICIONAR EM TODOS OS ENDPOINTS ESTOQUE:
```javascript
// Validar quantidade
const quantidade = parseInt(req.body.quantidade, 10);
if (isNaN(quantidade) || quantidade <= 0) {
  return res.status(400).json({ 
    erro: 'Quantidade deve ser um número positivo' 
  });
}
```

---

### 2.3 routes/produtos.js [1h]

**Linha ~31 — Adicionar Limite de Upload**

ADICIONAR NO POST /api/produtos (upload):
```javascript
const MAX_UPLOAD_SIZE = 2 * 1024 * 1024; // 2MB
const ALLOWED_TYPES = ['image/jpeg', 'image/png', 'image/webp'];

if (req.body.foto) {
  // Validar tipo
  const buffer = Buffer.from(req.body.foto.split(',')[1] || req.body.foto, 'base64');
  if (buffer.length > MAX_UPLOAD_SIZE) {
    return res.status(413).json({ 
      erro: 'Imagem muito grande (máximo 2MB)' 
    });
  }
}
```

---

## FASE 3: MÉDIO (10 HORAS)

### 3.1 .env [5 min]

**Adicionar/Atualizar em produção:**

```bash
# Segurança
NODE_ENV=production
SESSION_SECRET=<gere novo>
TOKEN_SECRET=<gere novo>
CERT_CIPHER_KEY=<gere novo>
DEPLOY_TOKEN=<gere novo>
ORIGIN=https://seu-dominio.com.br

# Validar também:
ADMIN_SENHA_HASH=<deve estar preenchido>
SENDGRID_API_KEY=<novo — rotacionado>
AWS_ACCESS_KEY_ID=<novo — rotacionado>
AWS_SECRET_ACCESS_KEY=<novo — rotacionado>
STRIPE_SECRET_KEY=<novo — rotacionado>
```

---

### 3.2 lib/logger.js [30 min]

**Criar arquivo novo — substituir console.log**

```javascript
// lib/logger.js
const isProd = process.env.NODE_ENV === 'production';

module.exports = {
  debug: (msg, extra) => {
    if (!isProd) {
      console.log('[DEBUG]', msg, extra || '');
    }
  },
  
  info: (msg, extra) => {
    console.log('[INFO]', msg, extra || '');
  },
  
  warn: (msg, extra) => {
    console.warn('[WARN]', msg, extra || '');
  },
  
  error: (msg, err) => {
    const errorMsg = err?.message || err || '';
    console.error('[ERROR]', msg, errorMsg);
  }
};
```

**Depois substituir em cada arquivo de routes/:**

ADICIONAR NO TOPO:
```javascript
const logger = require('../lib/logger');
```

SUBSTITUIR:
- `console.log()` → `logger.info()`
- `console.error()` → `logger.error()`
- `console.warn()` → `logger.warn()`

---

### 3.3 db/migrations/001-add-email-clientes.sql [30 min]

**Criar arquivo novo**

```sql
-- Add email field to clientes
ALTER TABLE clientes ADD COLUMN email TEXT UNIQUE;
ALTER TABLE clientes ADD COLUMN email_verificado INTEGER DEFAULT 0;
CREATE INDEX IF NOT EXISTS idx_clientes_email ON clientes(email);
```

**Depois criar script de execução:**

```javascript
// scripts/executar-migracao.js
const fs = require('fs');
const path = require('path');
const { db } = require('../lib/database');

const migracao = fs.readFileSync(
  path.join(__dirname, '../db/migrations/001-add-email-clientes.sql'),
  'utf-8'
);

try {
  db.exec(migracao);
  console.log('✅ Migração executada com sucesso');
} catch (err) {
  console.error('❌ Erro ao executar migração:', err.message);
  process.exit(1);
}
```

---

### 3.4 routes/clientes.js [1h]

**Adicionar email validation em POST/PUT:**

ADICIONAR:
```javascript
// Validar email
const email = req.body.email?.trim().toLowerCase();
if (email) {
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!emailRegex.test(email)) {
    return res.status(400).json({ erro: 'Email inválido' });
  }
  
  // Verificar duplicado
  const existe = db.prepare(
    'SELECT id FROM clientes WHERE email = ? AND id != ? AND tenant_id = ?'
  ).get(email, req.params.id || 0, req.tenantId);
  
  if (existe) {
    return res.status(400).json({ erro: 'Email já cadastrado' });
  }
}
```

---

### 3.5 server.js [30 min]

**Linha 64 — Remover 'unsafe-inline' de CSP**

ANTES:
```javascript
scriptSrc: ["'self'", "'unsafe-inline'"],
```

DEPOIS:
```javascript
scriptSrc: ["'self'"],
```

---

## PRIORIDADE DE EXECUÇÃO

**Dia 1 (2h):**
1. server.js (boot validation)
2. middleware/seguranca.js (rate limit)
3. routes/auth.js (TOKEN_SECRET)
4. routes/config.js (CERT_CIPHER)
5. routes/deploy.js (DEPLOY_TOKEN)
6. Atualizar .env em produção
7. Deploy + teste

**Dias 2-3 (5h):**
8. routes/vendas.js (validação desconto)
9. routes/estoque.js (validação qtd)
10. routes/produtos.js (limite upload)
11. server.js (remover unsafe-inline)
12. lib/logger.js + substituir em 39 arquivos

**Semanas 2-3 (10h):**
13. Migrações email
14. routes/clientes.js (email)
15. Testes + bug fixes

---

## COMO INVOCAR

Você pode chamar Claude Code assim:

```
/claude-code "Editar middleware/seguranca.js:204 para ativar rate limit admin"
```

Ou para os 5 críticos em paralelo:

```
/claude-code "Fazer fase 1 crítico:
1. middleware/seguranca.js:204 (rate limit admin)
2. server.js:50 (validação secrets)
3. routes/auth.js:12 (TOKEN_SECRET)
4. routes/config.js:93 (CERT_CIPHER)
5. routes/deploy.js:8 (DEPLOY_TOKEN)"
```

---

**Próximo Passo:** Chamar Claude Code para Fase 1 — 45 minutos, transforma o projeto de CRÍTICO para SEGURO.

