# PLANO MVP SaaS DETALHADO
## Ordem Exata de Execução (Baseado nas 7 Etapas)

> **Objetivo:** De 3.5/10 → 5.5/10 em 4 semanas  
> **Status:** MVP Pronto para Lançar com Segurança  
> **Data Alvo:** 25 de julho de 2026

---

# 📋 ESTRUTURA DO PLANO

```
ORDEM DE EXECUÇÃO:
├─ ETAPA 4 → Definir cadastro (campos a coletar)
├─ ETAPA 5 → Definir estrutura de usuários (papéis)
├─ ETAPA 3 → Implementar segurança (email, recovery, LGPD)
├─ ETAPA 2 → Implementar multi-tenant (isolamento)
├─ ETAPA 1 → Preparar backoffice (tabelas + schema)
├─ ETAPA 6 → Executar roadmap (Sprints)
└─ ETAPA 7 → Validar nota SaaS

MOTIVO DA ORDEM:
1. Define o QUÊ (Etapas 4-5)
2. Define o COMO (Etapa 3)
3. Define a ARQUITETURA (Etapa 2)
4. Define as OPERAÇÕES (Etapa 1)
5. Define o PLANO (Etapa 6)
6. Valida o RESULTADO (Etapa 7)
```

---

# FASE 0: PREPARAÇÃO (Hoje)

## 📋 Checklist de Hoje (18/06)

- [ ] Ler este plano (30 min)
- [ ] Tomar decisão: fazer agora ou depois? (5 min)
- [ ] Abrir conta SendGrid (15 min)
  - Site: https://sendgrid.com/
  - Criar API key (free tier: 100 emails/dia)
  - Guardar em `.env`
- [ ] Revisar `.env.example` e criar `.env` local
- [ ] Preparar lista de tarefas (Todoist, Asana, ou papel)

**Tempo:** 1h  
**Saída:** Pronto para começar Sprint 1

---

# FASE 1: ETAPA 4 — Definir Cadastro de Clientes

## 🎯 Objetivo
Definir exatamente qual informação coletar de novo lojista

## 📍 Semana 0.5 (Hoje + amanhã)

### Tarefa 1.1: Criar Tabela de Tenants no BD

**Arquivo:** `db/schema.sql`

**Adicionar ao final:**

```sql
-- Tabela de tenants (clientes SaaS) — NOVA
CREATE TABLE IF NOT EXISTS tenants (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  
  -- Autenticação
  email TEXT UNIQUE NOT NULL,
  senha_hash TEXT NOT NULL,
  
  -- Informações da Loja
  nome_loja TEXT NOT NULL,                    -- "Maria Loja"
  razao_social TEXT,                          -- "Maria Silva ME"
  cnpj TEXT UNIQUE,                           -- "12.345.678/0001-90"
  nome_responsavel TEXT NOT NULL,             -- "Maria Silva"
  telefone TEXT NOT NULL,                     -- "(73) 99999-9999"
  
  -- Localização
  endereco TEXT,                              -- "Rua X, 123"
  cidade TEXT,                                -- "Itabuna"
  uf TEXT,                                    -- "BA"
  cep TEXT,                                   -- "45600-000"
  
  -- Fiscal
  inscricao_estadual TEXT,                    -- "123.456.789.012"
  regime TEXT DEFAULT 'simples',              -- mei, simples, lucro_real
  
  -- Social / Contato
  website TEXT,                               -- "https://..."
  instagram TEXT,                             -- "@marialoja"
  whatsapp TEXT,                              -- "(73) 99999-9999"
  
  -- Plano SaaS
  plano TEXT DEFAULT 'basico',                -- basico, profissional, enterprise
  status TEXT DEFAULT 'teste',                -- teste, ativo, suspenso, bloqueado, cancelado
  
  -- Datas
  data_cadastro TEXT NOT NULL DEFAULT (datetime('now','localtime')),
  data_trial_expira TEXT,                     -- Data de expiração do trial
  data_ativado TEXT,                          -- Quando começou a pagar
  data_cancelado TEXT,                        -- Quando cancelou
  
  -- Comportamento
  segmento TEXT,                              -- vestuario, calcados, acessorios
  ultimo_acesso TEXT,                         -- Timestamp do último acesso
  num_vendas INTEGER DEFAULT 0,
  receita_total REAL DEFAULT 0,
  
  -- LGPD
  aceito_termos INTEGER DEFAULT 0,            -- 1 = aceito
  data_aceito_termos TEXT,                    -- Quando aceitou
  aceito_privacidade INTEGER DEFAULT 0,       -- 1 = aceito
  data_aceito_privacidade TEXT,               -- Quando aceitou
  
  -- Observações
  observacoes TEXT
);

-- Índices para performance
CREATE INDEX idx_tenants_email ON tenants(email);
CREATE INDEX idx_tenants_status ON tenants(status);
CREATE INDEX idx_tenants_plano ON tenants(plano);
```

**Checklist:**
- [ ] Adicionar código ao schema.sql
- [ ] Testar: `node -e "const db = require('./db/database'); console.log('OK')"`
- [ ] Commit: `git add db/schema.sql && git commit -m "add: tabela tenants"`

**Tempo:** 30 min

---

### Tarefa 1.2: Criar Tabelas Financeiras

**Arquivo:** `db/schema.sql`

**Adicionar após tenants:**

```sql
-- Tabela de assinaturas — NOVA
CREATE TABLE IF NOT EXISTS assinaturas (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  tenant_id INTEGER NOT NULL UNIQUE,
  plano TEXT NOT NULL,                       -- basico, profissional, enterprise
  valor_mensal REAL NOT NULL,                -- R$ 99, R$ 299, etc
  data_inicio TEXT NOT NULL,                 -- Quando começou
  data_proxima_renovacao TEXT NOT NULL,      -- Quando vai cobrar de novo
  cancelada_em TEXT,                         -- Se cancelou
  cancelado_por TEXT,                        -- Quem/por quê cancelou
  motivo_cancelamento TEXT,                  -- Motivo (caro, não usava, etc)
  FOREIGN KEY (tenant_id) REFERENCES tenants(id)
);

-- Tabela de cobranças — NOVA
CREATE TABLE IF NOT EXISTS cobranças (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  tenant_id INTEGER NOT NULL,
  assinatura_id INTEGER,
  data_cobranca TEXT NOT NULL,               -- Quando cobrou
  valor REAL NOT NULL,                       -- Quanto cobrou
  status TEXT DEFAULT 'pendente',            -- pendente, pago, vencido
  metodo_pagamento TEXT,                     -- boleto, pix, cartao, transferencia
  referencia TEXT,                           -- ID externo (Stripe, etc)
  data_pagamento TEXT,                       -- Quando pagou (se pagou)
  tentativas INTEGER DEFAULT 0,              -- Número de tentativas
  FOREIGN KEY (tenant_id) REFERENCES tenants(id)
);

-- Índices
CREATE INDEX idx_assinaturas_tenant ON assinaturas(tenant_id);
CREATE INDEX idx_cobranças_tenant ON cobranças(tenant_id);
CREATE INDEX idx_cobranças_status ON cobranças(status);
CREATE INDEX idx_cobranças_data ON cobranças(data_cobranca);
```

**Checklist:**
- [ ] Adicionar código
- [ ] Testar schema
- [ ] Commit

**Tempo:** 30 min

---

### Tarefa 1.3: Documentar Campos a Coletar

**Arquivo:** CRIAR `CADASTRO-Cliente-MVP.md`

```markdown
# Cadastro de Cliente MVP SaaS

## OBRIGATÓRIOS (Tela de Cadastro)

### Autenticação
1. **EMAIL** ✅
   - Campo: email
   - Validação: Único + formato válido
   - Motivo: Login + recuperação
   - Exemplo: maria@marialoja.com

2. **SENHA** ✅
   - Campo: senha
   - Validação: Mínimo 8 caracteres
   - Motivo: Autenticação
   - Requisito: Maiús + minús + número

### Dados da Loja
3. **NOME DO RESPONSÁVEL** ✅
   - Campo: nome_responsavel
   - Validação: Mínimo 5 caracteres
   - Motivo: Contato principal
   - Exemplo: "Maria Silva"

4. **NOME DA LOJA** ✅
   - Campo: nome_loja
   - Validação: Mínimo 5 caracteres
   - Motivo: Identificação
   - Exemplo: "Maria Loja de Moda"

5. **TELEFONE** ✅
   - Campo: telefone
   - Validação: Formato brasileiro
   - Motivo: Contato urgente
   - Exemplo: "(73) 99999-9999"

6. **CNPJ** ✅
   - Campo: cnpj
   - Validação: Único + check digit válido
   - Motivo: NFC-e + Fiscal
   - Exemplo: "12.345.678/0001-90"

7. **CIDADE / UF** ✅
   - Campo: cidade, uf
   - Validação: UF válido (BA, SP, etc)
   - Motivo: Localização do negócio
   - Exemplo: "Itabuna, BA"

8. **SEGMENTO** ✅
   - Campo: segmento
   - Opções: Vestuário, Calçados, Acessórios, Outro
   - Motivo: Análise de mercado
   - Exemplo: "Vestuário"

9. **ACEITAR TERMOS** ✅
   - Campo: checkbox obrigatório
   - Validação: Deve estar checked
   - Motivo: LGPD (Lei 14.155)
   - Versão: Guardar versão dos termos

## RECOMENDADAS (Perfil da Loja — depois)
- Endereço completo
- Inscrição Estadual
- Regime Tributário
- Website
- Instagram
- WhatsApp

## AUTO-PREENCHIDOS
- data_cadastro = Hoje
- status = 'teste'
- plano = 'basico'
- data_trial_expira = Hoje + 14 dias

## FLUXO DE CADASTRO

1. Usuário clica "Cadastro" em landing
2. Preenche 9 campos obrigatórios
3. Aceita termos e privacidade
4. Clica "Criar conta"
5. Sistema:
   - Valida email (único)
   - Valida CNPJ (check digit)
   - Hash a senha
   - Cria tenant
   - Envia email de boas-vindas
6. Redireciona para login
7. Login bem-sucedido → Dashboard

## VALIDAÇÕES OBRIGATÓRIAS

| Campo | Validação | Mensagem de Erro |
|-------|-----------|------------------|
| Email | Único + formato | "Email inválido ou já cadastrado" |
| Senha | 8+ chars + maiús + minús + número | "Senha fraca" |
| CNPJ | Único + check digit | "CNPJ inválido" |
| Telefone | Formato brasileiro | "Telefone inválido" |
| UF | 2 caracteres válidos | "UF inválida" |
| Termos | Checkbox checked | "Você precisa aceitar os termos" |

## EMAILS AUTOMÁTICOS

### 1. Boas-vindas (Imediato)
- Assunto: "Bem-vindo ao EasyGestão"
- Corpo: Instruções de primeiros passos
- Link: Ir para dashboard

### 2. Trial expira em 3 dias (Dia 11)
- Assunto: "Seu trial expira em 3 dias"
- Corpo: Opções para ativar plano
- CTA: [Ativar agora] [Mais informações]

### 3. Trial expirado (Dia 14)
- Assunto: "Seu trial expirou"
- Corpo: Opção de reativar (30 dias)
- CTA: [Ativar agora]
```

**Checklist:**
- [ ] Criar arquivo
- [ ] Adicionar validações
- [ ] Adicionar fluxo de emails
- [ ] Commit

**Tempo:** 1h

---

**Saída da Fase 1:**
- ✅ Tabelas tenants, assinaturas, cobranças criadas
- ✅ Campos de cadastro definidos
- ✅ Validações documentadas
- ✅ Fluxo de email definido

---

# FASE 2: ETAPA 5 — Definir Estrutura de Usuários

## 🎯 Objetivo
Definir 7 papéis e suas permissões

## 📍 Semana 0.5 (Paralelo à Fase 1)

### Tarefa 2.1: Criar Tabela de Papéis

**Arquivo:** `db/schema.sql`

**Adicionar:**

```sql
-- Tabela de papéis do sistema — EXPANDIR EXISTENTE
-- (Hoje tem: admin, relacionamento, vendedor)
-- Amanhã precisa de: proprietario, admin, gerente, caixa, estoquista, vendedor, financeiro

-- Adicionar se não existir:
CREATE TABLE IF NOT EXISTS papeis (
  id INTEGER PRIMARY KEY,
  nome TEXT UNIQUE NOT NULL,
  descricao TEXT
);

-- Inserir papéis (após criar):
INSERT OR IGNORE INTO papeis (nome, descricao) VALUES 
  ('proprietario', 'Proprietário da plataforma (super-admin)'),
  ('admin', 'Administrador da loja'),
  ('gerente', 'Gerente operacional'),
  ('caixa', 'Operador de PDV'),
  ('estoquista', 'Gerenciador de estoque'),
  ('vendedor', 'Vendedor / Relacionamento'),
  ('financeiro', 'Analista financeiro');
```

**Checklist:**
- [ ] Adicionar tabela ao schema
- [ ] Adicionar INSERTs
- [ ] Testar

**Tempo:** 30 min

---

### Tarefa 2.2: Criar Matriz de Permissões

**Arquivo:** CRIAR `PERMISSOES-MVP.js`

```javascript
// lib/permissoes.js

const PERMISSOES = {
  // Admin — Acesso total
  'admin': [
    'dashboard:view',
    'produtos:edit',
    'estoque:editar',
    'vendas:criar',
    'vendas:ver',
    'caixa:abrir',
    'clientes:editar',
    'financeiro:view',
    'usuarios:criar',
    'usuarios:deletar',
    'config:alterar',
    'backup:fazer',
  ],
  
  // Gerente — Operacional (sem config/financeiro sensível)
  'gerente': [
    'dashboard:view',
    'produtos:ver',
    'estoque:ver',
    'vendas:ver',
    'caixa:ver',
    'clientes:editar',
    'usuarios:criar', // apenas caixa/estoque
  ],
  
  // Caixa — Apenas vendas/caixa
  'caixa': [
    'vendas:criar',
    'vendas:cancelar-proprias',
    'caixa:abrir',
    'caixa:fechar',
    'clientes:criar',
  ],
  
  // Estoquista — Estoque + produtos
  'estoquista': [
    'produtos:ver',
    'estoque:editar',
    'relatoios:estoque-baixo',
  ],
  
  // Vendedor — Clientes + CRM
  'vendedor': [
    'clientes:editar',
    'inbox:ver',
    'crm:editar',
    'vendas:ver',
  ],
  
  // Financeiro — Financeiro + relatórios
  'financeiro': [
    'dashboard:view',
    'financeiro:view',
    'dre:view',
    'relatórios:view',
  ],
};

function temPermissao(papel, permissao) {
  const perms = PERMISSOES[papel] || [];
  return perms.includes(permissao);
}

function exigirPermissao(permissao) {
  return (req, res, next) => {
    if (***REMOVED***req.session || ***REMOVED***req.session.papel) {
      return res.status(401).json({ erro: 'Não autenticado' });
    }
    
    if (temPermissao(req.session.papel, permissao)) {
      return next();
    }
    
    return res.status(403).json({ 
      erro: `Sem permissão para ${permissao}` 
    });
  };
}

module.exports = { PERMISSOES, temPermissao, exigirPermissao };
```

**Checklist:**
- [ ] Criar arquivo lib/permissoes.js
- [ ] Adicionar ao server.js (exports)
- [ ] Testar: `const p = require('./lib/permissoes'); console.log(p.temPermissao('admin', 'dashboard:view'))`
- [ ] Commit

**Tempo:** 1h

---

### Tarefa 2.3: Documentar Matriz

**Arquivo:** CRIAR `PAPEIS-PERMISSOES-MVP.md`

```markdown
# Papéis e Permissões MVP

## Níveis de Acesso

### NÍVEL 0: PROPRIETÁRIO (Igor)
- Acesso global (todas as lojas)
- Gestão de clientes (backoffice)
- Métricas globais
- Pode impersonar qualquer um

### NÍVEL 1: ADMIN (da loja)
- Acesso total da sua loja
- Todas as funções

### NÍVEL 2: GERENTE
- Dashboard, Relatórios
- Sem config, sem financeiro sensível

### NÍVEL 3: CAIXA
- Apenas PDV, Caixa, Trocas

### NÍVEL 4: ESTOQUISTA
- Apenas Estoque

### NÍVEL 5: VENDEDOR
- Clientes, CRM, Inbox

### NÍVEL 6: FINANCEIRO
- Dashboard, Financeiro, DRE

## Matriz Completa

(Ver TABELA-RESUMO-7-ETAPAS.md Etapa 5)
```

**Checklist:**
- [ ] Criar arquivo
- [ ] Commit

**Tempo:** 30 min

---

**Saída da Fase 2:**
- ✅ 7 papéis definidos
- ✅ Permissões mapeadas
- ✅ Código de permissões pronto

---

# FASE 3: ETAPA 3 — Implementar Segurança & Email

## 🎯 Objetivo
Email + Recovery + LGPD + Multi-tenant prep

## 📍 Semanas 1-4 (Sprint 1)

### Tarefa 3.1: Preparar SendGrid

**Ações:**
1. Criar conta em https://sendgrid.com (free tier)
2. Gerar API key
3. Copiar para `.env`:
   ```
   SENDGRID_API_KEY=SG.xxx...
   SITE_URL=http://localhost:3000
   LOJA_EMAIL=noreply@easygestion.com
   ```

**Checklist:**
- [ ] Conta criada
- [ ] API key gerada
- [ ] .env atualizado
- [ ] Testar: `node -e "const sg = require('@sendgrid/mail'); console.log('OK')"`

**Tempo:** 30 min

---

### Tarefa 3.2: Instalar Dependências

**Arquivo:** `package.json`

```bash
npm install @sendgrid/mail jsonwebtoken
npm install --save-dev
```

**Checklist:**
- [ ] Pacotes instalados
- [ ] `npm list | grep sendgrid`
- [ ] `npm list | grep jsonwebtoken`
- [ ] Commit

**Tempo:** 15 min

---

### Tarefa 3.3: Criar Lib de Email

**Arquivo:** CRIAR `lib/email.js`

(Copiar de PLANO-MVP-SAAS.md — Semana 1, Tarefa 1.4)

**Checklist:**
- [ ] Arquivo criado
- [ ] Funções: enviarEmail, templateResetSenha, templateVerificarEmail
- [ ] Testado localmente (console.log deve funcionar)
- [ ] Commit

**Tempo:** 1h

---

### Tarefa 3.4: Adicionar Email a Usuarios

**Arquivo:** `db/schema.sql`

```sql
-- Adicionar coluna email em usuarios (se ainda não tiver):
ALTER TABLE usuarios ADD COLUMN email TEXT UNIQUE;
ALTER TABLE usuarios ADD COLUMN email_verificado INTEGER DEFAULT 0;
ALTER TABLE usuarios ADD COLUMN email_verificado_em TEXT;
ALTER TABLE usuarios ADD COLUMN aceito_termos INTEGER DEFAULT 0;
ALTER TABLE usuarios ADD COLUMN aceito_termos_em TEXT;

-- Tabela de tokens para reset/verify/convite:
CREATE TABLE IF NOT EXISTS tokens_verificacao (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  usuario_id INTEGER NOT NULL,
  token TEXT UNIQUE NOT NULL,
  tipo TEXT NOT NULL,           -- reset-senha, verificar-email, convite
  criado_em TEXT NOT NULL DEFAULT (datetime('now','localtime')),
  expires_em TEXT NOT NULL,     -- 1h depois
  usado_em TEXT,
  FOREIGN KEY (usuario_id) REFERENCES usuarios(id) ON DELETE CASCADE
);

CREATE INDEX idx_tokens_expires ON tokens_verificacao(expires_em);
```

**Checklist:**
- [ ] Colunas adicionadas
- [ ] Tabela token_verificacao criada
- [ ] Índices criados
- [ ] Testar: Database deve aceitar

**Tempo:** 30 min

---

### Tarefa 3.5: Implementar Rotas de Recovery

**Arquivo:** `routes/auth.js` (EXPANDIR)

(Copiar de PLANO-MVP-SAAS.md — Semana 2)

```javascript
// POST /api/auth/forgot-password
// POST /api/auth/reset-senha
```

**Checklist:**
- [ ] Rotas criadas
- [ ] Testado: Enviar email de reset
- [ ] Testado: Reset de senha funciona
- [ ] Commit

**Tempo:** 2-3h

---

### Tarefa 3.6: Criar Telas de Recovery

**Arquivos:**
- CRIAR `public/esqueci-senha.html`
- CRIAR `public/reset-senha.html`
- EDITAR `public/login.html` (adicionar link)

(Copiar de PLANO-MVP-SAAS.md — Semana 2)

**Checklist:**
- [ ] Telas criadas
- [ ] Testado no navegador
- [ ] Email sendo enviado
- [ ] Reset password funciona
- [ ] Commit

**Tempo:** 2h

---

### Tarefa 3.7: Adicionar Termos & Privacidade

**Arquivos:**
- CRIAR `public/termos.html`
- CRIAR `public/privacidade.html`
- EDITAR `public/login.html` (adicionar checkbox)

(Copiar de PLANO-MVP-SAAS.md — Semana 4)

**Checklist:**
- [ ] Páginas criadas
- [ ] Checkbox aparece no login
- [ ] Dados sendo salvos em BD
- [ ] Commit

**Tempo:** 2-3h

---

### Tarefa 3.8: Implementar Self-Service

**Arquivo:** CRIAR `public/minha-conta.html`  
**Arquivo:** Expandir `routes/auth.js` (adicionar rotas /me/*)

(Copiar de PLANO-MVP-SAAS.md — Semana 3)

```javascript
// PATCH /api/me/senha
// GET /api/me/dados
// DELETE /api/me/conta
```

**Checklist:**
- [ ] Tela criada
- [ ] Rotas implementadas
- [ ] Testado: Usuário consegue alterar senha
- [ ] Testado: Usuário consegue exportar dados (JSON)
- [ ] Testado: Usuário consegue deletar conta
- [ ] Commit

**Tempo:** 3-4h

---

**Saída da Fase 3:**
- ✅ Email funcionando (SendGrid)
- ✅ Recuperação de senha funcionando
- ✅ Termos + Privacidade online
- ✅ Self-service (alterar senha, export, delete)
- ✅ LGPD pronto

---

# FASE 4: ETAPA 2 — Implementar Multi-Tenant

## 🎯 Objetivo
Adicionar isolamento de dados

## 📍 Semana 4 (Sprint 1, fim)

### Tarefa 4.1: Criar Middleware de Tenant

**Arquivo:** CRIAR `middleware/tenant.js`

```javascript
// middleware/tenant.js

function exigirTenant(req, res, next) {
  // Validar que tenant_id está definido
  if (***REMOVED***req.session || ***REMOVED***req.session.tenant_id) {
    return res.status(403).json({ 
      erro: 'Tenant não encontrado na sessão' 
    });
  }
  
  // Validar que usuário pertence ao tenant
  // (Fazer depois quando tiver relação usuario.tenant_id)
  
  next();
}

module.exports = { exigirTenant };
```

**Checklist:**
- [ ] Arquivo criado
- [ ] Importado em server.js
- [ ] Adicionado a `/api` routes

**Tempo:** 30 min

---

### Tarefa 4.2: Adicionar Tenant_ID às Tabelas

**Arquivo:** `db/schema.sql`

**Adicionar tenant_id a:**
```
ALTER TABLE usuarios ADD COLUMN tenant_id INTEGER;
ALTER TABLE produtos ADD COLUMN tenant_id INTEGER;
ALTER TABLE variacoes ADD COLUMN tenant_id INTEGER;
ALTER TABLE vendas ADD COLUMN tenant_id INTEGER;
ALTER TABLE venda_itens ADD COLUMN tenant_id INTEGER;
ALTER TABLE venda_pagamentos ADD COLUMN tenant_id INTEGER;
ALTER TABLE clientes ADD COLUMN tenant_id INTEGER;
ALTER TABLE vendedores ADD COLUMN tenant_id INTEGER;
ALTER TABLE caixa_dia ADD COLUMN tenant_id INTEGER;
ALTER TABLE caixa_movimentos ADD COLUMN tenant_id INTEGER;
ALTER TABLE despesas ADD COLUMN tenant_id INTEGER;
ALTER TABLE trocas ADD COLUMN tenant_id INTEGER;
ALTER TABLE permutas ADD COLUMN tenant_id INTEGER;
ALTER TABLE estoque ADD COLUMN tenant_id INTEGER;
ALTER TABLE encomendas ADD COLUMN tenant_id INTEGER;
ALTER TABLE config ADD COLUMN tenant_id INTEGER;
-- ... (todas as tabelas que tiverem dados)
```

**Criar índices:**
```
CREATE INDEX idx_usuarios_tenant ON usuarios(tenant_id);
CREATE INDEX idx_produtos_tenant ON produtos(tenant_id);
CREATE INDEX idx_vendas_tenant ON vendas(tenant_id);
... (para todas)
```

**Checklist:**
- [ ] Todas as 15+ tabelas têm tenant_id
- [ ] Índices criados
- [ ] Testar: Dados carregam normal
- [ ] Commit

**Tempo:** 2-3h

---

### Tarefa 4.3: Refatorar Queries

**Arquivo:** Todas as rotas em `/routes`

**Padrão:**
```javascript
// ANTES (perigoso):
const produtos = db.prepare('SELECT * FROM produtos').all();

// DEPOIS (seguro):
const produtos = db.prepare(
  'SELECT * FROM produtos WHERE tenant_id = ?'
).all(req.session.tenant_id);
```

**Afetadas (~50 queries):**
- `routes/produtos.js`
- `routes/vendas.js`
- `routes/clientes.js`
- `routes/estoque.js`
- `routes/caixa.js`
- `routes/config.js`
- `routes/dashboard.js`
- `routes/financeiro.js`
- `routes/trocas.js`
- ... (todas)

**Checklist:**
- [ ] Todas as queries refatoradas
- [ ] Nenhuma query sem WHERE tenant_id
- [ ] Testes: User A não vê dados de User B
- [ ] Commit

**Tempo:** 4-5h (trabalho mecânico)

---

### Tarefa 4.4: Testes de Isolamento

**Arquivo:** CRIAR `tests/multi-tenant.test.js`

```javascript
// Testes básicos de isolamento:
// 1. User A cadastra produto → apenas User A vê
// 2. User B cadastra cliente → apenas User B vê
// 3. User A não consegue ver vendas de User B
// 4. Query cruzado não retorna dados de outro tenant
```

**Checklist:**
- [ ] Testes escritos
- [ ] Testes passam ✅
- [ ] Commit

**Tempo:** 2h

---

**Saída da Fase 4:**
- ✅ Middleware de tenant criado
- ✅ tenant_id adicionado a 15+ tabelas
- ✅ ~50 queries refatoradas
- ✅ Isolamento testado

---

# FASE 5: ETAPA 1 — Preparar Backoffice

## 🎯 Objetivo
Tabelas e schema para o backoffice

## 📍 Semana 4 (Paralelo à Tarefa 4.3)

### Tarefa 5.1: Criar Tabelas de Admin

(Já feitas em Fase 1 — Tarefa 1.2)

**Verificar que existem:**
- ✅ tenants
- ✅ assinaturas
- ✅ cobranças

**Checklist:**
- [ ] Tabelas existem
- [ ] Índices existem
- [ ] Testar: `SELECT * FROM tenants LIMIT 1` funciona

**Tempo:** 0 (já feito)

---

### Tarefa 5.2: Preparar Rotas Admin (Sem lógica ainda)

**Arquivo:** CRIAR `routes/admin.js`

```javascript
const express = require('express');
const router = express.Router();
const { exigirPermissao } = require('../lib/permissoes');

// GET /api/admin/clientes
router.get('/clientes', exigirPermissao('admin'), (req, res) => {
  // Implementar em Sprint 3
  res.json({ clientes: [] });
});

// POST /api/admin/clientes/:id/bloquear
router.post('/clientes/:id/bloquear', exigirPermissao('admin'), (req, res) => {
  // Implementar em Sprint 3
  res.json({ ok: true });
});

module.exports = router;
```

**Checklist:**
- [ ] Arquivo criado (esqueleto)
- [ ] Importado em server.js
- [ ] Rotas aparecem (sem lógica)

**Tempo:** 30 min

---

**Saída da Fase 5:**
- ✅ Tabelas prontas
- ✅ Rotas esqueléticas criadas

---

# FASE 6: ETAPA 6 & 7 — Validação & Deploy

## 🎯 Objetivo
Testar tudo junto, validar, fazer deploy

## 📍 Semana 4-5

### Checklist de Deploy

```
ANTES DE FAZER DEPLOY:

AUTENTICAÇÃO:
├─ [ ] Login funciona
├─ [ ] Logout funciona
├─ [ ] Recovery de senha funciona
├─ [ ] Email está sendo enviado
├─ [ ] Rate limit (6 tentativas) funcionando

MULTI-TENANT:
├─ [ ] Usuário A criado com tenant_id=1
├─ [ ] Usuário B criado com tenant_id=2
├─ [ ] Usuário A não vê dados de B
├─ [ ] Usuário B não vê dados de A
├─ [ ] Query cruzado não retorna dados errados

LGPD:
├─ [ ] Termos visível em login
├─ [ ] Privacidade visível
├─ [ ] Checkbox obrigatório
├─ [ ] Dados sendo salvos em BD

SEGURANÇA:
├─ [ ] HTTPS funcionando
├─ [ ] SESSION_SECRET forte
├─ [ ] Cookies httpOnly + secure
├─ [ ] Rate limit testado
├─ [ ] Login-sem-senha DESATIVADO em prod

BACKUP:
├─ [ ] Backup S3 funcionando
├─ [ ] Restore testado
├─ [ ] Agendamento automático (cron/S3)

ERROS:
├─ [ ] Sentry configurado (opcional em v1)
├─ [ ] Logs estruturados
├─ [ ] Sem erros em console

3 CLIENTES PILOTO:
├─ [ ] Cliente A testando
├─ [ ] Cliente B testando
├─ [ ] Cliente C testando
├─ [ ] Nenhum erro crítico
```

### Deploy Checklist

```
1. [ ] Testes locais passam
2. [ ] Deploy staging
3. [ ] Testes em staging
4. [ ] Deploy produção
5. [ ] Verificar: HTTPS, DNS, CDN
6. [ ] Monitorar logs
7. [ ] Contatr clientes pilotos
```

**Tempo:** 2-3h

---

**Saída da Fase 6:**
- ✅ Tudo testado
- ✅ Em produção
- ✅ 3 clientes testando
- ✅ Nota SaaS: 5.5/10 ✅

---

# 📊 RESUMO DO PLANO

## Cronograma Geral

```
SEMANA 0 (Hoje - 18/06)
├─ [ ] Fase 1: Tabelas + Campos (1h)
├─ [ ] Fase 2: Papéis + Permissões (2h)
├─ [ ] Fase 3.1-3.2: SendGrid + Dependências (1h)
└─ [ ] Total: 4h

SEMANA 1 (19-25/06)
├─ [ ] Fase 3.3-3.5: Email + Recovery (6-8h)
├─ [ ] Fase 3.6: Telas (2-3h)
└─ [ ] Total: 8-11h por dia

SEMANA 2 (26-02/07)
├─ [ ] Fase 3.7: Termos + Self-service (4-5h)
├─ [ ] Paralelo: Fase 4.1-4.2: Multi-tenant prep (3-4h)
└─ [ ] Total: 7-9h por dia

SEMANA 3 (03-09/07)
├─ [ ] Fase 4.3: Refatorar queries (4-5h)
├─ [ ] Fase 4.4: Testes isolamento (2h)
├─ [ ] Fase 5: Backoffice prep (1-2h)
└─ [ ] Total: 7-9h por dia

SEMANA 4 (10-16/07)
├─ [ ] Fase 6: Deploy + Testes (4-5h)
├─ [ ] Convidar clientes piloto (1h)
├─ [ ] Monitorar erros (1-2h)
└─ [ ] Total: 6-8h por dia

SEMANA 5 (17-23/07)
├─ [ ] Ajustes baseado em feedback
├─ [ ] Bugfix
├─ [ ] Documentação
└─ [ ] Total: 4-6h por dia

LANÇAMENTO: 25/07/2026 ✅
```

## Horas Totais

- **Semana 0:** 4h
- **Semana 1:** 40-50h (5-7h/dia × 7 dias)
- **Semana 2:** 35-45h (5-7h/dia × 6-7 dias)
- **Semana 3:** 35-45h (5-7h/dia × 7 dias)
- **Semana 4:** 30-40h (4-6h/dia × 7 dias)
- **Semana 5:** 20-30h (3-5h/dia × 5-6 dias)

**TOTAL: 164-214 horas (~5-6 semanas em full-time)**

---

## Nota SaaS por Fase

```
Antes: 3.5/10 (ERP ótimo, SaaS ruim)
├─ Fase 1-2 (Definição): Ainda 3.5/10
├─ Fase 3 (Email + LGPD): 4.0/10 ⬆️
├─ Fase 4 (Multi-tenant): 5.5/10 ⬆️ ← PRONTO PARA LANÇAR
├─ Fase 5 (Backoffice prep): 5.5/10 ✅
└─ Fase 6 (Deploy): 5.5/10 ✅ ← LANÇO

Depois (Sprints 2-5):
├─ Sprint 2 (Segurança): 6.5/10
├─ Sprint 3 (Backoffice): 7.5/10
├─ Sprint 4 (Cobranças): 7.8/10
└─ Sprint 5 (PostgreSQL): 8.0/10 ✅ PROFISSIONAL
```

---

## Próximos Passos (Hoje)

1. Ler este plano (30 min)
2. Tomar decisão: fazer agora ou depois? (5 min)
3. **Se agora:**
   - Abrir conta SendGrid (15 min)
   - Começar Fase 1 (4h)
   - Commit ao final do dia

4. **Se depois:**
   - Marcar data para começar
   - Guardar este plano

---

**Você tem um plano. Agora falta executar.**

**Comece hoje. Primeira tarefa: Fase 1, Tarefa 1.1 (adicionar tabela tenants ao schema.sql)**

