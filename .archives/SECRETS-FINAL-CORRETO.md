# 🔑 GITHUB SECRETS — Configuração CORRETA (Final)

**Status:** Deploy falhando  
**Causa:** Secrets provavelmente estão errados  
**Solução:** Deletar e recriar CORRETAMENTE

---

## ⚠️ O QUE VOCÊ FEZ ERRADO

Você colocou a chave em **base64** no GitHub Secrets, mas o workflow agora espera **PEM direto**.

---

## ✅ COMO FAZER CERTO (Passo-a-Passo)

### Passo 1: Abrir GitHub Secrets

```
https://github.com/igorgomesn17-byte/easygestion/settings/secrets/actions
```

### Passo 2: DELETAR o secret errado

- Procure por `DEPLOY_PRIVATE_KEY`
- Clique nos 3 pontinhos `...`
- Clique "Delete"
- Confirme

### Passo 3: Criar NOVO secret com a chave CORRETA

Clique "New repository secret"

**Nome:** `DEPLOY_PRIVATE_KEY`

**Valor:** COPIE EXATAMENTE ISSO (a chave em PEM):

```
-----BEGIN RSA PRIVATE KEY-----
MIIEogIBAAKCAQEAvt+IsAHfXXYAr2JeS6HQg0joOucw0y9eTXEokZTC5r85llr+
OzLwreCteujKkNQEL0ZlPIj6Ito2x9ds37cpx+siPpqzpwdWBM1e9+7DuXwbQO2b
i8BgdqAznZ5cEl8pnCEhhNpBYmv4nK+2GykzNwpXNoni8sJi+in/iyNv0AkgOlay
z3jLDx//nYvTr80yq0MK6+v57ybHCYDfRZ9zzo5waS4ZiXwpvNrG2W+grNDgA1rI
uQTvHQiyK72IF28LDymChf4G8xdE6iCSu932312uUgc4m+3Xns1Ck25Pfw5+Mo9q
rrOvqLtaDx6E2blIuWbj/pfI9SQ9Am4wlvyu+QIDAQABAoIBAHiKWpws0o8Hcq9Q
BBTnf/MpG9/3GRKFm5x0lhY6SEvI/+lAVcW1CeIFPgmc8jA8dNgWMODl8HIKNQZH
ue4ekjg6+klnEYWuUFiACjWxh9Gf2uZKKC09tK21xmMIG0VO68w58B0iaKBrZ3os
TWkhv8JGuYUr1zNQJ4ms9EE+g+JwicFGfK2CxA80R2Ldm2Vf3uaub4MbK2tlyeMn
YCS71gIkvYurOKepqZn3fDDURgngHiIcVpeHY2to2MR9E69P+7nQ9CPkdxFM33xB
tnWVFodA1FJrYLC8Wl+Q601Qs4dE9ANlfCxBHcFbcYAcybrc3KsWcuIIVIRyfs/u
LXEqecECgYEA3kSqDlxem5qFyhxN3KgL2jRykLMntgQFBPZsAhw3AMCOaCevo2zi
Vrqk7AhVBT+WUD9Cr7qCpRa5T8HnB88T1C/UbPnd1qgvUVKo9J4fHVK+UiQHfTHg
zZkJwKxo5i/lavamjFqhf73WtNAj4M302QGC23ciiWXOMgD5GraExM0CgYEA29ck
VFyKoCpZ49BVmpPlPmVDr1UHkjvuFwfqUBwljmgRGxThYDKbQF5ERAP+iFZ0CTVF
ZRmKA9ctCsut0zaxZRQNXwyOEmsxrR74CKhGmwaHF2DYM2KMPZWQxQl2FCyLTZ8p
xJx7Oh7XwyLuzZB27J0TkwERM+bgpjf7P/2p8t0CgYB7G5cBK0Ivd0/BGRo7LEyc
SE5oPQKyutk43XAHXy9L2FtH7ytGHkni9a/hF+BXbtfHjLJX+Lrhy4tKVMCsv5Jh
BTjoPyETAsZqiZkRG/9p02mcv13yhszXs3sGX7gePssYCpNGy/AFe9VPArXMjuad
x0t+WSck6OFjKszOcedpxQKBgBdfsIUnsbWFyzjllbRxtRYFPkUODVgG9zGLreYG
mBekCO2QMsY/mzIk061Hn3BvgLbZ6x7ssDfoUOms7jZewk207BcHBrP+obF+cXC6
M4eYEhTyPwp3l+GUXWgVsXBDrCv8mDxHRvLPBLHCrRE+IubVbJdcra+PBKOnoBcV
qVQhAoGAeyXykmavXcontdJJKUGrMj0F0DAnKW6/rYiYAzoSlImO26rtKF8ojjh8
8dUVetPsq3SHSZRjw6xFCtoCsyDU2snaneVyVlVTtZKekOtCN3UEG6QIbMaqKb/y
sBLmYawwl02g63uYZEt8PQ8AUVl2xUQG4HHYyZZTcKZZVU6vwEs=
-----END RSA PRIVATE KEY-----
```

**⚠️ IMPORTANTE:**
- Começa com `-----BEGIN RSA PRIVATE KEY-----`
- Termina com `-----END RSA PRIVATE KEY-----`
- Sem espaços extras no início ou final
- Sem base64

Clique "Add secret"

### Passo 4: Confirmar que os 3 secrets estão lá

Na página de secrets, você deve ver:
- ✅ `DEPLOY_PRIVATE_KEY` (a chave em PEM)
- ✅ `DEPLOY_HOST` = `54.232.77.5`
- ✅ `DEPLOY_USER` = `ec2-user`

### Passo 5: Fazer push para triggar deploy

```bash
git add .
git commit -m "Atualizar com chave correta"
git push
```

---

## ✅ Se você fez certo:

1. GitHub Actions vai rodar
2. Vai conectar na EC2 via SSH
3. Vai clonar/atualizar código
4. Vai fazer npm install
5. Vai reiniciar PM2
6. Site volta online! 🚀

---

## 📋 Checklist Final

- [ ] Deletei o secret `DEPLOY_PRIVATE_KEY` errado
- [ ] Criei novo `DEPLOY_PRIVATE_KEY` com a chave em PEM (BEGIN RSA ... END RSA)
- [ ] Confirmi que tem `DEPLOY_HOST` = `54.232.77.5`
- [ ] Confirmi que tem `DEPLOY_USER` = `ec2-user`
- [ ] Fiz push no GitHub
- [ ] GitHub Actions está rodando verde ✅

