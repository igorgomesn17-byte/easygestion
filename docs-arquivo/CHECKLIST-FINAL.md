# ✅ CHECKLIST FINAL — Caminho para 8/10 em 12 semanas

---

## 🎯 VISÃO GERAL

```
HOJE: 3.5/10 (ERP ótimo, SaaS ruim)
      ├─ Funciona para 1 loja
      ├─ Não funciona para múltiplas lojas
      └─ Sem estrutura de negócio

OBJETIVO: 8.0/10 (SaaS profissional)
      ├─ Múltiplas lojas isoladas
      ├─ Operação financeira completa
      ├─ Segurança + conformidade legal
      └─ Pronto para 100+ clientes
      
TEMPO: 12 semanas
CUSTO: ~$100/mês (infra + email)
```

---

## 📋 SPRINT 1: MVP SaaS (4 semanas) → Nota: 3.5→5.5

### Semana 1: Email + Banco de Dados

**Tarefas:**
- [ ] Abrir conta SendGrid + gerar API key
- [ ] Adicionar coluna `email` em usuarios
- [ ] Criar tabela `tokens_verificacao`
- [ ] Criar `lib/email.js` com templates
- [ ] Atualizar `.env.example` com variáveis
- [ ] Commit + testes locais

**Tempo estimado:** 2-3 dias  
**Verificação:** `Consegue enviar email via SendGrid`

---

### Semana 2: Recuperação de Senha

**Tarefas:**
- [ ] Rota `POST /api/auth/forgot-password`
- [ ] Rota `POST /api/auth/reset-senha`
- [ ] Criar `public/esqueci-senha.html`
- [ ] Criar `public/reset-senha.html`
- [ ] Atualizar login.html com link
- [ ] Testar fluxo completo
- [ ] Commit

**Tempo estimado:** 2-3 dias  
**Verificação:** `Admin esquece senha, consegue recuperar`

---

### Semana 3: Self-service + LGPD

**Tarefas:**
- [ ] Rota `PATCH /api/me/senha` (usuario altera própria)
- [ ] Rota `GET /api/me/dados` (exportar JSON)
- [ ] Rota `DELETE /api/me/conta` (soft delete)
- [ ] Criar `public/minha-conta.html`
- [ ] Criar `public/termos.html`
- [ ] Criar `public/privacidade.html`
- [ ] Checkbox "Aceito termos" no login
- [ ] Testar tudo
- [ ] Commit

**Tempo estimado:** 3-4 dias  
**Verificação:** `Usuário consegue alterar senha, exportar dados, deletar conta`

---

### Semana 4: Multi-tenant + Deploy

**Tarefas (Maiores):**
- [ ] Criar tabela `tenants`
- [ ] Adicionar `tenant_id` a: usuarios, produtos, vendas, clientes, config, variacoes, caixa_dia, caixa_movimentos, despesas, trocas, permutas, estoque, encomendas, nfce
- [ ] Criar índices em `(tenant_id, coluna)`
- [ ] Criar middleware `exigirTenant`
- [ ] Refatorar 50+ queries (adicionar WHERE tenant_id)
- [ ] Testar isolamento: User A ≠ User B
- [ ] Testar backups isolados
- [ ] Documentar como adicionar tenant_id em nova tabela

**Tarefas (Deploy):**
- [ ] Configurar HTTPS (Let's Encrypt + CloudFlare)
- [ ] Desativar login-sem-senha em produção
- [ ] Configurar backup S3 automático (diário)
- [ ] Configurar SESSION_SECRET forte
- [ ] Teste de carga (2-3 clientes simultâneos)
- [ ] Logs estruturados (timestamp, level, message)
- [ ] Deploy em staging

**Tempo estimado:** 5-7 dias  
**Verificação:** `Multi-tenant funcional + backup automático`

---

## ✅ SPRINT 1 CHECKLIST (Não lança sem isto)

```
ANTES DE LANÇAR:
├─ [ ] Email de usuário adicionado
├─ [ ] Recuperação de senha funcionando
├─ [ ] Termos + Privacidade online
├─ [ ] Multi-tenant implementado
│   ├─ [ ] tenant_id em 15+ tabelas
│   ├─ [ ] Índices criados
│   ├─ [ ] Middleware implementado
│   └─ [ ] Queries refatoradas (WHERE tenant_id)
├─ [ ] Testes de isolamento
│   ├─ [ ] User A não vê produtos de User B
│   ├─ [ ] User A não vê vendas de User B
│   ├─ [ ] User A não vê clientes de User B
│   └─ [ ] User A não vê financeiro de User B
├─ [ ] Backup automático (S3)
├─ [ ] HTTPS obrigatório
├─ [ ] CSRF protection
├─ [ ] Rate limit testado
├─ [ ] SESSION_SECRET forte
├─ [ ] Logs estruturados
├─ [ ] Staging testado
└─ [ ] 2-3 clientes piloto testando
```

---

## 📊 SPRINT 2: Segurança Profissional (2 semanas) → 5.5→6.5

**Tarefas:**
- [ ] Email verification (2-step)
- [ ] Convites por email com token
- [ ] 2FA (Google Authenticator)
- [ ] Auditoria de acessos (audit_logs)
- [ ] Sentry integrado (error tracking)
- [ ] Documentação de API
- [ ] Testes automatizados

**Tempo:** 5 dias  
**Status:** 📋 Planejado

---

## 💼 SPRINT 3: Backoffice (3 semanas) → 6.5→7.5

**Tarefas:**
- [ ] Tela `/admin/clientes`
  - [ ] Lista com filtros (ativo, suspenso, teste, cancelado)
  - [ ] Busca por nome, CNPJ, email
  - [ ] Ações: editar, bloquear, impersonar, deletar
- [ ] Tela `/admin/financeiro`
  - [ ] Dashboard MRR/ARR/Churn
  - [ ] Listar cobranças
  - [ ] Status de pagamento
  - [ ] Refundos
- [ ] Tabelas: tenants, assinaturas, cobranças

**Tempo:** 7 dias  
**Status:** 📋 Planejado

---

## 💳 SPRINT 4: Cobranças (2 semanas) → 7.5→8.0

**Tarefas:**
- [ ] Integração gateway (Stripe, PagSeguro ou PayPal)
- [ ] Gerar boletos automáticos
- [ ] PIX recorrente
- [ ] Webhooks de confirmação
- [ ] Avisos de pagamento pendente
- [ ] Suspensão automática (3 dias vencido)
- [ ] Reativação após pagamento

**Tempo:** 5 dias  
**Custo:** 2-3% por transação  
**Status:** 📋 Planejado

---

## 🗄️ SPRINT 5: PostgreSQL (2 semanas) → 8.0→8.2

**Tarefas:**
- [ ] Migração do SQLite para PostgreSQL
- [ ] Índices otimizados
- [ ] Cache Redis (opcional)
- [ ] Teste de carga (50+ clientes simultâneos)
- [ ] Monitoramento (DataDog/New Relic)

**Tempo:** 5-7 dias  
**Quando:** Após 10-15 clientes  
**Status:** 📋 Planejado

---

## 🚀 ROADMAP RESUMIDO

```
AGORA (Semana 1-4)
  Sprint 1: MVP SaaS
  └─ Email, Recovery, Multi-tenant, LGPD, Backup
  └─ Nota: 3.5 → 5.5 ✅ PRONTO PARA LANÇAR

CURTO (Semana 5-9)
  Sprint 2: Segurança
  └─ 2FA, Auditoria, Sentry, Email verification
  └─ Nota: 5.5 → 6.5
  
  Sprint 3: Backoffice
  └─ Gestão clientes, Financeiro, Métricas
  └─ Nota: 6.5 → 7.5 ✅ OPERAÇÃO PROFISSIONAL

MÉDIO (Semana 10-13)
  Sprint 4-5: Escalabilidade
  └─ Cobranças automáticas, PostgreSQL, Cache
  └─ Nota: 7.5 → 8.0+ ✅ PRONTO PARA 100+ CLIENTES

LONGO (Meses 4-6+)
  v1.1: SSO, SAML, Permissões granulares
  v1.2: Integrações B2B (Omie, CTe, etc)
  v2.0: Multivendedor, Marketplace
```

---

## 💰 INVESTIMENTO TOTAL

| Item | Custo | Quando | Total |
|------|-------|--------|-------|
| SendGrid (email) | $15/mês | Agora | $180/ano |
| PostgreSQL | $25/mês | Semana 10 | $300/ano |
| Redis (cache) | $10/mês | Semana 10 | $120/ano |
| Stripe (gateway) | 2.9% + $0.30 | Semana 8 | Variável |
| Sentry (monitoring) | $29/mês | Semana 5 | $348/ano |
| **Total mínimo** | **$79/mês** | **Sprint 1** | **$948/ano** |

---

## 🎯 MILESTONES

```
18/06 (HOJE)
  └─ Ler auditoria + decidir

25/06 (SPRINT 1, semana 1)
  └─ Email + Banco de dados

02/07 (SPRINT 1, semana 2)
  └─ Recuperação de senha

09/07 (SPRINT 1, semana 3)
  └─ Self-service + LGPD

16/07 (SPRINT 1, semana 4)
  └─ Multi-tenant pronto

23/07 (TESTES)
  └─ 2-3 clientes piloto

25/07 🚀 LAUNCH v1.0
  └─ Primeiros clientes pagos

AGOSTO
  └─ Sprint 2 (Segurança)

SETEMBRO
  └─ Sprint 3 (Backoffice)

OUTUBRO
  └─ Sprint 4 (Cobranças)

NOVEMBRO
  └─ Sprint 5 (PostgreSQL)

DEZEMBRO
  └─ v1.0 em 8/10 ✅
```

---

## 🚨 BLOCKERS & RISCOS

| Risco | Probabilidade | Impacto | Mitigação |
|-------|---------------|--------|-----------|
| Multi-tenant mal implementado | 30% | 🔴 CRÍTICO | Testes rigorosos |
| Perda de dados em backup | 5% | 🔴 CRÍTICO | Teste restore semanal |
| Email não entrega (spam) | 10% | 🟡 IMPORTANTE | Configurar SPF/DKIM |
| Performance PostgreSQL | 20% | 🟡 IMPORTANTE | Índices bem feitos |
| Pagamento gateway fora do ar | 5% | 🟡 IMPORTANTE | Fallback manual |

---

## ✨ SUCESSO LOOKS LIKE

### Semana 1
```
✅ Email being sent
✅ Recovery password working
✅ .env configured
✅ Logs showing SendGrid integration
```

### Semana 2
```
✅ Forgot password email received
✅ Reset link works
✅ Password changed successfully
✅ Can log in with new password
```

### Semana 3
```
✅ Termos.html online
✅ Privacidade.html online
✅ Checkbox on login
✅ User can change own password
✅ User can export data (JSON)
✅ User can delete account
```

### Semana 4
```
✅ 2 clientes criados no BD
✅ Tenant 1 só vê seus produtos
✅ Tenant 2 só vê seus produtos
✅ Backup S3 automático funcionando
✅ Restore testado com sucesso
✅ HTTPS working
✅ Rate limit testado
```

### Launch Day
```
✅ Multi-tenant isolado
✅ Email funcionando
✅ LGPD completo
✅ Backup automático
✅ 3 clientes piloto usando
✅ Sem erros em Sentry
✅ Performance <200ms p/ página
✅ 99.9% uptime
```

---

## 📞 SUPORTE DURANTE SPRINTS

**Se tiver dúvida durante implementação:**
1. Leia `PLANO-MVP-SAAS.md` (código pronto)
2. Procure a seção "Semana X"
3. Copie/adapte o código

**Se tiver problema:**
1. Verifique `.env` (variáveis configuradas?)
2. Verifique logs (erro em console?)
3. Verifique testes (não está isolado?)

---

## 🏁 CONCLUSÃO

**Você tem 4 semanas pra chegar em 5.5/10 (pronto pra lançar).**

**Depois, 8 semanas mais pra chegar em 8/10 (profissional).**

**Você consegue. Só comece.**

