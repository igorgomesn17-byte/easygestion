// ============================================================
// A MATRIZ, DIRIGIDA DE VERDADE (Playwright, navegador real)
//
// Os testes de backend provam que a API aceita a matriz. Este prova que o LOJISTA
// consegue preenche-la — que e' outra coisa. A tela e' a que a Daisy usa toda semana
// quando chega mercadoria: se ela nao for rapida de preencher, o resto nao importa.
//
// O que este teste exercita e que so aparece no navegador:
//   - digitar numa celula NAO pode roubar o foco (o render inteiro a cada tecla faria isso)
//   - colar uma linha da planilha do fornecedor espalha os valores pela linha
//   - Enter desce pra proxima cor, em vez de submeter o formulario
//   - o produto salvo chega no banco com os SKUs certos
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

const DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'matriz-ui-'));
const PORTA = 3900 + Math.floor(Math.random() * 400);
const URL = `http://localhost:${PORTA}`;

let servidor, navegador, pagina;

before(async () => {
  servidor = spawn(process.execPath, ['server.js'], {
    cwd: path.join(__dirname, '..'),
    env: {
      ...process.env,
      DB_DIR: DIR, UPLOADS_DIR: path.join(DIR, 'uploads'), SKIP_BACKUP: '1',
      NODE_ENV: 'development', PORT: String(PORTA),
      SESSION_SECRET: 'teste-matriz-ui-com-32-caracteres-ok',
      TOKEN_SECRET: 'teste-token-matriz-com-32-caracteres',
      ADMIN_SENHA: 'Teste@123456',
    },
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
  db.prepare(`INSERT OR REPLACE INTO tenants (id, email, senha_hash, nome_loja, nome_responsavel, telefone, plano, status, slug)
              VALUES (91, 'ui@teste.com', ?, 'Loja UI', 'Admin', '73999999999', 'growth', 'ativo', 'loja-ui')`).run(senha);
  db.prepare(`INSERT OR REPLACE INTO usuarios (nome, email, senha_hash, papel, tenant_id, email_verificado)
              VALUES ('Admin UI', 'ui@teste.com', ?, 'admin', 91, 1)`).run(senha);
  db.prepare(`INSERT OR REPLACE INTO assinaturas (tenant_id, plano, valor_mensal, data_inicio, data_proxima_renovacao)
              VALUES (91, 'growth', 119.90, date('now'), date('now','+30 days'))`).run();
  db.close();

  navegador = await chromium.launch();
  pagina = await navegador.newPage();

  // erro de JS na tela reprova o teste: um ReferenceError silencioso deixaria a matriz
  // sem reagir e todo o resto "passaria" por engano
  pagina.on('pageerror', (e) => { throw new Error('erro de JS na pagina: ' + e.message); });

  await pagina.goto(`${URL}/login.html`);
  await pagina.fill('#email', 'ui@teste.com');
  await pagina.fill('#senha', 'Teste@123456');
  await pagina.click('button[type="submit"], .btn');
  await pagina.waitForURL((u) => !u.pathname.includes('login'), { timeout: 15000 });
});

after(async () => {
  if (navegador) await navegador.close();
  if (servidor) servidor.kill();
  try { fs.rmSync(DIR, { recursive: true, force: true }); } catch {}
});

const abrirModal = async () => {
  await pagina.goto(`${URL}/produtos.html`);
  await pagina.click('button[onclick="abrirCadastro()"]');
  await pagina.waitForSelector('#modalCad.aberto');
};

const celula = (cor, tam) => `#matrizBox input.qtd[data-linha="${cor}"][data-tam="${tam}"]`;

test('a matriz nasce vazia e convida a adicionar a primeira cor', async () => {
  await abrirModal();
  const texto = await pagina.textContent('#matrizBox');
  assert.match(texto, /Nenhuma cor ainda/i);
});

test('adiciona 2 cores e a grade vira uma matriz de verdade', async () => {
  await abrirModal();
  await pagina.fill('#novaCor', 'Preto');
  await pagina.click('button[onclick="addCor()"]');
  await pagina.fill('#novaCor', 'Vermelho');
  await pagina.click('button[onclick="addCor()"]');

  const linhas = await pagina.locator('#matrizBox tbody tr').count();
  assert.equal(linhas, 2, 'deveria ter uma linha por cor');

  // 5 tamanhos padrao (PP..GG) x 2 cores = 10 celulas
  assert.equal(await pagina.locator('#matrizBox input.qtd').count(), 10);
});

test('recusa a mesma cor duas vezes (o backend normaliza e viraria duplicata)', async () => {
  await abrirModal();
  await pagina.fill('#novaCor', 'Preto');
  await pagina.click('button[onclick="addCor()"]');
  // "PRETO" normaliza pra "Preto" no backend: a tela tem que barrar ANTES
  await pagina.fill('#novaCor', 'PRETO');
  await pagina.click('button[onclick="addCor()"]');
  assert.equal(await pagina.locator('#matrizBox tbody tr').count(), 1, 'aceitou a mesma cor duas vezes');
});

test('digitar NAO rouba o foco da celula (o bug classico do re-render)', async () => {
  await abrirModal();
  await pagina.fill('#novaCor', 'Preto');
  await pagina.click('button[onclick="addCor()"]');

  const alvo = celula(0, 'M');
  await pagina.click(alvo);
  // digita 2 digitos: se o input re-renderizar a cada tecla, o foco cai e some o "2"
  await pagina.keyboard.type('12');

  assert.equal(await pagina.inputValue(alvo), '12', 'a tela perdeu digito (o foco saiu no meio da digitacao)');
  const focado = await pagina.evaluate(() => document.activeElement?.dataset?.tam);
  assert.equal(focado, 'M', 'o foco saiu da celula durante a digitacao');
});

test('Tab anda pela grade (nao sai do formulario)', async () => {
  await abrirModal();
  await pagina.fill('#novaCor', 'Preto');
  await pagina.click('button[onclick="addCor()"]');

  await pagina.click(celula(0, 'PP'));
  await pagina.keyboard.type('3');
  await pagina.keyboard.press('Tab');
  await pagina.keyboard.type('5');

  assert.equal(await pagina.inputValue(celula(0, 'PP')), '3');
  assert.equal(await pagina.inputValue(celula(0, 'P')), '5', 'o Tab nao foi pra proxima celula da linha');
});

test('Enter desce pra proxima COR (mesmo tamanho), e nao submete o form', async () => {
  await abrirModal();
  for (const c of ['Preto', 'Vermelho']) {
    await pagina.fill('#novaCor', c);
    await pagina.click('button[onclick="addCor()"]');
  }
  await pagina.click(celula(0, 'M'));
  await pagina.keyboard.type('2');
  await pagina.keyboard.press('Enter');
  await pagina.keyboard.type('7');

  assert.equal(await pagina.inputValue(celula(1, 'M')), '7', 'o Enter nao desceu pra proxima cor');
  // o modal continua aberto: Enter nao pode ter salvado a peca pela metade
  assert.ok(await pagina.isVisible('#modalCad.aberto'), 'o Enter submeteu o formulario');
});

test('colar uma linha da planilha do fornecedor espalha os valores', async () => {
  await abrirModal();
  await pagina.fill('#novaCor', 'Preto');
  await pagina.click('button[onclick="addCor()"]');

  // e' assim que a mercadoria chega: em lista, nao digitada uma a uma
  await pagina.click(celula(0, 'PP'));
  await pagina.evaluate(() => {
    const inp = document.querySelector('#matrizBox input.qtd[data-linha="0"][data-tam="PP"]');
    const dt = new DataTransfer();
    dt.setData('text', '2\t4\t6\t3\t1');
    inp.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }));
  });
  await pagina.waitForTimeout(150);

  const esperado = { PP: '2', P: '4', M: '6', G: '3', GG: '1' };
  for (const [t, v] of Object.entries(esperado)) {
    assert.equal(await pagina.inputValue(celula(0, t)), v, `a colagem nao preencheu o tamanho ${t}`);
  }
});

test('"aplicar mesma qtd" preenche a grade inteira', async () => {
  await abrirModal();
  for (const c of ['Preto', 'Bege']) {
    await pagina.fill('#novaCor', c);
    await pagina.click('button[onclick="addCor()"]');
  }
  pagina.once('dialog', (d) => d.accept('4'));
  await pagina.click('button[onclick="aplicarATodos()"]');
  await pagina.waitForTimeout(150);

  assert.equal(await pagina.inputValue(celula(0, 'M')), '4');
  assert.equal(await pagina.inputValue(celula(1, 'GG')), '4');
  // 2 cores x 5 tamanhos x 4 pecas
  assert.match(await pagina.textContent('#matrizResumo'), /40 peças/i);
});

test('o resumo conta as PECAS e as VARIACOES separadamente', async () => {
  await abrirModal();
  await pagina.fill('#novaCor', 'Preto');
  await pagina.click('button[onclick="addCor()"]');
  await pagina.fill(celula(0, 'M'), '3');
  await pagina.fill(celula(0, 'G'), '2');

  const resumo = await pagina.textContent('#matrizResumo');
  assert.match(resumo, /5 peças/i,     'nao somou as pecas');
  assert.match(resumo, /2 variações/i, 'nao contou os SKUs (cor+tamanho)');
});

test('SALVA a matriz: 2 cores x 2 tamanhos viram 4 SKUs no banco', async () => {
  await abrirModal();
  await pagina.fill('#nome', 'Vestido Amanda');
  await pagina.fill('#custo', '40');
  await pagina.fill('#preco', '120');

  for (const c of ['Preto', 'Vermelho']) {
    await pagina.fill('#novaCor', c);
    await pagina.click('button[onclick="addCor()"]');
  }
  await pagina.fill(celula(0, 'M'), '3');
  await pagina.fill(celula(0, 'G'), '2');
  await pagina.fill(celula(1, 'M'), '1');   // mesmo tamanho, outra cor
  await pagina.fill(celula(1, 'G'), '4');

  await pagina.click('button[onclick="salvar()"]');
  // o modal fecha tirando a classe .aberto, e aí o CSS o esconde. Esperar por
  // `#modalCad:not(.aberto)` ficar VISÍVEL é contradição — ele fecha justamente
  // ficando invisível. Espera o estado, não a visibilidade.
  await pagina.waitForFunction(
    () => !document.getElementById('modalCad').classList.contains('aberto'),
    null, { timeout: 10000 }
  );

  // confere no BANCO, nao na tela: a tela pode mentir, o banco nao
  const db = new DatabaseSync(path.join(DIR, 'dsstore.db'), { readOnly: true });
  const skus = db.prepare(`
    SELECT v.cor, v.tamanho, v.quantidade, v.codigo_barras
    FROM variacoes v JOIN produtos p ON p.id = v.produto_id
    WHERE p.nome = 'Vestido Amanda' AND p.tenant_id = 91
    ORDER BY v.cor, v.tamanho
  `).all();
  db.close();

  assert.equal(skus.length, 4, 'deveria ter gravado 4 SKUs');
  assert.deepEqual(
    skus.map((s) => `${s.cor}/${s.tamanho}=${s.quantidade}`),
    ['Preto/G=2', 'Preto/M=3', 'Vermelho/G=4', 'Vermelho/M=1']
  );
  // cada SKU sai com seu proprio codigo — a etiqueta do preto nao pode ir na peca vermelha
  assert.ok(skus.every((s) => s.codigo_barras), 'algum SKU ficou sem codigo de barras');
  assert.equal(new Set(skus.map((s) => s.codigo_barras)).size, 4, 'dois SKUs receberam o MESMO codigo');
});

test('reabrir pra editar traz a matriz montada do jeito que foi salva', async () => {
  await pagina.goto(`${URL}/produtos.html`);
  await pagina.waitForSelector('button[onclick^="editar("]');
  await pagina.click('button[onclick^="editar("]');
  await pagina.waitForSelector('#modalCad.aberto');
  await pagina.waitForSelector('#matrizBox input.qtd');

  assert.equal(await pagina.locator('#matrizBox tbody tr').count(), 2, 'as 2 cores nao voltaram');
  // as colunas viram os tamanhos que a peca REALMENTE tem (M e G), nao os 5 padroes
  const cabecalhos = await pagina.locator('#matrizBox thead th').allTextContents();
  assert.deepEqual(cabecalhos, ['Cor', 'M', 'G', 'Total'], 'as colunas nao vieram da grade salva');
  assert.equal(await pagina.inputValue(celula(0, 'M')), '3');
  assert.equal(await pagina.inputValue(celula(1, 'G')), '4');
});
