# DIAGRAMA GANTT — Plano MVP SaaS Sequencial
## Timeline Visual de Execução

> **Formato:** Diagrama em texto (ASCII) + tabela com datas  
> **Período:** 18/06 — 25/07/2026 (38 dias)  
> **Método:** Sequencial (cada task depende da anterior)

---

# 📅 DIAGRAMA GANTT (Texto)

```
TAREFA                              SEMANA 1  SEMANA 2  SEMANA 3  SEMANA 4  SEMANA 5  SEMANA 6
                                    18-24     25-01     02-08     09-15     16-22     23-25

1.1 Conta SendGrid                  ████
1.2 .env.example                    ████
1.3 npm install                     ████
2.1 Tabela tenants                  ███████
2.2 Assinatura/Cobranças            ███████
2.3 Adicionar tenant_id             ███████
3.1 lib/email.js                    ████████

4.1 Tokens table                     ████████
4.2 POST forgot-password            ████████████
4.3 POST reset-senha                ████████████
4.4 Telas esqueci/reset             ████████████

5.1 Termos.html                              ████████
5.2 Privacidade.html                        ████████
5.3 Checkbox login                          ████

6.1 PATCH /me/senha                         ████████
6.2 GET /me/dados                           ████████
6.3 DELETE /me/conta                        ████████
6.4 Tela minha-conta                        ████████████

7.1 Middleware tenant                              ████
7.2 Adicionar ao server                           ████
7.3 Refatorar ~50 queries                         ████████████████
7.4 Testes isolamento                            ████████████

8.1 Backup S3                                           ████
8.2 Scheduler cron                                      ████
8.3 Teste restore                                       ████

9.1 Testes locais                                              ████
9.2 HTTPS produção                                            ████
9.3 Deploy staging                                            ████
9.4 Deploy produção                                           ████
9.5 Convidar piloto                                           ████
9.6 Sentry/monitor                                            ████

10.1 Validação final                                                 ████████


LEGENDA:
████ = 1 hora
████████ = 2 horas
████████████ = 3 horas
████████████████ = 4+ horas
```

---

# 📊 TABELA DETALHADA COM DATAS

| # | Tarefa | Início | Fim | Duração | Status | Bloqueador? |
|---|--------|--------|-----|---------|--------|-------------|
| 1.1 | Conta SendGrid | 18/06 | 18/06 | 15 min | ⏳ | ✅ Sim |
| 1.2 | .env.example | 18/06 | 18/06 | 15 min | ⏳ | ❌ Não |
| 1.3 | npm install | 18/06 | 18/06 | 10 min | ⏳ | ❌ Não |
| 2.1 | Tabela tenants | 18/06 | 19/06 | 30 min | ⏳ | ✅ Sim |
| 2.2 | Assinatura/Cobranças | 19/06 | 19/06 | 30 min | ⏳ | ❌ Não |
| 2.3 | Adicionar tenant_id | 19/06 | 19/06 | 30 min | ⏳ | ✅ Sim |
| 3.1 | lib/email.js | 19/06 | 19/06 | 30 min | ⏳ | ✅ Sim |
| 4.1 | Tokens table | 20/06 | 20/06 | 30 min | ⏳ | ❌ Não |
| 4.2 | POST forgot-password | 20/06 | 21/06 | 2h | ⏳ | ✅ Sim |
| 4.3 | POST reset-senha | 21/06 | 21/06 | 2h | ⏳ | ✅ Sim |
| 4.4 | Telas esqueci/reset | 21/06 | 22/06 | 2h | ⏳ | ✅ Sim |
| 5.1 | Termos.html | 25/06 | 25/06 | 1h | ⏳ | ❌ Não |
| 5.2 | Privacidade.html | 25/06 | 25/06 | 1h | ⏳ | ❌ Não |
| 5.3 | Checkbox login | 25/06 | 25/06 | 30 min | ⏳ | ❌ Não |
| 6.1 | PATCH /me/senha | 25/06 | 26/06 | 1h | ⏳ | ❌ Não |
| 6.2 | GET /me/dados | 26/06 | 26/06 | 1h | ⏳ | ❌ Não |
| 6.3 | DELETE /me/conta | 26/06 | 27/06 | 1h | ⏳ | ❌ Não |
| 6.4 | Tela minha-conta | 27/06 | 28/06 | 2h | ⏳ | ❌ Não |
| 7.1 | Middleware tenant | 02/07 | 02/07 | 30 min | ⏳ | ✅ Sim |
| 7.2 | Adicionar ao server | 02/07 | 02/07 | 15 min | ⏳ | ❌ Não |
| 7.3 | Refatorar ~50 queries | 02/07 | 05/07 | 8h | ⏳ | ✅ Sim |
| 7.4 | Testes isolamento | 05/07 | 07/07 | 3h | ⏳ | ✅ Sim |
| 8.1 | Backup S3 | 09/07 | 09/07 | 1h | ⏳ | ❌ Não |
| 8.2 | Scheduler cron | 09/07 | 09/07 | 30 min | ⏳ | ❌ Não |
| 8.3 | Teste restore | 09/07 | 09/07 | 30 min | ⏳ | ❌ Não |
| 9.1 | Testes locais | 10/07 | 11/07 | 2h | ⏳ | ✅ Sim |
| 9.2 | HTTPS produção | 11/07 | 11/07 | 1h | ⏳ | ✅ Sim |
| 9.3 | Deploy staging | 11/07 | 12/07 | 1h | ⏳ | ✅ Sim |
| 9.4 | Deploy produção | 12/07 | 12/07 | 30 min | ⏳ | ✅ Sim |
| 9.5 | Convidar piloto | 12/07 | 12/07 | 30 min | ⏳ | ❌ Não |
| 9.6 | Sentry/monitor | 12/07 | 13/07 | 1h | ⏳ | ❌ Não |
| 10.1 | Validação final | 15/07 | 18/07 | 2-3h | ⏳ | ✅ Sim |

---

# 🎯 MARCOS IMPORTANTES (Milestones)

```
18/06 ─────────── KICKOFF
  └─ SendGrid + banco de dados pronto

22/06 ─────────── EMAIL FUNCIONAL
  └─ Recuperação de senha testada

25/06 ─────────── LGPD + SELF-SERVICE
  └─ Termos, privacidade, alterar senha pronto

02/07 ─────────── MULTI-TENANT INICIADO
  └─ Middleware + primeiras queries refatoradas

07/07 ─────────── MULTI-TENANT COMPLETO
  └─ Todas as 50+ queries refatoradas + testes passando

09/07 ─────────── BACKUP OK
  └─ S3 backup e restore validados

12/07 ─────────── EM PRODUÇÃO
  └─ Deploy OK + clientes piloto convidados

18/07 ─────────── VALIDAÇÃO COMPLETA
  └─ Sem erros críticos, nota 5.5/10

25/07 ─────────── LANÇAMENTO OFICIAL v1.0
  └─ 🚀 LIVE
```

---

# 📈 PROGRESSO SEMANAL

## SEMANA 1 (18-24/06) — Banco de Dados + Email Base
```
QUA 18: ████████████████████ (4h)
  └─ SendGrid, .env, npm install, tabelas

QUI 19: ████████████████████ (3h)
  └─ tenant_id, lib/email

SEX 20: ████████████████████ (2h)
  └─ Tokens, POST forgot-password

SAB 21: ████████████████████ (2h)
  └─ POST reset-senha, telas

DOM 22: ████████ (1h)
  └─ Review + commit

SEGUNDA 25: ████████ (1h)
  └─ Testes + merge

PROGRESSO: ▓▓▓▓▓▓▓▓▓█ 80%
NOTA SaaS: 3.5→4.0/10
```

## SEMANA 2 (25/06-01/07) — LGPD + Self-Service
```
QUA 25: ████████████████████ (3h)
  └─ Termos, privacidade, checkbox

QUI 26: ████████████████████ (2h)
  └─ PATCH /me/senha, GET /me/dados

SEX 27: ████████████ (2h)
  └─ DELETE /me/conta, tela

SAB 28: ████████ (1h)
  └─ Review

DOMINGO: ██ (Descanso)

SEGUNDA 02: ████████ (1h)
  └─ Testes

PROGRESSO: ▓▓▓▓▓▓▓▓██ 85%
NOTA SaaS: 4.0→4.5/10
```

## SEMANA 3 (02-08/07) — Multi-Tenant (CRÍTICO***REMOVED***)
```
QUA 02: ████████████████████ (2h)
  └─ Middleware, adicionar ao server

QUI 03: ████████████████████████ (4h)
  └─ Começar refatoração de queries

SEX 04: ████████████████████████ (4h)
  └─ Continuar refatoração

SAB 05: ████████████████████ (4h)
  └─ Terminar refatoração, testes

DOM 06: ████████ (1h)
  └─ Testes isolamento

SEGUNDA 09: ████████ (2h)
  └─ Testes finais

PROGRESSO: ▓▓▓▓▓▓▓▓▓▓ 100% (queries refatoradas)
NOTA SaaS: 4.5→5.5/10 ✅ PRONTO PARA LANÇAR
```

## SEMANA 4 (09-15/07) — Deploy + Validação
```
QUA 09: ████████ (2h)
  └─ Backup S3 + scheduler

QUI 10: ████████████████████ (2h)
  └─ Testes locais

SEX 11: ████████████████ (2h)
  └─ HTTPS + staging

SAB 12: ████████ (2h)
  └─ Deploy produção + piloto

DOM 13: ████ (1h)
  └─ Sentry + monitor

SEGUNDA 16-FRI 20: ████████████████████ (2-3h)
  └─ Validação, ajustes, feedback

PROGRESSO: ▓▓▓▓▓▓▓▓▓▓ 100% MVP
NOTA SaaS: 5.5/10 ✅ LANÇADO
```

---

# ⏱️ HORAS POR SEMANA

```
Semana 1 (18-24):  13 horas
Semana 2 (25-01):  11 horas
Semana 3 (02-08):  20 horas ← Mais pesada (refatoração)
Semana 4 (09-15):  10 horas
Semana 5 (16-22):  5 horas (validação + ajustes)
Semana 6 (23-25):  (descanso pré-launch)

TOTAL: 59 horas (~7-8 dias full-time)
       ou ~3-4 semanas part-time (5h/dia)
```

---

# 🎯 CRÍTICO vs NICE-TO-HAVE

```
████████████ CRÍTICO (bloqueia lançamento)
├─ SendGrid + Email
├─ Recuperação de senha
├─ Multi-tenant + isolamento
├─ LGPD + Termos
├─ Backup S3
└─ Deploy + HTTPS

████████ IMPORTANTE (muito bom ter)
├─ Self-service (alterar senha)
├─ Testes isolamento
├─ Sentry/monitoramento
└─ Tela minha-conta

████ NICE-TO-HAVE (v1.1)
├─ Email verification
├─ 2FA
├─ Permissões granulares
└─ Integrações
```

---

# 📊 DEPENDÊNCIAS ENTRE TAREFAS

```
SendGrid (1.1)
    ↓
Email lib (3.1)
    ↓
Forgot-password (4.2) ──┐
Reset-senha (4.3) ──────┼──→ RECUPERAÇÃO OK
Telas (4.4) ────────────┘
    ↓
Termos (5.1)
    ↓
LGPD COMPLETA (5.1 + 5.2 + 5.3)
    ↓
Tenants table (2.1)
    ↓
Tenant_id (2.3) ───┐
Middleware (7.1) ──┼──→ MULTI-TENANT BASE
Refatorar (7.3) ───┤
Testes (7.4) ──────┘
    ↓
PRONTO PARA LANÇAR (5.5/10)
    ↓
Backup S3 (8.1)
    ↓
HTTPS + Deploy (9.2 + 9.4)
    ↓
🚀 LIVE
```

---

# 🔄 PARALELOS (O Que Pode Rodar Junto)

```
SEMANA 1:
┌─ 1.1 SendGrid ──────────────────┐
├─ 1.2 .env.example               │ Podem rodar em paralelo
├─ 1.3 npm install                │ (nenhuma dependência)
├─ 2.1 Tabela tenants ────────────┼─ Depende de npm install
├─ 2.2 Assinaturas/Cobranças      │ (banco de dados)
├─ 2.3 Tenant_id ─────────────────┤
└─ 3.1 lib/email.js ──────────────┘ Depende de npm install

SEMANA 3:
┌─ 7.3 Refatorar queries ─────────┐
└─ 7.4 Testes isolamento ──────────┘ Podem rodar em paralelo

SEMANA 4:
┌─ 8.1 Backup S3
├─ 8.2 Scheduler
├─ 8.3 Teste restore ──────────────┐ Podem rodar em paralelo
├─ 9.1 Testes locais               │
├─ 9.2 HTTPS
└─ 9.5 Convidar piloto ────────────┘
```

---

# 📱 RECOMENDAÇÃO DE RITMO

```
OPÇÃO 1: FULL-TIME (Ideal)
├─ 8h/dia × 7 dias/semana
├─ 4 semanas = DONE
└─ Ideal se você consegue se dedicar

OPÇÃO 2: PART-TIME (Realista)
├─ 5h/dia × 5 dias/semana
├─ 6 semanas = DONE
└─ Realista se tem outros compromissos

OPÇÃO 3: MUITO PART-TIME
├─ 3h/dia × 4 dias/semana
├─ 8-9 semanas = DONE
└─ Se precisa balancear com outras coisas

RECOMENDAÇÃO: OPÇÃO 2 (5h/dia)
└─ Você consegue, não fica exaustivo, chega em 25/07
```

---

# ✅ CHECKLIST POR SEMANA

## Semana 1 (18-24/06)
- [ ] SendGrid account criada
- [ ] .env atualizado
- [ ] npm install feito
- [ ] Tabelas criadas (tenants, assinaturas, cobranças)
- [ ] tenant_id adicionado a 15+ tabelas
- [ ] lib/email.js pronto
- [ ] POST forgot-password funcionando
- [ ] POST reset-senha funcionando
- [ ] Telas esqueci/reset criadas

**Meta:** Email recovery funcional

## Semana 2 (25-01/07)
- [ ] Termos.html criado
- [ ] Privacidade.html criado
- [ ] Checkbox no login funcionando
- [ ] PATCH /me/senha funcionando
- [ ] GET /me/dados funcionando
- [ ] DELETE /me/conta funcionando
- [ ] Tela minha-conta funcionando
- [ ] LGPD completa

**Meta:** Self-service + LGPD

## Semana 3 (02-08/07)
- [ ] Middleware de tenant criado
- [ ] Middleware adicionado ao server
- [ ] ~50 queries refatoradas com WHERE tenant_id
- [ ] Testes de isolamento criados e passando
- [ ] User A não consegue ver dados de User B
- [ ] Multi-tenant completamente funcional

**Meta:** Isolamento de dados ✅

## Semana 4 (09-15/07)
- [ ] Backup S3 configurado
- [ ] Scheduler de backup criado
- [ ] Teste de restore validado
- [ ] Testes locais passando
- [ ] HTTPS configurado
- [ ] Deploy em staging OK
- [ ] Deploy em produção OK
- [ ] Clientes piloto convidados
- [ ] Sentry configurado

**Meta:** Em produção, pronto para lançar ✅

## Semana 5 (16-22/07)
- [ ] Validação com clientes piloto
- [ ] Feedback coletado
- [ ] Bugs críticos fixados
- [ ] Documentação atualizada
- [ ] Sem erros em console/logs

**Meta:** Estável e pronto

---

# 🎬 ACTION ITEMS IMEDIATOS (Hoje***REMOVED***)

```
HOJE (18/06):
1. [ ] Ler este plano (30 min)
2. [ ] Abrir conta SendGrid (15 min)
3. [ ] Atualizar .env.example (15 min)
4. [ ] npm install (10 min)
5. [ ] Começar tarefa 2.1 (tabela tenants)

PRIMEIRA TAREFA CONCRETA:
→ Ir para PLANO-SEQUENCIAL-MVP.md, tarefa 2.1
→ Adicionar tabela tenants ao db/schema.sql
→ Testar: node -e "const db = require('./db/database'); console.log('OK')"
→ Commit

TIMING: ~45 minutos até estar pronto para começar a codificar
```

---

**Você tem o mapa. Está na hora de começar.**

**Primeira parada: 2.1 — Tabela Tenants**

