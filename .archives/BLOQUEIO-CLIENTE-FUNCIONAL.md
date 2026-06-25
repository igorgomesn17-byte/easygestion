# 🔴 Bloqueio de Cliente — Funcionalidade Agora Funcional

## Problema Resolvido

**ANTES:** Admin bloqueava um cliente com PATCH, mas:
- ❌ Cliente continua acessando (sessão ativa não era validada)
- ❌ Nenhuma notificação enviada (cliente não sabe por quê)
- ❌ Middleware `validarTenantAtivo` tinha bug (continuava após destroy)

**DEPOIS:** Bloqueio agora é **FUNCIONAL**:
- ✅ Cliente é imediatamente desconectado em próxima requisição
- ✅ Recebe email explicando a situação
- ✅ Admin pode informar motivo do bloqueio
- ✅ Reativação também envia notificação
- ✅ Auditoria registra tudo (quem bloqueou, quando, motivo)

---

## Mudanças Implementadas

### 1. **Correção do Middleware** (`middleware/seguranca.js`)

**Problema:** Após chamar `req.session.destroy()`, o código continuava com `next()`, permitindo acesso.

**Solução:** Adicionar `return;` após o destroy para não prosseguir:

```javascript
if (tenant.status === 'bloqueado') {
  req.session.destroy((err) => {
    return res.status(403).json({
      erro: 'Sua conta foi bloqueada pelo administrador',
      bloqueado: true
    });
  });
  return; // ✅ NÃO continua***REMOVED***
}
```

### 2. **Templates de Email** (`lib/email.js`)

**Adicionados:**

- `templateContaBloqueada(nomeCliente, motivo)` — notifica bloqueio com visual ⚠️
- `templateContaReativada(nomeCliente)` — confirma reativação com visual ✅

**Exemplos:**

```javascript
// Quando cliente é bloqueado
const html = templateContaBloqueada('Loja XYZ', 'Pagamento em atraso');
enviarEmail('loja@example.com', '⚠️ Sua conta foi bloqueada', html);

// Quando cliente é reativado
const html = templateContaReativada('Loja XYZ');
enviarEmail('loja@example.com', '✅ Sua conta foi reativada', html);
```

### 3. **Rota PATCH Melhorada** (`routes/admin.js`)

**Antes:**
```javascript
PATCH /api/admin/clientes/5
{ "status": "bloqueado" }
// → Apenas muda status, sem notificação
```

**Depois:**
```javascript
PATCH /api/admin/clientes/5
{ 
  "status": "bloqueado",
  "motivo": "Pagamento em atraso de 30 dias" // opcional
}

// → Faz tudo:
// 1. Muda status
// 2. Registra auditoria
// 3. Envia email ao cliente
// 4. Resposta inclui notificação
```

**Lógica:**

```javascript
const statusAnterior = antes.status;
const statusNovo = status;
const houveMudanca = statusAnterior ***REMOVED***== statusNovo;

// Se mudou ativo → bloqueado: envia aviso
if (houveMudanca && statusNovo === 'bloqueado') {
  const html = templateContaBloqueada(antes.nome_loja, motivo);
  enviarEmail(antes.email, '⚠️ Sua conta foi bloqueada', html);
}

// Se mudou bloqueado → ativo: envia confirmação
if (houveMudanca && statusNovo === 'ativo' && statusAnterior === 'bloqueado') {
  const html = templateContaReativada(antes.nome_loja);
  enviarEmail(antes.email, '✅ Sua conta foi reativada', html);
}
```

---

## Fluxo Completo

```
CENÁRIO: Admin bloqueia cliente por atraso de pagamento

┌─────────────────────────────────────────┐
│ Admin acessa /admin/clientes            │
│ Clica em "Bloquear" no cliente          │
└─────────────────────────────────────────┘
                    ↓
        PATCH /api/admin/clientes/5
        {
          "status": "bloqueado",
          "motivo": "Atraso de pagamento"
        }
                    ↓
┌─────────────────────────────────────────┐
│ Rota recebe requisição                  │
├─────────────────────────────────────────┤
│ 1. Busca dados ANTES (snapshot)          │
│    nome: 'Loja XYZ'                     │
│    email: 'loja@example.com'            │
│    status: 'ativo'                      │
│                                         │
│ 2. UPDATE tenants SET status='bloqueado'│
│                                         │
│ 3. Auditoria: registra mudança          │
│    usuario_id: 1 (admin)                │
│    antes: {status: 'ativo', ...}        │
│    depois: {status: 'bloqueado', ...}   │
│                                         │
│ 4. Detecta mudança: ativo → bloqueado   │
│                                         │
│ 5. Envia EMAIL ao cliente:              │
│    Para: loja@example.com               │
│    Assunto: ⚠️ Sua conta foi bloqueada  │
│    Corpo: template com motivo           │
│                                         │
│ 6. Resposta 200 OK com confirmação      │
└─────────────────────────────────────────┘
                    ↓
    CLIENTE RECEBE EMAIL ⚠️
    "Sua conta foi bloqueada
     Motivo: Atraso de pagamento"
                    ↓
   CLIENTE TENTA ACESSAR /api/produtos
                    ↓
┌─────────────────────────────────────────┐
│ Middleware validarTenantAtivo acionado  │
├─────────────────────────────────────────┤
│ 1. Verifica tenant.status (DB)          │
│    → Encontra 'bloqueado'               │
│                                         │
│ 2. Destroi sessão do cliente            │
│    → Session cookie é invalidado        │
│                                         │
│ 3. Retorna 403 Forbidden:               │
│    {                                    │
│      erro: "Sua conta foi bloqueada",   │
│      bloqueado: true                    │
│    }                                    │
│                                         │
│ 4. NÃO prossegue (return)               │
│    → Cliente é REJEITADO                │
└─────────────────────────────────────────┘
                    ↓
    CLIENTE VÊ ERRO 403
    "Sua conta foi bloqueada"
                    ↓
    FLUXO DE REATIVAÇÃO:
    Admin resolve atraso, clica "Reativar"
                    ↓
        PATCH /api/admin/clientes/5
        { "status": "ativo" }
                    ↓
        CLIENTE RECEBE EMAIL ✅
        "Bem-vindo de volta***REMOVED***"
                    ↓
    CLIENTE FAZ LOGIN NOVAMENTE
    E CONSEGUE ACESSAR
```

---

## Como Usar

### Bloquear Cliente

```bash
PATCH /api/admin/clientes/5
Content-Type: application/json

{
  "status": "bloqueado",
  "motivo": "Pagamento em atraso de 30 dias"  # opcional
}
```

**Resposta:**
```json
{
  "sucesso": true,
  "status": "bloqueado",
  "notificacao": "Email enviado ao cliente"
}
```

**O que acontece:**
- ✅ Status muda para `bloqueado`
- ✅ Email enviado para `loja@example.com`
- ✅ Auditoria registra (quem, quando, antes/depois)
- ✅ Cliente será desconectado em próxima requisição

### Reativar Cliente

```bash
PATCH /api/admin/clientes/5
Content-Type: application/json

{
  "status": "ativo"
}
```

**Resposta:**
```json
{
  "sucesso": true,
  "status": "ativo",
  "notificacao": "Email enviado ao cliente"
}
```

**O que acontece:**
- ✅ Status muda para `ativo`
- ✅ Email de reativação enviado
- ✅ Auditoria registra
- ✅ Cliente pode fazer login novamente

---

## Ver Auditoria de Bloqueios

```bash
# Todos os bloqueios/desbloqueios
GET /api/admin/auditoria?acao=PATCH_tenant_status

# Resultado:
{
  "auditoria": [
    {
      "usuario_id": 1,
      "usuario_nome": "admin",
      "acao": "PATCH_tenant_status",
      "recurso": "tenants",
      "recurso_id": 5,
      "antes": {
        "status": "ativo"
      },
      "depois": {
        "status": "bloqueado"
      },
      "criado_em": "2026-06-22T14:30:45Z"
    }
  ]
}
```

---

## Emails Enviados

### Exemplo: Bloqueio

```
Para: loja@example.com
Assunto: ⚠️ Sua Conta Foi Bloqueada

Oi Loja XYZ,

Sua conta no EasyGestão foi bloqueada temporariamente.

⚠️ Motivo: Atraso de pagamento

O que acontece agora?
• Você NÃO conseguirá acessar a plataforma até a reativação
• Seus dados estão seguros e preservados
• Entre em contato conosco para resolver a situação

Dúvidas ou quer contestar? Responda este email.

Equipe EasyGestão
```

### Exemplo: Reativação

```
Para: loja@example.com
Assunto: ✅ Sua Conta Foi Reativada

Oi Loja XYZ,

Bem-vindo de volta***REMOVED*** Sua conta no EasyGestão foi reativada.

✅ Você agora pode acessar normalmente.

[Acessar plataforma] (botão link)

Se tiver dúvidas, entre em contato.

Equipe EasyGestão
```

---

## Comportamento do Cliente Bloqueado

| Ação | Resultado |
|------|-----------|
| Tenta fazer login | 401 Unauthorized (senha/usuário incorretos não é aceito) |
| Tenta usar sessão ativa | 403 Forbidden: "Sua conta foi bloqueada" |
| Tenta acessar `/api/produtos` | 403 + sessão destruída |
| Tenta acessar `/admin` | 403 (middleware valida antes) |
| Vê email alertando sobre bloqueio | ✅ Recebe |

---

## Logs Gerados

Quando um cliente é bloqueado, aparece em logs:

```
[ADMIN] PATCH /api/admin/clientes/5 → status='bloqueado'
[NOTIF] Cliente Loja XYZ (loja@example.com) foi bloqueado
[EMAIL OK] loja@example.com: ⚠️ Sua Conta Foi Bloqueada
[AUDITORIA] INSERT registro de mudança
```

---

## Teste Manual

```bash
# 1. Bloquear cliente
curl -X PATCH http://localhost:3000/api/admin/clientes/1 \
  -H "Content-Type: application/json" \
  -d '{"status":"bloqueado","motivo":"Teste"}' \
  -H "Cookie: ds.sid=..."

# 2. Verificar que cliente foi bloqueado
curl http://localhost:3000/api/admin/auditoria \
  -H "Cookie: ds.sid=..." | jq '.'

# 3. Tentar acessar como cliente bloqueado (usar outra sessão)
curl http://localhost:3000/api/produtos \
  -H "Cookie: ds.sid=..." 
# → Resposta: 403 "Sua conta foi bloqueada"

# 4. Reativar
curl -X PATCH http://localhost:3000/api/admin/clientes/1 \
  -H "Content-Type: application/json" \
  -d '{"status":"ativo"}' \
  -H "Cookie: ds.sid=..."

# 5. Cliente consegue acessar novamente
curl http://localhost:3000/api/produtos \
  -H "Cookie: ds.sid=..."
# → Resposta: 200 OK (funciona***REMOVED***)
```

---

## Conformidade & Segurança

✅ **LGPD:** Auditoria completa de quem bloqueou, quando e por quê
✅ **Segurança:** Sessão é destruída, cliente é isolado immediately
✅ **UX:** Cliente recebe notificação explicando o bloqueio
✅ **Reversibilidade:** Admin pode reativar a qualquer momento
✅ **Dados:** Nada é deletado, apenas marcado como "bloqueado"

---

## Relacionado

- [AUDITORIA-LGPD.md](AUDITORIA-LGPD.md) — Rastreamento de ações
- [DATABASE-MULTI-TENANT-ISOLATION.md](DATABASE-MULTI-TENANT-ISOLATION.md) — Isolamento

---

**Última atualização:** 2026-06-22
**Status:** ✅ Pronto para testes
