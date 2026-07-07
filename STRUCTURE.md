# 📁 Estrutura do Projeto EASYGESTION

> Mapa visual do projeto com explicação de cada pasta e arquivo principal.

---

## Raiz do Projeto

```
EASYGESTION/
├── 📄 CLAUDE.md                  ← 📖 LEIA ISTO PRIMEIRO (documentação completa)
├── 📄 README.md                  ← Quick start (5 minutos)
├── 📄 INDEX.md                   ← Índice de documentação
├── 📄 STRUCTURE.md               ← Este arquivo
│
├── 🔧 CONFIGURAÇÃO
│   ├── package.json              ← Dependências (Express, Stripe, SendGrid, AWS, etc)
│   ├── .env                      ← Variáveis de ambiente (NÃO COMMITAR)
│   ├── .env.example              ← Template .env (commitar)
│   ├── .gitignore                ← Arquivos ignorados pelo Git
│   ├── Dockerfile                ← Imagem Docker
│   └── docker-compose.yml        ← Orquestração local
│
├── 🚀 APLICAÇÃO
│   ├── server.js                 ← Entrada principal (Express app)
│   ├── package-lock.json         ← Lock de dependências
│   └── node_modules/             ← Dependências instaladas (NÃO COMMITAR)
│
├── 🔐 CHAVES
│   └── (a chave SSH NÃO fica aqui — vive em ~/.ssh/easygestion-key.pem,
│        fora da pasta do projeto, pra nunca ser sincronizada por OneDrive/nuvem)
│
├── 📚 DOCUMENTAÇÃO
│   ├── .docs/                    ← Documentação organizada (veja abaixo)
│   └── .archives/                ← Documentação obsoleta (manter por histórico)
│
├── 📋 GIT
│   ├── .git/                     ← Repositório Git
│   ├── .github/                  ← GitHub Actions (CI/CD)
│   └── .deploy-trigger           ← Arquivo de trigger (deploy)
│
├── ⚙️ SISTEMA
│   ├── lib/                      ← Lógica reutilizável (veja abaixo)
│   ├── routes/                   ← Rotas da API (veja abaixo)
│   ├── middleware/               ← Middlewares Express (veja abaixo)
│   ├── db/                       ← Banco de dados SQLite (veja abaixo)
│   │
│   ├── 🎨 FRONTEND
│   │   ├── public/               ← Arquivos servidos ao cliente
│   │   │   ├── *.html            ← 39 páginas (PDV, dashboard, etc)
│   │   │   ├── css/ds.css        ← Design system único
│   │   │   └── img/              ← Logos e ícones
│   │   └── uploads/              ← Fotos de produtos (temporário)
│   │
│   ├── 🧪 TESTES
│   │   └── tests/
│   │       └── golden-path.test.js ← Teste de fluxo completo
│   │
│   └── 🔧 SCRIPTS
│       └── scripts/
│           ├── backup.js         ← Backup local
│           └── backup-s3.js      ← Backup AWS S3
```

---

## 📚 Documentação (`.docs/`)

```
.docs/
├── setup/                        ← Para devs que estão começando
│   ├── LEIA-ME-PRIMEIRO.txt     ← Comece por aqui
│   ├── COMECE.md                ← Instalação e setup
│   ├── GITHUB-SECRETS-SETUP.md  ← Configurar secrets GitHub
│   ├── GITHUB_ACTIONS_SETUP.md  ← Configurar CI/CD
│   └── LEIA-PRIMEIRO-INSTALADOR.txt
│
├── operacional/                  ← Para deploy e operação
│   ├── DEPLOY_INSTRUÇÕES.md     ← Como fazer deploy
│   ├── DEPLOY_PROMPT.md         ← Template de deploy
│   ├── READINESS_DEPLOY.md      ← Checklist pré-produção
│   └── SEGURANCA-PRE-DEPLOY.md  ← Auditoria de segurança
│
├── integracao/                   ← Setup de serviços externos
│   └── STRIPE_CONFIG_FASE1.md   ← Setup Stripe
│
└── referencia/                   ← Referência técnica
    ├── MODELO-PRICING-FINAL-IGOR.md        ← Pricing (R$ 149/mês)
    ├── RELATORIO-CORRECAO-MULTITENANCY.txt ← Isolamento de dados
    └── docs-tecnica/
        └── STRIPE-SETUP.md      ← Guia Stripe completo
```

---

## ⚙️ Lógica (`.lib/`)

```
lib/                            ← Módulos reutilizáveis (21 arquivos)
├── 🔐 AUTENTICAÇÃO
│   └── assinatura.js           ← Status trial/pago/vencida, renovação
│
├── 💳 PAGAMENTOS
│   └── stripe.js               ← Checkout, portal, renovação Stripe
│
├── 📧 COMUNICAÇÃO
│   └── email.js                ← SendGrid, templates
│
├── 📊 NEGÓCIO
│   ├── crm.js                  ← Régua CRM, ações automáticas
│   ├── calculos.js             ← Taxa, imposto, comissão, margem
│   └── monitoring.js           ← Alertas, observabilidade
│
├── 📄 INTEGRAÇÕES
│   ├── focusNfe.js             ← Focus NFe (NFC-e)
│   └── meta.js                 ← WhatsApp + Instagram
│
├── 💾 BACKUP
│   ├── backup-scheduler.js     ← Agendador (3x/dia)
│   └── [backup-s3.js]          ← AWS S3
│
├── 🔄 AUTOMAÇÃO
│   ├── renovacao-scheduler.js  ← Renovação assinaturas
│   ├── cobranca-scheduler.js   ← Cobrança Stripe
│   └── alertas-scheduler.js    ← Detecção churn
│
├── 🛠️ UTILITÁRIOS
│   ├── logger.js               ← Pino logging
│   ├── helpers.js              ← Funções gerais
│   ├── datas.js                ← Manipulação de datas
│   └── [7+ mais]
```

---

## 🌐 Rotas (`.routes/`)

```
routes/                         ← APIs (25 routers, ~100 endpoints)
├── 🔐 AUTENTICAÇÃO
│   └── auth.js                 ← Login, signup, reset senha
│
├── 👤 ADMINISTRAÇÃO
│   ├── admin.js                ← Dashboard SaaS, clientes, planos
│   └── usuarios.js             ← Usuários (admin, vendedor, etc)
│
├── 💳 ASSINATURAS
│   └── assinaturas.js          ← Stripe checkout, portal, status
│
├── 🛍️ VENDAS
│   ├── vendas.js               ← PDV (criar, histórico)
│   ├── pagamentos.js           ← Formas de pagamento
│   └── codigoBarras.js         ← Geração e leitura
│
├── 📦 ESTOQUE
│   ├── produtos.js             ← CRUD produtos, fotos, grade
│   └── estoque.js              ← Movimentos de estoque
│
├── 🏪 CAIXA
│   └── caixa.js                ← Abertura, fechamento, movimentos
│
├── 👥 CLIENTES
│   ├── clientes.js             ← CRM de clientes
│   └── [inbox.js, crm.js]      ← Omnichannel (em dev)
│
├── 💰 FINANCEIRO
│   ├── financeiro.js           ← DRE, fluxo, conciliação
│   ├── despesas.js             ← Contas a pagar
│   └── vales.js                ← Sistema de vales
│
├── 📄 NFC-e
│   ├── nfce.js                 ← Emissão de cupom fiscal
│   └── focus-token.js          ← Config token Focus
│
├── ⚙️ CONFIGURAÇÃO
│   ├── config.js               ← Dados loja, taxas, etc
│   ├── deploy.js               ← Webhook de deploy
│   └── auditoria.js            ← Consulta logs LGPD
│
├── 🔄 TROCAS
│   └── trocas.js               ← Devoluções e trocas
│
└── 🪝 WEBHOOKS
    └── webhooks.js             ← Stripe, Meta, etc
```

---

## 🔌 Middlewares (`.middleware/`)

```
middleware/                     ← 4 middlewares principais
├── seguranca.js               ← Autenticação, RBAC, rate limit
├── auditoria.js               ← Logging LGPD (DELETE/PATCH/POST)
└── logger-middleware.js        ← Logging de requisições (Pino)
```

**Fluxo de execução:**
```
Request
  ↓
Helmet (segurança headers)
  ↓
CORS (validar origin)
  ↓
express-session (ler cookie)
  ↓
Rate limit (throttling)
  ↓
Logger middleware (log)
  ↓
Middleware de autenticação (exigirLogin)
  ↓
Middleware de tenant (injetarTenant)
  ↓
Middleware de validação (validarTenantAtivo)
  ↓
Middleware de auditoria (log de modificações)
  ↓
Rota específica
```

---

## 🗄️ Banco de Dados (`.db/`)

```
db/                            ← SQLite (DatabaseSync nativo)
├── database.js                ← Inicialização, migrations
├── schema.sql                 ← DDL (39 tabelas)
├── migrations.js              ← Funções de migração
├── migrations/                ← Histórico de migrações
└── dsstore.db                 ← Arquivo binário SQLite (~2.5MB)
    ├── dsstore.db-shm         ← Shared memory (WAL)
    └── dsstore.db-wal         ← Write-ahead log
```

**Tabelas principais (39 no total):**
- `tenants` — Clientes SaaS
- `usuarios` — Usuários com papel
- `vendas`, `venda_itens`, `venda_pagamentos` — PDV
- `produtos`, `variacoes`, `produto_fotos` — Estoque
- `clientes` — CRM
- `caixa_dia`, `caixa_movimentos` — Caixa
- `despesas` — Financeiro
- `assinaturas`, `cobracas` — Assinaturas Stripe
- `nfce` — Notas fiscais
- `conversas`, `mensagens` — Inbox
- `auditoria` — Logs LGPD
- [25+ mais]

---

## 🎨 Frontend (`.public/`)

```
public/                        ← Arquivos servidos ao cliente

📄 Páginas Principais
├── index.html                 ← Dashboard
├── login.html                 ← Tela de login
├── registro.html              ← Signup novo tenant
├── planos.html                ← Vitrine + Stripe checkout

🛍️ Módulo PDV
├── pdv.html                   ← Ponto de venda
├── cupom.html                 ← Cupom/recibo
└── historico.html             ← Histórico de vendas

📦 Módulo Estoque
├── produtos.html              ← Gerenciamento de produtos
├── estoque.html               ← Controle de estoque
├── etiquetas.html             ← Etiquetas de preço
└── codigo-barras.html         ← Códigos de barras

🏪 Módulo Caixa
├── caixa.html                 ← Operação do caixa
└── fechamento-caixa.html      ← Fechamento diário

👥 Módulo Clientes
├── clientes.html              ← Cadastro e histórico
├── inbox.html                 ← WhatsApp integrado
└── indicacoes.html            ← Referral tracking

💰 Módulo Financeiro
├── financeiro.html            ← Dashboard financeiro
├── fluxo.html                 ← Fluxo de caixa
├── fluxo-caixa.html           ← Fluxo detalhado
├── dre.html                   ← DRE mensal
└── despesas.html              ← Contas a pagar

📄 Módulo NFC-e
├── nfce.html                  ← Config e emissão

⚙️ Configuração
├── config.html                ← Dados da loja
├── assinatura.html            ← Gerenciar assinatura
├── adicionar-cartao.html      ← Stripe Customer Portal
└── auditoria.html             ← Logs LGPD

👨‍💼 Admin SaaS
├── admin.html                 ← Dashboard admin
└── admin-login.html           ← Login admin

🔑 Autenticação
├── esqueci-senha.html         ← Reset de senha
└── verificacao-email.html     ← Verificação

📁 Assets
├── css/
│   └── ds.css                 ← Design system único (verde #1a6f5e)
├── img/
│   ├── logo/                  ← Logos
│   ├── marca/                 ← Identidade visual
│   ├── comprovantes/          ← Prints de pagamento
│   └── app-icon-green-512.png
```

---

## 🧪 Testes (`.tests/`)

```
tests/
└── golden-path.test.js        ← Teste de fluxo completo
    - Signup → Login → Venda → Checkout → Webhook
```

---

## 🔧 Scripts (`.scripts/`)

```
scripts/                       ← Utilitários
├── backup.js                  ← Backup local
└── backup-s3.js               ← Upload S3
```

---

## 🔄 CI/CD (`.github/`)

```
.github/
└── workflows/
    └── deploy.yml             ← GitHub Actions
        - Testa código
        - Faz build
        - Deploy no Render
```

---

## 🔍 O que cada pasta NÃO deve ter

| Pasta | ❌ NÃO deve conter |
|-------|---|
| `lib/` | Lógica específica de rota (colocar em `routes/`) |
| `routes/` | Lógica reutilizável (colocar em `lib/`) |
| `public/` | Lógica de negócio (colocar em `lib/` + `routes/`) |
| `middleware/` | Lógica específica de rota (colocar em `routes/`) |
| `.git/` | Arquivos de build, node_modules, .env |

---

## 📊 Tamanho dos Arquivos (principais)

```
-rw-r--r--  319KB  package-lock.json   ← Dependências
-rw-r--r--   42KB  CLAUDE.md           ← Documentação completa
-rw-r--r--   19KB  server.js           ← Entrada principal
-rw-r--r--   24KB  routes/financeiro.js ← Rota maior
-rw-r--r--   22KB  db/database.js      ← Init BD
-rw-r--r--   14KB  db/migrations.js    ← Migrações
-rw-r--r--   11KB  routes/vendas.js    ← PDV
-rw-r--r--   10KB  lib/stripe.js       ← Integração Stripe
```

---

## 🎯 Por Onde Começar

### 📖 Para entender o projeto
1. Leia [README.md](README.md) (5 min)
2. Leia [CLAUDE.md](CLAUDE.md) (30 min)
3. Explore as pastas acima

### 🔧 Para desenvolver
1. Leia [.docs/setup/COMECE.md](.docs/setup/COMECE.md)
2. Rodar `npm install && npm start`
3. Abrir http://localhost:3000
4. Logar com admin / senha

### 🚀 Para fazer deploy
1. Leia [.docs/operacional/DEPLOY_INSTRUÇÕES.md](.docs/operacional/DEPLOY_INSTRUÇÕES.md)
2. Configurar secrets no GitHub
3. Fazer push para `main`
4. GitHub Actions faz o resto

---

**Última atualização:** 2 de julho de 2026  
**Versão:** 1.0
