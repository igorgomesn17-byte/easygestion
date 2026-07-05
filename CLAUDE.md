# EasyGestão (DRE Express) — Documentação Técnica Oficial

**Última atualização:** 5 de julho de 2026  
**Status:** ✅ Pronto para produção — Vitrine pública 100% funcional, personalização completa, checkout e assinatura operacionais

---

## Visão Geral

**EasyGestão** (internamente "DRE Express") é um SaaS de gestão para lojistas de moda do interior. Oferece:
- **PDV completo** (Ponto de Venda) com cálculo de taxa, imposto, comissão
- **Gestão de estoque** com grade (tamanho × quantidade)
- **Caixa diário** com conciliação manual
- **Financeiro** (DRE, fluxo de caixa, despesas)
- **Clientes** com histórico de compras
- **Assinaturas** SaaS via Stripe (modelo freemium)
- **NFC-e** (emissão de cupom fiscal, em desenvolvimento)
- **Inbox omnichannel** (WhatsApp + Instagram, parcial)
- **Vitrine pública** com personalização 100% dinâmica (logo, cores, contato, newsletter)

**Público-alvo:** Donas de lojas de varejo (feminino) com até 2-3 atendentes, faturamento R$ 10-100k/mês, interior do Brasil.

**Tecnologia:**
- **Backend:** Node.js 22+ (Express.js)
- **Banco:** SQLite (DatabaseSync nativo, Node 22+)
- **Sessão:** SQLite + express-session (HTTP-only cookies)
- **Autenticação:** scrypt + JWT + multi-tenant
- **Segurança:** Helmet, CORS restrito, rate limit, CSP
- **Email:** SendGrid
- **Pagamentos:** Stripe (assinaturas e webhook)
- **NFC-e:** Focus NFe (em desenvolvimento)
- **Backup:** AWS S3 (criptografado)
- **Logging:** Pino

**Modelo de Negócio:**
- 14 dias de trial (sem cartão)
- **Plano Mensal:** R$ 99,90/mês (subscription recorrente, pode cancelar)
- **Plano Anual:** R$ 1.078,80 (pagamento único, acesso 365 dias, sem cancelamento exceto 7 dias lei consumidor)
- Política cancelamento: acesso liberado até `data_proxima_renovacao`, depois bloqueado automaticamente
- Bloqueio automático se pagamento vence
- Cancelamento via Stripe Portal ou admin dashboard

---

## Arquitetura

```
┌─────────────────────────────────────────────────────────────┐
│  FRONTEND (public/)                                         │
│  - HTML/CSS/JS vanilla (ds.css design system)               │
│  - Sem framework (Alpine.js para interatividade mínima)     │
│  - Autenticação via session (não JWT frontend)              │
└──────────────────────┬──────────────────────────────────────┘
                       │ fetch() para /api/*
┌──────────────────────▼──────────────────────────────────────┐
│  MIDDLEWARE EXPRESS                                         │
│  - Helmet (headers segurança)                               │
│  - CORS (ORIGIN validado)                                   │
│  - express-session (SQLite store)                           │
│  - Rate limit (global + específico /login)                  │
│  - Auditoria (log de DELETE/PATCH/POST)                     │
└──────────────────────┬──────────────────────────────────────┘
                       │
┌──────────────────────▼──────────────────────────────────────┐
│  ROTAS (routes/*.js)                                        │
│  - /api/login, /api/logout, /api/me                         │
│  - /api/admin/* (dashboard admin SaaS)                      │
│  - /api/auth/* (signup, reset senha)                        │
│  - /api/vendas/* (PDV)                                      │
│  - /api/produtos/* (estoque + galeria)                      │
│  - /api/caixa/* (abertura, movimentos)                      │
│  - /api/clientes/* (cadastro, histórico)                    │
│  - /api/financeiro/* (DRE, fluxo, despesas)                 │
│  - /api/assinaturas/* (Stripe checkout, portal)             │
│  - /api/nfce/* (emissão de nota fiscal)                     │
│  - /api/webhooks/* (Stripe, Meta, etc)                      │
└──────────────────────┬──────────────────────────────────────┘
                       │
┌──────────────────────▼──────────────────────────────────────┐
│  LÓGICA (lib/*.js)                                          │
│  - assinatura.js (status trial/pago/vencida)                │
│  - stripe.js (checkout, portal, renovação)                  │
│  - email.js (SendGrid)                                      │
│  - crm.js (régua, follow-ups)                               │
│  - focusNfe.js (chamadas à API Focus)                        │
│  - calculos.js (taxa, imposto, margem)                      │
│  - alertas.js (observabilidade de churn)                    │
│  - schedulers: backup, renovação, cobrança, alertas         │
└──────────────────────┬──────────────────────────────────────┘
                       │
┌──────────────────────▼──────────────────────────────────────┐
│  BANCO DE DADOS (db/dsstore.db, SQLite)                     │
│  - Multi-tenant (tenant_id em cada tabela)                  │
│  - Migrations automáticas (ALTER TABLE idempotente)         │
│  - Índices em campos críticos                               │
│  - Foreign keys ativadas                                    │
└─────────────────────────────────────────────────────────────┘
```

---

## Estrutura de Pastas

```
EASYGESTION/
├── server.js                    # Entrada principal (Express app)
├── package.json                 # Dependências
├── .env                         # Variáveis de ambiente (NÃO comitar)
├── .env.example                 # Modelo (sempre manter atualizado)
│
├── middleware/                  # Camada de middleware
│   ├── seguranca.js            # Autenticação, autorização, rate limit
│   ├── auditoria.js            # Log de ações administrativas
│   └── logger-middleware.js      # Logging de requisições
│
├── routes/                      # Rotas da API (23 arquivos)
│   ├── auth.js                 # Login, logout, signup, reset senha
│   ├── admin.js                # Dashboard SaaS (clientes, planos, bloqueio)
│   ├── assinaturas.js          # Stripe checkout, portal, status
│   ├── vendas.js               # PDV (criar venda, itens, pagamentos)
│   ├── produtos.js             # CRUD produtos, fotos, grade
│   ├── estoque.js              # Movimentos de estoque
│   ├── caixa.js                # Abertura, fechamento, movimentos
│   ├── clientes.js             # CRUD clientes, histórico
│   ├── financeiro.js           # DRE, fluxo, despesas recorrentes
│   ├── trocas.js               # Troca/devolução de itens
│   ├── nfce.js                 # Emissão de NFC-e
│   ├── focus-token.js          # Configuração token Focus NFe
│   ├── config.js               # Configurações globais (loja, taxas)
│   ├── auditoria.js            # Consulta logs de auditoria
│   ├── deploy.js               # Webhook de deploy (git pull + restart)
│   ├── webhooks.js             # Stripe + Meta webhooks
│   └── [17 mais...]
│
├── lib/                         # Lógica reutilizável
│   ├── assinatura.js           # obterStatusAssinatura(), renovarAssinatura()
│   ├── stripe.js               # criarCheckoutSession(), criarPortalSession()
│   ├── email.js                # enviarEmail(), templates
│   ├── crm.js                  # Régua CRM, ações automáticas
│   ├── focusNfe.js             # Integração Focus NFe
│   ├── calculos.js             # Cálculo de taxa, imposto, comissão, margem
│   ├── logger.js               # Pino logger com pretty print
│   ├── helpers.js              # Funções utilitárias
│   ├── monitoring.js           # Alertas e observabilidade
│   ├── backup-scheduler.js     # Agendador de backup (3x/dia)
│   ├── renovacao-scheduler.js  # Renovação automática de assinatura
│   ├── cobranca-scheduler.js   # Tentativa de cobrança Stripe
│   ├── alertas-scheduler.js    # Detecção de churn, inatividade
│   └── [7 mais...]
│
├── db/                          # Banco de dados
│   ├── database.js             # Inicialização SQLite + migrations
│   ├── schema.sql              # DDL: CREATE TABLE IF NOT EXISTS
│   ├── migrations.js           # Funções de migração idempotente
│   ├── migrations/             # Histórico de migrações aplicadas
│   └── dsstore.db              # Banco de dados SQLite (arquivo binário)
│
├── public/                      # Frontend (HTML/CSS/JS)
│   ├── index.html              # Dashboard principal
│   ├── login.html              # Tela de login
│   ├── registro.html           # Signup (novo tenant)
│   ├── planos.html             # Vitrine de planos + Stripe checkout
│   ├── admin.html              # Admin dashboard (SaaS)
│   ├── pdv.html                # Ponto de venda
│   ├── produtos.html           # Gestão de produtos
│   ├── estoque.html            # Controle de estoque
│   ├── caixa.html              # Operação do caixa
│   ├── clientes.html           # CRM de clientes
│   ├── financeiro.html         # Dashboard financeiro
│   ├── dre.html                # DRE (Demonstração de Resultado)
│   ├── fluxo-caixa.html        # Fluxo de caixa
│   ├── assinatura.html         # Detalhes da assinatura
│   ├── config.html             # Configurações da loja
│   ├── auditoria.html          # Consulta de logs
│   ├── css/ds.css              # Design system único (migrado de Bootstrap)
│   ├── img/                    # Logo, ícones, marca
│   └── [30+ mais templates]
│
├── tests/                       # Testes
│   └── golden-path.test.js     # Teste de fluxo completo
│
├── scripts/                     # Utilitários
│   ├── backup.js               # Backup local
│   ├── backup-s3.js            # Backup S3
│   └── [utilitários]
│
├── .github/                     # CI/CD
│   └── workflows/
│       └── deploy.yml          # GitHub Actions (build + deploy Render)
│
└── docs/                        # Documentação
    ├── STRIPE-SETUP.md         # Guia de setup Stripe
    └── [outras documentações]
```

---

## Funcionalidades Implementadas

### ✅ Autenticação e Multitenancy

| Funcionalidade | Status | Arquivos |
|---|---|---|
| Login/logout com sessão HTTP-only | ✅ | routes/auth.js, middleware/seguranca.js |
| Signup com verificação de email | ✅ | routes/auth.js, lib/email.js |
| Reset de senha via email | ✅ | routes/auth.js, lib/email.js |
| Multi-tenant (isolamento de dados) | ✅ | db/database.js, middleware/seguranca.js |
| **Admin com email+senha no banco** | ✅ | routes/admin.js, db/schema.sql, db/migrations.js |
| **Admin 2FA (TOTP + backup codes)** | ✅ | routes/admin.js, lib/2fa.js, public/admin-*.html |
| Papéis (admin, vendedor, relacionamento) | ✅ | middleware/seguranca.js |
| Rate limit (brute force) | ✅ | middleware/seguranca.js, limiteAdminPassword |
| Validação de força de senha | ✅ | middleware/seguranca.js |

### ✅ PDV (Ponto de Venda)

| Funcionalidade | Status | Arquivos |
|---|---|---|
| Criar venda com múltiplos itens | ✅ | routes/vendas.js |
| Cálculo automático de taxa (Pix, débito, crédito) | ✅ | lib/calculos.js, routes/vendas.js |
| Cálculo de imposto (Simples Nacional) | ✅ | lib/calculos.js |
| Cálculo de comissão de vendedor | ✅ | lib/calculos.js |
| Cálculo de margem de lucro | ✅ | lib/calculos.js |
| Pagamento dividido (múltiplas formas) | ✅ | routes/vendas.js, routes/pagamentos.js |
| Emissão de cupom (impressão do navegador) | ✅ | routes/vendas.js |
| Histórico de vendas | ✅ | routes/vendas.js |
| Pesquisa por período, vendedor, cliente | ✅ | routes/vendas.js |

### ✅ Estoque e Produtos

| Funcionalidade | Status | Arquivos |
|---|---|---|
| Cadastro de produtos (código, nome, preço) | ✅ | routes/produtos.js |
| Grade por tamanho (P, M, G, GG, etc) | ✅ | routes/produtos.js, routes/estoque.js |
| Foto principal + galeria (até 5 fotos) | ✅ | routes/produtos.js |
| Movimentos de estoque (entrada, saída, ajuste) | ✅ | routes/estoque.js |
| Código de barras (geração e leitura) | ✅ | routes/codigoBarras.js, lib/helpers.js |
| Alertas de estoque baixo | ✅ | routes/estoque.js, lib/alertas.js |
| Coleções (linhas/lançamentos) | ✅ | routes/produtos.js |

### ✅ Caixa (Gestão de Dinheiro)

| Funcionalidade | Status | Arquivos |
|---|---|---|
| Abertura de caixa com fundo de troco | ✅ | routes/caixa.js |
| Registro de sangria (retirada de dinheiro) | ✅ | routes/caixa.js |
| Registro de suprimento (adição de dinheiro) | ✅ | routes/caixa.js |
| Fechamento com conciliação manual | ✅ | routes/caixa.js |
| Diferença (contado vs esperado) | ✅ | routes/caixa.js |
| Reconciliação com conta bancária | ✅ | routes/caixa.js |
| Relatório diário de entradas/saídas | ✅ | routes/caixa.js |

### ✅ Clientes (CRM Básico)

| Funcionalidade | Status | Arquivos |
|---|---|---|
| Cadastro de clientes | ✅ | routes/clientes.js |
| Histórico de compras (filtro por período) | ✅ | routes/clientes.js |
| Total gasto + número de compras | ✅ | routes/clientes.js |
| Origem de aquisição (Instagram, indicação, loja, etc) | ✅ | routes/clientes.js |
| Indicação (referral tracking) | ✅ | routes/clientes.js |
| Aniversário (data no formato DD/MM) | ✅ | routes/clientes.js |
| Arquivo/inativar cliente | ✅ | routes/clientes.js |
| Opt-out de mensagens (LGPD) | ✅ | routes/clientes.js |

### ✅ Financeiro

| Funcionalidade | Status | Arquivos |
|---|---|---|
| Cadastro de despesas (fixa/variável, empresa/pessoal) | ✅ | routes/financeiro.js |
| Categorias de despesa (aluguel, energia, fornecedor, etc) | ✅ | routes/financeiro.js |
| Despesas recorrentes (gerar automaticamente todo mês) | ✅ | routes/financeiro.js, lib/renovacao-scheduler.js |
| DRE mensal (receita, custo, lucro) | ✅ | routes/financeiro.js, lib/calculos.js |
| Fluxo de caixa (projeção entradas/saídas) | ✅ | routes/financeiro.js |
| Conciliação de despesas | ✅ | routes/financeiro.js |
| Filtro por período, categoria | ✅ | routes/financeiro.js |

### ✅ Trocas/Devoluções

| Funcionalidade | Status | Arquivos |
|---|---|---|
| Troca de item (devolvido + levado) | ✅ | routes/trocas.js |
| Diferença calculada automaticamente | ✅ | routes/trocas.js, lib/calculos.js |
| Pagamento/reembolso da diferença | ✅ | routes/trocas.js |
| Histórico de trocas | ✅ | routes/trocas.js |
| Impacto no custo (CMVR) | ✅ | routes/trocas.js |

### ✅ Assinaturas e Pagamentos (SaaS)

| Funcionalidade | Status | Arquivos |
|---|---|---|
| Trial de 30 dias (sem cartão) | ✅ | lib/assinatura.js, routes/auth.js |
| Integração Stripe (checkout session) | ✅ | lib/stripe.js, routes/assinaturas.js |
| Renovação automática (scheduler 3x/dia) | ✅ | lib/renovacao-scheduler.js |
| Webhook Stripe (subscription_updated, invoice.payment_succeeded) | ✅ | routes/webhooks.js |
| Bloqueio automático se pagamento vence | ✅ | middleware/seguranca.js |
| Customer Portal (alterar cartão, cancelar) | ✅ | lib/stripe.js, routes/assinaturas.js |
| Histórico de cobranças | ✅ | routes/assinaturas.js |
| Detecção de churn (alertas) | ✅ | lib/alertas.js, lib/alertas-scheduler.js |

### ✅ NFC-e (Nota Fiscal de Consumidor Eletrônica)

| Funcionalidade | Status | Arquivos |
|---|---|---|
| Configuração token Focus NFe | 🟡 | routes/focus-token.js, routes/config.js |
| Emissão de NFC-e via Focus | 🟡 | routes/nfce.js, lib/focusNfe.js |
| Rastreamento de status (processando, autorizado, erro) | 🟡 | routes/nfce.js, lib/focusNfe.js |
| Download DANFE (cupom) | 🟡 | routes/nfce.js |
| QRCode de consulta consumidor | 🟡 | routes/nfce.js |
| Suporte a múltiplos ambientes (homologação, produção) | ✅ | routes/config.js |

**Status NFC-e:** Parcialmente implementado. Configuração e emissão funcionam, mas há pendências:
- Token da Focus ainda em teste (precisa validação)
- Alguns campos extras do XML podem estar faltando

### ✅ Inbox Omnichannel

| Funcionalidade | Status | Arquivos |
|---|---|---|
| Receber mensagens WhatsApp (Meta Cloud API) | 🟡 | routes/webhooks.js, lib/email.js |
| Receber mensagens Instagram (Meta Cloud API) | 🟡 | routes/webhooks.js |
| Enviar mensagens WhatsApp | 🟡 | lib/email.js |
| Conversa organizada por cliente | 🟡 | db/schema.sql (conversas table) |
| Histórico de mensagens | 🟡 | db/schema.sql (mensagens table) |
| Kanban de estágios (novo, negociando, comprou, não levou) | 🟡 | public/inbox.html |
| Tags e follow-ups | 🟡 | db/schema.sql |

**Status Inbox:** Em desenvolvimento. Estrutura pronta, integração parcial com Meta.

### ✅ Vitrine Pública (Loja Online)

| Funcionalidade | Status | Arquivos |
|---|---|---|
| Logo personalizada (upload no backoffice) | ✅ | routes/vitrine.js, public/vitrine/index.html |
| Cor da marca dinâmica | ✅ | public/vitrine/css/vitrine.css, public/vitrine/js/vitrine.js |
| Frase de efeito (subtítulo) com fonte serif itálica | ✅ | public/vitrine/index.html |
| Botões de contato (WhatsApp, Instagram, Maps) | ✅ | public/vitrine/index.html |
| Grade de produtos com coleções | ✅ | routes/vitrine.js, public/vitrine/js/vitrine.js |
| Busca de produtos | ✅ | public/vitrine/js/vitrine.js |
| Carrinho flutuante com ícone SVG | ✅ | public/vitrine/index.html, public/vitrine/css/vitrine.css |
| Newsletter CTA ("Quer ser primeira a saber?") | ✅ | public/vitrine/index.html |
| Footer com endereço + ícones de contato SVG | ✅ | public/vitrine/index.html, public/vitrine/js/vitrine.js |
| Cache busting para logo (timestamp na URL) | ✅ | public/vitrine/js/vitrine.js |
| Acesso via slug único (ex: easygestao.com/ds-store) | ✅ | routes/vitrine.js, server.js |
| Configuração 100% pelo backoffice (/config.html) | ✅ | public/config.html, routes/config.js |

### ✅ Admin Dashboard (SaaS)

| Funcionalidade | Status | Arquivos |
|---|---|---|
| Lista de clientes (tenants) | ✅ | routes/admin.js, public/admin-dashboard.html |
| Status de cada tenant (trial, pago, bloqueado, cancelado) | ✅ | routes/admin.js |
| Bloqueio manual de tenant | ✅ | routes/admin.js |
| Upgrade/downgrade de plano | ✅ | routes/admin.js |
| Login com senha (não OAuth) | ✅ | routes/admin.js, middleware/seguranca.js |
| Histórico de cobranças por tenant | ✅ | routes/admin.js |
| Alertas de churn | ✅ | routes/admin.js, lib/alertas.js |

### ✅ Auditoria (LGPD/Compliance)

| Funcionalidade | Status | Arquivos |
|---|---|---|
| Log de DELETE de registros | ✅ | middleware/auditoria.js |
| Log de PATCH (alterações) | ✅ | middleware/auditoria.js |
| Log de POST que modifica estado global | ✅ | middleware/auditoria.js |
| Valores antes/depois (JSON) | ✅ | middleware/auditoria.js |
| IP da requisição | ✅ | middleware/auditoria.js |
| Timestamp + usuário | ✅ | middleware/auditoria.js |
| Consulta de auditoria | ✅ | routes/auditoria.js, public/auditoria.html |

### ✅ Segurança

| Funcionalidade | Status | Arquivos |
|---|---|---|
| Senhas com scrypt (não plain text) | ✅ | middleware/seguranca.js |
| Session HTTP-only, sameSite=lax | ✅ | server.js |
| CORS restrito (ORIGIN em .env) | ✅ | server.js |
| CSP (Content Security Policy) | ✅ | server.js |
| Rate limit global + específico /login | ✅ | middleware/seguranca.js, server.js |
| Rate limit de upload (100MB/dia) | ✅ | routes/produtos.js |
| Helmet (headers segurança) | ✅ | server.js |
| Token de deploy (webhook git) | ✅ | routes/deploy.js |
| Validação de força de senha | ✅ | middleware/seguranca.js |
| Bloqueio de tenant por atraso de pagamento | ✅ | middleware/seguranca.js, lib/assinatura.js |

### ✅ Backup e Disaster Recovery

| Funcionalidade | Status | Arquivos |
|---|---|---|
| Backup automático 3x/dia | ✅ | lib/backup-scheduler.js |
| Backup no AWS S3 | ✅ | lib/backup-scheduler.js |
| Criptografia AES-256-CBC | ✅ | lib/backup-scheduler.js |
| Histórico de backups | ✅ | db/schema.sql (backup_logs) |
| Remoção automática de backups antigos | 🟡 | lib/backup-scheduler.js |

---

## Banco de Dados (SQLite)

### Tabelas Principais

#### Multitenancy
- **tenants** — Clientes SaaS (email, senha, plano, status, Stripe customer ID)
- **assinaturas** — Plano ativo, data de renovação, trial/pago
- **cobracas** — Histórico de cobranças (status: pendente, pago, falha)

#### Vendas
- **vendas** — Uma linha por transação (data, cliente, total, forma pagamento, origem)
- **venda_itens** — Itens dentro da venda (produto, tamanho, qtd, preço)
- **venda_pagamentos** — Pagamento dividido (pix + crédito, por exemplo)

#### Estoque
- **produtos** — Cadastro (código, nome, categoria, preço, foto, custo)
- **variacoes** — Grade (produto_id, tamanho, quantidade)
- **produto_fotos** — Galeria (até 5 extras além da foto principal)
- **movimentos_estoque** — Log de entradas/saídas

#### Caixa
- **caixa_dia** — Resumo do dia (total pix, débito, crédito, dinheiro, lucro)
- **caixa_movimentos** — Log de abertura, sangrias, suprimentos

#### Clientes
- **clientes** — Cadastro (nome, telefone, cidade, aniversário, origem, total gasto)

#### Financeiro
- **despesas** — Contas a pagar/pagar (categoria, data competência, vencimento)

#### Trocas
- **trocas** — Troca/devolução (venda origem, valor devolvido/levado, diferença)
- **troca_itens** — Itens da troca (devolvido ou levado)

#### NFC-e
- **nfce** — Uma linha por emissão (venda_id, status, número, chave, DANFE)

#### Inbox
- **conversas** — Thread por cliente+canal (WhatsApp, Instagram)
- **mensagens** — Log append-only de mensagens
- **conversa_followups** — Lembretes agendados
- **conversa_tags** — Tags livres (ex: "interessada vestido")

#### Usuários
- **usuarios** — Login multiusuário (nome, email, senha_hash, papel, tenant_id)
- **admins** — Contas de admin do backoffice SaaS (email, nome, senha_hash, papel, totp_secret, totp_backup_codes_hash, totp_ativado)

#### Admin
- **auditoria** — Log de DELETE/PATCH/POST (quem, o quê, quando, antes/depois, IP)
- **config** — Configurações globais por tenant (taxas, dados loja, etc)
- **backup_logs** — Histórico de backups (status, arquivo S3, tempo)
- **alertas_clientes** — Observabilidade (churn, inatividade, erro integração)

#### Sessions
- **sessions** — Sessões ativas (sid, dados, expiração)

---

## APIs Principais

### Autenticação

```
POST   /api/login              Login (username + password)
POST   /api/logout             Logout (destroi session)
GET    /api/me                 Dados do usuário logado (ou 401)
POST   /api/registro           Signup novo tenant + email verify
GET    /api/verify-email?token Confirmar email (cria tenant no banco)
POST   /api/resend-verification Reenviar link de verificação
POST   /api/forgot-password    Solicitar reset de senha
POST   /api/reset-senha?token  Confirmar reset
```

### Admin SaaS (Backoffice)

```
POST   /api/admin/login        Login admin (email + senha) → sessão pendente (5 min)
POST   /api/admin/2fa-setup    Gera secret TOTP + QR code + backup codes
POST   /api/admin/2fa-confirm  Confirma setup, persiste 2FA no banco
POST   /api/admin/2fa-verify   Valida token TOTP ou backup code (logins subsequentes)
POST   /api/admin/logout       Logout admin (destroi sessão)
GET    /api/admin              Dashboard admin + lista de clientes (admin only)
GET    /api/admin/clientes     Lista de clientes (tenants) com paginação
GET    /api/admin/clientes/:id Detalhes de um cliente
PATCH  /api/admin/clientes/:id Bloquear, desbloquear, mudar plano
```

### Assinaturas

```
GET    /api/assinaturas/minha       Status da assinatura (trial/pago)
GET    /api/assinaturas/pagamentos  Histórico de cobranças
POST   /api/assinaturas/checkout    Iniciar Stripe checkout
GET    /api/assinaturas/portal      Abrir Stripe Customer Portal
GET    /api/admin/assinaturas       Listar todas (admin)
```

### Vendas (PDV)

```
POST   /api/vendas                   Criar nova venda
GET    /api/vendas                   Listar vendas (com filtro data/vendedor/cliente)
GET    /api/vendas/:id               Detalhes de uma venda
PATCH  /api/vendas/:id               Editar observação
DELETE /api/vendas/:id               Cancelar venda (auditado)
POST   /api/vendas/:id/itens         Adicionar item à venda
DELETE /api/vendas/:id/itens/:itemId Remover item
```

### Produtos

```
POST   /api/produtos                 Criar produto
GET    /api/produtos                 Listar produtos (com paginação)
GET    /api/produtos/:id             Detalhes + fotos + grade
PATCH  /api/produtos/:id             Editar produto
DELETE /api/produtos/:id             Inativar (soft delete)
POST   /api/produtos/:id/foto        Upload foto (max 5MB)
DELETE /api/produtos/:id/foto/:photoId Remover foto
POST   /api/produtos/:id/variacoes   Adicionar tamanho à grade
PATCH  /api/produtos/:id/variacoes/:varId Atualizar quantidade
GET    /api/produtos/vitrine         Vitrine pública (sem auth)
```

### Estoque

```
GET    /api/estoque                  Resumo geral (qtd, valor)
GET    /api/estoque/alertas          Produtos com estoque baixo
POST   /api/estoque/movimento        Registrar entrada/saída
GET    /api/estoque/movimentos       Histórico de movimentos
```

### Caixa

```
POST   /api/caixa/abrir              Abrir caixa (fundo de troco)
POST   /api/caixa/sangria            Registrar sangria (retirada)
POST   /api/caixa/suprimento         Registrar suprimento (adição)
POST   /api/caixa/fechar             Fechar caixa (conciliação)
GET    /api/caixa/dia/:data          Detalhes do dia
GET    /api/caixa/aberto             Caixa aberto hoje?
```

### Clientes

```
POST   /api/clientes                 Criar cliente
GET    /api/clientes                 Listar (com filtro nome/telefone)
GET    /api/clientes/:id             Detalhes + histórico
PATCH  /api/clientes/:id             Editar cliente
DELETE /api/clientes/:id             Arquivar (soft delete)
GET    /api/clientes/:id/compras     Histórico de compras
GET    /api/clientes/:id/indicacoes  Clientes indicados por este
```

### Financeiro

```
POST   /api/financeiro/despesa       Criar despesa
GET    /api/financeiro/despesas      Listar (com filtro período)
PATCH  /api/financeiro/despesa/:id   Editar/marcar como paga
DELETE /api/financeiro/despesa/:id   Remover despesa
GET    /api/financeiro/dre           DRE mensal (receita, custo, lucro)
GET    /api/financeiro/fluxo         Fluxo de caixa (projeção)
POST   /api/financeiro/recorrente    Criar despesa recorrente (modelo)
```

### Trocas

```
POST   /api/trocas                   Registrar troca (venda origem)
GET    /api/trocas                   Listar trocas
GET    /api/trocas/:id               Detalhes
DELETE /api/trocas/:id               Cancelar troca
```

### NFC-e

```
GET    /api/nfce/config              Verificar configuração
POST   /api/nfce/emitir              Emitir NFC-e (venda_id)
GET    /api/nfce/:id                 Status de uma emissão
GET    /api/nfce/:id/danfe           Baixar DANFE (PDF)
GET    /api/nfce/:id/xml             Baixar XML
```

### Auditoria

```
GET    /api/auditoria                Listar logs (com filtro ação, recurso, período)
GET    /api/auditoria/:id            Detalhes de uma ação (antes/depois)
```

### Vitrine Pública

```
GET    /api/vitrine/:slug            Dados públicos da loja (logo, cor, contato, frase)
GET    /api/vitrine/:slug/produtos   Produtos em estoque com galeria + coleções
POST   /api/webhooks/meta            Webhook para WhatsApp e Instagram (newsletter)
```

**Acesso:** `https://www.easygestao.com/{slug}/` — slug gerado automaticamente (ex: "ds-store")

### Config

```
GET    /api/config                   Configurações gerais (taxas, dados loja)
PATCH  /api/config                   Atualizar configurações
GET    /api/loja-publica             Dados públicos da loja (sem auth)
POST   /api/config/focus-token       Salvar token Focus NFe
GET    /api/config/focus-token       Buscar status token
```

### Webhooks

```
POST   /api/webhooks/stripe          Webhook do Stripe (assinatura, invoice)
POST   /api/webhooks/meta            Webhook da Meta (WhatsApp, Instagram)
POST   /api/deploy                   Webhook de deploy (git pull + restart)
```

---

## Integrações Externas

### Stripe (Pagamentos SaaS)

**Fluxo:** Cliente clica "Contratar" → `POST /api/assinaturas/checkout` → Stripe.js cria session → Frontend redireciona pra `stripe.com/checkout?session_id=xxx` → Stripe processa → Webhook `POST /api/webhooks/stripe`

**Endpoints Stripe usados:**
- `stripe.checkout.sessions.create()` — Criar session de checkout
- `stripe.billingPortal.sessions.create()` — Portal de gerenciamento
- `stripe.subscriptions.retrieve()` — Status da assinatura
- `stripe.subscriptions.cancel()` — Cancelar assinatura

**Variáveis de ambiente:**
- `STRIPE_SECRET_KEY` — Chave secreta (test/live)
- `STRIPE_PUBLISHABLE_KEY` — Chave pública
- `STRIPE_WEBHOOK_SECRET` — Assinatura do webhook
- `STRIPE_PRICE_MENSAL` — Price ID do plano mensal
- `STRIPE_PRICE_ANUAL` — Price ID do plano anual

**Webhook esperado:** evento `checkout.session.completed` → cria assinatura no banco

**Status:** ✅ Implementado e testado (test keys)

### SendGrid (Email)

**Fluxo:** Sistema precisa enviar email → `lib/email.js` monta HTML → `@sendgrid/mail.send()` → SendGrid entrega

**Emails enviados:**
- Verificação de email (signup)
- Reset de senha
- Notificação de pagamento
- Alerta de erro no backup
- Notificação de churn (opcional)

**Variáveis de ambiente:**
- `SENDGRID_API_KEY` — Chave da API
- `SITE_URL` — URL para links nos emails
- `LOJA_EMAIL` — From address (noreply@...)

**Status:** ✅ Implementado

### AWS S3 (Backup)

**Fluxo:** Scheduler 3x/dia → `lib/backup-scheduler.js` → `db.backup()` local → criptografa (opcional) → upload S3 → log em `backup_logs`

**Operações:**
- Upload automático com AWS SDK
- Nomeação: `dsstore-{data}T{hora}.db.enc`
- Retenção: últimos 30 backups (remove antigos)

**Variáveis de ambiente:**
- `AWS_S3_BUCKET` — Nome do bucket
- `AWS_REGION` — Região (ex: sa-east-1)
- `AWS_ACCESS_KEY_ID` — Credencial
- `AWS_SECRET_ACCESS_KEY` — Credencial
- `BACKUP_ENCRYPT_KEY` — Chave AES-256 (opcional)

**Status:** ✅ Implementado (a testar em produção)

### Focus NFe (NFC-e)

**Fluxo:** Usuário ativa NFC-e na config → salva token → ao criar venda, opção "Emitir NFC-e" → `lib/focusNfe.js` chama API Focus → recebe status + chave + DANFE URL

**Endpoints Focus usados:**
- `POST /nfce` — Emitir nota fiscal
- `GET /nfce/{ref}` — Consultar status

**Variáveis de ambiente:**
- `FOCUS_TOKEN_HOMOLOGACAO` — Token de teste
- `FOCUS_TOKEN_PRODUCAO` — Token de produção
- `FOCUS_URL_HOMOLOGACAO` — URL base (padrão: homologacao.focusnfe.com.br)
- `FOCUS_URL_PRODUCAO` — URL base (padrão: api.focusnfe.com.br)

**Status:** 🟡 Parcialmente implementado (emissão funciona, status/webhook em desenvolvimento)

### Meta (WhatsApp + Instagram)

**Fluxo:** Cliente envia msg WhatsApp → Meta webhook POST `/api/webhooks/meta` → `lib/email.js` salva em `mensagens` → atende + responde → Meta entrega pra cliente

**Webhooks esperados:**
- `messages` (recebimento de msg)
- `message_status` (entregue, lida, falha)

**Variáveis de ambiente:**
- `WHATSAPP_TOKEN` — Access token (system user)
- `WHATSAPP_PHONE_ID` — ID do número
- `WABA_ID` — WhatsApp Business Account
- `INSTAGRAM_TOKEN` — Access token Instagram
- `INSTAGRAM_ID` — ID da conta profissional
- `META_VERIFY_TOKEN` — Token de verificação (webhook)
- `META_APP_SECRET` — App Secret (assinatura)

**Status:** 🟡 Estrutura pronta, integração parcial (receber sim, enviar parcial)

### Google Analytics (Opcional)

**Status:** Não implementado (pode adicionar depois)

---

## Variáveis de Ambiente

### Obrigatórias em Produção

```env
NODE_ENV=production
SESSION_SECRET=xxxxx          # 32+ chars aleatório
ORIGIN=https://seu-dominio.com
TOKEN_SECRET=xxxxx            # 32+ chars (JWT)
CERT_CIPHER_KEY=xxxxx         # 32+ chars (AES)
DEPLOY_TOKEN=xxxxx            # Secret para webhook de deploy

# Admin (novo sistema — banco de dados)
# ADMIN_SENHA_HASH e ADMIN_SENHA servem apenas como seed inicial da migration 018
# Após setup, admin está permanentemente armazenado na tabela `admins`
ADMIN_SENHA_HASH=scrypt$...   # OU ADMIN_SENHA (seed inicial, depois não reutilizado)
ADMIN_EMAIL=admin@easygestao.com  # Email do admin inicial (opcional, usa fallback)
```

### Assinaturas/Stripe

```env
STRIPE_SECRET_KEY=sk_live_...
STRIPE_PUBLISHABLE_KEY=pk_live_...
STRIPE_WEBHOOK_SECRET=whsec_live_...
STRIPE_PRICE_MENSAL=price_xxx
STRIPE_PRICE_ANUAL=price_xxx
```

### Email/SendGrid

```env
SENDGRID_API_KEY=SG.xxx
SITE_URL=https://seu-dominio.com
LOJA_EMAIL=noreply@seu-dominio.com
ADMIN_EMAIL=seu-email@email.com
```

### NFC-e/Focus

```env
FOCUS_TOKEN_HOMOLOGACAO=xxx
FOCUS_TOKEN_PRODUCAO=xxx
FOCUS_URL_HOMOLOGACAO=https://homologacao.focusnfe.com.br
FOCUS_URL_PRODUCAO=https://api.focusnfe.com.br
```

### Backup/S3

```env
AWS_S3_BUCKET=seu-bucket
AWS_REGION=sa-east-1
AWS_ACCESS_KEY_ID=xxx
AWS_SECRET_ACCESS_KEY=xxx
BACKUP_ENCRYPT_KEY=xxx  # opcional
```

### Meta (WhatsApp/Instagram)

```env
WHATSAPP_TOKEN=xxx
WHATSAPP_PHONE_ID=xxx
WABA_ID=xxx
INSTAGRAM_TOKEN=xxx
INSTAGRAM_ID=xxx
META_VERIFY_TOKEN=xxx
META_APP_SECRET=xxx
```

### Diretórios

```env
DB_DIR=/data              # Onde salvar SQLite (Render = /data)
UPLOADS_DIR=/data/uploads # Onde salvar fotos de produtos
```

---

## Fluxo de Negócio

### Cadastro (Signup)

1. Usuário vai em `/registro.html`
2. Preenche: email, nome loja, nome responsável, telefone
3. Frontend `POST /api/registro` com dados
4. Backend:
   - Valida email (unique)
   - Gera tenant + senha hash scrypt
   - Envia email de verificação (link com token)
5. Usuário clica link (verifica token expira em 24h)
6. Backend cria entrada em `tenants` table
7. Usuário é logado automaticamente
8. Redireciona pra dashboard (trial ativado, 30 dias)

### Login

1. Usuário vai em `/login.html`
2. Preenche email + senha
3. Frontend `POST /api/login` com credenciais
4. Backend:
   - Busca tenant por email
   - Valida senha com `verificarSenha()`
   - Cria session HTTP-only
   - Retorna usuário + tenant_id
5. Frontend salva cookie + redireciona pra `/index.html` (dashboard)

### Venda Completa

1. Usuário vai em `/pdv.html`
2. Escaneia código de barras (ou busca produto)
3. Seleciona tamanho + qtd
4. Sistema calcula:
   - Subtotal = qtd × preço
   - Taxa = subtotal × taxa_pagamento
   - Imposto = subtotal × 7.3% (Simples)
   - Comissão = subtotal × % vendedor
   - Margem = subtotal - custo_total
5. Vendedor aplica desconto/acréscimo (opcional)
6. Seleciona forma de pagamento (Pix, débito, crédito 1x-6x)
7. Se crédito com parcelamento: calcula taxa progressiva
8. Clica "Finalizar Venda"
9. Frontend `POST /api/vendas` com itens + formas
10. Backend:
    - Valida tenant_id + items
    - Baixa estoque (variacoes.quantidade -= qtd)
    - Gera cupom (ID)
    - Salva em `vendas` + `venda_itens` + `venda_pagamentos`
    - Atualiza cliente (total_gasto, num_compras, ultima_compra)
    - Loga auditoria (POST_vendas)
    - Retorna venda com cupom
11. Frontend imprime cupom (browser print) ou salva PDF
12. Se NFC-e ativo: opção de emitir (chamará Focus)

### Fechamento Diário

1. Caixa aberto desde manhã (sangrias + suprimentos registrados)
2. Ao final do dia: `/caixa.html` → Fechar Caixa
3. Usuário conta dinheiro físico, insere valor
4. Sistema calcula:
   - Esperado = fundo_troco + suprimentos - sangrias + total_dinheiro_vendas
   - Contado = valor inserido
   - Diferença = contado - esperado
5. Clica "Fechar"
6. Backend:
   - Marca `caixa_dia.fechado = 1`
   - Gera entrada em `despesas` se diferença negativa (prejuízo)
   - Concilia com conta (se saldo_conta_inicial preenchido)
7. Caixa fechado, relatório disponível em histórico

### Assinatura (Trial → Pago)

1. **Dias 1-30:** Trial ativo, acesso 100%, nenhuma restrição
2. **Dia 31:** Trial expira
   - `middleware/seguranca.js` detecta `trial_expirado`
   - Redireciona pra `/planos.html`
3. Usuário escolhe plano (R$ 149/mês)
4. Clica "Contratar Agora"
5. Frontend:
   - Valida autenticação (`GET /api/me`)
   - Se não logado: redireciona `/login.html?redirect=/planos.html`
   - Se logado: `POST /api/assinaturas/checkout` com `tipo_plano=mensal`
6. Backend:
   - Busca tenant_id da sessão
   - Chama `lib/stripe.js criarCheckoutSession()`
   - Retorna `checkout_url` (Stripe hosted checkout)
7. Frontend redireciona pra Stripe (preenche cartão)
8. Stripe processa pagamento
9. Se sucesso: Stripe envia webhook `POST /api/webhooks/stripe`
10. Backend:
    - Cria entry em `assinaturas` (plano='mensal', data_proxima_renovacao = hoje + 30 dias)
    - Cria entry em `cobracas` (status='pago', data_pagamento=hoje)
    - Marca `tenants.status = 'pago'`
    - Marca `tenants.data_ativado = hoje`
11. Usuário redireciona pra `/index.html` (acesso restaurado)
12. **Dia 60:** Scheduler tenta renovar (webhook de `subscription_updated` de novo)
13. Se falhar: `tenants.status = 'vencida'` → bloqueado

### Renovação Automática (Scheduler)

1. Cron job 3x/dia (`lib/renovacao-scheduler.js`) procura assinaturas prestes a vencer
2. Para cada assinatura:
   - Valida se data_proxima_renovacao <= hoje
   - Chama `stripe.subscriptions.retrieve()` pra sincronizar
   - Se Stripe retorna `active` e próxima renovação maior: atualiza banco
   - Se falhar (cartão recusado): cria alerta em `alertas_clientes`
3. Webhook Stripe também notifica: `invoice.payment_succeeded` ou `invoice.payment_failed`
4. Se falha: 3 tentativas em 7 dias (configurable)
5. Se 3 falhas: marca `tenants.status = 'bloqueado'`, middleware nega acesso

---

## Deploy

### Local (Desenvolvimento)

```bash
npm install
npm start
# Acesse http://localhost:3001
```

### Produção (AWS EC2)

**⚠️ IMPORTANTE: Deploy deve ser feito MANUALMENTE via SSH. Não usar GitHub Actions automático.**

#### Servidor de Produção
- **IP:** `54.232.77.5`
- **Usuário SSH:** `ubuntu`
- **Porta:** 22 (padrão)
- **Chave SSH:** `easygestion-key.pem` (deve estar na raiz do projeto)
- **Diretório da app:** `/opt/easygestion`
- **URL pública:** `https://www.easygestao.com` (DNS aponta para EC2)
- **Porta da app:** 3001 (rodando via PM2)

#### Processo de Deploy

**Passo 1: Commit e Push no GitHub**
```bash
git add .
git commit -m "Sua mensagem"
git push origin main
```

**Passo 2: Executar Deploy via SSH**
```bash
ssh -i easygestion-key.pem -o StrictHostKeyChecking=no ubuntu@54.232.77.5 << 'DEPLOY'
cd /opt/easygestion
git fetch origin
git reset --hard origin/main
npm install --production
pm2 restart easygestion
sleep 3
pm2 logs easygestion --lines 20
DEPLOY
```

**Passo 3: Validar Status**
- Verificar logs na terminal (devem mostrar "🚀 Iniciando EasyGestão")
- Acessar `https://www.easygestao.com` no navegador
- Conferir `/health` (deve retornar status 200)

#### Troubleshooting
- **Conexão recusada:** IP pode estar errado (verificar `54.232.77.5`)
- **Erro de permissão SSH:** Validar que `easygestion-key.pem` existe e tem `chmod 600`
- **Erro de git:** Servidor pode estar sem acesso à GitHub (verificar SSH key do servidor)
- **App não sobe:** Verificar logs: `ssh -i easygestion-key.pem ubuntu@54.232.77.5 "pm2 logs easygestion"`

#### PM2 Comandos Úteis (SSH no servidor)
```bash
# Ver status
pm2 status

# Ver logs
pm2 logs easygestion

# Reiniciar
pm2 restart easygestion

# Parar
pm2 stop easygestion

# Remover
pm2 delete easygestion
```

#### Monitoramento
- **Logs de aplicação:** `pm2 logs easygestion` (SSH no servidor)
- **Health check:** `curl https://www.easygestao.com/health`
- **Alertas:** Configurados via SendGrid (ADMIN_EMAIL) e Stripe webhooks

---

## Estado Atual do Projeto

### ✅ Completo

- Autenticação multi-tenant com trial
- PDV com cálculo de taxa/imposto/comissão/margem
- Estoque com grade (tamanho × quantidade)
- Caixa com conciliação manual
- Clientes + histórico
- Financeiro básico (despesas, DRE, fluxo)
- Trocas/devoluções
- Assinaturas Stripe + webhooks
- Admin dashboard (SaaS)
- Auditoria LGPD
- Segurança (rate limit, CORS, Helmet, CSP)
- Backup automático S3
- Email (SendGrid)

### 🟡 Parcial

- NFC-e (emissão sim, status/cancelamento em desenvolvimento)
- Inbox (estrutura sim, integração Meta em desenvolvimento)
- CRM/Régua (estrutura sim, automação em desenvolvimento)

### 🔴 Não Implementado

- Mobile app (web-only por enquanto)
- Relatórios avançados (gráficos, exportação)
- Sincronização com ERPs
- Marketplace integrado
- API pública para clientes

---

## Bugs Corrigidos (3 de julho de 2026)

### ✅ Bug 1 — Parcelamento e Métodos de Pagamento
- **Problema:** Checkout anual rejeitava modo `payment` + `installments`; boleto incompatível
- **Solução:** Remover boleto, manter só cartão (Stripe nativo não oferece parcelamento em `mode:payment`)
- **Resultado:** Plano anual como subscription 12x R$89,90/mês com parcelamento automático

### ✅ Bug 2 — Página em Branco Pós-Pagamento
- **Problema:** `success_url` apontava pra `/minha-assinatura.html` (arquivo inexistente) + SITE_URL/ORIGIN apontavam pro IP direto
- **Solução:** Corrigir `/assinatura.html` + atualizar env vars pra domínio real + NODE_ENV=production
- **Resultado:** Redirect correto, CSS aplicado, dados preenchidos

### ✅ Bug 3 — Webhook TypeError (Crítico de Cobrança)
- **Problema:** Webhook lê `metadata?.plano` (errado, era `tipo_plano`), acessa `.preco_mensal` (não existe, é `.preco`), tenta mode:payment com recurring price
- **Solução:** Corrigir chaves de metadata, ramificar por `session.mode`, zerar `em_teste=0`
- **Resultado:** Pagamentos gravados corretamente, assinatura criada, não mais duplicação

### ✅ Bug 4 — Menu Lateral Faltando
- **Problema:** `/assinatura.html` não carregava `comum.js` nem chamava `montarLayout()`
- **Solução:** Adicionar script + chamada no DOMContentLoaded
- **Resultado:** Menu lateral consistente com resto do app

### ✅ Bug 5 — Botão "Contratar" em Página de Assinatura
- **Problema:** Botão "Contratar Plano" aparecia mesmo com assinatura ativa
- **Solução:** Esconder quando `status.status === 'ativa'`
- **Resultado:** Apenas "Gerenciar Pagamento" visível para clientes ativos

### ✅ Bug 6 — Política de Cancelamento
- **Problema:** Cancelamento bloqueava imediatamente (deveria permitir acesso até `data_proxima_renovacao`)
- **Solução:** Modificar `obterStatusAssinatura()` pra só bloquear quando `dataVencimento <= hoje`
- **Resultado:** Cliente continua com acesso pelos 30 dias restantes

## Dívida Técnica Restante

### ⚠️ Críticas

1. **Focus NFe token ainda em teste** — precisa migrate para produção
   - Fix: Obter token de produção da Focus quando pronto usar NFC-e em loja real

### 🟠 Importantes

2. **Rate limit de foto é "soft"** (não bloqueia, apenas loga)
   - Fix: Implementar contador por IP + bloqueio depois de X uploads/dia

3. **Criptografia de backup não é obrigatória** (BACKUP_ENCRYPT_KEY opcional)
   - Fix: Fazer obrigatória em produção

4. **Scheduler de renovação roda 3x/dia** (não é tempo real)
   - Fix: Poderia usar webhook Stripe (mais eficiente)

### 🟡 Melhorias

6. **Inbox parcial** — receber ok, enviar precisa rodar em background job
7. **CRM sem automação** — régua está pronta mas não é acionada
8. **Dashboard admin sem gráficos** — só lista textual
9. **Relatórios sem exportação** — sem CSV/PDF
10. **Sem notificação de churn** — alerta existe mas não envia email/SMS

---

## Roadmap Recomendado

### Phase 1 (1-2 semanas) — Preparar go-live

- [ ] Testar fluxo completo em produção (trial → checkout → pago)
- [ ] Configurar webhook Stripe no dashboard
- [ ] Rodar teste de carga (100 vendas/dia simultâneas)
- [ ] Backup restauração (testar restore de S3)
- [ ] Monitorar logs em produção (erro patterns)

### Phase 2 (2-4 semanas) — Validação com clientes

- [ ] Onboarding (5-10 clientes reais testando)
- [ ] Feedback loop (slack/email diário)
- [ ] Ajustes críticos (UX pain points)
- [ ] NPS measurement

### Phase 3 (4-8 semanas) — Expansão

- [ ] NFC-e produção (quando pronto)
- [ ] Inbox completo (enviar + automação)
- [ ] CRM com regra automática
- [ ] Relatórios com gráficos
- [ ] Mobile app (React Native?)

---

## Como Trabalhar com Este Projeto

### Iniciar Servidor

```bash
npm install
npm start
```

Acesse: `http://localhost:3000`

### Adicionar Nova Rota

1. Criar arquivo em `routes/minha-funcionalidade.js`:
   ```javascript
   const router = require('express').Router();
   const { db } = require('../db/database');
   
   router.get('/', (req, res) => {
     // middleware de autenticação já rodou
     // req.tenantId está injetado
     res.json({ dados: 'exemplo' });
   });
   
   module.exports = router;
   ```

2. Registrar em `server.js`:
   ```javascript
   app.use('/api/minha-funcionalidade', require('./routes/minha-funcionalidade'));
   ```

### Adicionar Nova Tabela

1. Editar `db/schema.sql` (adicionar `CREATE TABLE IF NOT EXISTS`)
2. Reexecutar `npm start` (migrations rodam automaticamente)

### Adicionar Email

1. Usar `lib/email.js`:
   ```javascript
   const { enviarEmail } = require('../lib/email');
   await enviarEmail('cliente@email.com', 'Assunto', 'template-name', { variaveis });
   ```

2. Templates ficam em `lib/email.js` (função)

### Testar Localmente

```bash
npm test
# Abre servidor + rodas golden-path.test.js
```

---

## Contato e Suporte

- **Proprietário:** Igor Desidério
- **Email:** igorgomesn17@gmail.com
- **Repositório:** GitHub (privado)
- **Issues:** Use as memory docs (prefixadas com datas)

---

---

## Últimas Mudanças (3 de julho de 2026)

**Commits recentes:**
- `b6491cc` — Fix: Permitir acesso até data_proxima_renovacao mesmo com cancelamento marcado
- `4b89fb2` — Fix: Adicionar menu lateral à página de assinatura
- `c6ae096` — Fix: Corrigir comparação de status 'ativo' → 'ativa'
- `e37d0a4` — Debug: Adicionar console.log para verificar status da assinatura
- `c1d64e1` — Fix: Voltar plano anual para mode: subscription (para parcelamento nativo funcionar)
- `c63fb75` — Fix: Deixar só cartão em ambos os planos (remover boleto)
- `c816160` — Fix: Ocultar botão 'Contratar Plano' quando assinatura já está ativa

**Verificação de produção (3 de julho de 2026):**
- ✅ Checkout mensal (R$99,90) funciona
- ✅ Checkout anual (R$1.078,80) funciona
- ✅ Pagamento em teste com cartão 4242 4242 4242 4242 confirmado
- ✅ Webhook dispara corretamente (assinatura criada no banco)
- ✅ Redirect para `/assinatura.html` com CSS e dados
- ✅ Menu lateral presente
- ✅ Botão "Contratar" oculto quando ativo
- ✅ Política cancelamento: acesso até data_proxima_renovacao

**Pronto para:** Aceitar clientes reais em produção

---

## Últimas Mudanças (5 de julho de 2026) — Vitrine Pública

### ✅ Implementação Completa da Vitrine

**Commits recentes:**
- `360ba6c` — Style: Mudar ícone da sacolinha para SVG elegante
- `c9b31d7` — Style: Aumentar mais a logo (200px de altura)
- `a4c0ad3` — Style: Fonte serif itálica no subtítulo e ícones SVG circulares no footer
- `b3a310b` — Style: Remover nome da loja do header, deixar só logo + frase
- `76cde15` — Fix: Adicionar cache busting na logo (forçar reload)
- `e25c047` — Debug: Adicionar console.log para debugar carregamento da logo
- `04bffc7` — Fix: Corrigir URL do Instagram (remover www e garantir https)
- `a5e8a3d` — Fix: Vitrine carrega cores da loja dinamicamente com !important
- `e18fccd` — Redesign: Vitrine agora com layout DS Store - botões de contato e coleções

**Funcionalidades Implementadas:**
- ✅ Logo personalizada (upload do cliente no backoffice)
- ✅ Cor da marca dinâmica (color picker)
- ✅ Frase de efeito com fonte serif itálica elegante
- ✅ Botões de contato (WhatsApp, Instagram, Google Maps) com links funcionando
- ✅ Grade de produtos com busca e filtro por coleções
- ✅ Carrinho flutuante com ícone SVG
- ✅ Newsletter CTA ("Quer ser primeira a saber das novidades?")
- ✅ Footer com endereço e ícones de contato (SVG, não emoji)
- ✅ Acesso via slug único (ex: easygestao.com/ds-store)
- ✅ Configuração 100% pelo cliente via /config.html → Seção "Loja"

**Cliente consegue configurar:**
- Logo (PNG/JPG até 2MB)
- Cor da marca
- Vitrine Frase
- WhatsApp (com DDD)
- Instagram URL
- Google Maps link
- Endereço

**Verificação em Produção:**
- ✅ Vitrine carregando em https://www.easygestao.com/ds-active
- ✅ Logo visível (200px, cache busting ativo)
- ✅ Cor marrom/bege sendo aplicada dinamicamente
- ✅ Botões de contato funcionando
- ✅ Newsletter form funcionando
- ✅ Footer com informações corretas

---

**Documento versão 1.2 — Atualizado em 5 de julho de 2026. Vitrine pública 100% funcional e personalizável.**
