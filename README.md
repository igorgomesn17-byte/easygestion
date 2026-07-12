# EasyGestão — SaaS para Lojistas de Moda

> PDV + Financeiro + NFC-e. Simples, rápido, rentável. 🚀

**Estado:** MVP de produção pronto | **Status:** Stripe + multi-tenant implementado | **Última atualização:** 2 de julho de 2026

---

## 🎯 O que é?

**EasyGestão** é um SaaS de gestão para donas de lojas de moda do interior que querem:

✅ PDV fácil (cálculo de taxa, imposto, comissão automático)  
✅ Controle de estoque com grade (P, M, G, GG, etc)  
✅ Caixa diário com conciliação  
✅ Histórico de clientes + indicações  
✅ DRE + fluxo de caixa real  
✅ Assinatura mensal (R$ 149/mês) com trial 30 dias  
✅ NFC-e (cupom fiscal eletrônico)  
✅ WhatsApp integrado (receber + responder)  

---

## 🚀 Quick Start (5 minutos)

### 1️⃣ Instalar Dependências

```bash
npm install
```

### 2️⃣ Configurar Variáveis de Ambiente

Copie `.env.example` para `.env` e preencha (mínimo):

```bash
cp .env.example .env
```

Edite `.env`:

```env
NODE_ENV=development
ADMIN_SENHA=SuaSenha123@#  # Será hasheada ao boot
SESSION_SECRET=xxxxx...    # 32+ caracteres aleatórios
ORIGIN=http://localhost:3000

# Email (SendGrid)
SENDGRID_API_KEY=SG.xxx
SITE_URL=http://localhost:3000
LOJA_EMAIL=noreply@localhost

# Stripe (opcional em dev, necessário em prod)
STRIPE_SECRET_KEY=sk_test_...
STRIPE_PUBLISHABLE_KEY=pk_test_...
STRIPE_WEBHOOK_SECRET=whsec_test_...
```

### 3️⃣ Rodar o Servidor

```bash
npm start
```

Acesse: **http://localhost:3000**

### 4️⃣ Login

- **Usuário:** `admin`
- **Senha:** (a que você colocou em `ADMIN_SENHA`)

---

## 📚 Documentação

| Documento | Para quem? | O que contém? |
|---|---|---|
| **[CLAUDE.md](./CLAUDE.md)** | Devs | Tudo: arquitetura, APIs, BD, fluxos, deploy |
| **[STRUCTURE.md](./STRUCTURE.md)** | Devs | Mapa de pastas e arquivos |
| **[.docs/setup/](./.docs/setup/)** | Devs | Guias de instalação e setup |
| **[.docs/operacional/](./.docs/operacional/)** | DevOps | Deploy e operação em produção |

👉 **Comece por:** [CLAUDE.md](./CLAUDE.md) (documentação completa)

---

## 🏗️ Arquitetura em 30 segundos

```
Frontend (HTML/CSS/JS vanilla)
         ↓
    Express.js (Node 22+)
         ↓
SQLite (DatabaseSync nativo)
```

**Segurança:**
- Sessão HTTP-only (não JWT)
- Senhas com scrypt
- Rate limit (login)
- CORS restrito
- Helmet + CSP

**Integrações:**
- 💳 Stripe (assinaturas + webhooks)
- 📧 SendGrid (emails)
- 💾 AWS S3 (backup)
- 📄 Focus NFe (NFC-e)
- 💬 Meta (WhatsApp + Instagram)

---

## 📊 Funcionalidades

### ✅ Completo

- Autenticação multi-tenant com trial
- PDV com cálculo de taxa/imposto/comissão
- Estoque com grade (tamanho × quantidade)
- Caixa com conciliação manual
- Clientes + histórico
- DRE + fluxo de caixa
- Trocas/devoluções
- Assinaturas Stripe + webhooks
- Admin dashboard (SaaS)
- Auditoria LGPD
- Backup automático S3

### 🟡 Em Desenvolvimento

- NFC-e (Focus integrado, falta alguns detalhes)
- Inbox omnichannel (estrutura pronta, integ parcial)
- CRM com régua automática (pronta, não acionada)

---

## 🔄 Fluxo Típico (Venda)

```
1. Vendedor abre PDV
2. Escaneia código de barras (ou busca produto)
3. Seleciona tamanho + quantidade
4. Sistema calcula: taxa + imposto + comissão
5. Aplica desconto (opcional)
6. Seleciona forma de pagamento (Pix, débito, crédito 1-6x)
7. Clica "Finalizar"
8. Sistema gera cupom + baixa estoque
9. Imprime cupom (ou salva PDF)
10. Se NFC-e ativa: emite cupom fiscal automaticamente
```

Toda venda é auditada (quem, o quê, quando).

---

## 💰 Modelo SaaS

| Item | Detalhes |
|---|---|
| **Trial** | 30 dias sem cartão |
| **Plano Crescimento** | R$ 149/mês |
| **Renovação** | Automática via Stripe (webhook) |
| **Bloqueio** | Automático se pagamento falha |
| **Cancelamento** | Manual ou via Stripe |

---

## 🛠️ Tech Stack

| Camada | Tecnologia |
|---|---|
| **Runtime** | Node.js 22+ |
| **Framework** | Express 4.21 |
| **Banco** | SQLite (DatabaseSync nativo) |
| **Sessão** | express-session + SQLite store |
| **Auth** | scrypt + JWT + multi-tenant |
| **Frontend** | Vanilla JS + HTML/CSS (ds.css) |
| **Email** | SendGrid |
| **Pagamentos** | Stripe |
| **NFC-e** | Focus NFe API |
| **Backup** | AWS S3 + AES-256 |
| **Logging** | Pino |
| **Segurança** | Helmet, CORS, CSP, rate limit |

---

## ✅ Deploy Checklist

### Local (Dev)

```bash
npm install
npm start
# Acesse http://localhost:3000
```

### Produção (Render)

Veja: [.docs/operacional/DEPLOY_INSTRUÇÕES.md](./.docs/operacional/DEPLOY_INSTRUÇÕES.md)

1. Configurar secrets no GitHub Actions
2. Fazer push para `main`
3. GitHub Actions faz build + deploy automático
4. Verificar logs no Render

### Antes de Go-Live

- [ ] Testar trial (30 dias → bloqueio)
- [ ] Testar assinatura (checkout → webhook)
- [ ] Testar backup/restore S3
- [ ] Configurar Stripe webhook
- [ ] Trocar Stripe para live keys
- [ ] Testar com 5-10 clientes reais

---

## 🆘 Troubleshooting

### "Erro ao fazer login"

→ Verificar `SESSION_SECRET` está configurado (mínimo 32 chars)

### "Erro no checkout Stripe"

→ Verificar price IDs em `STRIPE_PRICE_MENSAL` e `STRIPE_PRICE_ANUAL`

### "Email não chega"

→ Verificar `SENDGRID_API_KEY` e `LOJA_EMAIL`

### "NFC-e não emite"

→ Verificar `FOCUS_TOKEN_PRODUCAO` (homologação não emite fiscal)

---

## 📞 Suporte

- **Documentação completa:** [CLAUDE.md](./CLAUDE.md)
- **Issues:** Consultar memory do Claude ([.claude/](./.claude/))
- **Email:** igorgomesn17@gmail.com

---

## 📜 Licença

UNLICENSED (propriedade de Igor Desidério)

---

**Última atualização:** 2 de julho de 2026  
**Status:** 🟢 Pronto para produção
