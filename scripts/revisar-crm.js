// ============================================================
// PREPARA O BANCO LOCAL PRA REVISAR O CRM COMERCIAL
// ------------------------------------------------------------
// As telas novas (Prospecção, Placar, WhatsApp) são gated em `crm_avancado` e
// `relacionamento`, que só existem no plano `interno`/`enterprise`. O tenant local
// está em `growth` — sem este script o menu não mostra nada e a revisão para antes
// de começar.
//
// Também popula o funil com dados de exemplo, senão o kanban abre vazio e não há
// o que olhar.
//
//   node scripts/revisar-crm.js
//
// ⚠️ SÓ PARA DESENVOLVIMENTO. Não rodar contra o banco de produção — ele muda o
// plano do tenant e insere dados fictícios.
// ============================================================
const { db } = require('../db/database');

const TENANT = Number(process.argv[2]) || 2;   // DS Store no banco local

const t = db.prepare('SELECT id, nome_loja, plano FROM tenants WHERE id = ?').get(TENANT);
if (!t) {
  console.error(`❌ Tenant ${TENANT} não existe. Use: node scripts/revisar-crm.js <id>`);
  process.exit(1);
}

console.log(`\nPreparando "${t.nome_loja}" (id ${t.id}, plano ${t.plano}) para revisão…\n`);

// 1. Plano interno — libera relacionamento, crm_avancado, atacado e vitrine_site
db.prepare("UPDATE tenants SET plano = 'interno' WHERE id = ?").run(TENANT);
db.prepare("UPDATE assinaturas SET plano = 'interno' WHERE tenant_id = ?").run(TENANT);
console.log('✅ Plano → interno (libera Prospecção, Placar, WhatsApp e atacado)');

// 2. Prospects em vários estágios, pro kanban ter o que mostrar
const exemplos = [
  { nome: 'Modas Cristina',   tel: '5573988001001', cidade: 'Ipiaú',      estagio: 'novo',       dias: 0 },
  { nome: 'Loja Bela Vista',  tel: '5573988001002', cidade: 'Itapetinga', estagio: 'novo',       dias: 1 },
  { nome: 'Ateliê Rosa',      tel: '5573988001003', cidade: 'Ilhéus',     estagio: 'falei',      dias: 4 },
  { nome: 'Vitrine Chic',     tel: '5573988001004', cidade: 'Itabuna',    estagio: 'falei',      dias: 1 },
  { nome: 'Boutique Lila',    tel: '5573988001005', cidade: 'Camacan',    estagio: 'catalogo',   dias: 2 },
  { nome: 'Casa da Moda',     tel: '5573988001006', cidade: 'Jequié',     estagio: 'negociando', dias: 5 },
];

const insCli = db.prepare(`
  INSERT INTO clientes (tenant_id, nome, telefone, cidade, tipo, origem)
  VALUES (?, ?, ?, ?, 'prospect', 'prospeccao')
`);
const insConv = db.prepare(`
  INSERT INTO conversas (tenant_id, cliente_id, canal, telefone, contato_nome, estagio, origem, ultima_interacao, criado_em)
  VALUES (?, ?, 'whatsapp', ?, ?, ?, 'prospeccao', datetime('now','localtime', ?), datetime('now','localtime', ?))
`);
const insMsg = db.prepare(`
  INSERT INTO mensagens (tenant_id, conversa_id, direcao, tipo, texto, status, criado_em)
  VALUES (?, ?, ?, 'text', ?, 'recebida', datetime('now','localtime', ?))
`);

let criados = 0;
for (const e of exemplos) {
  const ja = db.prepare('SELECT id FROM clientes WHERE tenant_id = ? AND telefone = ?').get(TENANT, e.tel);
  if (ja) continue;

  const cliId = Number(insCli.run(TENANT, e.nome, e.tel, e.cidade).lastInsertRowid);
  const convId = Number(insConv.run(TENANT, cliId, e.tel, e.nome, e.estagio,
    `-${e.dias} days`, `-${e.dias + 2} days`).lastInsertRowid);

  // Card com a última mensagem DELA fica marcado como "esperando você" — é o
  // sinal que a tela usa, sem ninguém precisar marcar nada.
  if (e.estagio !== 'novo') {
    insMsg.run(TENANT, convId, 'enviada', 'Oi! Somos a loja, temos atacado 🌿', `-${e.dias + 1} days`);
    if (e.estagio === 'negociando') {
      insMsg.run(TENANT, convId, 'recebida', 'Qual o pedido mínimo?', `-${e.dias} days`);
    }
  }
  criados++;
}
console.log(`✅ ${criados} contatos de exemplo no funil de prospecção`);

// 3. Cadência semanal ligada no dia de hoje, pra ver o gatilho novo funcionando
const jsDay = new Date().getDay();
const isoHoje = jsDay === 0 ? 7 : jsDay;
db.prepare(`
  INSERT INTO config (chave, valor, tenant_id) VALUES ('crm_catalogo_dia', ?, ?)
  ON CONFLICT(chave, tenant_id) DO UPDATE SET valor = excluded.valor
`).run(String(isoHoje), TENANT);
console.log(`✅ Cadência semanal ligada no dia de hoje (${isoHoje})`);

console.log(`
────────────────────────────────────────────────────
Pronto. Agora:

  npm start

E abra:
  /prospeccao.html   o kanban (arraste um card entre colunas)
  /placar.html       os números do time
  /canal.html        conexão do WhatsApp (o aviso de risco)
  /relacionamento.html  a fila do dia — o botão agora diz "Enviar no WhatsApp"
                        porque não há canal conectado

Pra desfazer: volte o plano do tenant ${TENANT} pra 'growth'.
────────────────────────────────────────────────────
`);
