# 🔐 Como Configurar GitHub Secrets para Deploy Automático

**Status:** ❌ Deploy falhou — Secrets não configurados

**Tempo:** 5 minutos

---

## O Problema

O GitHub Actions precisa de 3 secrets para fazer SSH na EC2:

```
❌ secrets.DEPLOY_PRIVATE_KEY  (sua chave privada .pem)
❌ secrets.DEPLOY_HOST         (IP da EC2: 54.232.77.5)
❌ secrets.DEPLOY_USER         (usuário SSH: ec2-user ou ubuntu)
```

Sem esses, o workflow não consegue conectar à EC2.

---

## Solução: Adicionar Secrets ao GitHub

### Step 1: Ir para o repositório GitHub

```
https://github.com/igorgomesn17-byte/easygestion/settings/secrets/actions
```

### Step 2: Adicionar 3 Secrets

#### 2a. DEPLOY_PRIVATE_KEY
```
Nome: DEPLOY_PRIVATE_KEY
Valor: (copiar conteúdo inteiro do arquivo easygestion-key.pem)
```

**Como pegar:**
```bash
cat easygestion-key.pem
# Copiar todo o conteúdo (from -----BEGIN to END)
```

**Colar no GitHub:**
```
-----BEGIN RSA PRIVATE KEY-----
MIIEowIBAAKCAQEA...
...
-----END RSA PRIVATE KEY-----
```

#### 2b. DEPLOY_HOST
```
Nome: DEPLOY_HOST
Valor: 54.232.77.5
```

#### 2c. DEPLOY_USER
```
Nome: DEPLOY_USER
Valor: ec2-user
```

(Se sua EC2 é Ubuntu, seria `ubuntu`. Se é Amazon Linux, é `ec2-user`)

---

## ⚠️ Importante

**NUNCA faça commit da chave privada!**

A chave `.pem` deve ficar:
- ✅ No seu computador local (protegida)
- ✅ No GitHub Secrets (criptografado pelo GitHub)
- ❌ NUNCA em `.gitignore` ou commit

---

## Verificação

Depois de adicionar os 3 secrets:

1. Vá para: https://github.com/igorgomesn17-byte/easygestion/settings/secrets/actions
2. Confirme que vê:
   - ✅ DEPLOY_PRIVATE_KEY
   - ✅ DEPLOY_HOST
   - ✅ DEPLOY_USER

---

## Depois de Configurar

Execute o próximo deploy:

```bash
cd c:\Users\Igor Gomes\OneDrive\Documentos\Igor MP\EASYGESTION
git add .
git commit -m "Reativar deploy com secrets configurados"
git push
```

O GitHub Actions vai rodar automaticamente e conectar à EC2 via SSH.

---

## Se Ainda Não Funcionar

**Verificar na EC2:**

```bash
# SSH na EC2
ssh -i easygestion-key.pem ec2-user@54.232.77.5

# Ver se PM2 está rodando
pm2 list

# Ver logs
pm2 logs easygestion
```

**Verificar permissões da chave:**

```bash
# Na sua máquina local
chmod 600 easygestion-key.pem
ls -l easygestion-key.pem
# Deve aparecer: -rw------- (apenas você pode ler)
```

---

## Passo-a-Passo Rápido (5 min)

1. Abrir Terminal
   ```bash
   cat easygestion-key.pem
   ```

2. Copiar tudo (Ctrl+C)

3. Ir para: https://github.com/igorgomesn17-byte/easygestion/settings/secrets/actions

4. Clicar em "New repository secret"

5. Preencher:
   - Name: `DEPLOY_PRIVATE_KEY`
   - Value: (colar o conteúdo todo da chave)

6. Clicar "Add secret"

7. Repetir para `DEPLOY_HOST` e `DEPLOY_USER`

8. Fazer push de novo (vai triggar o deploy)

---

**Depois disso, deploy automático vai funcionar!** 🚀
