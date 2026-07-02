# ANÁLISE ETAPAS 3-7: Backoffice, Multi-tenant, Segurança, Cadastro, Usuários & Roadmap
## EasyGestão como SaaS Proprietário (18/06/2026)

> Esta análise avalia a maturidade do sistema para operar como plataforma SaaS multi-cliente com backoffice de gerenciamento.

---

# 🚨 ETAPA 1: BACKOFFICE DO PROPRIETÁRIO (Não Existe)

## Status: ❌ INEXISTENTE

O EasyGestão **não tem absolutamente nenhum backoffice** para o proprietário da plataforma gerenciar seus clientes.

Se você (Igor) lançar isto como SaaS para 100 lojistas, você não terá forma de:

```
❌ Ver lista de clientes (quem se cadastrou)
❌ Bloquear/suspender/deletar cliente
❌ Ver saúde financeira (quem pagou, quem não pagou)
❌ Gerar faturas / cobrar
❌ Gerenciar planos e upgrades
❌ Impersonar cliente (suporte)
❌ Ver métricas agregadas (MRR, ARR, churn)
❌ Controlar quem tem acesso ao quê
```

### O que existe hoje:
```
✅ Dashboard do cliente (da loja) — vendas, estoque, caixa
✅ Config da loja — marca, taxas, dados cadastrais
✅ Gestão de usuários da loja (admin cria usuarios)
❌ Gestão de CLIENTES (múltiplas lojas) — NÃO EXISTE
❌ Gestão FINANCEIRA da plataforma — NÃO EXISTE
```

---

## 🎯 O QUE FALTA (Crítico para SaaS)

### A. GESTÃO DE CLIENTES (Tenants)

```
NECESSÁRIO:
├─ Tela: /admin/clientes
│  ├─ Lista de todas as lojas cadastradas
│  ├─ Filtros: ativo, suspenso, em teste, cancelado
│  ├─ Busca por: nome da loja, CNPJ, email
│  ├─ Coluna: status, data cadastro, plano, último acesso
│  └─ Ações: editar, bloquear, impersonar, deletar
│
├─ Status do cliente:
│  ├─ 🟢 ATIVO — Pagando, usando o sistema
│  ├─ 🟡 TESTE — Primeiros 14 dias, sem cobrar
│  ├─ 🔴 SUSPENSO — Pagamento atrasado, não acessa
│  ├─ ⛔ BLOQUEADO — Violação de TOS, admin bloqueou
│  └─ ✋ CANCELADO — Finalizou assinatura
│
├─ Dados mínimos por cliente:
│  ├─ Razão social / Nome fantasia
│  ├─ CNPJ
│  ├─ Email responsável
│  ├─ Telefone
│  ├─ Plano (básico, profissional, enterprise)
│  ├─ Data de cadastro
│  ├─ Data de início (trial ou pagante)
│  ├─ Último acesso
│  └─ Status
│
└─ Ações administrativas:
   ├─ Criar conta manualmente
   ├─ Editar dados do cliente
   ├─ Mudar plano (upgrade/downgrade)
   ├─ Bloquear acesso (suspenso por inadimplência)
   ├─ Liberar acesso (após pagamento)
   ├─ Deletar conta (com confirmação)
   └─ Impersonar (entrar como admin dele para suporte)
```

### B. GESTÃO FINANCEIRA

```
NECESSÁRIO:
├─ Assinaturas / Planos
│  ├─ Cada cliente tem: plano, data início, data renovação
│  ├─ Plano básico: R$99/mês (até 3 usuários)
│  ├─ Plano profissional: R$299/mês (até 10 usuários)
│  └─ Plano enterprise: Customizado
│
├─ Cobranças
│  ├─ Gerar boleto / PIX / cartão automático
│  ├─ Data de cobrança (todo dia 15, por exemplo)
│  ├─ Status: pendente, pago, vencido
│  └─ Histórico de tentativas
│
├─ Pagamentos
│  ├─ Confirmar recebimento
│  ├─ Registrar crédito na conta
│  ├─ Gerar nota fiscal
│  └─ Enviar recibo via email
│
├─ Inadimplência
│  ├─ Cliente X dias atrasado
│  ├─ Avisos automáticos (via email)
│  ├─ Suspensão automática após Y dias
│  └─ Reativação após pagamento
│
└─ Histórico financeiro
   ├─ Ver todas as cobranças de um cliente
   ├─ Ver todas as tentativas de pagamento
   ├─ Refundar parcialmente ou totalmente
   ├─ Ajustes manuais (crédito, desconto)
   └─ Relatório de receita
```

### C. MÉTRICAS & ANALYTICS

```
DASHBOARD OPERACIONAL:
├─ MRR (Monthly Recurring Revenue)
│  └─ Total de receita mensal previsível
│
├─ ARR (Annual Recurring Revenue)
│  └─ MRR × 12
│
├─ Churn
│  ├─ % de clientes que cancelaram no mês
│  └─ Motivos (caro, não usava, falta feature, etc)
│
├─ CAC (Customer Acquisition Cost)
│  └─ Custo para adquirir 1 novo cliente
│
├─ LTV (Lifetime Value)
│  └─ Quanto um cliente vai gastar em média
│
├─ Saúde geral
│  ├─ Total de clientes (ativo + teste)
│  ├─ Clientes novos no mês
│  ├─ Clientes em teste converteram?
│  ├─ Receita por plano
│  └─ Taxa de retenção
│
└─ Alertas
   ├─ Cliente X não acessa há 30 dias
   ├─ Pagamento de Y venceu
   ├─ Z solicitou cancelamento
   └─ Limite de W foi atingido
```

---

## 💾 BANCO DE DADOS FALTANTE

Você precisa de novas tabelas:

```sql
-- Tabela de tenants (clientes SaaS):
CREATE TABLE tenants (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  nome TEXT NOT NULL,
  cnpj TEXT UNIQUE,
  email TEXT NOT NULL UNIQUE,
  telefone TEXT,
  plano TEXT DEFAULT 'basico',  -- basico, profissional, enterprise
  status TEXT DEFAULT 'teste',   -- teste, ativo, suspenso, bloqueado, cancelado
  criado_em TEXT DEFAULT (datetime('now','localtime')),
  ativado_em TEXT,               -- quando começou a pagar
  cancelado_em TEXT,             -- quando cancelou
  ultimo_acesso TEXT,
  observacoes TEXT
);

-- Tabela de assinaturas:
CREATE TABLE assinaturas (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  tenant_id INTEGER NOT NULL,
  plano TEXT NOT NULL,
  valor_mensal REAL NOT NULL,
  data_inicio TEXT NOT NULL,
  data_renovacao TEXT NOT NULL,
  cancelada_em TEXT,
  cancelado_por TEXT,
  motivo_cancelamento TEXT,
  FOREIGN KEY (tenant_id) REFERENCES tenants(id)
);

-- Tabela de cobranças:
CREATE TABLE cobranças (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  tenant_id INTEGER NOT NULL,
  assinatura_id INTEGER,
  data_cobranca TEXT NOT NULL,
  valor REAL NOT NULL,
  status TEXT DEFAULT 'pendente',  -- pendente, pago, vencido
  metodo_pagamento TEXT,            -- boleto, pix, cartao
  referencia TEXT,                  -- ID da cobrança em sistema externo
  data_pagamento TEXT,
  FOREIGN KEY (tenant_id) REFERENCES tenants(id)
);

-- Tabela de logs de acesso:
CREATE TABLE tenant_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  tenant_id INTEGER NOT NULL,
  usuario_id INTEGER,
  acao TEXT,
  criado_em TEXT DEFAULT (datetime('now','localtime')),
  ip TEXT,
  FOREIGN KEY (tenant_id) REFERENCES tenants(id)
);
```

---

# 📊 ETAPA 2: MULTI-TENANT — ANÁLISE PROFUNDA

## Status: ❌ NÃO IMPLEMENTADO (CRÍTICO)

### Situação Atual
```
HOJE:
├─ 1 banco SQLite (dsstore.db)
├─ 1 único usuário/admin por instalação
├─ Todos os dados misturados
└─ Não há isolamento entre clientes

RISCO:
├─ Query sem WHERE tenant_id = pega TUDO
├─ Um cliente consegue ver dados de outro
├─ Backup de um cliente = backup de todos
└─ Impossível operar >1 cliente no mesmo servidor
```

### Arquitetura Necessária

```
ANTES (Hoje - Monolítico):
┌─────────────────────────────────────┐
│         dsstore.db (SQLite)         │
├─────────────────────────────────────┤
│ usuarios (admin, vendedor, ...)      │
│ produtos (V001, V002, V003)          │ ← Sem tenant_id
│ vendas (500 vendas misturadas)       │
│ clientes (1000 clientes misturados)  │
│ config (1 único config global)       │
└─────────────────────────────────────┘

DEPOIS (Multi-tenant - Isolado):
┌─────────────────────────────────────┐
│         dsstore.db (SQLite)         │
├─────────────────────────────────────┤
│ tenants (tenants table)              │ ← NOVO
│ ├─ ID=1: Maria Loja                 │
│ ├─ ID=2: João Modas                 │
│ └─ ID=3: Carla Fashion              │
│                                      │
│ usuarios (tenant_id)                │ ← COM tenant_id
│ ├─ ID=1, tenant_id=1 (Maria)       │
│ ├─ ID=2, tenant_id=1 (Maria)       │
│ ├─ ID=3, tenant_id=2 (João)        │
│ └─ ...                              │
│                                      │
│ produtos (tenant_id)                │ ← COM tenant_id
│ ├─ V001, tenant_id=1 (Maria)       │
│ ├─ V001, tenant_id=2 (João - diff) │
│ └─ ...                              │
│                                      │
│ vendas (tenant_id)                  │ ← COM tenant_id
│ ├─ venda#1, tenant_id=1             │
│ ├─ venda#2, tenant_id=2             │
│ └─ ...                              │
│                                      │
│ config (tenant_id)                  │ ← COM tenant_id
│ ├─ loja_nome, tenant_id=1           │
│ ├─ loja_nome, tenant_id=2           │
│ └─ ...                              │
└─────────────────────────────────────┘
```

### Tabelas que Precisam de tenant_id

```
CRÍTICO (TODOS os dados):
├─ usuarios .......................... tenant_id
├─ produtos .......................... tenant_id
├─ variacoes ......................... tenant_id
├─ vendas ............................ tenant_id
├─ venda_itens ....................... tenant_id
├─ venda_pagamentos .................. tenant_id
├─ clientes .......................... tenant_id
├─ vendedores ........................ tenant_id
├─ caixa_dia ......................... tenant_id
├─ caixa_movimentos .................. tenant_id
├─ estoque ........................... tenant_id
├─ permutas .......................... tenant_id
├─ trocas ............................ tenant_id
├─ despesas .......................... tenant_id
├─ encomendas ........................ tenant_id
├─ config ............................ tenant_id
└─ ... (qualquer dado da loja)
```

### Isolamento por Query

```javascript
// ANTES (perigoso):
const produtos = db.prepare('SELECT * FROM produtos').all();
// ↑ Retorna produtos de TODOS os clientes***REMOVED***

// DEPOIS (seguro):
const produtos = db.prepare(
  'SELECT * FROM produtos WHERE tenant_id = ?'
).all(req.session.tenant_id);
// ↑ Retorna APENAS produtos do cliente atual
```

### Middleware de Tenant

```javascript
// Novo middleware obrigatório:
function exigirTenant(req, res, next) {
  if (***REMOVED***req.session.tenant_id) {
    return res.status(403).json({ erro: 'Tenant não encontrado' });
  }
  // Validar que o tenant_id do usuário == tenant_id da rota
  next();
}

// Aplicar a TODAS as rotas protegidas:
app.use('/api', exigirTenant);
```

### Riscos Atuais

| Risco | Impacto | Probabilidade | Severidade |
|-------|---------|--------------|-----------|
| Query sem WHERE tenant_id | Vazamento de dados | ALTA | 🔴 CRÍTICO |
| Backup misturado | Perda de dados isolação | ALTA | 🔴 CRÍTICO |
| Backup/restore | Restaura todos os clientes juntos | 100% | 🔴 CRÍTICO |
| Permissões globais | Admin de um cliente vira admin de todos | MÉDIA | 🔴 CRÍTICO |
| Índices faltando | Performance degrada rápido | 100% | 🟡 IMPORTANTE |

### Checklist de Implementação

```
REFACTOR MULTI-TENANT:
├─ Adicionar tabela tenants
├─ Adicionar coluna tenant_id a 15+ tabelas
├─ Criar índices em (tenant_id, coluna)
├─ Middleware que valida tenant_id
├─ Refatorar 50+ queries (adicionar WHERE tenant_id)
├─ Testes: User A não vê dados de User B
├─ Testes: Backups isolados
├─ Documentação de como adicionar nova tabela
└─ Validação em deploy (nenhuma query sem tenant_id)

TEMPO ESTIMADO: 5-7 dias
```

---

# 🔐 ETAPA 3: SEGURANÇA (Auditoria Completa)

## Status: ⚠️ PARCIAL (Alguns itens implementados, muitos faltando)

### MATRIZ DE SEGURANÇA

| Item | Status | Crítico? | Risco | Ação |
|------|--------|---------|-------|------|
| **AUTENTICAÇÃO** |
| Login com senha | ✅ Implementado | ✅ Sim | Baixo | OK |
| Hashing (scrypt) | ✅ Implementado | ✅ Sim | Baixo | OK |
| Session httpOnly | ✅ Implementado | ✅ Sim | Baixo | OK |
| Proteção brute force | ✅ Rate limit (6/15min) | ✅ Sim | Baixo | OK |
| Recuperação de senha | ❌ Não existe | ✅ Sim | 🔴 CRÍTICO | Sprint 1 |
| Email verification | ❌ Não existe | ✅ Sim | 🔴 CRÍTICO | Sprint 1 |
| 2FA (TOTP) | ❌ Não existe | ⚠️ Médio | 🟡 IMPORTANTE | v1.1 |
| Login sem senha | ⚠️ Ativado dev | ✅ Sim | 🔴 CRÍTICO | Desativar prod |
| **SENHAS** |
| Comprimento mínimo | ✅ 6 caracteres | ❌ Fraco | 🟡 IMPORTANTE | Aumentar para 8 |
| Força da senha | ❌ Não valida | ✅ Sim | 🟡 IMPORTANTE | Sprint 1 |
| Histórico de senhas | ❌ Não existe | ⚠️ Médio | 🟠 OPCIONAL | v1.1 |
| Expiração | ❌ Não existe | ⚠️ Médio | 🟠 OPCIONAL | v2.0 |
| **CRIPTOGRAFIA** |
| HTTPS obrigatório | ⚠️ Condicional | ✅ Sim | 🔴 CRÍTICO | Sempre em produção |
| TLS 1.2+ | ✅ CloudFlare | ✅ Sim | Baixo | OK |
| Certificado A1 | ✅ Criptografado AES-256 | ✅ Sim | Baixo | OK |
| Dados em repouso | ⚠️ Só certificado | ✅ Sim | 🟡 IMPORTANTE | Criptografar BD |
| **SESSÕES** |
| Timeout | ✅ 12h | ✅ Sim | 🟡 IMPORTANTE | Reduzir para 2h |
| Cookie secure | ✅ Em produção | ✅ Sim | Baixo | OK |
| Cookie httpOnly | ✅ Sim | ✅ Sim | Baixo | OK |
| SameSite | ✅ lax | ✅ Sim | Baixo | OK |
| CSRF protection | ❌ Não tem | ✅ Sim | 🔴 CRÍTICO | Adicionar tokens |
| Revogação | ⚠️ Só logout | ✅ Sim | 🟡 IMPORTANTE | Blacklist de tokens |
| **TOKENS** |
| JWT | ❌ Não usa | ⚠️ Médio | 🟠 OPCIONAL | Recovery vai usar |
| Expiração | ❌ Não | ✅ Sim | 🔴 CRÍTICO | Recovery: 1h |
| Validação | ❌ Não | ✅ Sim | 🔴 CRÍTICO | Recovery vai ter |
| Revogação | ❌ Não | ✅ Sim | 🔴 CRÍTICO | DB de tokens |
| **CONTROLE DE ACESSO** |
| Roles (admin, vendedor) | ✅ Implementado | ✅ Sim | Baixo | OK |
| Middleware de papéis | ✅ exigirPapel | ✅ Sim | Baixo | OK |
| Multi-tenant isolamento | ❌ Não tem | ✅ Sim | 🔴 CRÍTICO | Sprint 1 |
| Permissões granulares | ⚠️ Básico (só roles) | ⚠️ Médio | 🟡 IMPORTANTE | v1.1 |
| API key para integração | ❌ Não tem | ⚠️ Médio | 🟠 OPCIONAL | v1.2 |
| **LOGS & AUDITORIA** |
| Login/logout logs | ✅ console.log | ⚠️ Temporário | 🟡 IMPORTANTE | Persistir em BD |
| Auditoria de ações | ❌ Não tem | ✅ Sim | 🟡 IMPORTANTE | Sprint 2 |
| Retenção de logs | ❌ Não tem | ✅ Sim | 🟡 IMPORTANTE | 90 dias mínimo |
| Alertas de segurança | ❌ Não tem | ✅ Sim | 🟡 IMPORTANTE | Sentry + email |
| **BACKUP & DESASTRE** |
| Backup automático | ❌ Só manual | ✅ Sim | 🔴 CRÍTICO | Diário (S3) |
| Teste de restore | ❌ Nunca testado | ✅ Sim | 🔴 CRÍTICO | Semanal |
| Replicação | ❌ Não tem | ✅ Sim | 🟡 IMPORTANTE | PostgreSQL |
| Versioning | ⚠️ WAL mode | ✅ Sim | 🟠 OPCIONAL | OK com SQLite |
| **LGPD / PRIVACIDADE** |
| Termos de uso | ❌ Não tem | ✅ Sim | 🔴 CRÍTICO | Sprint 1 |
| Privacidade | ❌ Não tem | ✅ Sim | 🔴 CRÍTICO | Sprint 1 |
| Consentimento | ❌ Sem checkbox | ✅ Sim | 🔴 CRÍTICO | Sprint 1 |
| Direito acesso | ⚠️ Só admin | ✅ Sim | 🔴 CRÍTICO | Sprint 1 (export) |
| Direito esquecimento | ❌ Não tem | ✅ Sim | 🔴 CRÍTICO | Sprint 1 (delete) |
| Portabilidade | ❌ Não tem | ✅ Sim | 🔴 CRÍTICO | Sprint 1 (JSON) |
| Política de retenção | ❌ Não tem | ✅ Sim | 🟡 IMPORTANTE | Sprint 2 |
| **OUTRAS** |
| CSP (Content Security) | ✅ Helmet.js | ✅ Sim | Baixo | ⚠️ Muito permissivo |
| CORS | ⚠️ Reflexivo dev | ✅ Sim | 🔴 CRÍTICO | Whitelist produção |
| Validação de input | ⚠️ Básico | ✅ Sim | 🟡 IMPORTANTE | Reforçar |
| SQL injection | ✅ Prepared stmt | ✅ Sim | Baixo | OK |
| XSS | ⚠️ unsafe-inline | ✅ Sim | 🟡 IMPORTANTE | Refatorar scripts |
| DDOS | ✅ Rate limit | ✅ Sim | Baixo | OK |

### Problemas Críticos Resumidos

```
CRÍTICO (Não pode produção):
1. Sem multi-tenant isolamento → um cliente vê outro
2. Sem LGPD → multa até 2% faturamento
3. Sem recuperação de senha → cliente travado
4. Sem termos/privacidade → violação legal
5. Login sem senha ativado → qualquer um entra
6. HTTPS não obrigatório → sessão em plain text
7. Sem backup automático → perda de dados

IMPORTANTE (Sprint 1-2):
1. Email verification
2. 2FA (TOTP)
3. Validação de força de senha
4. CSRF protection
5. Auditoria de acessos
6. Timeout reduzido (12h → 2h)

FUTURO (v2.0+):
1. API key para integrações
2. Permissões granulares (além de roles)
3. Criptografia de dados em repouso
4. Sincronização de 2FA com Authenticator
```

---

# 📋 ETAPA 4: CADASTRO DE CLIENTES — Campos Obrigatórios

## Estrutura de Dados para Onboarding

### FASE 1: CADASTRO INICIAL (Antes de usar)

**Obrigatórias (MVP):**
```
1. Email
   └─ Motivo: Login + recuperação de senha + contato
   
2. Senha
   └─ Motivo: Autenticação
   
3. Nome do responsável
   └─ Motivo: Contato + documentação
   
4. Telefone
   └─ Motivo: Contato urgente
   
5. Nome da loja / Razão social
   └─ Motivo: Identificação
   
6. CNPJ (ou CPF se MEI)
   └─ Motivo: Emissão de NFC-e + fiscal
   
7. Cidade / Estado
   └─ Motivo: Localização do negócio

8. Segmento (vestuário, calçados, acessórios)
   └─ Motivo: Análise de mercado
   
9. Aceitar Termos + Privacidade
   └─ Motivo: LGPD obrigatória

DADOS DE OPERAÇÃO (Auto-preenchidos):
├─ Data de cadastro: Hoje
├─ Status: TESTE (14 dias grátis)
├─ Plano: BÁSICO
└─ Expiração trial: +14 dias
```

**Recomendadas (Logo depois):**
```
1. Endereço completo
   └─ Motivo: NFC-e eletrônica
   
2. Inscrição Estadual
   └─ Motivo: Cadastro fiscal
   
3. Regime tributário (MEI, Simples, Lucro Real)
   └─ Motivo: Cálculo de imposto
   
4. Website
   └─ Motivo: Link na vitrine
   
5. Instagram / WhatsApp
   └─ Motivo: Social media + contato
```

**Futuras:**
```
1. Integração com ERP externo (Omie, SAP)
2. Certificado A1 (para NFC-e automática)
3. Integração com Crediário / Financeira
4. Logo da loja (marca)
5. Descrição de atendimento (aceita chat? video call?)
```

### FASE 2: PRIMEIRAS 24h (Após cadastro)

**Email automático:**
```
Assunto: Bem-vindo ao EasyGestão***REMOVED***

Oi [Nome],

Sua conta foi criada com sucesso. Você tem 14 dias grátis.

Próximos passos:
1. Cadastre seus primeiros 5 produtos
2. Configure suas taxas e impostos
3. Faça sua primeira venda

Dúvidas? Responda este email***REMOVED***

- Time EasyGestão
```

**Checklist in-app:**
```
[ ] Configurar marca (logo + cor)
[ ] Adicionar 5 produtos
[ ] Fazer 1 venda teste
[ ] Conferir relatório de vendas
```

### FASE 3: APÓS 14 DIAS (Antes de cobrar)

**Email:**
```
Assunto: Seu período de teste vai terminar em 3 dias

Oi [Nome],

Você testou o EasyGestion por 14 dias. Gostou?

Seu plano básico custa R$99/mês.

[ Ativar agora ] [ Mais informações ]
```

**Se não ativar:**
```
Status: EXPIRADO (pode recuperar em 30 dias)
Acesso: Bloqueado (sem permissão de venda)
```

### Tabela de Dados: Tenants

```sql
CREATE TABLE tenants (
  -- Identificação
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  email TEXT UNIQUE NOT NULL,
  senha_hash TEXT NOT NULL,
  
  -- Informações da Loja
  nome_loja TEXT NOT NULL,                    -- "Maria Loja"
  razao_social TEXT,                          -- "Maria Silva ME"
  cnpj TEXT UNIQUE,                           -- "12.345.678/0001-90"
  nome_responsavel TEXT NOT NULL,             -- "Maria Silva"
  telefone TEXT NOT NULL,
  
  -- Localização
  endereco TEXT,
  cidade TEXT,
  uf TEXT,
  cep TEXT,
  
  -- Fiscal
  inscricao_estadual TEXT,                    -- "123.456.789.012"
  regime TEXT DEFAULT 'simples',              -- mei, simples, lucro_real
  
  -- Social
  website TEXT,
  instagram TEXT,
  whatsapp TEXT,
  
  -- Plano SaaS
  plano TEXT DEFAULT 'basico',                -- basico, profissional, enterprise
  status TEXT DEFAULT 'teste',                -- teste, ativo, suspenso, cancelado
  data_cadastro TEXT NOT NULL DEFAULT (datetime('now')),
  data_trial_expira TEXT,                     -- +14 dias
  data_ativado TEXT,                          -- Quando começou a pagar
  data_cancelado TEXT,                        -- Quando cancelou
  
  -- Comportamento
  segmento TEXT,                              -- vestuario, calcados, etc
  ultimo_acesso TEXT,
  num_vendas INTEGER DEFAULT 0,
  receita_total REAL DEFAULT 0,
  
  -- Observações
  observacoes TEXT
);
```

---

# 👥 ETAPA 5: CONTROLE DE USUÁRIOS — Estrutura de Papéis & Permissões

## Status: ⚠️ PARCIALMENTE IMPLEMENTADO

Hoje há 3 papéis (admin, vendedor, relacionamento). Precisa de mais granularidade.

### Hierarquia Recomendada

```
NÍVEL 1: Proprietário da Plataforma
├─ Igor (você)
├─ Ver todos os tenants
├─ Gerenciar planos de todos
├─ Ver métricas globais
└─ Acessar qualquer conta (suporte)

NÍVEL 2: Admin da Loja (Dentro de cada tenant)
├─ [Admin da loja]
├─ Manage usuarios da sua loja
├─ Acesso a todas as funções
├─ Config (marca, taxas, fiscal)
├─ Relatórios financeiros
└─ Deletar dados históricos

NÍVEL 3: Gerente
├─ [Gerente de loja]
├─ Ver dashboard
├─ Gerenciar relatórios
├─ Criar usuários (limitado)
├─ Permissão: Sem deletar / Sem config
└─ Acesso a: Vendas, Caixa, Clientes

NÍVEL 4: Caixa
├─ [Operador de PDV]
├─ Apenas: PDV + Caixa + Trocas
├─ Não consegue: Ver financeiro
├─ Não consegue: Deletar vendas
└─ Permissão: Só vender + receber

NÍVEL 5: Estoquista
├─ [Gerenciador de estoque]
├─ Apenas: Produtos + Estoque
├─ Pode: Adicionar/remover peças
├─ Não pode: Ver preços/custos
└─ Visualização: Leitura de código de barras

NÍVEL 6: Relacionamento / CRM
├─ [Community manager]
├─ Apenas: Clientes + Inbox + CRM
├─ Pode: Enviar mensagens
├─ Não pode: Acessar vendas
└─ Visualização: Base de clientes

NÍVEL 7: Financeiro
├─ [Analista financeiro]
├─ Apenas: Dashboard + Financeiro + DRE
├─ Pode: Ver fluxo de caixa
├─ Não pode: Alterar vendas
└─ Acesso: Relatórios + backup
```

### Matriz de Permissões

```
                    | Admin | Geren. | Caixa | Estoque | CRM | Financ. |
--------------------|-------|--------|-------|---------|-----|---------|
Dashboard           |   ✅  |   ✅   |   ❌  |    ❌   |  ❌ |   ✅    |
Produtos            |   ✅  |   ✅   |   ❌  |    ✅   |  ❌ |   ❌    |
Editar preço        |   ✅  |   ❌   |   ❌  |    ❌   |  ❌ |   ❌    |
PDV / Vendas        |   ✅  |   ✅   |   ✅  |    ❌   |  ❌ |   ❌    |
Caixa               |   ✅  |   ✅   |   ✅  |    ❌   |  ❌ |   ❌    |
Trocas / Devol.     |   ✅  |   ✅   |   ✅  |    ❌   |  ❌ |   ❌    |
Estoque             |   ✅  |   ✅   |   ❌  |    ✅   |  ❌ |   ❌    |
Clientes / CRM      |   ✅  |   ✅   |   ❌  |    ❌   |  ✅ |   ❌    |
Financeiro/DRE      |   ✅  |   ❌   |   ❌  |    ❌   |  ❌ |   ✅    |
Config / Impostos   |   ✅  |   ❌   |   ❌  |    ❌   |  ❌ |   ❌    |
Criar usuários      |   ✅  |   ⚠️   |   ❌  |    ❌   |  ❌ |   ❌    |
Deletar usuários    |   ✅  |   ❌   |   ❌  |    ❌   |  ❌ |   ❌    |
Relatórios          |   ✅  |   ✅   |   ❌  |    ❌   |  ✅ |   ✅    |
Backup / Restore    |   ✅  |   ❌   |   ❌  |    ❌   |  ❌ |   ⚠️    |
Integração NFC-e    |   ✅  |   ❌   |   ❌  |    ❌   |  ❌ |   ❌    |
Ver senha de outros |   ❌  |   ❌   |   ❌  |    ❌   |  ❌ |   ❌    |
```

### Implementação

```javascript
// HOJE (3 papéis simples):
const PAPEIS = ['admin', 'relacionamento', 'vendedor'];

function exigirPapel(...papelEsperado) {
  return (req, res, next) => {
    if (papelEsperado.includes(req.session.papel)) return next();
    return res.status(403).json({ erro: 'Sem permissão' });
  };
}

// DEPOIS (Granular - Permissões):
const PERMISSOES = {
  'dashboard:view': ['admin', 'gerente', 'financeiro'],
  'produtos:edit': ['admin'],
  'caixa:vender': ['admin', 'caixa'],
  'estoque:editar': ['admin', 'estoque'],
  'financeiro:view': ['admin', 'financeiro'],
  'usuarios:criar': ['admin'],
  'config:alterar': ['admin'],
};

function exigirPermissao(permissao) {
  return (req, res, next) => {
    const papelEsperado = PERMISSOES[permissao] || [];
    if (papelEsperado.includes(req.session.papel)) return next();
    return res.status(403).json({ erro: `Sem permissão para ${permissao}` });
  };
}

// Usar:
app.get('/api/financeiro/dre', exigirPermissao('financeiro:view'));
app.post('/api/produtos', exigirPermissao('produtos:edit'));
app.post('/api/usuarios', exigirPermissao('usuarios:criar'));
```

---

# 🚀 ETAPA 6: ROADMAP PRIORIZADO

## Status de Implementação

```
HOJE (18/06/2026):
├─ MVP operacional (ERP funcional)
├─ Login funcional (3 papéis)
├─ Config de loja
├─ NFC-e integrada
└─ Dashboard do cliente

FALTA (6 bloqueadores críticos):
├─ Email de usuário
├─ Recuperação de senha
├─ Termos + Privacidade (LGPD)
├─ Multi-tenant isolado
├─ Self-service (usuario altera senha)
└─ Backoffice do proprietário
```

### Roadmap Completo (24 meses)

#### SPRINT 1: MVP SaaS (4 semanas) — Lançamento Mínimo

**CRÍTICO - Não pode lançar sem:**
- [ ] Email de usuário + recovery (2 semanas)
- [ ] Termos + Privacidade + checkbox (3 dias)
- [ ] Multi-tenant isolado + tenant_id em todas tabelas (5 dias)
- [ ] Self-service: alterar senha + export dados + deletar conta (3 dias)
- [ ] Desativar login-sem-senha em produção (1 dia)
- [ ] HTTPS obrigatório em produção (1 dia)
- [ ] Backup automático (S3) (2 dias)
- [ ] Rate limit + CORS whitelist (1 dia)

**Tempo: 8-9 dias de desenvolvimento**  
**Custo: SendGrid $15/mês**  
**Status: ⏳ Em progresso**

---

#### SPRINT 2: Segurança + Onboarding (2 semanas) — Primeiros 30 dias

**IMPORTANTE - Fazer logo após lançamento:**
- [ ] Email verification (2-step)
- [ ] Convites por email com token
- [ ] Checklist in-app de onboarding
- [ ] 2FA (Google Authenticator)
- [ ] Auditoria de acessos (audit_logs)
- [ ] Sentry para tracking de erros
- [ ] Documentação de suporte
- [ ] Validação mais rigorosa (email, CNPJ, força de senha)

**Tempo: 5 dias**  
**Status: 📋 Planejado**

---

#### SPRINT 3: Backoffice Básico (3 semanas) — Dias 31-60

**IMPORTANTE - Necessário para operar 5+ clientes:**
- [ ] Backoffice: Gestão de clientes
  - [ ] Lista de tenants (ativo, teste, suspenso, cancelado)
  - [ ] Busca e filtros
  - [ ] Criar cliente manualmente
  - [ ] Impersonar cliente (suporte)
  - [ ] Bloquear/desbloquear acesso
  - [ ] Deletar tenant (com confirmação)

- [ ] Backoffice: Financeiro (básico)
  - [ ] Dashboard de MRR/ARR/Churn
  - [ ] Listar cobranças por cliente
  - [ ] Status de pagamento
  - [ ] Atualizar plano (upgrade/downgrade)
  - [ ] Registrar pagamento manual

- [ ] Tabelas: tenants, assinaturas, cobranças

**Tempo: 7 dias**  
**Status: 📋 Planejado**

---

#### SPRINT 4: Cobranças Automáticas (2 semanas) — Dias 61-80

**IMPORTANTE - Para escalabilidade (10+ clientes):**
- [ ] Integração com gateway (Stripe, PayPal, PagSeguro)
- [ ] Gerar boletos automáticos
- [ ] Cobrança via PIX recorrente
- [ ] Webhooks de confirmação de pagamento
- [ ] Avisos de pagamento pendente (email)
- [ ] Suspensão automática após 3 dias vencido
- [ ] Reativação após pagamento
- [ ] Nota fiscal de serviço (RPS)

**Tempo: 5 dias**  
**Custo: Taxa do gateway (2-3% por transação)**  
**Status: 📋 Planejado**

---

#### SPRINT 5: Otimização de Performance (2 semanas) — Dias 81-110

**IMPORTANTE - Antes de 20 clientes:**
- [ ] Migração PostgreSQL (do SQLite)
- [ ] Índices em queries críticas
- [ ] Cache de leitura (Redis)
- [ ] Compressão de resposta (gzip)
- [ ] Lazy loading de dados
- [ ] Teste de carga (simular 50 clientes simultâneos)
- [ ] Monitoramento de performance (New Relic, Datadog)

**Tempo: 5-7 dias**  
**Custo: PostgreSQL $12-50/mês + cache $5-20/mês**  
**Status: 📋 Planejado**

---

#### SPRINT 6: Reportes Avançados (2 semanas) — Dias 111-140

**IMPORTANTE - Para crescimento:**
- [ ] Dashboard proprietário com gráficos
- [ ] MRR/ARR/Churn/CAC/LTV
- [ ] Análise por plano, segmento, origem
- [ ] Relatório de retenção
- [ ] Análise de motivos de churn
- [ ] Exportação em PDF/Excel
- [ ] Agendamento automático (email diário)

**Tempo: 5 dias**  
**Status: 📋 Planejado**

---

#### VERSÃO 1.1: Maturidade SaaS (4-6 semanas) — Dias 141-200

**DESEJÁVEL - Operação profissional:**
- [ ] Email verification + confirmação dupla
- [ ] 2FA obrigatório para admin
- [ ] Permissões granulares (Gerente, Caixa, Estoque, CRM, Financeiro)
- [ ] API key para integrações B2B
- [ ] Webhooks para eventos (venda criada, cliente novo, etc)
- [ ] SSO com Google/Microsoft (para corporate)
- [ ] SAML 2.0 (enterprise)
- [ ] Backup + restore point-in-time
- [ ] Criptografia de dados em repouso
- [ ] Conformidade SOC2 / ISO27001

**Status: 📋 Roadmap Médio**

---

#### VERSÃO 1.2: Integrações (4-6 semanas) — Meses 6-8

**IMPORTANTE - Demanda de clientes:**
- [ ] Integração Omie (ERP)
- [ ] Integração CTe (Nota Fiscal)
- [ ] Integração Crediário (Financeira)
- [ ] Integração Google Shopping
- [ ] API de vendas (integrar com WooCommerce, Shopify)
- [ ] Marketplace de plugins
- [ ] Documentação técnica completa

**Status: 📋 Roadmap Futuro**

---

#### VERSÃO 2.0: Multivendedor (3-4 meses) — Meses 9-12

**FUTURO - Crescimento agressivo:**
- [ ] Suporte a multivendedor (B2B2C)
- [ ] Comissão por venda
- [ ] Dashboard de vendedor
- [ ] Payout automático
- [ ] KYC/Compliance para vendedores
- [ ] Gerenciamento de devoluções
- [ ] Sistema de reviews/reputação

**Status: 📋 Roadmap Longo Prazo**

---

### Tabela de Priorização

| Sprint | Semana | Item | Criticidade | Bloqueador? | T-shirt | Status |
|--------|--------|------|-------------|-----------|---------|--------|
| 1 | 1-4 | Email + Recovery | 🔴 CRÍTICO | ✅ Sim | 2-3 dias | ⏳ MVP |
| 1 | 1-4 | LGPD (Termos) | 🔴 CRÍTICO | ✅ Sim | 1 dia | ⏳ MVP |
| 1 | 1-4 | Multi-tenant | 🔴 CRÍTICO | ✅ Sim | 3 dias | ⏳ MVP |
| 1 | 1-4 | Self-service | 🔴 CRÍTICO | ✅ Sim | 2 dias | ⏳ MVP |
| 1 | 1-4 | Backup automático | 🔴 CRÍTICO | ✅ Sim | 1 dia | ⏳ MVP |
| 2 | 5-6 | Email verification | 🟡 IMPORTANTE | ❌ Não | M | 📋 Planejado |
| 2 | 5-6 | Convites por email | 🟡 IMPORTANTE | ❌ Não | M | 📋 Planejado |
| 2 | 5-6 | 2FA | 🟡 IMPORTANTE | ❌ Não | M | 📋 Planejado |
| 2 | 5-6 | Auditoria | 🟡 IMPORTANTE | ❌ Não | M | 📋 Planejado |
| 3 | 7-9 | Backoffice (admin) | 🟡 IMPORTANTE | ✅ Sim* | L | 📋 Planejado |
| 3 | 7-9 | Gestão financeira | 🟡 IMPORTANTE | ✅ Sim* | L | 📋 Planejado |
| 4 | 10-11 | Integração gateway | 🟡 IMPORTANTE | ✅ Sim* | L | 📋 Planejado |
| 5 | 12-13 | PostgreSQL | 🟡 IMPORTANTE | ✅ Sim* | XL | 📋 Planejado |
| 6 | 14-15 | Reportes | 🟠 OPCIONAL | ❌ Não | M | 📋 Planejado |
| 1.1 | 16-21 | Maturidade SaaS | 🟠 DESEJÁVEL | ❌ Não | XL | 📋 Futuro |
| 1.2 | 22-26 | Integrações | 🟠 DESEJÁVEL | ❌ Não | XXL | 📋 Futuro |
| 2.0 | 27-40 | Multivendedor | 🟠 FUTURO | ❌ Não | XXL | 📋 Longíssimo prazo |

*Bloqueador após ganhar alguns clientes (não para lançamento inicial)

---

# 📊 NOTA FINAL: AVALIAÇÃO DE MATURIDADE SAAS

## Sua nota atual: **3.5/10**

### Breakdown por Categoria

| Categoria | Nota | Justificativa |
|-----------|------|--------------|
| **Funcionalidade ERP** | 8/10 | ✅ Completo (produtos, vendas, caixa, estoque, NFC-e) |
| **Arquitetura SaaS** | 1/10 | ❌ Não é multi-tenant (banco único) |
| **Backoffice** | 0/10 | ❌ Não existe (sem gestão de clientes/financeiro) |
| **Segurança** | 5/10 | ⚠️ Básica (login ok, mas sem recovery, LGPD, 2FA) |
| **Onboarding** | 2/10 | ❌ Sem email, termos, guia |
| **Compliance** | 0/10 | ❌ Sem termos, privacidade, LGPD |
| **Suporte operacional** | 0/10 | ❌ Sem impersonação, logs, auditoria |
| **Escalabilidade** | 2/10 | ⚠️ SQLite morre em >20 clientes |
| **Documentação** | 3/10 | ⚠️ Existe código, mas sem docs de API |
| **Testes** | 1/10 | ❌ Sem testes automatizados |
| **Observabilidade** | 1/10 | ❌ Sem Sentry, logs estruturados, alertas |

### **Pontuação Geral: 3.5/10** 🔴

---

## Por Que Não é 10/10 (Quando Será)?

### Áreas Críticas Faltando

1. **Multi-tenant isolado** (Responsável por 3 pontos de perda)
   - Sem isto, não é SaaS de verdade
   - Um cliente consegue ver dados de outro
   - Impossível de confiar em produção

2. **Backoffice proprietário** (Responsável por 2 pontos)
   - Sem gestão de clientes
   - Sem financeiro/cobranças
   - Sem métricas (MRR, ARR, churn)
   - Impossível operar como negócio

3. **LGPD & Compliance** (Responsável por 1.5 pontos)
   - Sem termos/privacidade
   - Sem recuperação de senha
   - Multa potencial: 2% faturamento

4. **Segurança profissional** (Responsável por 1 ponto)
   - Sem 2FA
   - Sem auditoria
   - Sem backup automático
   - Sem CSRF protection

5. **Suporte operacional** (Responsável por 1 ponto)
   - Sem impersonação (suporte não consegue ajudar)
   - Sem logs durável
   - Sem observabilidade

6. **Escalabilidade** (Responsável por 1 ponto)
   - SQLite não aguenta >20 clientes
   - Sem cache
   - Sem replicação

---

## Plano para Chegar em 8.5/10 (em 12 semanas)

```
SEMANA 1-2: Email + Recovery → Nota sobe para 4.0
SEMANA 3-4: Multi-tenant + LGPD → Nota sobe para 5.5
SEMANA 5-6: Backoffice básico → Nota sobe para 6.5
SEMANA 7-8: 2FA + Auditoria → Nota sobe para 7.0
SEMANA 9-10: PostgreSQL → Nota sobe para 7.5
SEMANA 11-12: Sentry + Backups → Nota sobe para 8.0

FALTANDO PARA 10/10 (Futuro):
├─ SSO/SAML (v1.1)
├─ Permissões granulares (v1.1)
├─ Conformidade SOC2 (v1.2)
├─ Integrações B2B (v1.2)
└─ Escalabilidade global (v2.0)
```

---

## Conclusão

**Seu ERP é excelente.** Operacionalmente, faz tudo.

**Mas não é SaaS ainda.** É um sistema monolítico pensado para 1 loja.

**Para lançar como SaaS profissional, precisa de:**
1. Multi-tenant isolado (segurança)
2. Backoffice (operação)
3. Termos + LGPD (legal)
4. Email + recovery (usabilidade)
5. Backup automático (confiabilidade)

**Tempo para 6/10:** 4 semanas (Sprint 1)  
**Tempo para 8/10:** 12 semanas (Sprints 1-6)  
**Tempo para 10/10:** 6-12 meses (v1.1 + v1.2 + v2.0)

**Recomendação:** Foque em chegar em 6/10 rápido (lançar seguro), depois evolua.

