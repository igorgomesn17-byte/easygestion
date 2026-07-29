// ============================================================
// SHELL DE ABAS — junta telas que já existem numa página só.
// ------------------------------------------------------------
// O CRM tinha 7 itens de menu, cada um uma tela. Funcionava, mas ninguém trabalha
// assim: pra responder "está funcionando?" a lojista abria quatro abas diferentes.
//
// Este shell carrega o HTML de uma tela existente e executa os scripts dela DENTRO
// da página atual. Não é iframe — e essa distinção importa:
//
//   iframe teria altura fixa (ou um ResizeObserver frágil), histórico próprio que
//   quebra o botão voltar, e CSS isolado que faria a mesma tela parecer diferente
//   dentro e fora. Aqui é o mesmo documento: mesmo CSS, mesma rolagem, mesmo tema.
//
// O custo é que os scripts das telas compartilham escopo global. Na prática não
// dói porque cada tela usa `montarLayout(...)` (que o shell neutraliza) e funções
// com nomes próprios — mas é a razão de `carregarAba` limpar o container antes.
// ============================================================

// Telas embarcadas declaram `window.__ABA_INIT` em vez de rodar no DOMContentLoaded
// (que já disparou). Quem não declara, o shell chama `carregar()` por convenção.
window.__ABA_INIT = null;

const _abasCarregadas = new Set();

// Extrai <style> e o conteúdo de .conteudo de uma tela do sistema.
// Ignora <head>, sidebar e o resto do chrome: quem desenha isso é a página-mãe.
function _extrairTela(html) {
  const doc = new DOMParser().parseFromString(html, 'text/html');

  // Os <style> da tela vão pro <head> UMA vez — repetir a cada troca de aba
  // encheria o documento de regras duplicadas.
  const estilos = [...doc.querySelectorAll('style')].map((s) => s.textContent).join('\n');

  // O corpo útil: dentro de .conteudo, sem o <h1>/subtítulo (a aba já diz onde
  // você está — repetir o título dentro da aba é ruído).
  const cont = doc.querySelector('.conteudo');
  if (cont) {
    const h1 = cont.querySelector('h1');
    if (h1) {
      const sub = h1.nextElementSibling;
      if (sub && sub.classList.contains('subtitulo')) sub.remove();
      h1.remove();
    }
  }

  // <dialog> precisa ficar FORA do container da aba: um dialog dentro de um
  // elemento com `overflow` não abre em cima da página, abre cortado.
  const dialogs = [...doc.querySelectorAll('dialog')];
  dialogs.forEach((d) => d.remove());

  const scripts = [...doc.querySelectorAll('script')]
    .filter((s) => !s.src)              // comum.js e libs externas já estão na mãe
    .map((s) => s.textContent);

  return { estilos, html: cont ? cont.innerHTML : '', scripts, dialogs };
}

// Carrega uma aba no container. Idempotente: a segunda vez só reexecuta o init.
async function carregarAba(container, arquivo, { init } = {}) {
  const el = typeof container === 'string' ? document.getElementById(container) : container;
  if (!el) return;

  el.innerHTML = '<p class="texto-cinza" style="padding:20px;">Carregando…</p>';

  try {
    const r = await fetch(arquivo, { credentials: 'same-origin' });
    if (!r.ok) throw new Error('Não consegui abrir esta aba');
    const { estilos, html, scripts, dialogs } = _extrairTela(await r.text());

    if (estilos && !_abasCarregadas.has(arquivo)) {
      const tag = document.createElement('style');
      tag.dataset.aba = arquivo;
      tag.textContent = estilos;
      document.head.appendChild(tag);
    }

    el.innerHTML = html;
    dialogs.forEach((d) => {
      if (!document.getElementById(d.id)) document.body.appendChild(d);
    });

    // Os scripts rodam UMA vez por aba. Reexecutar redeclararia `const`/`let` do
    // topo do arquivo e estouraria SyntaxError — que mataria a aba inteira em
    // silêncio, o tipo de bug mais chato de achar.
    if (!_abasCarregadas.has(arquivo)) {
      window.__ABA_INIT = null;
      for (const codigo of scripts) {
        try {
          // O IIFE existe pra que `const`/`let` do topo de uma tela não colidam
          // com os de outra — duas abas declarando `let FILTRO` estourariam
          // SyntaxError, e a segunda aba morreria em silêncio.
          //
          // Mas o isolamento tem um preço: as funções da tela ficam PRESAS dentro
          // dele. `function carregar()` não vira `window.carregar`, e o shell
          // procurava lá fora — resultado: a aba montava o HTML e nunca buscava
          // os dados. Parecia funcionar e vinha vazia.
          //
          // A exportação no fim resolve: cada tela entrega as funções que a
          // página-mãe precisa chamar, sem abrir mão do isolamento.
          //
          // <script> injetado no DOM, e não `new Function`/`eval`: o CSP deste
          // projeto NÃO tem `unsafe-eval` (só `unsafe-inline`), então os dois
          // seriam bloqueados pelo navegador. Abrir o CSP por causa disto seria
          // péssima troca — foi justamente ele que barrou a conversão de HEIC no
          // navegador e mandou a conversão pro servidor, onde é mais segura.
          //
          // Roda no escopo GLOBAL de propósito. Um IIFE parece mais seguro, mas
          // quebra duas coisas:
          //   1. `function carregar()` ficaria presa lá dentro e nunca viraria
          //      `window.carregar` — o shell não acharia, e a aba montaria o HTML
          //      sem NUNCA buscar os dados. Parecia funcionar, e vinha vazia.
          //   2. `onclick="verQuem('DIA1')"` é resolvido no escopo global. Toda
          //      tabela clicável e todo filtro dariam "função não definida".
          //
          // O risco de colisão entre telas é contido por `_abasCarregadas`: cada
          // arquivo executa UMA vez por sessão.
          // O IIFE isola (`const esc` de uma tela × `function esc` de outra
          // estouraria SyntaxError e mataria a aba em silêncio), e a exportação
          // no fim devolve o que a página precisa: `carregar` pro shell chamar, e
          // TODA função nomeada pro `onclick` do HTML encontrar.
          //
          // A varredura é do texto do próprio script — não há como listar as
          // funções de um escopo por reflexão em JS.
          const nomes = [...new Set(
            [...codigo.matchAll(/^\s*(?:async\s+)?function\s+([A-Za-z_$][\w$]*)/gm)].map((m) => m[1])
          )];
          const pontes = nomes.map((n) => `window[${JSON.stringify(n)}] = ${n};`).join('');

          const tag = document.createElement('script');
          tag.dataset.aba = arquivo;
          tag.textContent = `(function(){
            var montarLayout = function(){};
            ${codigo}
            ${pontes}
            if (typeof carregar === 'function') window.__ABA_INIT = carregar;
          })();`;
          document.body.appendChild(tag);
        } catch (e) {
          console.error('[ABA]', arquivo, e.message);
        }
      }
      _abasCarregadas.add(arquivo);
    }

    // Init: o que a tela rodaria no DOMContentLoaded (que já passou).
    const fn = init || window.__ABA_INIT || (typeof window.carregar === 'function' ? window.carregar : null);
    if (fn) { try { await fn(); } catch (e) { console.error('[ABA init]', e.message); } }

  } catch (e) {
    el.innerHTML = `<div class="card" style="text-align:center; color:var(--tinta-2); padding:30px;">
      ${e.message || 'Não consegui carregar esta aba.'}</div>`;
  }
}

// ------------------------------------------------------------
// Barra de abas com estado na URL
// ------------------------------------------------------------
// `?aba=placar` sobrevive ao refresh e pode ser mandada por link. Sem isso,
// recarregar a página joga a pessoa de volta na primeira aba — e ela perde onde
// estava toda vez que o sistema atualiza.
function montarAbas({ abas, container, barra, features = {} }) {
  const visiveis = abas.filter((a) => !a.feature || features[a.feature]);
  if (!visiveis.length) return;

  const inicial = new URLSearchParams(location.search).get('aba');
  let atual = visiveis.find((a) => a.id === inicial) ? inicial : visiveis[0].id;

  const barraEl = typeof barra === 'string' ? document.getElementById(barra) : barra;

  function pintar() {
    barraEl.innerHTML = visiveis.map((a) =>
      `<span class="aba ${a.id === atual ? 'ativa' : ''}" data-aba="${a.id}">${a.txt}</span>`).join('');
    barraEl.querySelectorAll('.aba').forEach((el) => {
      el.onclick = () => trocar(el.dataset.aba);
    });
  }

  function trocar(id) {
    const aba = visiveis.find((a) => a.id === id);
    if (!aba) return;
    atual = id;
    pintar();
    // replaceState e não pushState: cada troca de aba virando uma entrada no
    // histórico faria o botão "voltar" percorrer abas em vez de sair da página.
    const u = new URL(location);
    u.searchParams.set('aba', id);
    history.replaceState(null, '', u);
    carregarAba(container, aba.arquivo, { init: aba.init });
  }

  pintar();
  trocar(atual);
}
