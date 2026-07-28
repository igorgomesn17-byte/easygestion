// ============================================================
// PÁGINA DE PRODUTO (PDP)
//
// O HTML já vem pronto do servidor — este script só cuida da interação:
// escolher cor/tamanho, quantidade, sacola e o pedido no WhatsApp.
//
// O carrinho usa a MESMA chave de localStorage da home (`carrinho_${slug}`):
// a cliente monta a sacola navegando entre peças, e perder isso ao trocar de
// página seria pior que não ter carrinho nenhum.
// ============================================================
(function () {
  'use strict';

  const DADOS = window.__VITRINE__ || {};
  const LOJA = DADOS.loja || {};
  const PECA = DADOS.produto || {};
  const SLUG = LOJA.slug || window.location.pathname.split('/')[1];
  const COR_PADRAO = 'Unica';

  let corSel = null;
  let tamSel = null;

  const $ = (id) => document.getElementById(id);
  const moeda = (v) => Number(v || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

  // ---------- Cor e tamanho ----------
  // Regra que vale mais que qualquer animação: o tamanho ESGOTADO continua
  // visível, riscado. Sumir com ele faz a cliente achar que a peça não existe
  // naquele tamanho — quando na verdade acabou, o que é informação diferente.
  function pintarTamanhos() {
    const box = $('tamanhosPeca');
    if (!box) return;
    const grade = PECA.grade || [];
    const daCor = grade.filter((g) => !corSel || g.cor === corSel);
    const lista = daCor.length ? daCor : grade;

    box.innerHTML = '';
    tamSel = null;
    lista.forEach((g) => {
      const b = document.createElement('button');
      b.className = 'btn-tamanho';
      b.textContent = g.tamanho;
      if (!g.quantidade) {
        b.classList.add('esgotado');
        b.disabled = true;
        b.title = 'Esgotado neste tamanho';
      }
      b.addEventListener('click', () => {
        box.querySelectorAll('.btn-tamanho').forEach((x) => x.classList.remove('selected'));
        b.classList.add('selected');
        tamSel = g.tamanho;
      });
      box.appendChild(b);
    });
  }

  function ligarCores() {
    const box = $('coresPeca');
    if (!box) return;
    const botoes = box.querySelectorAll('.btn-cor');
    botoes.forEach((b) => {
      b.addEventListener('click', () => {
        botoes.forEach((x) => x.classList.remove('selected'));
        b.classList.add('selected');
        corSel = b.dataset.cor;
        pintarTamanhos();
        // A GALERIA TROCA JUNTO. Sem isto, a cliente clica em "Terracota" e
        // continua vendo a foto do off white — pede a peça errada, ou desiste.
        // É o que Nuvemshop e Loja Integrada não fazem nativamente.
        pintarGaleria(corSel);
      });
    });
    // Já deixa a primeira cor escolhida: a cliente vê tamanho disponível na hora,
    // em vez de uma lista vazia esperando um clique que ela não sabe que precisa dar.
    corSel = botoes.length ? botoes[0].dataset.cor : (PECA.cores || [])[0] || COR_PADRAO;
  }

  // Repinta a galeria com as fotos DAQUELA cor. O backend já entrega
  // `galeriaPorCor` com as fotos da cor + as comuns (tabela de medidas, close do
  // tecido) — foto sem cor marcada aparece em todas.
  function pintarGaleria(cor) {
    const porCor = PECA.galeriaPorCor || {};
    const fotos = (cor && porCor[cor] && porCor[cor].length)
      ? porCor[cor]
      : [PECA.foto, ...(PECA.galeria || [])].filter(Boolean);
    if (!fotos.length) return;

    const principal = $('fotoPrincipal');
    if (principal) principal.src = fotos[0];

    // As miniaturas são reconstruídas: o conjunto de fotos mudou, não só a ativa.
    document.querySelectorAll('.pdp-miniatura').forEach((m) => m.remove());
    const galeria = document.querySelector('.pdp-galeria');
    if (!galeria) return;
    fotos.slice(1).forEach((src) => {
      const img = document.createElement('img');
      img.className = 'pdp-miniatura';
      img.src = src;
      img.alt = '';
      img.loading = 'lazy';
      img.decoding = 'async';
      img.dataset.full = src;
      img.addEventListener('click', () => {
        if (principal) principal.src = src;
        document.querySelectorAll('.pdp-miniatura').forEach((m) => m.classList.remove('ativa'));
        img.classList.add('ativa');
      });
      galeria.appendChild(img);
    });
  }

  // ---------- Galeria ----------
  function ligarGaleria() {
    const principal = $('fotoPrincipal');
    document.querySelectorAll('.pdp-miniatura').forEach((mini) => {
      mini.addEventListener('click', () => {
        if (!principal) return;
        principal.src = mini.dataset.full || mini.src;
        document.querySelectorAll('.pdp-miniatura').forEach((m) => m.classList.remove('ativa'));
        mini.classList.add('ativa');
      });
    });
  }

  // ---------- Carrinho ----------
  const chaveCarrinho = () => `carrinho_${SLUG}`;
  function lerCarrinho() {
    try { return JSON.parse(localStorage.getItem(chaveCarrinho())) || []; }
    catch { return []; }
  }
  function salvarCarrinho(c) {
    localStorage.setItem(chaveCarrinho(), JSON.stringify(c));
    const badge = $('carrinhoQtd');
    if (badge) badge.textContent = c.reduce((s, i) => s + i.qtd, 0);
  }

  function itemAtual() {
    if (!tamSel) { avisar('Escolha um tamanho'); return null; }
    const qtd = Math.max(1, parseInt($('inputQty').value, 10) || 1);
    return {
      id: PECA.id,
      nome: PECA.titulo || PECA.nome,
      // A cor vai junto: é por esta mensagem que a peça é separada no estoque.
      // "Vestido Amanda (M)" não diz se a cliente quer o preto ou o vermelho.
      cor: corSel && corSel !== COR_PADRAO ? corSel : null,
      tamanho: tamSel,
      qtd,
      preco: PECA.preco_venda,
      total: PECA.preco_venda * qtd,
    };
  }

  function adicionar() {
    const item = itemAtual();
    if (!item) return;
    const c = lerCarrinho();
    c.push(item);
    salvarCarrinho(c);
    avisar('Adicionado à sacola');
  }

  // ---------- Pedido no WhatsApp ----------
  // Manda SÓ esta peça (o botão da sacola é que fecha o carrinho inteiro): quem
  // está na página da peça quer falar sobre ela.
  async function pedir() {
    const item = itemAtual();
    if (!item) return;
    await enviarPedido([item]);
  }

  async function enviarPedido(itens) {
    const numero = String(LOJA.loja_whatsapp || '').replace(/\D/g, '');
    if (!numero) { avisar('Esta loja ainda não configurou o WhatsApp'); return; }

    let codigo = '';
    try {
      // Grava o pedido ANTES de abrir o zap. Se falhar, o pedido segue mesmo
      // assim — perder a venda porque o registro caiu seria o pior dos mundos.
      const r = await fetch(`/api/vitrine/${SLUG}/pedido`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ itens: itens.map((i) => ({ produto_id: i.id, cor: i.cor, tamanho: i.tamanho, qtd: i.qtd })) }),
      });
      if (r.ok) codigo = (await r.json()).codigo || '';
    } catch (e) { /* segue sem código */ }

    window.open(montarLink(numero, itens, codigo), '_blank');
  }

  function montarLink(numero, itens, codigo) {
    const linhas = itens.map((i) => {
      const detalhe = [i.cor, i.tamanho].filter(Boolean).join(' / ');
      return `${i.qtd}x ${i.nome}${detalhe ? ` (${detalhe})` : ''} — R$ ${moeda(i.total)}`;
    });
    const total = itens.reduce((s, i) => s + i.total, 0);
    const msg = [
      `Olá! Quero fazer um pedido na ${LOJA.loja_nome || 'loja'}`,
      '',
      codigo ? `*Pedido #${codigo}*` : '',
      '',
      ...linhas,
      '',
      `*Total: R$ ${moeda(total)}*`,
    ].filter((l) => l !== null).join('\n');

    return `https://wa.me/${numero}?text=${encodeURIComponent(msg)}`;
  }

  // ---------- Barra fixa ----------
  // Aparece quando o CTA principal sai da tela. IntersectionObserver em vez de
  // listener de scroll: não roda a cada pixel rolado.
  function ligarBarraFixa() {
    const cta = $('btnPedir');
    const barra = $('barraFixa');
    if (!cta || !barra || !('IntersectionObserver' in window)) return;
    new IntersectionObserver(
      ([e]) => barra.classList.toggle('visivel', !e.isIntersecting),
      { rootMargin: '0px' },
    ).observe(cta);
  }

  function avisar(msg) {
    let t = $('toastPdp');
    if (!t) {
      t = document.createElement('div');
      t.id = 'toastPdp';
      t.className = 'pdp-toast';
      document.body.appendChild(t);
    }
    t.textContent = msg;
    t.classList.add('visivel');
    clearTimeout(t._timer);
    t._timer = setTimeout(() => t.classList.remove('visivel'), 2600);
  }

  // ---------- Boot ----------
  function iniciar() {
    ligarCores();
    pintarTamanhos();
    ligarGaleria();
    ligarBarraFixa();
    salvarCarrinho(lerCarrinho());   // atualiza o badge

    $('btnQtyMenos')?.addEventListener('click', () => {
      const i = $('inputQty');
      i.value = Math.max(1, (parseInt(i.value, 10) || 1) - 1);
    });
    $('btnQtyMais')?.addEventListener('click', () => {
      const i = $('inputQty');
      i.value = (parseInt(i.value, 10) || 1) + 1;
    });
    $('btnPedir')?.addEventListener('click', pedir);
    $('btnPedirFixo')?.addEventListener('click', pedir);
    $('btnSacola')?.addEventListener('click', adicionar);
    $('btnMedidas')?.addEventListener('click', () => $('modalMedidas')?.showModal());
    $('btnCarrinho')?.addEventListener('click', () => { window.location.href = `/${SLUG}`; });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', iniciar);
  else iniciar();
})();
