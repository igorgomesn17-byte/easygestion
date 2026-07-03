# EasyGestão — Índice de Documentação

> Documentação oficial do projeto, organizada por categoria.

---

## 📖 Documentação Principal

- **[CLAUDE.md](./CLAUDE.md)** — Documentação técnica completa (42KB, 3000+ linhas)
  - Visão geral, arquitetura, estrutura, funcionalidades, APIs, integrações
  - Database schema, fluxos de negócio, deploy
  - **Comece aqui se for trabalhar no projeto**

- **[README.md](./README.md)** — Quick start (instalar + rodar localmente)

---

## 🚀 Getting Started

### Para Desenvolvedores

1. Leia: [.docs/setup/LEIA-ME-PRIMEIRO.txt](.docs/setup/LEIA-ME-PRIMEIRO.txt)
2. Instale: [.docs/setup/COMECE.md](.docs/setup/COMECE.md)
3. Configure GitHub: [.docs/setup/GITHUB-SECRETS-SETUP.md](.docs/setup/GITHUB-SECRETS-SETUP.md)
4. Configure GitHub Actions: [.docs/setup/GITHUB_ACTIONS_SETUP.md](.docs/setup/GITHUB_ACTIONS_SETUP.md)

### Para DevOps / Deploy

1. Leia: [.docs/operacional/DEPLOY_INSTRUÇÕES.md](.docs/operacional/DEPLOY_INSTRUÇÕES.md)
2. Segurança: [.docs/operacional/SEGURANCA-PRE-DEPLOY.md](.docs/operacional/SEGURANCA-PRE-DEPLOY.md)
3. Checklist: [.docs/operacional/READINESS_DEPLOY.md](.docs/operacional/READINESS_DEPLOY.md)
4. Deploy prompt: [.docs/operacional/DEPLOY_PROMPT.md](.docs/operacional/DEPLOY_PROMPT.md)

---

## 🔗 Integrações

- **[.docs/integracao/STRIPE_CONFIG_FASE1.md](.docs/integracao/STRIPE_CONFIG_FASE1.md)** — Setup Stripe (checkout, webhook)
- **[.docs/referencia/docs-tecnica/STRIPE-SETUP.md](.docs/referencia/docs-tecnica/STRIPE-SETUP.md)** — Guia completo Stripe

---

## 📚 Referência Técnica

- **[.docs/referencia/MODELO-PRICING-FINAL-IGOR.md](.docs/referencia/MODELO-PRICING-FINAL-IGOR.md)** — Modelo de pricing (R$ 149/mês)
- **[.docs/referencia/RELATORIO-CORRECAO-MULTITENANCY.txt](.docs/referencia/RELATORIO-CORRECAO-MULTITENANCY.txt)** — Isolamento multi-tenant
- **[.docs/referencia/docs-tecnica/](.docs/referencia/docs-tecnica/)** — Documentação técnica (STRIPE-SETUP.md)

---

## 📂 Estrutura de Pastas

```
EASYGESTION/
├── CLAUDE.md                    ← 📖 DOCUMENTAÇÃO PRINCIPAL
├── README.md                    ← Quick start
├── INDEX.md                     ← VOCÊ ESTÁ AQUI
│
├── .docs/                       ← Documentação organizada
│   ├── setup/                   ← Instalação e configuração
│   │   ├── LEIA-ME-PRIMEIRO.txt
│   │   ├── COMECE.md
│   │   ├── GITHUB-SECRETS-SETUP.md
│   │   ├── GITHUB_ACTIONS_SETUP.md
│   │   └── LEIA-PRIMEIRO-INSTALADOR.txt
│   ├── operacional/             ← Deploy e operação
│   │   ├── DEPLOY_INSTRUÇÕES.md
│   │   ├── DEPLOY_PROMPT.md
│   │   ├── READINESS_DEPLOY.md
│   │   └── SEGURANCA-PRE-DEPLOY.md
│   ├── integracao/              ← Setup de serviços externos
│   │   └── STRIPE_CONFIG_FASE1.md
│   └── referencia/              ← Referência e histórico
│       ├── MODELO-PRICING-FINAL-IGOR.md
│       ├── RELATORIO-CORRECAO-MULTITENANCY.txt
│       └── docs-tecnica/        ← Documentação técnica
│           └── STRIPE-SETUP.md
│
├── .archives/                   ← Documentação obsoleta (manter)
├── .claude/                     ← Memoria do Claude (auto)
├── .github/                     ← GitHub Actions (CI/CD)
│
├── server.js                    ← Entrada principal (Express)
├── package.json                 ← Dependências
├── .env                         ← Variáveis de ambiente (NÃO commitar)
├── .env.example                 ← Template .env
│
├── routes/                      ← APIs (25 routers)
│   ├── auth.js, admin.js, vendas.js, produtos.js, estoque.js
│   ├── caixa.js, clientes.js, financeiro.js, trocas.js
│   ├── assinaturas.js, nfce.js, config.js, auditoria.js
│   └── [20+ mais]
│
├── lib/                         ← Lógica reutilizável (21 módulos)
│   ├── assinatura.js, stripe.js, email.js, crm.js
│   ├── focusNfe.js, calculos.js, backup-scheduler.js
│   └── [14+ mais]
│
├── middleware/                  ← Middlewares (4)
│   ├── seguranca.js            ← Autenticação, RBAC, rate limit
│   ├── auditoria.js            ← LGPD logging
│   └── logger-middleware.js
│
├── db/                          ← Banco SQLite
│   ├── database.js             ← Init + migrations
│   ├── schema.sql              ← DDL (39 tabelas)
│   ├── migrations.js           ← Idempotent migrations
│   ├── migrations/             ← Histórico
│   └── dsstore.db              ← SQLite binary (~2.5MB)
│
├── public/                      ← Frontend (39 páginas HTML)
│   ├── index.html              ← Dashboard
│   ├── login.html, registro.html
│   ├── pdv.html, produtos.html, estoque.html
│   ├── caixa.html, clientes.html, financeiro.html
│   ├── assinatura.html, config.html, auditoria.html
│   ├── css/ds.css              ← Design system único
│   ├── img/                    ← Logos e ícones
│   └── [28+ mais templates]
│
├── tests/                       ← Testes
│   └── golden-path.test.js
│
├── scripts/                     ← Utilitários
│   ├── backup.js
│   ├── backup-s3.js
│   └── [utilitários]
│
├── uploads/                     ← Fotos de produtos (temporário)
├── node_modules/               ← Dependências (NÃO commitar)
└── Dockerfile, docker-compose.yml  ← Containerização
```

---

## 🔑 Variáveis de Ambiente Críticas

### Obrigatórias em Produção

```env
NODE_ENV=production
ADMIN_SENHA_HASH=scrypt$...
SESSION_SECRET=xxxxx           # 32+ chars
ORIGIN=https://seu-dominio.com
TOKEN_SECRET=xxxxx             # 32+ chars
CERT_CIPHER_KEY=xxxxx          # 32+ chars
DEPLOY_TOKEN=xxxxx             # Secret deploy webhook
```

### Stripe (SaaS)

```env
STRIPE_SECRET_KEY=sk_live_...
STRIPE_PUBLISHABLE_KEY=pk_live_...
STRIPE_WEBHOOK_SECRET=whsec_live_...
STRIPE_PRICE_MENSAL=price_xxx
STRIPE_PRICE_ANUAL=price_xxx
```

### Email, Backup, Integrações

Veja **[CLAUDE.md#variáveis-de-ambiente](./CLAUDE.md#variáveis-de-ambiente)** para a lista completa.

---

## ✅ Checklist de Deploy

Antes de fazer deploy para produção:

- [ ] Ler [.docs/operacional/SEGURANCA-PRE-DEPLOY.md](.docs/operacional/SEGURANCA-PRE-DEPLOY.md)
- [ ] Ler [.docs/operacional/READINESS_DEPLOY.md](.docs/operacional/READINESS_DEPLOY.md)
- [ ] Configurar todos os secrets em `GITHUB_ACTIONS` secrets
- [ ] Testar Stripe webhook (configurar em dashboard)
- [ ] Testar backup S3 (restaurar um backup)
- [ ] Testar trial (30 dias → bloqueio)
- [ ] Testar assinatura (checkout → pagamento → webhook)
- [ ] Monitorar logs em produção (primeiros 7 dias)

---

## 🗂️ Documentação por Tipo

### 🎯 Para Entender o Projeto

1. **CLAUDE.md** — Tudo em um lugar (arquitetura, APIs, DB, fluxos)
2. **README.md** — Resumo executivo

### 🔧 Para Desenvolver

1. **CLAUDE.md#estrutura-de-pastas** — Onde cada coisa está
2. **CLAUDE.md#apis-principais** — Endpoints disponíveis
3. **CLAUDE.md#banco-de-dados** — Schema SQLite
4. **CLAUDE.md#fluxo-de-negócio** — Como o sistema funciona end-to-end

### 🚀 Para Deploy

1. **.docs/setup/** — Configuração inicial
2. **.docs/operacional/** — Deploy e operação
3. **.docs/integracao/** — Setup de serviços (Stripe, etc)

### 📚 Para Referência

1. **.docs/referencia/MODELO-PRICING-FINAL-IGOR.md** — Preço e planos
2. **.docs/referencia/RELATORIO-CORRECAO-MULTITENANCY.txt** — Isolamento de dados

---

## 📞 Suporte

- **Documentação técnica:** Veja [CLAUDE.md](./CLAUDE.md)
- **Issues/Bugs:** Consulte [.claude/projects/...](/memory/) (memory do Claude)
- **Email Igor:** igorgomesn17@gmail.com

---

**Última atualização:** 2 de julho de 2026  
**Versão:** 1.0 (completa)
