# 📁 Estrutura de Pastas — EASYGESTION

## 🎯 Raiz (Arquivos Principais)

| Arquivo | Propósito |
|---------|-----------|
| `server.js` | **Servidor Express principal** — inicie com `npm start` ou `node server.js` |
| `package.json` | Dependências e scripts (start, backup, backup-s3) |
| `.env` | **Variáveis privadas** (não commit) — AWS, SendGrid, sessão, etc |
| `.env.example` | Template — copie para `.env` e preencha |
| `PLANO-SEQUENCIAL-MVP.md` | **Rastreamento de progresso** (Tarefa 1-10) |
| `README.md` | Documentação geral do projeto |
| `DEPLOY-RENDER.md` | Guia completo para deploy em staging + produção |
| `STATUS-TAREFA-9.md` | Status completo dos testes (Tarefa 9.1 ✅) |

---

## 📂 Pastas Principais

### `public/` — **Telas HTML da aplicação**
```
public/
  ├── login.html              (tela de login)
  ├── dashboard.html          (dashboard principal)
  ├── pdv.html                (ponto de venda)
  ├── admin-dashboard.html    (admin SaaS)
  ├── minha-conta.html        (perfil do usuário)
  ├── esqueci-senha.html      (reset de senha)
  ├── reset-senha.html        (confirmação de reset)
  ├── termos.html             (termos de serviço)
  ├── privacidade.html        (política de privacidade)
  ├── ativacao.html           (ativação de licença)
  └── img/                    (logos, imagens estáticas)
```

### `routes/` — **APIs da aplicação**
```
routes/
  ├── auth.js                 (login, logout, esqueci-senha, reset)
  ├── admin.js                (backoffice SaaS — clientes, faturamento)
  ├── config.js               (configurações da loja)
  ├── usuarios.js             (gerenciamento de usuários)
  ├── produtos.js             (CRUD de produtos)
  ├── clientes.js             (CRUD de clientes)
  ├── estoque.js              (controle de estoque)
  ├── vendas.js               (register de vendas)
  ├── caixa.js                (operações de caixa)
  ├── trocas.js               (trocas e devoluções)
  ├── despesas.js             (lançamento de despesas)
  ├── financeiro.js           (relatórios financeiros)
  ├── nfce.js                 (emissão de NFC-e)
  ├── dashboard.js            (dados do dashboard)
  ├── codigoBarras.js         (geração de código de barras)
  ├── backup.js               (endpoint de backup manual)
  └── license.js              (validação de licença)
```

### `middleware/` — **Autenticação & Segurança**
```
middleware/
  └── seguranca.js            (autenticação, tenant-id, rate-limit, RBAC)
     ├── exigirLogin()        (valida sessão)
     ├── injetarTenant()      (adiciona req.tenantId)
     ├── apenasAdmin()        (só admin)
     ├── exigirPapel()        (RBAC: vendedor, admin)
     ├── limiteGlobal         (rate limit geral)
     └── limiteLogin          (anti-brute-force)
```

### `lib/` — **Utilitários & Agendadores**
```
lib/
  ├── email.js                (envio de e-mail via SendGrid + templates)
  ├── backup-scheduler.js     (agendador de backup diário às 22h)
  └── (outras funções compartilhadas)
```

### `scripts/` — **Scripts sob demanda**
```
scripts/
  ├── backup-s3.js            (backup manual pro S3 — rode com: npm run backup-s3)
  └── (outros scripts de manutenção)
```

### `db/` — **Banco de dados SQLite**
```
db/
  ├── dsstore.db              (banco principal — gitignore)
  └── (migrations, seeders — se precisar)
```

### `Midiakit/` — **Conteúdo de marca (imagens, vídeos)**
```
Midiakit/
  ├── logo.png
  ├── cores-guia.txt
  └── (arquivos visuais da marca)
```

### `instalacao/` — **Recursos de instalação/ativação**
```
instalacao/
  └── (arquivos para setup inicial)
```

---

## 📦 Pastas Organizacionais (Arquivo)

### `docs-arquivo/` — **Documentação velha/referência**
Contém planejamentos anteriores, análises, auditorias e documentação obsoleta.
**Use apenas para referência histórica.**

### `scripts-setup/` — **Scripts de instalação & atualização**
Contém instaladores (InnoSetup), scripts de setup, atalhos — não usados em produção.

### `config-licenca/` — **Licença & configuração**
Chaves de ativação, certificados, tokens privados.

---

## 🚀 Como Rodar

```bash
# Instalar dependências
npm install

# Iniciar servidor (NODE_ENV=development)
npm start
# ou
node server.js

# Backup manual pro S3
npm run backup-s3

# Backup local (SQLite)
npm run backup
```

---

## 🔒 Variáveis de Ambiente (`.env`)

```env
# Servidor
PORT=3000
NODE_ENV=development  # ou production
SESSION_SECRET=seu-secret-seguro-aqui

# Banco de dados
DB_PATH=db/dsstore.db

# Email (SendGrid)
SENDGRID_API_KEY=SG.xxx...
SENDGRID_FROM_EMAIL=noreply@easygestao.com

# AWS S3 (Backup)
AWS_ACCESS_KEY_ID=xxx...
AWS_SECRET_ACCESS_KEY=xxx...
AWS_S3_BUCKET=meu-bucket
AWS_REGION=sa-east-1

# Admin SaaS (opcional)
ADMIN_PASSWORD=senha-admin-forte

# Origem (CORS)
ORIGIN=http://localhost:3000
```

---

## 📋 Status do Projeto

**Versão MVP:** 3.5/10 → 5.5/10 (até 25/07/2026)  
**Progresso:** 62% completo (Dia 3 de 12)  
**Próximas Tarefas:**
- ✅ Tarefa 7: Isolamento Multi-Tenant (em andamento)
- ✅ Tarefa 8: Backoffice Admin + Backup (concluído)
- ⏳ Tarefa 9: **Testes Locais + Deploy** (próximo)

Veja `PLANO-SEQUENCIAL-MVP.md` para detalhes.

---

**Última atualização:** 19/06/2026
