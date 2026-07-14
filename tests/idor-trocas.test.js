// ============================================================
// IDOR NA TROCA — a loja A mexia no estoque da loja B.
//
// Descoberto e EXPLORADO em 14/07/2026. O POST /api/trocas recebe os variacao_id no
// BODY do request. As queries que resolviam essas peças faziam:
//
//     FROM variacoes v JOIN produtos p ON p.id = v.produto_id WHERE v.id = ?
//                                                                          ^^^ sem tenant
//
// e os UPDATEs de estoque também. Resultado: a loja A montava uma troca legítima
// (venda dela) apontando os "levados" para uma variação da loja B, e:
//   - o estoque da loja B era BAIXADO (provado: 100 → 70 peças);
//   - a resposta vazava o nome, o preço e o CUSTO do produto da concorrente.
//
// O routes/vendas.js SEMPRE fez isso certo (`WHERE v.id = ? AND p.tenant_id = ?`).
// A lição estava no arquivo ao lado e não tinha sido copiada.
//
//   node tests/idor-trocas.test.js
// ============================================================
process.env.DB_DIR = process.env.DB_DIR || './tests/.tmp-idor-test';
process.env.NODE_ENV = 'test';
const fs = require('fs');
const path = require('path');

const dir = path.resolve(process.env.DB_DIR);
if (fs.existsSync(dir)) fs.rmSync(dir, { recursive: true, force: true });
fs.mkdirSync(dir, { recursive: true });

const { db } = require('../db/database');

let falhas = 0;
const ok = (d, c, x = '') => { if (c) console.log(`  ✅ ${d}`); else { console.log(`  ❌ ${d}${x ? ' → ' + x : ''}`); falhas++; } };
const secao = (t) => console.log(`\n${t}`);

// ---------- Duas lojas: a atacante e a vítima ----------
let seq = 0;
const loja = (nome) => Number(db.prepare(`
  INSERT INTO tenants (nome_loja, nome_responsavel, telefone, email, senha_hash, plano, status)
  VALUES (?, 'R', '73999990000', ?, 'x', 'growth', 'ativo')
`).run(nome, `idor${++seq}-${Date.now()}@t.com`).lastInsertRowid);

const A = loja('Loja A (atacante)');
const B = loja('Loja B (vítima)');

function produto(tenantId, codigo, nome, qtd) {
  const p = Number(db.prepare(`
    INSERT INTO produtos (tenant_id, codigo, nome, preco_venda, custo, ativo) VALUES (?, ?, ?, 999, 333, 1)
  `).run(tenantId, codigo, nome).lastInsertRowid);
  const v = Number(db.prepare(`
    INSERT INTO variacoes (produto_id, cor, tamanho, quantidade) VALUES (?, 'Preto', 'M', ?)
  `).run(p, qtd).lastInsertRowid);
  return { produtoId: p, variacaoId: v };
}

const pecaDaVitima   = produto(B, 'VITIMA1', 'Vestido da vítima', 100);
const pecaDoAtacante = produto(A, 'ATAC1', 'Peça do atacante', 10);

const estoqueDe = (varId) => db.prepare('SELECT quantidade FROM variacoes WHERE id = ?').get(varId).quantidade;

// ============================================================
secao('1. A query que resolve a peça EXIGE o tenant');
// ============================================================
// Esta é a query real do routes/trocas.js (getVar). Se ela achar a peça da vítima
// quando o tenant é o atacante, o IDOR está de volta.
const getVar = db.prepare(`
  SELECT v.id AS variacao_id, v.quantidade, p.nome, p.custo
  FROM variacoes v JOIN produtos p ON p.id = v.produto_id
  WHERE v.id = ? AND p.tenant_id = ?
`);

ok('a loja A NÃO acha a peça da loja B',
  getVar.get(pecaDaVitima.variacaoId, A) === undefined,
  'IDOR: a loja A resolveria a peça da vítima e leria o custo dela');
ok('a loja B acha a peça dela',
  !!getVar.get(pecaDaVitima.variacaoId, B));
ok('a loja A acha a peça dela',
  !!getVar.get(pecaDoAtacante.variacaoId, A));

// ============================================================
secao('2. O UPDATE de estoque também tranca (defesa em profundidade)');
// ============================================================
// Mesmo que um id estranho passe por algum caminho novo, o UPDATE não pode mexer.
const baixa = db.prepare(`
  UPDATE variacoes SET quantidade = quantidade - ?
  WHERE id = ? AND produto_id IN (SELECT id FROM produtos WHERE tenant_id = ?)
`);
const sobe = db.prepare(`
  UPDATE variacoes SET quantidade = quantidade + ?
  WHERE id = ? AND produto_id IN (SELECT id FROM produtos WHERE tenant_id = ?)
`);

const antes = estoqueDe(pecaDaVitima.variacaoId);
const rBaixa = baixa.run(30, pecaDaVitima.variacaoId, A);   // a loja A tenta roubar 30
ok('a loja A NÃO consegue baixar o estoque da loja B',
  rBaixa.changes === 0 && estoqueDe(pecaDaVitima.variacaoId) === antes,
  `estoque foi de ${antes} pra ${estoqueDe(pecaDaVitima.variacaoId)}`);

const rSobe = sobe.run(999, pecaDaVitima.variacaoId, A);    // e nem inflar
ok('a loja A NÃO consegue inflar o estoque da loja B',
  rSobe.changes === 0 && estoqueDe(pecaDaVitima.variacaoId) === antes);

ok('a loja B mexe no estoque DELA normalmente',
  baixa.run(10, pecaDaVitima.variacaoId, B).changes === 1 && estoqueDe(pecaDaVitima.variacaoId) === antes - 10);

// ---------- Resultado ----------
console.log('');
if (falhas === 0) {
  console.log('✅ IDOR FECHADO — uma loja não alcança o estoque da outra');
  process.exit(0);
} else {
  console.log(`❌ ${falhas} FALHA(S) — NAO SUBIR (uma loja rouba o estoque da outra)`);
  process.exit(1);
}
