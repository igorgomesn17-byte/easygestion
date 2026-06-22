# 🚨 AUDITORIA CRÍTICA PRE-LANÇAMENTO — EASYGESTION

**Data:** 2026-06-22  
**Auditor:** Arquiteto SaaS Sênior  
**Conclusão:** ❌ **NÃO APROVO LANÇAMENTO** até corrigir os 3 blockers críticos

---

## TL;DR — O Pior Primeiro

| Problema | Severidade | Impacto | Timeline |
|----------|-----------|---------|----------|
| **Estoque sem isolamento de tenant** | 🔴 CRÍTICO | Cliente A vê/modifica estoque de Cliente B | 4 dias |
| **Stripe não integrado** | 🔴 CRÍTICO | Nenhum cliente paga; lucro = zero | 5 dias |
| **Sem LGPD data export/delete** | 🔴 CRÍTICO | Primeira reclamação = processo legal | 3 dias |
| Usuarios sem tenant_id | 🔴 CRÍTICO | Admin vê usuários de todos clientes | 2 dias |
| venda_pagamentos sem tenant_id | 🟠 ALTO | Vazamento de dados de pagamento | 1 dia |
| Backup não criptografado | 🟠 ALTO | Cliente baixa DB com PII de outros | 2 dias |
| Sem rate limit por tenant | 🟠 ALTO | Um cliente DDoS todos os outros | 1 dia |

---

## 1️⃣ BLOCKER #1: ESTOQUE ROUTE SEM ISOLAMENTO MULTI-TENANT

### O Problema
Todos os endpoints de estoque (`GET /resumo`, `GET /`, `POST /ajuste`, `POST /entrada`) NÃO filtram por `tenant_id`.

```javascript
// ERRADO — achador permite acesso cross-tenant:
SELECT COALESCE(SUM(v.quantidade * p.custo),0) FROM variacoes v JOIN produtos p
// Deveria ser:
SELECT COALESCE(SUM(v.quantidade * p.custo),0) FROM variacoes v 
JOIN produtos p WHERE p.tenant_id = ?
```

### Cenário de Risco
1. Cliente Daisy (DS Store) loga
2. Chama `GET /api/estoque/resumo`
3. Recebe valor total de estoque de TODOS os clientes (vazamento de dados)
4. Chama `POST /api/estoque/ajuste` com variacao_id de concorrente
5. Drena estoque do concorrente (sabotagem)

### Por Que Crítico
- **Vazamento de dados comercial:** Daisy vê quanto dinheiro competitors têm em estoque
- **Sabotagem:** Pode zerar estoque de rival
- **Reputação:** Primeira reclamação via LGPD

### Como Consertar
```javascript
// 1. Adicionar tenant_id ao schema:
ALTER TABLE variacoes ADD COLUMN tenant_id INTEGER NOT NULL DEFAULT 1;
CREATE UNIQUE INDEX idx_variacoes_tenant ON variacoes(produto_id, tamanho, tenant_id);

// 2. Backfill (ligar variacao ao tenant correto via produto):
UPDATE variacoes SET tenant_id = (
  SELECT tenant_id FROM produtos WHERE id = variacoes.produto_id
);

// 3. Usar função validar em todos os endpoints:
function validarVariacaoTenant(variacaoId, tenantId) {
  const v = db.prepare(`
    SELECT v.id FROM variacoes v 
    JOIN produtos p ON p.id = v.produto_id 
    WHERE v.id = ? AND p.tenant_id = ?
  `).get(variacaoId, tenantId);
  if (***REMOVED***v) throw new Error('Acesso negado');
  return v;
}

// 4. Todas as queries de estoque adicionar filtro:
SELECT * FROM variacoes v
JOIN produtos p ON p.id = v.produto_id
WHERE p.tenant_id = ?
```

### Checklist de Testes
- [ ] Tenant A tenta acessar variacao de Tenant B → erro 403
- [ ] Tenant A ajusta estoque só afeta seus produtos
- [ ] GET /resumo só soma estoque de tenant autenticado

**Esforço:** 4 dias | **Risco de skip:** Crítico ⚠️

---

## 2️⃣ BLOCKER #2: STRIPE NÃO INTEGRADO

### O Problema
- Código CRIA registros "cobranca" no DB (status='pendente')
- Mas NUNCA conecta ao Stripe
- Nenhum cliente é cobrado
- Nenhuma receita é gerada

```javascript
// lib/assinatura.js :: criarCobranca() faz:
INSERT INTO cobracas (tenant_id, assinatura_id, data_cobranca, valor, status)
VALUES (?, ?, ?, ?, 'pendente')
// E... para. Nada acontece com o dinheiro.
```

### Cenário Real
1. Cliente se registra → assinatura criada (plano Básico R$99/mês)
2. Dia 30: Cobrança criada com status='pendente'
3. Nada acontece
4. Cliente continua usando (no tenant.status = 'ativo')
5. Igor nunca recebe o dinheiro

Mais: cliente pode criar 10 contas, usar cada uma por 30 dias = 300 dias de uso grátis.

### Por Que Crítico
- **Receita = zero** enquanto cobra-se tempo
- **Impossível escalar:** Cliente não paga = não pode oferecer suporte
- **Fraude:** Cliente pode burlar trial infinitamente

### Como Consertar (Timeline: 5 dias)

**Dia 1-2: Stripe Setup**
```javascript
// lib/stripe.js
const Stripe = require('stripe');
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

async function criarIntencaoPagamento(tenantId, valor) {
  const tenant = db.prepare('SELECT * FROM tenants WHERE id = ?').get(tenantId);
  
  const paymentIntent = await stripe.paymentIntents.create({
    amount: Math.round(valor * 100), // centavos
    currency: 'brl',
    customer: tenant.stripe_customer_id,
    metadata: { tenant_id: tenantId },
    description: `Cobrança mensal - ${tenant.nome_loja}`,
  });
  
  return paymentIntent;
}

async function renovarAssinaturaComCobranca(tenantId) {
  const assinatura = db.prepare('SELECT * FROM assinaturas WHERE tenant_id = ?').get(tenantId);
  const intent = await criarIntencaoPagamento(tenantId, assinatura.valor_mensal);
  
  db.prepare(`
    INSERT INTO cobracas (tenant_id, assinatura_id, data_cobranca, valor, stripe_intent_id)
    VALUES (?, ?, ?, ?, ?)
  `).run(tenantId, assinatura.id, new Date().toISOString().split('T')[0], assinatura.valor_mensal, intent.id);
  
  return intent;
}

module.exports = { criarIntencaoPagamento, renovarAssinaturaComCobranca };
```

**Dia 2-3: Webhook do Stripe**
```javascript
// routes/webhooks.js
const express = require('express');
const router = express.Router();
const { db } = require('../db/database');
const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);

router.post('/stripe', express.raw({type: 'application/json'}), (req, res) => {
  const sig = req.headers['stripe-signature'];
  
  let event;
  try {
    event = stripe.webhooks.constructEvent(
      req.body,
      sig,
      process.env.STRIPE_WEBHOOK_SECRET
    );
  } catch (err) {
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }
  
  // Pago***REMOVED***
  if (event.type === 'payment_intent.succeeded') {
    const intent = event.data.object;
    const tenantId = intent.metadata.tenant_id;
    
    db.prepare(`
      UPDATE cobracas 
      SET status = 'pago', data_pagamento = ?, stripe_intent_id = ?
      WHERE tenant_id = ? AND stripe_intent_id = ?
    `).run(
      new Date().toISOString().split('T')[0],
      intent.id,
      tenantId,
      intent.id
    );
    
    // Renovar assinatura para próximos 30 dias
    renovarAssinatura(tenantId);
  }
  
  // Falhou
  if (event.type === 'payment_intent.payment_failed') {
    const intent = event.data.object;
    const tenantId = intent.metadata.tenant_id;
    
    // Notificar cliente + criar retry
    enviarEmailPagamentoFalhou(tenantId);
    agendarRetentativaEmDias(tenantId, 3);
  }
  
  res.json({received: true});
});

router.post('/stripe', async (req, res) => { /* ... */ });

module.exports = router;
```

**Dia 3-4: Lógica de Retry + Bloqueio**
```javascript
// lib/assinatura.js
function verificarEBloquearPorAtraso(tenantId, diasLimite = 7) {
  const cobrancaPendente = db.prepare(`
    SELECT * FROM cobracas
    WHERE tenant_id = ? AND status = 'pendente'
    ORDER BY data_cobranca DESC LIMIT 1
  `).get(tenantId);
  
  if (***REMOVED***cobrancaPendente) return; // Ok
  
  const diasAtraso = Math.floor(
    (new Date() - new Date(cobrancaPendente.data_cobranca)) / (1000*60*60*24)
  );
  
  if (diasAtraso > diasLimite) {
    // Bloquear tenant
    db.prepare('UPDATE tenants SET status = ? WHERE id = ?')
      .run('bloqueado', tenantId);
    
    enviarEmailBloqueio(tenantId);
  }
}

// Rodando a cada 24h:
setInterval(() => {
  const todasCobracas = db.prepare('SELECT DISTINCT tenant_id FROM cobracas WHERE status = ?')
    .all('pendente');
  todasCobracas.forEach(r => verificarEBloquearPorAtraso(r.tenant_id));
}, 24*60*60*1000);
```

**Dia 4-5: Testes no Sandbox Stripe**
- [ ] Cliente se registra
- [ ] Assinatura criada
- [ ] Webhook recebe payment_intent.succeeded
- [ ] Status muda para 'pago'
- [ ] Próxima renovação agendada
- [ ] Payment falha → retry agendado
- [ ] 7 dias depois → tenant bloqueado

### Env vars a adicionar
```bash
STRIPE_SECRET_KEY=sk_test_...
STRIPE_PUBLISHABLE_KEY=pk_test_...
STRIPE_WEBHOOK_SECRET=whsec_...
```

**Esforço:** 5 dias | **Risco de skip:** Crítico ⚠️ (sem receita)

---

## 3️⃣ BLOCKER #3: SEM LGPD DATA EXPORT / DELETION

### O Problema
LGPD Art. 18 (Brasil) exige que cliente possa:
1. **Solicitar seus dados** em formato portável
2. **Solicitar deleção** com período de 30 dias para recuperação

Código atual:
- ✅ Tem DELETE `/api/admin/clientes/:id` (admin deleta)
- ❌ Cliente NÃO pode solicitar deleção
- ❌ Cliente NÃO pode exportar seus dados
- ❌ Deleção é IMEDIATA (sem período de graça)

### Cenário Legal
1. Cliente Daisy pede "quero ver meus dados"
2. Igor não tem endpoint → não consegue cumprir
3. Daisy vai ao LGPD e faz reclamação
4. LGPD notifica Igor; ele tem 10 dias pra responder
5. Igor não consegue provar que dados foram exportados
6. LGPD aplica multa (R$50k - R$500k)

### Como Consertar (Timeline: 3 dias)

**Dia 1: Endpoints de Exportação**
```javascript
// routes/minha-conta.js
router.post('/solicitar-exportacao', exigirLogin, async (req, res) => {
  const tenantId = req.session.tenant_id;
  const usuario = req.session.usuario;
  
  // Gerar token de download (válido por 7 dias)
  const token = crypto.randomBytes(32).toString('hex');
  const expiraEm = new Date(Date.now() + 7*24*60*60*1000).toISOString();
  
  db.prepare(`
    INSERT INTO exportacoes (tenant_id, token, expira_em, criado_em)
    VALUES (?, ?, ?, ?)
  `).run(tenantId, token, expiraEm, new Date().toISOString());
  
  // Enviar email com link
  const linkDownload = `${process.env.SITE_URL}/api/minha-conta/baixar-exportacao?token=${token}`;
  await enviarEmail(usuario, {
    assunto: 'Seus dados em formato portável',
    corpo: `Clique aqui para baixar: <a href="${linkDownload}">Download</a> (válido por 7 dias)`,
  });
  
  // Auditar
  auditarAcao(tenantId, 'exportacao_solicitada', { usuario });
  
  res.json({ ok: true, mensagem: 'Email com link de download enviado' });
});

router.get('/baixar-exportacao', (req, res) => {
  const token = req.query.token;
  
  const exp = db.prepare('SELECT * FROM exportacoes WHERE token = ?').get(token);
  if (***REMOVED***exp) return res.status(404).json({ erro: 'Token inválido' });
  if (new Date() > new Date(exp.expira_em)) return res.status(410).json({ erro: 'Link expirou' });
  
  // Gerar JSON com TODOS os dados do tenant
  const dados = {
    tenant: db.prepare('SELECT * FROM tenants WHERE id = ?').get(exp.tenant_id),
    usuarios: db.prepare('SELECT * FROM usuarios WHERE tenant_id = ?').all(exp.tenant_id),
    produtos: db.prepare('SELECT * FROM produtos WHERE tenant_id = ?').all(exp.tenant_id),
    clientes: db.prepare('SELECT * FROM clientes WHERE tenant_id = ?').all(exp.tenant_id),
    vendas: db.prepare('SELECT * FROM vendas WHERE tenant_id = ?').all(exp.tenant_id),
    // ... todas as tabelas
  };
  
  // Criptografar com AES-256 usando senha do usuário
  const json = JSON.stringify(dados);
  const cipher = crypto.createCipher('aes-256-cbc', req.session.usuario);
  let encrypted = cipher.update(json, 'utf8', 'hex');
  encrypted += cipher.final('hex');
  
  res.setHeader('Content-Type', 'application/octet-stream');
  res.setHeader('Content-Disposition', 'attachment; filename=dados-easygestion.enc');
  res.send(Buffer.from(encrypted, 'hex'));
  
  // Auditar
  auditarAcao(exp.tenant_id, 'exportacao_baixada', { usuario: req.session.usuario });
  
  // Marcar como efetivamente entregue
  db.prepare('UPDATE exportacoes SET baixado_em = ? WHERE id = ?')
    .run(new Date().toISOString(), exp.id);
});
```

**Dia 1-2: Endpoints de Deleção**
```javascript
router.post('/solicitar-delecao', exigirLogin, (req, res) => {
  const tenantId = req.session.tenant_id;
  const { motivo } = req.body || {};
  
  // Marcar como "em processo de deleção"
  db.prepare(`
    UPDATE tenants 
    SET status = 'deletado_em_progresso', deletado_em = ?, motivo_delecao = ?
    WHERE id = ?
  `).run(new Date().toISOString(), motivo, tenantId);
  
  // Agendar hard-delete para 30 dias depois
  const dataDelete = new Date(Date.now() + 30*24*60*60*1000).toISOString();
  db.prepare(`
    INSERT INTO delecoes_agendadas (tenant_id, agendado_para, criado_em)
    VALUES (?, ?, ?)
  `).run(tenantId, dataDelete, new Date().toISOString());
  
  // Email de confirmação (com link para cancelar)
  const linkCancelar = `${process.env.SITE_URL}/api/minha-conta/cancelar-delecao?token=${...}`;
  await enviarEmail(req.session.usuario, {
    assunto: 'Sua conta será deletada em 30 dias',
    corpo: `Sua conta será permanentemente removida em 30 dias. Clique aqui para cancelar: ${linkCancelar}`,
  });
  
  // Auditar
  auditarAcao(tenantId, 'delecao_solicitada', { usuario: req.session.usuario, motivo });
  
  // Deslogar imediatamente
  req.session.destroy();
  
  res.json({ ok: true, mensagem: 'Conta marcada para deleção. Você tem 30 dias para cancelar.' });
});

router.get('/status-delecao', exigirLogin, (req, res) => {
  const tenantId = req.session.tenant_id;
  const agendada = db.prepare('SELECT * FROM delecoes_agendadas WHERE tenant_id = ?').get(tenantId);
  
  if (***REMOVED***agendada) return res.json({ status: 'ativa' });
  
  const diasRestantes = Math.ceil((new Date(agendada.agendado_para) - new Date()) / (24*60*60*1000));
  res.json({
    status: 'deletado_em_progresso',
    diasRestantes,
    deletadoEm: agendada.agendado_para,
  });
});

router.post('/cancelar-delecao', exigirLogin, (req, res) => {
  const tenantId = req.session.tenant_id;
  
  db.prepare('UPDATE tenants SET status = ?, deletado_em = NULL WHERE id = ?')
    .run('ativo', tenantId);
  
  db.prepare('DELETE FROM delecoes_agendadas WHERE tenant_id = ?').run(tenantId);
  
  auditarAcao(tenantId, 'delecao_cancelada', { usuario: req.session.usuario });
  
  res.json({ ok: true, mensagem: 'Deleção cancelada. Sua conta está ativa novamente.' });
});
```

**Dia 2-3: Job de Deleção Real**
```javascript
// lib/alertas-scheduler.js (adicionar ao loop existente):
function deletarTenantsPlanejados() {
  const hoje = new Date().toISOString().split('T')[0];
  
  const pendentes = db.prepare(`
    SELECT * FROM delecoes_agendadas WHERE DATE(agendado_para) <= ?
  `).all(hoje);
  
  pendentes.forEach(d => {
    const tenantId = d.tenant_id;
    
    try {
      // Hard-delete: remover todos os dados
      db.prepare('DELETE FROM variacoes WHERE produto_id IN (SELECT id FROM produtos WHERE tenant_id = ?)')
        .run(tenantId);
      db.prepare('DELETE FROM produtos WHERE tenant_id = ?').run(tenantId);
      db.prepare('DELETE FROM clientes WHERE tenant_id = ?').run(tenantId);
      db.prepare('DELETE FROM vendas WHERE tenant_id = ?').run(tenantId);
      db.prepare('DELETE FROM usuarios WHERE tenant_id = ?').run(tenantId);
      db.prepare('DELETE FROM assinaturas WHERE tenant_id = ?').run(tenantId);
      db.prepare('DELETE FROM cobracas WHERE tenant_id = ?').run(tenantId);
      db.prepare('DELETE FROM config WHERE tenant_id = ?').run(tenantId);
      db.prepare('DELETE FROM tenants WHERE id = ?').run(tenantId);
      
      // Log final (nunca será lido, mas fica no audit trail)
      auditarAcao(tenantId, 'deletado_permanentemente', { sistema: true });
      
      console.log(`✅ Tenant ${tenantId} deletado permanentemente`);
    } catch (err) {
      console.error(`❌ Erro ao deletar tenant ${tenantId}: ${err.message}`);
    }
    
    db.prepare('DELETE FROM delecoes_agendadas WHERE id = ?').run(d.id);
  });
}

// Chamar 1x por dia (idealmente 03h da manhã)
setInterval(deletarTenantsPlanejados, 24*60*60*1000);
```

### Schema de Suporte
```sql
CREATE TABLE IF NOT EXISTS exportacoes (
  id INTEGER PRIMARY KEY,
  tenant_id INTEGER NOT NULL,
  token TEXT UNIQUE NOT NULL,
  expira_em TEXT,
  criado_em TEXT,
  baixado_em TEXT,
  FOREIGN KEY (tenant_id) REFERENCES tenants(id)
);

CREATE TABLE IF NOT EXISTS delecoes_agendadas (
  id INTEGER PRIMARY KEY,
  tenant_id INTEGER UNIQUE NOT NULL,
  agendado_para TEXT,
  criado_em TEXT,
  FOREIGN KEY (tenant_id) REFERENCES tenants(id)
);
```

### Checklist de Testes
- [ ] Cliente solicita exportação
- [ ] Email chega com link
- [ ] Link baixa arquivo .enc
- [ ] Arquivo é criptografado (não abre direto)
- [ ] Arquivo pode ser decriptografado com senha do usuário
- [ ] Cliente solicita deleção
- [ ] Status muda para 'deletado_em_progresso'
- [ ] Cliente deslogado imediatamente
- [ ] Após 30 dias, dados deletados permanentemente
- [ ] Audit trail tem prova de tudo

**Esforço:** 3 dias | **Risco de skip:** Crítico ⚠️ (legal)

---

## 4️⃣ BLOCKER EXTRA: USUARIOS SEM TENANT_ID

### O Problema
```sql
-- usuarios table MISSING tenant_id column
CREATE TABLE IF NOT EXISTS usuarios (
  id INTEGER PRIMARY KEY,
  nome TEXT NOT NULL,
  email TEXT NOT NULL UNIQUE,
  senha_hash TEXT,
  papel TEXT, -- 'admin', 'vendedor', 'relacionamento'
  ativo INTEGER DEFAULT 1,
  criado_em TEXT
  -- ❌ MISSING: tenant_id
);
```

### Impacto
- Admin vê lista de TODOS os usuários de TODOS os tenants
- Admin pode trocar papel de usuário de outro tenant
- Nomes de usuários são globais (não pode ter 2 "Daisy" em tenants diferentes)

### Como Consertar (2 dias)
```sql
-- Adicionar coluna
ALTER TABLE usuarios ADD COLUMN tenant_id INTEGER NOT NULL DEFAULT 1;

-- Remover unique constraint global de email
DROP INDEX UNIQUE(email);
-- Criar unique COMBINADO (email por tenant)
CREATE UNIQUE INDEX idx_usuarios_tenant_email ON usuarios(tenant_id, email);

-- Todos os queries adicionar filtro:
SELECT * FROM usuarios WHERE tenant_id = ? AND papel = ?
```

**Esforço:** 2 dias | **Risco de skip:** Crítico ⚠️

---

## 5️⃣ OUTROS PROBLEMAS ALTOS

### venda_pagamentos sem tenant_id
**Impacto:** Pagamentos de Cliente A podem ser vistos/modificados por Cliente B  
**Fix:** 1 dia  
**Checklist:** Add tenant_id column; filter all queries

### Backup não criptografado
**Impacto:** `/api/backup/baixar` retorna SQLite plain-text com todos os dados  
**Fix:** 2 dias (adicionar AES-256 encryption; testar decryptação)

### Sem rate limit POR TENANT
**Impacto:** Um cliente faz 600 req/15min, bloqueia todos os outros  
**Fix:** 1 dia (modificar middleware para usar `tenant_id` como chave de rate limit)

### Sem validação de magic bytes em upload
**Impacto:** Cliente faz upload de `.jpg` que é PNG; navegador executa como script  
**Fix:** 1 dia (usar package `file-type` + `sharp` pra validar/processar)

---

## TIMELINE REALISTA

| Semana | Dia | Tarefas |
|--------|-----|---------|
| **Sem 1** | 1-2 | Estoque tenant isolation (blocker #1) |
| | 3 | Usuarios tenant_id + venda_pagamentos |
| | 4-5 | Rate limit per tenant + validação uploads |
| | 6 | QA + testes |
| **Sem 2** | 7-9 | Stripe integration + webhooks (blocker #2) |
| | 10 | Payment retry + dunning logic |
| | 11-12 | Testes sandbox + live mode |
| **Sem 3** | 13-15 | LGPD data export + deletion (blocker #3) |
| | 16 | Backup encryption |
| | 17 | QA completa |
| **Sem 4** | 18-20 | Deploy staging + UAT |
| | 21+ | Deploy produção + monitoring |

**Total:** 3-4 semanas até launch

---

## SCORECARD FINAL

| Categoria | Nota | Status | Top Issue |
|-----------|------|--------|-----------|
| **Completude do Produto** | 6/10 | 70% | Stripe missing |
| **Segurança** | 2/10 | 🔴 CRÍTICO | Estoque cross-tenant |
| **Ops SaaS** | 3/10 | Gaps | Sem billing automation |
| **Escalabilidade** | 5/10 | SQLite limit | Migrate PostgreSQL mês 12 |
| **LGPD/Compliance** | 2/10 | 🔴 CRÍTICO | Sem export/delete flow |
| **UX/Onboarding** | 5/10 | Funciona | Sem guia setup |
| **PRONTIDÃO PARA LANÇAMENTO** | **3/10** | **BLOQUEADO** | Fix top 3 blockers |

---

## RECOMENDAÇÃO FINAL

### ❌ NÃO LANCE AINDA

**Se lançar agora:**
- Clientes pagantes = 0 (sem Stripe)
- Dato 7: primeiro cliente descobre que vê dados de concorrente (estoque)
- Data 14: LGPD recebe reclamação de falta de data export
- Data 21: CEO entrega multa de R$50k

### ✅ LANCE QUANDO

1. ✅ Estoque isolado por tenant (teste: two tenants, zero data leakage)
2. ✅ Stripe workflow E2E funcionando (sandbox → live com test card)
3. ✅ Data export + 30-day deletion working (audit trail prova compliance)
4. ✅ Usuarios tenant-scoped
5. ✅ venda_pagamentos criptografado no backup
6. ✅ Rate limit per tenant (um cliente não DDoS os outros)

**Realista:** 3-4 semanas. Não tira olho. Foco total.

---

## PRÓXIMOS PASSOS (Hoje)

- [ ] Ler este documento por inteiro (não pule***REMOVED***)
- [ ] Marcar blocker #1, #2, #3 como "IN PROGRESS" no projeto
- [ ] Alocar 3-4 semanas SEM outras tarefas
- [ ] Setup Stripe test account (30min)
- [ ] Começar com blocker #1 (estoque) amanhã
- [ ] Daily standup: qual blocker foi resolvido

---

**Auditoria por:** Arquiteto SaaS Sênior  
**Data:** 2026-06-22  
**Status:** BLOQUEADO PARA LANÇAMENTO  
**CTO Sign-off Necessário:** SIM
