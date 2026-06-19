# DRE Express — SaaS para Lojistas de Moda

> PDV + Financeiro + NFC-e. Simples, rápido, rentável.

---

## 🚀 Começar Localmente

### 1. Instalar dependências
```bash
npm install
```

### 2. Rodar servidor
```bash
npm start
```

Servidor estará em: **http://localhost:3001**

### 3. Login
- Usuário: `admin`
- Senha: (veja no `.env` → `ADMIN_SENHA`)

---

## 📁 Estrutura do Projeto

```
DRE-EXPRESS/
├─ server.js           # Entrada principal
├─ package.json        # Dependências
├─ .env                # Variáveis de ambiente
├─ middleware/         # Segurança, autenticação
├─ routes/             # Rotas da API
├─ lib/                # Lógica compartilhada (cálculos, CRM, etc)
├─ db/                 # Banco de dados (schema.sql)
├─ public/             # HTML/CSS/JS frontend
└─ scripts/            # Utilitários (backup, etc)
```

---

## ✂️ O que foi REMOVIDO deste MVP

Comparado ao DS Sistema (sistema de loja única), DRE Express **remove** temporariamente:

- ❌ CRM/Régua (v1.0)
- ❌ Inbox omnichannel (v1.0+)
- ❌ Vitrine pública
- ❌ Clube fidelidade
- ❌ Encomendas
- ❌ Permuta blogueira
- ❌ IA
- ⏳ NFC-e (em desenvolvimento)

---

## ✅ O que ENTRA no MVP

1. **PDV completo** — vender, calcular taxa/imposto/comissão
2. **Estoque com grade** — produtos, tamanhos, quantidade
3. **Caixa com conciliação** — abertura, fechamento, sangria
4. **Clientes + histórico** — cadastro, compras, contato
5. **Financeiro** — despesas, fluxo de caixa, DRE (NOVO)
6. **NFC-e** — emissão de cupom fiscal (em desenvolvimento)
7. **Recibo WhatsApp** — envio automático após venda

---

## 🔧 Próximos Passos (Roadmap MVP)

### Semana 1-2: Financeiro
- [ ] Tabela `despesas` no banco
- [ ] Rota `/api/despesas` (CRUD)
- [ ] Tela despesas.html
- [ ] Tela fluxo-caixa.html
- [ ] Tela dre.html (fechamento mensal)

### Semana 3: Polimento
- [ ] Recibo WhatsApp
- [ ] Upload foto produto
- [ ] Entrada estoque em lote
- [ ] Testes locais

### Semana 4: Deploy
- [ ] Deploy Render
- [ ] Domínio drexpress.com.br
- [ ] Landing page

### Semana 5-8: Validação
- [ ] 5-10 clientes testando
- [ ] Feedback, ajustes
- [ ] NPS measurement

---

## 📊 Custos (para você saber)

**Seu custo fixo mensal:**
- Servidor: R$ 50-100
- Domínio: R$ 5
- E-mail: R$ 0-20
- **Total: ~R$ 55-125/mês** (sem clientes)

**Seu lucro por cliente:**
- Cliente paga: R$ 99-199/mês (DRE Express)
- Seu custo por cliente: ~R$ 30-50
- Seu lucro: ~R$ 50-150/cliente

**Breakeven:** 5-6 clientes pagando

Veja [CUSTOS-SIMPLIFICADO.md](../SAAS/CUSTOS-SIMPLIFICADO.md) para mais detalhes.

---

## 🔐 Segurança

- ✅ Senhas com `scrypt` (criptografado)
- ✅ Sessão HTTP-only (segura contra XSS)
- ✅ CORS restrito
- ✅ Rate limit (brute force)
- ✅ Helmet (headers de segurança)
- ✅ CSP (Content Security Policy)

---

## 📝 Licença

UNLICENSED (propriedade intelectual de Igor Desidério)

---

**Última atualização:** jun/2026
