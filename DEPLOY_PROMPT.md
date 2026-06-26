# 🚀 PROMPT DE DEPLOY - NUNCA ESQUECER!

## ⚠️ REGRA CRÍTICA
**SEMPRE fazer deploy após commit. NUNCA esquecer. Se fez edit/commit, deploy vem junto.**

---

## Passo 1: Commit
```bash
cd "/c/Users/Igor Gomes/OneDrive/Documentos/Igor MP/EASYGESTION" && git add -A && git commit -m "MENSAGEM AQUI"
```

## Passo 2: Push
```bash
git push origin main
```

## Passo 3: Deploy via SSH (OBRIGATÓRIO)
```bash
ssh -i "/c/Users/Igor Gomes/OneDrive/Documentos/Igor MP/EASYGESTION/easygestion-key.pem" ubuntu@54.232.77.5 << 'DEPLOY'
cd /opt/easygestion
git fetch origin
git reset --hard origin/main
pm2 restart easygestion
sleep 2
echo "✅ Deploy concluído"
DEPLOY
```

---

## Template Rápido (copie e adapte)
```bash
cd "/c/Users/Igor Gomes/OneDrive/Documentos/Igor MP/EASYGESTION" && git add -A && git commit -m "MENSAGEM" && git push origin main && ssh -i "/c/Users/Igor Gomes/OneDrive/Documentos/Igor MP/EASYGESTION/easygestion-key.pem" ubuntu@54.232.77.5 << 'DEPLOY'
cd /opt/easygestion
git fetch origin
git reset --hard origin/main
pm2 restart easygestion
sleep 2
echo "✅ Deploy concluído"
DEPLOY
```

---

## ☑️ Checklist Pós-Deploy
- [ ] Recarregou o navegador (Ctrl+Shift+R)
- [ ] Testou a funcionalidade
- [ ] Sem erros no console (F12)
- [ ] Pronto pra passar pro usuário

---

## 🚨 Não fazer
- ❌ Commit sem deploy
- ❌ Esquecer de `git push` antes do SSH
- ❌ Usar GitHub Actions (sempre manual SSH)
- ❌ Resetar BD com upgrade (nunca zerar dados)

