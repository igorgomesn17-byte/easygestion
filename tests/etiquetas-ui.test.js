// ============================================================
// ETIQUETAS — a geometria do ROLO, testada de verdade
//
// Etiqueta é o único lugar do sistema onde um erro de CSS custa dinheiro físico: se a
// folha não tiver a medida EXATA do papel, a impressora térmica corta a etiqueta ao
// meio e o rolo inteiro vira lixo. Um teste que só olha o HTML não pega isso — por
// isso aqui a gente gera o PDF de impressão e mede o MediaBox em milímetros.
//
// O rolo do Igor: papel de 100mm de largura x 75mm, com DUAS etiquetas de 50mm lado a
// lado. Então a folha (@page) é 100x75 — o PAR —, não 50x75.
// ============================================================
const { test, before, after } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');
const { spawn } = require('child_process');
const { DatabaseSync } = require('node:sqlite');
const { chromium } = require('playwright');

const DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'etiq-ui-'));
const PORTA = 4700 + Math.floor(Math.random() * 300);
const URL = `http://localhost:${PORTA}`;

let servidor, navegador, pagina, produtoId, produto2Id;

// Mede as páginas do PDF em mm. 1pt PostScript = 1/72 polegada = 0.3528mm.
function paginasDoPdf(arquivo) {
  const txt = fs.readFileSync(arquivo).toString('latin1');
  const mm = (pt) => +(pt / 2.8346456).toFixed(1);
  return [...txt.matchAll(/MediaBox\s*\[\s*([\d.]+)\s+([\d.]+)\s+([\d.]+)\s+([\d.]+)\s*\]/g)]
    .map((b) => ({ largura: mm(+b[3] - +b[1]), altura: mm(+b[4] - +b[2]) }));
}
// o PDF arredonda em pontos: 100mm vira 99.8. Tolerância de meio milímetro.
const perto = (a, b) => Math.abs(a - b) <= 0.5;

before(async () => {
  servidor = spawn(process.execPath, ['server.js'], {
    cwd: path.join(__dirname, '..'),
    env: { ...process.env,
      DB_DIR: DIR, UPLOADS_DIR: path.join(DIR, 'up'), SKIP_BACKUP: '1',
      NODE_ENV: 'development', PORT: String(PORTA),
      SESSION_SECRET: 'teste-etiquetas-com-32-caracteres!!',
      TOKEN_SECRET: 'teste-token-etiquetas-32-caracteres',
      ADMIN_SENHA: 'Teste@123456' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let log = '';
  servidor.stdout.on('data', (d) => { log += d; });
  servidor.stderr.on('data', (d) => { log += d; });

  const limite = Date.now() + 30000;
  for (;;) {
    if (Date.now() > limite) throw new Error('servidor nao subiu:\n' + log.slice(-1200));
    try { if ((await fetch(`${URL}/health`)).ok) break; } catch {}
    await new Promise((r) => setTimeout(r, 250));
  }

  const db = new DatabaseSync(path.join(DIR, 'dsstore.db'));
  const salt = crypto.randomBytes(16).toString('hex');
  const senha = `scrypt$${salt}$${crypto.scryptSync('Teste@123456', salt, 64).toString('hex')}`;
  db.prepare(`INSERT OR REPLACE INTO tenants (id,email,senha_hash,nome_loja,nome_responsavel,telefone,plano,status,slug)
              VALUES (95,'etq@t.com',?,'DS Store','Daisy','73999999999','growth','ativo','ds-etq')`).run(senha);
  db.prepare(`INSERT OR REPLACE INTO usuarios (nome,email,senha_hash,papel,tenant_id,email_verificado)
              VALUES ('Daisy','etq@t.com',?,'admin',95,1)`).run(senha);
  db.prepare(`INSERT OR REPLACE INTO assinaturas (tenant_id,plano,valor_mensal,data_inicio,data_proxima_renovacao)
              VALUES (95,'growth',119.90,date('now'),date('now','+30 days'))`).run();
  db.prepare(`INSERT OR REPLACE INTO config (chave,valor,tenant_id) VALUES ('loja_nome','DS Store',95)`).run();
  db.close();

  navegador = await chromium.launch();
  pagina = await navegador.newPage({ viewport: { width: 1280, height: 950 } });
  pagina.on('pageerror', (e) => { throw new Error('erro de JS na pagina: ' + e.message); });

  await pagina.goto(`${URL}/login.html`);
  await pagina.fill('#email', 'etq@t.com');
  await pagina.fill('#senha', 'Teste@123456');
  await pagina.click('button[type="submit"], .btn');
  await pagina.waitForURL((u) => !u.pathname.includes('login'), { timeout: 15000 });

  const criar = (body) => pagina.evaluate(async (b) => {
    const r = await fetch('/api/produtos', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(b),
    });
    return r.json();
  }, body);

  // 2 pretos M + 1 preto G + 1 vermelho M = 4 peças, 3 SKUs
  produtoId = (await criar({
    nome: 'Camisa Barcelona', categoria: 'blusa', custo: 60, preco_venda: 179.89,
    grade: [
      { cor: 'Preto',    tamanho: 'M', quantidade: 2 },
      { cor: 'Preto',    tamanho: 'G', quantidade: 1 },
      { cor: 'Vermelho', tamanho: 'M', quantidade: 1 },
    ],
  })).id;

  produto2Id = (await criar({
    nome: 'Saia Midi', categoria: 'saia', custo: 30, preco_venda: 89.9,
    grade: [{ cor: 'Bege', tamanho: 'U', quantidade: 2 }],
  })).id;
});

after(async () => {
  if (navegador) await navegador.close();
  if (servidor) servidor.kill();
  try { fs.rmSync(DIR, { recursive: true, force: true }); } catch {}
});

test('sai UMA etiqueta por peça em estoque (não N cópias do mesmo código)', async () => {
  await pagina.goto(`${URL}/etiquetas.html?id=${produtoId}`);
  await pagina.waitForSelector('.etiqueta');
  // 2 + 1 + 1 = 4 peças
  assert.equal(await pagina.locator('.etiqueta').count(), 4);
});

test('cada SKU tem o SEU código — a etiqueta do preto não vai na peça vermelha', async () => {
  await pagina.goto(`${URL}/etiquetas.html?id=${produtoId}`);
  await pagina.waitForSelector('.etiqueta img');

  // agrupa o src do código de barras por variação exibida
  const porVariacao = await pagina.locator('.etiqueta').evaluateAll((els) =>
    els.map((e) => ({
      variacao: e.querySelector('.variacao')?.textContent.trim(),
      codigo: e.querySelector('.barcode img')?.getAttribute('src'),
    })));

  assert.ok(porVariacao.every((e) => e.codigo), 'alguma etiqueta saiu sem codigo de barras');

  // as 2 peças do MESMO SKU (Preto · M) compartilham o código — são a mesma peça
  const pretoM = porVariacao.filter((e) => e.variacao === 'Preto · M');
  assert.equal(pretoM.length, 2);
  assert.equal(new Set(pretoM.map((e) => e.codigo)).size, 1, 'o mesmo SKU saiu com codigos diferentes');

  // mas SKUs diferentes têm códigos diferentes — é o ponto do trabalho todo
  const codigos = new Set(porVariacao.map((e) => e.codigo));
  assert.equal(codigos.size, 3, 'os 3 SKUs deveriam ter 3 codigos distintos');
});

test('a etiqueta mostra a marca da LOJA, o nome, a variação e o preço', async () => {
  await pagina.goto(`${URL}/etiquetas.html?id=${produtoId}`);
  await pagina.waitForSelector('.etiqueta');
  const t = await pagina.locator('.etiqueta').first().textContent();

  assert.match(t, /DS Store/i,  'nao mostra a marca da loja');
  assert.match(t, /Camisa Barcelona/, 'nao mostra o nome da peca');
  assert.match(t, /Preto|Vermelho/, 'nao mostra a cor');
  assert.match(t, /179,89/, 'nao mostra o preco');
});

test('GEOMETRIA: a folha impressa é o PAR (100×75mm), e sai 2 a 2', async () => {
  // Se a folha for 50x75 (uma etiqueta), a impressora corta o par ao meio e o rolo
  // inteiro vira lixo. Este é o teste que protege dinheiro físico.
  await pagina.goto(`${URL}/etiquetas.html?id=${produtoId}`);
  await pagina.waitForSelector('.etiqueta');

  const pdf = path.join(DIR, 'saida.pdf');
  await pagina.pdf({ path: pdf, printBackground: true, preferCSSPageSize: true });

  const paginas = paginasDoPdf(pdf);
  assert.ok(paginas.length > 0, 'o PDF saiu sem pagina');

  for (const p of paginas) {
    assert.ok(perto(p.largura, 100), `a folha deveria ter 100mm de largura (o PAR), veio ${p.largura}mm`);
    assert.ok(perto(p.altura, 75),   `a folha deveria ter 75mm de altura, veio ${p.altura}mm`);
  }
  // 4 etiquetas, 2 por folha = 2 folhas
  assert.equal(paginas.length, 2, 'deveriam sair 2 a 2 (4 etiquetas = 2 folhas)');
});

test('GEOMETRIA: trocar o formato muda a folha (coluna única = 100×50mm)', async () => {
  await pagina.goto(`${URL}/etiquetas.html?id=${produto2Id}`);
  await pagina.waitForSelector('.etiqueta');

  await pagina.selectOption('#formato', '100x50');
  await pagina.waitForTimeout(300);

  const pdf = path.join(DIR, 'saida2.pdf');
  await pagina.pdf({ path: pdf, printBackground: true, preferCSSPageSize: true });

  const paginas = paginasDoPdf(pdf);
  for (const p of paginas) {
    assert.ok(perto(p.largura, 100), `esperava 100mm, veio ${p.largura}mm`);
    assert.ok(perto(p.altura, 50),   `esperava 50mm, veio ${p.altura}mm`);
  }
  // coluna única: 2 peças = 2 folhas
  assert.equal(paginas.length, 2, 'em coluna unica, cada etiqueta e uma folha');
});

test('o formato escolhido fica salvo (o lojista escolhe uma vez)', async () => {
  await pagina.goto(`${URL}/etiquetas.html?id=${produtoId}`);
  await pagina.waitForSelector('.etiqueta');
  await pagina.selectOption('#formato', '50x30x2');
  await pagina.waitForTimeout(200);

  await pagina.reload();
  await pagina.waitForSelector('.etiqueta');
  assert.equal(await pagina.inputValue('#formato'), '50x30x2', 'o formato nao foi lembrado');

  // devolve ao padrão pros próximos testes
  await pagina.selectOption('#formato', '50x75x2');
});

test('dá pra ajustar quantas etiquetas de CADA peça antes de imprimir', async () => {
  await pagina.goto(`${URL}/etiquetas.html?id=${produtoId}`);
  await pagina.waitForSelector('.etiqueta');
  assert.equal(await pagina.locator('.etiqueta').count(), 4);

  // nem sempre o lojista etiqueta tudo que tem em estoque
  await pagina.fill('#ajustes input[data-sku="0"]', '5');
  await pagina.waitForTimeout(250);
  assert.equal(await pagina.locator('.etiqueta').count(), 5 + 1 + 1);

  await pagina.click('button[onclick="zerarTudo()"]');
  await pagina.waitForTimeout(250);
  assert.equal(await pagina.locator('.etiqueta').count(), 0, '"Limpar" deveria zerar tudo');

  await pagina.click('button[onclick="usarEstoque()"]');
  await pagina.waitForTimeout(250);
  assert.equal(await pagina.locator('.etiqueta').count(), 4, '"Quantidade = estoque" deveria voltar ao estoque');
});

test('LOTE: ?ids=1,2 etiqueta a remessa inteira de uma vez', async () => {
  // A mercadoria chega em lote — o lojista quer etiquetar tudo, não abrir peça por peça.
  await pagina.goto(`${URL}/etiquetas.html?ids=${produtoId},${produto2Id}`);
  await pagina.waitForSelector('.etiqueta');

  // 4 da camisa + 2 da saia
  assert.equal(await pagina.locator('.etiqueta').count(), 6);

  const t = await pagina.textContent('#ajustes');
  assert.match(t, /Camisa Barcelona/);
  assert.match(t, /Saia Midi/, 'o lote nao trouxe o segundo produto');
});

test('o botao "Etiquetar" da tela de produtos leva a remessa filtrada', async () => {
  await pagina.goto(`${URL}/produtos.html`);
  await pagina.waitForSelector('#btnEtiquetarTudo:not([disabled])');

  // 4 pecas da camisa + 2 da saia = 6 etiquetas
  assert.match(await pagina.textContent('#btnEtiquetarTudo'), /\(6\)/, 'o botao nao conta as pecas');

  await pagina.click('#btnEtiquetarTudo');
  await pagina.waitForURL(/etiquetas\.html\?ids=/, { timeout: 8000 });
  await pagina.waitForSelector('.etiqueta');
  assert.equal(await pagina.locator('.etiqueta').count(), 6);
});

test('a rota /etiquetas (lote) nao e capturada pelo GET /:id', async () => {
  // O Express casa as rotas na ordem de registro: se /:id vier antes, ele engole a
  // palavra "etiquetas" (virando id="etiquetas") e o lote devolve 404.
  const r = await pagina.evaluate(async (ids) => {
    const res = await fetch('/api/produtos/etiquetas?ids=' + ids);
    return { status: res.status, body: await res.json() };
  }, `${produtoId},${produto2Id}`);

  assert.equal(r.status, 200, 'GET /api/produtos/etiquetas caiu no /:id');
  assert.equal(r.body.produtos.length, 2);
  assert.equal(r.body.etiquetas.length, 6);
});
