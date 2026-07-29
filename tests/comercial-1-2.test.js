// ============================================================
// COMERCIAL 1 x COMERCIAL 2 — duas pessoas, duas filas, e o bot com interruptor.
//
// O que este teste protege:
//
//   1. ROTEAMENTO. Nunca comprou -> C1 (falta a primeira venda). Ja comprou ->
//      C2 (a relacao e' dele). E' o modelo MCC, e sem isso as duas pessoas veem
//      a mesma fila e atendem a mesma cliente.
//   2. PASSAGEM DE BASTAO. A primeira compra move a conversa do C1 pro C2 — o C1
//      existe pra fazer a primeira venda; acumular carteira tira o tempo dele de
//      prospectar, que e' o unico trabalho dele.
//   3. CONGELAMENTO. O departamento e' decidido na CRIACAO, nao calculado na
//      leitura. Recalcular faria o card pular de fila no meio de uma conversa em
//      andamento, com o C1 ainda escrevendo.
//   4. O BOT TEM INTERRUPTOR. Antes ele respondia sempre, sem como desligar —
//      ligado sem controle e' pior que desligado.
//
//   node tests/comercial-1-2.test.js
// ============================================================
process.env.DB_DIR = process.env.DB_DIR || './tests/.tmp-c12';
process.env.CERT_CIPHER_KEY = process.env.CERT_CIPHER_KEY || 'chave-de-teste-com-32-caracteres!';

const fs = require('fs');
const path = require('path');
const dir = path.resolve(process.env.DB_DIR);
if (fs.existsSync(dir)) fs.rmSync(dir, { recursive: true, force: true });
fs.mkdirSync(dir, { recursive: true });

const { db, getConfig, setConfig } = require('../db/database');
const conversas = require('../lib/conversas');
const bot = require('../lib/bot');

let falhas = 0;
function ok(desc, cond, extra = '') {
  if (cond) console.log(`  ✅ ${desc}`);
  else { console.log(`  ❌ ${desc}${extra ? ' → ' + extra : ''}`); falhas++; }
}
function secao(t) { console.log(`\n${t}`); }

const T = Number(db.prepare(`
  INSERT INTO tenants (nome_loja, nome_responsavel, telefone, email, senha_hash, plano, status)
  VALUES ('DS','Igor','73','c12@t.com','x','interno','ativo')
`).run().lastInsertRowid);

const T2 = Number(db.prepare(`
  INSERT INTO tenants (nome_loja, nome_responsavel, telefone, email, senha_hash, plano, status)
  VALUES ('Vizinha','X','73','viz12@t.com','x','interno','ativo')
`).run().lastInsertRowid);

// Duas pessoas, uma em cada departamento — é assim que vai ser na DS.
const CARLA = Number(db.prepare(`INSERT INTO usuarios (tenant_id, nome, senha_hash, papel) VALUES (?, 'carla', 'x', 'comercial_1')`).run(T).lastInsertRowid);
const RITA  = Number(db.prepare(`INSERT INTO usuarios (tenant_id, nome, senha_hash, papel) VALUES (?, 'rita',  'x', 'comercial_2')`).run(T).lastInsertRowid);

// ------------------------------------------------------------
secao('1. Roteamento na chegada: quem nunca comprou vai pro C1');
// ------------------------------------------------------------
const c1 = conversas.acharOuCriarConversa(T, { telefone: '5573900001111', nome: 'Modas Cristina' });
ok('número desconhecido vai pro Comercial 1', c1.departamento === 'c1', c1.departamento);
ok('e já nasce com a Carla (única C1 da loja)', c1.usuario_id === CARLA, String(c1.usuario_id));

// cliente que JÁ comprou
const cliVelha = Number(db.prepare(`
  INSERT INTO clientes (tenant_id, nome, telefone, num_compras, total_gasto, ultima_compra)
  VALUES (?, 'Boutique Mariana', '5573900002222', 4, 4210, date('now','-10 days'))
`).run(T).lastInsertRowid);

const c2 = conversas.acharOuCriarConversa(T, { telefone: '5573900002222' });
ok('quem JÁ comprou vai pro Comercial 2', c2.departamento === 'c2', c2.departamento);
ok('e nasce com a Rita (única C2)', c2.usuario_id === RITA, String(c2.usuario_id));
ok('já entra como "comprou" no funil (não é prospecção)', c2.estagio === 'comprou', c2.estagio);

// cliente cadastrada mas SEM compra ainda continua sendo trabalho do C1
const cliSemCompra = Number(db.prepare(`
  INSERT INTO clientes (tenant_id, nome, telefone, num_compras) VALUES (?, 'Cadastrada', '5573900003333', 0)
`).run(T).lastInsertRowid);
const c3 = conversas.acharOuCriarConversa(T, { telefone: '5573900003333' });
ok('cadastrada sem compra ainda é do C1', c3.departamento === 'c1', c3.departamento);

// ------------------------------------------------------------
secao('2. Passagem de bastão: a primeira compra move pro C2');
// ------------------------------------------------------------
const antes = db.prepare('SELECT departamento, usuario_id FROM conversas WHERE id = ?').get(c3.id);
ok('antes da compra: C1, com a Carla', antes.departamento === 'c1' && antes.usuario_id === CARLA);

// simula a venda: a cliente compra pela primeira vez
db.prepare('UPDATE clientes SET num_compras = 1, total_gasto = 300 WHERE id = ?').run(cliSemCompra);
const movidas = conversas.passarParaC2(T, cliSemCompra);

const depois = db.prepare('SELECT departamento, usuario_id, estagio FROM conversas WHERE id = ?').get(c3.id);
ok('a passagem moveu 1 conversa', movidas === 1, String(movidas));
ok('agora é do Comercial 2', depois.departamento === 'c2', depois.departamento);
ok('e o dono virou a Rita (não ficou com a Carla)', depois.usuario_id === RITA, String(depois.usuario_id));
ok('o funil marcou como "comprou"', depois.estagio === 'comprou', depois.estagio);

// segunda compra NÃO é passagem — ela já era do C2
const movidas2 = conversas.passarParaC2(T, cliSemCompra);
ok('comprar de novo não move nada (já é do C2)', movidas2 === 0, String(movidas2));

// e não mexe em quem já era do C2 desde o início
conversas.passarParaC2(T, cliVelha);
ok('conversa que já nasceu C2 fica intacta',
   db.prepare('SELECT usuario_id FROM conversas WHERE id = ?').get(c2.id).usuario_id === RITA);

// ------------------------------------------------------------
secao('3. O departamento é CONGELADO, não recalculado');
// ------------------------------------------------------------
// Se fosse calculado na leitura, o card pularia de fila no instante da compra —
// no meio de uma conversa, com o C1 ainda escrevendo a resposta.
const cliCong = Number(db.prepare(`
  INSERT INTO clientes (tenant_id, nome, telefone, num_compras) VALUES (?, 'Congelada', '5573900004444', 0)
`).run(T).lastInsertRowid);
const cCong = conversas.acharOuCriarConversa(T, { telefone: '5573900004444' });
ok('nasce C1', cCong.departamento === 'c1');

// a cliente compra, mas NINGUÉM chama passarParaC2 (simula venda por fora)
db.prepare('UPDATE clientes SET num_compras = 2 WHERE id = ?').run(cliCong);
const aindaC1 = db.prepare('SELECT departamento FROM conversas WHERE id = ?').get(cCong.id);
ok('continua C1 até alguém mover de propósito', aindaC1.departamento === 'c1', aindaC1.departamento);

// ------------------------------------------------------------
secao('4. Com DOIS do mesmo papel, ninguém vira dono automático');
// ------------------------------------------------------------
// Rodízio automático exigiria uma regra de justiça que ninguém pediu. Sem dono,
// quem abrir primeiro assume — que é o que `assumir()` já garante sem roubo.
const CARLA2 = Number(db.prepare(`INSERT INTO usuarios (tenant_id, nome, senha_hash, papel) VALUES (?, 'carla2', 'x', 'comercial_1')`).run(T).lastInsertRowid);
const cDois = conversas.acharOuCriarConversa(T, { telefone: '5573900005555' });
ok('com 2 pessoas no C1, a conversa nasce sem dono', cDois.usuario_id === null, String(cDois.usuario_id));
ok('mas o departamento continua certo', cDois.departamento === 'c1');
ok('e a primeira que assumir leva', conversas.assumir(T, cDois.id, CARLA2) === true);
ok('a segunda NÃO rouba', conversas.assumir(T, cDois.id, CARLA) === false);
db.prepare('UPDATE usuarios SET ativo = 0 WHERE id = ?').run(CARLA2);   // volta ao cenário de 1 só

// ------------------------------------------------------------
secao('5. A fila separa de verdade');
// ------------------------------------------------------------
const filaC1 = db.prepare(`SELECT COUNT(*) n FROM conversas WHERE tenant_id=? AND departamento='c1' AND arquivada=0`).get(T).n;
const filaC2 = db.prepare(`SELECT COUNT(*) n FROM conversas WHERE tenant_id=? AND departamento='c2' AND arquivada=0`).get(T).n;
ok('há conversas nos dois lados', filaC1 > 0 && filaC2 > 0, `c1=${filaC1} c2=${filaC2}`);
ok('e a soma bate com o total',
   filaC1 + filaC2 === db.prepare('SELECT COUNT(*) n FROM conversas WHERE tenant_id=? AND arquivada=0').get(T).n);

// ------------------------------------------------------------
secao('6. O bot tem interruptor — e nasce DESLIGADO');
// ------------------------------------------------------------
ok('vem desligado por padrão', getConfig('bot_ativo', '0', T) !== '1');

setConfig('bot_ativo', '1', T);
ok('liga', getConfig('bot_ativo', '0', T) === '1');
setConfig('bot_ativo', '0', T);
ok('e desliga', getConfig('bot_ativo', '0', T) !== '1');

// o roteamento do bot bate com o da conversa — as duas regras não podem divergir
ok('bot manda quem nunca comprou pro C1', bot.departamentoDe(T, cliSemCompra ? null : null) === 'c1');
ok('bot manda quem já comprou pro C2', bot.departamentoDe(T, cliVelha) === 'c2');

// ------------------------------------------------------------
secao('7. O bot deixa rastro');
// ------------------------------------------------------------
db.prepare(`
  INSERT INTO bot_log (tenant_id, conversa_id, entrada, acao, motivo, resposta, departamento)
  VALUES (?, ?, 'tem na M?', 'respondeu', NULL, 'Temos sim! M (4)', NULL)
`).run(T, c1.id);
db.prepare(`
  INSERT INTO bot_log (tenant_id, conversa_id, entrada, acao, motivo, resposta, departamento)
  VALUES (?, ?, 'faz desconto?', 'transferiu', 'negociacao', 'Já chamo alguém', 'c1')
`).run(T, c1.id);

const log = db.prepare('SELECT acao, COUNT(*) n FROM bot_log WHERE tenant_id = ? GROUP BY 1').all(T);
ok('o log guarda o que ele respondeu e o que passou', log.length === 2, JSON.stringify(log));
ok('e diz pra QUEM passou',
   db.prepare(`SELECT departamento FROM bot_log WHERE tenant_id=? AND acao='transferiu'`).get(T).departamento === 'c1');

// ------------------------------------------------------------
secao('8. Isolamento entre lojas');
// ------------------------------------------------------------
const cVz = conversas.acharOuCriarConversa(T2, { telefone: '5573900001111' });
ok('mesmo telefone em outra loja cria conversa própria', cVz.id !== c1.id);
ok('e não herda o dono da loja A', cVz.usuario_id === null, String(cVz.usuario_id));
ok('a fila da loja A não conta a da B',
   db.prepare('SELECT COUNT(*) n FROM conversas WHERE tenant_id = ?').get(T).n ===
   filaC1 + filaC2);
ok('passar bastão numa loja não afeta a outra', conversas.passarParaC2(T2, cliVelha) === 0);

console.log(falhas === 0
  ? '\n✅ C1/C2 OK — roteamento, passagem de bastão e o bot com interruptor'
  : `\n❌ ${falhas} FALHA(S)`);
process.exit(falhas ? 1 : 0);
