// ============================================================
// Vale-crédito GUARDADO é feature do Growth. O corte de valor:
//   - Devolver na hora (dinheiro/desconto) é básico — funciona no Starter.
//   - Vale que FICA SALVO pra usar depois sobe pro Growth.
//
// O bug era: o gate `vale_credito` só existia numa rota desativada (stub 410). As
// rotas que de fato geram (POST /trocas) e consomem (POST /vendas pagando com vale,
// GET /vales/:codigo) não tinham gate — o Starter usava o ciclo inteiro de graça.
//
// Este teste, com uma loja Starter e uma Growth, confirma:
//   1. Starter: devolução com saldo a favor NÃO emite vale (mas a troca funciona).
//   2. Starter: GET /vales/:codigo é barrado (403 upgrade).
//   3. Growth: emite o vale e consegue consultá-lo.
//
//   node tests/gate-vale-credito.test.js   (precisa do servidor no ar)
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

// Cria uma loja num plano, com um produto e uma venda pra devolver. Devolve os dados.
function lojaComVenda(plano, email) {
  const { hashSenha } = require('../middleware/seguranca');
  const db = new DatabaseSync(DB_PATH);
  const t = Number(db.prepare(`INSERT INTO tenants (nome_loja,nome_responsavel,telefone,email,senha_hash,plano,status)
    VALUES (?, 'R', '739', ?, ?, ?, 'ativo')`).run('Loja ' + plano, email, hashSenha('x'), plano).lastInsertRowid);
  db.prepare(`INSERT INTO usuarios (nome,email,senha_hash,papel,tenant_id,ativo,email_verificado)
    VALUES (?, ?, ?, 'admin', ?, 1, 1)`).run('Dono', email, hashSenha('Senha#2026aa'), t);
  // uma variação pra devolver (a troca baixa/sobe estoque por variacao_id)
  const prod = Number(db.prepare("INSERT INTO produtos (tenant_id, codigo, nome, preco_venda) VALUES (?, ?, 'Vestido', 100)").run(t, 'P' + t).lastInsertRowid);
  const varr = Number(db.prepare("INSERT INTO variacoes (produto_id, cor, tamanho, quantidade, tenant_id) VALUES (?, 'Preto', 'M', 10, ?)").run(prod, t).lastInsertRowid);
  // uma venda de origem com o item (a devolução exige venda_id)
  const venda = Number(db.prepare(`INSERT INTO vendas (tenant_id, total, subtotal, forma_pagamento, data_hora)
    VALUES (?, 100, 100, 'dinheiro', datetime('now'))`).run(t).lastInsertRowid);
  db.prepare(`INSERT INTO venda_itens (venda_id, produto_id, variacao_id, qtd, preco_unit, tenant_id)
    VALUES (?, ?, ?, 1, 100, ?)`).run(venda, prod, varr, t);
  db.close();
  return { t, prod, varr, venda, email, senha: 'Senha#2026aa' };
}

async function login(email, senha) {
  const r = await fetch(BASE + '/api/login', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, senha }), redirect: 'manual',
  });
  const sc = r.headers.get('set-cookie');
  return sc ? sc.split(';')[0] : null;
}

// Uma devolução pura (peça devolvida, nada levado) → diferença a favor da cliente.
async function devolver(cookie, loja) {
  const r = await fetch(BASE + '/api/trocas', {
    method: 'POST', headers: { 'Content-Type': 'application/json', Cookie: cookie },
    body: JSON.stringify({
      venda_id: loja.venda,
      devolvidos: [{ variacao_id: loja.varr, qtd: 1, valor_unit: 100, descricao: 'Vestido' }],
      levados: [], forma_pagamento: 'dinheiro', forcar_excecao: true,
    }),
  });
  return { status: r.status, corpo: await r.json().catch(() => null) };
}

async function rodar() {
  console.log('\n🎟️  TESTE: gate do vale-crédito (Starter x Growth)\n');

  const starter = lojaComVenda('starter', 'starter@vale.com');
  const growth = lojaComVenda('growth', 'growth@vale.com');

  // --- STARTER ---
  const ckStarter = await login(starter.email, starter.senha);
  if (!ckStarter) { console.log('\n❌ Starter não logou\n'); process.exit(1); }

  const devS = await devolver(ckStarter, starter);
  ok('Starter: a devolução FUNCIONA (não quebrou a troca)', devS.status === 201, `status ${devS.status} ${JSON.stringify(devS.corpo)}`);
  ok('Starter: NÃO emitiu vale guardado (resolve na hora)',
    devS.corpo && !devS.corpo.vale && devS.corpo.sem_vale === true,
    JSON.stringify(devS.corpo));
  if (devS.corpo?.mensagem) console.log(`     → "${devS.corpo.mensagem}"`);

  const consultaS = await fetch(BASE + '/api/vales/QUALQUER', { headers: { Cookie: ckStarter } });
  ok('Starter: GET /vales/:codigo é barrado (403 upgrade)', consultaS.status === 403, `status ${consultaS.status}`);

  // Confirma no banco: nenhum vale foi criado pra loja Starter.
  const dbS = new DatabaseSync(DB_PATH, { readOnly: true });
  const valesStarter = dbS.prepare('SELECT COUNT(*) n FROM vales WHERE tenant_id = ?').get(starter.t).n;
  dbS.close();
  ok('Starter: zero vales no banco', valesStarter === 0, `${valesStarter} vales`);

  // --- GROWTH ---
  console.log('');
  const ckGrowth = await login(growth.email, growth.senha);
  const devG = await devolver(ckGrowth, growth);
  ok('Growth: a devolução EMITE o vale guardado', devG.status === 201 && !!devG.corpo?.vale, JSON.stringify(devG.corpo));

  const codigo = devG.corpo?.vale?.codigo;
  if (codigo) {
    const consultaG = await fetch(BASE + '/api/vales/' + codigo, { headers: { Cookie: ckGrowth } });
    const bodyG = await consultaG.json().catch(() => null);
    ok('Growth: consegue CONSULTAR o vale (200 com saldo)',
      consultaG.status === 200 && bodyG?.saldo === 100, `status ${consultaG.status} ${JSON.stringify(bodyG)}`);
  } else {
    ok('Growth: consegue consultar o vale', false, 'não veio código do vale');
  }

  console.log(falhas === 0 ? '\n✅ GATE CORRETO: vale guardado é do Growth; devolução é básica\n' : `\n❌ ${falhas} falha(s)\n`);
  process.exit(falhas === 0 ? 0 : 1);
}

rodar().catch((e) => { console.error('\n❌ ERRO:', e.message, '\n'); process.exit(1); });
