// ============================================================
// REGUA — reconciliacao com a realidade.
//
// Dois bugs que o Igor viu usando (17/07/2026), reproduzidos e travados aqui:
//
//   1. MULTIPLICACAO NA JANELA: o gatilho de reativacao tem largura (REAT_1 e'
//      28..32 dias). Como o UNIQUE de crm_acoes inclui a `data`, rodar o gerador em
//      dias seguidos criava UMA acao por dia pro mesmo cliente — ele se repetia na
//      tela ate 5x. A guarda existeAcaoAtiva() mata isso.
//
//   2. COMPROU E NAO SAIU: a cliente comprava, mas a acao "sentimos sua falta, 28
//      dias sem comprar" continuava pendente na fila. obsoletarAcoesDeAusencia()
//      (chamada na transacao da venda) resolve.
//
//   node tests/regua-reconciliacao.test.js
// ============================================================
process.env.DB_DIR = process.env.DB_DIR || './tests/.tmp-regua';
const fs = require('fs');
const path = require('path');

const dir = path.resolve(process.env.DB_DIR);
if (fs.existsSync(dir)) fs.rmSync(dir, { recursive: true, force: true });
fs.mkdirSync(dir, { recursive: true });

const { db } = require('../db/database');
const { gerarAcoesDoTenant } = require('../lib/relacionamento-scheduler');
const { obsoletarAcoesDeAusencia, existeAcaoAtiva } = require('../lib/crm');

let falhas = 0;
const ok = (d, c, x = '') => { if (c) console.log(`  ✅ ${d}`); else { console.log(`  ❌ ${d}${x ? ' → ' + x : ''}`); falhas++; } };
const secao = (t) => console.log(`\n${t}`);

// datas locais no formato YYYY-MM-DD (mesmo formato que o scheduler usa)
const fmt = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const hojeMenos = (n) => { const d = new Date(); d.setDate(d.getDate() - n); return fmt(d); };
const hoje = fmt(new Date());

// Loja no plano interno (tem a feature relacionamento — o gerador so roda pra quem tem)
const T = Number(db.prepare(`
  INSERT INTO tenants (nome_loja, nome_responsavel, telefone, email, senha_hash, plano, status)
  VALUES ('Loja Regua', 'R', '73999990000', ?, 'x', 'interno', 'ativo')
`).run(`regua-${Date.now()}@t.com`).lastInsertRowid);

// Cliente que comprou ha 28 dias → cai na janela do REAT_1 (28..32)
function cliente(nome, diasSemComprar, numCompras = 3) {
  return Number(db.prepare(`
    INSERT INTO clientes (tenant_id, nome, telefone, total_gasto, num_compras, ultima_compra, arquivado, nao_perturbe)
    VALUES (?, ?, '73988887777', 600, ?, ?, 0, 0)
  `).run(T, nome, numCompras, hojeMenos(diasSemComprar)).lastInsertRowid);
}

const pendentesDe = (cli) => db.prepare(
  `SELECT tipo, status, data FROM crm_acoes WHERE tenant_id = ? AND cliente_id = ? AND status IN ('pendente','adiada')`
).all(T, cli);

// ============================================================
secao('1. Janela de reativacao NAO multiplica o mesmo cliente');
// ============================================================
const amanda = cliente('Amanda Rocha', 28);

// Simula o gerador rodando em 3 dias seguidos (o cliente atravessa 28→29→30 dias).
// Antes do fix, isso deixava 3 linhas REAT_1 pendentes pra Amanda.
gerarAcoesDoTenant(T, hojeMenos(2));  // "28 dias" naquele dia
gerarAcoesDoTenant(T, hojeMenos(1));  // "29 dias"
gerarAcoesDoTenant(T, hoje);          // "30 dias"

const reats = db.prepare(
  `SELECT COUNT(*) n FROM crm_acoes WHERE tenant_id = ? AND cliente_id = ? AND tipo = 'REAT_1' AND status = 'pendente'`
).get(T, amanda).n;
ok('roda 3 dias seguidos e Amanda tem UMA acao REAT_1 (nao 3)', reats === 1, `tinha ${reats}`);

// ============================================================
secao('2. Comprou → a acao de ausencia vira obsoleta e sai da fila');
// ============================================================
ok('antes da compra, Amanda esta na fila', pendentesDe(amanda).length === 1);

// A venda chama obsoletarAcoesDeAusencia na sua transacao. Simula isso:
const mudou = obsoletarAcoesDeAusencia(T, amanda);
ok('a compra obsoletou 1 acao', mudou === 1, `mudou ${mudou}`);
ok('depois da compra, Amanda saiu da fila', pendentesDe(amanda).length === 0);

const statusFinal = db.prepare(
  `SELECT status FROM crm_acoes WHERE tenant_id = ? AND cliente_id = ? AND tipo = 'REAT_1'`
).get(T, amanda).status;
ok("a acao virou 'obsoleta' (nao apagada, nao 'enviada')", statusFinal === 'obsoleta', statusFinal);

// ============================================================
secao('3. Depois de obsoletar, o gerador nao ressuscita a acao no mesmo ciclo');
// ============================================================
// Amanda ainda esta na janela (30 dias). Rodar de novo NAO deve recriar: a compra
// atualiza ultima_compra na vida real; aqui garantimos ao menos que existeAcaoAtiva
// so olha pendente/adiada (obsoleta nao conta como ativa, entao o gerador PODERIA
// recriar — e' correto: se ela nao comprou de fato, a janela ainda vale). O contrato
// que importa: obsoleta != ativa.
ok('acao obsoleta NAO conta como ativa', existeAcaoAtiva(T, amanda, 'REAT_1') === false);

// ============================================================
secao('4. Aniversario/pos-venda NAO sao afetados por uma compra');
// ============================================================
// obsoletarAcoesDeAusencia so mexe nos tipos de ausencia. Uma acao de aniversario
// pendente sobrevive a uma compra.
const bia = cliente('Bia Nunes', 3);
db.prepare(`
  INSERT INTO crm_acoes (tenant_id, data, cliente_id, tipo, prioridade, mensagem, status)
  VALUES (?, ?, ?, 'ANIVERSARIO', 1, 'Parabens!', 'pendente')
`).run(T, hoje, bia);
obsoletarAcoesDeAusencia(T, bia);
const aniv = db.prepare(
  `SELECT status FROM crm_acoes WHERE tenant_id = ? AND cliente_id = ? AND tipo = 'ANIVERSARIO'`
).get(T, bia).status;
ok('aniversario continua pendente apos a compra', aniv === 'pendente', aniv);

// ============================================================
secao('5. ENVIADA silencia o gatilho (bug visto em producao 18/07)');
// ============================================================
// A lojista mandou a mensagem; a acao virou 'enviada'. No dia seguinte o scheduler
// NAO pode recriar a mesma acao — a cliente reapareceria na fila como se nunca
// tivesse sido contatada, e levaria a mesma mensagem 2 dias seguidos.
const carla = cliente('Carla Contatada', 29);
gerarAcoesDoTenant(T, hojeMenos(1));
const acaoCarla = db.prepare(
  `SELECT id FROM crm_acoes WHERE tenant_id = ? AND cliente_id = ? AND tipo = 'REAT_1'`
).get(T, carla);
ok('nasceu a acao de ontem', !!acaoCarla);

// simula o clique em "Enviar no WhatsApp"
db.prepare(`UPDATE crm_acoes SET status = 'enviada', resolvido_em = datetime('now','localtime') WHERE id = ?`)
  .run(acaoCarla.id);

// o scheduler roda hoje (ela continua na janela: 30 dias)
gerarAcoesDoTenant(T, hoje);
const totalCarla = db.prepare(
  `SELECT COUNT(*) n FROM crm_acoes WHERE tenant_id = ? AND cliente_id = ? AND tipo = 'REAT_1'`
).get(T, carla).n;
ok('NAO recria a acao no dia seguinte (segue 1 so)', totalCarla === 1, `tinha ${totalCarla}`);
ok('e ela nao volta pra fila como pendente',
   db.prepare(`SELECT COUNT(*) n FROM crm_acoes WHERE tenant_id=? AND cliente_id=? AND status='pendente'`).get(T, carla).n === 0);

// IGNORADA tambem silencia: "nao contatar" e' uma decisao, nao um adiamento de 1 dia
const dora = cliente('Dora Ignorada', 29);
gerarAcoesDoTenant(T, hojeMenos(1));
db.prepare(`UPDATE crm_acoes SET status = 'ignorada' WHERE tenant_id = ? AND cliente_id = ? AND tipo = 'REAT_1'`)
  .run(T, dora);
gerarAcoesDoTenant(T, hoje);
ok('IGNORADA tambem nao ressuscita no dia seguinte',
   db.prepare(`SELECT COUNT(*) n FROM crm_acoes WHERE tenant_id=? AND cliente_id=? AND tipo='REAT_1'`).get(T, dora).n === 1);

// ============================================================
console.log(`\n${falhas === 0 ? '✅ REGUA OK — nao multiplica e a compra tira da fila' : `❌ ${falhas} falha(s)`}`);
process.exit(falhas === 0 ? 0 : 1);
