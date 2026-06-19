// ============================================================
// Pre-cadastra o CUSTO FIXO da DS como despesas recorrentes (fixas).
// Baseado no mapeamento em 01-FINANCEIRO/01-CUSTO-FIXO-MENSAL.md
// Rode uma vez: node scripts/cadastrar-custo-fixo.js
// Depois, todo mes, use o botao "Lancar despesas fixas" no sistema.
// ============================================================
const { db } = require('../db/database');

const FIXAS = [
  // [descricao, valor, categoria, centro, dia_vencimento]
  ['Aluguel da loja',        5000, 'aluguel',    'empresa', 10],
  ['Energia (loja)',          220, 'energia',    'empresa', 15],
  ['Água (loja)',              95, 'agua',       'empresa', 15],
  ['Internet + celular',      160, 'internet',   'empresa', 10],
  ['Embalagens / sacolas',    250, 'embalagem',  'empresa', null],
  ['Contador',                500, 'contador',   'empresa', 10],
  ['IPTU',                    280, 'iptu',       'empresa', 10],
  ['Aluguel da casa',        1500, 'aluguel',    'pessoal', 10],
  ['Energia (casa)',          400, 'energia',    'pessoal', 15],
  ['Mercado / alimentação',  1300, 'mercado',    'pessoal', null],
  ['Pensão',                  650, 'pensao',     'pessoal', 5],
];

// evita duplicar: so cadastra se nao houver recorrentes ainda
const jaTem = db.prepare('SELECT COUNT(*) AS n FROM despesas WHERE recorrente = 1').get().n;
if (jaTem > 0) {
  console.log(`Ja existem ${jaTem} despesas fixas cadastradas. Nada a fazer (evitando duplicar).`);
  process.exit(0);
}

const ins = db.prepare(`
  INSERT INTO despesas (descricao, valor, categoria, tipo, centro, data_competencia, vencimento, pago, recorrente)
  VALUES (?, ?, ?, 'fixa', ?, date('now','localtime','start of month'), ?, 0, 1)
`);
const tx = db.transaction(() => {
  for (const [desc, val, cat, centro, dia] of FIXAS) {
    const venc = dia ? ('2026-01-' + String(dia).padStart(2,'0')) : null; // dia de referencia
    ins.run(desc, val, cat, centro, venc);
  }
});
tx();

const total = FIXAS.reduce((s, f) => s + f[1], 0);
console.log(`${FIXAS.length} despesas fixas cadastradas como modelo recorrente.`);
console.log(`Custo fixo total: R$ ${total.toFixed(2)}/mes`);
console.log('Agora, a cada mes, use "Lancar despesas fixas deste mes" no sistema.');
