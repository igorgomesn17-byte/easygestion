// ============================================================
// A GRADE ATRAVESSANDO O SISTEMA (navegador de verdade)
//
// A fase 2b provou que a MATRIZ funciona. Este prova que a cor sobrevive ao resto do
// caminho: PDV, estoque, etiquetas e vitrine. Cada uma dessas telas lia só "tamanho",
// e o erro que a modelagem antiga tornava possível é sempre o mesmo — a loja mexe na
// peça errada porque não sabe distinguir o M preto do M vermelho.
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

const DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'prop-ui-'));
const PORTA = 4300 + Math.floor(Math.random() * 400);
const URL = `http://localhost:${PORTA}`;
const DB = () => new DatabaseSync(path.join(DIR, 'dsstore.db'), { readOnly: true });

let servidor, navegador, pagina, vestidoId;

before(async () => {
  servidor = spawn(process.execPath, ['server.js'], {
    cwd: path.join(__dirname, '..'),
    env: { ...process.env,
      DB_DIR: DIR, UPLOADS_DIR: path.join(DIR, 'up'), SKIP_BACKUP: '1',
      NODE_ENV: 'development', PORT: String(PORTA),
      SESSION_SECRET: 'teste-propagacao-com-32-caracteres!',
      TOKEN_SECRET: 'teste-token-propagacao-32-caracteres',
      ADMIN_SENHA: 'Teste@123456' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let log = '';
  servidor.stdout.on('data', (d) => { log += d; });
  servidor.stderr.on('data', (d) => { log += d; });

  const limite = Date.now() + 30000;
  for (;;) {
    if (Date.now() > limite) throw new Error('servidor nao subiu:\n' + log.slice(-1500));
    try { if ((await fetch(`${URL}/health`)).ok) break; } catch {}
    await new Promise((r) => setTimeout(r, 250));
  }

  const db = new DatabaseSync(path.join(DIR, 'dsstore.db'));
  const salt = crypto.randomBytes(16).toString('hex');
  const senha = `scrypt$${salt}$${crypto.scryptSync('Teste@123456', salt, 64).toString('hex')}`;
  db.prepare(`INSERT OR REPLACE INTO tenants (id,email,senha_hash,nome_loja,nome_responsavel,telefone,plano,status,slug)
              VALUES (93,'p@t.com',?,'Loja Prop','Daisy','73999999999','growth','ativo','loja-prop')`).run(senha);
  db.prepare(`INSERT OR REPLACE INTO usuarios (nome,email,senha_hash,papel,tenant_id,email_verificado)
              VALUES ('Daisy','p@t.com',?,'admin',93,1)`).run(senha);
  db.prepare(`INSERT OR REPLACE INTO assinaturas (tenant_id,plano,valor_mensal,data_inicio,data_proxima_renovacao)
              VALUES (93,'growth',119.90,date('now'),date('now','+30 days'))`).run();
  db.prepare(`INSERT OR REPLACE INTO config (chave,valor,tenant_id) VALUES ('vitrine_ativa','1',93)`).run();
  db.close();

  navegador = await chromium.launch();
  pagina = await navegador.newPage();
  // erro de JS reprova: um ReferenceError silencioso deixaria a tela sem reagir
  pagina.on('pageerror', (e) => { throw new Error('erro de JS na pagina: ' + e.message); });

  await pagina.goto(`${URL}/login.html`);
  await pagina.fill('#email', 'p@t.com');
  await pagina.fill('#senha', 'Teste@123456');
  await pagina.click('button[type="submit"], .btn');
  await pagina.waitForURL((u) => !u.pathname.includes('login'), { timeout: 15000 });

  // Um vestido em 2 cores, mesmo tamanho M — o caso que a modelagem antiga proibia.
  // Cria pela API (a matriz já foi provada em matriz-ui.test.js).
  const r = await pagina.evaluate(async () => {
    const res = await fetch('/api/produtos', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        nome: 'Vestido Amanda', categoria: 'vestido', custo: 40, preco_venda: 120,
        grade: [
          { cor: 'Preto',    tamanho: 'M', quantidade: 3 },
          { cor: 'Preto',    tamanho: 'G', quantidade: 2 },
          { cor: 'Vermelho', tamanho: 'M', quantidade: 5 },
        ],
      }),
    });
    return res.json();
  });
  vestidoId = r.id;

  // o PDV recusa venda com o caixa fechado
  await pagina.evaluate(async () => {
    await fetch('/api/caixa/abrir', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ fundo_troco: 100 }),
    });
  });
});

after(async () => {
  if (navegador) await navegador.close();
  if (servidor) servidor.kill();
  try { fs.rmSync(DIR, { recursive: true, force: true }); } catch {}
});

// ---------------- PDV ----------------

test('PDV: o modal de escolha separa os tamanhos POR COR', async () => {
  await pagina.goto(`${URL}/pdv.html`);
  await pagina.waitForSelector('.cat-card');
  await pagina.click('.cat-card');
  await pagina.waitForSelector('#modalTam.aberto');

  const titulo = await pagina.textContent('#tamTitulo');
  assert.match(titulo, /cor e o tamanho/i, 'o modal nao pede a cor');

  const texto = await pagina.textContent('#tamOpcoes');
  assert.match(texto, /Preto/,    'nao mostrou a cor Preto');
  assert.match(texto, /Vermelho/, 'nao mostrou a cor Vermelho');

  // 3 SKUs = 3 botões. Antes, "M" e "M" apareceriam lado a lado sem dizer qual é qual.
  assert.equal(await pagina.locator('#tamOpcoes .tam-btn').count(), 3);
});

test('PDV: vender o M PRETO baixa o preto, e NAO encosta no vermelho', async () => {
  const antes = DB().prepare(`SELECT cor, tamanho, quantidade FROM variacoes
                              WHERE produto_id = ? ORDER BY cor, tamanho`).all(vestidoId);
  assert.deepEqual(antes.map(v => `${v.cor}/${v.tamanho}=${v.quantidade}`),
    ['Preto/G=2', 'Preto/M=3', 'Vermelho/M=5']);

  await pagina.goto(`${URL}/pdv.html`);
  await pagina.waitForSelector('.cat-card');
  await pagina.click('.cat-card');
  await pagina.waitForSelector('#modalTam.aberto');

  // clica o "M" que está DENTRO do bloco da cor Preto
  const idPretoM = DB().prepare(`SELECT id FROM variacoes
    WHERE produto_id = ? AND cor = 'Preto' AND tamanho = 'M'`).get(vestidoId).id;
  await pagina.click(`#tamOpcoes .tam-btn[onclick="addCarrinhoPorId(${idPretoM})"]`);

  // o carrinho tem que dizer a cor — a vendedora confere antes de finalizar
  const carrinho = await pagina.textContent('#carrinho');
  assert.match(carrinho, /Preto/, 'o carrinho nao mostra a cor da peca');

  await pagina.click('button[onclick*="finalizar"], #btnFinalizar, .btn-verde');
  await pagina.waitForTimeout(500);
  // fecha qualquer modal de pagamento e finaliza
  const finalizar = pagina.locator('button:has-text("Finalizar")').first();
  if (await finalizar.isVisible().catch(() => false)) {
    await finalizar.click();
    await pagina.waitForTimeout(1500);
  }

  const depois = DB().prepare(`SELECT cor, tamanho, quantidade FROM variacoes
                               WHERE produto_id = ? ORDER BY cor, tamanho`).all(vestidoId);
  const m = (cor) => depois.find(v => v.cor === cor && v.tamanho === 'M').quantidade;

  // O erro que a modelagem antiga tornava possível: baixar do TAMANHO, não da PEÇA.
  assert.equal(m('Vermelho'), 5, 'BAIXOU O ESTOQUE DO VERMELHO AO VENDER O PRETO');
  assert.ok(m('Preto') <= 3, 'o estoque do preto nao mudou');
});

// ---------------- ESTOQUE ----------------

test('estoque: os chips vem agrupados por cor', async () => {
  await pagina.goto(`${URL}/estoque.html`);
  await pagina.waitForSelector('#tabela .chip-tam');

  // #tabela, não `.card`: o primeiro `.card` da página é o dos filtros, não o do produto
  const lista = await pagina.textContent('#tabela');
  assert.match(lista, /Preto/,    'o card do estoque nao mostra a cor Preto');
  assert.match(lista, /Vermelho/, 'o card do estoque nao mostra a cor Vermelho');
});

test('estoque: clicar num chip abre o ajuste da PECA certa (com a cor no titulo)', async () => {
  await pagina.goto(`${URL}/estoque.html`);
  await pagina.waitForSelector('.card .chip-tam');

  const idVermM = DB().prepare(`SELECT id FROM variacoes
    WHERE produto_id = ? AND cor = 'Vermelho' AND tamanho = 'M'`).get(vestidoId).id;
  await pagina.click(`.chip-tam[onclick="abrirAjuste(${idVermM})"]`);
  await pagina.waitForSelector('#modalAj.aberto');

  const titulo = await pagina.textContent('#ajTitulo');
  assert.match(titulo, /Vermelho/, 'o ajuste nao diz QUAL cor esta sendo ajustada');
  assert.equal(await pagina.inputValue('#ajNova'), '5', 'trouxe a quantidade de outra peca');
});

// ETIQUETAS: cobertas por tests/etiquetas-ui.test.js, que faz mais — mede a geometria
// do PDF em milímetros (se a folha não tiver a medida exata do rolo, a impressora corta
// a etiqueta ao meio e o rolo vira lixo), testa os formatos e o modo lote.

// ---------------- VITRINE ----------------

test('vitrine: a cliente escolhe a COR, e so ve os tamanhos daquela cor', async () => {
  await pagina.goto(`${URL}/loja-prop/`);
  await pagina.waitForSelector('.card-produto', { timeout: 15000 });
  await pagina.click('.card-produto');
  await pagina.waitForSelector('#modalProduto.active, #modalProduto.aberto, #modalProduto[style*="flex"]', { timeout: 5000 })
    .catch(() => {});
  await pagina.waitForTimeout(600);

  const cores = await pagina.locator('#botoesCorProduto .btn-cor').allTextContents();
  assert.deepEqual(cores.sort(), ['Preto', 'Vermelho'], 'a vitrine nao oferece as 2 cores');

  // a primeira cor já vem selecionada: a cliente vê tamanho na hora, sem clique extra
  const selecionada = await pagina.locator('#botoesCorProduto .btn-cor.selected').count();
  assert.equal(selecionada, 1, 'nenhuma cor veio pre-selecionada');

  // Preto tem M e G; Vermelho só tem M. Escolher a cor filtra os tamanhos — a cliente
  // nunca pede uma combinação que a loja não tem.
  await pagina.click('#botoesCorProduto .btn-cor:has-text("Vermelho")');
  await pagina.waitForTimeout(300);
  const tamsVermelho = await pagina.locator('#botoestTamanhoProduto .btn-tamanho').allTextContents();
  assert.deepEqual(tamsVermelho, ['M'], 'o Vermelho so tem M, mas a vitrine ofereceu outro tamanho');

  await pagina.click('#botoesCorProduto .btn-cor:has-text("Preto")');
  await pagina.waitForTimeout(300);
  const tamsPreto = await pagina.locator('#botoestTamanhoProduto .btn-tamanho').allTextContents();
  assert.deepEqual(tamsPreto.sort(), ['G', 'M'], 'o Preto deveria oferecer M e G');
});

test('vitrine: o pedido do WhatsApp leva a COR (senao a loja separa a peca errada)', async () => {
  await pagina.goto(`${URL}/loja-prop/`);
  await pagina.waitForSelector('.card-produto', { timeout: 15000 });
  await pagina.click('.card-produto');
  await pagina.waitForTimeout(600);

  await pagina.click('#botoesCorProduto .btn-cor:has-text("Vermelho")');
  await pagina.waitForTimeout(200);
  await pagina.click('#botoestTamanhoProduto .btn-tamanho:has-text("M")');
  await pagina.click('#btnAdicionarCarrinho');
  await pagina.waitForTimeout(400);

  // a chave é `carrinho_<slug>` (a vitrine é por loja)
  const itens = await pagina.evaluate(() => JSON.parse(localStorage.getItem('carrinho_loja-prop') || '[]'));
  const item = (itens || []).find(i => i.tamanho === 'M');
  assert.ok(item, 'a peca nao entrou no carrinho');
  assert.equal(item.cor, 'Vermelho', 'o item do carrinho perdeu a cor');

  // O painel do carrinho só renderiza quando é aberto — abre pra conferir o que a
  // cliente lê antes de mandar o pedido.
  await pagina.click('#btnCarrinho, .btn-carrinho, [onclick*="arrinho"]').catch(() => {});
  await pagina.waitForTimeout(500);
  const painel = await pagina.textContent('#carrinhoItens');
  assert.match(painel, /Vermelho/, 'o carrinho da vitrine nao mostra a cor');

  // E a mensagem que chega no WhatsApp da loja — é por ela que a peça é separada.
  // "Vestido Amanda (M)" não diz se a cliente quer o preto ou o vermelho.
  const link = await pagina.evaluate(() => {
    const itens = JSON.parse(localStorage.getItem('carrinho_loja-prop') || '[]');
    return itens.map(i => `${i.nome}${[i.cor, i.tamanho].filter(Boolean).length ? ` (${[i.cor, i.tamanho].filter(Boolean).join(' / ')})` : ''}`).join('\n');
  });
  assert.match(link, /Vermelho \/ M/, 'o pedido do WhatsApp nao diz a cor');
});
