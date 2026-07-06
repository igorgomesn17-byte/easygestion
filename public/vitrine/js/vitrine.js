// ============================================================
// VITRINE PÚBLICA - JavaScript
// ============================================================

const slug = window.location.pathname.split('/')[1];
const API_BASE = '/api/vitrine';

let dadosLoja = {};
let todosProdutos = [];
let carrinhoLocal = [];

// ============================================================
// INICIALIZAÇÃO
// ============================================================

async function inicializar() {
  try {
    // 1. Buscar dados da loja
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

    // 2. Aplicar cores do sistema
    aplicarTemasPersonalizados();

    // 3. Preencher header
    preencherHeader();

    // 3. Buscar produtos
    const resProdutos = await fetch(`${API_BASE}/${slug}/produtos`);
    if (!resProdutos.ok) {
      console.error('Erro ao carregar produtos');
      return;
    }
    const { produtos, categorias, colecoes } = await resProdutos.json();
    todosProdutos = produtos;

    // 4. Preencher filtros
    preencherFiltros(categorias, colecoes);

    // 5. Renderizar grid inicial
    renderizarProdutos(todosProdutos);

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
    // Adicionar timestamp para forçar reload (cache busting)
    const urlLogo = dadosLoja.loja_logo + '?t=' + Date.now();
    lojaLogo.src = urlLogo;
    lojaLogo.style.display = 'block'; // Garantir que não está escondida
  }

  // Preencher botões de contato
  preencherBotoesContato();

  // Meta tags OpenGraph (dinâmico)
  atualizarMetaTags(
    dadosLoja.loja_nome || 'Vitrine',
    dadosLoja.vitrine_frase || 'Conheça nossos produtos',
    dadosLoja.loja_logo || ''
  );
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

function atualizarMetaTags(title, description, image) {
  document.title = title;

  let ogTitle = document.querySelector('meta[property="og:title"]');
  if (!ogTitle) {
    ogTitle = document.createElement('meta');
    ogTitle.setAttribute('property', 'og:title');
    document.head.appendChild(ogTitle);
  }
  ogTitle.setAttribute('content', title);

  let ogDesc = document.querySelector('meta[property="og:description"]');
  if (!ogDesc) {
    ogDesc = document.createElement('meta');
    ogDesc.setAttribute('property', 'og:description');
    document.head.appendChild(ogDesc);
  }
  ogDesc.setAttribute('content', description);

  if (image) {
    let ogImage = document.querySelector('meta[property="og:image"]');
    if (!ogImage) {
      ogImage = document.createElement('meta');
      ogImage.setAttribute('property', 'og:image');
      document.head.appendChild(ogImage);
    }
    ogImage.setAttribute('content', image);
  }
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

function renderizarProdutos(produtos) {
  const grid = document.getElementById('gridProdutos');
  grid.innerHTML = '';

  if (produtos.length === 0) {
    grid.innerHTML = '<p style="grid-column: 1/-1; text-align: center; color: #999;">Nenhum produto encontrado</p>';
    return;
  }

  produtos.forEach(p => {
    const card = document.createElement('div');
    card.className = 'card-produto';
    card.innerHTML = `
      <img src="${p.foto || 'img/placeholder.png'}" alt="${p.nome}" class="card-produto-foto" onerror="this.src='img/placeholder.png'">
      <div class="card-produto-info">
        <h3 class="card-produto-nome">${p.titulo || p.nome}</h3>
        <p class="card-produto-categoria">${p.categoria || ''}</p>
        <p class="card-produto-preco">R$ ${formatarMoeda(p.preco_venda)}</p>
        <p class="card-produto-tamanhos">${p.tamanhos.length} tamanho(s)</p>
      </div>
    `;
    card.addEventListener('click', () => abrirModalProduto(p));
    grid.appendChild(card);
  });
}

// ============================================================
// MODAL DO PRODUTO
// ============================================================

let produtoSelecionado = null;
let tamanhoSelecionado = null;

function abrirModalProduto(produto) {
  produtoSelecionado = produto;
  tamanhoSelecionado = null;

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

  // Tamanhos
  const tamanhoContainer = document.getElementById('botoestTamanhoProduto');
  tamanhoContainer.innerHTML = '';
  produto.tamanhos.forEach(t => {
    const btn = document.createElement('button');
    btn.className = 'btn-tamanho';
    btn.textContent = t.tamanho;
    btn.addEventListener('click', () => {
      document.querySelectorAll('.btn-tamanho').forEach(b => b.classList.remove('selected'));
      btn.classList.add('selected');
      tamanhoSelecionado = t.tamanho;
    });
    tamanhoContainer.appendChild(btn);
  });

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
        <p class="carrinho-item-detalhes">${item.tamanho} • ${item.qtd}x R$ ${formatarMoeda(item.preco)}</p>
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
    mensagem += `${item.nome} (${item.tamanho}) x ${item.qtd} = R$ ${formatarMoeda(item.total)}\n`;
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
