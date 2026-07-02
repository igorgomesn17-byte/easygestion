# 🔧 Como Instalar o EASYGESTION no PC dela (Passo a Passo)

## ⚠️ PRÉ-REQUISITO

**Node.js precisa estar instalado no PC dela**

Se ela NÃO tem, você instala:
1. Vai em: https://nodejs.org
2. Clica em "Download" (versão LTS)
3. Abre o instalador e clica "Próximo" até o final
4. Reinicia o PC

---

## 📋 INSTALAÇÃO (3 passos simples)

### Passo 1: Copiar a pasta

1. Compacte (ZIP) a pasta **EASYGESTION** inteira
2. Envie para ela por Dropbox/WeTransfer/USB/etc
3. Ela descompacta em qualquer lugar (ex: Desktop, Documentos)

### Passo 2: Instalar as dependências

1. Ela abre a pasta **EASYGESTION**
2. Clica com **Shift + Clique direito** dentro da pasta
3. Escolhe **"Abrir PowerShell aqui"** (ou "Abrir Terminal aqui")
4. Cola este comando:
   ```powershell
   .\INSTALAR-COMPLETO.ps1
   ```
5. Espera terminar (leva 2-3 minutos)

**OU, se preferir mais simples:**
1. Clica duplo em **INSTALAR.bat**
2. Espera terminar

### Passo 3: Rodar o sistema

1. Ela abre **um novo terminal** naquela pasta
2. Cola este comando:
   ```bash
   npm start
   ```
3. Espera aparecer algo como:
   ```
   Servidor rodando em http://localhost:3000
   ```
4. Abre o navegador em **http://localhost:3000**
5. Vê a tela de **ATIVAÇÃO**

---

## 🔓 Ativar com código

1. Você gera um código:
   ```bash
   node gerar-codigo.js "Nome dela"
   ```

2. Você envia o código para ela (WhatsApp, email, etc)

3. Ela cola o código na tela de ativação

4. Ela clica em **"Ativar Licença"**

5. **Pronto***REMOVED*** Sistema está pronto para usar**

---

## ✅ Checklist para você

Antes de entregar:
- [ ] Node.js instalado no PC dela
- [ ] Pasta EASYGESTION copiada/descompactada
- [ ] Terminal rodando `npm start`
- [ ] Sistema abre em http://localhost:3000
- [ ] Tela de ATIVAÇÃO aparece
- [ ] Código gerado com `node gerar-codigo.js`
- [ ] Código enviado para ela
- [ ] Ela colou o código e ativou
- [ ] Conseguiu fazer login

---

## 🆘 Se der erro

| Erro | Solução |
|------|---------|
| "Node.js não encontrado" | Instalar Node.js (nodejs.org) e reiniciar |
| "npm is not recognized" | Reiniciar o terminal após instalar Node.js |
| "Permission denied" no PowerShell | Execute: `Set-ExecutionPolicy -ExecutionPolicy RemoteSigned -Scope CurrentUser` |
| Não consegue abrir PowerShell | Use `INSTALAR.bat` em vez de `INSTALAR-COMPLETO.ps1` |
| Porta 3000 em uso | Edite `.env` e mude `PORT=3001` |

---

## 📝 Resumo em 3 minutos

```
1. Node.js instalado? ✓
2. Descompactar pasta ✓
3. Clique duplo em INSTALAR.bat ✓
4. Esperar terminar ✓
5. Abrir novo terminal ✓
6. npm start ✓
7. http://localhost:3000 ✓
8. Cola o código ✓
9. Clica em Ativar ✓
10. Pronto***REMOVED*** ✓
```

---

**Qualquer dúvida, chama***REMOVED***** 🚀
