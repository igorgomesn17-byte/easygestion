# ⚠️ AUDITORIA SIMPLIFICADA — PRONTO PARA BETA?

**Data:** 2026-06-24  
**Pergunta:** Está bom para liberar para 5-10 testers?  
**Resposta:** SIM, com 5 testes críticos antes

---

## ✅ O QUE ESTÁ PRONTO (De Verdade)

```
✅ Autenticação (login, registro, hash scrypt)
✅ Produtos (cadastro, foto, variação por tamanho)
✅ Estoque (controle por tamanho, movimentos)
✅ Vendas (múltiplas formas, parcelamento, taxa automática)
✅ Trocas (devolução + levada, cálculo diferença)
✅ Clientes (cadastro básico, histórico)
✅ Caixa (abertura/fechamento, conciliação)
✅ Financeiro (fluxo + DRE básico)
✅ Despesas (entrada de custos fixos)
✅ Configuração (taxas, dados da loja)
✅ Auditoria (logs de ações)
✅ Assinaturas Stripe (checkout session)
✅ Cobrança (scheduler, bloqueio por atraso)
✅ Backup S3 (com criptografia AES-256)
✅ LGPD Delete (grace period 30 dias)
✅ Health check (/health endpoint)
✅ Multi-tenancy (isolamento por tenant_id)
```

---

## ❌ O QUE NÃO EXISTE (Cuidado)

```
❌ Inbox/CRM (schema existe, ZERO rotas)
❌ WhatsApp/Instagram (schema existe, zero integração)
❌ NFCe (schema existe, precisa integração Focus real)
❌ Onboarding visual (modo guiado não existe)
❌ Suporte (sem chat, sem FAQ)
❌ Mobile responsivo (não testado)
❌ Relatórios de exportação (não verificado)
```

---

## 🧪 5 TESTES CRÍTICOS (Fazer HOJE antes de liberar)

### TESTE 1: Assinatura Stripe End-to-End (2 horas)

**Cenário:**
```
1. Registre cliente teste: teste-beta@easygestion.test
2. Login
3. Clique em "Plano" ou "Assinatura"
4. Inicie checkout Stripe
5. Use cartão de teste: 4242 4242 4242 4242 (válido)
6. Confirme pagamento
7. Volta para app: mostra "Assinatura ativa"?
8. Verifique DB: webhook criou entrada em assinaturas?
```

**Passa se:**
- ✅ Checkout funciona
- ✅ Webhook recebe evento Stripe
- ✅ Banco atualiza `assinaturas.stripe_subscription_id`
- ✅ Cliente não vê bloqueio

**Falha se:**
- ❌ Checkout 404 ou erro
- ❌ Webhook não recebe
- ❌ Banco não atualiza
- ❌ Cliente fica bloqueado depois

---

### TESTE 2: Cobrança Automática (Simulada) (2 horas)

**Cenário:**
```
1. Crie cliente com assinatura vencendo HOJE
2. Chame scheduler manualmente:
   node scripts/backup-scheduler.js
   (ou equivalent para cobrança)
3. Verifique: cliente foi bloqueado ou renovado?
4. Cheque DB: status do tenant é 'bloqueado' ou 'ativo'?
5. Tente fazer login como cliente
```

**Passa se:**
- ✅ Scheduler roda sem erro
- ✅ Tenant fica "bloqueado" (não deletado)
- ✅ Cliente não consegue fazer login
- ✅ Erro é claro (404 ou "Conta bloqueada")

**Falha se:**
- ❌ Scheduler trava
- ❌ Tenant é deletado (cascata quebra)
- ❌ Login ainda funciona (isolamento falhado)

---

### TESTE 3: Backup + Restore (2 horas)

**Cenário:**
```
1. Crie alguns dados (3 vendas, 2 clientes)
2. Chame backup manualmente
3. Verifique S3: arquivo existe como .db.enc?
4. Baixe arquivo .db.enc
5. Tente abrir em editor: é ilegível? (bom)
6. Simule restore:
   - Descriptr arquívo .db.enc
   - Recrie DB novo
   - Verifique dados: está igual ao original?
```

**Passa se:**
- ✅ Arquivo .db.enc criado
- ✅ Arquivo é ilegível (criptografado)
- ✅ Restore descriptografa corretamente
- ✅ Dados recuperados = dados originais

**Falha se:**
- ❌ Arquivo não é criptografado
- ❌ Restore falha
- ❌ Dados perdidos

---

### TESTE 4: LGPD Delete (1 hora)

**Cenário:**
```
1. Registre cliente: teste-lgpd@test.com
2. Crie alguns dados (1 venda)
3. Login como cliente
4. Vá em "Minha Conta" ou similar
5. Clique "Solicitar deleção"
6. Confirme com senha
7. Verifique DB:
   - Tenant status = 'cancelado'?
   - Entrada em delecoes_agendadas criada?
   - agendado_para = hoje + 30 dias?
8. Tente fazer login: falha? (bom)
```

**Passa se:**
- ✅ Endpoint /api/me/conta funciona
- ✅ Tenant fica "cancelado"
- ✅ Entrada em delecoes_agendadas criada
- ✅ Login falha
- ✅ Email de confirmação enviado (se SendGrid está setup)

**Falha se:**
- ❌ Endpoint 404
- ❌ Tenant é deletado imediatamente
- ❌ delecoes_agendadas não criada

---

### TESTE 5: Básicos Não Quebram (1 hora)

**Cenário:**
```
1. Login como admin (senha local)
2. Cadastre produto: "Blusa Rosa - Teste"
   - Código: BLUSA001
   - Custo: R$ 20
   - Preço: R$ 60
   - Tamanho: P (1 unidade)
3. Vá para Vendas → Nova venda
4. Procure "Blusa Rosa"
5. Selecione P (quantidade 1)
6. Selecione cliente (novo ou existente)
7. Selecione Pix (taxa 0%)
8. Finalize venda
9. Vá para Financeiro → Fluxo
10. Verifique DRE mostra:
    - Receita: R$ 60
    - Custo: R$ 20
    - Lucro: R$ 40
```

**Passa se:**
- ✅ Produto cadastrado
- ✅ Venda criada sem erro
- ✅ Estoque baixou (P tem 0)
- ✅ DRE mostra números corretos

**Falha se:**
- ❌ Erro 500 em qualquer passo
- ❌ Estoque não baixou
- ❌ DRE está errado (ex: lucro = -10)

---

## 📋 CHECKLIST PRÉ-BETA

Faça isto ANTES de enviar para testers:

```
✅ TESTE 1: Assinatura Stripe funciona ponta a ponta
   ☐ Checkout abre
   ☐ Webhook recebe evento
   ☐ DB atualiza
   ☐ Cliente acessa após pagar

✅ TESTE 2: Cobrança automática funciona
   ☐ Scheduler roda
   ☐ Tenant fica "bloqueado" (não deletado)
   ☐ Login falha com mensagem clara
   ☐ Sem data corruption

✅ TESTE 3: Backup + Restore funciona
   ☐ .db.enc criado
   ☐ Arquivo é ilegível
   ☐ Restore descriptografa
   ☐ Dados recuperados

✅ TESTE 4: LGPD Delete funciona
   ☐ Endpoint /api/me/conta existe
   ☐ Tenant muda para "cancelado"
   ☐ delecoes_agendadas criada
   ☐ Login falha

✅ TESTE 5: Básicos não quebram
   ☐ Login funciona
   ☐ Produto criado
   ☐ Venda criada
   ☐ Estoque baixou
   ☐ DRE correto

TUDO PASSOU? → Libera para Beta
ALGO FALHOU? → Voltar pro dev, não libera
```

---

## 🚀 COMO LIBERAR PARA BETA

**Quando:** Depois que os 5 testes passarem

**Para quem:** 5-10 clientes que você conhece
- Empresários de loja (que entendem varejo)
- Dispostos a dar feedback honesto
- Em troca de acesso grátis por 30 dias

**Como:**
1. Envie link: https://easygestion.com (ou seu servidor)
2. Crie conta de teste para eles (ou eles registram)
3. Crie grupo WhatsApp: "EasyGestão Beta"
4. Responda dúvidas em <2h
5. Peça feedback toda semana

**O que avisar:**
- "Isto é BETA, pode quebrar"
- "Não coloque dados reais críticos"
- "Se encontrar bug, avisa no WhatsApp"
- "Teste isso: cadastro produto, fazer venda, ver DRE"

---

## ⏱️ TIMELINE

```
2026-06-24 (HOJE)
├─ Fazer 5 testes críticos (6 horas)
└─ Se tudo passar → Próximo passo

2026-06-25
├─ Escolher 5 clientes beta
├─ Criar conta para eles
└─ Liberar acesso + WhatsApp

2026-06-25 a 2026-07-24 (4 semanas)
├─ Beta rodando
├─ Você respondendo dúvidas
├─ Coletando feedback
└─ Corrigindo bugs críticos

2026-07-25+
└─ Lançamento oficial (pago)
```

---

## 💰 EXPECTATIVA DE CUSTO

Se passar nos 5 testes:
- Você gasta 10-20h com suporte beta (4 semanas)
- Clientes encontram bugs (você corrige)
- Depois lança com confiança

Se falhar em algum teste:
- Você gasta 4-8h corrigindo
- Depois testa de novo
- Depois libera

**Custo total: 20-40 horas de você ou dev**

---

## 🎯 VEREDITO

**Liberação para Beta: SIM, mas faz os 5 testes antes.**

Se os 5 passarem → está seguro liberar.
Se algum falhar → não libera ainda.

**Não é "perfeito", mas é testado e funcional.**

---

**Próximo passo:** Rodar os 5 testes hoje. Vai levar ~8-10 horas.

Você quer que eu prepare scripts para rodar esses testes automaticamente?
