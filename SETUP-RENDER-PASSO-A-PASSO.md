# 🚀 Setup Render — Passo a Passo Ilustrado

**Objetivo:** Deploy em staging + produção  
**Tempo:** 30 min total  
**Custo:** FREE (até 750h/mês)

---

## 📋 Checklist PRÉ-RENDER

- [ ] Repositório GitHub criado (igorgomesn17/easygestion)
- [ ] Código feito push pro GitHub
- [ ] `.env.example` tem todas as variáveis (sem secrets)
- [ ] `.gitignore` ignora `.env` e `node_modules`

---

## 🔧 PASSO 1: Criar Conta Render

### 1.1 Acesse Render
1. Abra [render.com](https://render.com)
2. Clique em "Get Started"
3. Sign up com GitHub

### 1.2 Conectar GitHub
- Clique "Connect GitHub"
- Autorize Render a acessar sua conta
- Selecione os repositórios que quer (ou deixar todos)

---

## 🌐 PASSO 2: Deploy Staging

### 2.1 Criar Web Service
1. Dashboard Render → "New" → "Web Service"
2. Selecionar repo: `igorgomesn17/easygestion`
3. Conectar

### 2.2 Configurar Build

```
Name:                easygestion-staging
Environment:         Node
Region:              São Paulo (sa-east-1)
Build Command:       npm install
Start Command:       npm start
Plan:                Free
```

### 2.3 Environment Variables

No painel "Environment", adicione:

```env
NODE_ENV=staging
PORT=3000
SESSION_SECRET=seu-secret-aleatorio-muito-seguro-min-32-chars-aqui-use-uma-string-longa

SENDGRID_API_KEY=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
LOJA_EMAIL=noreply@easygestao.com
LOJA_NOME=EasyGestão

AWS_ACCESS_KEY_ID=AKIAQJP5WPAFTCCEXW7Z
AWS_SECRET_ACCESS_KEY=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
AWS_S3_BUCKET=easygestao-backups
AWS_REGION=sa-east-1

ADMIN_SENHA=Id172725

ORIGIN=https://easygestion-staging.onrender.com
```

### 2.4 Deploy
1. Clique em "Create Web Service"
2. Render começa a build (leva ~2-3 min)
3. Quando terminar, você vê: "Your service is live"

### 2.5 URL Staging
Seu app está em: `https://easygestion-staging.onrender.com`

**Teste:**
```bash
curl https://easygestion-staging.onrender.com/
# Deve retornar HTML da página
```

---

## ✅ TESTAR STAGING

Antes de ir para produção, valide:

### 1️⃣ Homepage
```bash
curl https://easygestion-staging.onrender.com/
# Status: 200
```

### 2️⃣ Registro
```bash
curl -X POST https://easygestion-staging.onrender.com/api/registro \
  -H "Content-Type: application/json" \
  -d '{
    "email": "staging@teste.com",
    "senha": "senha123",
    "nome_loja": "Staging Test",
    "nome_responsavel": "Igor",
    "telefone": "11987654321"
  }'
# Status: 201
```

### 3️⃣ Login
```bash
curl -X POST https://easygestion-staging.onrender.com/api/login \
  -H "Content-Type: application/json" \
  -d '{
    "email": "staging@teste.com",
    "senha": "senha123"
  }'
# Status: 200
```

### 4️⃣ Verificar Logs
- Dashboard Render → "Logs"
- Deve mostrar: `DS SISTEMA no ar***REMOVED*** (production)`
- Sem erros 500

---

## 🌍 PASSO 3: Deploy Produção

### 3.1 Clonar Staging
1. Dashboard Render → easygestion-staging → Settings
2. Clique em "Clone"
3. Nome: `easygestion-prod`
4. Pronto***REMOVED***

**OU** criar novo Web Service com mesmo setup

### 3.2 Configurar Produção

Trocar apenas essas vars:

```env
NODE_ENV=production
ORIGIN=https://easygestao.com
SESSION_SECRET=outro-secret-aleatorio-muito-diferente-deste-aqui-use-algo-novo
```

Resto fica igual.

### 3.3 Deploy
Clique "Deploy" e aguarde

---

## 🔗 PASSO 4: Conectar Domínio

### 4.1 No Render
1. Dashboard → easygestion-prod → Settings
2. Scroll até "Custom Domains"
3. Clique "Add Custom Domain"
4. Digitar: `easygestao.com`
5. Render gera um CNAME record

Exemplo:
```
CNAME: onrender.com
Value: easygestao-prod-xxxxx.onrender.com
```

### 4.2 Na Hostinger (seu registrador)
1. Acesse seu painel Hostinger
2. Vá em Gerenciar Domínio → DNS
3. Adicione um CNAME record:
   - **Host:** @ (ou www)
   - **Type:** CNAME
   - **Target:** (copie do Render)
   - **TTL:** 3600

4. Salvar

### 4.3 Aguardar Propagação
- Pode levar 5-30 min
- Teste com:
  ```bash
  nslookup easygestao.com
  # Deve retornar IP do Render
  ```

---

## 🔒 PASSO 5: HTTPS Automático

**Render faz tudo automaticamente***REMOVED*****

- Gera certificado Let's Encrypt grátis
- Válido por 90 dias (renova automático)
- Você NÃO faz nada

Apenas confirme em Render → Settings:
- [ ] "Auto Redirect HTTP to HTTPS" ✅

---

## 🧪 TESTAR PRODUÇÃO

Depois que DNS propagar:

### 1️⃣ Home
```bash
curl https://easygestao.com/
# Status: 200
```

### 2️⃣ Registro
```bash
curl -X POST https://easygestao.com/api/registro \
  -H "Content-Type: application/json" \
  -d '{
    "email": "prod@teste.com",
    "senha": "senha123",
    "nome_loja": "Prod Test",
    "nome_responsavel": "Igor",
    "telefone": "11987654321"
  }'
# Status: 201
```

### 3️⃣ Email Funciona?
- Fazer forgot-password
- Verificar SendGrid Dashboard → Logs
- Email deve aparecer em "Sent" ou "Bounced"

### 4️⃣ Backup Roda?
- Logs Render devem mostrar "Agendador de backup ativado"
- Às 22h deve rodar automaticamente

---

## 📊 MONITORAMENTO

### Uptime Robot (Gratuito)
1. Acesse [uptime.com](https://uptime.com)
2. Nova Monitor → HTTPS
3. URL: `https://easygestao.com`
4. Interval: 5 min
5. Alert via Email
6. Salvar

Agora você recebe email se o site cair.

### Render Metrics
- Dashboard Render → easygestion-prod → Metrics
- Ver: CPU, Memória, Requisições
- Alertas automáticos se exceder

---

## 🚨 TROUBLESHOOTING

| Erro | Causa | Solução |
|------|-------|---------|
| 502 Bad Gateway | Build falhou | Ver logs → npm install ou require() está errado |
| 503 Service Unavailable | Deploy em andamento | Aguardar 2-3 min |
| Banco não persiste | SQLite no /tmp | Considerar PostgreSQL (Render oferece) |
| Email não envia | API key inválida | Verificar SENDGRID_API_KEY em Render |
| Domínio não funciona | DNS não propagou | Aguardar 30 min, fazer `nslookup` |
| Auto redirect falha | HTTPS não ativado | Certificado Let's Encrypt demore alguns min |

---

## ✅ CHECKLIST FINAL

- [ ] Repo GitHub criado e pushed
- [ ] Staging deploy OK (responde em staging URL)
- [ ] Staging testes passam (registro, login, logout)
- [ ] Produção deploy OK (responde em easygestao.com)
- [ ] Certificado SSL automático ativado
- [ ] Backup automático rodando (22h)
- [ ] Email SendGrid OK (teste forgot-password)
- [ ] Uptime Robot monitorando
- [ ] Logs Render limpos (sem 500)
- [ ] Performance OK (< 2s load time)

---

## 🎬 PRÓXIMAS ETAPAS

**Após Deploy:**
1. Compartilhar staging com 1-2 beta testers
2. Coletar feedback
3. Fazer ajustes se necessário
4. Anunciar para lojistas

**Timeline:**
- Hoje: Terminamos Tarefa 9.2-9.5
- Amanhã: Tarefa 10 (Validação Final)
- Próxima semana: Go Live com beta testers

---

## 📞 SUPORTE RENDER

Se tiver problema no Render:
- Email: support@render.com
- Docs: https://render.com/docs
- Status: https://status.render.com

---

**Última atualização:** 19/06/2026  
**Tempo total:** ~30 min (incluindo propagação DNS)  
**Custo:** R$ 0,00 (plano free)
