// ============================================================
// CLUBE DE FIDELIDADE — as regras que, se quebrarem, custam dinheiro de verdade.
//
// O premio e' um vale-credito real: emitir duas vezes o mesmo cartao e' a loja
// pagando duas vezes. Estes testes cobrem os quatro jeitos de isso acontecer:
//   1. reprocessar a mesma venda (idempotencia)
//   2. cancelar uma venda e recomprar (o gasto ANDA PRA TRAS — high-water mark)
//   3. a cliente pagar com o proprio premio e ganhar selo em cima (anti-farming)
//   4. config com selo = R$ 0 (Math.floor(x/0) = Infinity -> premio infinito)
//
//   node tests/clube.test.js
// ============================================================
process.env.DB_DIR = process.env.DB_DIR || './tests/.tmp-clube';
const fs = require('fs');
const path = require('path');

const dir = path.resolve(process.env.DB_DIR);
if (fs.existsSync(dir)) fs.rmSync(dir, { recursive: true, force: true });
fs.mkdirSync(dir, { recursive: true });

const { db, setConfig } = require('../db/database');
const { semearConfigRelacionamento } = require('../lib/config-relacionamento');
const { emitirPremioClube, registrarGastoSemSelo } = require('../lib/clube');

let falhas = 0;
function ok(desc, cond, extra = '') {
  if (cond) console.log(`  ✅ ${desc}`);
  else { console.log(`  ❌ ${desc}${extra ? ' → ' + extra : ''}`); falhas++; }
}
function secao(t) { console.log(`\n${t}`); }

// ---------- Setup: uma loja, cartao de 10 selos de R$50 = premio de R$50 ----------
const T = Number(db.prepare(`
  INSERT INTO tenants (nome_loja, nome_responsavel, telefone, email, senha_hash, plano, status)
  VALUES ('Loja Teste', 'Resp', '73999990000', ?, 'x', 'interno', 'ativo')
`).run(`clube-${Date.now()}@t.com`).lastInsertRowid);

semearConfigRelacionamento(db, T);
setConfig('clube_valor_selo', '50', T);    // R$50 = 1 selo
setConfig('clube_total_selos', '10', T);   // 10 selos = cartao cheio
setConfig('clube_valor_premio', '50', T);  // premio = vale de R$50

let seqCliente = 0;
function novaCliente(totalGasto = 0, gastoSemSelo = 0) {
  const r = db.prepare(`
    INSERT INTO clientes (tenant_id, nome, telefone, total_gasto, gasto_sem_selo, num_compras, arquivado, nao_perturbe)
    VALUES (?, ?, '73999990000', ?, ?, 1, 0, 0)
  `).run(T, 'Cliente ' + (++seqCliente), totalGasto, gastoSemSelo);
  return Number(r.lastInsertRowid);
}
const gastar = (id, v) => db.prepare('UPDATE clientes SET total_gasto = total_gasto + ? WHERE id = ?').run(v, id);
const valesDe = (id) => db.prepare("SELECT * FROM vales WHERE cliente_id = ? AND origem = 'clube' ORDER BY clube_ciclo").all(id);

// ============================================================
secao('1. Fechar o cartao gera UM vale de verdade');
// ============================================================
const c1 = novaCliente(500);           // R$500 = 10 selos = cartao cheio
const premio = emitirPremioClube(T, c1, 1);
ok('premio emitido', !!premio);
ok('valor = R$50', premio && premio.valor === 50, premio && `deu ${premio.valor}`);
ok('e o 1o cartao', premio && premio.ciclo === 1);
ok('codigo no formato VALE-XXXXXX', premio && /^VALE-[A-Z2-9]{6}$/.test(premio.codigo), premio && premio.codigo);
ok('tem validade', premio && !!premio.validade, premio && String(premio.validade));
ok('gravado na tabela vales', valesDe(c1).length === 1);
ok('saldo = valor (nao usado)', valesDe(c1)[0].saldo === 50);

// ============================================================
secao('2. IDEMPOTENCIA: reprocessar nao emite de novo');
// ============================================================
const denovo = emitirPremioClube(T, c1, 1);
ok('2a chamada devolve null', denovo === null, 'PREMIO DUPLICADO — a loja pagaria duas vezes');
emitirPremioClube(T, c1, 1);
emitirPremioClube(T, c1, 1);
ok('continua so 1 vale apos 4 chamadas', valesDe(c1).length === 1, `tem ${valesDe(c1).length}`);

// ============================================================
secao('3. Cartao incompleto nao ganha nada');
// ============================================================
const c2 = novaCliente(450);   // 9 selos, falta 1
ok('R$450 (9 selos) nao gera premio', emitirPremioClube(T, c2, 2) === null);
gastar(c2, 50);                // fecha o 10o selo
ok('R$500 (10 selos) gera premio', emitirPremioClube(T, c2, 3) !== null);

// ============================================================
secao('4. HIGH-WATER MARK: cancelar venda e recomprar nao reemite');
// ============================================================
// Este e' o cenario que quebra o controle ingenuo. DELETE /api/vendas devolve o
// total_gasto — o gasto da cliente ANDA PRA TRAS. Se a idempotencia fosse
// "selos % total === 0", o proximo R$50 reabriria o mesmo cartao e pagaria de novo.
const c3 = novaCliente(500);
const p1 = emitirPremioClube(T, c3, 10);
ok('1o cartao pago', p1 && p1.ciclo === 1);
gastar(c3, -100);                                  // cliente cancela uma venda de R$100
ok('nada emitido com gasto revertido', emitirPremioClube(T, c3, 11) === null);
gastar(c3, 100);                                   // ela recompra os mesmos R$100
ok('recomprar NAO reemite o 1o cartao', emitirPremioClube(T, c3, 12) === null,
  'PREMIO DUPLICADO no cancela-e-recompra');
ok('continua 1 vale so', valesDe(c3).length === 1, `tem ${valesDe(c3).length}`);
gastar(c3, 500);                                   // agora sim, 2o cartao (R$1000 total)
const p2 = emitirPremioClube(T, c3, 13);
ok('2o cartao gera o 2o vale', p2 && p2.ciclo === 2, p2 ? `ciclo ${p2.ciclo}` : 'nao emitiu');
ok('agora sao 2 vales', valesDe(c3).length === 2);

// ============================================================
secao('5. Compra gigante que pula dois cartoes: 1 vale por venda');
// ============================================================
const c4 = novaCliente(1000);   // 20 selos = 2 cartoes de uma vez
const pGrande = emitirPremioClube(T, c4, 20);
ok('emite 1 vale so', valesDe(c4).length === 1, `emitiu ${valesDe(c4).length}`);
ok('registra o ciclo do TOPO (2)', pGrande && pGrande.ciclo === 2, pGrande && `ciclo ${pGrande.ciclo}`);
ok('nao reemite depois', emitirPremioClube(T, c4, 21) === null);

// ============================================================
secao('6. ANTI-FARMING: pagar com o premio nao gera selo novo');
// ============================================================
const c5 = novaCliente(500);
emitirPremioClube(T, c5, 30);                      // ganhou o vale de R$50
// Agora ela volta e compra R$500, pagando R$50 com o vale do clube:
registrarGastoSemSelo(T, c5, 50);                  // (passo 2b da tx da venda)
gastar(c5, 500);                                   // (passo 3 da tx: total_gasto += 500)
// Gasto elegivel = 1000 - 50 = 950 -> 19 selos -> ainda 1 cartao fechado.
ok('sem o anti-farming ela fecharia o 2o cartao, mas nao fecha',
  emitirPremioClube(T, c5, 31) === null,
  'o clube estaria financiando a si mesmo');
gastar(c5, 50);                                    // completa os R$50 que faltavam
ok('gastando de verdade, o 2o cartao fecha', emitirPremioClube(T, c5, 32) !== null);

// ============================================================
secao('7. Config invalida nao vira premio infinito');
// ============================================================
setConfig('clube_valor_selo', '0', T);
const c6 = novaCliente(500);
ok('selo de R$0 nao emite nada', emitirPremioClube(T, c6, 40) === null,
  'Math.floor(x/0) = Infinity — premio infinito');
setConfig('clube_valor_selo', '50', T);

setConfig('clube_ativo', '0', T);
const c7 = novaCliente(500);
ok('clube desligado nao emite', emitirPremioClube(T, c7, 41) === null);
setConfig('clube_ativo', '1', T);

// ============================================================
secao('8. Venda sem cliente nao quebra');
// ============================================================
ok('cliente_id null devolve null', emitirPremioClube(T, null, 50) === null);
ok('cliente inexistente devolve null', emitirPremioClube(T, 999999, 51) === null);

// ---------- Resultado ----------
console.log('');
if (falhas === 0) {
  console.log('✅ CLUBE OK — premio nao duplica, nao se auto-financia e nao explode');
  process.exit(0);
} else {
  console.log(`❌ ${falhas} FALHA(S) — NAO SUBIR (isto custa dinheiro real)`);
  process.exit(1);
}
