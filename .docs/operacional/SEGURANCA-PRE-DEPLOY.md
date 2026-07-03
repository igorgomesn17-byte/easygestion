# 🔐 CHECKLIST DE SEGURANÇA PRÉ-DEPLOY

**Data:** 25 JUN 2026  
**Status:** ✅ P0 (Críticos) Corrigidos  

---

## ✅ O que foi corrigido (25 JUN)

### P0-1: Rate Limit Admin
- ✅ **ATIVADO** — Protege contra brute force na senha do admin
- Localização: `middleware/seguranca.js:214`
- Limite: 6 tentativas / 15 minutos por IP

### P0-2: TOKEN_SECRET
- ✅ **VALIDAÇÃO ADICIONADA** — Erro fatal se não configurado
- Localização: `routes/auth.js:12-26`
- Comportamento: Exit(1) se vazio em produção

### P0-3: CERT_CIPHER_KEY
- ✅ **VALIDAÇÃO ADICIONADA** — Erro fatal se não configurado
- Localização: `routes/config.js:92-111`
- Comportamento: Exit(1) se vazio em produção

### P0-4: DEPLOY_TOKEN
- ✅ **VALIDAÇÃO ADICIONADA** — Erro fatal se não configurado
- Localização: `routes/deploy.js:5-30`
- Comportamento: Exit(1) se vazio

### P0-5: .env Commitado (AWS Credentials)
- ✅ **GIT HISTORY LIMPO** — (2026-06-23)
- Status: Verificação necessária para rotação de AWS keys
- Ação: Confirmar que AWS gerou nova chave e antigas foram revogadas

---

## 🔑 Variáveis Obrigatórias em Produção

Antes de fazer deploy, CONFIRME que estas estão no seu `.env` em produção:

```bash
# ✅ CRÍTICOS
NODE_ENV=production
ADMIN_SENHA_HASH=scrypt$<salt>$<hash>  # ou ADMIN_SENHA
TOKEN_SECRET=<32-random-hex-chars>
CERT_CIPHER_KEY=<32-random-hex-chars>
DEPLOY_TOKEN=<32-random-hex-chars>

# 🟡 RECOMENDADO
ORIGIN=https://www.easygestao.com    # Seu domínio
SENDGRID_API_KEY=SG.xxx
STRIPE_SECRET_KEY=sk_test_...
DB_DIR=/var/lib/easygestion          # Persistência fora do app

# ⚠️  NÃO use em .env:
# - Credenciais AWS (use IAM roles na EC2)
# - Credenciais de banco de dados (SQLite local)
# - Senhas em texto plano (use ADMIN_SENHA_HASH)
```

---

## 🚨 Gerador de Secrets Seguros

Se precisar gerar novos secrets:

```bash
# Gerar TOKEN_SECRET
node -e "console.log('TOKEN_SECRET=' + require('crypto').randomBytes(32).toString('hex'))"

# Gerar CERT_CIPHER_KEY
node -e "console.log('CERT_CIPHER_KEY=' + require('crypto').randomBytes(32).toString('hex'))"

# Gerar DEPLOY_TOKEN
node -e "console.log('DEPLOY_TOKEN=' + require('crypto').randomBytes(32).toString('hex'))"

# Gerar ADMIN_SENHA_HASH (do .env)
node -e "
const c = require('crypto');
const senha = 'SUA_SENHA_AQUI';
const salt = c.randomBytes(16).toString('hex');
const h = c.scryptSync(senha, salt, 64).toString('hex');
console.log('ADMIN_SENHA_HASH=scrypt\$' + salt + '\$' + h);
"
```

---

## ✅ Validação de Boot

Quando a app inicia, ela valida automaticamente:

1. ✅ `ADMIN_SENHA_HASH` ou `ADMIN_SENHA` está configurado
2. ✅ `TOKEN_SECRET` está configurado
3. ✅ `CERT_CIPHER_KEY` está configurado
4. ✅ `DEPLOY_TOKEN` está configurado
5. ✅ `ORIGIN` está configurado em produção
6. ✅ `NODE_ENV` está configurado

**Se algum falhar → App não inicia (protege contra exposição)**

---

## 🔍 Verificação de Credenciais Expostas

### AWS (Incidente 2026-06-23)
- ✅ Git history limpo
- ⏳ **PENDENTE:** Confirmar rotação de AWS keys
  - Ação: IAM → easygestao user → Create new access key
  - Ação: Atualizar key nova em produção
  - Ação: Revogar key antiga: `AKIAQJP5WPAFTCCEXW7Z`

### GitHub Secret Scanning
- Ativar em: Settings → Security → Secret scanning
- Isso detectará credenciais em commits futuros

### .gitignore
- ✅ `.env` está no `.gitignore`
- ✅ `.env.local` está no `.gitignore`
- ✅ `.env.production` está no `.gitignore`

---

## 📋 Próximos Passos

### Hoje (você está aqui)
- [x] Corrigir P0-1 a P0-4 (validações de segurança)
- [x] Confirmar que credenciais não estão expostas
- [ ] **Você:** Rotacionar AWS keys se ainda não fez
- [ ] **Você:** Gerar novo `.env` com todos os secrets

### Amanhã
- [ ] Deploy em produção com `.env` novo
- [ ] Testar que app inicia sem erros
- [ ] Health check: `GET /health` retorna 200

### Próxima semana
- [ ] Testar com 1 cliente beta
- [ ] Corrigir P1 (validações de negócio)

---

## 🚀 Como Fazer Deploy Seguro

```bash
# 1. Gerar novo .env com secrets
echo "NODE_ENV=production" > .env.production
echo "TOKEN_SECRET=$(node -e 'console.log(require(\"crypto\").randomBytes(32).toString(\"hex\"))')" >> .env.production
# ... adicione os demais secrets

# 2. Copiar para servidor
scp -i chave.pem .env.production usuario@54.232.77.5:/opt/easygestion/

# 3. Conectar e ativar
ssh -i chave.pem usuario@54.232.77.5
cd /opt/easygestion
mv .env.production .env
npm install
npm start  # ou pm2 restart

# 4. Verificar
curl http://localhost:3001/health
```

---

## ❌ Erros Comuns (se vir esses, a app vai falhar no boot)

```
❌ ERRO CRÍTICO: TOKEN_SECRET não está configurado!
→ Solução: Adicione TOKEN_SECRET ao .env

❌ ERRO CRÍTICO: CERT_CIPHER_KEY não está configurado!
→ Solução: Adicione CERT_CIPHER_KEY ao .env

❌ ERRO CRÍTICO: DEPLOY_TOKEN não configurado!
→ Solução: Adicione DEPLOY_TOKEN ao .env

❌ ERRO CRÍTICO: ORIGIN deve estar configurado em produção!
→ Solução: Adicione ORIGIN=https://seudominio.com ao .env
```

---

## 📞 Se Algo Quebrar

1. **App não inicia:** Ver logs → `npm start` com NODE_ENV=development primeiro
2. **Login falha:** Verificar ADMIN_SENHA_HASH format (deve ser `scrypt$salt$hash`)
3. **Certificado não carrega:** Verificar CERT_CIPHER_KEY (deve ser 32+ chars)
4. **Deploy webhook retorna 401:** Verificar DEPLOY_TOKEN e x-deploy-token header

---

**Data:** 25 JUN 2026  
**Próxima revisão:** Após deploy em produção
