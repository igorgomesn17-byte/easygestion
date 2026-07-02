# 🎯 Próximos Passos — Semana 1 (Dev)

> O que FAZER agora para terminar o MVP

---

## VISÃO GERAL

```
Código-base: ✅ 80% pronto (rotas, banco, menu)
Falta: ⏳ 20% integração UI (telas, botões, fluxos)
Tempo: 1 semana de dev focused
```

---

## ORDEM DE PRIORIDADE

### 1️⃣ TELA CONFIG FISCAL (`config-fiscal.html`) — 2 horas

**O que é:** Página onde o usuário faz upload do certificado A1 e configura NFC-e

**Fazer:**
```
📄 config-fiscal.html
├─ Form: Upload certificado (.pfx)
├─ Input: Senha do certificado (password)
├─ Input: Inscrição Estadual (IE)
├─ Input: Série NFC-e (default "1")
├─ Ambiente: radio (homologação/produção)
├─ Botão: "Testar certificado"
├─ Status visual: ✅ Ok | ❌ Erro
└─ Salvar em: POST /api/config (usar endpoint existente)
```

**Endpoints que já existem:**
- `GET /api/nfce/config` — lê status
- `POST /api/config` — salva (já existe, só usar)

---

### 2️⃣ BOTÃO EMITIR NFC-e NO PDV (`pdv.html`) — 2 horas

**O que é:** Após finalizar venda, opção de emitir NFC-e

**Fazer:**
```
pdv.html (após cupom impresso, adicionar:)
├─ Seção "Emissão Fiscal"
├─ Botão "🧾 Emitir NFC-e"
├─ Status visual:
│  ├─ ⏳ Emitindo...
│  ├─ ✅ Autorizada (verde) — mostrar chave + protocolo
│  ├─ ❌ Erro (vermelho) — mostrar mensagem
│  └─ 🔄 Tentar novamente
├─ Link: "📥 Download DANFE"
└─ Chamar: POST /api/nfce/emitir/:vendaId
```

**Endpoint que já existe:**
- `POST /api/nfce/emitir/:vendaId` — emite a nota

---

### 3️⃣ RECIBO WHATSAPP COM NFC-e — 1 hora

**O que é:** Após venda, enviar mensagem automática no WhatsApp com link do cupom

**Fazer:**
```
pdv.html (após emitir NFC-e, adicionar:)
├─ Botão "💬 Enviar Recibo WhatsApp"
├─ Pré-preenchido com:
│  ├─ Cliente (se tiver)
│  ├─ Valor total
│  ├─ Link DANFE (do retorno NFC-e)
│  └─ QRCode (acessar no Render/Focus)
└─ Usar: POST /api/vendas/:id/enviar-recibo (criar nova rota)
```

**Criar rota:**
```javascript
// routes/vendas.js
POST /api/vendas/:id/enviar-recibo
├─ Busca venda + NFC-e associada
├─ Formata mensagem WhatsApp
├─ Chama Meta API (já temos WHATSAPP_TOKEN)
└─ Retorna ok/erro
```

---

### 4️⃣ UPLOAD FOTO DO PRODUTO — 30 min

**O que é:** Campo na tela produtos pra fazer upload de imagem

**Fazer:**
```
produtos.html (ao cadastrar/editar):
├─ Input: file type="image/*"
├─ Preview: <img> local
├─ Button: "Salvar foto"
└─ POST /api/produtos/:id/foto (criar rota)
```

**Criar rota:**
```javascript
// routes/produtos.js
POST /api/produtos/:id/foto
├─ Recebe: multipart/form-data (imagem)
├─ Salva em: /uploads/produtos/[id]-[timestamp].jpg
├─ Atualiza: produtos.foto = caminho
└─ Retorna ok/caminho
```

---

### 5️⃣ ENTRADA ESTOQUE EM LOTE — 1 hora

**O que é:** Importar CSV com múltiplas entradas de estoque de uma vez

**Fazer:**
```
estoque.html (adicionar seção:)
├─ "📦 Entrada em Lote"
├─ Input: file type=".csv"
├─ Formato esperado: SKU, Tamanho, Quantidade (3 colunas)
├─ Button: "Importar"
├─ Preview: tabela dos itens que serão importados
├─ Button: "Confirmar importação"
└─ POST /api/estoque/importar-lote (criar rota)
```

**Exemplo CSV:**
```
VES001,P,5
VES001,M,10
VES001,G,7
BLU002,P,3
```

**Criar rota:**
```javascript
// routes/estoque.js
POST /api/estoque/importar-lote
├─ Recebe: CSV em multipart
├─ Parse: extrai SKU, tamanho, qtd
├─ Valida: SKU existe? Tamanho válido?
├─ Insere: em movimentos_estoque (tipo='entrada')
└─ Retorna: { importadas: N, erros: [...] }
```

---

## 🧪 TESTE MANUAL (Depois de tudo acima)

1. **Login** em http://localhost:3001
   - Admin / admin123

2. **Config Fiscal** → upload cert A1
   - Vai falhar (sem cert real), MAS testa o form

3. **Vender** → uma peça
   - Finalizar venda
   - Ver opção "Emitir NFC-e"
   - Click (vai dar erro sem cert, mas fluxo funciona)

4. **Upload Foto** → produto
   - Editar um produto
   - Upload uma imagem
   - Salvar

5. **Entrada Lote** → 3 peças
   - Criar CSV simples
   - Import
   - Verificar estoque atualizou

---

## 📋 CHECKLIST (por arquivo)

### Arquivos a CRIAR:
- [ ] `config-fiscal.html`
- [ ] `routes/vendas.js` — POST /enviar-recibo (adicionar a rota existente)
- [ ] `routes/produtos.js` — POST /:id/foto (adicionar)
- [ ] `routes/estoque.js` — POST /importar-lote (adicionar)

### Arquivos a EDITAR:
- [ ] `pdv.html` — adicionar seção NFC-e + botão
- [ ] `produtos.html` — adicionar upload foto
- [ ] `estoque.html` — adicionar importar lote
- [ ] `public/js/comum.js` — registrar config-fiscal no menu (se quiser)

### Testar:
- [ ] Rodar `npm start`
- [ ] Login
- [ ] Clicar em Config Fiscal → form carrega
- [ ] Fazer venda → botão Emitir aparece
- [ ] Clicar Emitir → erro esperado (sem cert), mas fluxo ok
- [ ] Upload foto → imagem salva
- [ ] Import lote → estoque atualiza

---

## ⏱️ TEMPO ESTIMADO

```
Config Fiscal     → 2h
Botão NFC-e PDV   → 2h
Recibo WhatsApp   → 1h
Upload Foto       → 0.5h
Entry Lote        → 1h
Testes            → 1h
─────────────────────
TOTAL            → ~7-8h (1 dia de dev)
```

---

## 🚀 COMEÇAR AGORA

**Escolha qual fazer primeiro e avisa quando tiver pronto. Vou ajudar.**

Opções:
1. **Config Fiscal** (mais importante, bloqueia outras)
2. **NFC-e Botão PDV** (funcionalidade principal)
3. **Recibo WhatsApp** (melhor UX)
4. **Upload Foto** (simples, rápido)
5. **Entry Lote** (menos urgente)

**Qual você quer que a gente faça primeiro?**
