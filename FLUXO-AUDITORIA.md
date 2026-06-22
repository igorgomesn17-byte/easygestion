# 🔒 Fluxo de Auditoria LGPD — Diagrama Visual

## Antes vs. Depois

### ❌ ANTES (Inseguro)

```
Alguém acessa /admin
        ↓
Envia header: x-admin-password
        ↓
Sistema valida contra ADMIN_SENHA_HASH do .env
        ↓
Acesso direto ao painel
        ↓
❌ PROBLEMA:
   - Ninguém sabe quem acessou
   - Sem auditoria
   - Impossível rastrear ações
   - Violação de LGPD
   - Impossível investigar "quem deletou cliente X?"
```

---

### ✅ DEPOIS (LGPD-Compliant)

```
SETUP INICIAL (1 vez):
┌─────────────────────────────────┐
│ node scripts/criar-admin.js     │
├─────────────────────────────────┤
│ • Nome: admin                   │
│ • Senha: escolha segura         │
│ • Email: opcional               │
│ → Hash scrypt + insert usuarios │
└─────────────────────────────────┘

LOGIN (toda vez):
┌──────────────────────────────────┐
│ POST /api/admin/login            │
│ {                                │
│   "nome": "admin",               │
│   "senha": "..."                 │
│ }                                │
├──────────────────────────────────┤
│ 1. Busca: SELECT * FROM usuarios │
│    WHERE nome='admin'            │
│    AND papel='admin'             │
│                                  │
│ 2. Valida: verificarSenha()      │
│                                  │
│ 3. ✅ Cria sessão:               │
│    req.session.logado = true     │
│    req.session.usuario_id = 1    │
│    req.session.papel = 'admin'   │
└──────────────────────────────────┘
        ↓
   ACESSO AUTORIZADO

AÇÕES AUDITADAS:
┌──────────────────────────────────────┐
│ DELETE /api/admin/clientes/5         │
├──────────────────────────────────────┤
│ 1. Busca dados ANTES                 │
│    SELECT * FROM tenants WHERE id=5  │
│                                      │
│ 2. Executa DELETE                    │
│                                      │
│ 3. ✅ Registra na auditoria:         │
│    INSERT INTO auditoria (           │
│      usuario_id: 1,                  │
│      usuario_nome: 'admin',          │
│      tenant_id: 1,                   │
│      acao: 'DELETE_tenant',          │
│      recurso: 'tenants',             │
│      recurso_id: 5,                  │
│      antes: { id:5, ... },           │
│      depois: null,                   │
│      ip: '192.168.1.100',            │
│      status_http: 200,               │
│      criado_em: now()                │
│    )                                 │
└──────────────────────────────────────┘
        ↓
✅ RASTREABILIDADE COMPLETA
   - Quem? usuario_id=1, admin
   - O quê? DELETE_tenant
   - Qual? recurso_id=5
   - Quando? criado_em (timestamp)
   - Antes/Depois? JSON completo
   - De onde? ip
```

---

## Ciclo Completo de Uma Ação Auditada

```
┌─────────────────────────────────────────────────────┐
│                                                     │
│           USUÁRIO ADMIN AUTENTICADO                │
│         (req.session.logado = true)               │
│                                                     │
└─────────────────────────────────────────────────────┘
                        ↓
                        ↓
┌─────────────────────────────────────────────────────┐
│  exigirAdminBackoffice(req, res, next)             │
│                                                     │
│  if ***REMOVED***req.session?.logado                           │
│    → 401 Unauthorized                              │
│  else if req.session.papel ***REMOVED***== 'admin'             │
│    → 403 Forbidden                                 │
│  else                                              │
│    → next() (permitir)                             │
└─────────────────────────────────────────────────────┘
                        ↓
                        ↓
┌─────────────────────────────────────────────────────┐
│        Handler: DELETE /api/admin/clientes/:id     │
│                                                     │
│  1. const antes = db.select(...)                   │
│  2. db.delete(...)  ← ação real                    │
│  3. auditarAcao(req, {                             │
│       acao: 'DELETE_tenant',                       │
│       recurso: 'tenants',                          │
│       recurso_id: id,                              │
│       antes: antes,                                │
│       depois: null,                                │
│       status: 200                                  │
│     })                                             │
│  4. res.json({sucesso: true})                      │
└─────────────────────────────────────────────────────┘
                        ↓
                        ↓
┌─────────────────────────────────────────────────────┐
│        auditarAcao() → INSERT INTO auditoria       │
│                                                     │
│  INSERT auditoria (                                │
│    usuario_id,     ← req.session.usuario_id        │
│    usuario_nome,   ← 'admin'                       │
│    tenant_id,      ← req.tenantId                  │
│    acao,           ← 'DELETE_tenant'               │
│    recurso,        ← 'tenants'                     │
│    recurso_id,     ← 5                             │
│    antes,          ← JSON.stringify({...})         │
│    depois,         ← null                          │
│    ip,             ← req.ip                        │
│    status_http,    ← 200                           │
│    criado_em       ← now()                         │
│  )                                                 │
│                                                     │
│  ✅ REGISTRADO NA AUDITORIA***REMOVED***                       │
└─────────────────────────────────────────────────────┘
                        ↓
                        ↓
┌─────────────────────────────────────────────────────┐
│     GET /api/admin/auditoria?recurso=tenants      │
│                                                     │
│  SELECT * FROM auditoria                           │
│  WHERE recurso='tenants'                           │
│  ORDER BY criado_em DESC                           │
│                                                     │
│  Response: [                                        │
│    {                                                │
│      id: 1,                                         │
│      usuario_id: 1,                                 │
│      usuario_nome: 'admin',                        │
│      tenant_id: 1,                                 │
│      acao: 'DELETE_tenant',                        │
│      recurso: 'tenants',                           │
│      recurso_id: 5,                                │
│      antes: {...},                                 │
│      depois: null,                                 │
│      ip: '192.168.1.100',                          │
│      status_http: 200,                             │
│      criado_em: '2026-06-22T14:30:45Z'             │
│    }                                                │
│  ]                                                 │
└─────────────────────────────────────────────────────┘
         ↓
         ↓
    ✅ PERGUNTA LGPD RESPONDIDA:
       "Quem deletou o cliente 5?"
       → Resposta: usuário admin no dia 2026-06-22
```

---

## Casos de Uso — Consultas Rápidas

### Caso 1: "Quem deletou qual cliente?"

```sql
SELECT usuario_nome, recurso_id, antes, criado_em
FROM auditoria
WHERE acao='DELETE_tenant'
ORDER BY criado_em DESC;

-- Resultado:
-- usuario_nome | recurso_id | antes | criado_em
-- admin        | 5          | {...} | 2026-06-22
```

**Resposta:** Admin deletou o cliente 5 em 22/06/2026

---

### Caso 2: "Qual histórico de um cliente específico?"

```sql
SELECT usuario_nome, acao, antes, depois, criado_em
FROM auditoria
WHERE recurso='tenants' AND recurso_id=5
ORDER BY criado_em DESC;

-- Resultado:
-- usuario_nome | acao | antes | depois | criado_em
-- admin        | DELETE_tenant | {...} | null | 2026-06-22
-- admin        | PATCH_tenant_status | {...ativo...} | {...bloqueado...} | 2026-06-21
```

**Resposta:** Cliente 5 foi bloqueado em 21/06 e deletado em 22/06

---

### Caso 3: "Auditar todas as ações de um admin?"

```sql
SELECT acao, recurso, recurso_id, criado_em
FROM auditoria
WHERE usuario_id=1
ORDER BY criado_em DESC;

-- Resultado:
-- acao | recurso | recurso_id | criado_em
-- DELETE_tenant | tenants | 5 | 2026-06-22
-- PATCH_tenant_status | tenants | 5 | 2026-06-21
-- PATCH_tenant_status | tenants | 3 | 2026-06-20
```

**Resposta:** Admin 1 deletou 1 cliente e bloqueou 2 nos últimos 3 dias

---

## Endpoints de Auditoria

### GET /api/admin/auditoria (lista histórico)

**Parâmetros (query):**
- `recurso` — filtro por tipo (tenants, usuarios, etc)
- `usuario_id` — filtro por admin
- `tenant_id` — filtro por tenant
- `dias` — últimos N dias (default 90)

**Exemplos:**

```bash
# Últimos 90 dias
GET /api/admin/auditoria

# Deletions de tenants apenas
GET /api/admin/auditoria?recurso=tenants&acao=DELETE

# Ações de um admin específico
GET /api/admin/auditoria?usuario_id=1

# Últimos 7 dias
GET /api/admin/auditoria?dias=7

# Tudo de um cliente específico
GET /api/admin/auditoria?recurso=tenants&recurso_id=5
```

---

### GET /api/admin/auditoria/:id (detalhes)

```bash
GET /api/admin/auditoria/1

# Response:
{
  "auditoria": {
    "id": 1,
    "usuario_id": 1,
    "usuario_nome": "admin",
    "tenant_id": 5,
    "acao": "DELETE_tenant",
    "recurso": "tenants",
    "recurso_id": 5,
    "antes": {
      "id": 5,
      "nome_loja": "Loja XYZ",
      "email": "loja@example.com",
      "status": "ativo"
    },
    "depois": null,
    "ip": "192.168.1.100",
    "status_http": 200,
    "criado_em": "2026-06-22T14:30:45.000Z"
  }
}
```

---

## Segurança — Em Resumo

```
┌─────────────────────────────────────────────┐
│           DEFESAS ATIVAS                    │
├─────────────────────────────────────────────┤
│ ✅ Autenticação: Hash scrypt (não reversível)
│ ✅ Sessão: Cookie HttpOnly + Secure        │
│ ✅ Rate limit: 5 tentativas / 15min        │
│ ✅ Auditoria: Quem, o quê, quando, antes/depois
│ ✅ IP capturado: Investigação de intrusão  │
│ ✅ Transações DB: Consistência             │
├─────────────────────────────────────────────┤
│ ⚠️ TODO (futuro)                           │
│ • 2FA (dois fatores)                       │
│ • Criptografia de dados sensíveis          │
│ • Retenção automática (12 meses)           │
│ • Alertas em tempo real                    │
└─────────────────────────────────────────────┘
```

---

## Conformidade LGPD — Checklist

| Artigo | Requisito | ✅ Implementado |
|--------|-----------|---|
| 6 | Fundamento legal | Interesse legítimo (segurança) |
| 17 | Direito ao esquecimento | Registra quem deletou |
| 46 | Direito de acesso | API de auditoria |
| 52 | Responsabilidade | Prova de autenticação |

---

**Documentação relacionada:**
- [AUDITORIA-LGPD.md](AUDITORIA-LGPD.md) — Documentação técnica completa
- [MUDANCAS-AUDITORIA.md](MUDANCAS-AUDITORIA.md) — Resumo de mudanças
