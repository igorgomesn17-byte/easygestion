// ============================================================
// CALCULOS: a taxa, o imposto e a margem são DA LOJA — não da loja 1.
//
// Até 14/07/2026, lib/calculos.js tinha `tenantId = 1` como default em 5 funções, e o
// PDV chamava sem passar o tenant. Efeito: TODA VENDA descontava a taxa de cartão da
// LOJA 1. Numa venda de R$1.000 no débito (loja 1 em 1,37%, a real em 0,85%), são
// R$5,20 de lucro fantasma — em toda venda, sem nenhum erro aparecer.
//
// É a mesma classe de bug do getConfig(chave, fallback, tenantId = 1):
// um default de tenant NÃO QUEBRA — ELE MENTE.
//
//   node tests/calculos-tenant.test.js
// ============================================================
process.env.DB_DIR = process.env.DB_DIR || './tests/.tmp-calc';
process.env.NODE_ENV = 'test';   // o guard derruba em não-produção
const fs = require('fs');
const path = require('path');

const dir = path.resolve(process.env.DB_DIR);
if (fs.existsSync(dir)) fs.rmSync(dir, { recursive: true, force: true });
fs.mkdirSync(dir, { recursive: true });

const { db, setConfig } = require('../db/database');
const calc = require('../lib/calculos');

let falhas = 0;
const ok = (d, c, x = '') => { if (c) console.log(`  ✅ ${d}`); else { console.log(`  ❌ ${d}${x ? ' → ' + x : ''}`); falhas++; } };
const secao = (t) => console.log(`\n${t}`);
const lanca = (fn) => { try { fn(); return false; } catch (e) { return true; } };

// ---------- Duas lojas com maquininhas e impostos DIFERENTES ----------
let seq = 0;
const loja = (nome) => Number(db.prepare(`
  INSERT INTO tenants (nome_loja, nome_responsavel, telefone, email, senha_hash, plano, status)
  VALUES (?, 'R', '73999990000', ?, 'x', 'growth', 'ativo')
`).run(nome, `calc${++seq}-${Date.now()}@t.com`).lastInsertRowid);

const A = loja('Loja A');
const B = loja('Loja B');

// Loja A: maquininha cara, imposto alto, absorve até 3x
setConfig('taxa_debito', '2.00', A);
setConfig('taxa_credito_vista', '4.00', A);
setConfig('taxa_credito_6x', '10.00', A);
setConfig('imposto_simples', '10.00', A);
setConfig('markup', '2.0', A);
setConfig('parcelas_loja_absorve', '3', A);
setConfig('comissao_padrao', '0', A);
setConfig('embalagem_unit', '0', A);
setConfig('frete_unit', '0', A);

// Loja B: negociou melhor, imposto menor, absorve até 6x
setConfig('taxa_debito', '0.85', B);
setConfig('taxa_credito_vista', '2.89', B);
setConfig('taxa_credito_6x', '6.64', B);
setConfig('imposto_simples', '4.00', B);
setConfig('markup', '3.0', B);
setConfig('parcelas_loja_absorve', '6', B);
setConfig('comissao_padrao', '0', B);
setConfig('embalagem_unit', '0', B);
setConfig('frete_unit', '0', B);

// ============================================================
secao('1. A taxa da maquininha é DA LOJA');
// ============================================================
ok('loja A: débito = 2,00%', calc.taxaPorForma('debito', 1, A) === 2.00, String(calc.taxaPorForma('debito', 1, A)));
ok('loja B: débito = 0,85%', calc.taxaPorForma('debito', 1, B) === 0.85, String(calc.taxaPorForma('debito', 1, B)));
ok('crédito à vista também', calc.taxaPorForma('credito_vista', 1, A) === 4.00 && calc.taxaPorForma('credito_vista', 1, B) === 2.89);
ok('dinheiro é 0 nas duas (não passa maquininha)', calc.taxaPorForma('dinheiro', 1, A) === 0 && calc.taxaPorForma('dinheiro', 1, B) === 0);
ok('crediário é 0 (quem financia é a loja)', calc.taxaPorForma('crediario', 1, A) === 0);

// ============================================================
secao('2. Sem tenant, DERRUBA (não cai na loja 1 em silêncio)');
// ============================================================
ok('taxaPorForma sem tenant lança', lanca(() => calc.taxaPorForma('debito', 1)),
  'PERIGO: cairia na taxa da loja 1 e ninguém veria');
ok('resultadoVenda sem tenant lança', lanca(() => calc.resultadoVenda(1000, 400, 'debito', 1)));
ok('acrescimoParcelamento sem tenant lança', lanca(() => calc.acrescimoParcelamento(1000, 6)));
ok('sugerirPreco sem tenant lança', lanca(() => calc.sugerirPreco(100)));
ok('analisarPreco sem tenant lança', lanca(() => calc.analisarPreco(100, 300)));
ok('impactoDesconto sem tenant lança', lanca(() => calc.impactoDesconto(1000, 100, 400, 'debito', 1, 0, 0, 0)));

// ============================================================
secao('3. O LUCRO da venda usa os números da própria loja');
// ============================================================
// Mesma venda (R$1.000, custo R$400, débito) nas duas lojas:
const rA = calc.resultadoVenda(1000, 400, 'debito', 1, 0, 0, 0, A);
const rB = calc.resultadoVenda(1000, 400, 'debito', 1, 0, 0, 0, B);

ok('loja A: taxa R$20 (2%)', rA.valorTaxa === 20, String(rA.valorTaxa));
ok('loja B: taxa R$8,50 (0,85%)', rB.valorTaxa === 8.5, String(rB.valorTaxa));
ok('loja A: imposto R$100 (10%)', rA.imposto === 100, String(rA.imposto));
ok('loja B: imposto R$40 (4%)', rB.imposto === 40, String(rB.imposto));
ok('loja A: lucro R$480 (1000 - 20 - 100 - 400)', rA.lucro === 480, String(rA.lucro));
ok('loja B: lucro R$551,50 (1000 - 8,50 - 40 - 400)', rB.lucro === 551.5, String(rB.lucro));
ok('as duas lojas NÃO têm o mesmo lucro na mesma venda', rA.lucro !== rB.lucro,
  'se der igual, alguém está lendo a config da outra');

// ============================================================
secao('4. O ACRÉSCIMO que a cliente PAGA é da política da loja');
// ============================================================
// 6x: a loja A absorve até 3x (então repassa), a B absorve até 6x (não repassa)
const acA = calc.acrescimoParcelamento(1000, 6, A);
const acB = calc.acrescimoParcelamento(1000, 6, B);
ok('loja A (absorve até 3x): repassa R$100 em 6x', acA === 100, String(acA));
ok('loja B (absorve até 6x): NÃO repassa nada', acB === 0, String(acB),
  'a cliente da loja B pagaria acréscimo indevido');

// ============================================================
secao('5. Preço sugerido e margem usam o markup/custos da loja');
// ============================================================
// arredondar990 sobe pro PRÓXIMO ...9,90 (nunca abaixo do preço calculado):
// 100 × 2,0 = 200 → 209,90 (199,90 seria vender por menos que o markup manda)
ok('loja A (markup 2,0): custo 100 → sugere 209,90', calc.sugerirPreco(100, A) === 209.90, String(calc.sugerirPreco(100, A)));
ok('loja B (markup 3,0): custo 100 → sugere 309,90', calc.sugerirPreco(100, B) === 309.90, String(calc.sugerirPreco(100, B)));
ok('lojas com markup diferente sugerem preços diferentes', calc.sugerirPreco(100, A) !== calc.sugerirPreco(100, B));

const mA = calc.analisarPreco(100, 300, { tenantId: A });
const mB = calc.analisarPreco(100, 300, { tenantId: B });
ok('loja A: imposto do produto é 10%', mA.impostoPct === 10);
ok('loja B: imposto do produto é 4%', mB.impostoPct === 4);
ok('a margem do MESMO produto difere entre lojas', mA.margemPct !== mB.margemPct,
  `A=${mA.margemPct}% B=${mB.margemPct}% — se der igual, leu a config da outra loja`);

// ---------- Resultado ----------
console.log('');
if (falhas === 0) {
  console.log('✅ CALCULOS OK — cada loja cobra a taxa dela e lucra o que é dela');
  process.exit(0);
} else {
  console.log(`❌ ${falhas} FALHA(S) — NAO SUBIR (isto e' dinheiro em toda venda)`);
  process.exit(1);
}
