# 🔐 CONFIGURAR SECRETS NO GITHUB PARA CI/CD

**Status:** GitHub Actions workflow criado ✅  
**Próximo passo:** Adicionar secrets (2 minutos)

---

## 🎯 O que você precisa fazer:

1. Ir no GitHub
2. Adicionar 3 secrets
3. Pronto! Deploy automático estará ativo

---

## 📋 Step-by-Step

### 1️⃣ Abrir GitHub Settings

1. Abrir: https://github.com/igorgomesn17-byte/easygestion
2. Clicar em **Settings** (aba superior)
3. No menu esquerdo, procurar por **Secrets and variables**
4. Clicar em **Actions** (subseção)

### 2️⃣ Adicionar Secret #1: DEPLOY_PRIVATE_KEY

```
Nome: DEPLOY_PRIVATE_KEY
```

**Valor:** Sua chave SSH privada (arquivo `.pem`)

```bash
# Para obter sua chave privada (na sua máquina):
cat ~/.ssh/seu-pem-key.pem  # Linux/Mac
type C:\Users\seu-usuario\.ssh\seu-pem-key.pem  # Windows (PowerShell)
```

⚠️ **IMPORTANTE:** Copiar **TODO O CONTEÚDO** da chave, incluindo:
```
-----BEGIN RSA PRIVATE KEY-----
MIIEowIBAAKCAQEA...
...
-----END RSA PRIVATE KEY-----
```

### 3️⃣ Adicionar Secret #2: DEPLOY_HOST

```
Nome: DEPLOY_HOST
Valor: seu-ip-da-ec2  (ex: 52.123.456.789)
      OU seu-dominio.com (se já tem domínio apontado)
```

### 4️⃣ Adicionar Secret #3: DEPLOY_USER

```
Nome: DEPLOY_USER
Valor: ec2-user  (se for Amazon Linux)
      OU ubuntu  (se for Ubuntu)
      OU seu-usuario (qual quer que seja)
```

---

## 📸 Exemplo de como adicionar (prints)

```
GitHub.com → seu-repo → Settings → Secrets and variables → Actions
                                    ↓
                    "New repository secret"
                    ↓
    Nome: DEPLOY_PRIVATE_KEY
    Valor: [conteúdo da sua chave .pem]
    ↓ "Add secret"
```

Repetir para DEPLOY_HOST e DEPLOY_USER.

---

## ✅ Depois de Adicionar os Secrets

1. **Não precisa fazer mais nada!**
2. A próxima vez que você fazer `git push origin main`, o GitHub Actions será acionado automaticamente
3. Você verá o progresso em: https://github.com/igorgomesn17-byte/easygestion/actions

---

## 🧪 Testar o Deploy Automático

### Opção 1: Forçar novo deploy

```bash
git commit --allow-empty -m "test: trigger deploy"
git push origin main
```

### Opção 2: Ver logs do GitHub Actions

1. Abrir: https://github.com/igorgomesn17-byte/easygestion/actions
2. Ver a workflow "🚀 Deploy to AWS EC2"
3. Clicar para ver os logs em tempo real

### Opção 3: Verificar na EC2 se código foi atualizado

```bash
# SSH na EC2
ssh -i seu-pem-key.pem ec2-user@seu-ip

# Ver último commit
cd ~/EASYGESTION
git log --oneline -1

# Deveria mostrar algo como:
# 0570e63 🔄 CI/CD: GitHub Actions deploy automático na AWS EC2
```

---

## 🔍 Troubleshooting

### ❌ "Authentication failed"

**Problema:** Chave SSH não está funcionando  
**Solução:**
1. Verificar se `.pem` key está autorizada na EC2
2. Testar SSH manualmente: `ssh -i seu-pem-key.pem ec2-user@seu-ip`
3. Certificar que a chave privada está **completa** (sem espaços no início/fim)

### ❌ "Host key verification failed"

**Problema:** GitHub Actions não reconhece o servidor EC2  
**Solução:**
1. O workflow já tenta adicionar host key automaticamente
2. Se falhar, rodar manualmente na EC2:
```bash
ssh-keyscan seu-ip >> ~/.ssh/known_hosts
```

### ❌ "npm: command not found" ou "git: command not found"

**Problema:** Node.js ou Git não está instalado na EC2  
**Solução:** SSH na EC2 e instalar:
```bash
# Para Amazon Linux 2
sudo yum install -y nodejs git

# Para Ubuntu
sudo apt-get install -y nodejs npm git
```

### ❌ "PM2 not found"

**Problema:** PM2 não está instalado  
**Solução:**
```bash
sudo npm install -g pm2
pm2 startup
pm2 save
```

---

## 📊 Pipeline de Deploy Automático

```
Você faz git push
         ↓
GitHub Actions começa
         ↓
1. Checkout do código
2. Configura SSH
3. Clone/pull repositório na EC2
4. npm ci (instala dependências)
5. npm test (roda testes)
6. Executa migrações do BD
7. Reinicia app com PM2
8. Verifica health check
         ↓
✅ Pronto! Novo código está em produção
```

---

## 🎯 Próximas Ativações

De agora em diante, **toda vez que você fizer push** em `main`:

```bash
# Local
git commit -m "sua mensagem"
git push origin main

# No GitHub Actions (automático)
# ✅ Deploy roda automaticamente
# ✅ Código é atualizado na produção
# ✅ Aplicação é reiniciada
```

---

## 📝 Checklist Final

- [ ] Abrir GitHub Settings
- [ ] Adicionar DEPLOY_PRIVATE_KEY
- [ ] Adicionar DEPLOY_HOST
- [ ] Adicionar DEPLOY_USER
- [ ] Testar fazendo um push
- [ ] Verificar logs em /actions
- [ ] Confirmar que código foi atualizado na EC2

---

## 🚀 Você está pronto!

**Sistema está 100% configurado para deploy automático!**

A partir de agora:
- ✅ Cada push em `main` atualiza a produção automaticamente
- ✅ Testes são rodados antes de fazer deploy
- ✅ Health check verifica se a app está saudável
- ✅ Você pode acompanhar tudo em /actions

---

**Tempo necessário:** 2 minutos ⏱️  
**Dificuldade:** ⭐ Fácil  
**Valor gerado:** 💰💰💰 Enorme (automação total)

