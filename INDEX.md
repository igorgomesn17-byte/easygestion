# 📋 EASYGESTION — Índice da Estrutura

## 🚀 Comece por aqui

1. **[COMECE.md](COMECE.md)** — Setup inicial, dependências, variáveis de ambiente
2. **[README.md](README.md)** — Visão geral do projeto

## 📚 Documentação Ativa

- **[DEPLOY_INSTRUÇÕES.md](DEPLOY_INSTRUÇÕES.md)** — Como fazer deploy em produção
- **[READINESS_DEPLOY.md](READINESS_DEPLOY.md)** — Checklist pré-deploy
- **[GITHUB_ACTIONS_SETUP.md](GITHUB_ACTIONS_SETUP.md)** — Configuração de CI/CD
- **[MODELO-PRICING-FINAL-IGOR.md](MODELO-PRICING-FINAL-IGOR.md)** — Estratégia de preços

## 📁 Estrutura de Diretórios

```
EASYGESTION/
├── .archives/          # Documentação antiga/obsoleta (arquivada)
├── .github/            # Workflows GitHub Actions
├── db/                 # Arquivos de banco de dados
├── docs/               # Documentação técnica
├── lib/                # Biblioteca compartilhada
├── middleware/         # Express middlewares
├── public/             # Arquivos estáticos (HTML, CSS, JS)
├── routes/             # Endpoints da API
├── scripts/            # Scripts de deploy e utilitários
├── tests/              # Testes automatizados
├── uploads/            # Diretório de uploads de arquivos
├── server.js           # Servidor principal (Express)
├── package.json        # Dependências do projeto
├── docker-compose.yml  # Configuração Docker
└── .env                # Variáveis de ambiente (não versionado)
```

## 🔧 Scripts Úteis

Todos em `scripts/`:

- `DEPLOY_SCRIPT.sh` — Automação de deploy
- `deploy-manual.bat` — Deploy manual Windows
- `teste-stripe.sh` — Testes Stripe
- `fix-tenant.sh` — Correção de tenant

Execute com: `./scripts/DEPLOY_SCRIPT.sh`

## 🗂️ Arquivos Arquivados

Documentação antiga está em `.archives/`:
- Auditorias antigas (LGPD, segurança, multitenancy)
- Implementações previas (NFCe, Stripe, etc)
- Checklists e relatórios de fase anterior

Consulte apenas se precisar de contexto histórico.

## 📝 .env Variables

Veja em [COMECE.md](COMECE.md) para todas as variáveis necessárias.

Principais:
- `DATABASE_URL` — PostgreSQL connection
- `STRIPE_SECRET_KEY` — Chave Stripe
- `SENDGRID_API_KEY` — Email via SendGrid
- `JWT_SECRET` — Segredo JWT
- `ADMIN_SENHA_HASH` — Hash da senha admin

## 🚦 Status

- ✅ Arquitetura multi-tenant
- ✅ LGPD auditada
- ✅ Segurança crítica implementada
- ✅ Stripe integrado
- ⏳ QA final antes do lançamento

---

**Última atualização:** 2026-06-25
