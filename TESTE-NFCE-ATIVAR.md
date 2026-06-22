# 🧪 TESTES — Tela de Ativação NFC-e

**Status:** Implementação completa  
**Arquivos alterados:** 3  
**Testes recomendados:** 5-7 cenários

---

## 📋 Checklist de Implementação

- [x] Tela HTML (`public/nfce-ativar.html`)
  - Formulário com 4 campos: token, csc_id, ambiente, série
  - Estados: Carregando, Formulário, Ativado
  - Alertas (sucesso, erro, info)
  - Botões: Ativar, Alterar, Desativar
  - Modal de confirmação para desativar

- [x] Rotas Backend
  - [x] POST `/api/nfce/ativar` (salva config, valida token)
  - [x] POST `/api/nfce/desativar` (remove ativação)
  - [x] GET `/api/nfce/config` (retorna estado atual)

- [x] Integração com Focus
  - [x] `lib/focusNfe.js` aceita `tokenCliente` explícito
  - [x] `focusRequest()` usa token do cliente (ou .env fallback)
  - [x] `emitirNfce()`, `consultarNfce()`, `cancelarNfce()` passam token

- [x] Isolamento por Tenant
  - [x] Config salva com `tenant_id`
  - [x] Cada cliente tem seu próprio token
  - [x] Tokens não se misturam

---

## 🧪 Cenários de Teste

### Teste 1: Carregar página (sem ativação prévia)

**Passos:**
1. Abra `http://localhost:3000/nfce-ativar.html`
2. Veja o estado "Carregando..." por 1-2 segundos
3. Formulário aparece (estado: não ativado)

**Esperado:**
- ✅ GET `/api/nfce/config` retorna `{ ativo: false }`
- ✅ Formulário com 4 campos vazios
- ✅ Botão "✅ Ativar NFC-e" aparece

**Resultado:** ✓ / ✗

---

### Teste 2: Validar formulário (campos vazios)

**Passos:**
1. Clique em "✅ Ativar NFC-e" sem preencher nada
2. Veja os erros de validação HTML

**Esperado:**
- ✅ Campos marcados como `required`
- ✅ Navegador mostra erro nativo ("Campo obrigatório")

**Resultado:** ✓ / ✗

---

### Teste 3: Ativar com token inválido

**Passos:**
1. Preencha:
   - Token: `123` (muito curto)
   - CSC ID: `12345`
   - Ambiente: Teste
   - Série: 1
2. Clique "✅ Ativar NFC-e"

**Esperado:**
- ✅ Botão fica desabilitado com spinner
- ✅ Erro na tela: "TOKEN inválido ou muito curto"
- ✅ Botão volta ao normal

**Resultado:** ✓ / ✗

---

### Teste 4: Ativar com dados válidos (Focus Homologação)

**Pré-requisito:** Ter conta teste na Focus (https://focusnfe.com.br)

**Passos:**
1. Crie conta Focus (ou use uma existente)
2. Copie TOKEN (Configurações → API → Token)
3. Copie CSC ID (Configurações → CSC → ID)
4. Preencha na tela:
   - Token: [colar token aqui]
   - CSC ID: [colar aqui]
   - Ambiente: **Teste (Homologação)**
   - Série: 1
5. Clique "✅ Ativar NFC-e"

**Esperado:**
- ✅ Spinner por ~2 segundos
- ✅ Alerta verde: "✅ NFC-e ativada com sucesso***REMOVED***"
- ✅ Página recarrega
- ✅ Estado muda para "Já Ativado"
- ✅ Mostra: Ambiente (Teste), Série (1), CSC ID (*****)

**Resultado:** ✓ / ✗

---

### Teste 5: Verificar isolamento de tenant

**Pré-requisito:** Sistema multi-tenant funcionando

**Passos:**
1. Login como Cliente A
2. Ative NFC-e com TOKEN_A (Homologação)
3. Logout
4. Login como Cliente B
5. Abra `/nfce-ativar.html`

**Esperado:**
- ✅ Cliente B vê formulário vazio (não ativado)
- ✅ Tokens não se misturam
- ✅ Ative NFC-e com TOKEN_B
6. Logout, login Cliente A novamente
7. Abra `/nfce-ativar.html`

**Esperado:**
- ✅ Cliente A vê "Já Ativado"
- ✅ Cada cliente mantém sua configuração

**Resultado:** ✓ / ✗

---

### Teste 6: Alterar configuração

**Passos:**
1. Estado: "Já Ativado"
2. Clique em "✏️ Alterar Configuração"
3. Mude Ambiente para "Produção"
4. Clique "✅ Ativar NFC-e"

**Esperado:**
- ✅ Formulário reaparece (com valores vazios)
- ✅ Preencha novo token/CSC
- ✅ Clique Ativar
- ✅ Página recarrega
- ✅ Ambiente agora mostra "✅ Produção"

**Resultado:** ✓ / ✗

---

### Teste 7: Desativar NFC-e

**Passos:**
1. Estado: "Já Ativado"
2. Clique em "🔴 Desativar NFC-e"
3. Modal aparece pedindo confirmação
4. Clique "Sim, confirmar"

**Esperado:**
- ✅ Modal aparece com aviso
- ✅ Alerta verde: "✅ NFC-e desativada"
- ✅ Página recarrega
- ✅ Volta ao estado "Formulário"
- ✅ GET `/api/nfce/config` retorna `{ ativo: false }`

**Resultado:** ✓ / ✗

---

### Teste 8: Emitir NFC-e com token do cliente

**Pré-requisito:** NFC-e ativada (Teste 4 passou)

**Passos:**
1. Vá para PDV
2. Registre uma venda (qualquer valor)
3. Botão "Emitir Nota"
4. Clique "Emitir"

**Esperado:**
- ✅ Request vai para POST `/api/nfce/emitir/:vendaId`
- ✅ Backend usa token do cliente (não do .env)
- ✅ Focus retorna: número, chave, DANFE, QRCode
- ✅ Nota aparece: "✅ Nota #12345 autorizada"
- ✅ Links [DANFE] [XML] [QRCode] aparecem

**Resultado:** ✓ / ✗

---

## 🔧 Debugging

### Se o formulário não aparecer:
```bash
# Verificar GET /api/nfce/config
curl http://localhost:3000/api/nfce/config

# Esperado:
{ "ativo": false, "ambiente": "homologacao", ... }
```

### Se Ativar não funciona:
```bash
# Fazer POST manualmente
curl -X POST http://localhost:3000/api/nfce/ativar \
  -H "Content-Type: application/json" \
  -d '{
    "token": "seu-token-aqui",
    "csc_id": "123456",
    "ambiente": "homologacao",
    "serie": 1
  }'

# Esperado:
{ "ok": true, "mensagem": "NFC-e ativada com sucesso***REMOVED***" }
```

### Se emissão falha:
1. Verifique logs do servidor: `[NFC-e] ...`
2. Teste token manualmente em: https://focusnfe.com.br/docs
3. Verifique se conta tem saldo (100 notas/mês no free tier)

---

## 📊 Testes Automáticos (Opcional)

```javascript
// Exemplo: Teste com Playwright
import { test, expect } from '@playwright/test';

test('ativar nfce', async ({ page }) => {
  await page.goto('http://localhost:3000/nfce-ativar.html');
  
  // Aguarda carregamento
  await page.waitForSelector('#formNfce');
  
  // Preenche formulário
  await page.fill('#token', 'token-teste-123456');
  await page.fill('#csc_id', '123456');
  await page.selectOption('#ambiente', 'homologacao');
  await page.fill('#serie', '1');
  
  // Submete
  await page.click('button[type="submit"]');
  
  // Aguarda sucesso
  await expect(page.locator('.alert.success')).toBeVisible();
});
```

---

## ✅ Checklist Final

- [ ] Teste 1: Página carrega
- [ ] Teste 2: Validação de campos
- [ ] Teste 3: Rejeita token inválido
- [ ] Teste 4: Ativa com token válido
- [ ] Teste 5: Isolamento de tenants funciona
- [ ] Teste 6: Alteração de config funciona
- [ ] Teste 7: Desativação funciona
- [ ] Teste 8: Emissão de NFC-e usa token do cliente
- [ ] Logs no console (sem erros)
- [ ] Responsividade (mobile + desktop)

---

## 🚀 Próximos Passos

1. **Executar testes** (Testes 1-7)
2. **Integrar em PDV** (adicionar botão "Emitir Nota")
3. **Criar vídeo tutorial** (2 min: como ativar)
4. **Documentar no FAQ** (por que token é seguro)

---

**Data de conclusão da implementação:** 2026-06-22  
**Status:** Pronto para testes  
**Tempo estimado de testes:** 1-2 horas (manual)
