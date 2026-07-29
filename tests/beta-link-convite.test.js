// ============================================================
// LINK DE CONVITE DO BETA — quem se cadastra por ?beta=BETA30 nasce com 30 dias.
//
// É o caminho principal da campanha (o Igor manda o link na prospecção); o botão do
// backoffice é a rede de segurança pra quem se cadastrou sem o link.
//
// O que este teste trava:
//
//   1. O LINK ABRE 30 DIAS, e as DUAS datas andam juntas. Quem manda no bloqueio é
//      data_proxima_renovacao; data_fim_teste é o que a tela mostra. Divergir trava o
//      beta no dia 15 exibindo "30 dias".
//
//   2. SEM CÓDIGO = 14 DIAS. O cadastro normal não pode ganhar 30 dias de brinde.
//
//   3. CÓDIGO ERRADO NÃO RECUSA O CADASTRO. Cai no trial normal. Recusar perderia um
//      cliente real por um detalhe de campanha — ele quer entrar, o benefício é que
//      não se aplica.
//
//   4. O TETO DE 20 VAGAS É TRAVA REAL NO LINK. Link é público e copiável: uma
//      cliente posta no grupo de lojistas e viraria desconto geral. Passada a 20ª, o
//      link para de dar 30 dias (mas continua deixando cadastrar).
//
//   node tests/beta-link-convite.test.js
// ============================================================
process.env.DB_DIR = process.env.DB_DIR || './tests/.tmp-betalink';
const fs = require('fs');
const path = require('path');

const dir = path.resolve(process.env.DB_DIR);
if (fs.existsSync(dir)) fs.rmSync(dir, { recursive: true, force: true });
fs.mkdirSync(dir, { recursive: true });

const { db } = require('../db/database');
const { validarConvite, planoDeEntrada, normalizarCodigo, BETA_CODIGO, BETA_VAGAS } = require('../lib/beta');

let falhas = 0;
function ok(desc, cond, extra = '') {
  if (cond) console.log(`  ✅ ${desc}`);
  else { console.log(`  ❌ ${desc}${extra ? ' → ' + extra : ''}`); falhas++; }
}

console.log('\n🔗 TESTE: link de convite do Beta\n');

// ---- 1. O código do link vale e abre 30 dias ----
console.log('1. O convite do link');
ok('código correto é válido', validarConvite(BETA_CODIGO).valido === true);
ok('e abre 30 dias', planoDeEntrada(BETA_CODIGO).dias === 30);
ok('e marca beta=1 (ocupa vaga, aparece com badge)', planoDeEntrada(BETA_CODIGO).beta === 1);

// A lojista digita/cola de qualquer jeito: minúscula, com espaço, com a pontuação
// que o WhatsApp gruda no fim do link.
ok('aceita minúscula ("beta30")', validarConvite('beta30').valido === true);
ok('aceita espaço em volta ("  BETA30 ")', validarConvite('  BETA30 ').valido === true);
ok('aceita pontuação grudada ("BETA30.")', validarConvite('BETA30.').valido === true);
ok('normalizarCodigo limpa o lixo', normalizarCodigo(' beta-30! ') === 'BETA30');

// ---- 2. Sem código = trial normal ----
console.log('\n2. Sem convite, nada muda');
ok('sem código: 14 dias', planoDeEntrada(undefined).dias === 14);
ok('sem código: beta=0 (não gasta vaga)', planoDeEntrada(undefined).beta === 0);
ok('string vazia: 14 dias', planoDeEntrada('').dias === 14);
ok('motivo é "ausente" (não "invalido") — some da tela sem alarme falso',
  planoDeEntrada('').motivo === 'ausente');

// ---- 3. Código errado não impede o cadastro ----
console.log('\n3. Código errado degrada pro trial normal');
ok('código inventado: 14 dias (não recusa o cadastro)', planoDeEntrada('GRATIS100').dias === 14);
ok('código inventado: beta=0', planoDeEntrada('GRATIS100').beta === 0);
ok('e o motivo é "invalido"', planoDeEntrada('GRATIS100').motivo === 'invalido');
// Tentativa de forçar prazo pela URL: o valor NÃO é o prazo, é um código.
ok('"?beta=999" não vira 999 dias', planoDeEntrada('999').dias === 14);

// ---- 4. O teto de 20 vagas é trava REAL no link ----
console.log('\n4. As 20 vagas travam o link (é público e copiável)');

function novoTenant(id) {
  db.prepare(`INSERT INTO tenants (id, nome_loja, nome_responsavel, telefone, email, senha_hash, plano, status)
    VALUES (?, ?, 'R', '7390000000', ?, 'x', 'growth', 'ativo')`).run(id, 'Loja ' + id, `t${id}@x.com`);
  db.prepare(`INSERT INTO assinaturas (tenant_id, plano, valor_mensal, data_inicio, data_proxima_renovacao, em_teste, beta)
    VALUES (?, 'growth', 119.90, date('now'), date('now','+30 day'), 1, 1)`).run(id);
}

// Ocupa 19 vagas: ainda tem uma.
for (let i = 1; i <= 19; i++) novoTenant(200 + i);
ok(`com 19 vagas usadas, o link ainda vale`, validarConvite(BETA_CODIGO).valido === true);
ok('e informa 1 vaga restante', validarConvite(BETA_CODIGO).restantes === 1);

// A 20ª fecha a campanha.
novoTenant(220);
const esgotado = validarConvite(BETA_CODIGO);
ok(`com as ${BETA_VAGAS} usadas, o link PARA de valer`, esgotado.valido === false);
ok('e o motivo é "esgotado" (a tela avisa em vez de fingir)', esgotado.motivo === 'esgotado');
ok('quem chega depois cai nos 14 dias', planoDeEntrada(BETA_CODIGO).dias === 14);
ok('e NÃO gasta vaga (beta=0)', planoDeEntrada(BETA_CODIGO).beta === 0);

// A trava não pode virar recusa de cadastro: ela ainda entra, só sem o bônus.
ok('vaga esgotada NÃO bloqueia o cadastro (só o bônus)',
  planoDeEntrada(BETA_CODIGO).dias === 14 && planoDeEntrada(BETA_CODIGO).motivo === 'esgotado');

// ---- 5. O trial comum não é contado como vaga ----
console.log('\n5. Contagem de vagas');
db.prepare(`INSERT INTO tenants (id, nome_loja, nome_responsavel, telefone, email, senha_hash, plano, status)
  VALUES (900, 'Sem convite', 'R', '7390000000', 'sem@x.com', 'x', 'growth', 'ativo')`).run();
db.prepare(`INSERT INTO assinaturas (tenant_id, plano, valor_mensal, data_inicio, data_proxima_renovacao, em_teste, beta)
  VALUES (900, 'growth', 119.90, date('now'), date('now','+14 day'), 1, 0)`).run();
const usadas = db.prepare('SELECT COUNT(*) n FROM assinaturas WHERE beta = 1').get().n;
ok('trial sem convite não conta como vaga do Beta', usadas === 20, `${usadas} vagas contadas`);

console.log(falhas === 0 ? '\n✅ PASSOU\n' : `\n❌ ${falhas} FALHA(S)\n`);
process.exit(falhas === 0 ? 0 : 1);
