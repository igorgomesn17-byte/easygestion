# 🚀 TESTE RÁPIDO — 5 minutos

**Objetivo:** Verificar se tudo está funcionando  
**Tempo:** ~5 minutos (sem conta Focus)

---

## ✅ Pré-requisito

- [ ] Servidor rodando: `npm start`
- [ ] URL pronta: `http://localhost:3000/nfce-ativar.html`

---

## 🧪 Teste 1: Página Carrega

1. Abra no navegador: `http://localhost:3000/nfce-ativar.html`
2. Veja:
   - [ ] Spinner de "Carregando..." por 1-2 segundos
   - [ ] Depois: Formulário com 4 campos vazios
   - [ ] Título: "Ativar Nota Fiscal Eletrônica"

**Esperado:** ✅ Formulário aparece

---

## 🧪 Teste 2: Validação Básica

1. Deixe o formulário em branco
2. Clique "✅ Ativar NFC-e"
3. Veja:
   - [ ] Campo TOKEN tem borda vermelha
   - [ ] Navegador mostra: "Por favor, preencha este campo"

**Esperado:** ✅ Validação HTML funciona

---

## 🧪 Teste 3: Token Inválido (muito curto)

1. Preencha assim:
   ```
   TOKEN:     123
   CSC ID:    12345
   Ambiente:  Teste
   Série:     1
   ```
2. Clique "✅ Ativar NFC-e"
3. Veja:
   - [ ] Botão fica com spinner + texto "Ativando..."
   - [ ] Depois 2 segundos: Alerta vermelho com erro
   - [ ] Erro: "TOKEN inválido ou muito curto"

**Esperado:** ✅ Backend valida

---

## 🧪 Teste 4: Teste com Dados Falsos (válidos, mas inúteis)

1. Preencha assim:
   ```
   TOKEN:     123456789012345
   CSC ID:    12345
   Ambiente:  Teste
   Série:     1
   ```
2. Clique "✅ Ativar NFC-e"
3. Veja:
   - [ ] Spinner aparece
   - [ ] Depois ~2-5 segundos: Possível erro da Focus (token inválido na Focus)
   - [ ] Ou: Alerta "Ativado com sucesso" (se por acaso passasse no Focus)

**Esperado:** ✅ Tela tenta conectar no backend/Focus

---

## 🧪 Teste 5: Console do Navegador (Verificar erros)

1. Abra DevTools: `F12` ou `Ctrl+Shift+I`
2. Clique em "Console"
3. Veja:
   - [ ] Nenhuma linha em vermelho (erro)
   - [ ] Algo como: `[NFC-e] Cliente 1 ativou integração` (no console do servidor, não no navegador)

**Esperado:** ✅ Sem erros no console

---

## 📞 Se algo não funcionar

### Erro: "Falha ao conectar com /api/nfce/config"

**Solução:**
```bash
# Verifique se servidor está rodando
npm start

# Se não subiu, veja erro
# Pode ser falta de compilação/dependência
npm install
npm start
```

### Erro: "Não conseguiu ativar"

**Solução:**
```bash
# Teste a rota manual
curl http://localhost:3000/api/nfce/config

# Esperado:
# { "ativo": false, ... }

# Se falhar, middleware/rota pode estar quebrada
```

### Botão fica preso com spinner

**Solução:**
1. Abra DevTools (F12)
2. Vá em Network
3. Veja o request para `/api/nfce/ativar`
4. Clique nele
5. Veja resposta (pode ser erro do servidor)

---

## ✅ Se passou em todos os testes

**Parabéns***REMOVED***** A implementação está OK. 

Próximos passos:
1. Testar com conta Focus real (Teste 4 do arquivo [TESTE-NFCE-ATIVAR.md](TESTE-NFCE-ATIVAR.md))
2. Integrar botão "Emitir Nota" no PDV
3. Testar emissão de verdade

---

## 🎯 Resumo em 1 minuto

```
1. Abra http://localhost:3000/nfce-ativar.html
2. Veja se formulário aparece ✅
3. Preencha com dados inválidos
4. Veja se erro aparece ✅
5. Pronto***REMOVED*** Tela funciona
```

---

**Tempo total:** ~5 minutos  
**Resultado esperado:** Tudo OK ✅
