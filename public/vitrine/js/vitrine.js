// ============================================================
// VITRINE PÚBLICA - JavaScript
// ============================================================

const slug = window.location.pathname.split('/')[1];
const API_BASE = '/api/vitrine';

// A peça é o par (cor, tamanho). 'Unica' é a cor de quem não tem cor — igual ao
// lib/sku.js do backend. Declarado AQUI no topo, e não perto de onde é usado:
// `const` tem temporal dead zone, e renderizarProdutos() o consome bem antes.
const COR_PADRAO = 'Unica';

let dadosLoja = {};
let todosProdutos = [];
let carrinhoLocal = [];

// ============================================================
// INICIALIZAÇÃO
// ============================================================

async function inicializar() {
  try {
    let categorias, colecoes;

    // CAMINHO RÁPIDO — o servidor já mandou tudo pronto (window.__VITRINE__).
    // Mata os DOIS fetches em cascata do boot (HTML → JS → fetch loja → fetch
    // produtos → render), que eram o que atrasava a primeira pintura. O fetch
    // continua como fallback: loja sem `vitrine_site` recebe o HTML sem dados.
    if (window.__VITRINE__ && window.__VITRINE__.loja) {
      dadosLoja = window.__VITRINE__.loja;
      todosProdutos = window.__VITRINE__.produtos || [];
      categorias = window.__VITRINE__.categorias || [];
      colecoes = window.__VITRINE__.colecoes || [];
      preencherHeader();
      preencherFiltros(categorias, colecoes);
      // A grade JÁ está pintada pelo servidor — repintar aqui só causaria um
      // flash. Só ligamos o clique nos cards que já existem.
      ligarCliqueNosCards();
    } else {
      const resLoja = await fetch(`${API_BASE}/${slug}`);
      if (!resLoja.ok) {
        exibirMensagemVitrinaIndisponivel();
        return;
      }
      dadosLoja = await resLoja.json();

      if (!dadosLoja.vitrineAtiva) {
        exibirMensagemVitrinaIndisponivel();
        return;
      }

      aplicarTemasPersonalizados();
      preencherHeader();

      const resProdutos = await fetch(`${API_BASE}/${slug}/produtos`);
      if (!resProdutos.ok) {
        console.error('Erro ao carregar produtos');
        return;
      }
      ({ produtos: todosProdutos, categorias, colecoes } = await resProdutos.json());

      preencherFiltros(categorias, colecoes);
      renderizarProdutos(todosProdutos);
    }

    // 6. Listeners
    document.getElementById('filtroCategoria').addEventListener('change', filtrar);
    document.getElementById('filtroColecao').addEventListener('change', filtrar);
    document.getElementById('filtroBusca').addEventListener('input', filtrar);
    document.getElementById('btnCarrinho').addEventListener('click', abrirModalCarrinho);
    document.getElementById('btnFinalizarWhatsApp').addEventListener('click', finalizarWhatsApp);

    // Listeners dos modals
    document.querySelectorAll('[data-close]').forEach(btn => {
      btn.addEventListener('click', (e) => {
        const modalId = e.target.dataset.close;
        fecharModal(modalId);
      });
    });

    // Restaurar carrinho do localStorage
    restaurarCarrinho();
  } catch (err) {
    console.error('Erro ao inicializar vitrine:', err);
    exibirMensagemErro('Erro ao carregar a vitrine. Tente novamente.');
  }
}

// ============================================================
// HEADER E DADOS DA LOJA
// ============================================================

function preencherHeader() {
  const lojaLogo = document.getElementById('lojaLogo');
  const lojafrase = document.getElementById('lojafrase');

  lojafrase.textContent = dadosLoja.vitrine_frase || '';

  if (dadosLoja.loja_logo) {
    // SEM `?t=Date.now()`: o nome do arquivo da logo já muda a cada upload
    // (`logo-<timestamp>.png`), então não há versão velha pra furar. Com o
    // cache `immutable` do servidor, o timestamp aqui viraria um cache miss a
    // cada visita — pagando download de logo em toda pageview.
    lojaLogo.src = dadosLoja.loja_logo;
    lojaLogo.style.display = 'block';
  }

  // Preencher botões de contato
  preencherBotoesContato();

  // As meta tags (title/OG) são montadas NO SERVIDOR (lib/vitrine-html.js).
  // Havia aqui uma `atualizarMetaTags()` que as injetava por JS — inútil: o
  // crawler do WhatsApp e o do Google não executam JavaScript, então todo link
  // de loja compartilhado saía sem preview. Foi removida junto com a chamada.
}

function preencherBotoesContato() {
  // WhatsApp
  if (dadosLoja.loja_whatsapp) {
    const btnWA = document.getElementById('btnWhatsApp');
    const numeroLimpo = dadosLoja.loja_whatsapp.replace(/\D/g, '');
    btnWA.href = `https://wa.me/${numeroLimpo}`;
    btnWA.style.display = 'inline-flex';

    // Footer
    const footerWA = document.getElementById('footerWhatsApp');
    footerWA.href = `https://wa.me/${numeroLimpo}`;
    footerWA.style.display = 'inline-flex';
  }

  // Instagram
  if (dadosLoja.loja_instagram_url) {
    let instagramUrl = dadosLoja.loja_instagram_url;
    // Garantir que tem https:// no início
    if (!instagramUrl.startsWith('http')) {
      instagramUrl = 'https://' + instagramUrl;
    }
    // Remover www. (Instagram não gosta)
    instagramUrl = instagramUrl.replace('://www.', '://');

    const btnIG = document.getElementById('btnInstagram');
    btnIG.href = instagramUrl;
    btnIG.style.display = 'inline-flex';

    // Footer
    const footerIG = document.getElementById('footerInstagram');
    footerIG.href = instagramUrl;
    footerIG.style.display = 'inline-flex';
  }

  // Google Maps
  if (dadosLoja.loja_maps) {
    const btnMaps = document.getElementById('btnMaps');
    btnMaps.href = dadosLoja.loja_maps;
    btnMaps.style.display = 'inline-flex';

    // Footer
    const footerMaps = document.getElementById('footerMaps');
    footerMaps.href = dadosLoja.loja_maps;
    footerMaps.style.display = 'inline-flex';
  }

  // Preencher footer
  document.getElementById('footerNomeLoja').textContent = dadosLoja.loja_nome || 'Loja';

  if (dadosLoja.loja_endereco) {
    const footerEndereco = document.getElementById('footerEndereco');
    footerEndereco.textContent = dadosLoja.loja_endereco;
    footerEndereco.style.display = 'block';
  }

  // Username (Instagram sem @, ou nome da loja)
  if (dadosLoja.loja_instagram) {
    const username = dadosLoja.loja_instagram.replace('@', '');
    document.getElementById('footerUsername').textContent = '@' + username;
  }
}

function enviarNewsletter(event) {
  event.preventDefault();

  const nome = document.getElementById('inputNomeNewsletter').value.trim();
  const whatsapp = document.getElementById('inputWhatsAppNewsletter').value.trim();

  if (!nome || !whatsapp) {
    alert('Por favor, preencha seu nome e WhatsApp');
    return;
  }

  // Montar mensagem para WhatsApp
  const numeroLoja = (dadosLoja.loja_whatsapp || '').replace(/\D/g, '');
  if (!numeroLoja) {
    alert('Erro: WhatsApp da loja não configurado');
    return;
  }

  const mensagem = `Olá! Meu nome é ${nome} e gostaria de receber novidades, promoções e lançamentos. Meu WhatsApp: ${whatsapp}`;
  const urlEncoded = encodeURIComponent(mensagem);
  const linkWhatsApp = `https://wa.me/${numeroLoja}?text=${urlEncoded}`;

  // Abrir WhatsApp
  window.open(linkWhatsApp, '_blank');

  // Limpar formulário
  document.getElementById('inputNomeNewsletter').value = '';
  document.getElementById('inputWhatsAppNewsletter').value = '';
}

// ============================================================
// FILTROS
// ============================================================

function preencherFiltros(categorias, colecoes) {
  const selectCategoria = document.getElementById('filtroCategoria');
  const selectColecao = document.getElementById('filtroColecao');
  const botoesColecoes = document.getElementById('botoesColecoes');

  // Preencher selects
  categorias.forEach(cat => {
    const option = document.createElement('option');
    option.value = cat;
    option.textContent = cat;
    selectCategoria.appendChild(option);
  });

  colecoes.forEach(col => {
    const option = document.createElement('option');
    option.value = col;
    option.textContent = col;
    selectColecao.appendChild(option);
  });

  // Preencher botões de coleções (barra horizontal)
  botoesColecoes.innerHTML = '';
  colecoes.forEach(col => {
    const btn = document.createElement('button');
    btn.className = 'btn-colecao';
    btn.textContent = col;
    btn.dataset.colecao = col;
    btn.addEventListener('click', () => {
      document.querySelectorAll('.btn-colecao').forEach(b => b.classList.remove('btn-colecao-ativo'));
      btn.classList.add('btn-colecao-ativo');
      filtrar();
    });
    botoesColecoes.appendChild(btn);
  });
}

function filtrar() {
  const categoria = document.getElementById('filtroCategoria').value;
  let colecao = document.getElementById('filtroColecao').value;

  // Também checar qual botão de coleção está ativo
  const btnAtivoColecao = document.querySelector('.btn-colecao-ativo');
  if (btnAtivoColecao && btnAtivoColecao.dataset.colecao) {
    colecao = btnAtivoColecao.dataset.colecao;
  }

  const busca = document.getElementById('filtroBusca').value.toLowerCase();

  const filtrados = todosProdutos.filter(p => {
    const passaCategoria = !categoria || p.categoria === categoria;
    const passaColecao = !colecao || p.colecao === colecao;
    const passaBusca = !busca || p.nome.toLowerCase().includes(busca);
    return passaCategoria && passaColecao && passaBusca;
  });

  renderizarProdutos(filtrados);
}

// ============================================================
// RENDERIZAÇÃO DA GRADE
// ============================================================

// Escape de HTML. A vitrine NÃO carrega public/js/comum.js (onde mora o esc() do
// resto do sistema), e este arquivo injeta nome/categoria de produto via
// innerHTML. Sem isso, uma peça chamada `<img onerror=...>` executa script na
// cara da cliente. O servidor tem o equivalente em lib/vitrine-render.js.
function esc(s) {
  if (s === null || s === undefined) return '';
  return String(s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

// A legenda do card: cores vendem mais que contagem de tamanhos — a cliente
// escolhe pela cor. Espelha `cardProduto` em lib/vitrine-html.js.
function legendaDoCard(p) {
  const cores = (p.cores || []).filter(c => c && c !== COR_PADRAO);
  if (!cores.length) return `${(p.tamanhos || []).length} tamanho(s)`;
  return `${cores.slice(0, 3).join(' • ')}${cores.length > 3 ? ' +' + (cores.length - 3) : ''}`;
}

// ⚠️ ESTE HTML TEM QUE SER IGUAL ao de cardProduto() em lib/vitrine-html.js.
// O servidor pinta a grade uma vez; a partir do primeiro filtro quem repinta é
// esta função. Se divergir, a página "pula" no primeiro clique de busca.
// Mudou o layout do card? Mude nos DOIS.
function htmlDoCard(p, i) {
  const nome = p.titulo || p.nome || '';
  const attrs = i === 0
    ? 'fetchpriority="high" decoding="async"'
    : 'loading="lazy" decoding="async"';
  return `
      <img src="${esc(p.foto || '/img/placeholder.png')}" alt="${esc(nome)}" class="card-produto-foto" ${attrs}>
      <div class="card-produto-info">
        <h3 class="card-produto-nome">${esc(nome)}</h3>
        <p class="card-produto-categoria">${esc(p.categoria || '')}</p>
        <p class="card-produto-preco">R$ ${formatarMoeda(p.preco_venda)}</p>
        <p class="card-produto-tamanhos">${esc(legendaDoCard(p))}</p>
      </div>`;
}

function renderizarProdutos(produtos) {
  const grid = document.getElementById('gridProdutos');
  grid.innerHTML = '';

  if (produtos.length === 0) {
    grid.innerHTML = '<p class="vitrine-vazio">Nenhuma peça encontrada.</p>';
    return;
  }

  const temSite = !!(dadosLoja && dadosLoja.tem_site);

  produtos.forEach((p, i) => {
    // Com site, o card é um LINK de verdade pra página da peça (endereço que a
    // lojista manda no zap e que o Google segue). Sem site, abre o modal.
    const card = document.createElement(temSite ? 'a' : 'div');
    card.className = 'card-produto';
    card.dataset.id = p.id;
    if (temSite) card.href = urlDaPeca(p);
    card.innerHTML = htmlDoCard(p, i);
    if (!temSite) card.addEventListener('click', () => abrirModalProduto(p));
    grid.appendChild(card);
  });
}

// Espelha urlProduto() do backend: /:slug/p/:nome-slug-:id
function urlDaPeca(p) {
  const nomeSlug = String(p.titulo || p.nome || '')
    .toLowerCase().trim()
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .substring(0, 50);
  return `/${slug}/p/${nomeSlug ? nomeSlug + '-' : ''}${p.id}`;
}

// Cards que vieram PRONTOS do servidor: sem site viram clique de modal.
// Com site já são <a href> e não precisam de listener nenhum.
function ligarCliqueNosCards() {
  if (dadosLoja && dadosLoja.tem_site) return;
  document.querySelectorAll('#gridProdutos .card-produto').forEach(card => {
    const p = todosProdutos.find(x => String(x.id) === card.dataset.id);
    if (p) card.addEventListener('click', () => abrirModalProduto(p));
  });
}

// ============================================================
// MODAL DO PRODUTO
// ============================================================

let produtoSelecionado = null;
let tamanhoSelecionado = null;
let corSelecionada = null;

function abrirModalProduto(produto) {
  produtoSelecionado = produto;
  tamanhoSelecionado = null;
  corSelecionada = null;

  document.getElementById('modalProdutoNome').textContent = produto.titulo || produto.nome;
  document.getElementById('modalProdutoFoto').src = produto.foto;
  document.getElementById('modalProdutoPreco').textContent = `R$ ${formatarMoeda(produto.preco_venda)}`;
  document.getElementById('inputQty').value = 1;

  // Galeria extra
  const galeriaContainer = document.getElementById('galeriaExtraProduto');
  galeriaContainer.innerHTML = '';
  (produto.galeria || []).forEach(foto => {
    const img = document.createElement('img');
    img.src = foto;
    img.alt = '';
    img.onerror = () => img.style.display = 'none';
    img.addEventListener('click', () => {
      document.getElementById('modalProdutoFoto').src = foto;
      document.querySelectorAll('#galeriaExtraProduto img').forEach(i => i.classList.remove('active'));
      img.classList.add('active');
    });
    galeriaContainer.appendChild(img);
  });

  // COR e TAMANHO. A peça é o par (cor, tamanho): escolher só o tamanho não diz qual
  // peça a cliente quer quando o mesmo modelo existe em preto e em vermelho.
  // A cor vem primeiro, e os tamanhos mostrados são os DAQUELA cor — assim a cliente
  // nunca escolhe uma combinação que a loja não tem.
  const grade = produto.grade || [];
  const cores = (produto.cores || [...new Set(grade.map(g => g.cor))]).filter(Boolean);
  const temCor = cores.some(c => c !== COR_PADRAO);

  const corContainer = document.getElementById('botoesCorProduto');
  const tamanhoContainer = document.getElementById('botoestTamanhoProduto');

  function renderTamanhos() {
    tamanhoContainer.innerHTML = '';
    tamanhoSelecionado = null;
    const daCor = grade.filter(g => !corSelecionada || g.cor === corSelecionada);
    // sem grade (produto antigo, pré-matriz): cai nos tamanhos soltos que a API manda
    const lista = daCor.length ? daCor : (produto.tamanhos || []);
    lista.forEach(t => {
      const btn = document.createElement('button');
      btn.className = 'btn-tamanho';
      btn.textContent = t.tamanho;
      btn.addEventListener('click', () => {
        tamanhoContainer.querySelectorAll('.btn-tamanho').forEach(b => b.classList.remove('selected'));
        btn.classList.add('selected');
        tamanhoSelecionado = t.tamanho;
      });
      tamanhoContainer.appendChild(btn);
    });
  }

  if (corContainer) corContainer.innerHTML = '';
  const blocoCor = corContainer && (corContainer.closest('.opcao-produto') || corContainer);
  if (blocoCor) blocoCor.style.display = temCor ? '' : 'none';

  if (temCor && corContainer) {
    cores.forEach((cor, i) => {
      const btn = document.createElement('button');
      btn.className = 'btn-tamanho btn-cor';
      btn.textContent = cor;
      btn.addEventListener('click', () => {
        corContainer.querySelectorAll('.btn-cor').forEach(b => b.classList.remove('selected'));
        btn.classList.add('selected');
        corSelecionada = cor;
        renderTamanhos();
      });
      corContainer.appendChild(btn);
      // já deixa a primeira cor escolhida: a cliente vê tamanho disponível na hora, em
      // vez de uma lista vazia esperando um clique que ela não sabe que precisa dar
      if (i === 0) btn.click();
    });
  } else {
    corSelecionada = cores[0] || COR_PADRAO;
    renderTamanhos();
  }

  // Quantidade
  document.getElementById('btnQtyMenos').addEventListener('click', () => {
    const input = document.getElementById('inputQty');
    if (input.value > 1) input.value = parseInt(input.value) - 1;
  });

  document.getElementById('btnQtyMais').addEventListener('click', () => {
    const input = document.getElementById('inputQty');
    input.value = parseInt(input.value) + 1;
  });

  // Botão adicionar
  document.getElementById('btnAdicionarCarrinho').addEventListener('click', () => {
    if (!tamanhoSelecionado) {
      alert('Selecione um tamanho');
      return;
    }
    adicionarCarrinho();
  });

  abrirModal('modalProduto');
}

function adicionarCarrinho() {
  const qtd = parseInt(document.getElementById('inputQty').value) || 1;

  const item = {
    id: produtoSelecionado.id,
    nome: produtoSelecionado.titulo || produtoSelecionado.nome,
    // a cor vai junto: o pedido que chega no WhatsApp precisa dizer QUAL peça a
    // cliente quer, senão a loja separa a errada
    cor: corSelecionada && corSelecionada !== COR_PADRAO ? corSelecionada : null,
    tamanho: tamanhoSelecionado,
    qtd: qtd,
    preco: produtoSelecionado.preco_venda,
    total: produtoSelecionado.preco_venda * qtd
  };

  carrinhoLocal.push(item);
  salvarCarrinho();
  atualizarBadgeCarrinho();
  fecharModal('modalProduto');

  // Feedback visual (opcional)
  const btn = document.getElementById('btnCarrinho');
  btn.style.transform = 'scale(1.2)';
  setTimeout(() => btn.style.transform = 'scale(1)', 200);
}

// ============================================================
// CARRINHO
// ============================================================

function abrirModalCarrinho() {
  renderizarCarrinho();
  abrirModal('modalCarrinho');
}

function renderizarCarrinho() {
  const container = document.getElementById('carrinhoItens');
  const btnFinalizar = document.getElementById('btnFinalizarWhatsApp');

  if (carrinhoLocal.length === 0) {
    container.innerHTML = '<div class="carrinho-vazio">Seu carrinho está vazio</div>';
    btnFinalizar.disabled = true;
    document.getElementById('carrinhoTotal').textContent = 'Total: R$ 0,00';
    return;
  }

  container.innerHTML = '';
  let total = 0;

  carrinhoLocal.forEach((item, idx) => {
    const div = document.createElement('div');
    div.className = 'carrinho-item';
    div.innerHTML = `
      <div class="carrinho-item-info">
        <p class="carrinho-item-nome">${item.nome}</p>
        <p class="carrinho-item-detalhes">${[item.cor, item.tamanho].filter(Boolean).join(' / ')} • ${item.qtd}x R$ ${formatarMoeda(item.preco)}</p>
      </div>
      <p class="carrinho-item-preco">R$ ${formatarMoeda(item.total)}</p>
      <button class="carrinho-item-remover" data-idx="${idx}">×</button>
    `;
    container.appendChild(div);
    total += item.total;

    div.querySelector('.carrinho-item-remover').addEventListener('click', () => {
      carrinhoLocal.splice(idx, 1);
      salvarCarrinho();
      atualizarBadgeCarrinho();
      renderizarCarrinho();
    });
  });

  document.getElementById('carrinhoTotal').textContent = `Total: R$ ${formatarMoeda(total)}`;
  btnFinalizar.disabled = false;
}

// ============================================================
// WhatsApp
// ============================================================

function finalizarWhatsApp() {
  if (carrinhoLocal.length === 0) {
    alert('Seu carrinho está vazio');
    return;
  }

  const whatsappNumber = dadosLoja.loja_whatsapp || '';
  if (!whatsappNumber) {
    alert('Erro: WhatsApp não configurado');
    return;
  }

  // Montar mensagem
  let mensagem = `Olá! Gostaria de fazer um pedido:\n\n`;
  let total = 0;

  carrinhoLocal.forEach(item => {
    // A COR tem que estar aqui. Esta mensagem é o pedido que chega no WhatsApp da
    // loja — é por ela que a peça é separada. "Vestido Amanda (M)" não diz se a
    // cliente quer o preto ou o vermelho.
    const detalhe = [item.cor, item.tamanho].filter(Boolean).join(' / ');
    mensagem += `${item.nome}${detalhe ? ` (${detalhe})` : ''} x ${item.qtd} = R$ ${formatarMoeda(item.total)}\n`;
    total += item.total;
  });

  mensagem += `\n*Total: R$ ${formatarMoeda(total)}*\n\nPor favor, confirme a disponibilidade e os dados de entrega.`;

  // Montar link (wa.me espera número sem formatação)
  const numeroLimpo = whatsappNumber.replace(/\D/g, '');
  const urlEncoded = encodeURIComponent(mensagem);
  const linkWhatsApp = `https://wa.me/${numeroLimpo}?text=${urlEncoded}`;

  // Abrir em nova aba
  window.open(linkWhatsApp, '_blank');

  // Limpar carrinho após envio
  carrinhoLocal = [];
  salvarCarrinho();
  atualizarBadgeCarrinho();
  fecharModal('modalCarrinho');
}

// ============================================================
// localStorage (carrinho)
// ============================================================

function salvarCarrinho() {
  localStorage.setItem(`carrinho_${slug}`, JSON.stringify(carrinhoLocal));
}

function restaurarCarrinho() {
  const salvo = localStorage.getItem(`carrinho_${slug}`);
  if (salvo) {
    carrinhoLocal = JSON.parse(salvo);
    atualizarBadgeCarrinho();
  }
}

function atualizarBadgeCarrinho() {
  const qtdTotal = carrinhoLocal.reduce((sum, item) => sum + item.qtd, 0);
  document.getElementById('carrinhoQtd').textContent = qtdTotal;
}

// ============================================================
// MODALS
// ============================================================

function abrirModal(id) {
  document.getElementById(id).classList.add('active');
}

function fecharModal(id) {
  document.getElementById(id).classList.remove('active');
}

// Fechar modal ao clicar fora
document.querySelectorAll('.modal').forEach(modal => {
  modal.addEventListener('click', (e) => {
    if (e.target === modal) {
      modal.classList.remove('active');
    }
  });
});

// ============================================================
// UTILITÁRIOS
// ============================================================

function formatarMoeda(valor) {
  return parseFloat(valor).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function exibirMensagemVitrinaIndisponivel() {
  document.body.innerHTML = `
    <div style="
      display: flex;
      align-items: center;
      justify-content: center;
      min-height: 100vh;
      background: var(--marca, #157a63);
      color: white;
      text-align: center;
      padding: 2rem;
    ">
      <div style="max-width: 500px;">
        <h1 style="font-size: 2.5rem; margin-bottom: 1rem;">Vitrine Indisponível</h1>
        <p style="font-size: 1.1rem; margin-bottom: 2rem;">Esta loja ainda não tem a vitrine ativa.</p>
        <p style="color: rgba(255, 255, 255, 0.8);">Volte em breve!</p>
      </div>
    </div>
  `;
}

function exibirMensagemErro(msg) {
  document.body.innerHTML = `
    <div style="
      display: flex;
      align-items: center;
      justify-content: center;
      min-height: 100vh;
      background: #f5f5f5;
      color: #333;
      text-align: center;
      padding: 2rem;
    ">
      <div style="max-width: 500px;">
        <h1 style="color: #d32f2f;">Erro</h1>
        <p>${msg}</p>
      </div>
    </div>
  `;
}

// ============================================================
// TEMAS PERSONALIZADOS
// ============================================================

function aplicarTemasPersonalizados() {
  // Cor da marca (se configurada no sistema)
  if (dadosLoja.marca_cor) {
    // Gerar variações de cor (mais escura e mais clara)
    const corPrincipal = dadosLoja.marca_cor;
    const corEscura = escurecerCor(corPrincipal, 30);
    const corClara = clareaarCor(corPrincipal, 30);

    // Injetar CSS dinâmico no <style id="temaLoja">
    const styleTema = document.getElementById('temaLoja');
    if (styleTema) {
      styleTema.textContent = `
        :root {
          --marca: ${corPrincipal} !important;
          --marca-escura: ${corEscura} !important;
          --marca-clara: ${corClara} !important;
        }
      `;
    }
  }
}

// Escurecer cor hexadecimal
function escurecerCor(cor, percentual) {
  const num = parseInt(cor.replace('#', ''), 16);
  const amt = Math.round(2.55 * percentual);
  const R = (num >> 16) - amt;
  const G = (num >> 8 & 0x00FF) - amt;
  const B = (num & 0x0000FF) - amt;
  return '#' + (0x1000000 + (R < 255 ? R < 1 ? 0 : R : 255) * 0x10000 +
    (G < 255 ? G < 1 ? 0 : G : 255) * 0x100 +
    (B < 255 ? B < 1 ? 0 : B : 255))
    .toString(16).slice(1);
}

// Clarear cor hexadecimal
function clareaarCor(cor, percentual) {
  const num = parseInt(cor.replace('#', ''), 16);
  const amt = Math.round(2.55 * percentual);
  const R = (num >> 16) + amt;
  const G = (num >> 8 & 0x00FF) + amt;
  const B = (num & 0x0000FF) + amt;
  return '#' + (0x1000000 + (R > 255 ? 255 : R) * 0x10000 +
    (G > 255 ? 255 : G) * 0x100 +
    (B > 255 ? 255 : B))
    .toString(16).slice(1);
}

// ============================================================
// BOOT
// ============================================================

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', inicializar);
} else {
  inicializar();
}
