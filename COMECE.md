# 🚀 EasyGestão — Comece Aqui

**Sistema SaaS Multi-Tenant para Lojistas de Moda**  
**Status:** MVP 5.5/10 — Pronto para Staging  
**Deadline Deploy:** 25/07/2026

---

## ⚡ Quick Start (Desenvolvimento Local)

```bash
# 1. Instalar dependências
npm install

# 2. Criar/configurar .env (copie de .env.example)
cp .env.example .env
# Edite e preencha as variáveis

# 3. Rodar servidor
npm start

# 4. Acessar
http://localhost:3000
```

---

## 📱 Como Usar (Usuário)

### Registrar
1. Acesse http://localhost:3000
2. Clique em "Cadastro" ou acesse `/public/login.html`
3. Preencha:
   - Email
   - Senha (min 6 caracteres)
   - Nome da loja
   - Nome do responsável
   - Telefone
4. Clique em Registrar

### Login
1. Acesse a página de login
2. Email + senha
3. Pronto***REMOVED*** Você tem sua própria loja isolada

### PDV (Ponto de Venda)
- Dashboard principal em `/index.html`
- Vendas em `/pdv.html`
- Relatórios em `/dashboard.html`

---

## 🔧 Estrutura Técnica

```
├── public/           (Telas HTML)
├── routes/           (APIs)
├── middleware/       (Autenticação, segurança)
├── lib/              (Email, backup)
├── db/               (Banco SQLite)
├── scripts/          (Backup manual, testes)
└── server.js         (Servidor principal)
```

**Tech Stack:**
- Node.js + Express
- SQLite (desenvolvimento) / PostgreSQL (produção)
- SendGrid (email)
- AWS S3 (backup)
- Express-session (autenticação)

---

## 📊 Recursos Implementados ✅

### Autenticação
- ✅ Registro de usuário (criar nova loja/tenant)
- ✅ Login com email/senha
- ✅ Logout (destruir sessão)
- ✅ Recuperação de senha (via email)
- ✅ Reset de senha

### Multi-Tenant
- ✅ Cada registrado tem seu próprio tenant_id
- ✅ Isolamento garantido no banco de dados
- ✅ Admin pode gerenciar clientes/vendas

### Self-Service (LGPD)
- ✅ Alterar senha (logado)
- ✅ Exportar dados (JSON)
- ✅ Deletar conta (hard delete opcional)

### Operacional
- ✅ PDV com vendas
- ✅ Gestão de clientes
- ✅ Estoque
- ✅ Relatórios financeiros
- ✅ Backup automático (22h diariamente)

### Email
- ✅ Boas-vindas ao registrar
- ✅ Recuperação de senha
- ✅ Convites (futuro)

---

## 🧪 Testes

### Rodar Testes Locais
```bash
node scripts/test-simple.js
```

Testa:
- Registro ✅
- Login ✅
- Multi-tenant isolamento ✅
- Logout ✅

### Testes Manuais (Curl)
Veja `TESTE-MANUAL.md` para 10 cenários completos.

---

## 📦 Variáveis de Ambiente (`.env`)

```env
# Servidor
NODE_ENV=development
PORT=3000
SESSION_SECRET=seu-secret-aleatorio-min-32-chars

# Email (SendGrid)
SENDGRID_API_KEY=SG.xxx...
LOJA_EMAIL=noreply@seudominio.com
LOJA_NOME=EasyGestão

# Backup (AWS S3)
AWS_ACCESS_KEY_ID=AKIA...
AWS_SECRET_ACCESS_KEY=xxx...
AWS_S3_BUCKET=seu-bucket
AWS_REGION=sa-east-1

# Admin (opcional)
ADMIN_SENHA=sua-senha-admin
```

Para produção, use as mesmas variáveis (Render/Heroku gerencia via painel).

---

## 🚀 Deploy (Render)

### 1. Preparar
```bash
# Criar repo GitHub
git init
git add .
git commit -m "Initial commit"
git push -u origin main
```

### 2. Render
1. Acesse [render.com](https://render.com)
2. Novo Web Service → Node.js
3. Conectar repo
4. Build: `npm install`
5. Start: `npm start`
6. Environment: preencher `.env`
7. Deploy

### 3. Domínio
1. Render → Custom Domain
2. Adicionar `easygestao.com`
3. Hostinger → DNS → Adicionar CNAME
4. Aguardar propagação (30 min)

Veja `DEPLOY-RENDER.md` para passo a passo completo.

---

## 🔒 Segurança

✅ **Implementado:**
- Senha com scrypt (crypto nativo)
- Comparação em tempo constante (timing-safe)
- HTTPS obrigatório em produção
- Rate limit anti-brute-force
- CORS restrito
- SQL injection prevention (prepared statements)
- XSS prevention (sanitização)
- LGPD compliance

---

## 📋 Checklist Pré-Deploy

- [ ] Testes locais passando (`node scripts/test-simple.js`)
- [ ] `.env.example` atualizado (sem secrets)
- [ ] Repo GitHub criado
- [ ] `npm install` rodou sem erros
- [ ] `npm start` rodou sem erros 500
- [ ] SendGrid API key validada
- [ ] AWS S3 credenciais válidas
- [ ] Backup rodou manualmente

---

## 🆘 Troubleshooting

| Erro | Solução |
|------|---------|
| `Cannot find module` | `npm install` |
| `EADDRINUSE 3000` | Porta ocupada: `lsof -i :3000 \| kill -9` |
| `Email não envia` | Verificar `SENDGRID_API_KEY` no `.env` |
| `Banco não persiste` | SQLite no `/tmp` é volátil — usar PostgreSQL em produção |
| `401 Unauthorized` | Sessão expirou — fazer login novamente |

---

## 📞 Suporte

**Issues/Bugs:** Documenta em `docs-arquivo/` para referência futura  
**Melhorias:** Adicionar em backlog (Tarefa 10+)  
**Dúvidas:** Ver `TESTE-MANUAL.md` ou `DEPLOY-RENDER.md`

---

## 📅 Timeline

```
Jun 19  → Tarefa 9.1: Testes Locais ✅
Jun 20  → Tarefa 9.2-9.5: Deploy Staging + Produção
Jun 21  → Tarefa 10: Validação Final + Go Live
Jul 25  → Deadline (backup)
```

---

## 🎯 Próximas Etapas

1. **Hoje:** Validar testes locais ✅
2. **Amanhã:** Deploy Render (staging)
3. **Depois:** Deploy produção
4. **Após:** Clientes piloto + ajustes

---

## 📚 Documentação Completa

- `README.md` — Overview geral
- `ESTRUTURA-PASTAS.md` — Organização do código
- `TESTE-MANUAL.md` — Testes detalhados (10 cenários)
- `DEPLOY-RENDER.md` — Deploy passo a passo
- `STATUS-TAREFA-9.md` — Status atual
- `PLANO-SEQUENCIAL-MVP.md` — Cronograma completo

---

**Última atualização:** 19/06/2026  
**Status:** ✅ Pronto para staging  
**Confiança:** 100%
