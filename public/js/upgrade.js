// ============================================================
// BLOQUEIO VIRA OFERTA
// Quando o backend responde 403 {upgrade:true}, o cliente Starter via um toast de
// erro e era EXPULSO da tela (redirect pra planos.html). Ver falha onde deveria
// ver oferta. Aqui o mesmo 403 renderiza o conteúdo real, com dados de exemplo
// desfocados, e um card por cima. Cadeado não vende. DRE borrado vende.
//
// Um botão só, direto pro checkout do Growth — não pra comparação de planos.
// ============================================================

// Benefício na dor do lojista, nunca no nome da feature.
// Estas frases são as MESMAS de planos.html de propósito: o lojista reencontra
// lá fora a promessa exata que bateu aqui dentro.
const BENEFICIO_POR_FEATURE = {
  relatorios_avancados: 'Descubra se sua loja deu lucro de verdade esse mês',
  export:               'Mande tudo pro contador em um clique',
  vale_credito:         'Faça a cliente voltar com crédito, em vez de devolver dinheiro',
  recorrentes:          'Nunca mais lance aluguel e energia na mão',
  vitrine_publica:      'Sua vitrine online, com a cara da sua loja',
  precificacao:         'Pare de multiplicar por 2 no chute',
  personalizacao:       'Deixe o sistema com a cara e a cor da sua loja',
  maquininha:           'Saiba quanto a maquininha come de cada venda',
};

// Quando o gate é por LIMITE (produtos), não por feature.
const BENEFICIO_POR_RECURSO = {
  produtos: 'Cadastre mais peças sem apertar o estoque',
};

// A tela onde o gate bateu diz melhor o benefício do que a feature sozinha.
// (ex: /curva-abc e /dre são ambos 'relatorios_avancados', mas vendem coisas diferentes)
const BENEFICIO_POR_TELA = {
  'fluxo.html':       'Descubra se sua loja deu lucro de verdade esse mês',
  'fluxo-caixa.html': 'Saiba se o dinheiro que entra cobre as contas que vencem',
  'curva-abc.html':   'Veja quais peças estão prendendo seu dinheiro na arara',
};

function beneficioDe(dados) {
  const porTela = BENEFICIO_POR_TELA[location.pathname.split('/').pop()];
  if (porTela) return porTela;
  if (dados && dados.feature && BENEFICIO_POR_FEATURE[dados.feature]) return BENEFICIO_POR_FEATURE[dados.feature];
  if (dados && dados.recurso && BENEFICIO_POR_RECURSO[dados.recurso]) return BENEFICIO_POR_RECURSO[dados.recurso];
  return 'Enxergue o lucro da sua loja, não só o movimento';
}

// Números FIXOS e fictícios, rotulados. O blur é CSS — some com dois cliques no
// DevTools. Usar o dado real da loja entregaria de graça a feature que está sendo
// vendida; número aleatório muda a cada visita e parece bug.
function amostraDeConteudo() {
  const linha = (rotulo, valor, classe) =>
    `<div class="upg-linha"><span>${rotulo}</span><strong class="${classe || ''}">${valor}</strong></div>`;
  return `
    <div class="upg-amostra-titulo">Resultado do mês <span class="upg-tag">números de exemplo</span></div>
    ${linha('Faturamento', 'R$ 47.320,00')}
    ${linha('Impostos', '− R$ 3.454,36')}
    ${linha('Custo das peças vendidas', '− R$ 21.294,00')}
    ${linha('Taxas de maquininha', '− R$ 1.489,58')}
    ${linha('Despesas do mês', '− R$ 14.902,00')}
    <div class="upg-divisor"></div>
    ${linha('Sobrou', 'R$ 6.180,06', 'upg-positivo')}
    ${linha('Margem', '13,1%', 'upg-positivo')}
    <div class="upg-barras">
      <div class="upg-barra" style="width:100%"></div>
      <div class="upg-barra" style="width:71%"></div>
      <div class="upg-barra" style="width:44%"></div>
      <div class="upg-barra" style="width:26%"></div>
    </div>`;
}

let _cardAberto = false;

// Renderiza o card sobre um fundo de conteúdo desfocado, ocupando o conteúdo da tela.
function mostrarCardDeUpgrade(dados) {
  if (_cardAberto) return;
  _cardAberto = true;

  garantirEstilos();

  const alvo = document.querySelector('.conteudo') || document.body;
  const beneficio = beneficioDe(dados);

  const wrap = document.createElement('div');
  wrap.className = 'upg-wrap';
  wrap.innerHTML = `
    <div class="upg-fundo" aria-hidden="true">${amostraDeConteudo()}</div>
    <div class="upg-card" role="dialog" aria-label="Recurso do plano Growth">
      <div class="upg-beneficio">${beneficio}</div>
      <p class="upg-sub">Está no plano Growth. Sua loja continua funcionando normalmente — isso aqui é o que mostra onde o dinheiro está.</p>
      <button class="upg-cta" id="upgCta">Liberar tudo isso — R$ 119,90/mês</button>
      <div class="upg-rodape">Cancela quando quiser.</div>
    </div>`;

  // substitui o conteúdo da tela: o lojista vê a promessa, não um erro
  alvo.innerHTML = '';
  alvo.appendChild(wrap);

  const cta = wrap.querySelector('#upgCta');
  if (cta) cta.addEventListener('click', irParaCheckoutGrowth);
}

async function irParaCheckoutGrowth() {
  const btn = document.getElementById('upgCta');
  if (btn) { btn.disabled = true; btn.textContent = 'Abrindo checkout…'; }
  try {
    const resp = await fetch('/api/assinaturas/checkout', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'same-origin',
      body: JSON.stringify({ plano: 'growth', ciclo: 'mensal' }),
    });
    const dados = await resp.json().catch(() => ({}));
    if (resp.ok && dados.checkout_url) {
      window.location.href = dados.checkout_url;   // Stripe Checkout não roda em iframe
      return;
    }
    // sem checkout (sessão expirada, Stripe fora do ar): manda pra tela de planos
    window.location.href = 'planos.html?plano=growth';
  } catch (e) {
    window.location.href = 'planos.html?plano=growth';
  }
}

// CSS injetado uma vez. Fica aqui (e não no ds.css) porque só existe por causa do gate.
function garantirEstilos() {
  if (document.getElementById('upg-estilos')) return;
  const s = document.createElement('style');
  s.id = 'upg-estilos';
  s.textContent = `
    .upg-wrap { position:relative; min-height:520px; display:flex; align-items:center; justify-content:center; padding:20px 0; }
    .upg-fundo {
      position:absolute; inset:0; padding:28px 24px; overflow:hidden;
      filter: blur(6px); opacity:.55; pointer-events:none; user-select:none;
      background:var(--superficie,#fff); border:1px solid var(--borda,#e2e5e9); border-radius:10px;
    }
    .upg-amostra-titulo { font-size:1.15rem; font-weight:700; margin-bottom:16px; }
    .upg-tag { font-size:.7rem; font-weight:600; padding:2px 7px; border-radius:999px; background:#eee; color:#555; vertical-align:middle; }
    .upg-linha { display:flex; justify-content:space-between; padding:9px 0; border-bottom:1px solid var(--borda,#eee); font-size:1rem; }
    .upg-divisor { height:2px; background:var(--borda,#ddd); margin:10px 0; }
    .upg-positivo { color:var(--verde,#1a8a5a); }
    .upg-barras { margin-top:22px; display:flex; flex-direction:column; gap:9px; }
    .upg-barra { height:16px; border-radius:4px; background:var(--marca,#157a63); opacity:.35; }
    .upg-card {
      position:relative; z-index:2; max-width:460px; width:100%;
      background:var(--superficie,#fff); border:1px solid var(--borda,#e2e5e9);
      border-radius:12px; padding:30px 28px; text-align:center;
      box-shadow:0 8px 28px rgba(0,0,0,.14);
    }
    .upg-beneficio { font-size:1.32rem; font-weight:700; line-height:1.35; margin-bottom:12px; }
    .upg-sub { color:var(--texto-fraco,#667); font-size:.93rem; line-height:1.5; margin:0 0 22px; }
    .upg-cta {
      width:100%; padding:15px 18px; border:0; border-radius:8px; cursor:pointer;
      background:var(--marca,#157a63); color:#fff; font-size:1.02rem; font-weight:700;
    }
    .upg-cta:hover { background:var(--marca-escura,#0e5647); }
    .upg-cta:disabled { opacity:.7; cursor:default; }
    .upg-rodape { margin-top:12px; font-size:.82rem; color:var(--texto-fraco,#889); }
    @media (max-width:560px){ .upg-card { padding:24px 20px; } .upg-beneficio { font-size:1.15rem; } }
  `;
  document.head.appendChild(s);
}
