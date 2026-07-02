# AUDITORIA SAAS — EXPERIÊNCIA DO CLIENTE
## EasyGestão | Etapa 1 — Onboarding & Account Management

> **Data:** 18/06/2026  
> **Status:** Auditoria exploratória  
> **Foco:** Tudo que o cliente VIVE ao usar o sistema (sem login até configuração)

---

## ✅ O QUE JÁ EXISTE

### 1. **Autenticação & Login**
- ✅ Tela de login (público, sem HTTPS obrigatório ainda)
- ✅ Login sem senha (simples — "usuario em branco = admin")
- ✅ Proteção contra brute force (rate limit: 6 tentativas / 15min)
- ✅ Sessão com httpOnly cookies (segura)
- ✅ Logout funcional
- ✅ Middleware de autenticação (`exigirLogin`)
- ✅ Sistema de papéis/roles: admin, vendedor, relacionamento

### 2. **Identificação & Branding da Loja**
- ✅ Logo customizável (upload PNG/JPG/WEBP até 2MB)
- ✅ Cor da marca customizável (hex color picker)
- ✅ Dados da loja: nome, endereço, telefone, Instagram
- ✅ API pública `/api/loja-publica` (sem login, serve identidade visual)
- ✅ Personalização refletida em: tela de login, dashboard

### 3. **Gerenciamento de Usuários (Admin only)**
- ✅ Criar usuários (`POST /api/usuarios`)
- ✅ Listar usuários (`GET /api/usuarios`)
- ✅ Desativar/ativar usuários (`PATCH /api/usuarios/:id/ativo`)
- ✅ Alterar senha de usuário (`PATCH /api/usuarios/:id/senha`)
- ✅ Deletar usuário (`DELETE /api/usuarios/:id`)
- ✅ Papéis: admin, vendedor, relacionamento

### 4. **Configurações Operacionais (Admin)**
- ✅ Tela de config completa (`public/config.html`)
- ✅ Categorias de produtos (CRUD dinâmico)
- ✅ Coleções de produtos (CRUD dinâmico)
- ✅ Taxas, markup, embalagem, frete
- ✅ Metas de venda (mensal/diária)
- ✅ Regime fiscal (MEI vs Simples)
- ✅ Configurações de impressão (cupom automático)
- ✅ Certificado A1 (upload, criptografa em AES-256)
- ✅ NFC-e (integração Focus NFe)
- ✅ Dados cadastrais: CNPJ, IE, razão social, endereço

### 5. **Segurança de Senha**
- ✅ Hashing com scrypt nativo (sem bcrypt/argon)
- ✅ Salt aleatório de 16 bytes
- ✅ Verificação em tempo constante (timing-safe)
- ✅ Mínimo 6 caracteres (validado no back)

### 6. **Headers & Proteções HTTP**
- ✅ Helmet.js configurado
- ✅ CSP (Content Security Policy) restritivo
- ✅ CORS (reflexivo em dev, controlado em produção)
- ✅ Secure cookies (httpOnly, sameSite=lax)
- ✅ HSTS não configurado ainda (TODO em produção)

---

## ❌ O QUE ESTÁ FALTANDO

### 🔴 CRÍTICO (Bloqueia lançamento)

#### 1. **Convite de usuários / Onboarding multiusuário**
- ❌ Sem link de convite
- ❌ Sem email de boas-vindas
- ❌ Sem registro de novos usuários (SaaS requer cadastro automático)
- ❌ Admin precisa criar manualmente cada usuário
- **Problema:** Cliente novo entra no sistema mas não consegue adicionar seus funcionários facilmente

#### 2. **Recuperação de senha**
- ❌ Sem "Esqueci minha senha"
- ❌ Sem email de recuperação
- ❌ Sem token de reset
- ❌ **CRÍTICO:** Se admin esquecer senha, está travado (só admin do .env consegue entrar)
- **Impacto:** Inviabiliza produção multi-tenant

#### 3. **Alteração de senha pelo próprio usuário**
- ❌ Usuário **NÃO CONSEGUE** trocar sua própria senha
- ❌ Só admin consegue (via API `/api/usuarios/:id/senha`)
- ❌ Sem tela "Meu perfil" ou "Alterar minha senha"
- **Segurança:** Má prática obrigar usuário comum a pedir ao admin

#### 4. **Perfil do usuário / "Meus dados"**
- ❌ Sem tela de perfil pessoal
- ❌ Sem exibição do próprio usuário logado
- ❌ Sem campo de email/telefone do usuário
- ❌ Sem forma de atualizar seus dados

#### 5. **Exclusão de conta / Dados**
- ❌ Sem "Deletar minha conta"
- ❌ Sem "Exportar meus dados" (LGPD)
- ❌ Sem "Apagar dados da empresa" 
- ❌ Sem confirmação de exclusão (2-factor: email + senha)
- **Compliance:** Artigos 17-18 LGPD (direito ao esquecimento, portabilidade)

#### 6. **Termos de Uso & Política de Privacidade**
- ❌ Sem página `/termos`
- ❌ Sem página `/privacidade`
- ❌ Sem checkbox "Aceito os termos" no onboarding
- ❌ Sem link nos rodapés
- **Compliance:** Obrigatório para SaaS (Lei 14.155/21 Brasil)

---

### 🟡 IMPORTANTE (Esperado em MVP SaaS)

#### 7. **Notificações ao usuário**
- ❌ Sem sistema de notificações in-app
- ❌ Sem email de notificações
- ❌ Sem alertas de eventos (ex: alguém acessou sua conta)
- **UX:** Usuário fica cego para eventos importantes

#### 8. **Verificação de email**
- ❌ Sem campo `email` na tabela `usuarios`
- ❌ Sem verificação de email (2FA / confirmação)
- ❌ Sem resend de email de confirmação
- **Security:** Email é essencial para recuperação de conta

#### 9. **Limites do plano**
- ❌ Sem modelo de preços/planos
- ❌ Sem limite de: usuários, produtos, vendas/mês, armazenamento
- ❌ Sem warning "você atingiu X% do limite"
- ❌ Sem upgrade/downgrade de plano
- **Monetização:** Impossível cobrar diferente por plano

#### 10. **Segurança da conta avançada**
- ❌ Sem 2FA (autenticador/SMS)
- ❌ Sem histórico de login
- ❌ Sem "Dispositivos conectados" (revogar sessões)
- ❌ Sem proteção de "novo login" (email de confirmação)
- ❌ Sem teste de força da senha

#### 11. **Modelo de dados multi-tenant**
- ❌ Banco SQLite com **UM único banco** pra todas as lojas
- ⚠️ **Risco crítico:** Se um cliente conseguir acesso, vê TODOS os outros
- ❌ Sem `tenant_id` nas tabelas
- ❌ Sem isolamento por query (SELECT WHERE tenant_id = ?)
- **Arquitetura:** Precisa ser refeita antes de produção

---

### 🟠 IMPORTANTE (Nice-to-have para v1.0)

#### 12. **Convite de múltiplos usuários em lote**
- ❌ Sem upload CSV de usuários
- ❌ Sem criar time já logado com um clique

#### 13. **API para integração com HR**
- ❌ Sem importar usuários de Gestão de RH
- ❌ Sem sync automático (sincronizar/desativar funcionários)

#### 14. **Acesso com SSO (Single Sign-On)**
- ❌ Sem Google/Microsoft Sign-in
- ❌ Sem SAML/OAuth para integração corporativa

#### 15. **Auditoria & Logs**
- ❌ Sem registro de "Quem fez o quê e quando"
- ❌ Sem tabela `audit_logs`
- ❌ Sem "Ver histórico de alterações" no admin

#### 16. **Backup automático & Recuperação**
- ❌ Tem `scripts/backup.js` manual
- ❌ Sem agendamento automático de backup
- ❌ Sem restore/rollback point-in-time
- ❌ Sem armazenamento em nuvem (S3, Google Cloud)

#### 17. **Performance & Observabilidade**
- ❌ Sem métricas (Prometheus/New Relic)
- ❌ Sem health check `/health`
- ❌ Sem structured logging
- ⚠️ SQLite vai estrangular em ~50 lojas simultâneas

---

## 📋 MATRIZ DE DECISÃO

| Item | Status | Crítico? | Razão | Ação |
|------|--------|---------|-------|------|
| **Convite/Onboarding** | ❌ | 🔴 SIM | Sem isso, cliente novo fica sozinho | MVP → Sprint 1 |
| **Recuperação de senha** | ❌ | 🔴 SIM | Sem email = cliente travado | MVP → Sprint 1 |
| **Alterar própria senha** | ❌ | 🔴 SIM | Segurança mínima obrigatória | MVP → Sprint 1 |
| **Termos + Privacidade** | ❌ | 🔴 SIM | LGPD / Lei 14.155 | MVP → Sprint 1 |
| **Multi-tenant seguro** | ⚠️ PARCIAL | 🔴 SIM | Banco único = risco crítico | MVP → Refactor arquitetura |
| **Email usuário** | ❌ | 🟡 ALT | Base para recuperação | MVP → Sprint 1 |
| **2FA** | ❌ | 🟡 ALT | Segurança extra (não essencial v1) | v1.1+ |
| **Notificações** | ❌ | 🟡 ALT | UX (não bloqueia) | v1.1+ |
| **Planos/Limites** | ❌ | 🟡 ALT | Monetização (negócio, não técnico) | v2.0 (após lançar) |
| **SSO** | ❌ | 🟠 NÃO | Enterprise (v2+) | Roadmap futura |
| **Auditoria** | ❌ | 🟠 NÃO | Compliance (v1.1+) | Roadmap |
| **Backup automático** | ❌ | 🟠 NÃO | Infra (v1.1+) | Dependência cloud |

---

## 🎯 PLANO DE AÇÃO RECOMENDADO

### **SPRINT 1 — MVP (Bloqueadores)**
Tempo estimado: **3-4 semanas**

```
1. Email de usuário
   - Adicionar coluna `email` em `usuarios`
   - Validar email único
   
2. Recuperação de senha  
   - Nova rota POST /api/auth/forgot-password { email }
   - Gerar token (JWT ou aleatorio + expira em 1h)
   - Enviar email com link reset
   - Rota GET /reset/:token (tela pública)
   - POST /reset com nova senha

3. Alterar própria senha
   - Nova tela em config.html "Minha conta"
   - POST /api/me/senha { senha_atual, senha_nova }
   - Validar senha_atual antes de trocar

4. Convite de usuários
   - POST /api/usuarios/:id/convite-link (gera link único)
   - Email com link para usuário aceitar e definir senha
   - Usuário entra como "convite_pendente" até confirmar email

5. Termos + Privacidade
   - Criar /termos.html e /privacidade.html
   - Checkbox obrigatório no login/primeiro acesso
   - Guardar { aceito_termos, data } em tabela

6. Preparar multi-tenant
   - Adicionar `tenant_id` nas tabelas principais
   - Criar middleware que filtra por tenant
   - NÃO usar dados de outro tenant em nenhuma query
```

### **SPRINT 2 — Segurança (Nice-to-have)**
- Email verification (2-step: cadastro → confirma email)
- 2FA (TOTP via Google Authenticator)
- Histórico de login
- Notificações in-app

### **SPRINT 3+ — Scaling**
- Migrar para PostgreSQL (SQLite não aguenta multi-tenant real)
- Backup automático em S3
- Auditoria / Logs estruturados

---

## 🔐 RISCOS IDENTIFICADOS

### 1. **Multi-tenant inseguro** (Crítico)
```
RISCO: Um cliente consegue ver dados de outro
STATUS: Alto (SQLite único, sem isolamento)
EXEMPLO: Se admin erra query, pode expor todas as lojas
MITIGAÇÃO: Refatorar antes de produção
```

### 2. **Sem recuperação de conta** (Crítico)
```
RISCO: Cliente esquece senha → travado
STATUS: Alto
MITIGAÇÃO: Implementar email recovery (Sprint 1)
```

### 3. **Dependência de admin para tudo** (Alto)
```
RISCO: Usuário não consegue mudar própria senha
STATUS: Alto (UX horrível em produção)
MITIGAÇÃO: Self-service de perfil (Sprint 1)
```

### 4. **Sem LGPD** (Alto — Compliance)
```
RISCO: Não atender Lei 14.155, LGPD art. 17-18
STATUS: Alto
MITIGAÇÃO: Termos + Privacidade + export/delete (Sprint 1)
```

### 5. **Login sem senha em produção** (Médio)
```
RISCO: auth.js permite login com só usuário (sem senha)
STATUS: Médio
NOTAS: OK em dev; será removido quando email+recovery estiverem
MITIGAÇÃO: Desativar em produção (NODE_ENV=production)
```

### 6. **Sem hash na senha admin do .env** (Médio)
```
ATUAL: ADMIN_SENHA em plaintext no .env
STATUS: Médio (acesso ao .env = pior dos problemas anyway)
MITIGAÇÃO: Já previsto; usar ADMIN_SENHA_HASH em produção
```

### 7. **SQLite não aguenta crescimento** (Médio-Alto)
```
STATUS: Conhecido; adequado para <10 lojas
LIMITE: ~50 lojas = já morre em leitura
MITIGAÇÃO: PostgreSQL no roadmap pós-lançamento
```

---

## 📊 CHECKLIST PARA LANÇAMENTO

- [ ] Email de usuário (no BD e no form)
- [ ] Recuperação de senha via email
- [ ] Usuário troca própria senha
- [ ] Convite por email com token
- [ ] Termos de uso visível
- [ ] Política de privacidade (LGPD)
- [ ] Opção de exportar dados (LGPD)
- [ ] Opção de deletar conta
- [ ] Isolamento multi-tenant (tenant_id nas tabelas)
- [ ] Testes: um usuário não vê dados de outro
- [ ] HTTPS obrigatório em produção
- [ ] SESSION_SECRET forte (não 'ds-dev-secret')
- [ ] CERT_CIPHER_KEY definido em produção
- [ ] rate limit testado (login + API)
- [ ] Logs estruturados (quem fez login, quando, IP)

---

## 💡 RECOMENDAÇÕES FINAIS

1. **Priorize Sprint 1** — sem esses itens, você não tem SaaS funcional. Um cliente novo não consegue se onboardar sozinho.

2. **Tenha um documento jurídico** — Termos + Privacidade precisam ser revisados por advogado (não é só template).

3. **Migre para PostgreSQL antes de 10 clientes** — SQLite vai sufocá-lo. Planeje isso agora.

4. **Separar ambiente** — dev, staging, produção com secrets diferentes.

5. **Comunicar roadmap** — Clientes vão pedir 2FA, backup automático, integração Omie. Tenha um público.

---

**Próxima etapa:** Auditoria de SEGURANÇA (SQL injection, CSRF, XSS, LGPD avançada)

