# 📦 Como Entregar o EASYGESTION com Licença de 30 dias

## Resumo rápido

Seu amigo vai receber uma pasta que:
1. ✅ **Roda sem internet**
2. ✅ **Precisa de um código** para ativar (único, de 30 dias)
3. ❌ **Impossível compartilhar** com terceiros
4. ❌ **Impossível usar depois que expira**

---

## Passo 1: Criar o código

Abra terminal na pasta EASYGESTION e rode:
```bash
node gerar-codigo.js "Nome do Seu Amigo"
```

Exemplo:
```bash
node gerar-codigo.js "Carlos Teste"
```

**Você vai receber um código assim:**
```
EG-1718956800000-A7F3B2C1
```

Copie e guarde esse código***REMOVED***

---

## Passo 2: Entregar a pasta

1. **Comprima/copie a pasta EASYGESTION** (sem node_modules)
2. **Envie para seu amigo** (USB, Dropbox, etc)

**O que ele vai receber:**
- Pasta completa do EASYGESTION
- Arquivo SISTEMA-LICENCA.md (instruções)

---

## Passo 3: Seu amigo ativa

### O que o amigo faz:

1. **Descompacta a pasta** em qualquer lugar
2. **Abre o terminal** naquela pasta
3. **Instala dependências:**
   ```bash
   npm install
   ```
4. **Inicia o sistema:**
   ```bash
   npm start
   ```
5. **Navegador abre em http://localhost:3000**
6. **Vê a tela de ATIVAÇÃO**
7. **Cola o código que você enviei**
8. **Clica em "Ativar Licença"**
9. **Pronto***REMOVED*** Agora pode usar**

---

## Passo 4: Monitorar

### O que você pode fazer:

- ✅ **Gerar novo código** quando expirar → `node gerar-codigo.js "Nome"`
- ✅ **Enviar para seu amigo** de novo
- ✅ **Revogar a licença** deletando o arquivo `.license` da pasta dele

---

## 🔐 Segurança

### Por que é seguro:

| Aspecto | Proteção |
|--------|----------|
| **Compartilhamento** | Código é pessoal e rastreável |
| **Falsificação** | Usa SHA256 — impossível criar código falso |
| **Duração** | Expira automaticamente em 30 dias |
| **Revogação** | Você pode pedir o arquivo `.license` de volta |
| **Portabilidade** | Só funciona no computador onde foi ativado |

---

## 📋 Checklist completo

**Antes de entregar:**
- [ ] Testei o código localmente: `node gerar-codigo.js "Teste"`
- [ ] Ativei o sistema com esse código
- [ ] Fiz login e testei uma venda
- [ ] Verifiquei que mostra "30 dias"

**Ao entregar:**
- [ ] Criei um código novo para o cliente: `node gerar-codigo.js "Nome do Amigo"`
- [ ] Enviei o código por mensagem/email
- [ ] Compactei a pasta sem node_modules
- [ ] Enviei a pasta completa para o amigo

**Depois de entregar:**
- [ ] Amigo recebeu a pasta
- [ ] Amigo executou `npm install`
- [ ] Amigo rodou `npm start`
- [ ] Amigo viu a tela de ativação
- [ ] Amigo colou o código
- [ ] Amigo conseguiu fazer login

---

## ⏰ Gerenciar datas

### Código válido por 30 dias
Se entregar em: **18/06/2026**
Expira em: **18/07/2026**

Depois disso, pode:
1. **Renovar** — gerar um novo código
2. **Bloquear** — deletar o arquivo `.license` dele
3. **Estender** — qualquer novo código vale 30 dias a partir da geração

---

## Exemplo prático

```bash
# 1. Gerar código para João
node gerar-codigo.js "João"
# Output: EG-1718956800000-A7F3B2C1

# 2. Enviar por WhatsApp:
# "João, ative com o código: EG-1718956800000-A7F3B2C1"

# 3. João recebe a pasta, instala, rodas npm start

# 4. João vê a tela de ativação

# 5. João cola o código e ativa

# 6. João usa o sistema por 30 dias

# 7. Depois de 30 dias, pede novo código
# node gerar-codigo.js "João"
# E manda o novo código para ele
```

---

## 🚨 Se der problema

| Problema | Solução |
|----------|---------|
| "Código inválido" | Verifica se digitou certo |
| "Licença expirada" | Gera novo: `node gerar-codigo.js "Nome"` |
| "Já usei o código" | Novo código sempre para 30 dias a partir da data de geração |
| Quer bloquear | Peça o arquivo `.license` de volta ou delete remotamente |

---

**Pronto***REMOVED*** Seu amigo tem acesso limitado e seguro ao EASYGESTION.** 🔐✅
