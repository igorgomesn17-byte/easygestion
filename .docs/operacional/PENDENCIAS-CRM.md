# Pendências do CRM comercial + atacado

> Aberto em 28/07/2026. Branch `crm-comercial`. **Nada deployado ainda** — `main` intacta.
> Atualizar conforme as fases avançam.

---

## 🔴 Bloqueia o uso real (sem isto, o construído não roda)

### 1. Instância da Evolution API no ar
O lado do Easy está pronto ([lib/whatsapp.js](../../lib/whatsapp.js) + adaptador). Falta
**infraestrutura**: uma instância Evolution rodando (VPS, Docker) com um número
**dedicado à loja** — nunca o pessoal. Depois é só colar endereço, instância e token
em `canal.html`, e apontar o webhook (`MESSAGES_UPSERT`) pra URL que a tela mostra.

### 2. Credencial do Mercado Pago + webhook
O Pix usa a MESMA credencial da maquininha (`integracoes_pagamento`), mas **não existe
tela pra conectá-la fora do contexto Point**. Falta:
- conectar a conta MP do tenant
- apontar o webhook do painel MP pra `/api/webhooks/mercadopago`

---

## 🟠 Importante, mas não bloqueia

### 6b. Ficha 360º da cliente
Planejada na fase 3, **não construída**. Os dados seguem espalhados em 5 tabelas
(compras, selos, cupons, pedidos, conversas) sem tela que junte. A conversa já mostra
valor e nº de compras no card — é o mínimo, não a ficha.

### 6c. Comissão sobre valor recuperado
O placar já calcula `valor_recuperado` por pessoa. Falta ligar `usuarios` ↔ `vendedores`
(tabelas separadas que não se conversam) pra virar comissão de verdade.

### 6d. Bot: sem LLM para o que sai do menu
A v1 é 100% regra — quando a mensagem foge do previsto, ele **transfere** (que é o
comportamento certo de qualquer forma). Um LLM só pro caso "fora do escopo" reduziria
transferência desnecessária. Avaliar depois de ver o volume real de transferências.

### 7. Carrinho abandonado só pega cliente já cadastrada
`crm_acoes.cliente_id` tem FK, então pedido anônimo não vira ação — aparece só na aba de
Pedidos. Decisão consciente; revisitar se o volume anônimo for alto.

### 8. Reserva não cobre item sem variação
Peça sem grade (`variacao_id NULL`) não é reservada. Raro no atacado (tudo tem grade),
mas é um furo silencioso se acontecer.

---

## 🟡 Dívida técnica assumida

### 9. Evolution é não-oficial — risco de banimento
Decisão do Igor, ciente. O envio está isolado atrás de interface: trocar pra Cloud API
oficial = escrever um adaptador irmão, sem tocar no CRM. **Não** exige refatoração.

### 10. `atualizarCaixaDia` chamado via `require` circular
[lib/pedido-venda.js](../../lib/pedido-venda.js) importa de `routes/vendas` dentro de
try/catch. Funciona, mas o certo é extrair pra `lib/`. Se falhar, a venda continua correta
e o caixa se acerta na próxima.

### 11. Sem retry de envio
Mensagem que falha devolve `ok:false` e a tela avisa — mas não há fila de reenvio
automático. Aceitável enquanto o volume é baixo.

---

## ⚪️ Fora de escopo (registrado, não esquecido)

- **Dashboard de métricas de anúncios** dentro do Easy — ideia do Igor em 28/07.
- **Cartão de crédito** — decisão foi Pix sozinho. Quando entrar: MP primeiro (infra
  pronta), Pagar.me depois. Verificar antes: pesquisa indica que **Pagar.me não tem split**.
- **Definir preço/nome do Enterprise** — segue oculto. Pode virar dois planos (varejo ×
  atacadista); as features já nascem separadas pra permitir isso.
- **Ligar CRM/atacado no Growth** — só depois de a DS Store validar como cliente-zero.

---

## ✅ Feito (para não reabrir)

- Migrations 046, 047, 048 — testadas contra cópia do banco, idempotentes
- Papel `relacionamento` abre a tela de CRM (era `apenasAdmin`)
- Canal de WhatsApp: envio, recebimento, dedup, prospect automático
- Régua envia do painel; resposta da cliente carimba `respondeu_em`
- Gatilhos `CARRINHO` e `CATALOGO_SEMANAL`
- Reserva de estoque, Pix, pedido→venda idempotente
- `crm_avancado` e `atacado` no Enterprise (que **continua** oculto)
- Kanban de prospecção (arrastar, assumir sem roubo, transferir) + tela
- Bot de SAC: nunca dá desconto, nunca inventa, roteia C1/C2 pelo MCC, cala quando
  humano assume
- Placar por pessoa e da loja, com leitura em português do que os números dizem
- **Checkout da vitrine** (29/07): cadastro no fechamento com excursão por autocomplete,
  QR do Pix com copia-e-cola, relógio da reserva, polling de confirmação, e a tela que
  diz QUAL peça acabou quando o estoque some no meio
- **Despacho** (29/07): pedidos pagos agrupados por excursão, marcar como despachado,
  CRUD de excursões e **fusão de duplicata** ("Van do João" + "Excursão João" → uma só)
- **Etiqueta de envio** (29/07): 100×150mm, uma por folha, excursão como bloco principal
  (é o destino real), código de barras do pedido. Migration **049** (`despachado_em`)
- **Cadência semanal configurável** na tela de Contatos do dia (nasce desligada)
- Testes: `test:whatsapp` (69), `test:canal` (28), `test:atacado` (46), `test:bot` (43).
  Suíte: **15 arquivos**

---

## 📌 Contexto legal registrado (não afeta hoje)

Desde **06/04/2026** a Declaração de Conteúdo eletrônica (DC-e) é obrigatória para envio
**sem nota fiscal**, e a declaração em papel deixou de valer — exige XML assinado e
autorizado pelo Fisco, e o que acompanha o pacote vira o DACE com QR Code.

**Não afeta este caso:** a mercadoria vai pra excursão (não Correios) e a loja emite
NFC-e. Mas seria bloqueador em despacho por transportadora sem nota.
