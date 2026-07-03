# 🤖 SETUP GitHub Actions para Deploy Automático

## O Que É
Sempre que você faz `git push` na branch `main`, o GitHub Actions **automaticamente**:
1. Puxa o código atualizado
2. Instala dependências
3. Reinicia a aplicação
4. Faz deploy na AWS EC2

## ⚙️ COMO CONFIGURAR

### 1️⃣ Vá para o GitHub

Acesse: https://github.com/igorgomesn17-byte/easygestion

### 2️⃣ Vá em Settings → Secrets and variables → Actions

Clique em **"New repository secret"** e adicione 3 secrets:

#### Secret 1: DEPLOY_HOST
- **Nome:** `DEPLOY_HOST`
- **Valor:** `54.232.189.113`

#### Secret 2: DEPLOY_USER  
- **Nome:** `DEPLOY_USER`
- **Valor:** `ubuntu`

#### Secret 3: DEPLOY_KEY
- **Nome:** `DEPLOY_KEY`
- **Valor:** Conteúdo da chave privada (`easygestion-key.pem`)
  
  Para pegar a chave:
  ```bash
  cat easygestion-key.pem
  ```
  Copie TODO o conteúdo (desde `-----BEGIN` até `-----END`) e cole no secret.

### 3️⃣ Pronto!

Agora sempre que você faz push, o deploy é automático! 🎉

## 📊 Como Verificar

Depois que fizer push:

1. Vá para: https://github.com/igorgomesn17-byte/easygestion/actions
2. Procure pela última execução
3. Se tiver ✅ verde = sucesso
4. Se tiver ❌ vermelho = erro (ver logs)

## 🔒 Segurança

A chave privada fica **criptografada** nos secrets do GitHub. Ninguém consegue ver.

## ❌ Troubleshooting

Se o deploy falhar:

1. **Verifique os secrets** - todos 3 foram adicionados?
2. **Verifique a chave** - é a correta (`easygestion-key.pem`)?
3. **Verifique a porta SSH** - pode estar bloqueada no Security Group da AWS

Se tudo tiver certo e ainda não funcionar, o Security Group da AWS pode estar bloqueando SSH.

Nesse caso, você precisa:
1. AWS Console → EC2 → Security Groups
2. Procurar pelo security group da instância
3. Adicionar regra de inbound: SSH (22) source = `0.0.0.0/0` (ou seu IP específico)

---

## ✅ RESUMO

Depois de fazer este setup **UMA VEZ**, você nunca mais precisa fazer deploy manual!

Basta:
```bash
git add .
git commit -m "sua mensagem"
git push
```

E o GitHub Actions cuida do resto! 🚀

---

**Dúvidas?** Leia: https://docs.github.com/en/actions
