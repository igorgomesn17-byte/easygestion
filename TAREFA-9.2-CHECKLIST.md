# ✅ Tarefa 9.2-9.5 — Checklist Executável

**Timeline:** Jun 20-21 (2 dias)  
**Tempo total:** ~3.5h  
**Status:** PRONTO PARA INICIAR

---

## 📋 TAREFA 9.2: Deploy Staging (2h)

### Passo 1: GitHub Setup (15 min)

- [ ] **1.1** Acesse https://github.com/new
- [ ] **1.2** Crie repo: `easygestion`
- [ ] **1.3** Description: "SaaS Multi-Tenant para Lojistas de Moda"
- [ ] **1.4** Make it Public (assim qualquer um vê)
- [ ] **1.5** Clique "Create repository"

### Passo 2: Push Local → GitHub (5 min)

```bash
cd c:\Users\Igor Gomes\OneDrive\Documentos\Igor MP\EASYGESTION

# Ou rode o script
.\scripts\push-github.ps1

# Se der erro de autenticação:
# Windows pode pedir permissão — use seu token do GitHub se solicitado
```

- [ ] **2.1** Código foi pro GitHub
- [ ] **2.2** Verificar em: https://github.com/igorgomesn17/easygestion

### Passo 3: Render Setup (30 min)

#### 3.1: Criar Conta Render
- [ ] **3.1.1** Acesse https://render.com
- [ ] **3.1.2** Sign up com GitHub
- [ ] **3.1.3** Autorize Render

#### 3.2: Deploy Staging
- [ ] **3.2.1** Dashboard → "New" → "Web Service"
- [ ] **3.2.2** Selecione repo: `easygestion`
- [ ] **3.2.3** Preencha:
  - Name: `easygestion-staging`
  - Environment: Node
  - Region: São Paulo (ou mais perto de você)
  - Build Command: `npm install`
  - Start Command: `npm start`
  - Plan: Free

#### 3.3: Environment Variables
- [ ] **3.3.1** Clique "Environment"
- [ ] **3.3.2** Copie de `SETUP-RENDER-PASSO-A-PASSO.md` (seção 2.3)
- [ ] **3.3.3** Cole na interface Render:
  ```
  NODE_ENV=staging
  SESSION_SECRET=seu-secret-aleatorio-min-32-chars
  SENDGRID_API_KEY=SG.xxx...
  AWS_ACCESS_KEY_ID=AKIA...
  ... (resto das variáveis)
  ```

#### 3.4: Deploy
- [ ] **3.4.1** Clique "Create Web Service"
- [ ] **3.4.2** Aguarde build (leva ~3 min)
- [ ] **3.4.3** Quando terminar, deve mostrar: "Your service is live"
- [ ] **3.4.4** Copie a URL: `https://easygestion-staging.onrender.com`

### Passo 4: Testar Staging (15 min)

```bash
# Teste 1: Homepage
curl https://easygestion-staging.onrender.com/
# Esperado: Status 200, retorna HTML

# Teste 2: Registro
curl -X POST https://easygestion-staging.onrender.com/api/registro \
  -H "Content-Type: application/json" \
  -d '{"email":"staging@teste.com","senha":"senha123","nome_loja":"Staging","nome_responsavel":"Igor","telefone":"11987654321"}'
# Esperado: Status 201

# Teste 3: Login
curl -X POST https://easygestion-staging.onrender.com/api/login \
  -H "Content-Type: application/json" \
  -d '{"email":"staging@teste.com","senha":"senha123"}'
# Esperado: Status 200
```

- [ ] **4.1** Homepage funciona (status 200)
- [ ] **4.2** Registro funciona (status 201)
- [ ] **4.3** Login funciona (status 200)
- [ ] **4.4** Logs Render estão limpos (sem erro 500)

---

## 🌍 TAREFA 9.3: HTTPS + Domínio (1h)

### Passo 1: Deploy Produção (15 min)

- [ ] **1.1** Dashboard Render → easygestion-staging
- [ ] **1.2** Settings → "Clone"
- [ ] **1.3** Nome: `easygestion-prod`
- [ ] **1.4** Mudar apenas 2 variáveis:
  ```
  NODE_ENV=production
  ORIGIN=https://easygestao.com
  SESSION_SECRET=outro-secret-aleatorio-diferente
  ```
- [ ] **1.5** Deploy***REMOVED***

### Passo 2: Conectar Domínio (30 min)

#### 2.1: No Render
- [ ] **2.1.1** Dashboard → easygestion-prod → Settings
- [ ] **2.1.2** Scroll para "Custom Domains"
- [ ] **2.1.3** Clique "Add Custom Domain"
- [ ] **2.1.4** Digitar: `easygestao.com`
- [ ] **2.1.5** Render gera um CNAME record (copie)

#### 2.2: Na Hostinger
- [ ] **2.2.1** Acesse Hostinger → Gerenciar Domínio
- [ ] **2.2.2** DNS → Adicione CNAME:
  - Host: `@` (ou `www`)
  - Type: `CNAME`
  - Target: (copie do Render)
  - TTL: 3600
- [ ] **2.2.3** Salvar

#### 2.3: Aguardar Propagação
- [ ] **2.3.1** Aguarde 5-30 min
- [ ] **2.3.2** Teste:
  ```bash
  nslookup easygestao.com
  # Deve retornar IP do Render
  ```
- [ ] **2.3.3** Acesse https://easygestao.com (deve funcionar***REMOVED***)

### Passo 3: HTTPS Automático (5 min)

- [ ] **3.1** Render → easygestion-prod → Settings
- [ ] **3.2** Ativar: "Auto Redirect HTTP to HTTPS"
- [ ] **3.3** Certificado SSL vai gerar automático (pode levar alguns min)

---

## ✅ TAREFA 9.4: Testes Produção (30 min)

```bash
# Teste 1: Certificado
curl -I https://easygestao.com/
# Esperado: Status 200, "SSL certificate valid"

# Teste 2: Registro
curl -X POST https://easygestao.com/api/registro \
  -H "Content-Type: application/json" \
  -d '{"email":"prod@teste.com","senha":"senha123","nome_loja":"Prod","nome_responsavel":"Igor","telefone":"11987654321"}'
# Esperado: Status 201

# Teste 3: Login
curl -X POST https://easygestao.com/api/login \
  -H "Content-Type: application/json" \
  -d '{"email":"prod@teste.com","senha":"senha123"}'
# Esperado: Status 200

# Teste 4: Email
# Fazer: POST /api/forgot-password com seu email
# Verificar: SendGrid Dashboard → Logs (email deve estar "Sent")
```

- [ ] **4.1** HTTPS funciona (status 200, SSL válido)
- [ ] **4.2** Registro funciona
- [ ] **4.3** Login funciona
- [ ] **4.4** Email SendGrid envia
- [ ] **4.5** Logs Render sem erros
- [ ] **4.6** Performance < 2s

---

## 📊 TAREFA 9.5: Monitoramento (30 min)

### Passo 1: Uptime Robot

- [ ] **1.1** Acesse https://uptime.com
- [ ] **1.2** Sign up (grátis)
- [ ] **1.3** Novo Monitor → HTTPS
- [ ] **1.4** URL: `https://easygestao.com`
- [ ] **1.5** Interval: 5 min
- [ ] **1.6** Alertas: Email
- [ ] **1.7** Salvar

Agora você recebe email se o site cair***REMOVED*** ✅

### Passo 2: Health Check Render

- [ ] **2.1** Render → easygestion-prod → Settings
- [ ] **2.2** Health Check Path: `/health`
- [ ] **2.3** Salvar (Render monitora automaticamente)

---

## 🎯 RESUMO RÁPIDO

| Tarefa | O Quê | Tempo | Status |
|--------|-------|-------|--------|
| 9.2.1 | GitHub repo | 15 min | [ ] |
| 9.2.2 | Push code | 5 min | [ ] |
| 9.2.3 | Render staging | 30 min | [ ] |
| 9.2.4 | Testar staging | 15 min | [ ] |
| 9.3.1 | Produção deploy | 15 min | [ ] |
| 9.3.2 | Conectar domínio | 30 min | [ ] |
| 9.3.3 | HTTPS + DNS | 5 min | [ ] |
| 9.4 | Testes produção | 30 min | [ ] |
| 9.5 | Monitoramento | 30 min | [ ] |
| **Total** | | **~3.5h** | |

---

## 🚀 COMANDOS RÁPIDOS

### Push pro GitHub
```bash
cd c:\Users\Igor Gomes\OneDrive\Documentos\Igor MP\EASYGESTION
git push -u origin master
```

### Testar Staging
```bash
curl https://easygestion-staging.onrender.com/
```

### Testar Produção
```bash
curl https://easygestao.com/
```

### Ver Logs Render
```bash
# Clique em: Dashboard → Service → Logs
```

---

## ⚠️ PONTOS CRÍTICOS

1. **Repositório GitHub:** Precisa estar PUBLIC (Render conseguir acessar)
2. **Environment Variables:** TODAS as variáveis precisam estar no Render (não podem estar apenas no `.env` local)
3. **DNS Propagação:** Pode levar até 30 min — tenha paciência
4. **HTTPS:** Render faz automático, mas pode levar alguns minutos
5. **Backup S3:** Às 22h vai rodar automaticamente — verifique os logs

---

## ✨ Depois de Pronto

Depois que tudo estiver 100% funcionando:

- [ ] Compartilhar `easygestao.com` com 1-2 beta testers
- [ ] Coletar feedback via WhatsApp/email
- [ ] Fazer ajustes se necessário
- [ ] Tarefa 10: Validação Final
- [ ] Go Live***REMOVED*** 🎉

---

## 📞 PROBLEMAS COMUNS

| Erro | Solução |
|------|---------|
| 502 Bad Gateway | Ver logs Render → npm install está rodando? |
| 503 Service Unavailable | Deploy ainda em progresso — aguardar 2 min |
| Domínio não funciona | DNS não propagou — aguardar 30 min |
| Email não envia | Verificar `SENDGRID_API_KEY` no Render |
| Banco vazio | SQLite em staging não persiste — normal, cria novo em cada deploy |

---

**Última atualização:** 19/06/2026  
**Próxima tarefa:** Tarefa 10 (Validação Final)  
**Status:** Pronto para começar***REMOVED*** ✅
