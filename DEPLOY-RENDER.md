# 🚀 Deploy Render — Tarefa 9.2-9.5

**Status:** Pronto para deploy  
**Tempo estimado:** 2-3h (staging + produção)  
**Deadline:** 25/07/2026

---

## 📋 Checklist Pré-Deploy

- ✅ Testes locais PASSARAM (Tarefa 9.1)
- ✅ API Key SendGrid real configurada
- ✅ Credenciais AWS S3 validadas
- ✅ Banco de dados SQLite criado
- ✅ Licença ativada (.license criado)
- ✅ `.env.example` atualizado (sem secrets)

---

## 🎯 Arquitetura Deploy

```
┌─────────────────────┐
│  easygestao.com     │ (Hostinger — seu domínio)
│  (DNS → Render)     │
└────────────┬────────┘
             │ HTTPS
             ▼
     ┌──────────────────┐
     │  Render.com      │ (Node.js)
     │  ├─ Staging      │ (validação)
     │  └─ Produção     │ (público)
     └────────┬─────────┘
              │
         ┌────┴────┐
         │          │
     ┌───▼──┐  ┌───▼────┐
     │SQLite│  │AWS S3  │
     │  DB  │  │Backups │
     └──────┘  └────────┘
```

---

## 🔧 Passo 1: Criar Conta Render

1. Acesse [render.com](https://render.com)
2. Sign up com GitHub/Google
3. Conectar repositório GitHub (ou criar sem repo)

---

## 📦 Passo 2: Preparar Repo GitHub

Se não tiver repo ainda, crie:

```bash
cd c:\Users\Igor Gomes\OneDrive\Documentos\Igor MP\EASYGESTION

git init
git add .
git commit -m "Initial commit: EasyGestão MVP"
git remote add origin https://github.com/SEU_USER/easygestion.git
git push -u origin main
```

**Arquivos a NÃO fazer commit:**
- `.env` (tem secrets!)
- `node_modules/`
- `db/dsstore.db` (será criado no Render)
- `.license` (será gerado no Render)

Confirmar `.gitignore`:

```gitignore
.env
node_modules/
db/*.db
.license
*.log
uploads/
Midiakit/
```

---

## 🚀 Passo 3: Deploy Staging no Render

### 3.1 Criar Web Service (Node.js)

1. Dashboard Render → New → Web Service
2. Conectar repo GitHub
3. Configurar:
   - **Name:** easygestion-staging
   - **Environment:** Node
   - **Build Command:** `npm install`
   - **Start Command:** `npm start`
   - **Plan:** Free (bom pra staging)

### 3.2 Configurar Environment Variables

No painel Render → Environment (copie do seu `.env` local, NÃO do Git):

```env
NODE_ENV=staging
PORT=3000
SESSION_SECRET=[seu-secret-muito-seguro-min-32-caracteres-aleatorio]

SENDGRID_API_KEY=[cole-aqui-sua-chave-sendgrid]
LOJA_EMAIL=noreply@easygestao.com
LOJA_NOME=EasyGestão

AWS_ACCESS_KEY_ID=[cole-aqui-sua-chave-aws]
AWS_SECRET_ACCESS_KEY=[cole-aqui-seu-secret-aws]
AWS_S3_BUCKET=easygestao-backups
AWS_REGION=sa-east-1

ADMIN_SENHA=[cole-aqui-sua-senha-admin]

# Opcionais
ORIGIN=https://easygestion-staging.onrender.com
```

⚠️ **NUNCA faça commit de `.env` ou credenciais no Git. Use variáveis de ambiente do Render.**

### 3.3 Deploy

1. Clique em Deploy
2. Aguarde ~2 min (Render instala dependências)
3. Acesse: `https://easygestion-staging.onrender.com`

---

## ✅ Passo 4: Testar Staging

```bash
# 1. Homepage deve funcionar
curl https://easygestion-staging.onrender.com/

# 2. Registro deve funcionar
curl -X POST https://easygestion-staging.onrender.com/api/registro \
  -H "Content-Type: application/json" \
  -d '{
    "email": "staging@teste.com",
    "senha": "senha123",
    "nome_loja": "Staging Test",
    "nome_responsavel": "Igor",
    "telefone": "11987654321"
  }'

# 3. Login deve funcionar
curl -X POST https://easygestion-staging.onrender.com/api/login \
  -H "Content-Type: application/json" \
  -d '{
    "email": "staging@teste.com",
    "senha": "senha123"
  }'

# 4. Logs deve estar limpo (sem erros 500)
# Render Dashboard → Logs
```

---

## 🎯 Passo 5: Deploy Produção

### 5.1 Criar Novo Web Service

**Opção A: Clonar do Staging (recomendado)**
1. Render Dashboard → easygestion-staging → Settings
2. Clone ou crie novo com mesmo config

**Opção B: Criar do zero**
1. New → Web Service
2. Mesmo repo, mesma config

### 5.2 Configurar para Produção

```env
NODE_ENV=production
PORT=3000
SESSION_SECRET=outro-secret-muito-forte-aleatorio-aqui
ORIGIN=https://easygestao.com

# Resto igual a staging
```

### 5.3 Conectar Domínio

#### No Render:
1. Web Service → Settings → Custom Domains
2. Adicionar: `easygestao.com`
3. Render gera CNAME automaticamente

#### Na Hostinger (seu registrador):
1. Acesse DNS do domínio
2. Adicione CNAME record:
   - **Host:** @ (ou www)
   - **Type:** CNAME
   - **Target:** (Render te dá o valor)
3. Aguarde propagação (5-30 min)

### 5.4 HTTPS Automático

Render gera certificado SSL automaticamente via Let's Encrypt.
- Não precisa fazer nada
- Clique em "Auto Redirect HTTP to HTTPS" ✅

---

## 🔒 Passo 6: Segurança

### 6.1 Bloquear Staging no Robots.txt

Crie `public/robots.txt`:

```
User-agent: *
Disallow: /  # Bloqueado no staging
```

Mude em produção para:
```
User-agent: *
Disallow: /admin  # Apenas admin bloqueado
Allow: /
```

### 6.2 Health Check

Render pode fazer health check. Adicione em `server.js`:

```javascript
app.get('/health', (req, res) => {
  res.status(200).json({ status: 'ok', timestamp: new Date().toISOString() });
});
```

Configure em Render → Settings → Health Check Path: `/health`

---

## 📊 Passo 7: Monitoramento

### 7.1 Uptime Robot (Gratuito)

1. Acesse [uptime.com](https://uptime.com)
2. Nova Monitor → HTTPS
3. URL: `https://easygestao.com`
4. Interval: 5 min
5. Alert: Email
6. Salvar

### 7.2 Sentry (Opcional — Gratuito)

1. Crie conta em [sentry.io](https://sentry.io)
2. Crie projeto Node.js
3. Copie DSN (chave de integração)
4. Instale: `npm install @sentry/node`
5. Configure em `server.js`:

```javascript
const Sentry = require('@sentry/node');

Sentry.init({
  dsn: process.env.SENTRY_DSN,
  environment: process.env.NODE_ENV,
});
app.use(Sentry.Handlers.errorHandler());
```

---

## 🧪 Passo 8: Testes em Produção

Depois que deploy for live:

### 8.1 Golden Path
```bash
# Acesse easygestao.com
# 1. Registro funciona
# 2. Login funciona
# 3. Criar cliente funciona
# 4. Logout funciona
```

### 8.2 Backup
```bash
# Verificar se backup automático roda (22h)
# Logs do Render → deve mostrar backup OK
```

### 8.3 Email
```bash
# Fazer /forgot-password
# Verificar SendGrid dashboard se email foi enviado
```

### 8.4 Performance
```bash
# Ferramentas:
# - Google PageSpeed Insights (easygestao.com)
# - Render Metrics (dashboard)
# - Uptime Robot (status page)
```

---

## 🚨 Troubleshooting

| Erro | Causa | Solução |
|------|-------|---------|
| 502 Bad Gateway | App crashed | Ver logs Render → investigar erro |
| 503 Service Unavailable | Deploy em andamento | Aguardar ~2 min |
| Banco não persiste | SQLite em /tmp | Usar PostgreSQL (Render oferece free) |
| Email não envia | API key inválida | Verificar SENDGRID_API_KEY no Render |
| Domínio não resolve | DNS não propagou | Aguardar 30 min, verificar CNAME |

---

## 📝 Checklist Final

- [ ] Repo GitHub criado e pushado
- [ ] Staging deploy OK (responde em staging URL)
- [ ] Testes staging PASSAM (registro, login, logout)
- [ ] Produção deploy OK (responde em easygestao.com)
- [ ] Certificado SSL automático ativado
- [ ] Backup S3 rodando
- [ ] Email SendGrid OK
- [ ] Uptime Robot monitorando
- [ ] Logs limpando (sem erros 500)
- [ ] Performance OK (< 2s load time)

---

## 🎬 Próximas Etapas

1. **Após deploy:** Validação Final (Tarefa 10)
2. **Clientes Piloto:** Testar com 1-2 lojas reais
3. **Ajustes:** Correções conforme feedback
4. **Go Live:** Anunciar para lojistas

---

**Última atualização:** 2026-06-19  
**Responsável:** Claude Code  
**Tempo total:** ~3h (do início ao go live em produção)
