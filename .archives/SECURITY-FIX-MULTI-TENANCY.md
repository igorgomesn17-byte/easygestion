# 🔴 CORREÇÃO CRÍTICA: Vulnerabilidade de Multi-Tenancy

**Data:** 2026-06-22  
**Severidade:** 🔴 CRÍTICA  
**Status:** ✅ CORRIGIDO

---

## Problema

O sistema tinha **157 ocorrências** de fallback perigoso em queries multi-tenant:

```javascript
// ❌ ANTES (VULNERÁVEL)
const cxHoje = db.prepare('SELECT ... WHERE tenant_id = ?')
  .get(hojeLocal(), req.tenantId || 1);  // Se undefined, usa tenant 1***REMOVED***
```

### Impacto

Se `req.tenantId` fosse undefined (por qualquer razão), a query silenciosamente operaria no **tenant 1** (admin):

1. **Vendedor poderia ver/editar dados de outros clientes** (cross-tenant leak)
2. **Relatórios mostram dados misturados** entre tenants
3. **Sem erro visível** — operação silenciosa no tenant errado
4. **Difícil de detectar em logs** — nenhum aviso

### Exemplo de Attack

```javascript
// Se vendor/user conseguisse fazer req.tenantId ser undefined:
// 1. Lista clientes:
//    SELECT * FROM clientes WHERE tenant_id = ?  (req.tenantId || 1)
//    → query usaria tenant 1, mostrando TODOS os clientes de admin
// 2. Registra venda:
//    INSERT INTO vendas VALUES (..., tenant_id = req.tenantId || 1)
//    → venda seria criada no tenant 1 (errado***REMOVED***)
```

---

## Solução Implementada

### 1. ✅ Removido fallback `|| 1` de todas as queries

```bash
# 157 ocorrências corrigidas
sed -i "s/req\.tenantId || 1/req.tenantId/g" routes/*.js
```

### 2. ✅ Adicionada validação explícita

**Antes:**
```javascript
const tenantId = req.tenantId || req.session.tenant_id || 1;
```

**Depois:**
```javascript
if (***REMOVED***req.tenantId) {
  return res.status(401).json({ erro: 'Tenant não identificado' });
}
```

### 3. ✅ Middleware global de garantia

Adicionado `garantirTenantId` no `middleware/seguranca.js`:

```javascript
function garantirTenantId(req, res, next) {
  const full = '/api' + req.path;
  // Rotas públicas não precisam de tenant
  if (ehPublica(full)) return next();
  // Rotas protegidas EXIGEM tenant
  if (***REMOVED***req.tenantId) {
    return res.status(401).json({ erro: 'Tenant não identificado' });
  }
  next();
}
```

Aplicado globalmente em `server.js`:
```javascript
app.use('/api', garantirTenantId);  // Executa ANTES de qualquer rota
```

### 4. ✅ Teste de segurança

Criado `tests/cross-tenant-validation.test.js` que valida:
- ❌ Código antigo retorna fallback (demonstração do perigo)
- ✅ Código novo lança erro (seguro)
- ✅ Nenhum padrão vulnerável em routes/
- ✅ Endpoints sem tenantId retornam 401

---

## Arquivos Modificados

```
middleware/seguranca.js          [+] validarTenantId(), garantirTenantId()
server.js                        [+] importa garantirTenantId
                                [+] app.use('/api', garantirTenantId)

routes/admin.js                  [157x] req.tenantId || 1 → req.tenantId
routes/auth.js                   [157x] (incluso alteração especial linha 290)
routes/caixa.js
routes/clientes.js
routes/config.js
routes/dashboard.js
routes/despesas.js
routes/estoque.js
routes/financeiro.js
routes/nfce.js
routes/produtos.js
routes/trocas.js
routes/usuarios.js
routes/vendas.js
routes/vendedores.js

tests/cross-tenant-validation.test.js  [+] novo
SECURITY-FIX-MULTI-TENANCY.md          [+] novo (este arquivo)
```

---

## Checklist de Validação

- [x] 157 ocorrências de `req.tenantId || 1` removidas
- [x] Sem fallbacks `|| req.session.tenant_id || 1` em rotas (apenas auth.js adaptado)
- [x] Middleware global validando tenantId
- [x] Função `validarTenantId()` exportada (para uso em helpers se necessário)
- [x] Teste de segurança criado
- [x] Zero padrões vulneráveis restantes (grep confirmou)

```bash
$ grep -r "req\.tenantId || " routes/
# Nenhum resultado (nada encontrado) ✓
```

---

## Comportamento Após Fix

### Cenário 1: Usuário logado normalmente
```
✅ injetarTenant injeta req.tenantId = 2
✅ garantirTenantId valida que 2 existe
✅ Query usa tenant 2
✅ Dados do tenant 2 retornados (correto)
```

### Cenário 2: req.tenantId undefined (falha do middleware)
```
❌ injetarTenant deveria ter injetado, mas falhou
❌ garantirTenantId retorna 401
❌ Rota não é alcançada
❌ SEGURO: sem leak de dados
```

### Cenário 3: Rotas públicas (sem login)
```
✅ injetarTenant não injeta (rotas públicas)
✅ garantirTenantId passa (verificação exclui públicas)
✅ Pode processar sem tenantId (expected)
```

---

## Testing / Replicação

Para testar a vulnerabilidade foi **CORRIGIDA**:

```bash
# 1. Verificar que não há fallback perigoso
grep -r "req\.tenantId || " routes/

# 2. Verificar que middleware está ativo
grep "garantirTenantId" server.js

# 3. Rodar teste de segurança
npm test -- cross-tenant-validation.test.js

# 4. Teste manual: chamada sem sessão válida
curl -X GET http://localhost:3000/api/vendas
# Deve retornar 401 "Não autenticado" (exigirLogin bloqueia primeiro)

# 5. Teste manual: mesmo logado, se tenantId faltar
# (praticamente impossível agora porque garantirTenantId bloqueia)
```

---

## Notas para Deploy

**CRÍTICO**: Este é um security fix que muda comportamento em edge cases.

### Impacto em produção: ZERO
- ✅ Usuários normais não são afetados
- ✅ Nenhuma mudança em fluxo de dados válidos
- ✅ Apenas bloqueia casos de falha (que deveriam estar bloqueados)

### Se algo quebrar
Se alguma rota retornar 401 "Tenant não identificado" após deploy:
1. Verificar se `injetarTenant` está sendo aplicado
2. Verificar se rota está protegida (exigirLogin está aplicado?)
3. Verificar se session.tenant_id existe para usuário

**Não reverta para `|| 1`** — é um buraco de segurança grave.

---

## Referência: Linha 35 de vendas.js (antes/depois)

**❌ ANTES (VULNERÁVEL):**
```javascript
const cxHoje = db.prepare('SELECT aberto, fechado FROM caixa_dia WHERE data = ? AND tenant_id = ?')
  .get(hojeLocal(), req.tenantId || 1);
```
👆 Se `req.tenantId` é undefined, usa tenant 1 silenciosamente***REMOVED***

**✅ DEPOIS (SEGURO):**
```javascript
const cxHoje = db.prepare('SELECT aberto, fechado FROM caixa_dia WHERE data = ? AND tenant_id = ?')
  .get(hojeLocal(), req.tenantId);
```
👆 Se `req.tenantId` é undefined, middleware já bloqueou antes de chegar aqui***REMOVED***

---

## Próximos Passos Recomendados

1. **Audit**: Revisar logs de produção por queries "estranhas" (usando tenant 1 quando deveriam usar outro)
2. **Database**: Verificar se há vendas/dados no tenant 1 que vieram de usuários com IDs diferentes
3. **Monitoring**: Adicionar alertas se `garantirTenantId` bloqueia muitas requisições (pode indicar outra falha no middleware)
4. **Documentation**: Adicionar comentário em `injetarTenant` e `garantirTenantId` explicando por que são críticos

---

**Desenvolvido por:** Claude Code  
**Validado por:** Cross-tenant security test  
**Status:** Ready for production
