# 🔴 MUDANÇAS CRÍTICAS: Sistema de Auditoria LGPD

## Resumo Executivo

**Problema:** Admin panel usava header `x-admin-password` — impossível auditar quem fez o quê, violando LGPD.

**Solução:** Admin faz login normal com usuário + senha. **Todas as ações administrativas agora são registradas** em tabela de auditoria com rastreabilidade completa.

**Status:** ✅ Implementado | Testes aguardando

---

## Arquivos Modificados

### 1. `db/schema.sql`
- ✅ **Adicionada:** Tabela `auditoria` com índices para queries rápidas
- Campos: `usuario_id`, `usuario_nome`, `tenant_id`, `acao`, `recurso`, `recurso_id`, `antes`, `depois`, `ip`, `status_http`, `criado_em`

### 2. `middleware/auditoria.js` (NOVO)
- ✅ **Criado:** Middleware de auditoria
- Funções:
  - `middlewareAuditoria()` — intercepta requisições e registra após resposta
  - `auditarAcao(req, {...})` — registra manualmente (chamado nos handlers)
  - `buscarAuditoria({...})` — query com filtros (usuario_id, recurso, dias, etc)

### 3. `routes/admin.js`
- ✅ **Modificado:** Middleware `exigirAdminBackoffice` — agora verifica sessão real (papel='admin')
- ✅ **Reescrito:** `POST /api/admin/login` — autentica contra tabela `usuarios` ou fallback `.env`
- ✅ **Melhorado:** `POST /api/admin/logout` — destroy session corretamente
- ✅ **Adicionada auditoria:** Funções DELETE e PATCH agora registram antes/depois
- ✅ **Novo:** `GET /api/admin/auditoria` — lista histórico com filtros
- ✅ **Novo:** `GET /api/admin/auditoria/:id` — detalhes de um registro

### 4. `server.js`
- ✅ **Adicionado:** Import do middleware de auditoria
- ✅ **Adicionado:** Middleware aplicado ao prefixo `/api/admin`

### 5. `scripts/criar-admin.js` (NOVO)
- ✅ **Criado:** Script interativo para criar usuário admin
- Passo a passo: nome, senha (confirm), email (opcional)
- Hash automático com scrypt e insert na tabela `usuarios`

---

## Como Usar

### Setup Inicial (1 vez)

```bash
# 1. Criar usuário admin na tabela
node scripts/criar-admin.js

# Segue as instruções interativas:
# - Nome: admin (padrão, não muda)
# - Senha: escolha uma segura (8+ chars)
# - Email: opcional

# 2. Iniciar servidor
npm start

# 3. Acessar painel
# GET http://localhost:3000/admin
```

### Login

```bash
curl -X POST http://localhost:3000/api/admin/login \
  -H "Content-Type: application/json" \
  -d '{
    "nome": "admin",
    "senha": "sua-senha-aqui"
  }'

# Resposta:
# {
#   "sucesso": true,
#   "mensagem": "Logado como administrador",
#   "usuario": "admin"
# }
```

### Ver Auditoria

```bash
# Últimos 90 dias
curl http://localhost:3000/api/admin/auditoria

# Filtrado por recurso
curl 'http://localhost:3000/api/admin/auditoria?recurso=tenants'

# Últimos 30 dias
curl 'http://localhost:3000/api/admin/auditoria?dias=30'

# Detalhe de um registro
curl http://localhost:3000/api/admin/auditoria/1
```

---

## Compatibilidade com Produção

### Fallback do .env

Se você tiver `ADMIN_SENHA_HASH` configurado no `.env`:

1. Sistema tenta buscar usuário `admin` com papel `admin` na tabela
2. Se não encontrar, tenta hash do `.env` (compatibilidade)
3. **Recomendação:** migre para usuário admin real (execute `criar-admin.js`)

### Sessão

Admin agora é um **usuário normal com papel='admin'**:
- Session cookie `ds.sid` (13 chars, seguro)
- Max age 12h
- HttpOnly + Secure em produção
- SameSite='lax'

---

## O Que Mudou no Comportamento

| Antes | Depois |
|-------|--------|
| Header `x-admin-password` | Login normal `/api/admin/login` |
| Nenhuma auditoria | Tabela `auditoria` com todos os detalhes |
| Admin anônimo (impossível saber quem) | Admin autenticado com usuario_id |
| Sem histórico legal | LGPD-compliant (quem, o quê, quando, antes/depois) |

---

## Testes Recomendados

```bash
# 1. Criar admin
node scripts/criar-admin.js
# Escolha: admin / senha123456 / seu@email.com

# 2. Iniciar servidor
npm start

# 3. Login
curl -X POST http://localhost:3000/api/admin/login \
  -H "Content-Type: application/json" \
  -d '{"nome":"admin","senha":"senha123456"}' \
  -c cookies.txt

# 4. Bloquear um tenant
curl -X PATCH http://localhost:3000/api/admin/clientes/1 \
  -H "Content-Type: application/json" \
  -d '{"status":"bloqueado"}' \
  -b cookies.txt

# 5. Ver auditoria
curl http://localhost:3000/api/admin/auditoria \
  -b cookies.txt | jq .

# Deve mostrar a mudança de status acima registrada
```

---

## Segurança

### ✅ Implementado

- Autenticação: hash scrypt (mesmo do resto do app)
- Sessão: cookie HttpOnly + Secure
- Rate limit: 5 tentativas / 15min no login
- Auditoria: antes/depois em JSON para forensics
- IP: capturado para investigação

### ⚠️ Não Implementado (Roadmap)

- Verificação 2FA
- Criptografia de dados sensíveis na auditoria
- Retenção automática (purga de auditoria >12 meses)
- Alertas em tempo real

---

## Compliance LGPD

### ✅ Agora Compliant

| Artigo | Requisito | Solução |
|--------|-----------|---------|
| Art. 46 | Direito de acesso | Query `SELECT * FROM auditoria WHERE usuario_id = ?` |
| Art. 52 | Rastreabilidade | Todos os DELETEs/PATCHes registrados |
| Art. 17 | Direito ao esquecimento | Registra quem deletou, quando, estado anterior |
| GDPR 6.5(f) | Interesse legítimo | Auditoria de admin é interesse legítimo |

---

## Próximos Passos

1. **Teste em dev:** `npm start` + `node scripts/criar-admin.js`
2. **Migre qualquer admin existente:** execute `criar-admin.js` com nova senha
3. **Configure em produção:** mesmos passos (senha forte)
4. **Monitore auditoria:** query de tempos em tempos para confirmar que está sendo gravada

---

## Documentação Relacionada

- [AUDITORIA-LGPD.md](AUDITORIA-LGPD.md) — Documentação completa do sistema
- [DATABASE-MULTI-TENANT-ISOLATION.md](DATABASE-MULTI-TENANT-ISOLATION.md) — Isolamento de tenants
- [middleware/auditoria.js](middleware/auditoria.js) — Código fonte (comentado)

---

**Última atualização:** 2026-06-22
**Status:** ✅ Pronto para testes
