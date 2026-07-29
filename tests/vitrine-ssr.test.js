// ============================================================
// VITRINE SSR — a fundacao do site da loja.
//
// Tres classes de risco, todas com custo real:
//
//   1. XSS no HTML SERVIDO. A vitrine passa a montar HTML no servidor a partir de
//      dado do banco (nome de produto, frase da loja, cor da marca). HTML servido
//      escapa de qualquer CSP baseada em 'self' — e o front JA tem o bug oposto
//      (renderizarProdutos injeta nome via innerHTML sem escape). Se o motor de
//      SSR nascer com default cru, o bug se repete onde e' pior.
//
//   2. FOTO QUEBRADA NA PAGINA DE PRODUTO. routes/produtos.js grava o caminho como
//      'img/produtos/x.jpg' — SEM barra inicial. Isso resolve em /minhaloja por
//      ACIDENTE do algoritmo de URL relativa, e quebra em /minhaloja/p/vestido-142.
//      Sem normalizacao, a PDP nasce com 100% das fotos 404.
//
//   3. GATE DE PLANO VAZANDO. vitrine_site e' feature do plano `interno` enquanto a
//      DS Store e' cliente-zero. Se vazar pro starter/growth, entregamos de graca
//      o que ainda nao foi decidido vender — e responder 403 em vez de 404
//      revelaria pra qualquer um que aquela loja existe num plano inferior.
//
//   node tests/vitrine-ssr.test.js
// ============================================================
process.env.DB_DIR = process.env.DB_DIR || './tests/.tmp-vitrine';
process.env.ORIGIN = process.env.ORIGIN || 'https://www.easygestao.com';
const fs = require('fs');
const path = require('path');

const dir = path.resolve(process.env.DB_DIR);
if (fs.existsSync(dir)) fs.rmSync(dir, { recursive: true, force: true });
fs.mkdirSync(dir, { recursive: true });

const { db, setConfig } = require('../db/database');
const { esc, jsonSeguro, corHexSegura, render } = require('../lib/vitrine-render');
const {
  urlFoto, urlAbsoluta, urlProduto, idDoProdutoNaUrl,
  resolverLojaPublica, CHAVES_PUBLICAS,
} = require('../lib/vitrine-publica');
const { temFeature, ehVendavel, planosPublicos } = require('../lib/planos');
const { SLUGS_RESERVADOS } = require('../lib/helpers');

let falhas = 0;
function ok(desc, cond, extra = '') {
  if (cond) console.log(`  ✅ ${desc}`);
  else { console.log(`  ❌ ${desc}${extra ? ' → ' + extra : ''}`); falhas++; }
}
function secao(t) { console.log(`\n${t}`); }

const LT = String.fromCharCode(60);  // '<' literal, sem depender de encoding do arquivo

// ---------- Setup: tres lojas, um plano cada ----------
let seq = 0;
function novaLoja(plano, slug) {
  const r = db.prepare(`
    INSERT INTO tenants (nome_loja, nome_responsavel, telefone, email, senha_hash, plano, status, slug)
    VALUES (?, 'Resp', '73999990000', ?, 'x', ?, 'ativo', ?)
  `).run('Loja ' + (++seq), `vit-${seq}-${Date.now()}@t.com`, plano, slug);
  const id = Number(r.lastInsertRowid);
  setConfig('vitrine_ativa', '1', id);
  return id;
}

const T_STARTER = novaLoja('starter', 'loja-starter');
const T_GROWTH = novaLoja('growth', 'loja-growth');
const T_INTERNO = novaLoja('interno', 'loja-interno');

// ============================================================
secao('1. Escape de HTML — o default do motor e SEGURO');

ok('esc neutraliza tag', esc(LT + 'img onerror=alert(1)>') === '&lt;img onerror=alert(1)&gt;');
ok('esc neutraliza aspas duplas', esc('a"b') === 'a&quot;b');
ok('esc neutraliza aspas simples', esc("a'b") === 'a&#39;b');
ok('esc escapa & PRIMEIRO (senao vira dupla-escapada)', esc('&lt;') === '&amp;lt;');
ok('esc de null vira vazio', esc(null) === '');
ok('esc de undefined vira vazio', esc(undefined) === '');
ok('esc de 0 vira "0" (e nao vazio)', esc(0) === '0');

// {{ }} escapado por DEFAULT: quem quiser cru pede {{{ }}}
const nomeMalicioso = LT + 'script>alert(1)</script>';
const htmlRender = render('<h1>{{nome}}</h1>', { nome: nomeMalicioso });
ok('{{ }} escapa por default', !htmlRender.includes(LT + 'script'));
ok('{{{ }}} deixa cru (HTML nosso)', render('<div>{{{h}}}</div>', { h: '<b>ok</b>' }) === '<div><b>ok</b></div>');
ok('chave ausente vira vazio, nao "{{x}}"', render('[{{sumiu}}]', {}) === '[]');
ok('acesso aninhado funciona', render('{{loja.nome}}', { loja: { nome: 'DS' } }) === 'DS');

// ============================================================
secao('2. jsonSeguro — </script> nao pode fechar o bloco');

// O ataque: produto chamado "</script><img onerror=...>". JSON.stringify sozinho
// NAO escapa isso — o navegador fecha o <script> e o resto vira HTML executavel.
const jsonAtaque = jsonSeguro({ nome: LT + '/script><img onerror=alert(1)>' });
ok('nao contem </script literal', !jsonAtaque.includes(LT + '/script'));
ok('escapa < como \\u003c', jsonAtaque.includes('\\u003c'));
ok('escapa > como \\u003e', jsonAtaque.includes('\\u003e'));
ok('continua sendo JSON valido', JSON.parse(jsonAtaque).nome === LT + '/script><img onerror=alert(1)>');

// U+2028/U+2029: JSON aceita, JS nao — travam o JSON.parse do browser em silencio
const jsonLinha = jsonSeguro({ x: 'a' + String.fromCharCode(0x2028) + 'b' });
ok('escapa U+2028', jsonLinha.includes('\\u2028') && !jsonLinha.includes(String.fromCharCode(0x2028)));
ok('undefined vira null (e nao quebra o parse)', jsonSeguro(undefined) === 'null');

// ============================================================
secao('3. corHexSegura — CSS injection no <style id="temaLoja">');

// marca_cor vem do banco e e' interpolada DENTRO de <style>. Escape de HTML nao
// protege aqui (CSS nao usa &lt;) — a protecao e' a allowlist de formato.
ok('aceita hex de 6', corHexSegura('#5c4637') === '#5c4637');
ok('aceita hex de 3', corHexSegura('#f00') === '#f00');
ok('REJEITA css injection', corHexSegura('red;}body{display:none') === '#1a6f5e');
ok('REJEITA expression', corHexSegura('#fff;background:url(javascript:alert(1))') === '#1a6f5e');
ok('REJEITA vazio', corHexSegura('') === '#1a6f5e');
ok('REJEITA null', corHexSegura(null) === '#1a6f5e');
ok('REJEITA sem #', corHexSegura('5c4637') === '#1a6f5e');

// ============================================================
secao('4. urlFoto — o caminho relativo que quebraria a pagina de produto');

// Como o banco grava HOJE (verificado em producao: 100% sem barra)
ok('normaliza caminho sem barra', urlFoto('img/produtos/x.jpg') === '/img/produtos/x.jpg');
ok('mantem caminho com barra', urlFoto('/img/produtos/x.jpg') === '/img/produtos/x.jpg');
ok('nao mexe em URL absoluta (CDN futuro)', urlFoto('https://cdn.x/y.jpg') === 'https://cdn.x/y.jpg');
ok('nao mexe em protocol-relative', urlFoto('//cdn.x/y.jpg') === '//cdn.x/y.jpg');
ok('vazio cai no placeholder', urlFoto('') === '/img/placeholder.png');
ok('null cai no placeholder', urlFoto(null) === '/img/placeholder.png');

// og:image relativa e' DESCARTADA pelo crawler do WhatsApp — o preview sai sem foto,
// que e' exatamente o problema que o SSR veio resolver.
ok('urlAbsoluta poe o host', urlAbsoluta('img/produtos/x.jpg') === 'https://www.easygestao.com/img/produtos/x.jpg');
ok('urlAbsoluta nao duplica host', urlAbsoluta('https://cdn.x/y.jpg') === 'https://cdn.x/y.jpg');

// ============================================================
secao('5. URL de produto — o ID e quem resolve');

const peca = { id: 142, nome: 'Vestido Amanda Longo' };
ok('monta url canonica', urlProduto('ds-store', peca) === '/ds-store/p/vestido-amanda-longo-142');
ok('extrai o id do fim', idDoProdutoNaUrl('vestido-amanda-longo-142') === 142);
// O slug e' DECORATIVO: renomear a peca nao pode quebrar o link que ja circula no zap
ok('id sobrevive a rename da peca', idDoProdutoNaUrl('nome-completamente-outro-142') === 142);
ok('aceita url so com id', idDoProdutoNaUrl('142') === 142);
ok('sem id devolve null', idDoProdutoNaUrl('vestido-sem-numero') === null);
ok('nome com acento vira slug limpo', urlProduto('l', { id: 7, nome: 'Calça Jeans Ação' }) === '/l/p/calca-jeans-acao-7');

// ============================================================
secao('6. Gate de plano — vitrine_site fora dos planos vendidos');

// Os planos VENDIDOS hoje (starter/growth) nao tem o site: continua sendo o corte
// que separa "loja online" de "site indexavel com pagina por peca".
ok('starter NAO tem vitrine_site', temFeature('starter', 'vitrine_site') === false);
ok('growth NAO tem vitrine_site', temFeature('growth', 'vitrine_site') === false);
ok('interno TEM vitrine_site', temFeature('interno', 'vitrine_site') === true);

// O enterprise GANHOU vitrine_site em 28/07/2026 — ele e' onde moram o CRM
// comercial (`crm_avancado`) e o portal de atacado (`atacado`), e o atacado nao
// existe sem o site (a pagina por peca e' o catalogo que a lojista navega).
// Isto NAO afrouxa o gate: o enterprise segue CONGELADO, fora de PLANOS_PUBLICOS.
// A garantia que importa e' a linha abaixo — invisivel na vitrine e barrado no
// checkout. Se um dia ele for descongelado, sera decisao explicita de preco.
ok('enterprise TEM vitrine_site (leva o atacado junto)', temFeature('enterprise', 'vitrine_site') === true);
ok('mas o enterprise continua NAO vendavel', ehVendavel('enterprise') === false);
ok('e fora da vitrine publica de planos', !planosPublicos().some((p) => p.id === 'enterprise'));

// A vitrine SIMPLES continua em todos — descer feature nao pode tirar de ninguem
ok('starter mantem vitrine_publica', temFeature('starter', 'vitrine_publica') === true);
ok('growth mantem vitrine_publica', temFeature('growth', 'vitrine_publica') === true);

const lojaStarter = resolverLojaPublica('loja-starter');
const lojaGrowth = resolverLojaPublica('loja-growth');
const lojaInterno = resolverLojaPublica('loja-interno');

ok('starter resolve a loja (tem vitrine)', !!lojaStarter);
ok('starter NAO tem site', lojaStarter && lojaStarter.temSite === false);
ok('growth NAO tem site', lojaGrowth && lojaGrowth.temSite === false);
ok('interno TEM site', lojaInterno && lojaInterno.temSite === true);

// Chave de site nao pode nem aparecer pra quem nao tem a feature
ok('starter nao expoe chave de site', lojaStarter && lojaStarter.config.vitrine_banner === undefined);
ok('interno expoe chave de site', lojaInterno && lojaInterno.config.vitrine_banner !== undefined);

// ============================================================
secao('7. Loja inexistente / desligada — 404, nunca 403');

ok('slug inexistente devolve null', resolverLojaPublica('nao-existe-essa-loja') === null);
ok('slug vazio devolve null', resolverLojaPublica('') === null);
ok('slug null devolve null', resolverLojaPublica(null) === null);

// Vitrine desligada some — e some do mesmo jeito que loja inexistente, de proposito
setConfig('vitrine_ativa', '0', T_STARTER);
ok('vitrine desligada devolve null', resolverLojaPublica('loja-starter') === null);
setConfig('vitrine_ativa', '1', T_STARTER);
ok('religar traz a loja de volta', !!resolverLojaPublica('loja-starter'));

// ============================================================
secao('8. Isolamento multi-tenant — config nunca vaza entre lojas');

setConfig('vitrine_frase', 'Frase da STARTER', T_STARTER);
setConfig('vitrine_frase', 'Frase da INTERNO', T_INTERNO);
const st = resolverLojaPublica('loja-starter');
const it = resolverLojaPublica('loja-interno');
ok('cada loja le a propria frase', st.config.vitrine_frase === 'Frase da STARTER' && it.config.vitrine_frase === 'Frase da INTERNO');

// Loja que nunca preencheu NAO pode herdar de outra (o bug classico do fallback global)
const semFrase = resolverLojaPublica('loja-growth');
ok('loja sem config nao herda de outra', semFrase.config.vitrine_frase === '');
ok('cor default local, nao de outro tenant', semFrase.config.marca_cor === '#1a6f5e');

// ============================================================
secao('9. Allowlist publica — dado de custo NUNCA sai');

// Rota publica sem autenticacao: vazar markup/imposto entregaria a estrutura de
// preco da loja pra qualquer concorrente que abrisse a vitrine.
const PROIBIDAS = ['markup', 'imposto_simples', 'comissao_padrao', 'taxa_credito', 'meta_mensal', 'embalagem_unit'];
for (const proibida of PROIBIDAS) {
  ok(`'${proibida}' fora da allowlist`, !CHAVES_PUBLICAS.includes(proibida));
}
setConfig('markup', '2.5', T_INTERNO);
const interno2 = resolverLojaPublica('loja-interno');
ok('markup nao aparece na resposta publica', interno2.config.markup === undefined);

// ============================================================
secao('10. Slugs reservados — os segmentos do site');

// Sem isso, uma loja com slug 'p' tornaria /p/vestido-142 ambiguo
ok("'p' reservado", SLUGS_RESERVADOS.has('p'));
ok("'pedido' reservado", SLUGS_RESERVADOS.has('pedido'));
ok("'carrinho' reservado", SLUGS_RESERVADOS.has('carrinho'));
ok('reservados antigos continuam', SLUGS_RESERVADOS.has('admin') && SLUGS_RESERVADOS.has('sitemap.xml'));

// ============================================================
secao('11. Tabelas novas (migrations 042-044)');

const tabela = (n) => !!db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?").get(n);
ok('vitrine_pedidos existe', tabela('vitrine_pedidos'));
ok('vitrine_pedido_itens existe', tabela('vitrine_pedido_itens'));
ok('vitrine_leads existe', tabela('vitrine_leads'));

const colsProd = db.prepare('PRAGMA table_info(produtos)').all().map((c) => c.name);
ok('produtos.medidas', colsProd.includes('medidas'));
ok('produtos.modelo_veste', colsProd.includes('modelo_veste'));
ok('produtos.composicao', colsProd.includes('composicao'));
ok('produtos.destaque', colsProd.includes('destaque'));

// UNIQUE por (tenant_id, codigo) e nao global: duas lojas podem ter #A7K2
db.prepare("INSERT INTO vitrine_pedidos (tenant_id, codigo, total) VALUES (?, 'A7K2', 100)").run(T_INTERNO);
let doisTenantsMesmoCodigo = true;
try {
  db.prepare("INSERT INTO vitrine_pedidos (tenant_id, codigo, total) VALUES (?, 'A7K2', 50)").run(T_GROWTH);
} catch (e) { doisTenantsMesmoCodigo = false; }
ok('duas lojas podem ter o mesmo codigo', doisTenantsMesmoCodigo);

let codigoDuplicadoNaMesmaLoja = false;
try {
  db.prepare("INSERT INTO vitrine_pedidos (tenant_id, codigo, total) VALUES (?, 'A7K2', 70)").run(T_INTERNO);
  codigoDuplicadoNaMesmaLoja = true;
} catch (e) { /* esperado */ }
ok('a MESMA loja nao repete codigo', !codigoDuplicadoNaMesmaLoja);

// Lead: a mesma pessoa mandando o form 5x e' UM lead
db.prepare("INSERT INTO vitrine_leads (tenant_id, telefone, nome) VALUES (?, '73988887777', 'Maria')").run(T_INTERNO);
let leadDuplicado = false;
try {
  db.prepare("INSERT INTO vitrine_leads (tenant_id, telefone, nome) VALUES (?, '73988887777', 'Maria 2')").run(T_INTERNO);
  leadDuplicado = true;
} catch (e) { /* esperado */ }
ok('telefone nao duplica na mesma loja', !leadDuplicado);

// ============================================================
secao('12. Nada especifico da DS Store no codigo (isto vira produto)');

// Mesmo cuidado que a base_importada tem: a tela nasce generica pra que virar
// produto seja so ligar a flag no growth, sem texto pra reescrever.
const fontes = ['lib/vitrine-render.js', 'lib/vitrine-publica.js']
  .map((f) => fs.readFileSync(path.join(__dirname, '..', f), 'utf8'));
const PROIBIDO = [/\bDS\s*Store\b/i, /\bCamacan\b/i, /\bDaisy\b/i, /\bItabuna\b/i];
for (const termo of PROIBIDO) {
  ok(`sem "${termo.source}" hardcoded`, !fontes.some((s) => termo.test(s)));
}

// ============================================================
console.log(`\n${falhas === 0 ? '✅ TUDO VERDE' : `❌ ${falhas} FALHA(S)`}`);
process.exit(falhas ? 1 : 0);
