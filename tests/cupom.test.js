// ============================================================
// CUPOM — as regras que, se quebrarem, dao dinheiro de graca.
//
// O cupom desconta de verdade. Um codigo que vaza no grupo do WhatsApp, ou que
// aceita ser usado duas vezes, ou que passa depois de vencido, e' prejuizo direto.
//
//   node tests/cupom.test.js
// ============================================================
process.env.DB_DIR = process.env.DB_DIR || './tests/.tmp-cupom';
const fs = require('fs');
const path = require('path');

const dir = path.resolve(process.env.DB_DIR);
if (fs.existsSync(dir)) fs.rmSync(dir, { recursive: true, force: true });
fs.mkdirSync(dir, { recursive: true });

const { db } = require('../db/database');
const cup = require('../lib/cupons');

let falhas = 0;
const ok = (d, c, x = '') => { if (c) console.log(`  ✅ ${d}`); else { console.log(`  ❌ ${d}${x ? ' → ' + x : ''}`); falhas++; } };
const secao = (t) => console.log(`\n${t}`);

const hoje = new Date().toISOString().slice(0, 10);
const dias = (n) => { const d = new Date(); d.setDate(d.getDate() + n); return d.toISOString().slice(0, 10); };

// ---------- Setup: duas lojas, cada uma com duas clientes ----------
let seqT = 0;
function loja(nome) {
  return Number(db.prepare(`
    INSERT INTO tenants (nome_loja, nome_responsavel, telefone, email, senha_hash, plano, status)
    VALUES (?, 'R', '73999990000', ?, 'x', 'interno', 'ativo')
  `).run(nome, `cup${++seqT}-${Date.now()}@t.com`).lastInsertRowid);
}
let seqC = 0;
function cliente(tenantId, nome) {
  return Number(db.prepare(`
    INSERT INTO clientes (tenant_id, nome, telefone, total_gasto, num_compras, arquivado, nao_perturbe)
    VALUES (?, ?, '73988887777', 0, 0, 0, 0)
  `).run(tenantId, nome || 'Cliente ' + (++seqC)).lastInsertRowid);
}
const A = loja('Loja A'), B = loja('Loja B');
const maria = cliente(A, 'Maria Silva');
const joana = cliente(A, 'Joana Costa');
const anaB = cliente(B, 'Ana da Outra Loja');

const emitir = (t, cli, over = {}) => cup.emitirCupom(t, {
  clienteId: cli, tipo: 'REAT_2', prefixo: 'VOLTE20', pct: 20, dias: 7, status: 'ativo', ...over,
});

// ============================================================
secao('1. Emissão');
// ============================================================
const c1 = emitir(A, maria);
ok('emite cupom', !!c1);
ok('código no formato PREFIXO-XXXX', /^VOLTE20-[A-Z2-9]{4}$/.test(c1.codigo), c1.codigo);
ok('sem I, O, 0 ou 1 no sufixo (a cliente lê em voz alta)', !/[IO01]/.test(c1.codigo.split('-')[1]));
ok('validade = hoje + 7 dias', c1.validade === dias(7), c1.validade);
ok('cupom de 0% não é emitido', emitir(A, maria, { pct: 0 }) === null);
ok('cupom acima de 50% é barrado (erro de digitação)', emitir(A, maria, { pct: 100 }) === null);
ok('sem tenantId, derruba', (() => { try { cup.emitirCupom(undefined, { clienteId: maria, pct: 10 }); return false; } catch { return true; } })());

// ============================================================
secao('2. NOMINAL: o código vazado no grupo não serve pra outra');
// ============================================================
const v = (t, codigo, cli, sub = 400) => cup.validarCupom(t, codigo, cli, sub, hoje);
ok('a dona usa o dela', v(A, c1.codigo, maria).ok);
const outra = v(A, c1.codigo, joana);
ok('a Joana NÃO usa o cupom da Maria', !outra.ok, 'VAZAMENTO: qualquer uma usaria o código');
ok('e o erro diz de quem é', /Maria/.test(outra.erro || ''), outra.erro);
ok('sem cliente selecionada, recusa', !v(A, c1.codigo, null).ok);

// ============================================================
secao('3. ISOLAMENTO: a loja B não enxerga o cupom da loja A');
// ============================================================
ok('mesmo código, outra loja → não encontrado', !v(B, c1.codigo, anaB).ok);
// As duas lojas PODEM ter o mesmo código (UNIQUE é por tenant, lição da migration 034)
const mesmoCodigo = db.prepare(`
  INSERT INTO crm_cupons (tenant_id, codigo, cliente_id, tipo, pct, validade, status)
  VALUES (?, ?, ?, 'REAT_2', 20, ?, 'ativo')
`).run(B, c1.codigo, anaB, dias(7));
ok('a loja B pode ter o MESMO código (UNIQUE é por tenant)', mesmoCodigo.changes === 1);
ok('e cada loja resolve pro SEU cupom', v(B, c1.codigo, anaB).ok && v(A, c1.codigo, maria).ok);

// ============================================================
secao('4. Estados: rascunho, cancelado, usado');
// ============================================================
const rasc = emitir(A, maria, { status: 'rascunho' });
ok('RASCUNHO (não enviado) não vale no PDV', !v(A, rasc.codigo, maria).ok);
ok('e ele responde "não encontrado" (não é descobrível no balcão)',
  /não encontrado/i.test(v(A, rasc.codigo, maria).erro || ''));

db.prepare("UPDATE crm_cupons SET status='cancelado' WHERE id=?").run(rasc.id);
ok('CANCELADO não vale', !v(A, rasc.codigo, maria).ok);

const usadoC = emitir(A, maria);
db.prepare("UPDATE crm_cupons SET status='usado', usado_em='2026-07-10 10:00:00' WHERE id=?").run(usadoC.id);
const jaUsado = v(A, usadoC.codigo, maria);
ok('USADO não vale de novo', !jaUsado.ok);
ok('e diz quando foi usado', /10\/07/.test(jaUsado.erro || ''), jaUsado.erro);

// ============================================================
secao('5. Validade (lazy — sem job nenhum ter rodado)');
// ============================================================
const venc = emitir(A, maria);
db.prepare('UPDATE crm_cupons SET validade=? WHERE id=?').run(dias(-1), venc.id);
const exp = v(A, venc.codigo, maria);
ok('cupom vencido ontem é recusado', !exp.ok);
ok('e diz a data', /expirado em/i.test(exp.erro || ''), exp.erro);

const hojeVence = emitir(A, maria);
db.prepare('UPDATE crm_cupons SET validade=? WHERE id=?').run(hoje, hojeVence.id);
ok('vence HOJE ainda vale (validade é inclusiva)', v(A, hojeVence.codigo, maria).ok);

// ============================================================
secao('6. Compra mínima');
// ============================================================
const cMin = emitir(A, maria, { minCompra: 200 });
ok('compra de R$150 recusa (mínimo R$200)', !v(A, cMin.codigo, maria, 150).ok);
ok('compra de R$200 aceita', v(A, cMin.codigo, maria, 200).ok);

// ============================================================
secao('7. A conta do desconto');
// ============================================================
ok('20% de R$400 = R$80', cup.descontoDe({ pct: 20 }, 400) === 80);
ok('25% de R$333,33 arredonda certo', cup.descontoDe({ pct: 25 }, 333.33) === 83.33,
  String(cup.descontoDe({ pct: 25 }, 333.33)));

// ============================================================
secao('8. BAIXA: uso único, e a corrida entre duas vendas');
// ============================================================
const bx = emitir(A, maria);
ok('1ª baixa passa', cup.baixarCupom(A, bx.id, 101, maria, 80, hoje) === true);
ok('2ª baixa do MESMO cupom falha', cup.baixarCupom(A, bx.id, 102, maria, 80, hoje) === false,
  'CUPOM REUTILIZÁVEL — desconto infinito');
const bxRow = db.prepare('SELECT * FROM crm_cupons WHERE id=?').get(bx.id);
ok('ficou marcado como usado, na venda 101', bxRow.status === 'usado' && bxRow.venda_id === 101);
ok('e guardou o R$ concedido', bxRow.valor_desconto === 80);

// baixa com o cliente ERRADO não passa (defesa em profundidade: mesmo que a
// validação tenha sido burlada, o UPDATE condicional recusa)
const bx2 = emitir(A, maria);
ok('baixa com cliente errado falha no próprio UPDATE', cup.baixarCupom(A, bx2.id, 103, joana, 80, hoje) === false);
ok('baixa de cupom vencido falha no próprio UPDATE', (() => {
  const c = emitir(A, maria);
  db.prepare('UPDATE crm_cupons SET validade=? WHERE id=?').run(dias(-1), c.id);
  return cup.baixarCupom(A, c.id, 104, maria, 80, hoje) === false;
})());

// ============================================================
secao('9. DEVOLUÇÃO: cancelar a venda devolve o cupom');
// ============================================================
const dv = emitir(A, maria);
cup.baixarCupom(A, dv.id, 200, maria, 80, hoje);
ok('devolveu 1 cupom', cup.devolverCupomDaVenda(A, 200) === 1);
const dvRow = db.prepare('SELECT * FROM crm_cupons WHERE id=?').get(dv.id);
ok('voltou a ATIVO', dvRow.status === 'ativo');
ok('desamarrou da venda', dvRow.venda_id === null && dvRow.valor_desconto === null);
ok('e pode ser usado de novo', v(A, dv.codigo, maria).ok,
  'a cliente ficaria sem a peça E sem o benefício');

// ============================================================
secao('10. Ativar e cancelar pela ação da régua');
// ============================================================
// simula uma ação da régua
const acaoId = Number(db.prepare(`
  INSERT INTO crm_acoes (tenant_id, data, cliente_id, tipo, prioridade, mensagem, status)
  VALUES (?, ?, ?, 'REAT_2', 4, 'oi', 'pendente')
`).run(A, hoje, maria).lastInsertRowid);
const cRasc = emitir(A, maria, { status: 'rascunho', acaoId, dias: 7 });
// o rascunho nasceu com validade de hoje+7; ativar 'reinicia' o relógio a partir do envio
db.prepare('UPDATE crm_cupons SET validade=? WHERE id=?').run(dias(3), cRasc.id);   // finge que nasceu antes
ok('rascunho não vale', !v(A, cRasc.codigo, maria).ok);
const at = cup.ativarCupomDaAcao(A, acaoId, 7);
ok('ativar promove pra ativo', !!at && v(A, cRasc.codigo, maria).ok);
ok('e o relógio da validade recomeça no ENVIO (hoje+7, não hoje+3)', at.validade === dias(7), at.validade);

const acao2 = Number(db.prepare(`
  INSERT INTO crm_acoes (tenant_id, data, cliente_id, tipo, prioridade, mensagem, status)
  VALUES (?, ?, ?, 'REAT_3', 4, 'oi', 'pendente')
`).run(A, hoje, joana).lastInsertRowid);
const cIgn = emitir(A, joana, { status: 'rascunho', acaoId: acao2 });
cup.cancelarCupomDaAcao(A, acao2);
ok('ignorar o contato cancela o cupom', !v(A, cIgn.codigo, joana).ok,
  'ficaria um desconto valendo pra quem nunca recebeu o código');

// ============================================================
secao('11. Cupons ativos da cliente (o PDV oferece sozinho)');
// ============================================================
const ativos = cup.cuponsAtivosDe(A, maria, hoje);
ok('lista só os usáveis agora', ativos.every((c) => c.validade >= hoje), `${ativos.length} cupons`);
ok('não lista os da outra loja', cup.cuponsAtivosDe(B, maria, hoje).length === 0);

// ============================================================
secao('12. A régua emite o código nominal (e não duplica no rerun)');
// ============================================================
// Este é o teste que protege a idempotência do scheduler: ele roda todo dia às
// 06:00 E no catch-up de 10s do boot. Se cada rerun emitisse um cupom, o banco
// encheria de código órfão — e cada um deles seria um desconto pendurado.
const { semearConfigRelacionamento } = require('../lib/config-relacionamento');
const { gerarAcoesDoTenant } = require('../lib/relacionamento-scheduler');
const { setConfig } = require('../db/database');

const R = loja('Loja Regua');
semearConfigRelacionamento(db, R);
setConfig('loja_nome', 'Loja Regua', R);

const d60 = (() => { const d = new Date(); d.setDate(d.getDate() - 60); return d.toISOString().slice(0, 10); })();
const sumida = Number(db.prepare(`
  INSERT INTO clientes (tenant_id, nome, telefone, total_gasto, num_compras, ultima_compra, arquivado, nao_perturbe)
  VALUES (?, 'Sumida Silva', '73988887777', 1500, 6, ?, 0, 0)
`).run(R, d60).lastInsertRowid);

const n1 = gerarAcoesDoTenant(R, hoje);
gerarAcoesDoTenant(R, hoje);
gerarAcoesDoTenant(R, hoje);   // rerun 3x, como o scheduler faz de verdade

const acoesR = db.prepare('SELECT * FROM crm_acoes WHERE tenant_id = ?').all(R);
const cuponsR = db.prepare('SELECT * FROM crm_cupons WHERE tenant_id = ?').all(R);
ok('gerou a ação de reativação', n1 === 1 && acoesR.length === 1);
ok('rodar 3x NÃO duplica a ação', acoesR.length === 1, `${acoesR.length} ações`);
ok('rodar 3x NÃO duplica o cupom', cuponsR.length === 1,
  `${cuponsR.length} cupons — cada rerun deixaria um código órfão`);

const acaoR = acoesR[0], cupR = cuponsR[0];
ok('o cupom está amarrado à ação', cupR.acao_id === acaoR.id && acaoR.cupom_id === cupR.id);
ok('nasce RASCUNHO (ainda não vale no caixa)', cupR.status === 'rascunho');
ok('a MENSAGEM tem o código nominal, não o prefixo cru',
  acaoR.mensagem.includes(cupR.codigo) && /VOLTE20-[A-Z2-9]{4}/.test(acaoR.mensagem));
ok('e a data de validade em vez de "válido por N dias"', /Vale até \d{2}\/\d{2}/.test(acaoR.mensagem),
  acaoR.mensagem.split('\n').find((l) => /Vale|válido/i.test(l)) || '');
ok('o cupom não vale enquanto a mensagem não foi enviada',
  !cup.validarCupom(R, cupR.codigo, sumida, 400, hoje).ok);

// ---------- Resultado ----------
console.log('');
if (falhas === 0) {
  console.log('✅ CUPOM OK — não vaza, não repete, não passa vencido');
  process.exit(0);
} else {
  console.log(`❌ ${falhas} FALHA(S) — NAO SUBIR (isto da desconto de graca)`);
  process.exit(1);
}
