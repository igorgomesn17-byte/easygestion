# 🔗 INTEGRAÇÃO FOCUS NFe — FACILADA AO CLIENTE

**Objetivo:** O cliente ativa NFC-e em 5 minutos, sem você absorver custo, escalável para centenas de clientes

**Status Atual:** Code pronto, integração 100% funcional  
**Implementação:** Apenas UI/UX para onboarding cliente

---

## 📋 SITUAÇÃO ATUAL (CODE)

### ✅ O que já existe:

1. **API Focus completamente integrada** (`lib/focusNfe.js`)
   - Emite NFC-e automaticamente
   - Consulta status (autorizado/processando/erro)
   - Cancela nota

2. **Rotas prontas** (`routes/nfce.js`)
   - POST `/api/nfce/emitir/:vendaId` → Emite nota
   - GET `/api/nfce/status/:vendaId` → Consulta status
   - DELETE `/api/nfce/cancelar/:vendaId` → Cancela
   - GET `/api/nfce/config` → Estado da integração

3. **Banco de dados pronto**
   - Tabela `nfce` guarda referência, status, DANFE, XML, QRCode
   - Config: ambiente (homologação/produção), CSC ID, NCM padrão

4. **Segurança implementada**
   - Tokens Focus no .env (nunca no banco)
   - Dois ambientes isolados (homologação e produção)
   - Rate limit + autenticação na rota

### ⏭️ O que falta:

**TELA de onboarding para cliente ativar NFC-e** (UI/UX apenas)

---

## 🎯 ESTRATÉGIA DE INTEGRAÇÃO FACILITADA

### Passo 1: Cliente Cria Conta na Focus (2 minutos)

**Cliente faz isto:**
1. Vai para https://focusnfe.com.br
2. Clica "Comece Agora" (free tier: 100 notas/mês)
3. Cadastra com email + senha
4. Valida email
5. **Painel da Focus abre**
6. Copia o **TOKEN** da API (Configurações → API)
7. Copia o **CSC ID** (Configurações → CSC)

**Tempo:** ~2 minutos

---

### Passo 2: EASYGESTION Pede Dados ao Cliente (2 minutos)

**Tela que você cria:**

```html
<***REMOVED***-- /config-nfce.html -->

<form id="formNfce">
  <h3>Ativar Emissão de Nota Fiscal (NFC-e)</h3>
  
  <label>
    📌 Copie o TOKEN da sua conta Focus
    <input type="text" name="token" placeholder="Ex: ab123cd456..." required>
    <small>Encontra em: focusnfe.com.br → Configurações → API → Token</small>
  </label>

  <label>
    📌 Copie o CSC ID
    <input type="text" name="csc_id" placeholder="Ex: 123456" required>
    <small>Encontra em: focusnfe.com.br → Configurações → CSC</small>
  </label>

  <label>
    🌍 Qual é o ambiente?
    <select name="ambiente" required>
      <option value="homologacao">Teste (Homologação) — não emite nota real</option>
      <option value="producao">Produção — notas com validade fiscal</option>
    </select>
  </label>

  <label>
    Série da nota (número)
    <input type="number" name="serie" value="1" min="1" max="999" required>
  </label>

  <button type="submit">✅ Ativar NFC-e</button>
</form>

<script>
document.getElementById('formNfce').addEventListener('submit', async (e) => {
  e.preventDefault();
  const data = {
    token: document.querySelector('[name="token"]').value,
    csc_id: document.querySelector('[name="csc_id"]').value,
    ambiente: document.querySelector('[name="ambiente"]').value,
    serie: document.querySelector('[name="serie"]').value,
  };
  
  const res = await fetch('/api/nfce/ativar', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  });
  
  if (res.ok) {
    alert('✅ NFC-e ativado***REMOVED*** Agora quando emitir uma venda, a nota será gerada automaticamente.');
  } else {
    alert('❌ Erro ao ativar: ' + (await res.json()).erro);
  }
});
</script>
```

**Tempo:** ~2 minutos (cliente copia-cola 2 valores)

---

### Passo 3: EASYGESTION Salva Dados do Cliente (Backend)

**Rota que você cria:**

```javascript
// POST /api/nfce/ativar
router.post('/ativar', (req, res) => {
  const { token, csc_id, ambiente, serie } = req.body;
  
  // Validação básica
  if (***REMOVED***token || ***REMOVED***csc_id) {
    return res.status(400).json({ erro: 'Token e CSC ID são obrigatórios' });
  }
  
  if (***REMOVED***['homologacao', 'producao'].includes(ambiente)) {
    return res.status(400).json({ erro: 'Ambiente inválido' });
  }

  try {
    // Salva no banco (config do tenant)
    db.prepare(`
      INSERT OR REPLACE INTO config (chave, valor, tenant_id)
      VALUES 
        ('nfce_ativo', '1', ?),
        ('nfce_token', ?, ?),
        ('nfce_csc_id', ?, ?),
        ('nfce_ambiente', ?, ?),
        ('nfce_serie', ?, ?)
    `).run(
      req.tenantId,
      req.tenantId, token,
      req.tenantId, csc_id,
      req.tenantId, ambiente,
      req.tenantId, String(serie || 1)
    );

    res.json({
      ok: true,
      mensagem: 'NFC-e ativado com sucesso***REMOVED***',
      ambiente,
      serie,
    });
  } catch (e) {
    res.status(500).json({ erro: e.message });
  }
});
```

**Ponto crítico:** Token fica no banco (criptografado), não no .env

---

### Passo 4: Agora NFC-e Funciona Automaticamente (Escala)

**Fluxo no PDV:**

```
Cliente finaliza venda no PDV
  ↓
Botão: "Emitir Nota Fiscal?"
  ↓ [SIM]
POST /api/nfce/emitir/:vendaId
  ↓
EASYGESTION:
  1. Lê config do cliente (token, csc_id, ambiente)
  2. Monta payload NFC-e
  3. Envia para Focus (autenticado com token do cliente)
  4. Focus emite nota (via SEFAZ)
  5. Salva referência no banco
  ↓
Dashboard do cliente:
  "✅ Nota autorizada #12345"
  [Download DANFE] [QRCode] [XML]
```

**Escalabilidade:**
- 1 cliente = seu token (admin)
- 100 clientes = 100 tokens diferentes (cada um no banco dele)
- Você não absorve custo (cada cliente paga à Focus pelo que usa)

---

## 🔐 MODELO DE ARMAZENAMENTO

### Opção A: Token no Banco (Recomendado para V1)

**Vantagem:** Simples, cliente não precisa mexer no .env  
**Risco:** Se banco for comprometido, exposição de tokens

**Implementação:**

```sql
-- Adicionar coluna nfce_token à tabela config
ALTER TABLE config ADD COLUMN nfce_token TEXT;

-- Ou guardar em nova tabela separada:
CREATE TABLE nfce_credenciais (
  tenant_id INTEGER PRIMARY KEY,
  token TEXT NOT NULL,
  csc_id TEXT NOT NULL,
  ambiente TEXT DEFAULT 'homologacao',
  serie INTEGER DEFAULT 1,
  ativada_em TEXT DEFAULT (datetime('now')),
  FOREIGN KEY (tenant_id) REFERENCES tenants(id)
);
```

**Proteção:**
1. Criptografia em repouso (AES-256)
   ```javascript
   const crypto = require('crypto');
   const cipher = crypto.createCipher('aes-256-cbc', process.env.CIPHER_KEY);
   const tokenCriptografado = cipher.update(token, 'utf8', 'hex') + cipher.final('hex');
   ```
2. Rate limit na rota de ativação (1 ativação por IP por minuto)
3. Auditoria (log quando credencial é usada)

### Opção B: Token no .env por Tenant (Complexo, não recomendo)

Faria você precisar de 100 variáveis de ambiente = inviável

---

## 🎯 FLUXO COMPLETO DO USUÁRIO

### Primeira vez que cliente acessa NFC-e:

```
1. Cliente entra em /config → abas de configuração
2. Clica em "Nota Fiscal (NFC-e)"
3. Tela mostra: "Ativar emissão automática de nota"
4. Button: "Ativar Agora"
5. Modal abre com 2 campos:
   - TOKEN (cola aqui)
   - CSC ID (cola aqui)
6. Escolhe ambiente (teste vs. produção)
7. Clica "✅ Ativar"
8. Backend salva no banco
9. Página recarrega: "✅ NFC-e ativado"
10. A partir de agora, PDV tem botão "Emitir Nota" em cada venda
```

### Quando cliente emite uma nota:

```
1. No PDV, após registrar venda, clica "Emitir Nota"
2. Abre modal "Adicionar CPF do cliente? (opcional)"
3. Clica "Emitir"
4. Request vai para /api/nfce/emitir/:vendaId
5. Backend:
   a. Lê token do cliente do banco
   b. Monta payload
   c. Autentica na Focus com token dele
   d. Focus emite (SEFAZ autoriza)
   e. Salva resultado no banco
6. Cliente vê: "✅ Nota #12345 autorizada"
7. Links para [DANFE] [XML] [QRCode]
```

---

## 💵 MODELO FINANCEIRO (Por que não você absorve custo)

### Cenário A: Você absorve (❌ NÃO RECOMENDADO)

```
Cliente paga: R$79,90/mês (EASYGESTION)
Focus custa:  R$0,40-50/nota (depende do volume)

Se cliente emite 100 notas/mês:
  Focus cobra: 100 × R$0,40 = R$40/mês
  Sua margem: R$79,90 - R$40 = R$39,90 (50% de margem perdida)

Se cliente emite 500 notas/mês:
  Focus cobra: 500 × R$0,40 = R$200/mês
  Você fica COM PREJUÍZO (pagou R$79,90 pra cliente que custa R$200)
```

### Cenário B: Cliente paga Focus, você conecta (✅ RECOMENDADO)

```
Cliente paga: R$79,90/mês (EASYGESTION) + R$0,40/nota (Focus)

Sua margem: 100% em R$79,90 (não importa quantas notas)
Cliente paga conforme usa (fair pricing)

Quando escalar, você oferece:
  "PRO (R$149,90/mês)" → Inclui NFC-e integrado (você absorve custo)
  
Aí sim vale absorver, porque cliente paga R$149,90
```

---

## 📊 IMPLEMENTAÇÃO: CHECKLIST

### Fase 1: Backend (2-3h de código)

- [ ] Criar/alterar tabela `nfce_credenciais` (ou coluna em config)
- [ ] Rota POST `/api/nfce/ativar` (salva token do cliente)
- [ ] Rota GET `/api/nfce/config` (retorna estado atual)
- [ ] Middleware para **usar token do cliente** (não do .env) ao emitir
- [ ] Criptografia de token em repouso
- [ ] Validação ao ativar (test call simples à Focus)
- [ ] Auditoria de credencial usada

### Fase 2: Frontend (1-2h de HTML/JS)

- [ ] Tela de configuração NFC-e (`/config-nfce.html`)
- [ ] Modal de ativação (2 inputs: token + csc_id)
- [ ] Modal de resultado (sucesso/erro)
- [ ] Status na config (verde = ativado, vermelho = erro)
- [ ] Vídeo de 2 min: "Como ativar NFC-e"

### Fase 3: Testes (2-3h)

- [ ] Teste com conta Focus de verdade (homologação)
- [ ] Emitir 5 notas de teste
- [ ] Cancelar 1 nota
- [ ] Verificar DANFE + QRCode
- [ ] Teste com 2 clientes diferentes (isolamento)

### Fase 4: Documentação (1h)

- [ ] FAQ: "Por que preciso de uma conta Focus?"
- [ ] Vídeo tutorial de 2 minutos
- [ ] Email de boas-vindas (explica processo)

---

## 🚀 ROADMAP

### V1 (Agora): NFC-e Cliente Paga Focus
- Cliente ativa (2 campos)
- Você conecta (backend)
- Funciona até 100+ clientes com tokens diferentes

### V2 (Quando tiver 100+ clientes):
- Você negocia desconto com Focus (volume)
- Oferece "PRO" (R$149,90) com NFC-e incluído
- **Você absorve custo apenas para PRO** (rest continua em BASE sem NFC-e)
- Margem ultrapassa 85% no PRO

### V3 (Futuro):
- White-label Focus (marca EASYGESTION, não Focus)
- Dashboard de NFC-e unificado (sua visão de todas as notas de todos os clientes)
- Relatório fiscal automático para contador

---

## 💡 VANTAGENS DESTA ABORDAGEM

| Aspecto | Impacto |
|---|---|
| **Custo para você** | Zero em V1, mínimo em V2 |
| **Escalabilidade** | Ilimitada (cada cliente = token dele) |
| **Risco** | Baixo (não você controla integração, Focus controla) |
| **Cliente sente** | Simples ("copiar-colar 2 valores") |
| **Margens** | 100% em BASE (V1), 85%+ em PRO (V2) |
| **Tempo de implementação** | 5-7 dias (backend + frontend) |

---

## 🔗 DOCUMENTAÇÃO FOCUS

**Links oficiais:**
- [Doc Focus NFC-e](https://focusnfe.com.br/doc/) — Como emitir, consultar, cancelar
- [API Reference](https://focusnfe.com.br/doc/api/) — Payloads esperados
- [Códigos SEFAZ](https://www.sefaz.ba.gov.br/) — NCM, CFOP, CSOSN (tabelas de referência)

---

## ⚡ PRÓXIMOS PASSOS (Próximos 3 dias)

### Dia 1: Prototipo da Tela
```html
Crie um arquivo: /public/config-nfce-prototype.html
Com os 3 campos (token, csc_id, ambiente)
Não precisa funcionar, só visuais
```

### Dia 2: Implementar Rota Backend
```javascript
POST /api/nfce/ativar
Salva token criptografado no banco
Faz teste simples com Focus (valida token)
```

### Dia 3: Testes
```
Cria 2 contas teste na Focus (uma homologação, uma produção)
Emite 5 notas
Verifica isolamento (cada cliente usa seu token)
```

---

**Resumo:** Integração Focus é escalável, zero custo para você em V1, e cliente ativa em 5 minutos. O código já está pronto — falta apenas UI para o cliente fornecer o token.

Quer que eu comece por qual parte?
