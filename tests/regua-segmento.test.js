// ============================================================
// RFM MODULANDO A REGUA — o segmento muda o TEXTO e o DESCONTO.
//
// A regua decide QUANDO falar; o RFM decide COMO falar e QUANTO oferecer. Antes
// disto, a campea que gastou R$3.000 e sumiu recebia exatamente a mesma mensagem e
// o mesmo desconto da cliente de uma compra de R$49.
//
// O que este teste trava (mexe em desconto real, entao erro aqui custa dinheiro):
//   - o pct modulado NUNCA passa do teto;
//   - gatilho sem cupom NAO ganha cupom por causa do segmento;
//   - o texto que a LOJISTA escreveu nunca e' trocado por variante;
//   - o pct do cupom emitido bate com o pct escrito na mensagem.
//
//   node tests/regua-segmento.test.js
// ============================================================
process.env.DB_DIR = process.env.DB_DIR || './tests/.tmp-seg';
const fs = require('fs');
const path = require('path');

const dir = path.resolve(process.env.DB_DIR);
if (fs.existsSync(dir)) fs.rmSync(dir, { recursive: true, force: true });
fs.mkdirSync(dir, { recursive: true });

const { db } = require('../db/database');
const { mensagemDe, pctDoSegmento, PCT_TETO_REGUA, acoesDoDia } = require('../lib/crm');

let falhas = 0;
const ok = (d, c, x = '') => { if (c) console.log(`  ✅ ${d}`); else { console.log(`  ❌ ${d}${x ? ' → ' + x : ''}`); falhas++; } };
const secao = (t) => console.log(`\n${t}`);

const fmt = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const hojeMenos = (n) => { const d = new Date(); d.setDate(d.getDate() - n); return fmt(d); };
const hoje = fmt(new Date());

const T = Number(db.prepare(`
  INSERT INTO tenants (nome_loja, nome_responsavel, telefone, email, senha_hash, plano, status)
  VALUES ('Loja Seg', 'R', '73999990000', ?, 'x', 'interno', 'ativo')
`).run(`seg-${Date.now()}@t.com`).lastInsertRowid);

const cliente = (nome, gasto, compras, diasSemComprar) => Number(db.prepare(`
  INSERT INTO clientes (tenant_id, nome, telefone, total_gasto, num_compras, ultima_compra, arquivado, nao_perturbe)
  VALUES (?, ?, '73988887777', ?, ?, ?, 0, 0)
`).run(T, nome, gasto, compras, hojeMenos(diasSemComprar)).lastInsertRowid);

const buscar = (id) => db.prepare('SELECT * FROM clientes WHERE id = ?').get(id);

// ============================================================
secao('1. pctDoSegmento: a conta do desconto');
// ============================================================
ok('campea recebe MAIS que a base (20 -> 25)', pctDoSegmento(20, 'campeas') === 25, String(pctDoSegmento(20, 'campeas')));
ok('risco tambem sobe (20 -> 25)', pctDoSegmento(20, 'risco') === 25, String(pctDoSegmento(20, 'risco')));
ok('hibernando recebe MENOS (20 -> 15)', pctDoSegmento(20, 'hibernando') === 15, String(pctDoSegmento(20, 'hibernando')));
ok('fiel fica igual (20 -> 20)', pctDoSegmento(20, 'fieis') === 20);
ok('sem segmento fica igual (comportamento antigo)', pctDoSegmento(20, null) === 20);
ok('segmento desconhecido nao quebra', pctDoSegmento(20, 'inventado') === 20);

secao('   ...e as guardas que protegem a margem');
ok('0% continua 0% (gatilho sem cupom NAO ganha cupom)', pctDoSegmento(0, 'campeas') === 0);
ok('nunca passa do teto da regua', pctDoSegmento(40, 'campeas') <= PCT_TETO_REGUA, String(pctDoSegmento(40, 'campeas')));
ok(`teto da regua e ${PCT_TETO_REGUA}% (abaixo do MAX_PCT global de 50)`, PCT_TETO_REGUA <= 50);

// ============================================================
secao('2. O texto muda com o segmento');
// ============================================================
// Campea: muito gasto, muitas compras, sumiu ha 30 dias
const campea = cliente('Ana Campea', 3000, 12, 30);
// Cliente comum: uma compra pequena, mesmo tempo sumida
const comum  = cliente('Bia Comum', 49, 1, 30);

const msgCampea = mensagemDe(T, 'REAT_1', buscar(campea), { segmento: 'campeas' });
const msgComum  = mensagemDe(T, 'REAT_1', buscar(comum),  { segmento: 'novas' });

ok('campea recebe texto DIFERENTE do padrao', msgCampea.texto !== msgComum.texto);
ok('e o texto dela reconhece que ela e especial', /especiais|👑/.test(msgCampea.texto), msgCampea.texto.slice(0, 60));
ok('cliente comum segue com o texto padrao', /Sentimos sua falta/.test(msgComum.texto));

// ============================================================
secao('3. O texto da LOJISTA nunca e trocado por variante');
// ============================================================
db.prepare(`INSERT INTO crm_templates (tenant_id, tipo, texto, ativo) VALUES (?, 'REAT_1', ?, 1)`)
  .run(T, 'Oi {nome}, texto que EU escrevi!');
const msgEditada = mensagemDe(T, 'REAT_1', buscar(campea), { segmento: 'campeas' });
ok('o texto escrito pela lojista ganha da variante', /texto que EU escrevi/.test(msgEditada.texto), msgEditada.texto);
db.prepare(`DELETE FROM crm_templates WHERE tenant_id = ? AND tipo = 'REAT_1'`).run(T);

// ============================================================
secao('4. O cupom EMITIDO bate com o pct escrito na mensagem');
// ============================================================
// REAT_2 tem cupom de 20% no template. Campea deve receber 25% — nos DOIS lugares.
const emitidos = [];
const acoes = acoesDoDia(T, hoje, {
  emitirCupom: (cli, tipo, { prefixo, pct, dias }) => {
    emitidos.push({ cli: cli.id, tipo, pct });
    return { id: emitidos.length, codigo: `${prefixo}-TEST`, validade: '2026-12-31' };
  },
});

// A campea de 30 dias cai no REAT_1 (sem cupom). Crio uma de 60 dias pro REAT_2.
const campea60 = cliente('Cida Campea', 3000, 12, 60);
const emitidos2 = [];
const acoes2 = acoesDoDia(T, hoje, {
  emitirCupom: (cli, tipo, { prefixo, pct }) => {
    emitidos2.push({ cli: cli.id, tipo, pct });
    return { id: 99, codigo: `${prefixo}-TEST`, validade: '2026-12-31' };
  },
});
const cupomCampea = emitidos2.find(e => e.cli === campea60 && e.tipo === 'REAT_2');
const acaoCampea = acoes2.find(a => a.cliente_id === campea60 && a.tipo === 'REAT_2');

ok('campea de 60 dias gerou REAT_2', !!acaoCampea);
if (acaoCampea && cupomCampea) {
  ok('o cupom foi EMITIDO com o pct modulado (25%, nao 20%)', cupomCampea.pct === 25, String(cupomCampea.pct));
  ok('a MENSAGEM diz o mesmo pct do cupom emitido',
     acaoCampea.mensagem.includes(String(cupomCampea.pct) + '%'),
     acaoCampea.mensagem.match(/\d+%/g) ? acaoCampea.mensagem.match(/\d+%/g).join(',') : 'nenhum %');
  ok('a acao carrega o pct modulado', acaoCampea.cupom_pct === 25, String(acaoCampea.cupom_pct));
}

// ============================================================
secao('5. Cliente de baixo valor NAO recebe desconto inflado');
// ============================================================
const fraca = cliente('Duda Fraca', 60, 1, 60);
const emitidos3 = [];
acoesDoDia(T, hoje, {
  emitirCupom: (cli, tipo, { prefixo, pct }) => {
    emitidos3.push({ cli: cli.id, tipo, pct });
    return { id: 98, codigo: `${prefixo}-T`, validade: '2026-12-31' };
  },
});
const cupomFraca = emitidos3.find(e => e.cli === fraca && e.tipo === 'REAT_2');
if (cupomFraca) ok('cliente de baixo valor recebe <= o pct base (20%)', cupomFraca.pct <= 20, String(cupomFraca.pct));

console.log(`\n${falhas === 0 ? '✅ SEGMENTO OK — texto e desconto seguem o valor da cliente' : `❌ ${falhas} falha(s)`}`);
process.exit(falhas === 0 ? 0 : 1);
