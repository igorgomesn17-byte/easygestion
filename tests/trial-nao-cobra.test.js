// ============================================================
// O trial vence, bloqueia, e NÃO gera cobrança. O pago SIM renova.
//
// O fluxo desenhado: o cliente entra no Growth completo por 14 dias; quando o trial
// acaba, o sistema BLOQUEIA e o convida a escolher/pagar um plano. O trial NÃO deve
// virar cobrança nem se auto-renovar.
//
// O bug: o job de renovação (lib/renovacao-scheduler.js) pegava QUALQUER assinatura
// vencida hoje, sem olhar em_teste. No dia 14 o registro de trial (em_teste=1) casava,
// e o job (a) criava uma cobrança de R$119,90 por um teste grátis e (b) empurrava a
// data +30d — o que QUEBRAVA o bloqueio (obterStatusAssinatura via a data à frente e
// não bloqueava). O cliente ganhava 30 dias de Growth grátis em vez de ir pra tela de
// planos. Conserto: filtrar em_teste = 0 na query do job.
//
//   node tests/trial-nao-cobra.test.js
// ============================================================
process.env.DB_DIR = process.env.DB_DIR || './tests/.tmp-trial';
const fs = require('fs');
const path = require('path');

const dir = path.resolve(process.env.DB_DIR);
if (fs.existsSync(dir)) fs.rmSync(dir, { recursive: true, force: true });
fs.mkdirSync(dir, { recursive: true });

const { db } = require('../db/database');
const { procesarRenovacoes } = require('../lib/renovacao-scheduler');
const { obterStatusAssinatura } = require('../lib/assinatura');

let falhas = 0;
function ok(desc, cond, extra = '') {
  if (cond) console.log(`  ✅ ${desc}`);
  else { console.log(`  ❌ ${desc}${extra ? ' → ' + extra : ''}`); falhas++; }
}

const hoje = new Date().toISOString().split('T')[0];

function novoTenant(id, email) {
  db.prepare(`INSERT INTO tenants (id, nome_loja, nome_responsavel, telefone, email, senha_hash, plano, status)
    VALUES (?, ?, 'R', '7390000000', ?, 'x', 'growth', 'ativo')`).run(id, 'Loja ' + id, email);
}

console.log('\n🎟️  TESTE: o trial vence e bloqueia, sem cobrar\n');

// Tenant 60: em TRIAL, vencendo HOJE (o dia 14). É o que dispara o bug.
novoTenant(60, 't60@x.com');
db.prepare(`INSERT INTO assinaturas (tenant_id, plano, valor_mensal, data_inicio, data_proxima_renovacao, em_teste)
  VALUES (?, 'growth', 119.90, ?, ?, 1)`).run(60, hoje, hoje);

// Tenant 61: assinatura PAGA (em_teste=0), vencendo HOJE. Tem que ser cobrada+renovada.
novoTenant(61, 't61@x.com');
db.prepare(`INSERT INTO assinaturas (tenant_id, plano, valor_mensal, data_inicio, data_proxima_renovacao, em_teste)
  VALUES (?, 'growth', 119.90, ?, ?, 0)`).run(61, hoje, hoje);

// Roda o job (é síncrono).
procesarRenovacoes();

// --- Trial (60): nada de cobrança, e a data NÃO foi empurrada ---
const cobrancaTrial = db.prepare("SELECT COUNT(*) n FROM cobracas WHERE tenant_id = 60").get().n;
ok('trial NÃO gerou cobrança', cobrancaTrial === 0, `gerou ${cobrancaTrial}`);

const assinTrial = db.prepare('SELECT data_proxima_renovacao FROM assinaturas WHERE tenant_id = 60').get();
ok('trial NÃO teve a data empurrada (não se auto-renovou)',
  assinTrial.data_proxima_renovacao === hoje,
  `data virou ${assinTrial.data_proxima_renovacao}`);

// E o status: como a data venceu hoje e ninguém renovou, amanhã já é VENCIDA. Testo com
// uma data de vencimento no passado pra confirmar que o bloqueio dispara.
db.prepare("UPDATE assinaturas SET data_proxima_renovacao = date('now','-1 day') WHERE tenant_id = 60").run();
const statusTrial = obterStatusAssinatura(60);
ok('trial vencido → status VENCIDA e bloqueado (vai pra tela de planos)',
  statusTrial.status === 'vencida' && statusTrial.bloqueado === true,
  `status=${statusTrial.status} bloqueado=${statusTrial.bloqueado}`);

// --- Pago (61): cobrado e renovado, como deve ---
const cobrancaPago = db.prepare("SELECT valor FROM cobracas WHERE tenant_id = 61").all();
ok('assinatura paga FOI cobrada (R$119,90)',
  cobrancaPago.length === 1 && cobrancaPago[0].valor === 119.90,
  JSON.stringify(cobrancaPago));

const assinPago = db.prepare('SELECT data_proxima_renovacao FROM assinaturas WHERE tenant_id = 61').get();
ok('assinatura paga teve a data renovada (+30d)',
  assinPago.data_proxima_renovacao > hoje,
  `data=${assinPago.data_proxima_renovacao}`);

// O job chamava criarAlerta(), mas a função NUNCA existiu em lib/alertas.js: toda
// renovação estourava "criarAlerta is not a function" DEPOIS de já ter cobrado —
// caía no catch e contava como erro. Nunca deu na vista porque nunca houve renovação
// real. Se o alerta existe, é porque o job rodou até o fim sem estourar.
const alerta = db.prepare("SELECT tipo, valor_em_risco FROM alertas_clientes WHERE tenant_id = 61 AND tipo = 'cobranca_pendente'").get();
ok('o job rodou até o fim e registrou o alerta (criarAlerta existe)',
  !!alerta && alerta.valor_em_risco === 119.90,
  alerta ? JSON.stringify(alerta) : 'nenhum alerta — o job estourou antes');

// Idempotência: o job roda no boot E no horário. Um reboot no dia da cobrança não
// pode duplicar o alerta.
const { criarAlerta } = require('../lib/alertas');
criarAlerta(61, 'cobranca_pendente', { valor_em_risco: 119.90, mensagem: 'de novo' });
const qtdAlertas = db.prepare("SELECT COUNT(*) n FROM alertas_clientes WHERE tenant_id = 61 AND tipo = 'cobranca_pendente'").get().n;
ok('criarAlerta é idempotente no mesmo dia (reboot não duplica)', qtdAlertas === 1, `${qtdAlertas} alertas`);

console.log(falhas === 0 ? '\n✅ PASSOU\n' : `\n❌ ${falhas} FALHA(S)\n`);
process.exit(falhas === 0 ? 0 : 1);
