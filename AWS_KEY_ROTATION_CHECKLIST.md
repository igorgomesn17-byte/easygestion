# 🔐 AWS Key Rotation Checklist

**Data da detecção:** 2026-06-23  
**Chave comprometida:** `AKIAQJP5WPAFTCCEXW7Z`  
**Support Case:** #178190794700871

---

## ✅ O que foi feito

- [x] Git history limpo (credentials removidas de todos os commits)
- [x] Force-push para GitHub
- [x] DEPLOY-RENDER.md documentação atualizada (sem credentials)

---

## ⏳ O que PRECISA ser feito AGORA

### 1️⃣ Rotacionar AWS Keys

**Local:** AWS Console → IAM → Users → `easygestao`

```
1. [ ] Ir para "Security Credentials" do usuário easygestao
2. [ ] Clique em "Create access key"
3. [ ] Salvar a NOVA access key e secret (será usada daqui pra frente)
4. [ ] NÃO DELETAR a antiga ainda!
```

### 2️⃣ Atualizar Variáveis de Ambiente

**No Render (Staging e Production):**

```
1. [ ] Ir para cada Web Service (staging + produção)
2. [ ] Environment → Environment Variables
3. [ ] Atualizar:
       - AWS_ACCESS_KEY_ID = [NOVA KEY]
       - AWS_SECRET_ACCESS_KEY = [NOVO SECRET]
4. [ ] Redeploy
5. [ ] Verificar logs: sem erros 403 de AWS
```

**Localmente (seu .env):**

```
1. [ ] Atualizar AWS_ACCESS_KEY_ID
2. [ ] Atualizar AWS_SECRET_ACCESS_KEY
3. [ ] Testar backup-s3.js: npm run backup
4. [ ] Verificar se arquivo foi criado em S3
```

### 3️⃣ Verificar Atividade Não Autorizada

**CloudTrail (no AWS Console):**

```
1. [ ] CloudTrail → Event history
2. [ ] Filtro: User: easygestao, Data: últimos 7 dias
3. [ ] Procurar por ações suspeitas:
       - Criação de instâncias EC2
       - Criação de roles/policies
       - Deletar recursos
4. [ ] Se houver: Screenshot + responder ao Support case
```

**Billing (no AWS Console):**

```
1. [ ] Billing → Bills
2. [ ] Comparar: custos dos últimos 7 dias vs. histórico
3. [ ] Se houver picos: responder ao Support case para billing adjustment
```

### 4️⃣ Deletar a Chave Antiga

**SOMENTE após validar que tudo funciona:**

```
1. [ ] Aguardar 24h com nova key em produção (precaução)
2. [ ] Confirmar: Render logs sem erros, backups rodando ok
3. [ ] AWS Console → Usuarios → easygestao → Security Credentials
4. [ ] A antiga (AKIAQJP5WPAFTCCEXW7Z): Clique "Delete"
5. [ ] Confirmar deleção
```

### 5️⃣ Responder ao AWS Support

**No link:** https://console.aws.amazon.com/support/home#/case/?displayId=178190794700871

```
1. [ ] Comprovação:
       - "Git history foi limpo via git filter-repo"
       - "Todas as instâncias/buckets foram auditadas"
       - "Chaves foram rotacionadas"
       - Screenshots do CloudTrail (se houver algo suspeito)

2. [ ] Pedido para remover Quarantine Policy:
       "Completamos os passos 1-3 conforme instruído.
        Nova access key foi gerada, antiga será deletada.
        Não identificamos atividade não autorizada.
        Solicitar remoção da AWSCompromisedKeyQuarantineV3."
```

### 6️⃣ Fortalecer Processes

```
1. [ ] Adicionar ao .gitignore:
       - DEPLOY-*.md
       - SETUP-*.md
       - .env*
       
2. [ ] Criar .env.example com apenas nomes de variáveis

3. [ ] GitHub Settings → Security → Secret scanning:
       Enable "Push protection" para alertar antes de expor

4. [ ] Adicionar pre-commit hook (se usar):
       npm install husky --save-dev
       npx husky add .husky/pre-commit "grep -r 'AWS_SECRET\\|AKIAQ\\|SG\\.' . && exit 1 || exit 0"
```

---

## 📞 Contacts

- **AWS Support:** https://console.aws.amazon.com/support/
- **IAM User:** easygestao
- **Bucket S3:** easygestao-backups
- **Region:** sa-east-1

---

## Timeline

| Data | Evento |
|------|--------|
| 2026-06-20 | AWS detecta credenciais expostas no GitHub |
| 2026-06-23 | Git history limpo, force-push realizado |
| 2026-06-23 | **← Você está aqui** — Rotacionar keys AGORA |
| 2026-06-24 | Aguardar resposta AWS sobre remoção de Quarantine |

---

**⚠️ Deadline:** Fazer isso HJ se possível. Toda minuto que passa com chave comprometida é risco.

**Status:** 🔴 CRÍTICO — Aguardando ação manual
