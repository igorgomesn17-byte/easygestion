// ============================================================
// Funcoes compartilhadas por todas as telas
// ============================================================

// Escapa HTML — use SEMPRE antes de injetar dados do banco via innerHTML (anti-XSS)
function esc(s) {
  if (s == null) return '';
  return String(s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

// Formata numero como dinheiro BRL
function moeda(v) {
  return (Number(v) || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

// Máscara de aniversário DD/MM: digita só números e a "/" entra sozinha.
// Liga num input: mascaraAniversario(document.getElementById('aniv'))
function mascaraAniversario(input) {
  if (!input) return;
  input.setAttribute('inputmode', 'numeric');
  input.setAttribute('maxlength', '5');
  input.addEventListener('input', () => {
    let d = input.value.replace(/\D/g, '').slice(0, 4); // só dígitos, máx DDMM
    input.value = d.length >= 3 ? d.slice(0, 2) + '/' + d.slice(2) : d;
  });
}

// ---------- Modo privacidade: oculta valores em R$ (botão de olho) ----------
// Aplica um blur nos elementos .dinheiro e .valor (cards de métrica) + textos de meta.
// Estado salvo no navegador (localStorage), por isso persiste entre visitas.
(function injetarCssPrivacidade(){
  const st = document.createElement('style');
  st.textContent = `
    body.valores-ocultos .dinheiro,
    body.valores-ocultos .card-metrica .valor,
    body.valores-ocultos .meta-valores,
    body.valores-ocultos .anel-valores,
    body.valores-ocultos .anel-pct,
    body.valores-ocultos .valor-sensivel {
      filter: blur(8px); user-select: none; cursor: default;
      transition: filter .15s;
    }
    body.valores-ocultos .dinheiro:hover { filter: blur(8px); }`;
  document.head.appendChild(st);
})();
function valoresOcultos() { return localStorage.getItem('ds-valores-ocultos') === '1'; }
function aplicarModoValores() {
  // Só age na página que tem o botão de olho (o Painel). Nas demais telas,
  // garante que o blur nunca seja aplicado, mesmo com a preferência salva.
  const btn = document.getElementById('btnOlho');
  if (!btn) { document.body.classList.remove('valores-ocultos'); return; }
  document.body.classList.toggle('valores-ocultos', valoresOcultos());
  btn.innerHTML = valoresOcultos() ? '🙈 Mostrar valores' : '👁️ Ocultar valores';
}
function toggleValores() {
  localStorage.setItem('ds-valores-ocultos', valoresOcultos() ? '0' : '1');
  aplicarModoValores();
}
// aplica assim que o DOM estiver pronto (e o botão existir)
if (document.readyState !== 'loading') aplicarModoValores();
else document.addEventListener('DOMContentLoaded', aplicarModoValores);

// Chamada de API simplificada
async function api(caminho, opcoes = {}) {
  const resp = await fetch('/api' + caminho, {
    headers: { 'Content-Type': 'application/json' },
    credentials: 'same-origin',
    ...opcoes,
    body: opcoes.body ? JSON.stringify(opcoes.body) : undefined,
  });
  // sessão expirada / não autenticado → manda pro login (exceto se já estiver nele)
  if (resp.status === 401 && !location.pathname.endsWith('login.html')) {
    location.href = 'login.html';
    throw new Error('Sessão expirada');
  }
  const dados = await resp.json().catch(() => ({}));
  if (!resp.ok) throw new Error(dados.erro || 'Erro na operacao');
  return dados;
}

// Chamada de API PÚBLICA (vitrine) — NÃO redireciona pro login em 401
async function apiPublico(caminho, opcoes = {}) {
  const resp = await fetch('/api' + caminho, {
    headers: { 'Content-Type': 'application/json' },
    ...opcoes,
    body: opcoes.body ? JSON.stringify(opcoes.body) : undefined,
  });
  const dados = await resp.json().catch(() => ({}));
  if (!resp.ok) throw new Error(dados.erro || 'Erro na operacao');
  return dados;
}

// Aviso flutuante (toast)
function toast(msg, tipo = '') {
  let el = document.getElementById('toast');
  if (!el) { el = document.createElement('div'); el.id = 'toast'; document.body.appendChild(el); }
  el.textContent = msg;
  el.className = tipo;
  void el.offsetWidth; // reflow
  el.classList.add('mostra');
  setTimeout(() => el.classList.remove('mostra'), 2800);
}

// Icones SVG estilo Lucide (stroke) — profissionais, nao emojis
const ICO = {
  painel:  '<path d="M3 3h7v9H3z"/><path d="M14 3h7v5h-7z"/><path d="M14 12h7v9h-7z"/><path d="M3 16h7v5H3z"/>',
  vender:  '<circle cx="9" cy="21" r="1"/><circle cx="20" cy="21" r="1"/><path d="M1 1h4l2.68 13.39a2 2 0 0 0 2 1.61h9.72a2 2 0 0 0 2-1.61L23 6H6"/>',
  caixa:   '<rect x="2" y="7" width="20" height="14" rx="2"/><path d="M16 7V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v2"/>',
  despesas:'<rect x="2" y="5" width="20" height="14" rx="2"/><line x1="2" y1="10" x2="22" y2="10"/>',
  fluxo:   '<path d="M3 3v18h18"/><path d="m19 9-5 5-4-4-3 3"/>',
  vendas:  '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6"/><path d="M9 13h6"/><path d="M9 17h3"/>',
  produtos:'<path d="M20.38 3.46 16 2a4 4 0 0 1-8 0L3.62 3.46a2 2 0 0 0-1.34 2.23l.58 3.47a1 1 0 0 0 .99.84H6v10a2 2 0 0 0 2 2h8a2 2 0 0 0 2-2V10h2.15a1 1 0 0 0 .99-.84l.58-3.47a2 2 0 0 0-1.34-2.23z"/>',
  estoque: '<path d="M3 9h18v10a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><path d="M3 9 5 4h14l2 5"/><line x1="9" y1="13" x2="15" y2="13"/>',
  clientes:'<path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/>',
  equipe:  '<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="m22 11-2 2-2-2"/>',
  config:  '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/>',
  sair:    '<path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" y1="12" x2="9" y2="12"/>',
  menu:    '<line x1="3" y1="12" x2="21" y2="12"/><line x1="3" y1="6" x2="21" y2="6"/><line x1="3" y1="18" x2="21" y2="18"/>',
};
function svg(n) { return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round">${ICO[n]||''}</svg>`; }

const NAV = [
  { grupo: null, itens: [ { id:'dashboard', href:'index.html', ico:'painel', txt:'Painel' } ]},
  { grupo: 'Vendas', itens: [
    { id:'pdv',    href:'pdv.html',    ico:'vender', txt:'Vender' },
    { id:'caixa',  href:'caixa.html',  ico:'caixa',  txt:'Caixa do dia' },
    { id:'historico', href:'historico.html', ico:'vendas', txt:'Histórico' },
    { id:'trocas',    href:'trocas.html',    ico:'vendas', txt:'Trocas/Devoluções' },
  ]},
  { grupo: 'Financeiro', itens: [
    { id:'financeiro', href:'financeiro.html', ico:'despesas', txt:'Despesas' },
    { id:'fluxo-caixa',href:'fluxo-caixa.html', ico:'fluxo',    txt:'Fluxo de Caixa' },
    { id:'fluxo',      href:'fluxo.html',      ico:'fluxo',    txt:'DRE' },
    { id:'nfce',       href:'nfce-relatorio.html', ico:'vendas', txt:'Notas fiscais' },
  ]},
  { grupo: 'Catálogo', itens: [
    { id:'produtos', href:'produtos.html', ico:'produtos', txt:'Produtos' },
    { id:'estoque',  href:'estoque.html',  ico:'estoque',  txt:'Estoque' },
  ]},
  { grupo: 'Pessoas', itens: [
    { id:'clientes',   href:'clientes.html',   ico:'clientes', txt:'Clientes' },
    { id:'vendedores', href:'vendedores.html', ico:'equipe',   txt:'Equipe' },
  ]},
  { grupo: null, itens: [ { id:'config', href:'config.html', ico:'config', txt:'Configurações' } ]},
];

const TITULOS = {
  dashboard:'Painel', pdv:'Vender', caixa:'Caixa do dia',
  historico:'Histórico de vendas', trocas:'Trocas e devoluções',
  financeiro:'Despesas e contas', 'fluxo-caixa':'Fluxo de caixa', fluxo:'DRE',
  nfce:'Notas fiscais (NFC-e)', produtos:'Produtos',
  estoque:'Estoque', clientes:'Clientes',
  vendedores:'Equipe', config:'Configurações',
};

// ---------- Identidade da loja (personalização self-service) ----------
// Nome, logo e cor da marca vêm da config (a lojista define na tela Configurações).
// Cache simples por carregamento de página.
let _marcaCache = null;
async function carregarMarca() {
  if (_marcaCache) return _marcaCache;
  let cfg = {};
  try { cfg = await api('/config'); } catch (e) { cfg = {}; }
  _marcaCache = {
    nome: (cfg.loja_nome || 'Minha Loja').trim(),
    logo: (cfg.loja_logo || '').trim(),
    cor:  (cfg.marca_cor || '#2e7d32').trim(),
  };
  return _marcaCache;
}
// Aplica a COR da marca como variável CSS global (--marca). O CSS do sistema usa
// var(--marca) no essencial visível (topbar, botões principais, destaques).
function aplicarCorMarca(cor) {
  if (!cor) return;
  document.documentElement.style.setProperty('--marca', cor);
  document.documentElement.style.setProperty('--marca-escura', sombrearCor(cor, -18));
  document.documentElement.style.setProperty('--marca-clara', sombrearCor(cor, 24));
}
// Escurece/clareia um hex (%); usado pra derivar tons da cor principal.
function sombrearCor(hex, pct) {
  const h = String(hex).replace('#', '');
  if (h.length !== 6) return hex;
  const n = parseInt(h, 16);
  const ajust = (c) => Math.max(0, Math.min(255, Math.round(c + (c * pct) / 100)));
  const r = ajust((n >> 16) & 255), g = ajust((n >> 8) & 255), b = ajust(n & 255);
  return '#' + ((1 << 24) + (r << 16) + (g << 8) + b).toString(16).slice(1);
}
// Aplica nome + logo no cabeçalho (sidebar e topbar) depois que o layout foi montado.
function aplicarMarcaNoChrome(marca) {
  const imgLogo = document.querySelector('.sidebar-logo img');
  const txtMarca = document.querySelector('.sidebar-logo .marca');
  if (txtMarca) txtMarca.textContent = marca.nome;
  if (imgLogo) {
    if (marca.logo) {
      imgLogo.src = marca.logo;
      imgLogo.style.display = '';
      if (txtMarca) txtMarca.style.display = 'none';
    } else {
      // sem logo do cliente → logo padrão do sistema
      imgLogo.src = 'img/lockup-vertical-color.svg';
      imgLogo.style.display = '';
      if (txtMarca) txtMarca.style.display = 'none';
    }
  }
}

// Invalida o cache de marca (para restaurar padrão)
function invalidarCacheMarca() { _marcaCache = null; }

// Monta o layout com sidebar lateral (chamado em cada pagina)
// Guarda de sessão: toda tela interna chama /api/me; se não logado, vai pro login.
// MODO EMBED (?embed=1): a tela roda dentro da SPA de Relacionamento (iframe).
// Esconde a sidebar/topbar do ERP — o shell do iframe é o pai. Reaproveita a tela inteira.
// Páginas que cada papel NÃO-admin pode acessar (admin vê tudo).
const PAGINAS_POR_PAPEL = {
  vendedor: ['pdv', 'caixa'],
};
function montarLayout(paginaAtiva) {
  const EMBED = new URLSearchParams(location.search).get('embed') === '1';
  fetch('/api/me', { credentials: 'same-origin' }).then(r => {
    if (!r.ok) { if (!EMBED) location.href = 'login.html'; return; }
    return r.json();
  }).then(me => {
    if (!me) return;
    const papel = me.papel || 'admin';
    // guarda de página: papel não-admin tentando abrir tela fora da sua lista → redireciona
    const permitidas = PAGINAS_POR_PAPEL[papel];
    if (permitidas && !permitidas.includes(paginaAtiva)) {
      location.href = permitidas[0] + '.html';
      return;
    }
    // esconde do menu os itens fora do papel
    if (permitidas) {
      document.querySelectorAll('.sidebar-nav .nav-link[data-pagina]').forEach(a => {
        if (!permitidas.includes(a.dataset.pagina)) a.style.display = 'none';
      });
      // some também com os títulos de grupo que ficaram sem nenhum item visível
      document.querySelectorAll('.nav-grupo-titulo').forEach(t => {
        let n = t.nextElementSibling, temVisivel = false;
        while (n && n.classList.contains('nav-link')) { if (n.style.display !== 'none') temVisivel = true; n = n.nextElementSibling; }
        if (!temVisivel) t.style.display = 'none';
      });
    }
  }).catch(() => {});

  if (EMBED) {
    // só mostra o conteúdo, sem chrome do ERP
    document.body.classList.add('embed');
    const c = document.querySelector('.conteudo');
    if (c) c.style.padding = '16px';
    return;
  }

  const navHTML = NAV.map(g => {
    const links = g.itens.map(i =>
      `<a class="nav-link ${i.id===paginaAtiva?'ativo':''}" data-pagina="${i.id}" href="${i.href}" ${i.target?`target="${i.target}"`:''} title="${i.txt}">
         ${svg(i.ico)}<span class="txt">${i.txt}</span></a>`).join('');
    return (g.grupo ? `<div class="nav-grupo-titulo">${g.grupo}</div>` : '') + links;
  }).join('');

  const layout = `
    <div class="app" id="app">
      <div class="overlay-mob" id="overlayMob" onclick="toggleMenuMob()"></div>
      <aside class="sidebar">
        <div class="sidebar-logo">
          <img src="img/lockup-vertical-color.svg" alt="EasyGestão">
          <span class="marca" style="display:none;">Minha Loja</span>
        </div>
        <nav class="sidebar-nav">${navHTML}</nav>
        <div class="sidebar-rodape">
          <a class="nav-link" onclick="toggleRecolher()" title="Recolher menu" style="cursor:pointer;">
            ${svg('menu')}<span class="txt">Recolher</span></a>
          <a class="nav-link" onclick="sair()" title="Sair" style="cursor:pointer;">
            ${svg('sair')}<span class="txt">Sair</span></a>
        </div>
      </aside>
      <div class="main">
        <header class="topbar">
          <div style="display:flex; align-items:center; gap:12px;">
            <button class="btn-menu" onclick="toggleMenuMob()" aria-label="Menu">${svg('menu')}</button>
            <span class="topbar-titulo">${TITULOS[paginaAtiva]||'Painel'}</span>
          </div>
          <span class="data-hora" id="relogio"></span>
        </header>
        <div id="main-conteudo"></div>
      </div>
    </div>`;

  const conteudoExistente = document.querySelector('.conteudo');
  document.body.insertAdjacentHTML('afterbegin', layout);
  if (conteudoExistente) document.getElementById('main-conteudo').appendChild(conteudoExistente);

  if (localStorage.getItem('ds-sidebar-recolhida') === '1') document.getElementById('app').classList.add('recolhida');

  atualizarRelogio();
  setInterval(atualizarRelogio, 30000);
  aplicarModoValores(); // reaplica o modo privacidade (botão de olho) após montar o chrome

  // Identidade da loja: aplica nome, logo e cor da marca (personalização self-service)
  carregarMarca().then(marca => {
    aplicarCorMarca(marca.cor);
    aplicarMarcaNoChrome(marca);
  }).catch(() => {});
}

function toggleRecolher() {
  const app = document.getElementById('app');
  const isRecolhida = !app.classList.contains('recolhida');
  app.classList.toggle('recolhida');
  localStorage.setItem('ds-sidebar-recolhida', isRecolhida ? '1' : '0');

  // Trocar a logo: quando recolhida mostra o ícone, quando expandida mostra a logo do cliente ou padrão
  const imgLogo = document.querySelector('.sidebar-logo img');
  if (imgLogo) {
    if (isRecolhida) {
      imgLogo.src = 'img/icon-reversed.svg';
    } else {
      carregarMarca().then(marca => {
        imgLogo.src = marca.logo || 'img/lockup-vertical-color.svg';
      });
    }
  }
}
function toggleMenuMob() {
  document.getElementById('app').classList.toggle('menu-aberto');
  document.getElementById('overlayMob').classList.toggle('ativo');
}

// Encerra a sessão e volta pro login
async function sair() {
  if (!confirm('Deseja sair do sistema?')) return;
  try { await fetch('/api/logout', { method: 'POST', credentials: 'same-origin' }); } catch (e) {}
  location.href = 'login.html';
}

function atualizarRelogio() {
  const el = document.getElementById('relogio');
  if (el) {
    const agora = new Date();
    el.textContent = agora.toLocaleDateString('pt-BR', { weekday: 'long', day: '2-digit', month: '2-digit' }) +
      ' • ' + agora.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
  }
}

// Rotulo amigavel de forma de pagamento
function rotuloPagamento(forma) {
  const map = { pix: 'Pix', pix_chave: 'Pix (chave)', debito: 'Débito', credito_vista: 'Crédito à vista',
                credito_parcelado: 'Crédito parcelado',
                dinheiro: 'Dinheiro', misto: 'Pagamento dividido' };
  return map[forma] || forma;
}

// Abre o WhatsApp com a mensagem E copia o texto pro clipboard (fallback).
// Motivo: o WhatsApp Desktop no Windows às vezes corrompe os emojis vindos da URL.
// Se vierem quebrados, é só colar (Ctrl+V) o texto íntegro que já está copiado.
async function abrirWhatsappComTexto(telefone, texto) {
  const tel = String(telefone || '').replace(/\D/g, '');
  const telFull = tel.length <= 11 ? '55' + tel : tel;
  // copia o texto certinho pro clipboard (silencioso se o navegador bloquear)
  try { await navigator.clipboard.writeText(texto); toast('Mensagem copiada — se algum emoji vier quebrado, cole com Ctrl+V 🤎'); }
  catch (e) { /* sem permissão de clipboard: segue só com o link */ }
  window.open(`https://wa.me/${telFull}?text=${encodeURIComponent(texto)}`, '_blank');
}

// Texto das formas de uma venda. Se houver split (venda.pagamentos com 2+ partes),
// lista cada forma e valor; senao devolve o rotulo da forma unica.
function textoPagamentoVenda(venda, sep) {
  sep = sep || ' + ';
  const ps = venda.pagamentos || [];
  if (ps.length > 1) {
    return ps.map(p => {
      const parc = (p.forma === 'credito_parcelado' && p.parcelas > 1) ? ` ${p.parcelas}x` : '';
      return `${rotuloPagamento(p.forma)}${parc} (${moeda(p.valor)})`;
    }).join(sep);
  }
  return `${rotuloPagamento(venda.forma_pagamento)}${venda.parcelas>1?' '+venda.parcelas+'x':''}`;
}

// Data de hoje no fuso LOCAL (YYYY-MM-DD) — NUNCA usar toISOString (vira UTC)
function hojeLocalStr() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
}
// Mes atual no fuso LOCAL (YYYY-MM)
function mesLocalStr() { return hojeLocalStr().slice(0,7); }
// Primeiro dia do mes atual no fuso LOCAL (YYYY-MM-01)
function primeiroDiaMesLocal() { return mesLocalStr() + '-01'; }

// Categorias configuraveis: carrega do /config e popula um <select>
let _categoriasCache = null;
async function carregarCategorias() {
  if (_categoriasCache) return _categoriasCache;
  const cfg = await api('/config');
  try { _categoriasCache = JSON.parse(cfg.categorias || '[]'); }
  catch(e) { _categoriasCache = []; }
  if (!_categoriasCache.length) _categoriasCache = ['vestido','blusa','calca','short','saia','conjunto','macacao','alfaiataria','acessorio','outro'];
  return _categoriasCache;
}
// Deixa o rotulo bonito (primeira maiuscula)
function rotuloCategoria(c) { return c.charAt(0).toUpperCase() + c.slice(1); }
async function popularSelectCategorias(selectId, valorSelecionado) {
  const cats = await carregarCategorias();
  const sel = document.getElementById(selectId);
  if (!sel) return;
  sel.innerHTML = cats.map(c => `<option value="${c}" ${c===valorSelecionado?'selected':''}>${rotuloCategoria(c)}</option>`).join('');
}

// Origens/canais de venda (loja, instagram, whatsapp...) configuraveis
let _origensCache = null;
async function carregarOrigens() {
  if (_origensCache) return _origensCache;
  const cfg = await api('/config');
  try { _origensCache = JSON.parse(cfg.origens || '[]'); }
  catch(e) { _origensCache = []; }
  if (!_origensCache.length) _origensCache = ['loja','instagram','whatsapp','indicacao'];
  return _origensCache;
}
const _ICONE_ORIGEM = { loja:'🏪', instagram:'📷', whatsapp:'💬', indicacao:'🤝', site:'🌐', facebook:'📘' };
function rotuloOrigem(o) {
  const nomes = { loja:'Loja física', instagram:'Instagram', whatsapp:'WhatsApp', indicacao:'Indicação', site:'Site', facebook:'Facebook' };
  return (_ICONE_ORIGEM[o] ? _ICONE_ORIGEM[o] + ' ' : '') + (nomes[o] || rotuloCategoria(o));
}
async function popularSelectOrigens(selectId, valorSelecionado) {
  const ori = await carregarOrigens();
  const sel = document.getElementById(selectId);
  if (!sel) return;
  sel.innerHTML = ori.map(o => `<option value="${o}" ${o===valorSelecionado?'selected':''}>${rotuloOrigem(o)}</option>`).join('');
}

// Coleções de produtos: carrega do /config e popula um <select>
let _colecoesCache = null;
async function carregarColecoes() {
  if (_colecoesCache) return _colecoesCache;
  const cfg = await api('/config');
  try { _colecoesCache = JSON.parse(cfg.colecoes || '[]'); }
  catch(e) { _colecoesCache = []; }
  return _colecoesCache;
}
function invalidarCacheColecoes() { _colecoesCache = null; }
async function popularSelectColecoes(selectId, valorSelecionado) {
  const cols = await carregarColecoes();
  const sel = document.getElementById(selectId);
  if (!sel) return;
  sel.innerHTML = '<option value="">— sem coleção —</option>' +
    cols.map(c => `<option value="${esc(c)}" ${c===valorSelecionado?'selected':''}>${esc(c)}</option>`).join('');
}

// Exporta um array de objetos (ou matriz) como CSV que abre no Excel.
// linhas: array de objetos {col:valor} OU array de arrays; cabecalho opcional.
function exportarCSV(nomeArquivo, linhas, cabecalho) {
  if (!linhas || !linhas.length) { toast('Nada para exportar','erro'); return; }
  let cols = cabecalho;
  let dados = linhas;
  if (!Array.isArray(linhas[0])) {
    cols = cabecalho || Object.keys(linhas[0]);
    dados = linhas.map(o => cols.map(c => o[c]));
  }
  const esc = v => {
    if (v == null) v = '';
    v = String(v).replace(/"/g, '""');
    return /[";\n]/.test(v) ? `"${v}"` : v;
  };
  // separador ; (padrao Excel pt-BR) e BOM pra acentos
  const linhasCSV = [];
  if (cols) linhasCSV.push(cols.map(esc).join(';'));
  for (const row of dados) linhasCSV.push(row.map(esc).join(';'));
  const blob = new Blob(['﻿' + linhasCSV.join('\r\n')], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = nomeArquivo.endsWith('.csv') ? nomeArquivo : nomeArquivo + '.csv';
  document.body.appendChild(a); a.click(); document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
