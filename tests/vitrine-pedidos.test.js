// ============================================================
// PEDIDOS E LEADS DA VITRINE — o que custa dinheiro se quebrar.
//
//   1. PRECO VINDO DO CLIENTE. Se o pedido aceitasse preco do body, qualquer um
//      pediria um vestido por R$ 1 — e a lojista veria "R$ 1" na tela achando
//      que foi promocao dela.
//   2. PEDIR PECA DA LOJA VIZINHA. Rota publica, sem sessao: o unico isolamento
//      e' o tenant_id no WHERE. Se falhar, uma loja lanca pedido na outra.
//   3. CODIGO DUPLICADO. Dois pedidos com #A7K2 na mesma loja fazem a lojista
//      abrir o pedido errado no balcao.
//   4. LEAD VIRANDO CLIENTE SOZINHO. Todo visitante que digita um telefone
//      poluiria o RFM e a regua com quem nunca comprou (o problema que a
//      migration 040 resolveu).
//   5. PIXEL ACEITANDO SCRIPT. O banco guarda ID; aceitar HTML colado seria XSS
//      auto-infligido numa pagina publica.
//
//   node tests/vitrine-pedidos.test.js
// ============================================================
process.env.DB_DIR = process.env.DB_DIR || './tests/.tmp-vpedidos';
process.env.ORIGIN = process.env.ORIGIN || 'https://www.easygestao.com';
const fs = require('fs');
const path = require('path');

const dir = path.resolve(process.env.DB_DIR);
if (fs.existsSync(dir)) fs.rmSync(dir, { recursive: true, force: true });
fs.mkdirSync(dir, { recursive: true });

const { db, setConfig } = require('../db/database');
const {
  criarPedido, listarPedidos, pedidoPorCodigo, mudarStatus,
  registrarLead, listarLeads, gerarCodigo, ALFABETO,
} = require('../lib/vitrine-pedidos');
const { blocoPixelMeta, blocoPixelGoogle, precoSchema, schemaProduto } = require('../lib/vitrine-html');

let falhas = 0;
function ok(desc, cond, extra = '') {
  if (cond) console.log(`  ✅ ${desc}`);
  else { console.log(`  ❌ ${desc}${extra ? ' → ' + extra : ''}`); falhas++; }
}
function secao(t) { console.log(`\n${t}`); }

// ---------- Setup: duas lojas com estoque ----------
let seq = 0;
function novaLoja(plano, slug) {
  const r = db.prepare(`
    INSERT INTO tenants (nome_loja, nome_responsavel, telefone, email, senha_hash, plano, status, slug)
    VALUES (?, 'Resp', '73999990000', ?, 'x', ?, 'ativo', ?)
  `).run('Loja ' + (++seq), `vp-${seq}-${Date.now()}@t.com`, plano, slug);
  const id = Number(r.lastInsertRowid);
  setConfig('vitrine_ativa', '1', id);
  return id;
}
function novaPeca(tenantId, nome, preco, tamanho = 'M', qtd = 5, cor = 'Unica') {
  const p = db.prepare(`
    INSERT INTO produtos (tenant_id, codigo, nome, preco_venda, custo, ativo)
    VALUES (?, ?, ?, ?, 10, 1)
  `).run(tenantId, `C${tenantId}-${nome}`.slice(0, 20), nome, preco);
  const pid = Number(p.lastInsertRowid);
  db.prepare('INSERT INTO variacoes (tenant_id, produto_id, cor, tamanho, quantidade) VALUES (?,?,?,?,?)')
    .run(tenantId, pid, cor, tamanho, qtd);
  return pid;
}

const LOJA_A = novaLoja('interno', 'loja-a');
const LOJA_B = novaLoja('interno', 'loja-b');
const PECA_A = novaPeca(LOJA_A, 'Vestido', 189.9);
const PECA_B = novaPeca(LOJA_B, 'Blusa', 79.9);

// ============================================================
secao('1. Criar pedido — o preco vem do BANCO, nunca do cliente');

const p1 = criarPedido(LOJA_A, { itens: [{ produto_id: PECA_A, tamanho: 'M', qtd: 2 }] });
ok('pedido criado', p1.ok);
ok('total calculado do banco', p1.total === 189.9 * 2, `deu ${p1.total}`);
ok('codigo tem 4 chars', p1.codigo && p1.codigo.length === 4, p1.codigo);
ok('codigo sem caractere ambiguo (0/O/1/I/L)', !/[0O1IL]/.test(p1.codigo), p1.codigo);

// O ataque: mandar preco no body
const p2 = criarPedido(LOJA_A, { itens: [{ produto_id: PECA_A, tamanho: 'M', qtd: 1, preco_unit: 1, preco: 1 }] });
ok('IGNORA preco enviado pelo cliente', p2.total === 189.9, `deu ${p2.total}`);

const itens = db.prepare('SELECT * FROM vitrine_pedido_itens WHERE pedido_id = ?').all(p1.id);
ok('itens gravados', itens.length === 1);
ok('snapshot do nome', itens[0].produto_nome === 'Vestido');
ok('snapshot do preco', itens[0].preco_unit === 189.9);
ok('variacao vinculada', !!itens[0].variacao_id);

// Snapshot: mudar o preco depois NAO reescreve o pedido antigo
db.prepare('UPDATE produtos SET preco_venda = 250 WHERE id = ?').run(PECA_A);
const relido = pedidoPorCodigo(LOJA_A, p1.codigo);
ok('preco do pedido NAO muda quando a lojista remarca', relido.itens[0].preco_unit === 189.9, `deu ${relido.itens[0].preco_unit}`);
db.prepare('UPDATE produtos SET preco_venda = 189.9 WHERE id = ?').run(PECA_A);

// ============================================================
secao('2. Isolamento — nao da pra pedir peca da loja vizinha');

const cruzado = criarPedido(LOJA_A, { itens: [{ produto_id: PECA_B, tamanho: 'M', qtd: 1 }] });
ok('peca de OUTRA loja e recusada', !cruzado.ok, JSON.stringify(cruzado));

// Misturado: a peca valida entra, a alheia e' descartada
const misto = criarPedido(LOJA_A, { itens: [
  { produto_id: PECA_A, tamanho: 'M', qtd: 1 },
  { produto_id: PECA_B, tamanho: 'M', qtd: 1 },
] });
ok('pedido misto so aceita a peca da propria loja', misto.ok && misto.itens.length === 1);
ok('total do misto ignora a peca alheia', misto.total === 189.9, `deu ${misto.total}`);

// Produto inativo tambem nao entra
db.prepare('UPDATE produtos SET ativo = 0 WHERE id = ?').run(PECA_A);
const inativo = criarPedido(LOJA_A, { itens: [{ produto_id: PECA_A, tamanho: 'M', qtd: 1 }] });
ok('produto inativo e recusado', !inativo.ok);
db.prepare('UPDATE produtos SET ativo = 1 WHERE id = ?').run(PECA_A);

ok('pedido sem itens e recusado', !criarPedido(LOJA_A, { itens: [] }).ok);
ok('itens nao-array e recusado', !criarPedido(LOJA_A, { itens: 'x' }).ok);

// ============================================================
secao('3. Codigo unico por loja');

const vistos = new Set();
for (let i = 0; i < 40; i++) {
  const p = criarPedido(LOJA_A, { itens: [{ produto_id: PECA_A, tamanho: 'M', qtd: 1 }] });
  vistos.add(p.codigo);
}
ok('40 pedidos, 40 codigos distintos', vistos.size === 40, `${vistos.size} distintos`);
ok('so usa o alfabeto seguro', [...vistos].every(c => [...c].every(ch => ALFABETO.includes(ch))));

// Duas lojas PODEM ter o mesmo codigo (o UNIQUE e composto com tenant_id)
const codA = [...vistos][0];
db.prepare("INSERT INTO vitrine_pedidos (tenant_id, codigo, total) VALUES (?,?,50)").run(LOJA_B, codA);
ok('mesma sequencia serve pra outra loja', !!pedidoPorCodigo(LOJA_B, codA));
ok('cada loja le o SEU pedido', pedidoPorCodigo(LOJA_B, codA).total === 50 && pedidoPorCodigo(LOJA_A, codA).total !== 50);

// ============================================================
secao('4. Status e leitura da lojista');

ok('status novo por padrao', pedidoPorCodigo(LOJA_A, p1.codigo).status === 'novo');
ok('muda pra fechado', mudarStatus(LOJA_A, p1.id, 'fechado').ok);
ok('status persistiu', pedidoPorCodigo(LOJA_A, p1.codigo).status === 'fechado');
ok('status invalido recusado', !mudarStatus(LOJA_A, p1.id, 'qualquer').ok);
// Mexer no pedido da outra loja tem que FALHAR, e falhar com erro — nao {ok:true}
ok('nao muda pedido de outra loja', !mudarStatus(LOJA_B, p1.id, 'fechado').ok);

const lista = listarPedidos(LOJA_A, { limite: 100 });
ok('lista traz os pedidos da loja', lista.length > 0);
ok('cada pedido vem com itens', lista.every(p => Array.isArray(p.itens)));
ok('lista NAO traz pedido de outra loja', lista.every(p => p.tenant_id === LOJA_A));
// disponivel_agora e' calculado na LEITURA: o estoque muda entre o pedido e a conversa
const comItens = lista.find(p => p.itens.length);
ok('item informa estoque ATUAL', comItens && comItens.itens[0].disponivel_agora !== undefined);

ok('filtro por status funciona', listarPedidos(LOJA_A, { status: 'fechado' }).every(p => p.status === 'fechado'));

// ============================================================
secao('5. Leads — NAO viram cliente sozinhos');

ok('lead gravado', registrarLead(LOJA_A, { nome: 'Maria', telefone: '(73) 98888-7777', fonte: 'newsletter', consentiu: 1 }).ok);
ok('telefone curto recusado', !registrarLead(LOJA_A, { telefone: '123' }).ok);
ok('telefone vazio recusado', !registrarLead(LOJA_A, { telefone: '' }).ok);

// Mesma pessoa mandando 5x e' UM lead
for (let i = 0; i < 5; i++) registrarLead(LOJA_A, { nome: 'Maria', telefone: '73988887777' });
const leads = listarLeads(LOJA_A);
ok('nao duplica o mesmo telefone', leads.filter(l => l.telefone === '73988887777').length === 1);
ok('telefone normalizado (so digitos)', leads.some(l => l.telefone === '73988887777'));

// Reenviar sem nome NAO apaga o nome que ja existia
registrarLead(LOJA_A, { telefone: '73988887777' });
ok('COALESCE preserva o nome antigo', listarLeads(LOJA_A).find(l => l.telefone === '73988887777').nome === 'Maria');

// A REGRA CENTRAL: lead nao entra em `clientes`
const virouCliente = db.prepare('SELECT COUNT(1) n FROM clientes WHERE tenant_id = ?').get(LOJA_A).n;
ok('lead NAO virou cliente automaticamente', virouCliente === 0, `${virouCliente} clientes`);
ok('lead nasce sem cliente_id', listarLeads(LOJA_A).every(l => l.cliente_id === null));

// LGPD: IP nunca em claro
registrarLead(LOJA_A, { telefone: '73977776666', ip: '191.2.3.4' });
const comIp = listarLeads(LOJA_A).find(l => l.telefone === '73977776666');
ok('IP guardado como hash', comIp.ip_hash && !comIp.ip_hash.includes('191.2.3.4'));

ok('lead de uma loja nao aparece na outra', listarLeads(LOJA_B).length === 0);

// ============================================================
secao('6. Pixel — o banco guarda ID, nunca script');

ok('ID valido do Meta gera snippet', blocoPixelMeta('1234567890').includes("fbq('init','1234567890')"));
ok('REJEITA script colado', blocoPixelMeta('<script>alert(1)</script>') === '');
ok('REJEITA ID com aspas (quebraria o JS)', blocoPixelMeta("123',alert(1),'") === '');
ok('REJEITA vazio', blocoPixelMeta('') === '');
ok('REJEITA letras', blocoPixelMeta('abc123') === '');
ok('REJEITA curto demais', blocoPixelMeta('123') === '');

ok('G- valido', blocoPixelGoogle('G-ABC1234567').includes('G-ABC1234567'));
ok('AW- valido', blocoPixelGoogle('AW-1234567890').includes('AW-1234567890'));
ok('GTM- valido', blocoPixelGoogle('GTM-ABCD').includes('GTM-ABCD'));
ok('REJEITA google injection', blocoPixelGoogle("G-X';alert(1);'") === '');
ok('REJEITA formato errado', blocoPixelGoogle('UA-123456') === '');

// ============================================================
secao('7. Schema.org — o erro nº1 e o preco formatado');

ok('preco sai como numero string', precoSchema(189.9) === '189.90', precoSchema(189.9));
ok('preco sem simbolo nem virgula', !/[R$,]/.test(precoSchema(1350.5)), precoSchema(1350.5));
ok('inteiro ganha 2 casas', precoSchema(50) === '50.00');

const lojaFake = { config: { loja_nome: 'Loja X' }, tenant: { nome_loja: 'Loja X' }, slug: 'loja-x' };
const s = schemaProduto(
  { id: 7, titulo: 'Vestido', preco_venda: 189.9, grade: [{ cor: 'Unica', tamanho: 'M', quantidade: 3 }], galeria: [], foto: 'img/produtos/x.jpg' },
  { slug: 'loja-x', loja: lojaFake },
);
ok('@type Product', s['@type'] === 'Product');
ok('moeda BRL', s.offers.priceCurrency === 'BRL');
ok('InStock quando ha grade', s.offers.availability.includes('InStock'));
ok('image e URL ABSOLUTA', s.image[0].startsWith('https://'), s.image[0]);
ok('offer.url absoluta', s.offers.url.startsWith('https://'), s.offers.url);

const semEstoque = schemaProduto(
  { id: 8, titulo: 'X', preco_venda: 10, grade: [{ cor: 'Unica', tamanho: 'M', quantidade: 0 }], galeria: [], foto: '' },
  { slug: 'loja-x', loja: lojaFake },
);
ok('OutOfStock quando zerado', semEstoque.offers.availability.includes('OutOfStock'));

// ============================================================
console.log(`\n${falhas === 0 ? '✅ TUDO VERDE' : `❌ ${falhas} FALHA(S)`}`);
process.exit(falhas ? 1 : 0);
