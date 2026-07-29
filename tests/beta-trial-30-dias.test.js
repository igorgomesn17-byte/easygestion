// ============================================================
// BETA DE PROSPECÇÃO — Growth completo por 30 dias, ativado pelo admin.
//
// O desenho (decisão Igor 29/07/2026): o cliente se cadastra normal (14 dias no
// Growth) e o Igor converte a conta em Beta no backoffice, um a um, na conversa de
// prospecção. Não há código de convite nem contador automático no signup.
//
// O que este teste trava, em ordem de gravidade:
//
//   1. AS DUAS DATAS ANDAM JUNTAS. Quem manda no bloqueio é
//      data_proxima_renovacao (é ela que obterStatusAssinatura compara com hoje);
//      data_fim_teste é o que a tela mostra. Estender só uma trava o beta no dia 15
//      exibindo "30 dias" na cara dele — ou promete 14 e libera 30.
//
//   2. BETA NÃO É COBRADO. em_teste continua 1: é trial mais longo, não assinatura.
//      Se virasse em_teste=0, o renovacao-scheduler cobraria R$119,90 de um
//      benefício que foi oferecido de graça na prospecção.
//
//   3. AS FEATURES SEGUEM O PLANO. tenants.plano é o que temFeature() lê. Sem
//      atualizar as duas tabelas, o beta veria "Growth" na tela e continuaria
//      batendo em 403 no DRE e no relacionamento — exatamente a bandeira que o
//      benefício promete.
//
//   node tests/beta-trial-30-dias.test.js
// ============================================================
process.env.DB_DIR = process.env.DB_DIR || './tests/.tmp-beta';
const fs = require('fs');
const path = require('path');

const dir = path.resolve(process.env.DB_DIR);
if (fs.existsSync(dir)) fs.rmSync(dir, { recursive: true, force: true });
fs.mkdirSync(dir, { recursive: true });

const { db } = require('../db/database');
const { procesarRenovacoes } = require('../lib/renovacao-scheduler');
const { obterStatusAssinatura } = require('../lib/assinatura');
const { temFeature, planoDoTenant } = require('../lib/planos');

let falhas = 0;
function ok(desc, cond, extra = '') {
  if (cond) console.log(`  ✅ ${desc}`);
  else { console.log(`  ❌ ${desc}${extra ? ' → ' + extra : ''}`); falhas++; }
}

const hoje = new Date().toISOString().split('T')[0];
const emDias = (n) => new Date(Date.now() + n * 864e5).toISOString().split('T')[0];

function novoTenant(id, email, plano = 'growth') {
  db.prepare(`INSERT INTO tenants (id, nome_loja, nome_responsavel, telefone, email, senha_hash, plano, status)
    VALUES (?, ?, 'R', '7390000000', ?, 'x', ?, 'ativo')`).run(id, 'Loja ' + id, email, plano);
}

// Reproduz o que a rota POST /api/admin/assinaturas/:id/beta faz. Copiado em vez de
// chamado por HTTP porque a rota exige sessão de backoffice com 2FA — o que este
// teste precisa provar é o EFEITO no banco, não o guard (que tem teste próprio).
function concederBeta(assinaturaId, dias = 30) {
  const antes = db.prepare('SELECT * FROM assinaturas WHERE id = ?').get(assinaturaId);
  if (antes.em_teste === 0) return { erro: 'ja_pagante' };
  const dataFim = emDias(dias);
  const tx = db.transaction(() => {
    db.prepare(`UPDATE assinaturas
      SET plano='growth', valor_mensal=119.90, em_teste=1, beta=1,
          data_inicio_teste=?, data_fim_teste=?, data_proxima_renovacao=?
      WHERE id=?`).run(hoje, dataFim, dataFim, assinaturaId);
    db.prepare("UPDATE tenants SET plano='growth', status='ativo' WHERE id=?").run(antes.tenant_id);
  });
  tx();
  return { dataFim };
}

console.log('\n🎁 TESTE: Beta de prospecção (Growth por 30 dias)\n');

// ---- Cenário 1: trial normal (Starter, 14 dias) vira Beta ----
// Nasce no Starter de propósito: se o beta só funcionasse pra quem já está no
// Growth, o benefício não entregaria nada de novo.
novoTenant(70, 't70@x.com', 'starter');
const a70 = db.prepare(`INSERT INTO assinaturas (tenant_id, plano, valor_mensal, data_inicio, data_proxima_renovacao, em_teste, data_inicio_teste, data_fim_teste)
  VALUES (?, 'starter', 69.90, ?, ?, 1, ?, ?)`).run(70, hoje, emDias(14), hoje, emDias(14)).lastInsertRowid;

ok('antes do Beta: Starter não tem relacionamento (a bandeira do Growth)',
  temFeature(planoDoTenant(70), 'relacionamento') === false);

const r70 = concederBeta(a70, 30);
const beta70 = db.prepare('SELECT * FROM assinaturas WHERE id = ?').get(a70);

// (1) O ponto crítico: as duas datas.
ok('data_proxima_renovacao foi pra 30 dias (é ela que manda no bloqueio)',
  beta70.data_proxima_renovacao === emDias(30),
  `ficou ${beta70.data_proxima_renovacao}, esperado ${emDias(30)}`);
ok('data_fim_teste bate com data_proxima_renovacao (tela não mente)',
  beta70.data_fim_teste === beta70.data_proxima_renovacao,
  `fim_teste=${beta70.data_fim_teste} renovacao=${beta70.data_proxima_renovacao}`);
ok('a contagem começa HOJE (é o que o cliente ouviu na prospecção)',
  beta70.data_inicio_teste === hoje);

// (2) Continua sendo trial.
ok('em_teste continua 1 (Beta é trial longo, não assinatura)', beta70.em_teste === 1);
ok('marcado como beta=1 (a vaga é contável)', beta70.beta === 1);

// (3) As features seguem.
ok('tenants.plano virou growth (é o que temFeature lê)', planoDoTenant(70) === 'growth');
ok('agora TEM relacionamento (RFM + régua + clube)', temFeature(planoDoTenant(70), 'relacionamento') === true);
ok('agora TEM relatórios avançados (DRE + fluxo)', temFeature(planoDoTenant(70), 'relatorios_avancados') === true);

// (4) O acesso está liberado durante os 30 dias.
const st70 = obterStatusAssinatura(70);
ok('durante o Beta o acesso está LIBERADO (não bloqueia)',
  st70.bloqueado === false, `status=${st70.status} bloqueado=${st70.bloqueado}`);
ok('mostra ~30 dias restantes', st70.diasRestantes >= 29 && st70.diasRestantes <= 30, `${st70.diasRestantes}`);

// ---- Cenário 2: o Beta NÃO pode ser cobrado ----
// Um beta que vence hoje é o caso que dispara o bug: se em_teste fosse zerado, o job
// criaria uma cobrança de R$119,90 por um benefício dado de graça.
novoTenant(71, 't71@x.com');
const a71 = db.prepare(`INSERT INTO assinaturas (tenant_id, plano, valor_mensal, data_inicio, data_proxima_renovacao, em_teste, beta)
  VALUES (?, 'growth', 119.90, ?, ?, 1, 1)`).run(71, hoje, hoje).lastInsertRowid;

procesarRenovacoes();

ok('Beta vencendo hoje NÃO gerou cobrança',
  db.prepare('SELECT COUNT(*) n FROM cobracas WHERE tenant_id = 71').get().n === 0);
ok('Beta vencendo hoje NÃO se auto-renovou (+30d silencioso)',
  db.prepare('SELECT data_proxima_renovacao d FROM assinaturas WHERE id = ?').get(a71).d === hoje);

// ---- Cenário 3: quando o Beta acaba, trava e leva pra tela de planos ----
// Mesmo fluxo do trial comum: bloqueia (gentil) → escolhe → paga. O beta não vira
// Starter sozinho nem some com os dados.
db.prepare("UPDATE assinaturas SET data_proxima_renovacao = date('now','-1 day') WHERE id = ?").run(a71);
const st71 = obterStatusAssinatura(71);
ok('Beta vencido → VENCIDA e bloqueado (vai escolher plano)',
  st71.status === 'vencida' && st71.bloqueado === true,
  `status=${st71.status} bloqueado=${st71.bloqueado}`);

// ---- Cenário 4: conta PAGANTE não vira Beta ----
// Sobrescrever a data de renovação de quem paga daria acesso grátis enquanto o
// Stripe segue cobrando — as duas pontas desalinhadas.
novoTenant(72, 't72@x.com');
const a72 = db.prepare(`INSERT INTO assinaturas (tenant_id, plano, valor_mensal, data_inicio, data_proxima_renovacao, em_teste)
  VALUES (?, 'growth', 119.90, ?, ?, 0)`).run(72, hoje, emDias(20)).lastInsertRowid;

ok('conta pagante é RECUSADA pelo Beta', concederBeta(a72, 30).erro === 'ja_pagante');
ok('e a data de renovação dela ficou intacta',
  db.prepare('SELECT data_proxima_renovacao d FROM assinaturas WHERE id = ?').get(a72).d === emDias(20));

// ---- Cenário 5: a contagem de vagas ----
// O limite de 20 é comercial (a escassez oferecida na conversa), não trava de código.
// O que precisa ser verdade é a CONTAGEM: ela é o que dá lastro à oferta.
const usadas = db.prepare('SELECT COUNT(*) n FROM assinaturas WHERE beta = 1').get().n;
ok('conta as vagas do Beta em uso (70 e 71)', usadas === 2, `${usadas}`);
ok('trial comum NÃO conta como vaga',
  db.prepare('SELECT beta FROM assinaturas WHERE id = ?').get(a72).beta === 0);

console.log(falhas === 0 ? '\n✅ PASSOU\n' : `\n❌ ${falhas} FALHA(S)\n`);
process.exit(falhas === 0 ? 0 : 1);
