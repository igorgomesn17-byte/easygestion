// ============================================================
// VITRINE — motor de render no SERVIDOR (SSR sem template engine)
//
// POR QUE ISSO EXISTE: as meta tags de Open Graph da vitrine eram injetadas por
// JavaScript (`atualizarMetaTags` em public/vitrine/js/vitrine.js). Crawler
// nenhum executa JS — nem o do WhatsApp, nem o do Google. Na prática, TODO link
// de loja compartilhado saía sem preview: sem foto, sem nome, sem preço. Pra
// consertar, o HTML precisa sair pronto do servidor, e pra isso precisamos
// montar HTML a partir de dado do banco.
//
// O PROJETO NÃO TEM TEMPLATE ENGINE (sem ejs/pug/handlebars) e não vamos
// instalar um: o deploy é manual por SSH e cada dependência nova é risco de o
// servidor não subir. Duas funções resolvem: `render` (substituição de token) e
// as de escape abaixo.
//
// ⚠️ A REGRA QUE NÃO SE NEGOCIA: o default do motor é ESCAPADO.
// A vitrine já tem o bug oposto no front — `renderizarProdutos` injeta o nome do
// produto via innerHTML sem escape, e o `esc()` de public/js/comum.js sequer é
// carregado lá. Se este motor nascesse com default cru, o mesmo bug se repetiria
// no servidor, onde é PIOR: HTML servido escapa de qualquer CSP baseada em
// 'self'. Quem precisa de HTML cru pede explicitamente com {{{ }}}.
// ============================================================
const fs = require('fs');
const path = require('path');

const EM_PRODUCAO = process.env.NODE_ENV === 'production';

// ------------------------------------------------------------
// ESCAPE — três contextos, três funções. Não são intercambiáveis.
// ------------------------------------------------------------

// Contexto: texto e valor de atributo dentro do HTML.
// Escapa aspas simples E duplas porque o atributo pode usar qualquer uma.
function esc(valor) {
  if (valor === null || valor === undefined) return '';
  return String(valor)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// Contexto: dado embutido DENTRO de <script> (ex.: window.__VITRINE__ = {...}).
// JSON.stringify sozinho NÃO basta: um produto chamado `</script><img onerror=...>`
// fecha o bloco de script e o resto vira HTML executável. Escapar < e > para
// </> mata isso e continua sendo JSON válido pro JSON.parse do browser.
// U+2028/U+2029 são quebras de linha que o JSON aceita mas o JS não — travam o parse.
function jsonSeguro(obj) {
  return JSON.stringify(obj === undefined ? null : obj)
    .replace(/</g, '\\u003c')
    .replace(/>/g, '\\u003e')
    .replace(/\u2028/g, '\\u2028')
    .replace(/\u2029/g, '\\u2029');
}

// Contexto: valor dentro de <style>. `marca_cor` vem do banco e é interpolada
// direto no <style id="temaLoja"> — hoje isso é feito por JS sem validação
// nenhuma. No SSR passa a ser HTML servido, o que é pior. Um valor como
// `red;} body{display:none} .x{color:red` reescreveria a página inteira.
// Escape de HTML NÃO protege aqui (CSS não usa &lt;) — a proteção é a allowlist.
function corHexSegura(valor, fallback = '#1a6f5e') {
  return /^#[0-9a-fA-F]{3,8}$/.test(String(valor || '')) ? String(valor) : fallback;
}

// ------------------------------------------------------------
// RENDER — substituição de token
//
//   {{chave}}     → esc(valor)        default seguro
//   {{{chave}}}   → valor cru         só para HTML que NÓS montamos
//   {{@chave}}    → jsonSeguro(valor) dentro de <script>
//
// Chave ausente vira string vazia (e não o literal "{{chave}}" na cara da
// cliente). A ordem importa: {{{ }}} é testado ANTES de {{ }}, senão o
// regex de 2 chaves come as 3.
// ------------------------------------------------------------
function render(template, dados = {}) {
  if (!template) return '';
  return String(template)
    .replace(/\{\{\{\s*([\w.]+)\s*\}\}\}/g, (_, chave) => {
      const v = buscar(dados, chave);
      return v === null || v === undefined ? '' : String(v);
    })
    .replace(/\{\{@\s*([\w.]+)\s*\}\}/g, (_, chave) => jsonSeguro(buscar(dados, chave)))
    .replace(/\{\{\s*([\w.]+)\s*\}\}/g, (_, chave) => esc(buscar(dados, chave)));
}

// Acesso por caminho ('loja.nome') — evita ter que achatar o objeto antes.
function buscar(obj, caminho) {
  return caminho.split('.').reduce((o, k) => (o === null || o === undefined ? o : o[k]), obj);
}

// ------------------------------------------------------------
// CACHE DE TEMPLATE
//
// readFileSync por request é I/O SÍNCRONO no event loop — com a vitrine
// recebendo tráfego de anúncio, isso trava o servidor inteiro. Lê uma vez e
// guarda. Em dev relê sempre, senão cada ajuste de HTML exigiria restart.
//
// Falha com mensagem clara: o deploy é `git pull` + `pm2 restart`, e um arquivo
// que não subiu faria o readFileSync explodir com ENOENT cru no boot.
// ------------------------------------------------------------
const cache = new Map();

function lerTemplate(nomeArquivo) {
  if (!EM_PRODUCAO) cache.delete(nomeArquivo);
  if (cache.has(nomeArquivo)) return cache.get(nomeArquivo);

  const caminho = path.join(__dirname, '..', 'public', 'vitrine', nomeArquivo);
  if (!fs.existsSync(caminho)) {
    throw new Error(`[VITRINE] Template ausente: ${caminho}. O deploy subiu todos os arquivos de public/vitrine/?`);
  }
  const conteudo = fs.readFileSync(caminho, 'utf8');
  cache.set(nomeArquivo, conteudo);
  return conteudo;
}

// Renderiza um template de arquivo. `partials` é um mapa {nome: arquivo} inserido
// como HTML cru — é conteúdo NOSSO, já renderizado, nunca dado de usuário.
function renderArquivo(nomeArquivo, dados = {}) {
  return render(lerTemplate(nomeArquivo), dados);
}

module.exports = {
  esc,
  jsonSeguro,
  corHexSegura,
  render,
  renderArquivo,
  lerTemplate,
};
