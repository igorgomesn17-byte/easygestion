// ============================================================
// O webhook do Stripe tem que saber DE QUEM é o pagamento.
//
// Os eventos de renovação (invoice.payment_succeeded etc.) recebem a SUBSCRIPTION, não
// a session do checkout. O código lia subscription.metadata.tenant_id — que nunca era
// gravado (só ia pra Session e pro Customer). Resultado: tenantId=null → break → a
// renovação do cliente PAGANTE nunca rodava, e em ~31 dias ele era bloqueado como
// inadimplente. Dinheiro real, em produção LIVE.
//
// tenantDaSubscription() conserta com dois caminhos: metadata (novos) e fallback por
// stripe_customer_id (os que já existem, que nunca terão metadata). Este teste cobre
// os três casos, incluindo o que representa a produção de hoje: SEM metadata.
//
//   node tests/webhook-tenant-do-pagamento.test.js
// ============================================================
process.env.DB_DIR = process.env.DB_DIR || './tests/.tmp-webhook';
const fs = require('fs');
const path = require('path');

const dir = path.resolve(process.env.DB_DIR);
if (fs.existsSync(dir)) fs.rmSync(dir, { recursive: true, force: true });
fs.mkdirSync(dir, { recursive: true });

const { db } = require('../db/database');
const { tenantDaSubscription } = require('../lib/stripe');

let falhas = 0;
function ok(desc, cond, extra = '') {
  if (cond) console.log(`  ✅ ${desc}`);
  else { console.log(`  ❌ ${desc}${extra ? ' → ' + extra : ''}`); falhas++; }
}

console.log('\n🔗 TESTE: o webhook descobre o tenant dono do pagamento\n');

// Duas lojas, cada uma com seu customer no Stripe. É o estado real da produção:
// assinaturas antigas, criadas SEM tenant_id na subscription.
db.prepare(`INSERT INTO tenants (id, nome_loja, nome_responsavel, telefone, email, senha_hash, plano, status, stripe_customer_id)
  VALUES (?, ?, ?, ?, ?, 'x', 'growth', 'ativo', ?)`)
  .run(50, 'Loja Cinquenta', 'Resp', '73900000050', 'l50@x.com', 'cus_LOJA50');
db.prepare(`INSERT INTO tenants (id, nome_loja, nome_responsavel, telefone, email, senha_hash, plano, status, stripe_customer_id)
  VALUES (?, ?, ?, ?, ?, 'x', 'starter', 'ativo', ?)`)
  .run(51, 'Loja Cinquenta e Um', 'Resp', '73900000051', 'l51@x.com', 'cus_LOJA51');

// 1. Caminho novo: metadata carimbado na subscription. É o mais barato (não bate no banco).
ok('metadata.tenant_id presente → usa ele',
  tenantDaSubscription({ id: 'sub_1', customer: 'cus_LOJA50', metadata: { tenant_id: '51' } }) === 51,
  'deveria priorizar o metadata');

// 2. O CASO DA PRODUÇÃO: sem metadata (assinatura antiga). Cai no fallback por customer.
ok('sem metadata, customer conhecido (string) → acha pelo stripe_customer_id',
  tenantDaSubscription({ id: 'sub_2', customer: 'cus_LOJA50', metadata: {} }) === 50,
  'o fallback por customer não achou o tenant — clientes atuais ficariam órfãos');

// 2b. O Stripe às vezes manda o customer expandido (objeto), não só o id.
ok('customer como objeto {id} → também acha',
  tenantDaSubscription({ id: 'sub_3', customer: { id: 'cus_LOJA51' }, metadata: {} }) === 51);

// 2c. Sem metadata E sem customer conhecido → null (não adivinha, não casa errado).
ok('customer desconhecido → null (não casa com a loja errada)',
  tenantDaSubscription({ id: 'sub_4', customer: 'cus_FANTASMA', metadata: {} }) === null);

// 3. Nada pra ir → null, sem estourar.
ok('subscription sem customer nem metadata → null (não quebra)',
  tenantDaSubscription({ id: 'sub_5' }) === null);

// 4. Prova que NÃO casa com a loja errada: o customer da loja 51 nunca retorna 50.
ok('o customer da loja 51 resolve pra 51, nunca pra 50 (sem vazamento)',
  tenantDaSubscription({ id: 'sub_6', customer: 'cus_LOJA51', metadata: {} }) === 51);

// ---- Idempotência: o retry do Stripe não pode processar o evento 2x ----
// A rota reserva o event_id ANTES de processar; o UNIQUE(event_id) é o cadeado. Em
// invoice.payment_succeeded, processar 2x = renovarAssinatura() 2x = +30 dias grátis.
console.log('');
const evt = 'evt_retry_' + Date.now();
const reservar = () => {
  try {
    db.prepare('INSERT INTO stripe_webhooks (event_id, event_type, processed_at, manual_review) VALUES (?,?,?,0)')
      .run(evt, 'invoice.payment_succeeded', Date.now());
    return 'processa';
  } catch (e) {
    if (/UNIQUE constraint/i.test(e.message)) return 'recusado';
    throw e;
  }
};
const primeiro = reservar();
const segundo = reservar();
ok('1º envio reserva e processa', primeiro === 'processa');
ok('2º envio (retry do Stripe) é recusado pela idempotência — sem mês grátis',
  segundo === 'recusado', `2º envio retornou "${segundo}"`);

console.log(falhas === 0 ? '\n✅ PASSOU\n' : `\n❌ ${falhas} FALHA(S)\n`);
process.exit(falhas === 0 ? 0 : 1);
