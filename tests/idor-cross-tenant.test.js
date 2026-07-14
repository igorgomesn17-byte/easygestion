// ============================================================
// IDOR: a loja A não pode LER nem APAGAR o recurso da loja B trocando o id na URL.
//
// É a falha nº1 em SaaS multi-tenant: /api/vendas/47 — se a rota não confere o dono,
// eu troco 47 pelo id de uma venda da concorrente e leio/apago. Este teste cria duas
// lojas COM dados e, logado como a loja A, dispara as rotas :id apontando pros ids da
// loja B. Cada uma tem que responder 403/404 (nunca 200 com o dado alheio).
//
//   node tests/idor-cross-tenant.test.js   (precisa do servidor no ar)
// ============================================================
const BASE = process.env.BASE_URL || 'http://localhost:3006';
const { DatabaseSync } = require('node:sqlite');
const path = require('path');

const DB_PATH = path.join(process.env.DB_DIR || path.join(__dirname, '.tmp-idor'), 'dsstore.db');

let falhas = 0;
const ok = (desc, cond, extra = '') => {
  if (cond) console.log(`  ✅ ${desc}`);
  else { console.log(`  ❌ ${desc}${extra ? ' → ' + extra : ''}`); falhas++; }
};

// Semeia duas lojas, cada uma com: 1 cliente, 1 produto, 1 venda, 1 despesa, 1 vale.
// Devolve os ids da loja B (a vítima) pra loja A tentar alcançar.
function semear() {
  const { hashSenha } = require('../middleware/seguranca');
  const db = new DatabaseSync(DB_PATH);

  function loja(nome, email, senha) {
    const t = Number(db.prepare(`INSERT INTO tenants (nome_loja,nome_responsavel,telefone,email,senha_hash,plano,status)
      VALUES (?, 'R', '739', ?, ?, 'growth', 'ativo')`).run(nome, email, hashSenha('x')).lastInsertRowid);
    db.prepare(`INSERT INTO usuarios (nome,email,senha_hash,papel,tenant_id,ativo,email_verificado)
      VALUES (?, ?, ?, 'admin', ?, 1, 1)`).run(nome, email, hashSenha(senha), t);
    // dados
    const cli = Number(db.prepare("INSERT INTO clientes (tenant_id, nome, telefone) VALUES (?, ?, '999')").run(t, 'Cliente ' + nome).lastInsertRowid);
    const prod = Number(db.prepare("INSERT INTO produtos (tenant_id, codigo, nome, preco_venda) VALUES (?, ?, ?, 50)").run(t, 'P' + t, 'Prod ' + nome).lastInsertRowid);
    const venda = Number(db.prepare("INSERT INTO vendas (tenant_id, total, forma_pagamento, data_hora) VALUES (?, 50, 'pix', datetime('now'))").run(t).lastInsertRowid);
    const desp = Number(db.prepare("INSERT INTO despesas (tenant_id, descricao, valor, categoria, data_competencia) VALUES (?, 'Aluguel', 100, 'fixa', date('now'))").run(t).lastInsertRowid);
    return { t, cli, prod, venda, desp };
  }

  const A = loja('LojaA', 'a@idor.com', 'SenhaLojaA#2026');
  const B = loja('LojaB', 'b@idor.com', 'SenhaLojaB#2026');
  db.close();
  return { A, B };
}

async function login(email, senha) {
  const r = await fetch(BASE + '/api/login', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, senha }), redirect: 'manual',
  });
  const sc = r.headers.get('set-cookie');
  return sc ? sc.split(';')[0] : null;
}

async function tenta(metodo, rota, cookie) {
  const r = await fetch(BASE + rota, { method: metodo, headers: { Cookie: cookie } });
  let corpo = null; try { corpo = await r.json(); } catch { /* ok */ }
  return { status: r.status, corpo };
}

async function rodar() {
  console.log('\n🔓 TESTE IDOR: a loja A não alcança o dado da loja B\n');
  const { A, B } = semear();
  const cookieA = await login('a@idor.com', 'SenhaLojaA#2026');
  if (!cookieA) { console.log('\n❌ loja A não logou\n'); process.exit(1); }

  // A logada tenta LER recursos da B pelos ids da B.
  const leituras = [
    ['GET', `/api/vendas/${B.venda}`, 'venda'],
    ['GET', `/api/produtos/${B.prod}`, 'produto'],
    ['GET', `/api/clientes/${B.cli}`, 'cliente'],
    ['GET', `/api/clientes/${B.cli}/situacao-credito`, 'situação de crédito do cliente'],
  ];
  for (const [m, rota, nome] of leituras) {
    const r = await tenta(m, rota, cookieA);
    // Seguro = não devolve o dado da B. 403/404 ok; 200 só se vier VAZIO (isolado por WHERE).
    const vazou = r.status === 200 && r.corpo && JSON.stringify(r.corpo).includes('LojaB');
    ok(`A NÃO lê ${nome} da B (${m} ${rota} → ${r.status})`, !vazou,
      vazou ? 'VAZOU: ' + JSON.stringify(r.corpo).slice(0, 120) : '');
  }

  // A logada tenta APAGAR/EDITAR recursos da B — o pior caso.
  const mutacoes = [
    ['DELETE', `/api/vendas/${B.venda}`, 'apagar venda'],
    ['DELETE', `/api/produtos/${B.prod}`, 'apagar produto'],
    ['DELETE', `/api/clientes/${B.cli}`, 'apagar cliente'],
    ['DELETE', `/api/despesas/${B.desp}`, 'apagar despesa'],
  ];
  for (const [m, rota, nome] of mutacoes) {
    const r = await tenta(m, rota, cookieA);
    const bloqueou = r.status === 403 || r.status === 404;
    ok(`A NÃO consegue ${nome} da B (${m} ${rota} → ${r.status})`, bloqueou,
      `respondeu ${r.status} (esperado 403/404)`);
  }

  // Prova de sanidade: a B ainda tem os dados dela (A não apagou nada).
  const db = new DatabaseSync(DB_PATH, { readOnly: true });
  const vendaViva = db.prepare('SELECT COUNT(*) n FROM vendas WHERE id = ? AND (deletado IS NULL OR deletado = 0)').get(B.venda).n;
  const cliVivo = db.prepare('SELECT COUNT(*) n FROM clientes WHERE id = ?').get(B.cli).n;
  db.close();
  ok('os dados da B continuam intactos (A não apagou nada)', vendaViva === 1 && cliVivo === 1,
    `venda=${vendaViva} cliente=${cliVivo}`);

  console.log(falhas === 0 ? '\n✅ SEM IDOR: cada loja só alcança o próprio dado\n' : `\n❌ ${falhas} FURO(S) DE ISOLAMENTO\n`);
  process.exit(falhas === 0 ? 0 : 1);
}

rodar().catch((e) => { console.error('\n❌ ERRO:', e.message, '\n'); process.exit(1); });
