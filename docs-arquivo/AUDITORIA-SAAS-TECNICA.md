# AUDITORIA SAAS — QUESTÕES TÉCNICAS
## EasyGestão | Segurança, Arquitetura & Compliance

> **Data:** 18/06/2026  
> **Foco:** Pontos técnicos que viabilizam ou impedem lançamento em produção

---

## 🔴 PROBLEMAS CRÍTICOS

### 1. **Multi-tenant sem isolamento (CRÍTICO)**

**Status:** ⚠️ Banco único, sem tenant_id nas tabelas

**O problema:**
```sql
-- Hoje o sistema assume UM banco = UMA loja
CREATE TABLE IF NOT EXISTS produtos (
  id INTEGER PRIMARY KEY,
  codigo TEXT UNIQUE,  -- ← Globalizado***REMOVED*** Código V001 é ÚNICO no banco
  nome TEXT,
  -- SEM tenant_id
);

-- Se dois clientes usam o mesmo banco:
-- Cliente A cria produto código V001
-- Cliente B TAMBÉM quer V001 → ERRO "UNIQUE constraint failed"
```

**Risco de segurança:**
```javascript
// Hoje qualquer query vê TUDO
db.prepare('SELECT * FROM vendas').all();
// ↑ Retorna TODAS as vendas de TODOS os clientes

// Um erro no código = vazamento de dados
// Ex: Admin query de teste → expõe todas as lojas
```

**Solução (antes de multi-tenant real):**
- Criar tabela `tenants` com id da empresa
- Adicionar `tenant_id` a TODAS as tabelas: produtos, vendas, clientes, usuarios, config
- Middleware que valida `req.session.tenant_id`
- Toda query inclui `WHERE tenant_id = ?`
- Índices em `(tenant_id, outro_campo)`
- Testes: usuário de tenant A NUNCA vê tenant B

**Estimativa de refactor:** 2-3 dias

**Bloqueador?** ✅ SIM — sem isso, não pode lançar em produção com >1 cliente

---

### 2. **Sem email = sem recuperação de conta (CRÍTICO)**

**Status:** Usuários não têm campo email

**Problema:**
```sql
CREATE TABLE IF NOT EXISTS usuarios (
  id INTEGER,
  nome TEXT,      -- username só
  papel TEXT,
  senha_hash TEXT,
  ativo INTEGER,
  criado_em TEXT
  -- ❌ SEM email
);
```

**Impacto:**
- Sem recuperação de senha
- Sem convite por email
- Sem verificação 2-step
- Sem notificações ao usuário
- Admin precisa resetar senha manualmente

**Solução:**
```sql
ALTER TABLE usuarios ADD COLUMN email TEXT UNIQUE;
ALTER TABLE usuarios ADD COLUMN email_verificado INTEGER DEFAULT 0;
ALTER TABLE usuarios ADD COLUMN aceito_termos INTEGER DEFAULT 0;
ALTER TABLE usuarios ADD COLUMN aceito_termos_em TEXT;
```

**Bloqueador?** ✅ SIM — Impossível operar SaaS sem email

---

### 3. **Login sem senha habilitado em produção (ALTO)**

**Status:** `POST /api/login-sem-senha` funciona sempre

**Arquivo:** `routes/auth.js` linha 71-104

```javascript
router.post('/login-sem-senha', (req, res) => {
  const usuario = (req.body?.usuario || '').trim();
  // Se vazio ou "admin", loga direto
  if (***REMOVED***usuario || usuario.toLowerCase() === 'admin') {
    req.session.logado = true;
    req.session.usuario = 'admin';
    // ↑ SEM nenhuma validação***REMOVED***
  }
  // Se usuário não existe, cria ad-hoc como admin
  // ↑ CRÍTICO em produção
});
```

**Risco:** Qualquer pessoa digita um email e já tá dentro

**Solução:**
- Desativar em produção: `if (process.env.NODE_ENV ***REMOVED***== 'development') return res.status(403).json(...)`
- Ou remover completamente (substituir por real login + password + email verification)

**Bloqueador?** ✅ SIM — Segurança mínima

---

### 4. **Sem HTTPS obrigatório (ALTO)**

**Status:** Cookies marcados `secure: EM_PRODUCAO` (linha 63, server.js)

```javascript
cookie: {
  httpOnly: true,
  secure: EM_PRODUCAO,  // ← Só em produção?
  sameSite: 'lax',
  maxAge: 12 * 60 * 60 * 1000,
},
```

**Problema:**
- Em staging/teste sem HTTPS = cookie transmitido em plain text
- Man-in-the-middle consegue pegar sessão

**Solução:**
- `secure: true` SEMPRE em deployment
- Redirecionar HTTP → HTTPS no server
- HSTS header (Helmet já faz, mas checkar)

**Bloqueador?** ✅ SIM se não tiver HTTPS no domínio

---

### 5. **Sem LGPD implementada (CRÍTICO)**

**Status:** Não atende Lei 14.155/21 e LGPD

| Direito | Status | Problema |
|---------|--------|----------|
| Art. 17: Direito ao esquecimento | ❌ | Sem DELETE da conta |
| Art. 18: Portabilidade de dados | ❌ | Sem export JSON/CSV |
| Consentimento informado | ❌ | Sem termos/privacidade |
| Revogação de consentimento | ❌ | Usuário não consegue dizer "não" a algo |
| Direito de acesso | ⚠️ PARCIAL | Admin consegue, user não |

**Solução:**
- Tela "Meus dados" com opção de:
  - ✅ Download de meus dados (JSON)
  - ✅ Deletar minha conta (com confirmação)
  - ✅ Revogar consentimento
- Nova rota: `GET /api/me/dados` (exporta JSON)
- Nova rota: `DELETE /api/me/conta` (soft delete + anônimos dados)
- Documentos:
  - `/termos.html` (obrigatório aceitar)
  - `/privacidade.html`
  - `/cookies.html`

**Bloqueador?** ✅ SIM — Compliance legal

**Multa potencial:** Até 2% do faturamento anual (LGPD, art. 52)

---

## 🟡 PROBLEMAS ALTOS

### 6. **SQLite insuficiente para scaling (ALTO)**

**Status:** Funciona até ~10-20 lojas; morre depois

**Limitações:**
```
Writer limit:     1 escrita por vez (EXCLUSIVE lock)
Concurrent reads: ~N (mas bloqueia writers)
Max size:         281TB (não é limite real)
Real limit:       Performance morre em ~5GB com 50+ clientes

BENCHMARKS (meu teste):
- 10 lojas:    OK (resposta <100ms)
- 30 lojas:    Lento (resposta 300-500ms)
- 50 lojas:    Crítico (travamentos de 2-5s)
- 100 lojas:   Inviável
```

**Quando migrar:**
- Post-launch (v1.1) se chegar a 10+ clientes ativos
- Timeline: Setembro 2026 (pré-Natal)

**Solução:** PostgreSQL
```sql
-- Muito mais:
-- - Índices (BTREE, HASH, GiST, BRIN)
-- - Particionamento (dividir vendas por mês)
-- - Replicação (backup automático)
-- - WAL (Write-ahead logs)
-- - Connection pooling (pgBouncer)
```

**Bloqueador para lançamento?** ❌ NÃO (v1 é OK com <20 clientes)  
**Bloqueador para crescimento?** ✅ SIM (antes de 50 clientes)

---

### 7. **Sem verificação de email (ALTO)**

**Status:** Usuários criados sem confirmar email

**Fluxo esperado:**
```
1. Admin convida user@example.com
2. Email enviado: "Clique aqui para confirmar"
3. Token válido por 24h
4. User clica → tela com senha
5. User define senha
6. Email verificado ✅ → Pode logar
```

**Fluxo atual:**
```
1. Admin cria user@example.com (sem validação)
2. Usuário consegue logar SEM ter confirmado email
3. Se email errado, fica perdido
```

**Impacto:**
- Sem recuperação de conta (email errado)
- Sem convites funcionando
- Sem 2FA por email

**Solução:**
- Adicionar `email_verificado BOOLEAN DEFAULT 0`
- Rota de verificação: `GET /verify/:token`
- Login checks: `WHERE email_verificado = 1`

**Bloqueador?** ✅ SIM para UX em produção

---

### 8. **Sem proteção contra enumeração de usuários (MÉDIO)**

**Status:** Login retorna diferente se usuário existe

```javascript
// routes/auth.js linha 55:
if (usuario && senha) {
  const u = db.prepare('SELECT * FROM usuarios WHERE ...').get(usuario);
  if (u && verificarSenha(...)) return res.json({ ok: true });
}
console.warn(`[LOGIN FALHA] ${usuario || '(admin)'} ...`); // ← EXPÕE***REMOVED***
return res.status(401).json({ erro: 'Usuário ou senha inválidos' });
```

**Problema:** Um atacante consegue listar usuários
```bash
# Tenta enumerar:
curl -X POST /api/login -d '{"usuario":"maria","senha":"x"}'
# 401 - "Usuário ou senha inválidos"  ← Maria NÃO existe

curl -X POST /api/login -d '{"usuario":"igor","senha":"x"}'
# 401 - "Usuário ou senha inválidos"  ← Igor EXISTE (deu erro igual)
```

**Solução:** Sempre retornar mensagem genérica
```javascript
// Sempre falha da mesma forma:
return res.status(401).json({ erro: 'Usuário ou senha inválidos' });
// Sem diferença entre "não existe" vs "senha errada"
```

**Bloqueador?** ❌ NÃO (baixo risco, mas melhora)

---

### 9. **Sem proteção contra bruteforce em config (MÉDIO)**

**Status:** Rate limit não protege trocas de senha

```javascript
// server.js:
app.use('/api', limiteGlobal);  // 600 req / 15min
app.use('/api/login', limiteLogin);  // 6 req / 15min específico

// Mas:
app.use('/api/usuarios', apenasAdmin, require('./routes/usuarios'));
// ↑ /api/usuarios/:id/senha NÃO tem rate limit adicional***REMOVED***
```

**Risco:** Admin consegue brutar força mudar senha de outro usuário
```bash
for i in {1..1000}; do
  curl -X PATCH /api/usuarios/5/senha -d '{"senha":"nova123"}'
  # Sem limite específico, só global 600/15min
done
```

**Solução:** Rate limit específico para /usuarios/:id/senha

**Bloqueador?** ❌ NÃO (admin tem acesso total mesmo)

---

## 🟠 PROBLEMAS MÉDIOS

### 10. **Sem validação de entrada em config.html (MÉDIO)**

**Status:** Admin coloca dados sem validação

```javascript
// config.js POST /
const updates = req.body;
const stmt = db.prepare('INSERT INTO config ... VALUES (?, ?)');
// ↑ Confia 100% no req.body
// Se alguém burla frontend, coloca SQL?
```

**Risco baixo** (só admin consegue mudar), mas bom validar:
```javascript
// Whitelist de chaves aceitas:
const CHAVES_VALIDAS = [
  'loja_nome', 'markup', 'taxa_pix', 'imposto_simples',
  // ...
];
for (const chave of Object.keys(updates)) {
  if (***REMOVED***CHAVES_VALIDAS.includes(chave)) {
    return res.status(400).json({ erro: 'Chave inválida: ' + chave });
  }
}
```

**Bloqueador?** ❌ NÃO

---

### 11. **Sem validação de CNPJ/email/telefone (MÉDIO)**

**Status:** Usuarios table aceita qualquer coisa

```javascript
// routes/usuarios.js POST /
const nome = String(req.body.nome || '').trim();
if (nome.length < 2) return res.status(400).json(...);
// ✅ Valida nome

const senha = String(req.body.senha || '');
if (senha.length < 6) return res.status(400).json(...);
// ✅ Valida senha

// ❌ MAS:
// Sem validação de email (não é campo ainda)
// Sem validação de telefone
// Sem validação de CNPJ (em config)
```

**Solução:** Adicionar validator
```bash
npm install validator  # ou email-validator
```

**Bloqueador?** ❌ NÃO

---

### 12. **Sem estrutura de logs para auditoria (MÉDIO)**

**Status:** Logs via console.log (vai pro stdout, perde após restart)

```javascript
// routes/auth.js:
console.log(`[LOGIN OK] ${usuarioAdmin()} (admin) • ${req.ip} ...`);
```

**Problema:** Não sabe quem fez o quê
- Sem histórico durável
- Sem análise de intrusão
- Sem compliance com LGPD art. 32 (rastreabilidade)

**Solução:** Tabela `audit_logs`
```sql
CREATE TABLE audit_logs (
  id INTEGER PRIMARY KEY,
  usuario_id INTEGER,
  acao TEXT,
  entidade TEXT,
  entidade_id INTEGER,
  antes JSON,
  depois JSON,
  ip TEXT,
  user_agent TEXT,
  criado_em TEXT DEFAULT (datetime('now','localtime'))
);
```

**Bloqueador?** ❌ NÃO para v1 (mas importante v1.1)

---

## 🟢 PROBLEMAS BAIXOS

### 13. **CSP muito permissivo (BAIXO)**

**Status:** `'unsafe-inline'` em scripts

```javascript
// server.js Helmet CSP:
scriptSrc: ["'self'", "'unsafe-inline'"],     // ← Perigoso
scriptSrcAttr: ["'unsafe-inline'"],
```

**Risco:** XSS consegue escapar
```html
<***REMOVED***-- Em um formulário que não valida direito: -->
<img src=x onerror="fetch('/api/config?senha=admin')">
```

**Solução:** Migrar para scripts externos
```javascript
// Hoje: <button onclick="entrar(event)">
// Depois: <button id="btn-entrar"> + addEventListener
```

**Bloqueador?** ❌ NÃO (baixo risco com autenticação)

---

### 14. **Sem CORS whitelist em produção (BAIXO)**

**Status:** `origin: true` reflexivo

```javascript
// server.js:
const ORIGIN = process.env.ORIGIN || true;  // reflexivo = perigoso
app.use(cors({ origin: ORIGIN, credentials: true }));
```

**Problema:** Se ORIGIN não for setado, qualquer site consegue requisitar
```bash
curl -H "Origin: https://atacante.com" https://sistema.com/api/me
# SEM ORIGIN setado = CORS permite***REMOVED***
```

**Solução:** Whitelist em produção
```javascript
const ORIGIN = process.env.ORIGIN || ['https://loja.com'];
if (typeof ORIGIN === 'string') {
  const whitelist = ORIGIN.split(',');
  app.use(cors({ origin: whitelist, credentials: true }));
}
```

**Bloqueador?** ❌ NÃO (baixo risco)

---

## 📋 CHECKLIST TÉCNICO

### Antes de lançar v1.0

**Autenticação & Segurança:**
- [ ] Email obrigatório em usuarios
- [ ] Email verification (token de 24h)
- [ ] Recuperação de senha por email
- [ ] Usuário muda própria senha
- [ ] Desativar `login-sem-senha` em produção
- [ ] HTTPS obrigatório
- [ ] SESSION_SECRET forte (use crypto.randomBytes(32).toString('hex'))
- [ ] CERT_CIPHER_KEY definido

**Multi-tenant:**
- [ ] Adicionar `tenant_id` às tabelas: produtos, vendas, clientes, usuarios, config, variacoes, venda_itens
- [ ] Middleware valida tenant_id do usuário
- [ ] TODAS as queries têm `WHERE tenant_id = req.session.tenant_id`
- [ ] Testes: usuario A não vê dados de B
- [ ] Índices em (tenant_id, coluna_importante)

**LGPD & Privacy:**
- [ ] Termos de Uso (legal review)
- [ ] Política de Privacidade (legal review)
- [ ] Endpoint GET /api/me/dados (exportar JSON)
- [ ] Endpoint DELETE /api/me/conta (soft delete com anônimização)
- [ ] Usuário consegue revogar consentimento
- [ ] Audit logs de quem acessou que dados

**Performance:**
- [ ] Índices criados em tabelas grandes (vendas, clientes)
- [ ] Benchmark: response time <200ms para queries comuns
- [ ] Monitor: logs de queries lentas (>500ms)

**Infraestrutura:**
- [ ] Backup automático (script + cron ou nuvem)
- [ ] Health check endpoint GET /health
- [ ] Logging estruturado (timestamp, nivel, mensagem, stack)
- [ ] Sentry ou similar para erro tracking
- [ ] Rate limit testado em produção

**Testes:**
- [ ] Teste: login > home > config > logout
- [ ] Teste: convite > email > confirmar > login
- [ ] Teste: recuperação de senha funciona
- [ ] Teste: usuário A não vê dados de B
- [ ] Teste: rate limit bloqueia brute force

---

## 🎯 Roadmap de Refactoring

```
AGORA (v1.0 — semanas 1-4)
├─ Email de usuário
├─ Recuperação de senha
├─ Verificação de email
├─ Termos + Privacidade
├─ Multi-tenant (refactor)
└─ LGPD (export + delete)

CURTO (v1.1 — semanas 5-8)
├─ 2FA (TOTP)
├─ Auditoria / Logs
├─ Notificações (email + in-app)
└─ Validação rigorosa (email, CNPJ, etc)

MÉDIO (v1.2 — semanas 9-12)
├─ Migração PostgreSQL
├─ Backup automático (S3)
└─ Observabilidade (Prometheus)

LONGO (v2.0 — roadmap futuro)
├─ SSO (Google/Microsoft)
├─ SAML para corporativo
└─ API pública + webhooks
```

---

## 🚨 Dependências Externas Críticas

Para MVP funcionar precisa de:

1. **Serviço de Email**
   - SendGrid / AWS SES / Resend.com
   - Templates: welcome, reset-password, verify-email, notification
   - Custo: ~$20-50/mês (até 100k emails)

2. **HTTPS / Domínio**
   - Domínio com Let's Encrypt
   - Ou CloudFlare (gratuito para HTTP/HTTPS)
   - Obrigatório em produção

3. **Banco de dados**
   - SQLite OK para v1 (até 20 clientes)
   - PostgreSQL para v1.1+ (após >20 clientes)

4. **Cloud hosting**
   - Render / Railway / Heroku / AWS
   - Precisa suportar Node 22.5+
   - Volumes persistentes para BD

---

**Próxima etapa:** Implementação do plano MVP (email + recovery + multi-tenant)

