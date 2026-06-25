# 🔒 Sistema de Auditoria & Compliance LGPD

## Problema Resolvido

**ANTES:** O painel admin (`/admin`) era acessado por header `x-admin-password` — **nenhuma auditoria, nenhuma autenticação legítima, impossível saber quem fez o quê.**

**DEPOIS:** Admin faz login normal com **usuário + senha**, gerando uma sessão autêntica. **Todas as ações administrativas são registradas** na tabela `auditoria` com:
- ❓ **Quem?** ID + nome do usuário
- 🎯 **O quê?** Ação (DELETE, PATCH) e recurso afetado
- 📅 **Quando?** Timestamp preciso
- 🏢 **Onde?** Qual tenant foi afetado
- 📊 **Antes/Depois?** Snapshot dos dados (para rastreamento)
- 🔐 **Rastreabilidade legal:** essencial para LGPD/GDPR

---

## Arquitetura da Solução

### 1️⃣ Tabela de Auditoria (`auditoria`)

```sql
CREATE TABLE auditoria (
  id           INTEGER PRIMARY KEY,     -- registro único
  usuario_id   INTEGER,                 -- quem fez (referência à tabela usuarios)
  usuario_nome TEXT,                    -- snapshot do nome (forensics)
  tenant_id    INTEGER,                 -- qual tenant foi afetado
  acao         TEXT,                    -- DELETE_tenant, PATCH_tenant_status, etc
  recurso      TEXT,                    -- 'tenants', 'usuarios', 'produtos', etc
  recurso_id   INTEGER,                 -- ID do registro modificado
  antes        TEXT (JSON),             -- estado anterior (snapshot)
  depois       TEXT (JSON),             -- estado novo (snapshot)
  ip           TEXT,                    -- IP da requisição
  status_http  INTEGER,                 -- 200, 400, 403, 500, etc
  criado_em    TEXT DEFAULT now()
);

-- Índices para queries rápidas
CREATE INDEX idx_auditoria_usuario ON auditoria(usuario_id);
CREATE INDEX idx_auditoria_tenant ON auditoria(tenant_id);
CREATE INDEX idx_auditoria_recurso ON auditoria(recurso);
CREATE INDEX idx_auditoria_data ON auditoria(criado_em);
```

### 2️⃣ Usuário Admin Real (tabela `usuarios`)

O admin agora é um **usuário legítimo na tabela `usuarios`** com:

```
nome: 'admin'
email: 'seu-email@example.com'
papel: 'admin'
ativo: 1
senha_hash: 'scrypt$...$...' (mesmo hash do auth normal)
```

**Processo de login:**

1. POST `/api/admin/login` com `{ nome: 'admin', senha: '...' }`
2. Sistema tenta buscar usuário 'admin' com papel='admin' na tabela
3. Se não encontrar, tenta fallback para `ADMIN_SENHA_HASH` do `.env` (compatibilidade)
4. Se senha bater, cria **sessão normal** (req.session.logado = true, papel = 'admin')

### 3️⃣ Middleware de Auditoria

Arquivo: `middleware/auditoria.js`

**Funções principais:**

```javascript
// Registra uma ação administrativas (chamado manualmente no handler)
auditarAcao(req, {
  acao: 'DELETE_tenant',
  recurso: 'tenants',
  recurso_id: 5,
  antes: { id: 5, nome: 'Loja XYZ' },
  depois: null,  // se deletou, depois é null
  status: 200
});

// Busca histórico de auditoria com filtros
buscarAuditoria({
  recurso: 'tenants',
  recurso_id: 5,
  usuario_id: 1,
  tenant_id: 2,
  dias: 90  // últimos 90 dias
});
```

### 4️⃣ Endpoints de Auditoria

**GET /api/admin/auditoria** — lista histórico (com filtros)

```bash
# Todas as ações dos últimos 90 dias
GET /api/admin/auditoria

# Apenas deletions de tenants
GET /api/admin/auditoria?recurso=tenants&acao=DELETE

# Ações de um usuário específico
GET /api/admin/auditoria?usuario_id=1

# Últimos 30 dias
GET /api/admin/auditoria?dias=30
```

Resposta:
```json
{
  "auditoria": [
    {
      "id": 1,
      "usuario_id": 1,
      "usuario_nome": "admin",
      "tenant_id": 5,
      "acao": "DELETE_tenant",
      "recurso": "tenants",
      "recurso_id": 5,
      "antes": "{...}",
      "depois": null,
      "ip": "192.168.1.100",
      "status_http": 200,
      "criado_em": "2026-06-22T14:30:45Z"
    }
  ],
  "total": 1
}
```

**GET /api/admin/auditoria/:id** — detalhes completos de um registro

```bash
GET /api/admin/auditoria/1
```

---

## Setup Inicial

### Passo 1: Crie o usuário admin

```bash
node scripts/criar-admin.js
```

Script interativo que:
- ✅ Pede nome (sempre `admin`)
- ✅ Pede senha (mínimo 8 caracteres)
- ✅ Pede email (opcional)
- ✅ Hash a senha com scrypt e insere na tabela

### Passo 2: Inicie o servidor

```bash
npm start
```

### Passo 3: Acesse o painel

```
GET /admin
```

Você será redirecionado para login. Faça login com:
- **Usuário:** admin
- **Senha:** a que você criou no passo 1

### Passo 4: Visualize a auditoria

```
GET /api/admin/auditoria
```

Verá o histórico de todas as ações administrativas realizadas.

---

## O que é Auditado

### ✅ Sempre auditado (DELETE)

- `DELETE /api/admin/clientes/:id` → registra deleção completa do tenant
- Payload: dados ANTES (null DEPOIS porque foi deletado)

### ✅ Sempre auditado (PATCH)

- `PATCH /api/admin/clientes/:id` → registra mudanças de status
- Payload: snapshot ANTES e DEPOIS para comparação

### ❌ Não é auditado (por enquanto)

- GET (leitura não precisa de auditoria)
- Login/Logout (já tem logs de aplicação)
- Queries que não modificam estado

---

## Conformidade Legal

### LGPD (Lei Geral de Proteção de Dados)

✅ **Art. 46:** Direito de acesso — agora você consegue rastrear "quem acessou os dados de qual cliente"

✅ **Art. 52:** Responsabilidade — você pode provar que ações foram feitas por admin autenticado, não por acesso anônimo

✅ **Direito ao esquecimento (Art. 17)** — ao deletar um cliente, fica registrado quem deletou, quando e por quê

### GDPR (Europa)

✅ **Direito de acesso** — auditoria permite responder "quem, quando e por quê" em caso de incidente

✅ **Responsabilidade** — prova de que acesso foi controlado e autenticado

---

## Consultas Úteis (SQL)

### Quem deletou quais clientes?

```sql
SELECT usuario_nome, recurso_id, criado_em, antes
FROM auditoria
WHERE acao = 'DELETE_tenant'
ORDER BY criado_em DESC;
```

### Histórico de um cliente específico

```sql
SELECT * FROM auditoria
WHERE recurso = 'tenants' AND recurso_id = 5
ORDER BY criado_em DESC;
```

### Ações de um admin específico

```sql
SELECT * FROM auditoria
WHERE usuario_id = 1
ORDER BY criado_em DESC LIMIT 100;
```

### Mudanças de status de tenants (bloqueios)

```sql
SELECT usuario_nome, recurso_id, antes, depois, criado_em
FROM auditoria
WHERE acao LIKE 'PATCH_tenant%'
ORDER BY criado_em DESC;
```

---

## Fallback: Admin do .env

Se você quiser manter compatibilidade com o sistema antigo (`ADMIN_SENHA_HASH` do `.env`):

1. **Login via .env:** se a senha bater, cria sessão com `usuario_id = null` e `usuario_nome = 'admin-env'`
2. **Auditoria ainda funciona:** registra como `usuario_nome = 'admin-env'` na tabela
3. **Recomendação:** migre para usuário admin real (script `criar-admin.js`)

---

## Próximos Passos (Roadmap)

- [ ] Interface visual da auditoria no painel admin (tabela com filtros)
- [ ] Alertas em tempo real se um cliente for bloqueado/deletado
- [ ] Export de auditoria em CSV (para relatórios/auditorias externas)
- [ ] Retenção automática (manter apenas últimos 12 meses de auditoria)
- [ ] Criptografia de dados sensíveis na auditoria (antes/depois)
- [ ] Integração com sistema de backup para replicação offline

---

## Perguntas Frequentes

**P: Posso editar registros de auditoria?**
R: Não é recomendado. A tabela de auditoria é histórico imutável. Se precisa corrigir algo, crie novo registro e documente a correção.

**P: Quanto espaço ocupa?**
R: Aproximadamente 1-2 KB por ação (os JSONs antes/depois). Com 50 ações/dia = ~1 MB/mês. Retenção de 12 meses = ~12 MB (trivial).

**P: Posso deletar a auditoria?**
R: Tecnicamente sim, mas viola LGPD. Guarde por no mínimo 12 meses. Se precisar deletar por conformidade, documente.

**P: O que acontece se o admin do .env e o da tabela existem?**
R: Sistema tenta primeiro a tabela (usuário `admin` com papel `admin`). Depois tenta fallback do .env.

---

## Testes

```bash
# 1. Criar admin
node scripts/criar-admin.js

# 2. Iniciar servidor
npm start

# 3. Login via Postman/curl
curl -X POST http://localhost:3000/api/admin/login \
  -H "Content-Type: application/json" \
  -d '{"nome":"admin","senha":"sua-senha-aqui"}'

# 4. Ver auditoria
curl http://localhost:3000/api/admin/auditoria \
  -H "Cookie: ds.sid=..."

# 5. Bloquear um tenant (deve aparecer na auditoria)
curl -X PATCH http://localhost:3000/api/admin/clientes/1 \
  -H "Content-Type: application/json" \
  -d '{"status":"bloqueado"}' \
  -H "Cookie: ds.sid=..."

# 6. Ver o registro de auditoria
curl http://localhost:3000/api/admin/auditoria?recurso=tenants
```

---

**Documento relacionado:** [DATABASE-MULTI-TENANT-ISOLATION.md](DATABASE-MULTI-TENANT-ISOLATION.md)
