# EasyGestão (DRE Express) — Documentação Técnica Oficial

**Última atualização:** 17 de julho de 2026 (Stripe em LIVE)  
**Status:** ✅ No ar em produção — **2 planos** (Starter/Growth), Enterprise congelado, **Stripe em modo LIVE (faturando)**

---

## 🎯 ESTRATÉGIA DE MONETIZAÇÃO (ATUAL - 06/07/2026)

**Decisão aprovada por Igor:** relançamento com **2 planos** (Enterprise saiu por hora — congelado no código, fora da vitrine).

| Plano | Preço/mês | Preço/ano | Público | Limite | Diferencial |
|---|---|---|---|---|---|
| **STARTER** | R$ 69,90 | R$ 699,00 | Loja começando | 1.000 produtos, 1 usuário | PDV + estoque com grade + caixa + clientes + **lançamento de despesas** + **vitrine pública** + **precificação (custo→preço)** + personalização (logo/cor) + NFC-e |
| **GROWTH** | R$ 119,90 | R$ 1.199,00 | Loja crescendo | 5.000 produtos, 5 usuários | **+ relacionamento (RFM + régua + clube de fidelidade) + DRE + fluxo + relatórios avançados** + vale-crédito + despesas recorrentes + exportação |

**Régua de corte Starter↔Growth (atualizada 17/07/2026 — o Starter faz VENDER, o Growth faz LUCRAR/RETER):**
- **No Starter (vender):** PDV, estoque, caixa, clientes, lançamento de despesas, **precificação** (custo→preço com taxa/imposto), **vitrine pública** (loja online por slug — canal de aquisição) e **personalização** (logo/cor, que a vitrine usa).
- **Sobe pro Growth (lucrar/reter):** **Relacionamento** (RFM + régua de contato + clube de fidelidade — a bandeira do plano); **DRE, fluxo de caixa e relatórios avançados** (curva ABC, por canal, por coleção, por vendedor — no Starter o lojista LANÇA despesas mas NÃO vê o resultado); vale-crédito guardado, despesas recorrentes automáticas, exportação CSV.

**Enterprise:** congelado. Existe em `lib/planos.js` (preços/limites/features + `multiplas_lojas`/`api`) mas fora de `PLANOS_PUBLICOS`. Pra religar, adicionar `'enterprise'` em `PLANOS_PUBLICOS`.

**Mudanças importantes:**
- ❌ **Inbox:** Removido completamente (não é prioridade)
- ⚠️ **NFC-e:** Opcional externo (cliente contrata com Focus, custo não é absorvido por Igor)
- ✅ **Stripe em LIVE:** produção roda com chaves `sk_live_`/`pk_live_` e Prices em modo live — o cliente paga de verdade. **O `.env` de produção mora FORA do repositório** (por segurança) e é a única fonte da verdade sobre o que está no ar. O `.env` dentro da pasta é de desenvolvimento e continua em `sk_test_` — não conclua o modo do sistema a partir dele.

**MRR esperado (100 clientes, mix 60/40):** ~R$ 89,90/cliente médio → ~R$ 8.990/mês

**Documentos de referência:**
- `RECOMENDACAO_EXECUTIVA_V2.md` — Estratégia (histórico, previa 3 planos)
- `INVENTARIO_COMPLETO_86_FUNCIONALIDADES.md` — Todas as 86 features
- **Fonte da verdade dos planos:** `lib/planos.js` (preços, limites, features) — sempre importar daqui, nunca hardcodar.

---

## Visão Geral

**EasyGestão** (internamente "DRE Express") é um SaaS de gestão para lojistas de moda do interior. Oferece:
- **PDV completo** (Ponto de Venda) com cálculo de taxa, imposto, comissão
- **Gestão de estoque** com grade (tamanho × quantidade)
- **Caixa diário** com conciliação manual
- **Financeiro** (DRE, fluxo de caixa, despesas)
- **Clientes** com histórico de compras
- **Assinaturas** SaaS via Stripe (2 planos: Starter/Growth; Enterprise congelado)
- **NFC-e** (opcional, cliente contrata com Focus)
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

**Modelo de Negócio (2 Planos ativos + Enterprise congelado):**

| Aspecto | Starter | Growth | ~~Enterprise~~ (congelado) |
|---|---|---|---|
| Preço/mês | R$ 69,90 | R$ 119,90 | ~~R$ 249,90~~ |
| Preço/ano | R$ 699,00 | R$ 1.199,00 | ~~R$ 2.249,00~~ |
| Trial | 14 dias (sem cartão) | 14 dias | — |
| Usuários | 1 | 5 | ~~Ilimitados~~ |
| Produtos | 1.000 | 5.000 | ~~Ilimitado~~ |
| Vitrine pública (loja online) | ✅ | ✅ | — |
| Precificação (custo→preço) + personalização | ✅ | ✅ | — |
| Relacionamento (RFM + régua + clube) | ❌ | ✅ | — |
| DRE + fluxo + relatórios | ❌ | ✅ | — |
| Vale-crédito | ❌ | ✅ | — |
| Despesas recorrentes / exportação | ❌ | ✅ | — |
| Múltiplas lojas / API | ❌ | ❌ | ~~✅~~ |
| Suporte | Email (72h) | Email (72h) | — |

> **Gating implementado** (atualizado 17/07/2026): as travas acima são reais no código, não só marketing. Backend: `exigirFeature('relatorios_avancados')` em `routes/financeiro.js` (DRE/fluxo/curva-abc/por-canal/por-colecao/por-vendedor); **relacionamento** via `exigirFeature('relacionamento')` no `app.use('/api/relacionamento', …)` (`server.js`); **vitrine por slug→plano em `routes/vitrine.js` (agora liberada a partir do Starter)**; **precificação** via `exigirFeature('precificacao')` em `routes/produtos.js`/`routes/config.js`; `exigirDentroDoLimite` em produtos/usuários; `exigirFeature('vale_credito'|'recorrentes'|'export')` nas respectivas rotas. Front: 403 `{upgrade:true}` tratado por `tratarBloqueioDePlano` em `comum.js`; menu e config.html escondem por feature via `me.features` (a aba Vitrine agora aparece no Starter; a de Relacionamento só no Growth).

**Política geral:**
- Trial: 14 dias sem cartão
- Renovação automática conforme ciclo (mensal/anual)
- Cancelamento: acesso até `data_proxima_renovacao`, depois bloqueado
- Bloqueio automático se pagamento vence
- Cancelamento via Stripe Portal ou admin dashboard
- NFC-e: opcional, cliente contrata com Focus (fora do EasyGestão)

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
├── routes/                      # Rotas da API (26 arquivos)
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
│   ├── financeiro.html         # Despesas / contas a pagar / conciliação
│   ├── fluxo.html              # Fluxo de caixa + DRE + GRÁFICOS (SVG inline)
│   ├── fluxo-caixa.html        # Fluxo de caixa (regime de caixa, timeline)
│   ├── assinatura.html         # Detalhes da assinatura
│   ├── config.html             # Configurações da loja + vitrine
│   ├── auditoria.html          # Consulta de logs
│   ├── admin-dashboard.html    # Backoffice SaaS (clientes, planos, cobranças)
│   ├── admin-login.html / admin-2fa*.html  # Login admin + 2FA
│   ├── landing-v2.html         # Landing pública OFICIAL (servida em / — Playfair+Poppins)
│   ├── landing.html            # Landing antiga (backup, acessível em /landing.html)
│   ├── vitrine/                # Vitrine pública por slug (index.html, css/, js/)
│   ├── css/ds.css              # Design system único
│   ├── img/                    # Logo, ícones, marca
│   └── [30+ mais templates]
│   # NOTA: dre.html NÃO existe (o DRE mora em fluxo.html); inbox.html foi deletado
│   # NOTA: / serve landing-v2.html (server.js); pdv.html usa cards de catálogo
│
├── tests/                       # Testes
│   ├── golden-path.test.js     # Teste de fluxo completo
│   ├── validadores.test.js     # Testes de validadores
│   └── cross-tenant.test.js    # Isolamento entre tenants
│
├── scripts/                     # Utilitários
│   ├── backup.js               # Backup local
│   ├── backup-s3.js            # Backup S3
│   └── [utilitários]
│
├── .github/                     # CI/CD
│   └── workflows/
│       └── deploy.yml          # EC2/PM2 (mas deploy é MANUAL via SSH — ver seção Deploy)
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
| Trial de 14 dias (sem cartão) — **começa no plano Growth** (completo) | ✅ | lib/assinatura.js, routes/auth.js |
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

### ❌ Inbox Omnichannel — REMOVIDO da vitrine (não é prioridade)

**Status:** A tela `public/inbox.html` foi **deletada** e o Inbox saiu do produto (decisão de monetização 04/07). Sobram resquícios NÃO usados no código: `lib/inbox.js` está **órfão** (não é importado por ninguém), e as tabelas `conversas`, `mensagens`, `conversa_followups`, `conversa_tags` continuam no `db/schema.sql` (inofensivas, mas mortas). Os webhooks Meta (`routes/webhooks.js`) e `lib/meta.js` existem mas o fluxo de inbox não está plugado em nenhuma UI. **Não recomendar nem construir em cima disso sem antes decidir religar o Inbox.**

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
| Upgrade/downgrade manual de plano (modal Starter/Growth + ciclo) | ✅ | routes/admin.js, public/admin-dashboard.html |
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

#### Inbox (tabelas mortas — Inbox foi removido)
- **conversas**, **mensagens**, **conversa_followups**, **conversa_tags** — ainda existem no schema mas NÃO são usadas (o Inbox saiu do produto). Não construir em cima delas sem decisão de religar o Inbox.

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
PATCH  /api/admin/clientes/:id Bloquear/desbloquear cliente (+ email)
PATCH  /api/admin/assinaturas/:id Mudar plano manualmente — body { plano, ciclo }.
                              Valida contra lib/planos.js, deriva o valor de lá, e
                              atualiza assinaturas.plano E tenants.plano na mesma
                              transação (senão os gates de feature não seguem).
                              É ajuste manual — NÃO altera o que o Stripe cobra.
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
- `STRIPE_SECRET_KEY` — Chave secreta (test/live). **Produção usa `sk_live_`.**
- `STRIPE_PUBLISHABLE_KEY` — Chave pública (`pk_live_` em produção)
- `STRIPE_WEBHOOK_SECRET` — Assinatura do webhook
- `STRIPE_PRICE_STARTER_MENSAL` / `STRIPE_PRICE_STARTER_ANUAL` — Price IDs do Starter (69,90 / 699,00)
- `STRIPE_PRICE_GROWTH_MENSAL` / `STRIPE_PRICE_GROWTH_ANUAL` — Price IDs do Growth (119,90 / 1.199,00)
- `STRIPE_PRICE_MENSAL` / `STRIPE_PRICE_ANUAL` — legado; se as vars STARTER não existirem, viram fallback do Starter (ver `lib/stripe.js:24-25`)

**Matriz de Price IDs:** `lib/stripe.js` resolve `PRICE_IDS[tier][ciclo]` via `priceIdDe(tier, ciclo)`. Enterprise tem `STRIPE_PRICE_ENTERPRISE_*` (não configurado — plano congelado).

**⚠️ Modo test vs live:** um Price criado no modo LIVE não é visível por uma chave `sk_test_` (e vice-versa). Erro típico: *"a similar object exists in live mode, but a test mode key was used"*. Chaves e Prices andam juntos — ao alternar de modo, os 4 Prices e as 3 chaves mudam no mesmo movimento. **Produção já está em live.** Se esse erro aparecer, quase sempre é ambiente de dev usando Price de live (ou o inverso), não um problema de produção.

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
STRIPE_SECRET_KEY=sk_live_...        # produção em live
STRIPE_PUBLISHABLE_KEY=pk_live_...   # produção em live
STRIPE_WEBHOOK_SECRET=whsec_...
STRIPE_PRICE_STARTER_MENSAL=price_xxx   # 69,90/mês
STRIPE_PRICE_STARTER_ANUAL=price_xxx    # 699,00/ano
STRIPE_PRICE_GROWTH_MENSAL=price_xxx    # 119,90/mês
STRIPE_PRICE_GROWTH_ANUAL=price_xxx     # 1.199,00/ano
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
8. Redireciona pra dashboard (trial ativado, 14 dias, **no plano Growth** — cliente experimenta tudo antes de escolher; `routes/auth.js` grava `plano='growth'` em tenants e assinaturas)

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

1. **Dias 1-14:** Trial ativo, acesso 100%, nenhuma restrição
2. **Dia 15:** Trial expira
   - `middleware/seguranca.js` detecta `trial_expirado`
   - Redireciona pra `/planos.html`
3. Usuário escolhe plano (Starter R$ 69,90 ou Growth R$ 119,90) e ciclo (mensal/anual)
4. Clica "Contratar"
5. Frontend:
   - Valida autenticação (`GET /api/me`)
   - Se não logado: redireciona `/login.html?redirect=/planos.html`
   - Se logado: `POST /api/assinaturas/checkout` com `{ plano, ciclo }` (o card escolhido + o toggle)
6. Backend:
   - Busca tenant_id da sessão
   - Chama `lib/stripe.js criarCheckoutSession()`
   - Retorna `checkout_url` (Stripe hosted checkout)
7. Frontend redireciona pra Stripe (preenche cartão)
8. Stripe processa pagamento
9. Se sucesso: Stripe envia webhook `POST /api/webhooks/stripe`
10. Backend (`processarWebhookStripe` em `lib/stripe.js`):
    - Grava em `assinaturas`: `plano` = TIER (starter/growth), `valor_mensal` normalizado, `data_proxima_renovacao` = hoje + 30 (mensal) ou + 365 (anual)
    - Marca `tenants.status = 'ativo'` e `tenants.plano = <tier>` (fonte que os gates leem)
11. Usuário redireciona pra `/index.html` (acesso restaurado)
12. **Próximo ciclo:** webhook `invoice.payment_succeeded` renova; scheduler 3x/dia é backup
13. Se falhar: após tentativas, `tenants.status = 'bloqueado'`

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
- **Chave SSH:** `easygestion-key.pem` (fica em `~/.ssh/easygestion-key.pem`, fora da pasta do projeto — nunca dentro de uma pasta sincronizada por OneDrive/nuvem)
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
ssh -i ~/.ssh/easygestion-key.pem -o StrictHostKeyChecking=no ubuntu@54.232.77.5 << 'DEPLOY'
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
- **Erro de permissão SSH:** Validar que `~/.ssh/easygestion-key.pem` existe e tem `chmod 600`
- **Erro de git:** Servidor pode estar sem acesso à GitHub (verificar SSH key do servidor)
- **App não sobe:** Verificar logs: `ssh -i ~/.ssh/easygestion-key.pem ubuntu@54.232.77.5 "pm2 logs easygestion"`

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
- Sincronização com ERPs
- Marketplace integrado
- API pública para clientes
- Relatórios avançados por canal/coleção/vendedor e curva ABC: os ENDPOINTS existem em `routes/financeiro.js` (gated no Growth) mas **não têm tela** que os consuma ainda

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
- **Resultado:** Cliente continua com acesso até `data_proxima_renovacao`

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
8. **Dashboard admin sem gráficos** — só lista textual (a tela `fluxo.html` do lojista já tem gráficos SVG; o backoffice admin ainda não)
9. **Exportação parcial** — CSV existe (`/api/vendas/export.csv` e o botão CSV em `fluxo.html`, ambos gated no Growth via `export`); falta PDF e exportação dos relatórios por canal/vendedor
10. **Sem notificação de churn** — alerta existe mas não envia email/SMS
11. **`lib/inbox.js` órfão + tabelas de inbox mortas** — resquício do Inbox removido; limpar quando for seguro

---

## Roadmap Recomendado

> **Nota:** o sistema JÁ está no ar em produção (www.easygestao.com) **com Stripe em LIVE** — não há bloqueio técnico pra faturar. Roadmap abaixo é o que falta pra maturidade.

### Phase 1 — Faturar de verdade

- [x] **Virar Stripe pra LIVE** (chaves `sk_live_`/`pk_live_` + Prices em modo live) — concluído
- [ ] Testar fluxo completo em produção com pagamento real (trial → checkout → pago)
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

## Últimas Mudanças (6 de julho de 2026) — Relançamento 2 Planos

**Commit:** `7b0393f` — "Planos: 2 planos (Starter 69,90 / Growth 119,90) + gates DRE/vitrine + landing nova"

**O que mudou:**
- **Preços:** Starter R$ 99,90 → **R$ 69,90** (R$ 699/ano); Growth R$ 149,90 → **R$ 119,90** (R$ 1.199/ano). Enterprise congelado (fora de `PLANOS_PUBLICOS` em `lib/planos.js`).
- **Gates novos:** DRE + fluxo + relatórios avançados e vitrine pública agora exclusivos do Growth (features `relatorios_avancados` e `vitrine_publica` em `lib/planos.js`). Aplicados em `routes/financeiro.js` (7 rotas) e `routes/vitrine.js` (por slug→plano). Despesas (lançamento) continuam no Starter.
- **Endpoint público:** `GET /api/assinaturas/planos` (registrado em `server.js` antes do `exigirLogin` + na lista `PUBLICAS` de `middleware/seguranca.js`) serve o catálogo via `planosPublicos()`.
- **Front:** `planos.html` reescrita com 2 cards que buscam preço da API e mandam `{ plano, ciclo }` no checkout; `config.html` esconde a aba Vitrine no Starter; **`landing.html` refeita do zero** (foco em explicar funcionalidades, mantém Playfair+Poppins/verde+dourado, animações de reveal).
- **Gráficos (novo):** `fluxo.html` ganhou 2 gráficos SVG inline (sem lib externa — CSP bloqueia CDN): (1) barra de composição do resultado ("cada R$100 foi pra onde") quebrando a receita em impostos/CMV/taxas/despesas/sobra com rótulo direto e paleta validada p/ daltonismo; (2) barras de "para onde foi o dinheiro" com % por categoria. Alimentados pelos dados que `/financeiro/dre` e `/financeiro/fluxo` já retornam.

**Stripe (06/07):** os 4 Prices foram criados no modo **TEST** e validados via API (batem com o código, recorrentes, brl, ativos; checkout session cria com sucesso). Servidor em `sk_test_`/`pk_test_`. **Pra faturar de verdade:** virar chaves + Prices pra LIVE.

**Verificação em produção:** health 200; `/api/assinaturas/planos` retorna os 2 planos com preços novos; landing nova servindo; `easygestion` online no PM2.

---

## Últimas Mudanças (7 de julho de 2026) — Trial no Growth + Admin conserta plano

**Commits:** `34c386d` (trial no Growth) e `552e674` (admin plano).

- **Trial começa no Growth:** `routes/auth.js` agora grava `plano='growth'` no cadastro (era `PLANO_PADRAO`/starter). Todo tenant novo experimenta o plano completo (DRE, gráficos, vitrine, relatórios) nos 14 dias de teste. Ao fim do trial, comportamento inalterado: bloqueia → tela de planos. Gates e status de trial são ortogonais (`temFeature` lê `tenants.plano`; `obterStatusAssinatura` ignora o nome do plano), então liberar features no trial não afeta o bloqueio. Tenants existentes não mudaram.
- **Admin "Alterar plano" consertado:** o botão do `admin-dashboard.html` estava com planos antigos (basico/crescimento/profissional) e preços errados, e o `PATCH /assinaturas/:id` só atualizava `assinaturas.plano` — não `tenants.plano` (que os gates leem), deixando features inconsistentes. Agora: modal com seletor Starter/Growth + ciclo, valor derivado de `lib/planos.js`, e atualiza as DUAS tabelas na mesma transação. É ajuste manual/administrativo — **não** altera o que o Stripe cobra (pra cortesia/suporte, não pra cobrança real).

---

## Auditoria doc × código (7 de julho de 2026)

Varredura pra remover o que não existe mais. Corrigido:
- **Inbox:** o topo dizia "removido" mas havia seção detalhada + tabelas ativas. `public/inbox.html` foi deletado; `lib/inbox.js` está órfão; tabelas de inbox continuam no schema mas mortas. Seção remarcada como ❌ removido.
- **`dre.html` não existe** — o DRE mora em `fluxo.html` (que também tem os gráficos). Estrutura de pastas corrigida.
- **`deploy.yml`** é EC2/PM2, não "Render". E o deploy é manual via SSH.
- **Testes:** são 3 arquivos (golden-path, validadores, cross-tenant), não 1.
- **Rotas:** 26, não 23.
- **Relatórios/gráficos/exportação** não são mais "🔴 não implementado" — gráficos no `fluxo.html` e CSV existem; o que falta é tela pros relatórios por canal/vendedor (endpoints existem).
- **2FA admin CONFIRMADO ativo** no código (login exige TOTP) — a memory que dizia "sem 2FA" é que está desatualizada.
- Resquícios de trial de 30 dias e preços antigos em bugs/roadmap ajustados.

---

## Últimas Mudanças (7 de julho de 2026 — noite) — Landing v2, PDV em cards, DRE redesenhado, 2 erros de prod corrigidos

**Commits:** `5605f4c` (landing v2) e `ef0bb90` (DRE + PDV + erros). No ar em produção.

- **Landing nova é a oficial:** `public/landing-v2.html` (redesign editorial refinado, Playfair+Poppins, verde/dourado, representações fiéis das telas em SVG/CSS, preços dinâmicos via `GET /api/assinaturas/planos` com toggle mensal/anual, faixa de confiança em marquee, hovers, reveal com fallback). `server.js` `GET /` passou a servir `landing-v2.html`; a **antiga `landing.html` virou backup** acessível em `/landing.html`. Regras de conteúdo desta landing: sem número de clientes inventado (confiança = garantias reais), sem travessão "—", sem "ERP" nem "interior" na copy.
- **PDV em cards (`public/pdv.html`):** a lista horizontal de produtos virou **grade de cards quadrados com foto** (padrão reaproveitado da vitrine, classes `.cat-card*`), e o **catálogo aparece SEMPRE ao abrir** (`carregarCatalogo('')` no load; a busca só filtra). A foto do produto foi movida pro modal de tamanho. Carrinho, pagamento e leitor de código de barras (pistola/Enter) permanecem intactos.
- **DRE redesenhado (`public/fluxo.html`):** a tela "DRE" do menu ganhou visual novo (3 cards-chave Faturamento/Custos+taxas/Resultado-com-margem, o gráfico "cada R$100" reaproveitado de `montarComposicao`, DRE detalhada + alertas). Backend e cálculos inalterados. Bug corrigido: `exportar()` tinha condição invertida que bloqueava a exportação CSV.
- **Erro Stripe "Cliente não encontrado" (corrigido):** `GET /api/assinaturas/minha` agora expõe `tem_stripe`; o botão "Gerenciar Pagamento" (`assinatura.html`) só aparece pra quem tem customer no Stripe; `GET /api/assinaturas/portal` devolve **409 + redirect** (não 500) pra quem não tem customer (via `err.code='SEM_CUSTOMER'` em `lib/stripe.js`), sem logar como erro fatal. Assinatura pode estar "ativa" (por data) sem Stripe (trial/cadastro manual) — esse caso agora é tratado.
- **Erro `SQLite parameter 2` (corrigido na raiz):** o handler central de erro (`server.js`) passou a logar **stack + método/rota** (antes só `err.message`, escondendo a origem). Isso revelou a causa: `routes/config.js` `lojaPublica` (rota pública `/api/loja-publica`) passava `req.tenantId` **undefined** ao 2º `?` da query em acesso **anônimo**. Corrigido com guard `if (!req.tenantId) return res.json({})`. Verificado em produção: zero ocorrências após o deploy. **Padrão útil:** erro genérico de bind do SQLite → instrumentar o log central com stack antes de adivinhar.

---

## Últimas Mudanças (13 de julho de 2026) — Relacionamento + Clube de fidelidade (plano `interno`)

Portados do sistema legado da DS Store (`DS STORE - OS/07-OPERACOES/DS-SISTEMA`). **O `lib/crm.js` já estava no repo, copiado num port anterior e órfão** (ninguém importava) — o trabalho foi ligar e consertar, não escrever.

### O que é

- **Régua de relacionamento** — NÃO é automação de envio. É a *lista de tarefas de contato do dia*: o sistema varre a base, olha há quantos dias cada cliente não compra, e monta uma fila de cards com a **mensagem já pronta**. O envio é um clique humano no `wa.me`. Gatilhos: dia 0 (boas-vindas + clube), 3 (satisfação), 5 (Google), 10 (indicação), 18-22 (recompra), 28-32/58-62/88-92 (reativação em 3 ondas), aniversário (e 3 dias antes), datas comerciais, lançamento.
- **Matriz RFM** — 8 segmentos (campeãs, fiéis, novas, promissoras, atenção, risco, perdidas, hibernando). Não cria tarefa; **tempera a prioridade** da régua (cliente "em risco" sobe na fila; "fiel" recente é despriorizada na reativação) e alimenta a tela de campanha por segmento.
- **Clube de selos** — cartão de carimbo digital: a cada R$ X gastos, 1 selo; N selos completam o cartão e viram um **vale-crédito de verdade** (tabela `vales`), emitido **dentro da transação da venda**. Não é pontos, não é cashback.

### Plano `interno` (novo tier)

Em `lib/planos.js`: tudo `true`, preço 0, **fora de `PLANOS_PUBLICOS`** (mesmo padrão do enterprise congelado). Não tem Price ID — `ehVendavel()` barra no checkout. É onde mora a feature `relacionamento` enquanto ela não vira produto; **pra vender, basta ligar `relacionamento: true` no growth**. Atribuível só pelo admin (`GET /api/admin/planos` → `planosAtribuiveis()`; o dropdown lia `planosPublicos()` e esconderia o interno do próprio dono).

Três lugares assumiam que todo tenant paga e precisaram de guarda: `middleware/seguranca.js` (expulsaria o dono pra `/planos.html`), `cobranca-scheduler` (bloquearia a conta), `lib/stripe.js` (checkout + webhook).

### Armadilhas que o port tinha (e o que as resolveu)

| Problema | Solução |
|---|---|
| `lib/crm.js` era single-tenant: `SELECT * FROM clientes` **sem `WHERE tenant_id`**, e `getConfig()` sem o 3º arg (que tem `tenantId = 1` de default) → uma loja veria os clientes de todas | Toda função recebe `tenantId` como 1º parâmetro **obrigatório**; `exigirTenant()` derruba se faltar. Provado por `tests/crm-tenant.test.js` |
| Sem cron, gatilho de dia exato (3, 5, 10) se **perdia pra sempre** se a tela não fosse aberta | `lib/relacionamento-scheduler.js` (06:00, **itera tenants**) materializa em `crm_acoes`. Deu snooze + histórico + badge de graça |
| Cancelar venda devolve `total_gasto` → **os selos diminuem** → controle ingênuo reemitiria o prêmio | Idempotência por **high-water mark** (`MAX(clube_ciclo)`), que nunca anda pra trás |
| Prêmio pago com o próprio vale geraria selo novo → **a loja financia a própria fidelidade** | `clientes.gasto_sem_selo` (anti-farming). O cancelamento reverte os dois campos juntos |
| **BUG PRÉ-EXISTENTE:** `setConfig` gravava sem invalidar o cache (TTL 5 min) → a lojista mudava a taxa do cartão e o PDV usava a antiga por 5 minutos, em silêncio | `setConfig` agora atualiza o cache. Vale pra **todas** as configs |

### Arquivos

- `lib/crm.js` (motor: régua + RFM + selos), `lib/crm-templates.js` (as 17 mensagens viraram **dados**, sem "DS Lover" hardcoded), `lib/clube.js` (emissão do prêmio), `lib/relacionamento-scheduler.js`, `lib/config-relacionamento.js` (defaults compartilhados migration↔signup)
- `routes/relacionamento.js` — gate `exigirFeature('relacionamento')` **no `app.use`**, não rota a rota
- Telas: `relacionamento.html` (contatos do dia), `segmentos.html`, `clube.html` (config + editor dos templates)
- Migrations **030-033** (todas em `db/migrations.js`, nunca no schema.sql)
- Testes: `npm run test:crm` (isolamento cross-tenant), `npm run test:clube` (idempotência, high-water, anti-farming, divisão por zero)

### Menu por feature

`public/js/comum.js`: itens do `NAV` carregam `feature`, e `montarLayout` esconde quem o plano não tem (`/api/me` já devolvia `me.features`). **Esconde em vez de mostrar bloqueado** — o card de upgrade leva ao checkout do Growth, que não entrega a feature. Corrigido no caminho um bug latente: a limpeza de títulos de grupo vazios olhava `nextElementSibling` esperando um `.nav-link`, mas o irmão é o container `.nav-grupo-items` — o título nunca sumia.

---

## Últimas Mudanças (14 de julho de 2026) — Motor de cupom: a régua deixa de ser cega

Os `VOLTE20`/`ANIV10` eram **só texto na mensagem** — não validavam, não descontavam e, o que mais importa, **não mediam**. "Mandei 40 mensagens" não responde se a régua funciona.

### O desenho

**Nominal, não por campanha.** A Maria recebe `VOLTE20-K3P9`; a Ana, `VOLTE20-M7X2`. Uso único. Código fixo pra todo mundo tem dois furos: **vaza** (uma cliente posta no grupo e vira desconto geral) e **não atribui** (não dá pra saber se a Maria voltou pela mensagem dela). O erro no balcão diz de quem é o código — a atendente não vira refém de discussão.

**Nasce rascunho.** Só vale quando a lojista de fato **envia** a mensagem, e a validade conta a partir dali (a mensagem diz "vale até 20/07" e a cliente leu hoje). Ignorar o contato cancela o cupom junto.

**Cupom ≠ vale.** Cupom = **desconto** (reduz o total antes do pagamento; entra em `vendas.desconto` e é distribuído nos itens — logo lucro, imposto e DRE saem certos de graça). Vale = **dinheiro** (forma de pagamento, `caixa_dia.total_vale`). Coexistem na mesma venda.

**A baixa mora na transação da venda** (`routes/vendas.js`, passo 2d), com `AND status='ativo' AND validade >= ?` no próprio UPDATE — fecha a corrida entre duas vendas simultâneas, igual ao `AND saldo >= ?` do vale.

**Cupom reduz os selos do clube, e isso é CERTO.** É o oposto do `gasto_sem_selo`: o vale do clube é dinheiro da *loja* voltando (se gerasse selo, o clube financiaria a si mesmo); o cupom é dinheiro que a loja **não recebeu**. Comprou R$400 e pagou R$320 → o faturamento dela é 320.

**Cancelar a venda devolve o cupom** (não queima) — queimar deixaria a cliente sem a peça *e* sem o benefício. É o oposto do prêmio do clube, que não volta.

**Expiração lazy, sem job.** Não existe status `'expirado'` gravado: expirado é `ativo + validade < hoje`. Um job que não roda (deploy, reboot) deixaria cupom vencido passar.

### A tela de resultados (`resultados.html`)

Responde "a régua se paga?" **sem inventar contrafactual**. Conta quem voltou *com o cupom na mão* — algumas voltariam de qualquer jeito; o cupom não prova causa, prova **contato**. A linha mais valiosa é a dos **expirados**: "mandei 40, 30 venceram" é o sinal de que a mensagem não convence, e a tela diz isso em português.

### Arquivos

`lib/cupons.js` (motor), `routes/cupons.js` (preview pro PDV — `pdvOuAdmin`, **sem** `exigirFeature`: a vendedora precisa fechar a venda), `public/resultados.html`, migration **037**. Teste: `npm run test:cupom` (49 asserts — código vazado, uso duplo, corrida, cancelamento, idempotência do scheduler).

### Armadilha que quase entrou

O scheduler roda às 06:00 **e** no catch-up de 10s do boot. Se ele emitisse o cupom e só depois descobrisse (pelo `INSERT OR IGNORE`) que a ação já existia, **cada rerun deixaria um código órfão** — e cada órfão é um desconto pendurado. A checagem vem **antes** da emissão.

---

## Últimas Mudanças (14–15 de julho de 2026) — Auditoria de isolamento multi-tenant + correções de campo

O sistema nasceu de UMA loja (a DS Store) e virou SaaS. Esta sessão varreu os pontos onde o código ainda "pensava" que só existe uma loja — a dívida que impedia ter uma segunda loja pagante com segurança. **Os quatro críticos foram fechados, todos com teste que reproduz o bug antes de provar o conserto.** Detalhes nas memórias `auditoria-multitenant-14-07`, `unique-global-legado-pre-multitenant`.

### 🔴 Segurança / isolamento (o mais importante)

- **UNIQUE global legado (pré-multi-tenant).** Tabelas antigas tinham `codigo TEXT UNIQUE` (global, entre TODAS as lojas) em vez de `UNIQUE(tenant_id, codigo)`. O `schema.sql` já estava certo, mas `CREATE TABLE IF NOT EXISTS` não altera tabela existente — produção nunca migrou. Efeito: **uma loja travava a outra** com 500 genérico (o registro que bloqueava estava na base de OUTRA loja). Foi o bug do "Erro interno ao cadastrar produto". Varrido: `produtos.codigo`/`codigo_barras` (migration **034**), `usuarios.nome` (**035**), `vales.codigo` (**036**) — todos recriados com UNIQUE composto, no molde da 034 (`foreign_keys=OFF` fora do BEGIN, id copiado explicitamente). `usuarios.email` continua único GLOBAL de propósito (o login é só email+senha, sem seletor de loja). `caixa_dia` já tinha sido fechado na 024.
- **Sequestro de senha entre lojas.** `PATCH /me/senha` e `DELETE /me/conta` buscavam o usuário logado por `nome` sem tenant — funcionava só porque `nome` era único global. Ao relaxar isso (035), a Maria da loja B trocaria a senha da Maria da loja A. Agora a sessão guarda `usuario_id` e a busca é por id. De brinde, isso preenche o `usuario_id` da auditoria LGPD, que gravava NULL. (memória `busca-de-usuario-logado-por-id`)
- **Backoffice acessível por dono de loja.** `exigirAdminBackoffice` checava `papel==='admin'` — mas TODO dono de loja tem `papel='admin'` (o admin da loja dele). Qualquer cliente logado alcançava `/api/admin/*`: mudava o próprio plano pra Growth de graça, lia a base de clientes de todas as lojas, via o MRR. Agora exige `session.admin_id` (só o login de backoffice, após 2FA, o grava). **`apenasAdmin` continua correto** onde "admin" = dono da loja (estoque/financeiro/usuários). (memória `backoffice-so-com-admin-id`)
- **Backoffice carimbava tenant 1.** Abrir `/admin` gravava `tenant_id=1` na mesma sessão do sistema → voltar pro sistema entrava na loja-fantasma vazia ("tudo sumiu"), e o admin podia até LANÇAR VENDA nela. Removido o fallback pra tenant 1 em `injetarTenant`. (memória `backoffice-carimbava-tenant-1`)
- **IDOR na troca.** `POST /api/trocas` aceitava `variacao_id` no body sem validar o dono → uma loja baixava o estoque da outra (provado: 30 peças). Corrigido com `AND tenant_id` na resolução do SKU. E 7 rotas de DELETE/UPDATE respondiam `{ok:true}` sem checar `changes` (mentiam "apagado" pra id de outra loja — o isolamento estava intacto, mas a resposta não) → agora 404. (memória `idor-trocas-estoque-alheio`)
- **Taxa e imposto vinham da loja 1.** TODA venda usava a taxa de cartão da loja 1 e imposto chumbado 7,3% (via `getConfig` sem o 3º arg → cai no tenant 1). Corrigido. (memória `taxa-e-imposto-da-loja-1`)

### 💳 Cobrança / Stripe

- **Webhook casava o pagamento com o tenant errado.** Os eventos de renovação (`invoice.payment_succeeded` etc.) liam `subscription.metadata.tenant_id`, que NUNCA era gravado (só ia pra Session e Customer). Cliente pagante era ignorado na renovação e bloqueado como inadimplente em ~31 dias. Agora `tenantDaSubscription()` casa por metadata OU por `stripe_customer_id`, e o checkout carimba `subscription_data.metadata`. Idempotência virou atômica: reserva o `event_id` ANTES de processar (o UNIQUE é o lock) — antes um retry do Stripe dava +30 dias grátis. (memória `webhook-stripe-casa-pelo-customer`)
- **Fim do trial faz o que foi desenhado.** O trial NÃO vira Starter (é design): trava o sistema e leva pra tela de planos pra escolher/pagar. Três pernas estavam quebradas: (1) o cobrança-scheduler marcava `status='bloqueado'` no trial vencido → "conta bloqueada pelo administrador" na cara, sem ver planos (trial não é inadimplência: `em_teste=1` nunca vira bloqueado); (2) `validarTenantAtivo` testava `req.path.startsWith('/api')` mas o path é relativo ao mount → nunca barrava, o trial vencido usava tudo de graça (usa `req.baseUrl+req.path`; e as rotas de SAÍDA — `/me`, `/assinaturas/*` — passam, senão prende numa tela de planos que não carrega); (3) o renovacao-scheduler não filtrava `em_teste` → cobrança fantasma de R$119,90 por um teste grátis (filtra `em_teste=0`). Bônus: `criarAlerta()` era chamado pelo scheduler mas nunca existiu em `lib/alertas.js` — toda renovação estourava depois de já cobrar. (memória `fim-do-trial-trava-e-convida`)

### ✂️ Gate do vale-crédito

- **Vale-crédito guardado virou feature do Growth de verdade.** O gate só existia numa rota desativada; `POST /trocas` (gera) e `POST /vendas` (consome) não tinham gate — Starter usava de graça. Corte: **devolver na hora é básico** (fica no Starter — a diferença a favor da cliente é resolvida em dinheiro, sem emitir vale); **vale guardado sobe pro Growth**. Gate em 3 pontos (trocas/vendas/vales), não num `app.use`. (memória `gate-vale-credito-so-growth`)

### 🐛 Correções de campo (bugs que o Igor viu usando)

- **Crédito parcelado: clicar em Finalizar não fazia NADA.** `finalizar()` usava `LIMITE_LOJA_ABSORVE`, variável que nunca existiu (a real é `limiteAbsorve`). `ReferenceError` matava a função em silêncio — sem toast, sem spinner. Só o parcelado passava por essa linha. (memória `erro-de-js-mata-o-clique-em-silencio`)
- **Foto do iPhone (HEIC) não subia + abria a câmera.** O input tinha `capture="environment"` (forçava câmera; removido). E HEIC não é decodificado pelo navegador → a conversão no canvas travava em silêncio. Agora o front manda o HEIC cru e o SERVIDOR converte pra JPEG (`heic-convert`, JS puro, em `routes/produtos.js`, antes da transação). Descartado converter no navegador: exigiria `unsafe-eval` no CSP. (memória `foto-do-iphone-heic-e-camera`)
- **Texto sumia no "tema escuro".** Não há tema escuro no projeto — era o dark automático do navegador escurecendo fundos claros sem ajustar os textos. `color-scheme: light` no `:root` do `ds.css` (vale pras 43 telas) desliga o dark forçado. (memória `tema-escuro-e-cupom-imagem`)
- **Cupom no WhatsApp vai como IMAGEM.** O botão em `cupom.html` mandava um resumo em texto; agora "fotografa" o recibo com `html2canvas` (servido local, sob demanda) e usa `navigator.share` no celular pra mandar a imagem direto. `wa.me` só aceita texto — não dá pra anexar num clique. (memória `tema-escuro-e-cupom-imagem`)

### 🤝 Programa de fidelidade (antes "Clube de selos")

- Renomeado pra **"Programa de fidelidade"** (título) / **"Fidelidade"** (menu). As mensagens da régua continuam editáveis DENTRO dessa tela ("As mensagens que você manda").
- Nova seção **"Quem está no cartão"**: lista de clientes com quantos selos cada um tem, ordenada por quem falta menos pro prêmio, com barrinha de progresso, busca e botão **"Chamar no WhatsApp"** (mensagem pronta com nome + selos). Rota `GET /api/relacionamento/clube/clientes` (selos DERIVADOS do gasto via `selosDe`; só entra quem tem ≥1 selo). Gated no plano `interno` como o resto do relacionamento. (memória `relacionamento-e-clube-no-plano-interno`)

### 🟠 Ainda aberto (não crítico)

- **Chave AWS vazada (23/06) ainda ativa no S3** — rotação nunca concluída. É o item de segurança nº1 pendente. (memória `chave-aws-vazada-ainda-ativa-2026-07-07`)
- Rotacionar a `sk_live` do Stripe que passou pelo chat. 4 rotas `/admin/assinaturas` mortas em `assinaturas.js` (já atrás do guard). `DELETE /me/conta` usa `session.tenantId` (camelCase) inexistente → deleção LGPD falha em silêncio. Varredura de IDOR de LEITURA (GET) não foi 100% concluída.

---

## Últimas Mudanças (17 de julho de 2026) — Régua nova: vitrine desce pro Starter, relacionamento vira Growth

**Commit:** `e991431` — no ar em produção (health 200; migration 039 rodou; 379 vendas preservadas).

**Princípio novo:** o Starter faz a loja **vender**; o Growth faz a loja **lucrar e reter cliente**. O R$ 50 de diferença deixa de ser "relatório bonito" e passa a ser "cliente voltando".

- **Fonte da verdade `lib/planos.js`** (front e endpoint seguem sozinhos — só virei os booleanos):
  - Starter ganhou `vitrine_publica`, `personalizacao` (logo+cor) e `precificacao` = `true`. Vitrine = página indexável apontando pro domínio → **canal de aquisição**. Personalização desceu JUNTO senão a vitrine do Starter sairia sem logo/cor. Precificação (custo→preço) é operação básica de vender.
  - Growth ganhou `relacionamento: true` — a **bandeira** do plano (RFM + régua de contato + clube de fidelidade). Antes só existia no `interno`. O comentário do bloco `interno` foi ajustado: agora só `maquininha_integrada` é exclusiva dele.
  - **DRE/fluxo/relatórios (`relatorios_avancados`) continuam no Growth** — não mexidos.
- **Sem migração de dados:** descer feature só CONCEDE acesso (não quebra Starter existente); subir relacionamento não afeta ninguém (era `false` nos dois públicos). Puramente aditivo.
- **Gates de back não precisaram de mudança de código** (já liam as feature flags): `routes/vitrine.js`, `routes/produtos.js` (precificacao), `routes/config.js`, `server.js:376` (relacionamento). Só atualizei comentários. `GET /api/assinaturas/planos` reflete a régua automaticamente (só devolve `planosPublicos()`).
- **Copy hardcoded ajustada** (marketing, não source of truth): `public/planos.html` (mapa `RECURSOS`) e `public/landing-v2.html` — vitrine agora aparece como Starter, relacionamento como Growth vendendo o **mecanismo** ("o sistema diz quem sumiu e escreve a mensagem, você só clica"), NÃO número inventado.

**Outras 3 mudanças no mesmo deploy:**
- **`public/clube.html` — lista "Quem está no cartão" recolhida por padrão.** A lista de clientes por selos crescia e empurrava o editor de mensagens pra baixo. Virou um `<details>` fechado (sem `open`) com contador no `<summary>` ("· 12 clientes"). As mensagens ficam alcançáveis sem rolar.
- **`public/cupom.html` — selos voltaram ao cupom não fiscal.** O bloco existia mas nunca pintava por um triplo descasamento: chamava `GET /crm/selos/:id` (**rota fantasma** — não existe `/api/crm/*`); a real é `GET /api/relacionamento/clube/cliente/:id` e devolve **snake_case** (`selos_no_cartao`/`total_selos`), não o camelCase que o cupom lia; e o gate `relacionamento` (agora Growth) faz o Starter cair no `catch` silencioso — degrada bem. Conserto 100% no front. (memória `cupom-selos-apontava-rota-fantasma`)
- **Ficha da cliente ganhou Instagram + Observações.** `routes/clientes.js` (POST/PUT lê e grava `instagram`, `observacoes`), modal em `public/clientes.html` (campo @ + textarea), **migration 039** (`db/migrations.js`, ALTER idempotente). GET (list e detail) já eram `SELECT *`, então os campos fluem sozinhos pro front.

Ver memórias `regua-planos-vitrine-starter-relacionamento-growth` e `cupom-selos-apontava-rota-fantasma`.

---

## Últimas Mudanças (17 de julho de 2026 — noite) — Régua: comprou sai da fila, reativação não multiplica

**Commit:** `914dd1b` — no ar. Dois bugs que o Igor viu usando a tela de Contatos do dia.

A régua **materializa** as ações em `crm_acoes` e as **congela** (mensagem, "X dias sem comprar" e motivo nascem no dia da geração). Isso conserta o gatilho de dia exato se perder, mas cria dívida de reconciliação: nada olhava a linha parada depois que o mundo mudou.

- **Comprou e não saiu da fila.** A cliente comprava e a ação "sentimos sua falta, 28 dias sem comprar" continuava `pendente`, falando de uma ausência que a compra encerrou (`routes/vendas.js` não tocava `crm_acoes`). → `obsoletarAcoesDeAusencia()` em `lib/crm.js`, chamada **na transação da venda**; marca `status='obsoleta'` (não apaga — histórico auditável, e é distinto de 'enviada'/'ignorada': ninguém contatou, a compra resolveu).
- **Mesmo cliente repetido várias vezes.** O UNIQUE é `(tenant_id, data, cliente_id, tipo)` — inclui a **data**. Como os gatilhos de ausência têm **janela larga** (REAT_1 = 28..32 dias), o gerador criava UMA linha por dia dentro da janela pro mesmo cliente. Em produção havia clientes com 3 cópias. → guarda `existeAcaoAtiva()` em `lib/relacionamento-scheduler.js`: não materializa se já há pendente/adiada do mesmo tipo em QUALQUER data (e apaga o cupom órfão da rodada).
- **Só os tipos de AUSÊNCIA** entram nas duas regras (`TIPOS_DE_AUSENCIA`: RECOMPRA, REAT_1/2/3, SELOS_PARADOS). Aniversário e pós-venda **não** — uma compra não invalida "parabéns pelo aniversário".
- **Limpeza one-off em produção:** 58 → 35 ações pendentes (2 da cliente que já havia comprado + 29 duplicatas obsoletadas). Zero duplicatas restantes.
- **Teste de regressão:** `npm run test:regua` (`tests/regua-reconciliacao.test.js`) reproduz os dois bugs e trava. `test:crm` e `test:cupom` seguem verdes.

Ver memória `regua-materializada-precisa-reconciliar`.

---

## Últimas Mudanças (18 de julho de 2026) — Cliente na venda: o gargalo real do CRM

**Commit:** `35536c0`. Migration **040** rodou em produção (388 vendas preservadas).

Fui avaliar "régua por comportamento" (diferenciar por *o que* a cliente compra) e o diagnóstico apontou um gargalo mais básico: **70% das vendas saíam sem cliente** (387 vendas, 117 vinculadas). Venda sem cliente some do CRM inteiro — não entra na régua, não junta selo, não vira recompra. **Régua sofisticada sobre 30% da base rende menos que régua simples sobre 100%.**

- **PDV pergunta ao finalizar** (`public/pdv.html`): sem cliente selecionado, aparece "Quem está comprando?" com duas saídas de 1 clique — *Escolher a cliente* (leva ao campo de busca) ou *Vender sem identificar*. **Não trava a venda:** a causa é esquecimento na correria (loja cheia, um vendedor só), e travar o balcão no sábado criaria problema pior. Pra esquecimento, o que funciona é tornar o caminho certo mais rápido que o errado.
- **`clientes.tipo` (migration 040)** — nem todo registro em `clientes` é pessoa a contatar. Cada tipo sai de um lugar **diferente**:
  | tipo | Régua | RFM | Por quê |
  |---|---|---|---|
  | `'balcao'` | ❌ | ❌ | Acumula as vendas de toda a loja; no RFM viraria "campeã" fantasma e distorceria os segmentos |
  | `'importado'` | ❌ | ✅ fica | Valor real orienta a campanha, mas `ultima_compra` é do sistema antigo — a régua diria "28 dias" pra quem sumiu há um ano |
  | `NULL` | ✅ | ✅ | Cliente normal |
- **"Consumidor não identificado"** (`clienteBalcao()` em `lib/crm.js`, `POST /api/clientes/balcao`): um por loja, nasce sob demanda, sem telefone. Preserva a distinção entre "esqueci" (recuperável) e "ela não quis" — que antes viravam o mesmo `NULL`.
- **Camacan fora da fila diária:** backfill **condicional** (`origem LIKE '%Camacan%'` **E** sem venda real). As 3 clientes de Camacan que já voltaram a comprar seguem normais e na régua. 1.116 marcadas; a régua passou a varrer 112 pessoas em vez de 1.228, e o RFM segue com 1.222.
- **Vínculo retroativo:** `PATCH /api/vendas/:id/cliente` + botão "+ Vincular cliente" no histórico. Ajusta os totais das duas pontas (tira da antiga, soma na nova) e obsoleta as ações de ausência. **Não** mexe em estoque, caixa nem cupom — o dinheiro já entrou e continua igual.
- **Teste:** `npm run test:balcao` (13 asserts; o crítico é o balcão com 300 compras e 30 dias parado gerando ZERO ações e ficando fora do RFM). `test:crm`, `test:regua`, `test:cupom`, `test:clube` seguem verdes.

**Adiado com razão:** régua por comportamento. A base não sustenta hoje — 33 itens de venda no sistema, categorias inconsistentes (`calça`/`calca`), e 11 intervalos de recompra medidos (mediana 3 dias, que são vendas de teste). Revisitar quando o vínculo de cliente tiver gerado histórico real. **Próximo da fila:** RFM modular a mensagem e o desconto (hoje só muda a ordem da fila), que funciona com o dado que já existe.

Ver memória `nem-todo-cliente-e-pessoa-a-contatar`.

### RFM tempera a régua (commit `82e003e`)

**A régua decide QUANDO falar; o RFM passa a decidir COMO falar e QUANTO oferecer.** Antes, a campeã que gastou R$ 3.000 e sumiu recebia exatamente a mesma mensagem e o mesmo desconto da cliente de uma compra de R$ 49 — e perder uma dessas custa muito mais que a outra. O RFM só mexia na ORDEM da fila (3 linhas de prioridade).

- **`VARIANTES_SEGMENTO`** (`lib/crm-templates.js`): variantes de texto por `${tipo}:${segmento}`. **Propositalmente esparso** — variante pra todo (tipo × segmento) seriam 40 textos dizendo quase a mesma coisa. Só existe onde o tom muda de verdade (campeã/risco/fiel na reativação). Sem variante, cai no texto padrão.
- **Precedência do texto:** template que a **LOJISTA editou** > variante do segmento > padrão do tipo. `templateDe()` marca `__editado` quando ela escreveu o texto. Trocar o que ela escreveu seria o pior tipo de "inteligência": ela edita, salva, e o sistema manda outra coisa.
- **`MULT_SEGMENTO`** — desconto modulado (decisão do Igor: mais pra quem vale mais). campeas/risco 1.25×, perdidas 1.15×, hibernando 0.75×. Racional de **margem**: vale pagar mais caro pra trazer a campeã; queimar 25% com quem gasta R$ 50 destrói margem sem resultado.
- **Duas guardas:** `0% continua 0%` (gatilho sem cupom NÃO ganha cupom por causa do segmento) e **teto próprio de 35%** (`PCT_TETO_REGUA`), abaixo do `MAX_PCT` global de 50.
- **O pct modulado vale nos DOIS lados:** o cupom é emitido com ele **e** a mensagem diz o mesmo número. Senão a mensagem promete 20% e o caixa aceita 25% (ou o contrário) — o teste trava isso.
- **Card mostra o valor da cliente** ("R$ 2.400 em 11 compras") antes de enviar: é o que justifica o desconto maior e muda o cuidado da conversa.
- **Teste:** `npm run test:segmento` (19 asserts).

> **Nota de rollout:** ações já materializadas em `crm_acoes` carregam o texto/pct antigos (a régua congela no momento da geração). A modulação vale para as ações geradas a partir da próxima rodada das 06:00.

---

## Últimas Mudanças (18 de julho de 2026 — tarde) — Reativação da base importada + 2 bugs de campo

### Reativação da base importada (commit `c2eae1c`, migration **041**)

A base migrada de outro sistema (`clientes.tipo='importado'`) saiu da régua diária na 040, mas ficou sem ferramenta. Esta é ela: **campanha, não régua** — tem começo e fim, e ataca por **ondas de valor** (o dinheiro é concentrado: na DS, 15% dos clientes = 50% do faturamento histórico).

- **Feature `base_importada` — SÓ no plano `interno`.** Decisão do Igor, explícita: *"isso é só no perfil da DS, pra depois você não fazer para todo o sistema"*. Uma lojista Growth ganharia uma aba sem sentido pra loja dela. A tela e as mensagens são **genéricas** (nunca citam a cidade ou a loja da campanha) — virar produto é só ligar a feature no growth, sem texto pra reescrever. Há teste que falha se "Camacan" aparecer no código.
- **`routes/reativacao.js`** (mount com `exigirFeature('base_importada')`): ondas por faixa de gasto, lista ordenada por valor, mensagem de **reencontro** pronta, cupom **nominal** por cliente (nasce `'ativo'` — aqui o envio É o clique, não há passo posterior).
- **Migration 041 `reativacao_contatos`** com `UNIQUE(tenant_id, cliente_id)`. Tabela **separada de `crm_acoes` de propósito**: misturar poluiria a fila diária que a 040 acabou de limpar. Registra também `respondeu` — a taxa de resposta é o número que decide se a campanha continua.
- **Tela `public/reativacao.html`** + item no menu gated por feature.
- Teste: `npm run test:reativacao` (22 asserts — gate, base certa, idempotência, cupom nominal, isolamento).

### Dois bugs de campo (commit `dea0793`)

- **Venda cancelada contava no faturamento.** Cancelar faz soft delete (`deletado=1`) e recalcula o caixa — mas o recálculo somava TODAS as vendas do dia, inclusive as canceladas. O mesmo furo estava em **9 queries** (caixa, DRE, fluxo, dashboard, por-canal, por-vendedor, conciliação, comissão, histórico da cliente). Na DS: caixa mostrando R$ 1.369,50 quando o real era R$ 899,60. **Corrigir o código não conserta o passado** — precisou recalcular os dias afetados reusando a própria `atualizarCaixaDia`. Teste: `npm run test:cancelada`.
- **Cliente contatada voltava pra fila no dia seguinte.** `existeAcaoAtiva` só via `'pendente'`/`'adiada'`; ao enviar a ação vira `'enviada'`, e às 06:00 o scheduler recriava tudo. Agora `enviada`/`ignorada` **silenciam o gatilho por 45 dias** (`DIAS_SILENCIO`). `'obsoleta'` não silencia: ela comprou, o ciclo reiniciou.

### PDV: peça esgotada sai do catálogo (commit `ed26100`)

No balcão cheio, card de peça que não dá pra vender é ruído. O catálogo mostra só quem tem estoque — **exceto na busca**: se a vendedora digitou o nome ou bipou o código, a esgotada aparece (sumir faria parecer que saiu do sistema).

---

## Últimas Mudanças (26 de julho de 2026) — A vitrine virou site (SSR, página por peça, pedido gravado)

**Commits:** `b2e8e42` (fundação), `3cf937d` (SSR + PDP), `49ba65e` (pedidos + pixel + filtros). **Não deployado ainda.**

### O bug que valia mais que o resto somado

As meta tags de Open Graph eram injetadas por JavaScript (`atualizarMetaTags` em `vitrine.js`). **Crawler não executa JS** — nem o do WhatsApp, nem o do Google. Na prática, **todo link de loja compartilhado saía sem preview**: sem foto, sem nome, sem preço. Ninguém notava porque no navegador funcionava. A função foi deletada; o `<head>` agora sai montado do servidor.

**Regra que fica:** o que precisa ser visto por crawler (OG, JSON-LD, título, conteúdo indexável) tem que sair **pronto do servidor**. Abrir no navegador não prova nada — use `curl` e o Sharing Debugger do Facebook.

### Feature `vitrine_site` — só no plano `interno`

Em `lib/planos.js`: `true` **apenas no `interno`**, `false` em starter/growth/enterprise. Mesmo caminho da `base_importada` — a DS Store é cliente-zero. **Pra virar produto: ligar `vitrine_site: true` no growth.** Uma linha; a lib nasce genérica (há teste que falha se nome de loja aparecer no código).

`vitrine_publica` **não mudou** (continua `true` em todos): é o direito de *ter loja online*. `vitrine_site` é o direito de ter um *site*. Quem não tem recebe a **mesma página de sempre**, só com o `<head>` preenchido — o caminho de quem paga não foi reescrito, e é por isso que o risco é baixo. Rotas exclusivas dão **404, nunca 403** (403 revelaria que a loja existe num plano inferior).

### O que entrou

| | Arquivo |
|---|---|
| Motor de SSR (escape, jsonSeguro, corHexSegura, render) | `lib/vitrine-render.js` |
| Gate único + allowlist + urlFoto/urlAbsoluta + catálogo | `lib/vitrine-publica.js` |
| Blocos de HTML (head/OG/JSON-LD, card, pixel) | `lib/vitrine-html.js` |
| Pedidos e leads (código `#A7K2`) | `lib/vitrine-pedidos.js` |
| Páginas públicas (home, PDP, sitemap, robots) | `routes/vitrine-ssr.js` |
| Tela da lojista | `routes/vitrine-pedidos.js`, `public/pedidos.html` |
| Migrations **042-044** | pedidos+itens, leads, campos de PDP |

**URL da peça: `/:loja/p/:nome-slug-:id`** — o **ID no fim é quem resolve**; o slug é decorativo. Renomear a peça não quebra o link que circula no zap (301 pro canônico). Sem coluna `slug` de produto de propósito.

### Decisões que não são óbvias (e o porquê)

- **Caminho de foto normalizado na SAÍDA, nunca no banco.** `produtos.foto` é `img/produtos/x` (sem barra) e só funciona por *acidente* em URL de 1 segmento — quebraria 100% das fotos na PDP. Mexer na coluna quebraria `salvarFotosExtras` (`routes/produtos.js:112`), que só reconhece foto mantida por `startsWith('img/produtos/')`: a foto **sumiria da galeria sem erro nenhum**.
- **Preço do pedido vem do BANCO, nunca do body.** Aceitar preço do cliente = vestido por R$ 1 na tela da lojista.
- **Snapshot × leitura:** nome/preço do item são congelados (a cliente viu aquilo); `disponivel_agora` é calculado **na leitura** — o estoque muda entre o clique e a conversa.
- **Pedido NÃO reserva estoque** — reservar sem pagamento trava peça de quem nunca fecha.
- **Lead NÃO vira cliente sozinho** — poluiria RFM e régua com quem nunca comprou (o mesmo que a migration 040 resolveu). Vira cliente quando a lojista promove. Mas `POST /lead` é liberado em **todos os planos**: o formulário já existe em quem paga e não gravava ninguém.
- **CSP global, nunca por rota.** Dois headers de CSP → o navegador aplica a **interseção** → `js.stripe.com` some e o checkout quebra. **Stripe está em LIVE.**
- **`region1.google-analytics.com`** é obrigatório no `connectSrc`: o GA4 no Brasil manda hits pro endpoint regional. Sem ele, nenhum evento sai.
- **Pixel: banco guarda ID, nunca script.** Regex coladinho na interpolação — e sem `esc()`, porque escape de HTML dentro de `<script>` quebra o JS.
- **Tamanho esgotado fica VISÍVEL riscado.** Sumir com ele faz a cliente achar que a peça nunca teve aquele tamanho, que é informação diferente de "acabou".

### Armadilhas encontradas no caminho

- **`public/config.html` tem TRÊS cópias de `CAMPOS_TEXTO`** e não tinha entrada `'vitrine'` em `CAMPOS_SECAO`. Campo fora dessas listas salva como `'0'` ou volta vazio ao recarregar.
- **Template com token não pode ser servido cru** — o `express.static` entregaria `/vitrine/index.html` com `{{head}}` na cara da cliente. `server.js` bloqueia `.html` sob `/vitrine`.
- **`immutable` + `?t=Date.now()` = cache miss garantido** (o timestamp da logo foi removido junto com o cache longo).
- **O card do SSR e o do JS têm que gerar HTML idêntico**, senão a página "pula" no primeiro filtro.

### Performance

`immutable` nas fotos (nome de arquivo já é único) — antes **toda foto era rebaixada a cada visita**. Card em 2:3 retrato no lugar da altura fixa de 250px, que cortava vestido na cintura. Grade de 2 colunas no celular. N+1 morto: 2 queries por produto viraram 3 no total.

**Testes:** `npm run test:vitrine` (74 asserts), `npm run test:vitrine-pedidos` (58), + E2E de 60 verificações contra servidor real. Regressão verde. Migrations idempotentes contra cópia do banco, zero perda de dado.

---

**Documento versão 2.2 — Atualizado em 18 de julho de 2026. Régua nova: vitrine + personalização + precificação DESCERAM pro Starter (canal de aquisição + operação básica de vender); relacionamento (RFM + régua + clube) SUBIU pro Growth como bandeira do plano; DRE/relatórios seguem Growth. Fonte da verdade `lib/planos.js` — front e endpoint seguem sozinhos. Clube: lista de selos recolhida por padrão. Cupom não fiscal voltou a mostrar selos (rota `/crm/selos` era fantasma). Ficha da cliente ganhou Instagram + Observações (migration 039). Histórico: nome da cliente vira link pra ficha. Régua reconciliada: quem compra sai da fila e a janela de reativação não multiplica o mesmo cliente (`npm run test:regua`). Stripe em modo LIVE. Pendência de segurança nº1: rotacionar a chave AWS vazada.**
