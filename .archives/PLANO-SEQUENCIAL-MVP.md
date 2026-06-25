# PLANO SEQUENCIAL MVP SAAS
## Ordem Exata de Execução (Do Primeiro ao Último Passo)

> **Objetivo:** De 3.5/10 → 5.5/10  
> **Timeline:** 4 semanas (25/07/2026)  
> **Método:** Linear — cada tarefa prepara a próxima

---

# ⏱️ ORDEM DE EXECUÇÃO (Do Mais Importante ao Menos Importante)

## 1️⃣ PREPARAÇÃO INICIAL (Hoje — 18/06 — 1 hora)

### 1.1 ✅ Criar Conta SendGrid
**O QUE:** Abrir conta email service  
**POR QUÊ:** Email é a base de tudo (recovery, convites, notifications)  
**COMO:**
1. Ir para https://sendgrid.com
2. Criar conta (free tier: 100 emails/dia)
3. Gerar API key
4. Copiar para `.env`:
   ```
   SENDGRID_API_KEY=SG.xxx
   SITE_URL=http://localhost:3000
   LOJA_EMAIL=noreply@easygestion.com
   ```

**VERIFICAÇÃO:** `echo $SENDGRID_API_KEY`  
**TEMPO:** 15 min  
**BLOQUEADOR?** ✅ SIM — sem isto, email não funciona

---

### 1.2 ✅ Atualizar .env.example
**O QUE:** Documentar variáveis de ambiente  
**POR QUÊ:** Outros devs/você depois precisam saber quais variáveis usar  
**ARQUIVO:** `.env.example`

```bash
# Email
SENDGRID_API_KEY=sua-chave-aqui
SITE_URL=http://localhost:3000
LOJA_EMAIL=noreply@easygestion.com

# Tokens
TOKEN_SECRET=change-me-at-least-32-chars-no-prod

# Certificados
CERT_CIPHER_KEY=change-me-at-least-32-chars

# Deploy
NODE_ENV=development
PORT=3000
SESSION_SECRET=change-this-secret-min-32-chars

# Banco de dados
DB_DIR=./db
UPLOADS_DIR=./public/img

# Backup S3 (depois)
AWS_BUCKET=easygestion-backups
AWS_REGION=us-east-1
AWS_ACCESS_KEY=xxx
AWS_SECRET_KEY=xxx
```

**TEMPO:** 15 min

---

### 1.3 ✅ Instalar Dependências de Email
**O QUE:** npm install  
**POR QUÊ:** Precisa das libs para funcionar  
**COMANDO:**
```bash
npm install @sendgrid/mail jsonwebtoken
npm list @sendgrid/mail jsonwebtoken
```

**TEMPO:** 10 min

---

## 2️⃣ BANCO DE DADOS — SCHEMA (Dia 1 — 2 horas)

### 2.1 ✅ Criar Tabela TENANTS
**O QUE:** Tabela para armazenar cada loja SaaS  
**POR QUÊ:** Sem isto, não consegue separar clientes  
**ARQUIVO:** `db/schema.sql`

**ADICIONAR AO FINAL DO ARQUIVO:**

```sql
-- ============================================================
-- TENANTS (Clientes SaaS) — NOVA TABELA
-- ============================================================
CREATE TABLE IF NOT EXISTS tenants (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  email TEXT UNIQUE NOT NULL,
  senha_hash TEXT NOT NULL,
  nome_loja TEXT NOT NULL,
  razao_social TEXT,
  cnpj TEXT UNIQUE,
  nome_responsavel TEXT NOT NULL,
  telefone TEXT NOT NULL,
  endereco TEXT,
  cidade TEXT,
  uf TEXT,
  cep TEXT,
  inscricao_estadual TEXT,
  regime TEXT DEFAULT 'simples',
  website TEXT,
  instagram TEXT,
  whatsapp TEXT,
  plano TEXT DEFAULT 'basico',
  status TEXT DEFAULT 'teste',
  data_cadastro TEXT NOT NULL DEFAULT (datetime('now','localtime')),
  data_trial_expira TEXT,
  data_ativado TEXT,
  data_cancelado TEXT,
  segmento TEXT,
  ultimo_acesso TEXT,
  num_vendas INTEGER DEFAULT 0,
  receita_total REAL DEFAULT 0,
  aceito_termos INTEGER DEFAULT 0,
  data_aceito_termos TEXT,
  aceito_privacidade INTEGER DEFAULT 0,
  data_aceito_privacidade TEXT,
  observacoes TEXT
);

CREATE INDEX idx_tenants_email ON tenants(email);
CREATE INDEX idx_tenants_status ON tenants(status);
CREATE INDEX idx_tenants_plano ON tenants(plano);
```

**VERIFICAÇÃO:** `sqlite3 db/dsstore.db ".tables" | grep tenants`  
**TEMPO:** 30 min

---

### 2.2 ✅ Criar Tabelas ASSINATURAS & COBRANÇAS
**O QUE:** Tabelas para rastrear financeiro  
**POR QUÊ:** Backoffice precisa saber quem pagou/não pagou  
**ARQUIVO:** `db/schema.sql` — ADICIONAR APÓS TENANTS

```sql
-- ============================================================
-- ASSINATURAS
-- ============================================================
CREATE TABLE IF NOT EXISTS assinaturas (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  tenant_id INTEGER NOT NULL UNIQUE,
  plano TEXT NOT NULL,
  valor_mensal REAL NOT NULL,
  data_inicio TEXT NOT NULL,
  data_proxima_renovacao TEXT NOT NULL,
  cancelada_em TEXT,
  cancelado_por TEXT,
  motivo_cancelamento TEXT,
  FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE
);

-- ============================================================
-- COBRANÇAS
-- ============================================================
CREATE TABLE IF NOT EXISTS cobranças (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  tenant_id INTEGER NOT NULL,
  assinatura_id INTEGER,
  data_cobranca TEXT NOT NULL,
  valor REAL NOT NULL,
  status TEXT DEFAULT 'pendente',
  metodo_pagamento TEXT,
  referencia TEXT,
  data_pagamento TEXT,
  tentativas INTEGER DEFAULT 0,
  FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE
);

CREATE INDEX idx_assinaturas_tenant ON assinaturas(tenant_id);
CREATE INDEX idx_cobranças_tenant ON cobranças(tenant_id);
CREATE INDEX idx_cobranças_status ON cobranças(status);
```

**TEMPO:** 30 min

---

### 2.3 ✅ Adicionar TENANT_ID a Tabelas Existentes
**O QUE:** Adicionar coluna tenant_id a TODAS as tabelas operacionais  
**POR QUÊ:** Sem isto, não consegue isolar dados  
**ARQUIVO:** `db/schema.sql` — ADICIONAR APÓS COBRANÇAS

```sql
-- ============================================================
-- MIGRAÇÃO: Adicionar tenant_id a tabelas existentes
-- ============================================================

-- Tabelas que terão dados de múltiplos tenants:
ALTER TABLE usuarios ADD COLUMN tenant_id INTEGER;
ALTER TABLE produtos ADD COLUMN tenant_id INTEGER;
ALTER TABLE variacoes ADD COLUMN tenant_id INTEGER;
ALTER TABLE vendas ADD COLUMN tenant_id INTEGER;
ALTER TABLE venda_itens ADD COLUMN tenant_id INTEGER;
ALTER TABLE venda_pagamentos ADD COLUMN tenant_id INTEGER;
ALTER TABLE clientes ADD COLUMN tenant_id INTEGER;
ALTER TABLE vendedores ADD COLUMN tenant_id INTEGER;
ALTER TABLE caixa_dia ADD COLUMN tenant_id INTEGER;
ALTER TABLE caixa_movimentos ADD COLUMN tenant_id INTEGER;
ALTER TABLE despesas ADD COLUMN tenant_id INTEGER;
ALTER TABLE trocas ADD COLUMN tenant_id INTEGER;
ALTER TABLE permutas ADD COLUMN tenant_id INTEGER;
ALTER TABLE estoque ADD COLUMN tenant_id INTEGER;
ALTER TABLE encomendas ADD COLUMN tenant_id INTEGER;
ALTER TABLE config ADD COLUMN tenant_id INTEGER;
ALTER TABLE nfce ADD COLUMN tenant_id INTEGER;

-- ============================================================
-- ÍNDICES de performance
-- ============================================================
CREATE INDEX idx_usuarios_tenant ON usuarios(tenant_id);
CREATE INDEX idx_produtos_tenant ON produtos(tenant_id);
CREATE INDEX idx_vendas_tenant ON vendas(tenant_id);
CREATE INDEX idx_clientes_tenant ON clientes(tenant_id);
CREATE INDEX idx_config_tenant ON config(tenant_id);
CREATE INDEX idx_caixa_dia_tenant ON caixa_dia(tenant_id);
CREATE INDEX idx_despesas_tenant ON despesas(tenant_id);
```

**TESTE:** 
```bash
node db/database.js  # Deve executar schema sem erros
```

**TEMPO:** 30 min

---

## 3️⃣ LIB DE EMAIL (Dia 1 — 1 hora)

### 3.1 ✅ Criar lib/email.js
**O QUE:** Funções para enviar email via SendGrid  
**POR QUÊ:** Usado em recovery, convites, notificações  
**ARQUIVO:** CRIAR `lib/email.js`

```javascript
// lib/email.js
const sgMail = require('@sendgrid/mail');
sgMail.setApiKey(process.env.SENDGRID_API_KEY || 'fake-key-dev');

const SITE_URL = process.env.SITE_URL || 'http://localhost:3000';
const LOJA_EMAIL = process.env.LOJA_EMAIL || 'noreply@easygestion.com';
const LOJA_NOME = process.env.LOJA_NOME || 'EasyGestão';

async function enviarEmail(para, assunto, htmlBody) {
  if (process.env.NODE_ENV === 'test') {
    console.log(`[EMAIL TEST] ${para}: ${assunto}`);
    return;
  }
  
  try {
    await sgMail.send({
      to: para,
      from: LOJA_EMAIL,
      subject: assunto,
      html: htmlBody,
    });
    console.log(`[EMAIL OK] ${para}: ${assunto}`);
    return true;
  } catch (err) {
    console.error(`[EMAIL ERRO] ${para}:`, err.message);
    return false;
  }
}

function templateResetSenha(usuario, link) {
  return `
    <h2>Redefinir sua senha</h2>
    <p>Oi ${usuario},</p>
    <p>Clique no link abaixo para redefinir sua senha. O link expira em 1 hora.</p>
    <p><a href="${link}" style="background:#1a6f5e; color:white; padding:12px 24px; text-decoration:none; border-radius:6px; display:inline-block;">Redefinir senha</a></p>
    <p>Se não solicitou isso, ignore este email.</p>
    <p>Equipe ${LOJA_NOME}</p>
  `;
}

function templateVerificarEmail(usuario, link) {
  return `
    <h2>Confirme seu email</h2>
    <p>Oi ${usuario},</p>
    <p>Para ativar sua conta, clique no botão abaixo:</p>
    <p><a href="${link}" style="background:#1a6f5e; color:white; padding:12px 24px; text-decoration:none; border-radius:6px; display:inline-block;">Confirmar email</a></p>
    <p>O link expira em 24 horas.</p>
    <p>Equipe ${LOJA_NOME}</p>
  `;
}

function templateConvite(usuario, link) {
  return `
    <h2>Você foi convidado***REMOVED***</h2>
    <p>Oi,</p>
    <p><strong>${usuario}</strong> convidou você para acessar ${LOJA_NOME}.</p>
    <p>Clique abaixo para criar sua senha e começar:</p>
    <p><a href="${link}" style="background:#1a6f5e; color:white; padding:12px 24px; text-decoration:none; border-radius:6px; display:inline-block;">Aceitar convite</a></p>
    <p>Este link expira em 7 dias.</p>
    <p>Equipe ${LOJA_NOME}</p>
  `;
}

function templateBoasVindas(usuario) {
  return `
    <h2>Bem-vindo ao ${LOJA_NOME}***REMOVED***</h2>
    <p>Oi ${usuario},</p>
    <p>Sua conta foi criada com sucesso. Você tem <strong>14 dias grátis</strong> para testar.</p>
    <h3>Próximos passos:</h3>
    <ol>
      <li>Faça login em ${SITE_URL}</li>
      <li>Configure sua marca (logo + cor)</li>
      <li>Cadastre seus primeiros 5 produtos</li>
      <li>Faça sua primeira venda</li>
    </ol>
    <p>Dúvidas? Responda este email***REMOVED***</p>
    <p>Equipe ${LOJA_NOME}</p>
  `;
}

module.exports = {
  enviarEmail,
  templateResetSenha,
  templateVerificarEmail,
  templateConvite,
  templateBoasVindas,
};
```

**TESTE:**
```bash
node -e "const e = require('./lib/email'); console.log(typeof e.enviarEmail)"
```

**TEMPO:** 30 min

---

## 4️⃣ RECUPERAÇÃO DE SENHA (Dia 2-3 — 8 horas)

### 4.1 ✅ Adicionar Email a Usuarios
**O QUE:** Coluna email em tabela usuarios  
**POR QUÊ:** Precisamos armazenar email do usuário  
**ARQUIVO:** `db/schema.sql` — ADICIONAR APÓS MIGRAÇÕES

```sql
-- Tabela de tokens para reset/verify/convite
CREATE TABLE IF NOT EXISTS tokens_verificacao (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  usuario_id INTEGER NOT NULL,
  token TEXT UNIQUE NOT NULL,
  tipo TEXT NOT NULL,
  criado_em TEXT NOT NULL DEFAULT (datetime('now','localtime')),
  expires_em TEXT NOT NULL,
  usado_em TEXT,
  FOREIGN KEY (usuario_id) REFERENCES usuarios(id) ON DELETE CASCADE
);

CREATE INDEX idx_tokens_expires ON tokens_verificacao(expires_em);
CREATE INDEX idx_tokens_usuario ON tokens_verificacao(usuario_id);
```

**TESTE:** 
```bash
node -e "const db = require('./db/database'); const r = db.prepare('SELECT * FROM tokens_verificacao LIMIT 1'); console.log('OK')"
```

**TEMPO:** 30 min

---

### 4.2 ✅ Implementar POST /api/auth/forgot-password
**O QUE:** Rota para "esqueci minha senha"  
**POR QUÊ:** Primeiro passo da recuperação  
**ARQUIVO:** EDITAR `routes/auth.js` — ADICIONAR AO FINAL

```javascript
const jwt = require('jsonwebtoken');
const { enviarEmail, templateResetSenha } = require('../lib/email');

const TOKEN_SECRET = process.env.TOKEN_SECRET || 'dev-secret';

// POST /api/auth/forgot-password { email }
router.post('/forgot-password', async (req, res) => {
  const { email } = req.body;
  if (***REMOVED***email || ***REMOVED***email.includes('@')) {
    return res.status(400).json({ erro: 'Email inválido' });
  }

  // Procura usuário
  const user = db.prepare('SELECT * FROM usuarios WHERE LOWER(email) = LOWER(?)').get(email.trim());
  if (***REMOVED***user) {
    // NÃO expor se existe ou não (segurança)
    return res.json({ ok: true, mensagem: 'Se existe uma conta com este email, um link foi enviado.' });
  }

  // Gera JWT token válido por 1h
  const token = jwt.sign(
    { id: user.id, tipo: 'reset' },
    TOKEN_SECRET,
    { expiresIn: '1h' }
  );

  // Salva token no BD
  const expires = new Date(Date.now() + 3600000).toISOString();
  db.prepare(`
    INSERT INTO tokens_verificacao (usuario_id, token, tipo, criado_em, expires_em)
    VALUES (?, ?, ?, ?, ?)
  `).run(user.id, token, 'reset-senha', new Date().toISOString(), expires);

  // Envia email
  const resetLink = `${process.env.SITE_URL || 'http://localhost:3000'}/reset-senha?token=${token}`;
  await enviarEmail(user.email, 'Redefinir sua senha', templateResetSenha(user.nome, resetLink));

  return res.json({ ok: true, mensagem: 'Email de redefinição enviado' });
});

module.exports = router;
```

**TESTE:**
```bash
# Em curl ou Postman:
POST http://localhost:3000/api/auth/forgot-password
Content-Type: application/json

{ "email": "admin@example.com" }
```

**TEMPO:** 2h

---

### 4.3 ✅ Implementar POST /api/auth/reset-senha
**O QUE:** Rota para resetar a senha com token  
**POR QUÊ:** Segundo passo da recuperação  
**ARQUIVO:** EDITAR `routes/auth.js` — ADICIONAR

```javascript
// POST /api/auth/reset-senha { token, nova_senha }
router.post('/reset-senha', (req, res) => {
  const { token, nova_senha } = req.body;
  if (***REMOVED***token || ***REMOVED***nova_senha || nova_senha.length < 6) {
    return res.status(400).json({ erro: 'Dados inválidos' });
  }

  try {
    // (1) Valida token JWT
    const decoded = jwt.verify(token, TOKEN_SECRET);
    if (decoded.tipo ***REMOVED***== 'reset') throw new Error('Token inválido');

    // (2) Procura usuário
    const user = db.prepare('SELECT * FROM usuarios WHERE id = ?').get(decoded.id);
    if (***REMOVED***user) return res.status(404).json({ erro: 'Usuário não encontrado' });

    // (3) Valida token no BD
    const tokenRec = db.prepare('SELECT * FROM tokens_verificacao WHERE token = ? AND tipo = ?')
      .get(token, 'reset-senha');
    if (***REMOVED***tokenRec || tokenRec.usado_em) {
      return res.status(400).json({ erro: 'Token já foi usado ou expirou' });
    }

    // (4) Atualiza senha
    db.transaction(() => {
      db.prepare('UPDATE usuarios SET senha_hash = ? WHERE id = ?')
        .run(hashSenha(nova_senha), user.id);
      db.prepare('UPDATE tokens_verificacao SET usado_em = ? WHERE id = ?')
        .run(new Date().toISOString(), tokenRec.id);
    })();

    return res.json({ ok: true, mensagem: 'Senha redefinida com sucesso***REMOVED***' });
  } catch (err) {
    console.error('Reset error:', err.message);
    return res.status(400).json({ erro: 'Token inválido ou expirado' });
  }
});
```

**TEMPO:** 2h

---

### 4.4 ✅ Criar Telas de Recuperação
**O QUE:** HTML/JS para telas de reset  
**POR QUÊ:** Frontend  
**ARQUIVOS:**
- CRIAR `public/esqueci-senha.html`
- CRIAR `public/reset-senha.html`
- EDITAR `public/login.html` (adicionar link)

(Copiar de PLANO-MVP-SAAS.md — Semana 2, Tarefas 2.2-2.3)

**TEMPO:** 2h

---

## 5️⃣ LGPD & TERMOS (Dia 3 — 3 horas)

### 5.1 ✅ Criar public/termos.html
**O QUE:** Página de termos de uso  
**POR QUÊ:** LGPD obrigatória  
**ARQUIVO:** CRIAR `public/termos.html`

(Copiar de PLANO-MVP-SAAS.md — Semana 4, Tarefa 4.1)

**TEMPO:** 1h

---

### 5.2 ✅ Criar public/privacidade.html
**O QUE:** Página de privacidade  
**POR QUÊ:** LGPD obrigatória  
**ARQUIVO:** CRIAR `public/privacidade.html`

**TEMPO:** 1h

---

### 5.3 ✅ Adicionar Checkbox no Login
**O QUE:** Obrigar aceitar termos antes de cadastrar  
**POR QUÊ:** LGPD — consentimento explícito  
**ARQUIVO:** EDITAR `public/login.html` (ao final do form)

```html
<div style="margin-top:16px; font-size:12px; color:#666;">
  <label style="display:flex; align-items:center; gap:8px;">
    <input type="checkbox" id="aceito_termos" required>
    <span>Aceito os <a href="termos.html" target="_blank">termos de uso</a> e a <a href="privacidade.html" target="_blank">política de privacidade</a></span>
  </label>
</div>
```

**TEMPO:** 30 min

---

## 6️⃣ AUTO-SERVIÇO DO USUÁRIO (Dia 4-5 — 6 horas)

### 6.1 ✅ Implementar PATCH /api/me/senha
**O QUE:** Usuário altera sua própria senha  
**POR QUÊ:** Segurança (não precisa pedir ao admin)  
**ARQUIVO:** EDITAR `routes/auth.js` — ADICIONAR

```javascript
// PATCH /api/me/senha { senha_atual, senha_nova }
router.patch('/me/senha', (req, res) => {
  if (***REMOVED***req.session || ***REMOVED***req.session.logado) {
    return res.status(401).json({ erro: 'Não autenticado' });
  }

  const { senha_atual, senha_nova } = req.body;
  if (***REMOVED***senha_atual || ***REMOVED***senha_nova || senha_nova.length < 6) {
    return res.status(400).json({ erro: 'Entrada inválida' });
  }

  // Procura usuário
  const user = db.prepare('SELECT * FROM usuarios WHERE nome = ? AND ativo = 1')
    .get(req.session.usuario);
  if (***REMOVED***user) return res.status(404).json({ erro: 'Usuário não encontrado' });

  // Valida senha atual
  if (***REMOVED***verificarSenha(senha_atual, user.senha_hash)) {
    return res.status(403).json({ erro: 'Senha atual incorreta' });
  }

  // Atualiza
  db.prepare('UPDATE usuarios SET senha_hash = ? WHERE id = ?')
    .run(hashSenha(senha_nova), user.id);

  res.json({ ok: true });
});
```

**TEMPO:** 1h

---

### 6.2 ✅ Implementar GET /api/me/dados
**O QUE:** Exportar dados do usuário em JSON (LGPD)  
**POR QUÊ:** Direito de portabilidade  
**ARQUIVO:** EDITAR `routes/auth.js` — ADICIONAR

```javascript
// GET /api/me/dados
router.get('/me/dados', (req, res) => {
  if (***REMOVED***req.session || ***REMOVED***req.session.logado) {
    return res.status(401).json({ erro: 'Não autenticado' });
  }

  const usuario = db.prepare('SELECT id, nome, email, papel, criado_em FROM usuarios WHERE nome = ?')
    .get(req.session.usuario);

  const dados = {
    usuario,
    vendas: db.prepare('SELECT * FROM vendas ORDER BY data_hora DESC LIMIT 100').all(),
    clientes: db.prepare('SELECT * FROM clientes ORDER BY criado_em DESC').all(),
    produtos: db.prepare('SELECT * FROM produtos').all(),
  };

  res.json(dados);
});
```

**TEMPO:** 1h

---

### 6.3 ✅ Implementar DELETE /api/me/conta
**O QUE:** Usuário deleta sua conta (LGPD)  
**POR QUÊ:** Direito ao esquecimento  
**ARQUIVO:** EDITAR `routes/auth.js` — ADICIONAR

```javascript
// DELETE /api/me/conta { senha }
router.delete('/me/conta', (req, res) => {
  if (***REMOVED***req.session || ***REMOVED***req.session.logado) {
    return res.status(401).json({ erro: 'Não autenticado' });
  }

  const { senha } = req.body;
  const user = db.prepare('SELECT * FROM usuarios WHERE nome = ?')
    .get(req.session.usuario);

  if (***REMOVED***verificarSenha(senha, user.senha_hash)) {
    return res.status(403).json({ erro: 'Senha incorreta' });
  }

  // Soft delete (anônimiza)
  db.transaction(() => {
    db.prepare('UPDATE usuarios SET nome = ?, email = ?, ativo = 0 WHERE id = ?')
      .run(`[DELETADO] ${user.id}`, `[DELETADO-${user.id}@noreply.local]`, user.id);
  })();

  req.session.destroy();
  res.json({ ok: true });
});
```

**TEMPO:** 1h

---

### 6.4 ✅ Criar Tela "Minha Conta"
**O QUE:** Interface para self-service  
**POR QUÊ:** UX  
**ARQUIVO:** CRIAR `public/minha-conta.html`

(Copiar de PLANO-MVP-SAAS.md — Semana 3, Tarefa 3.1)

**TEMPO:** 2h

---

## 7️⃣ ISOLAMENTO MULTI-TENANT (Dia 5-7 — 15 horas)

### 7.1 ✅ Criar Middleware de Tenant
**O QUE:** Validar tenant_id em cada requisição  
**POR QUÊ:** Proteger contra acesso cruzado  
**ARQUIVO:** CRIAR `middleware/tenant.js`

```javascript
// middleware/tenant.js
function exigirTenant(req, res, next) {
  if (***REMOVED***req.session || ***REMOVED***req.session.tenant_id) {
    return res.status(403).json({ erro: 'Tenant não encontrado' });
  }
  next();
}

module.exports = { exigirTenant };
```

**TEMPO:** 30 min

---

### 7.2 ✅ Adicionar Middleware ao Server
**O QUE:** Aplicar middleware a todas as rotas  
**POR QUÊ:** Cada requisição deve validar tenant  
**ARQUIVO:** EDITAR `server.js`

```javascript
const { exigirTenant } = require('./middleware/tenant');

// Após exigirLogin:
app.use('/api', exigirTenant);  // Todas as rotas protegidas precisam de tenant
```

**TEMPO:** 15 min

---

### 7.3 ✅ Refatorar Queries (OS QUERIES)
**O QUE:** Adicionar WHERE tenant_id a ~50 queries  
**POR QUÊ:** Isolar dados por cliente  
**ARQUIVOS:** Todas em `/routes`

**PADRÃO:**
```javascript
// ANTES:
const produtos = db.prepare('SELECT * FROM produtos').all();

// DEPOIS:
const produtos = db.prepare(
  'SELECT * FROM produtos WHERE tenant_id = ?'
).all(req.session.tenant_id);
```

**AFETADAS:**
- `routes/produtos.js` (~5 queries)
- `routes/vendas.js` (~8 queries)
- `routes/clientes.js` (~5 queries)
- `routes/estoque.js` (~4 queries)
- `routes/caixa.js` (~6 queries)
- `routes/config.js` (~3 queries)
- `routes/dashboard.js` (~5 queries)
- `routes/financeiro.js` (~4 queries)
- `routes/trocas.js` (~3 queries)
- `routes/nfce.js` (~2 queries)

**TEMPO:** 8 horas (mecanicamente, lento)

---

### 7.4 ✅ Testes de Isolamento
**O QUE:** Verificar que User A não vê User B  
**POR QUÊ:** Validar que isolamento funciona  
**ARQUIVO:** CRIAR `tests/isolamento.test.js`

```javascript
// tests/isolamento.test.js
describe('Multi-tenant Isolamento', () => {
  test('User A não vê produtos de User B', async () => {
    // Logar como tenant_id=1, criar produto
    // Logar como tenant_id=2, tentar ver produto
    // Deve retornar [] (vazio)
  });
  
  test('User A não vê clientes de User B', async () => {
    // Similar ao acima
  });
  
  test('User A não vê vendas de User B', async () => {
    // Similar ao acima
  });
});
```

**TEMPO:** 3 horas

---

## 8️⃣ PREPARAÇÃO DE BACKUP (Dia 7 — 2 horas)

### 8.1 ✅ Configurar Backup S3
**O QUE:** Backup automático diário para AWS S3  
**POR QUÊ:** Proteção contra perda de dados  
**ARQUIVO:** CRIAR `lib/backup-s3.js`

```javascript
// lib/backup-s3.js
const AWS = require('aws-sdk');
const fs = require('fs');
const path = require('path');

const s3 = new AWS.S3({
  accessKeyId: process.env.AWS_ACCESS_KEY,
  secretAccessKey: process.env.AWS_SECRET_KEY,
  region: process.env.AWS_REGION
});

async function fazerBackupS3() {
  try {
    const dbPath = path.join(__dirname, '../db/dsstore.db');
    const fileContent = fs.readFileSync(dbPath);
    const filename = `backup-${new Date().toISOString().split('T')[0]}.db`;

    const params = {
      Bucket: process.env.AWS_BUCKET,
      Key: filename,
      Body: fileContent,
    };

    await s3.upload(params).promise();
    console.log(`[BACKUP OK] ${filename}`);
  } catch (err) {
    console.error('[BACKUP ERRO]', err);
  }
}

module.exports = { fazerBackupS3 };
```

**TEMPO:** 1h

---

### 8.2 ✅ Agendar Backup com Cron
**O QUE:** Executar backup diariamente às 2am  
**POR QUÊ:** Automático, não precisa fazer manualmente  
**ARQUIVO:** CRIAR `lib/scheduler.js`

```javascript
// lib/scheduler.js
const cron = require('node-cron');
const { fazerBackupS3 } = require('./backup-s3');

function iniciarSchedulers() {
  // Backup diário às 2am
  cron.schedule('0 2 * * *', () => {
    console.log('[CRON] Iniciando backup...');
    fazerBackupS3();
  });

  console.log('[SCHEDULER] Agendadores iniciados');
}

module.exports = { iniciarSchedulers };
```

**TEMPO:** 30 min

---

### 8.3 ✅ Testar Restore
**O QUE:** Confirmar que backup pode ser restaurado  
**POR QUÊ:** Validar que restauração funciona  
**TESTE MANUAL:**
```bash
# 1. Fazer backup manual
cp db/dsstore.db db/backup-teste.db

# 2. Danificar BD (ou deletar tudo)
rm db/dsstore.db

# 3. Restaurar
cp db/backup-teste.db db/dsstore.db

# 4. Verificar que dados estão lá
npm start  # Deve funcionar
```

**TEMPO:** 30 min

---

## 9️⃣ TELAS & DEPLOY (Dia 8-14 — Variável)

### 9.1 ✅ Testar Tudo Localmente
**O QUE:** Rodar como cliente real  
**POR QUÊ:** Validar antes de deploy  
**CHECKLIST:**
- [ ] Login funciona
- [ ] Cadastro funciona
- [ ] Recovery de senha funciona
- [ ] Email é enviado (check SendGrid dashboard)
- [ ] Multi-tenant isolamento funciona
- [ ] Self-service (alterar senha, export, delete) funciona
- [ ] Sem erros em console
- [ ] Sem erro 500 em nada

**TEMPO:** 2 horas

---

### 9.2 ✅ Configurar HTTPS em Produção
**O QUE:** Ativar SSL/TLS  
**POR QUÊ:** Segurança obrigatória  
**OPÇÕES:**
- CloudFlare (grátis, fácil)
- Let's Encrypt + nginx
- AWS ACM + ALB

**TEMPO:** 1 hora (depende da plataforma)

---

### 9.3 ✅ Deploy em Staging
**O QUE:** Testar em servidor antes de produção  
**POR QUÊ:** Validação final  
**PLATAFORMA:** Render / Railway / Heroku

**TEMPO:** 1 hora

---

### 9.4 ✅ Deploy em Produção
**O QUE:** Ir ao vivo  
**POR QUÊ:** Lançar***REMOVED***  
**CHECKLIST PRÉ-DEPLOY:**
- [ ] Todos testes locais passam
- [ ] Staging OK
- [ ] .env em produção tem valores reais
- [ ] Backup S3 configurado
- [ ] HTTPS funcionando
- [ ] DATABASE_URL setado
- [ ] SESSION_SECRET forte
- [ ] SENDGRID_API_KEY configurado

**TEMPO:** 30 min

---

### 9.5 ✅ Convidar Clientes Piloto
**O QUE:** 2-3 clientes testando  
**POR QUÊ:** Feedback real  
**EMAIL:**
```
Assunto: Convite para testar EasyGestão SaaS

Oi***REMOVED***

Estou lançando o EasyGestão como SaaS (multi-tenant).
Você gostaria de testar gratuitamente por 14 dias?

Link para cadastro: https://easygestion.com.br

Você teria acesso a:
- Dashboard completo
- PDV + Caixa
- Estoque + Produtos
- Relatórios + Financeiro
- NFC-e integrada

Feedback é bem-vindo***REMOVED***

Abraços,
Igor
```

**TEMPO:** 30 min (convidação) + monitoramento contínuo

---

### 9.6 ✅ Monitorar Erros
**O QUE:** Catcher de erros em tempo real  
**POR QUÊ:** Fix bugs rapidamente  
**OPÇÕES:**
- Sentry (grátis até 5k eventos/mês)
- Datadog (pago, mas completo)
- Rollbar (grátis até 50k)

**SETUP SENTRY:**
```bash
npm install @sentry/node
```

**TEMPO:** 1 hora

---

## 🔟 VALIDAÇÃO FINAL (Dia 15-21 — Variável)

### 10.1 ✅ Checklist de Lançamento
```
ANTES DE CONSIDERAR DONE:

AUTENTICAÇÃO:
├─ [ ] Login funciona
├─ [ ] Recovery funciona
├─ [ ] Email está sendo enviado
└─ [ ] Rate limit (6 tentativas) funciona

MULTI-TENANT:
├─ [ ] User A criado, User B criado
├─ [ ] User A não vê dados de B
├─ [ ] User B não vê dados de A
└─ [ ] Queries estão isoladas

LGPD:
├─ [ ] Termos visível
├─ [ ] Privacidade visível
├─ [ ] Checkbox obrigatório
└─ [ ] Dados sendo salvos

SEGURANÇA:
├─ [ ] HTTPS funcionando
├─ [ ] Cookies secure + httpOnly
├─ [ ] Rate limit testado
└─ [ ] Login-sem-senha desativado

BACKUP:
├─ [ ] Backup S3 rodando
├─ [ ] Restore testado
└─ [ ] Dados estão protegidos

CLIENTES PILOTO:
├─ [ ] Cliente 1 testando OK
├─ [ ] Cliente 2 testando OK
├─ [ ] Sem erros críticos
└─ [ ] Feedback positivo

MONITOR:
├─ [ ] Sentry configurado
├─ [ ] Erros sendo rastreados
└─ [ ] Uptime OK (99%+)
```

**TEMPO:** 2-3 horas de validação

---

## 📊 RESUMO CRONOLÓGICO

```
DIA 1 (18/06):
├─ 1.1: SendGrid ....................... 15 min ✅
├─ 1.2: .env.example ................... 15 min ✅
├─ 1.3: npm install .................... 10 min ✅
├─ 2.1: Tabela tenants ................. 30 min ✅
├─ 2.2: Tabelas assinaturas/cobranças .. 30 min ✅
├─ 2.3: Adicionar tenant_id ............ 30 min ✅
├─ 3.1: lib/email.js ................... 30 min ✅
└─ TOTAL: 3-4 horas

DIA 2-3:
├─ 4.1: Tokens verificacao ............. 30 min ✅
├─ 4.2: POST forgot-password ........... 2h ✅
├─ 4.3: POST reset-senha ............... 2h ✅
├─ 4.4: Telas (esqueci/reset) ......... 2h ✅
└─ TOTAL: 6-7 horas

DIA 3-4:
├─ 5.1: Termos ......................... 1h ✅
├─ 5.2: Privacidade .................... 1h ✅
├─ 5.3: Checkbox login ................. 30 min ✅
└─ TOTAL: 2-3 horas

DIA 4-5:
├─ 6.1: PATCH /me/senha ................ 1h ✅
├─ 6.2: GET /me/dados .................. 1h ✅
├─ 6.3: DELETE /me/conta ............... 1h ✅
├─ 6.4: Tela minha-conta ............... 2h ✅
└─ TOTAL: 5 horas

DIA 5-7:
├─ 7.1: Middleware tenant .............. 30 min ✅
├─ 7.2: Adicionar ao server ............ 15 min ✅
├─ 7.3: Refatorar ~50 queries .......... 8h ✅
├─ 7.4: Testes isolamento .............. 3h ✅
└─ TOTAL: 11-12 horas

DIA 7-8:
├─ 8.1: Backup S3 ...................... 1h ✅
├─ 8.2: Scheduler/Cron ................. 30 min ✅
├─ 8.3: Teste restore .................. 30 min ✅
└─ TOTAL: 2 horas

DIA 8-14:
├─ 9.1: Testes locais .................. 2h ✅
├─ 9.2: HTTPS produção ................. 1h ✅
├─ 9.3: Deploy staging ................. 1h ✅
├─ 9.4: Deploy produção ................ 30 min ✅
├─ 9.5: Convidar piloto ................ 30 min ✅
├─ 9.6: Sentry/monitoramento ........... 1h ✅
└─ TOTAL: 6-7 horas

DIA 15+:
├─ 10.1: Validação final ............... 2-3h ✅
└─ TOTAL: 2-3 horas

═════════════════════════════════════════════════════════════
HORAS TOTAIS: ~51-58 horas (ou ~6-8 dias de full-time)
```

---

## ✅ PRONTO***REMOVED***

**De 3.5/10 → 5.5/10 em 4 semanas**

Agora você tem ordem exata. Primeira tarefa: **1.1 — Criar conta SendGrid**

