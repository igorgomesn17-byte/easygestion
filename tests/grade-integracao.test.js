// ============================================================
// TESTE DE INTEGRACAO DA GRADE cor x tamanho
//
// Roda contra o servidor de verdade (Express + SQLite), nao contra mocks: cadastra
// um produto pela API, vende uma peca, e confere o estoque. O objetivo e' provar que
// a matriz atravessa o sistema inteiro — cadastro -> estoque -> PDV -> venda — e nao
// so que cada rota compila.
//
// O caso que da o nome ao trabalho: "Vestido Amanda" preto E vermelho, no mesmo
// tamanho M. Antes da migration 029 isso era impossivel (UNIQUE(produto_id, tamanho)).
// ============================================================
const { test, before, after } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');
const { spawn } = require('child_process');
const { DatabaseSync } = require('node:sqlite');

// Banco proprio, isolado — nunca o de producao.
const DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'grade-int-'));
const PORTA = 3400 + Math.floor(Math.random() * 500);

// server.js nao exporta o app (chama app.listen() direto), entao o servidor sobe como
// PROCESSO de verdade e o teste fala HTTP com ele. E' mais fiel: exercita o boot
// inteiro (schema.sql + as 29 migrations + middlewares) do jeito que roda em producao.
const ENV = {
  ...process.env,
  DB_DIR: DIR,
  UPLOADS_DIR: path.join(DIR, 'uploads'),
  SKIP_BACKUP: '1',
  NODE_ENV: 'development',      // 'production' exige segredos que o teste nao tem
  PORT: String(PORTA),
  SESSION_SECRET: 'teste-grade-cor-tamanho-com-32-chars',
  TOKEN_SECRET: 'teste-token-secret-com-32-caracteres-ok',
  ADMIN_SENHA: 'Teste@123456',
};

let servidor, cookie;
const base = `http://localhost:${PORTA}/api`;

// Fala com a API mantendo o cookie de sessao.
async function api(metodo, rota, corpo) {
  const res = await fetch(base + rota, {
    method: metodo,
    headers: { 'Content-Type': 'application/json', ...(cookie ? { Cookie: cookie } : {}) },
    body: corpo === undefined ? undefined : JSON.stringify(corpo),
  });
  const set = res.headers.get('set-cookie');
  if (set) cookie = set.split(';')[0];
  const texto = await res.text();
  let json = null;
  try { json = JSON.parse(texto); } catch { /* html de erro */ }
  return { status: res.status, body: json, texto };
}

// Le o banco do servidor direto (pra conferir o que a API nao devolve, ex: descricao
// gravada em venda_itens).
const abrirDb = () => new DatabaseSync(path.join(DIR, 'dsstore.db'), { readOnly: true });

before(async () => {
  servidor = spawn(process.execPath, ['server.js'], {
    cwd: path.join(__dirname, '..'), env: ENV, stdio: ['ignore', 'pipe', 'pipe'],
  });
  let log = '';
  servidor.stdout.on('data', (d) => { log += d; });
  servidor.stderr.on('data', (d) => { log += d; });

  // espera o /health responder
  const limite = Date.now() + 30000;
  for (;;) {
    if (Date.now() > limite) throw new Error('servidor nao subiu em 30s:\n' + log.slice(-2000));
    try {
      const r = await fetch(`http://localhost:${PORTA}/health`);
      if (r.ok) break;
    } catch { /* ainda subindo */ }
    await new Promise((r) => setTimeout(r, 250));
  }

  // Um tenant + um usuario admin, escritos direto no banco: o signup de verdade
  // dispara email de verificacao, que nao roda em teste.
  const db = new DatabaseSync(path.join(DIR, 'dsstore.db'));
  const salt = crypto.randomBytes(16).toString('hex');
  const senha = `scrypt$${salt}$${crypto.scryptSync('Teste@123456', salt, 64).toString('hex')}`;
  db.prepare(`INSERT OR REPLACE INTO tenants (id, email, senha_hash, nome_loja, nome_responsavel, telefone, plano, status, slug)
              VALUES (90, 'grade@teste.com', ?, 'Loja Teste', 'Admin Teste', '73999999999', 'growth', 'ativo', 'loja-teste')`).run(senha);
  // email_verificado=1 (a coluna vive em usuarios, nao em tenants): o login barra quem
  // nao confirmou, e o email de confirmacao nao sai em teste (nao ha SendGrid).
  db.prepare(`INSERT OR REPLACE INTO usuarios (nome, email, senha_hash, papel, tenant_id, email_verificado)
              VALUES ('Admin Teste', 'grade@teste.com', ?, 'admin', 90, 1)`).run(senha);
  db.prepare(`INSERT OR REPLACE INTO assinaturas (tenant_id, plano, valor_mensal, data_inicio, data_proxima_renovacao)
              VALUES (90, 'growth', 119.90, date('now'), date('now', '+30 days'))`).run();
  db.prepare(`INSERT OR REPLACE INTO config (chave, valor, tenant_id) VALUES ('vitrine_ativa', '1', 90)`).run();
  db.close();

  const login = await api('POST', '/login', { email: 'grade@teste.com', senha: 'Teste@123456' });
  assert.equal(login.status, 200, 'nao consegui logar: ' + login.texto.slice(0, 300));

  // O PDV recusa venda com o caixa fechado ("Abra o caixa do dia antes de vender").
  const caixa = await api('POST', '/caixa/abrir', { fundo_troco: 100 });
  assert.ok([200, 201].includes(caixa.status), 'nao consegui abrir o caixa: ' + caixa.texto.slice(0, 200));
});

after(() => {
  if (servidor) servidor.kill();
  try { fs.rmSync(DIR, { recursive: true, force: true }); } catch { /* windows trava o .db */ }
});

// O produto usado pelos testes abaixo (criado uma vez, reaproveitado).
let vestido;

test('cadastra um produto com a matriz: 2 cores x 2 tamanhos = 4 SKUs', async () => {
  const r = await api('POST', '/produtos', {
    nome: 'Vestido Amanda',
    categoria: 'vestido',
    custo: 40,
    preco_venda: 120,
    grade: [
      { cor: 'Preto',    tamanho: 'M', quantidade: 3 },
      { cor: 'Preto',    tamanho: 'G', quantidade: 2 },
      { cor: 'Vermelho', tamanho: 'M', quantidade: 1 },   // <- mesmo tamanho, outra cor
      { cor: 'Vermelho', tamanho: 'G', quantidade: 0 },   // grade vazia: existe, sem estoque
    ],
  });
  assert.equal(r.status, 201, 'cadastro falhou: ' + r.texto);
  assert.equal(r.body.grade.length, 4, 'deveria ter criado 4 SKUs');

  vestido = r.body.id;

  // O ponto do trabalho inteiro: Preto/M e Vermelho/M convivem no mesmo produto.
  const emM = r.body.grade.filter((g) => g.tamanho === 'M');
  assert.equal(emM.length, 2, 'nao deu pra ter o mesmo tamanho em 2 cores');
  assert.deepEqual(emM.map((g) => g.cor).sort(), ['Preto', 'Vermelho']);
});

test('cada SKU nasce com seu proprio codigo de barras (unico)', async () => {
  const r = await api('GET', `/produtos/${vestido}`);
  assert.equal(r.status, 200);

  const codigos = r.body.grade.map((g) => g.codigo_barras);
  assert.ok(codigos.every(Boolean), 'algum SKU ficou sem codigo de barras');
  assert.equal(new Set(codigos).size, 4, 'dois SKUs receberam o MESMO codigo — o leitor acharia a peca errada');
  // prefixo 2 = range GS1 pra uso interno da loja
  assert.ok(codigos.every((c) => c.startsWith('2')), 'codigo interno deveria comecar com 2');
});

test('cadastro rejeita a mesma celula duas vezes (em vez de estourar o UNIQUE)', async () => {
  const r = await api('POST', '/produtos', {
    nome: 'Duplicado', preco_venda: 10,
    grade: [
      { cor: 'Azul', tamanho: 'M', quantidade: 1 },
      { cor: 'Azul', tamanho: 'M', quantidade: 2 },   // a mesma peca de novo
    ],
  });
  assert.equal(r.status, 400, 'deveria recusar a grade com celula repetida');
  assert.match(r.body.erro, /duas vezes/i);
});

test('vincular um codigo de barras do FORNECEDOR (EAN-13 valido)', async () => {
  const r = await api('POST', '/produtos', {
    nome: 'Blusa com EAN de fabrica', preco_venda: 60,
    grade: [{ cor: 'Branco', tamanho: 'U', quantidade: 5, codigo_barras: '7891000315507' }],
  });
  assert.equal(r.status, 201, r.texto);
  assert.equal(r.body.grade[0].codigo_barras, '7891000315507', 'nao respeitou o codigo do fornecedor');
});

test('rejeita EAN-13 com digito verificador errado (erro de digitacao)', async () => {
  const r = await api('POST', '/produtos', {
    nome: 'EAN torto', preco_venda: 10,
    grade: [{ cor: 'Preto', tamanho: 'U', quantidade: 1, codigo_barras: '7891000315508' }],
  });
  assert.equal(r.status, 400);
  assert.match(r.body.erro, /verificador/i);
});

test('rejeita codigo de barras JA usado por outra peca', async () => {
  // o 7891000315507 foi vinculado a Blusa la em cima
  const r = await api('POST', '/produtos', {
    nome: 'Ladra de codigo', preco_venda: 10,
    grade: [{ cor: 'Preto', tamanho: 'U', quantidade: 1, codigo_barras: '7891000315507' }],
  });
  assert.equal(r.status, 400, 'deixou dois SKUs com o mesmo codigo');
  assert.match(r.body.erro, /já está em uso/i);
});

test('bipar o codigo de barras acha a peca exata (cor + tamanho)', async () => {
  const p = await api('GET', `/produtos/${vestido}`);
  const alvo = p.body.grade.find((g) => g.cor === 'Vermelho' && g.tamanho === 'M');

  // e' o que o PDV faz quando a pistola dispara
  const r = await api('GET', `/produtos?busca=${alvo.codigo_barras}`);
  assert.equal(r.status, 200);
  assert.equal(r.body.length, 1, 'a busca por codigo de barras deveria achar 1 produto');
  // o PDV precisa saber QUAL SKU foi bipado, senao ainda pergunta cor e tamanho
  assert.equal(r.body[0].variacao_bipada, alvo.id, 'nao identificou o SKU bipado');
});

test('o PDV vende a peca certa e baixa o estoque SO daquela cor', async () => {
  const antes = await api('GET', `/produtos/${vestido}`);
  const pretoM    = antes.body.grade.find((g) => g.cor === 'Preto'    && g.tamanho === 'M');
  const vermelhoM = antes.body.grade.find((g) => g.cor === 'Vermelho' && g.tamanho === 'M');
  assert.equal(pretoM.quantidade, 3);
  assert.equal(vermelhoM.quantidade, 1);

  const venda = await api('POST', '/vendas', {
    itens: [{ variacao_id: pretoM.id, qtd: 1 }],
    forma_pagamento: 'pix',
  });
  assert.equal(venda.status, 201, 'venda falhou: ' + venda.texto);

  const depois = await api('GET', `/produtos/${vestido}`);
  const pretoMDepois    = depois.body.grade.find((g) => g.id === pretoM.id);
  const vermelhoMDepois = depois.body.grade.find((g) => g.id === vermelhoM.id);

  assert.equal(pretoMDepois.quantidade, 2, 'nao baixou o estoque do preto M');
  // O erro que a modelagem antiga tornava possivel: baixar do tamanho, nao da peca.
  assert.equal(vermelhoMDepois.quantidade, 1, 'baixou estoque do VERMELHO ao vender o PRETO');

  // e o cupom precisa dizer qual peca saiu
  const leitura = abrirDb();
  const item = leitura.prepare('SELECT descricao FROM venda_itens WHERE variacao_id = ?').get(pretoM.id);
  leitura.close();
  assert.ok(item, 'a venda nao gravou o item');
  assert.match(item.descricao, /Preto/, 'a descricao da venda nao diz a cor');
  assert.match(item.descricao, /M/);
});

test('estoque insuficiente cita a COR na mensagem (nao so o tamanho)', async () => {
  const p = await api('GET', `/produtos/${vestido}`);
  const vermelhoM = p.body.grade.find((g) => g.cor === 'Vermelho' && g.tamanho === 'M');

  const r = await api('POST', '/vendas', {
    itens: [{ variacao_id: vermelhoM.id, qtd: 99 }],
    forma_pagamento: 'pix',
  });
  assert.equal(r.status, 400);
  // Com 4 cores do mesmo modelo, "faltou tam M" nao diz ao lojista qual peca faltou.
  assert.match(r.body.erro, /Vermelho/, 'a mensagem de estoque nao diz a cor');
});

test('editar a grade: SKU que sumiu e ZERADO, nao apagado (preserva o historico)', async () => {
  const antes = await api('GET', `/produtos/${vestido}`);
  const pretoG = antes.body.grade.find((g) => g.cor === 'Preto' && g.tamanho === 'G');
  assert.equal(pretoG.quantidade, 2);

  // manda a grade SEM o Preto/G
  const r = await api('PUT', `/produtos/${vestido}`, {
    nome: 'Vestido Amanda', custo: 40, preco_venda: 120,
    grade: antes.body.grade
      .filter((g) => g.id !== pretoG.id)
      .map((g) => ({ cor: g.cor, tamanho: g.tamanho, quantidade: g.quantidade })),
  });
  assert.equal(r.status, 200, r.texto);

  const depois = await api('GET', `/produtos/${vestido}`);
  const aindaLa = depois.body.grade.find((g) => g.id === pretoG.id);

  // Apagar a variacao dispararia CASCADE em movimentos_estoque e SET NULL em
  // venda_itens: o historico da peca some e o relatorio por cor passa a mentir.
  assert.ok(aindaLa, 'a variacao foi APAGADA — o historico de vendas dela evaporaria');
  assert.equal(aindaLa.quantidade, 0, 'deveria ter zerado o estoque');
});

test('nao vende peca zerada', async () => {
  const p = await api('GET', `/produtos/${vestido}`);
  const zerada = p.body.grade.find((g) => g.quantidade === 0);
  const r = await api('POST', '/vendas', {
    itens: [{ variacao_id: zerada.id, qtd: 1 }], forma_pagamento: 'pix',
  });
  assert.equal(r.status, 400, 'vendeu peca sem estoque');
});

test('etiquetas: uma por PECA em estoque, com cor, tamanho e o codigo do SKU', async () => {
  const r = await api('GET', `/produtos/${vestido}/etiquetas`);
  assert.equal(r.status, 200, r.texto);

  const p = await api('GET', `/produtos/${vestido}`);
  const emEstoque = p.body.grade.reduce((s, g) => s + g.quantidade, 0);

  // A tela antiga imprimia N copias do MESMO codigo. Com SKU por cor, isso cola a
  // etiqueta do preto na peca vermelha.
  assert.equal(r.body.etiquetas.length, emEstoque, 'deveria sair 1 etiqueta por peca em estoque');

  for (const e of r.body.etiquetas) {
    assert.ok(e.codigo_barras, 'etiqueta sem codigo de barras');
    assert.ok(e.cor && e.tamanho, 'etiqueta sem cor ou tamanho');
  }
  // as etiquetas do preto tem o codigo do preto, nao o do vermelho
  const codPreto = new Set(r.body.etiquetas.filter((e) => e.cor === 'Preto').map((e) => e.codigo_barras));
  const codVerm  = new Set(r.body.etiquetas.filter((e) => e.cor === 'Vermelho').map((e) => e.codigo_barras));
  for (const c of codVerm) assert.ok(!codPreto.has(c), 'o mesmo codigo saiu em cores diferentes');
});

test('estoque lista uma linha por SKU, com a cor', async () => {
  const r = await api('GET', '/estoque');
  assert.equal(r.status, 200);
  const doVestido = r.body.filter((l) => l.produto_id === vestido);
  assert.equal(doVestido.length, 4, 'o estoque deveria listar os 4 SKUs');
  assert.ok(doVestido.every((l) => l.cor), 'alguma linha do estoque veio sem cor');
});

test('a vitrine publica mostra as cores, e NAO vaza o codigo de barras', async () => {
  const r = await api('GET', '/vitrine/loja-teste/produtos');
  assert.equal(r.status, 200, r.texto);

  const v = r.body.produtos.find((p) => p.id === vestido);
  assert.ok(v, 'o vestido sumiu da vitrine');
  assert.ok(v.cores.includes('Preto') && v.cores.includes('Vermelho'), 'a vitrine nao mostra as 2 cores');

  // Peca zerada nao pode aparecer pra cliente escolher.
  assert.ok(v.grade.every((g) => g.quantidade > 0), 'a vitrine ofereceu peca sem estoque');

  // O codigo de barras e' informacao interna da loja: rota publica nao expoe.
  assert.ok(!JSON.stringify(v).includes('codigo_barras'), 'a vitrine publica esta vazando o codigo de barras');
});

test('cores sao normalizadas: "preto", "Preto " e "PRETO" sao a MESMA cor', async () => {
  // Sem isso, a mesma arara aparece fatiada em 3 e a curva por cor mente.
  const r = await api('POST', '/produtos', {
    nome: 'Teste normalizacao', preco_venda: 50,
    grade: [
      { cor: 'preto',  tamanho: 'P', quantidade: 1 },
      { cor: 'Preto ', tamanho: 'M', quantidade: 1 },
      { cor: 'PRETO',  tamanho: 'G', quantidade: 1 },
    ],
  });
  assert.equal(r.status, 201, r.texto);
  const cores = new Set(r.body.grade.map((g) => g.cor));
  assert.equal(cores.size, 1, `virou ${cores.size} cores diferentes: ${[...cores]}`);
  assert.equal([...cores][0], 'Preto');
});

test('peca sem cor vira "Unica" (nunca NULL — o UNIQUE depende disso)', async () => {
  const r = await api('POST', '/produtos', {
    nome: 'Bolsa sem cor', preco_venda: 80,
    grade: [{ tamanho: 'U', quantidade: 2 }],   // sem cor nenhuma
  });
  assert.equal(r.status, 201, r.texto);
  assert.equal(r.body.grade[0].cor, 'Unica');
});
