// Trocas / Devoluções — toda lógica de UI

document.addEventListener('DOMContentLoaded', () => {
  montarLayout('trocas');
  setupAbas();
  setupRegistrarTroca();
  setupHistorico();
  setupVales();

  // Carregar venda se vem com parâmetro
  const vParam = new URLSearchParams(location.search).get('venda');
  if (vParam) {
    document.getElementById('vendaNum').value = vParam;
    buscarVenda();
  }
});

// ===== GERENCIAMENTO DE ABAS =====
function setupAbas() {
  document.querySelectorAll('.aba').forEach(aba => {
    aba.addEventListener('click', function() {
      mudarAba(this.getAttribute('data-aba'));
    });
  });
}

function mudarAba(aba) {
  document.querySelectorAll('.aba').forEach(e => e.classList.remove('ativa'));
  document.querySelectorAll('.aba-conteudo').forEach(e => e.classList.remove('ativa'));
  document.querySelector(`[data-aba="${aba}"]`).classList.add('ativa');
  document.getElementById('abas-' + aba).classList.add('ativa');

  if (aba === 'historico') carregarHistorico();
  if (aba === 'vales') carregarVales();
}

// ===== REGISTRAR TROCA =====
let venda = null;
let devolvidos = [];
let levados = [];
let prodBusca = [];
let variacoesPorProd = {};
let prazoExpirado = false;

function setupRegistrarTroca() {
  document.getElementById('buscarVendaBtn').addEventListener('click', buscarVenda);
  document.getElementById('buscaProd').addEventListener('input', () => {
    clearTimeout(buscaTimer);
    buscaTimer = setTimeout(buscarProd, 250);
  });
  document.getElementById('btnFinalizar').addEventListener('click', finalizar);
  document.getElementById('forcarPrazo')?.addEventListener('change', atualizarTravaPrazo);
}

let buscaTimer = null;

async function buscarVenda() {
  const n = document.getElementById('vendaNum').value;
  if (!n) return;
  try {
    venda = await api('/vendas/' + n);
    let prazo = { dentro_prazo: true, dias_passados: 0, prazo: 7 };
    try {
      prazo = await api('/trocas/prazo/' + venda.id);
    } catch (e) {}
    prazoExpirado = !prazo.dentro_prazo;

    const avisoPrazo = prazoExpirado
      ? `<div class="card" style="background:#fde8e8; border:1px solid var(--vermelho,#c62828); margin:8px 0;">
           <strong class="texto-vermelho">⛔ Fora do prazo de troca</strong>
           <div style="font-size:0.88rem; margin-top:4px;">Esta compra foi há <strong>${prazo.dias_passados} dias úteis</strong> (limite: ${prazo.prazo}). A troca está bloqueada.</div>
           <label style="display:flex; align-items:center; gap:8px; cursor:pointer; margin-top:8px; font-size:0.88rem;">
             <input type="checkbox" id="forcarPrazo" style="width:18px;height:18px;flex:none;">
             <span>Autorizar exceção (ex: defeito de fábrica) — sob minha responsabilidade</span>
           </label>
         </div>`
      : `<div class="texto-verde" style="font-size:0.85rem; margin:4px 0;">✓ Dentro do prazo (${prazo.dias_passados} de ${prazo.prazo} dias úteis)</div>`;

    document.getElementById('infoVenda').innerHTML = `
      <div class="texto-cinza">Venda #${venda.id} • ${venda.data_hora.slice(0, 10).split('-').reverse().join('/')}
        • ${esc(venda.cliente_nome || 'sem cliente')} • ${moeda(venda.total)}</div>
      ${avisoPrazo}
      <p class="mt">Marque abaixo as peças desta venda que estão voltando:</p>
      <div class="lista-busca">${venda.itens.map((it, idx) => `
        <div class="item">
          <label style="display:flex; align-items:center; gap:8px; cursor:pointer;">
            <input type="checkbox" style="width:auto;" data-idx="${idx}">
            <span>${esc(it.descricao)} — <strong>${moeda(it.preco_unit)}</strong>${it.qtd > 1 ? ' (x' + it.qtd + ')' : ''}
            </span>
          </label>
        </div>`).join('')}</div>`;

    // Attach listeners to checkboxes
    document.querySelectorAll('#infoVenda input[type="checkbox"]').forEach(cb => {
      cb.addEventListener('change', function() {
        const idx = parseInt(this.getAttribute('data-idx'));
        toggleDevolvido(idx, this.checked);
      });
    });

    const forcarPrazoEl = document.getElementById('forcarPrazo');
    if (forcarPrazoEl) {
      forcarPrazoEl.addEventListener('change', atualizarTravaPrazo);
    }

    atualizarTravaPrazo();
  } catch (e) {
    document.getElementById('infoVenda').innerHTML = `<div class="texto-vermelho">${e.message}</div>`;
    venda = null;
    prazoExpirado = false;
  }
}

function atualizarTravaPrazo() {
  const forcar = document.getElementById('forcarPrazo');
  const bloqueado = prazoExpirado && (!forcar || !forcar.checked);
  const btn = document.getElementById('btnFinalizar');
  if (btn) {
    btn.disabled = bloqueado;
    btn.style.opacity = bloqueado ? '0.5' : '';
    btn.style.cursor = bloqueado ? 'not-allowed' : '';
  }
}

function toggleDevolvido(idx, marcado) {
  const it = venda.itens[idx];
  const key = it.variacao_id + '-' + idx;
  if (marcado) {
    devolvidos.push({
      _key: key, variacao_id: it.variacao_id, produto_id: it.produto_id,
      descricao: it.descricao, qtd: it.qtd, valor_unit: it.preco_unit
    });
  } else {
    devolvidos = devolvidos.filter(d => d._key !== key);
  }
  renderDevolvidos();
}

function renderDevolvidos() {
  const el = document.getElementById('devolvidos');
  el.innerHTML = devolvidos.length === 0
    ? '<div class="texto-cinza">Nenhuma peça marcada para devolução.</div>'
    : devolvidos.map((d, i) => `<div class="item-linha">
        <span class="desc">${esc(d.descricao)}</span>
        <span class="dinheiro">${moeda(d.valor_unit)} × ${d.qtd}</span>
        <button class="btn btn-fino btn-vermelho" onclick="removeDev(${i})">remover</button>
      </div>`).join('');
  recalcular();
}

function removeDev(i) {
  devolvidos.splice(i, 1);
  renderDevolvidos();
}

async function buscarProd() {
  const b = document.getElementById('buscaProd').value.trim();
  if (!b) {
    document.getElementById('listaProd').innerHTML = '';
    return;
  }
  const prods = await api('/produtos?busca=' + encodeURIComponent(b));
  prodBusca = prods;
  document.getElementById('listaProd').innerHTML = prods.length === 0
    ? '<div class="texto-cinza" style="padding:8px;">Nenhuma peça.</div>'
    : prods.map((p, pi) => `<div class="item" style="display:block;">
        <div class="flex-entre"><strong>${esc(p.nome)}</strong> <span class="dinheiro">${moeda(p.preco_venda)}</span></div>
        <div id="grade-${pi}"></div>
      </div>`).join('');
  for (let pi = 0; pi < prods.length; pi++) {
    const p = prods[pi];
    const vars = await api('/estoque?produto=' + p.id).catch(() => ([]));
    variacoesPorProd[p.id] = vars;
    const html = vars.map((g, gi) => `<span class="tam-chip ${g.quantidade <= 0 ? 'zerado' : ''}"
          ${g.quantidade > 0 ? `onclick="addLevado(${pi}, ${g.variacao_id})"` : ''}>
          ${esc(g.tamanho)} <small>(${g.quantidade})</small></span>`).join('');
    document.getElementById('grade-' + pi).innerHTML = html;
  }
}

function addLevado(pi, varId) {
  const p = prodBusca[pi];
  if (!p) return;
  const vars = variacoesPorProd[p.id] || [];
  const var_sel = vars.find(v => v.variacao_id === varId);
  const tamanho = var_sel ? var_sel.tamanho : '';
  const descricao = `${p.nome}${tamanho ? ' (' + tamanho + ')' : ''}`;
  const ex = levados.find(l => l.variacao_id === varId);
  if (ex) ex.qtd++;
  else levados.push({ variacao_id: varId, produto_id: p.id, descricao, qtd: 1, valor_unit: p.preco_venda });
  document.getElementById('buscaProd').value = '';
  document.getElementById('listaProd').innerHTML = '';
  renderLevados();
}

function renderLevados() {
  const el = document.getElementById('levados');
  el.innerHTML = levados.length === 0
    ? '<div class="texto-cinza">Nenhuma peça adicionada.</div>'
    : levados.map((l, i) => `<div class="item-linha">
        <span class="desc">${esc(l.descricao)}</span>
        <span class="dinheiro">${moeda(l.valor_unit)} × ${l.qtd}</span>
        <button class="btn btn-fino btn-vermelho" onclick="removeLev(${i})">remover</button>
      </div>`).join('');
  recalcular();
}

function removeLev(i) {
  levados.splice(i, 1);
  renderLevados();
}

function recalcular() {
  const vDev = devolvidos.reduce((s, d) => s + d.valor_unit * d.qtd, 0);
  const vLev = levados.reduce((s, l) => s + l.valor_unit * l.qtd, 0);
  const dif = +(vLev - vDev).toFixed(2);
  document.getElementById('rDev').textContent = moeda(vDev);
  document.getElementById('rLev').textContent = moeda(vLev);
  document.getElementById('rDif').textContent = moeda(Math.abs(dif));
  const lbl = document.getElementById('rDifLabel');
  const areaPag = document.getElementById('areaFormaDif');
  if (dif > 0) {
    lbl.textContent = 'Cliente paga (será registrado como venda)';
    areaPag.style.display = 'block';
  } else if (dif < 0) {
    lbl.innerHTML = '🎟️ Cliente recebe Vale-crédito';
    areaPag.style.display = 'none';
  } else {
    lbl.textContent = 'Sem diferença';
    areaPag.style.display = 'none';
  }
}

async function finalizar() {
  if (devolvidos.length === 0 && levados.length === 0) {
    toast('Marque o que volta e/ou o que sai', 'erro');
    return;
  }
  const forcar = document.getElementById('forcarPrazo');
  if (prazoExpirado && (!forcar || !forcar.checked)) {
    toast('Troca fora do prazo (7 dias úteis). Marque a autorização de exceção pra prosseguir.', 'erro');
    return;
  }
  const dif = +(levados.reduce((s, l) => s + l.valor_unit * l.qtd, 0) - devolvidos.reduce((s, d) => s + d.valor_unit * d.qtd, 0)).toFixed(2);
  const body = {
    venda_id: venda ? venda.id : null,
    devolvidos: devolvidos.map(d => ({ variacao_id: d.variacao_id, produto_id: d.produto_id, descricao: d.descricao, qtd: d.qtd, valor_unit: d.valor_unit })),
    levados: levados.map(l => ({ variacao_id: l.variacao_id, qtd: l.qtd })),
    forma_pagamento: dif > 0 ? document.getElementById('formaDif').value : (dif < 0 ? 'vale' : null),
    obs: document.getElementById('obsTroca').value || null,
    forcar_excecao: prazoExpirado && forcar && forcar.checked,
  };
  try {
    const r = await api('/trocas', { method: 'POST', body });
    if (r.vale && r.vale.codigo) {
      toast(`Vale-crédito gerado: ${r.vale.codigo}`, 'sucesso');
      setTimeout(() => {
        window.location.href = 'cupom-vale.html?codigo=' + r.vale.codigo;
      }, 1000);
    } else {
      toast('Troca registrada', 'sucesso');
      devolvidos = [];
      levados = [];
      document.getElementById('vendaNum').value = '';
      document.getElementById('infoVenda').innerHTML = '';
      document.getElementById('devolvidos').innerHTML = '<div class="texto-cinza">Nenhuma peça marcada para devolução.</div>';
      document.getElementById('levados').innerHTML = '<div class="texto-cinza">Nenhuma peça adicionada.</div>';
      recalcular();
    }
  } catch (e) {
    toast(e.message, 'erro');
  }
}

// ===== HISTÓRICO =====
let dadosHist = [];

function setupHistorico() {
  document.getElementById('filtroDE')?.addEventListener('change', carregarHistorico);
  document.getElementById('filtroATE')?.addEventListener('change', carregarHistorico);
  document.getElementById('buscaHist')?.addEventListener('input', renderHistorico);
  document.getElementById('exportarHistoricoBTN')?.addEventListener('click', exportarHistorico);
  document.getElementById('modalTroca')?.addEventListener('click', (e) => {
    if (e.target.id === 'modalTroca') fecharModal();
  });
}

async function carregarHistorico() {
  const de = document.getElementById('filtroDE').value;
  const ate = document.getElementById('filtroATE').value;
  let url = '/trocas';
  if (de || ate) {
    url += '?';
    if (de) url += 'de=' + de;
    if (de && ate) url += '&';
    if (ate) url += 'ate=' + ate;
  }
  const resp = await api(url);
  dadosHist = resp || [];
  renderHistorico();
}

function renderHistorico() {
  const b = document.getElementById('buscaHist').value.toLowerCase();
  const arr = dadosHist.filter(t => {
    const clienteMatch = !b || (t.cliente_nome && t.cliente_nome.toLowerCase().includes(b));
    const vendaMatch = !b || (t.venda_id && String(t.venda_id).includes(b));
    return clienteMatch || vendaMatch;
  });
  const div = document.getElementById('listaHist');
  if (arr.length === 0) {
    div.innerHTML = '<tr><td colspan="8" style="text-align:center; padding:32px;">Nenhuma troca encontrada.</td></tr>';
    return;
  }
  div.innerHTML = arr.map(t => `
    <tr style="cursor:pointer;" onclick="verDetalhes(${t.id})">
      <td class="data">${t.data_hora.slice(0, 10).split('-').reverse().join('/')}<br><span class="texto-cinza" style="font-size:0.85rem;">${t.data_hora.slice(11, 16)}</span></td>
      <td>#${t.venda_id || '—'}</td>
      <td>${t.cliente_nome ? esc(t.cliente_nome) : '<em>não identificado</em>'}</td>
      <td class="moeda">${moeda(t.valor_devolvido)}</td>
      <td class="moeda">${moeda(t.valor_levado)}</td>
      <td class="moeda" style="color:${t.diferenca > 0 ? '#e74c3c' : t.diferenca < 0 ? '#27ae60' : '#999'};">
        ${t.diferenca > 0 ? '+' : ''}${moeda(t.diferenca)}
      </td>
      <td><span class="status-badge ${t.cancelada ? 'status-cancelada' : 'status-ativa'}">${t.cancelada ? 'Cancelada' : 'Ativa'}</span></td>
      <td style="text-align:center;">›</td>
    </tr>`).join('');
}

async function verDetalhes(id) {
  const t = await api('/trocas/' + id);
  document.getElementById('trocaTitulo').textContent = `Troca #${t.id}`;

  const itens = t.itens || [];
  const devolvidosList = itens.filter(it => it.tipo === 'devolvido');
  const levadosList = itens.filter(it => it.tipo === 'levado');

  const formatoStatus = t.cancelada
    ? '<span class="status-badge status-cancelada">Cancelada</span>'
    : '<span class="status-badge status-ativa">Ativa</span>';

  const formaLabel = {
    'dinheiro': '💵 Dinheiro',
    'pix': '📱 Pix',
    'debito': '💳 Débito',
    'credito_vista': '💳 Crédito à vista',
    'vale': '🎟️ Vale-crédito'
  };

  document.getElementById('trocaDetalhes').innerHTML = `
    <div style="padding:0;">
      <div style="padding:12px 0; border-bottom:1px solid #EEE; margin-bottom:12px;">
        <div style="font-size:0.9rem; color:#666;">
          ${t.data_hora.slice(0, 10).split('-').reverse().join('/')} às ${t.data_hora.slice(11, 16)}
        </div>
      </div>

      <div style="display:grid; grid-template-columns:1fr 1fr; gap:16px; margin-bottom:16px;">
        <div>
          <strong style="color:#666; font-size:0.85rem;">Venda de origem</strong>
          <div style="margin-top:4px;">${t.venda_id ? '#' + t.venda_id : '—'}</div>
        </div>
        <div>
          <strong style="color:#666; font-size:0.85rem;">Status</strong>
          <div style="margin-top:4px;">${formatoStatus}</div>
        </div>
      </div>

      ${devolvidosList.length > 0 ? `
      <div style="border:1px solid #EEE; border-radius:6px; padding:12px; margin-bottom:16px;">
        <strong style="display:block; margin-bottom:8px;">Peças devolvidas</strong>
        <table style="width:100%; font-size:0.9rem;">
          <thead style="background:#f5f5f5;">
            <tr>
              <th style="text-align:left; padding:6px;">PEÇA</th>
              <th style="text-align:center; padding:6px;">QTD</th>
              <th style="text-align:right; padding:6px;">VALOR UNIT.</th>
            </tr>
          </thead>
          <tbody>
            ${devolvidosList.map(i => `
              <tr style="border-bottom:1px solid #EEE;">
                <td style="padding:6px;">${esc(i.descricao || '—')}</td>
                <td style="text-align:center; padding:6px;">${i.qtd}</td>
                <td style="text-align:right; padding:6px;">${moeda(i.valor_unit)}</td>
              </tr>
            `).join('')}
          </tbody>
        </table>
      </div>
      ` : ''}

      ${levadosList.length > 0 ? `
      <div style="border:1px solid #EEE; border-radius:6px; padding:12px; margin-bottom:16px;">
        <strong style="display:block; margin-bottom:8px;">Peças levadas</strong>
        <table style="width:100%; font-size:0.9rem;">
          <thead style="background:#f5f5f5;">
            <tr>
              <th style="text-align:left; padding:6px;">PEÇA</th>
              <th style="text-align:center; padding:6px;">QTD</th>
              <th style="text-align:right; padding:6px;">VALOR UNIT.</th>
            </tr>
          </thead>
          <tbody>
            ${levadosList.map(i => `
              <tr style="border-bottom:1px solid #EEE;">
                <td style="padding:6px;">${esc(i.descricao || '—')}</td>
                <td style="text-align:center; padding:6px;">${i.qtd}</td>
                <td style="text-align:right; padding:6px;">${moeda(i.valor_unit)}</td>
              </tr>
            `).join('')}
          </tbody>
        </table>
      </div>
      ` : ''}

      <div style="border:1px solid #EEE; border-radius:6px; padding:12px; margin-bottom:16px; font-size:0.9rem;">
        <div style="display:flex; justify-content:space-between; margin-bottom:8px;">
          <span>Valor devolvido:</span>
          <strong>${moeda(t.valor_devolvido)}</strong>
        </div>
        <div style="display:flex; justify-content:space-between; margin-bottom:8px;">
          <span>Valor levado:</span>
          <strong>${moeda(t.valor_levado)}</strong>
        </div>
        <div style="border-top:1px solid #EEE; padding-top:8px; display:flex; justify-content:space-between; font-weight:700; font-size:1rem;">
          <span>${t.diferenca > 0 ? 'Cliente paga' : t.diferenca < 0 ? 'Cliente recebe' : 'Sem diferença'}</span>
          <strong style="color:${t.diferenca > 0 ? '#e74c3c' : t.diferenca < 0 ? '#27ae60' : '#999'};">
            ${t.diferenca > 0 ? '+' : ''}${moeda(t.diferenca)}
          </strong>
        </div>
        ${t.forma_pagamento_diferenca ? `
        <div style="margin-top:8px; padding-top:8px; border-top:1px solid #EEE; display:flex; justify-content:space-between;">
          <span>Forma:</span>
          <strong>${formaLabel[t.forma_pagamento_diferenca] || t.forma_pagamento_diferenca}</strong>
        </div>
        ` : ''}
      </div>

      ${t.obs ? `
      <div style="background:#f5f5f5; padding:12px; border-radius:6px; margin-bottom:16px; font-size:0.9rem;">
        <strong style="display:block; margin-bottom:4px;">Observação</strong>
        <div>${esc(t.obs)}</div>
      </div>
      ` : ''}

      ${t.diferenca < 0 ? `
      <div style="border:2px solid #FFC107; border-radius:6px; padding:12px; margin-bottom:16px; background:#FFFBF0;">
        <strong style="display:block; margin-bottom:8px; color:#F39C12;">🎟️ Vale-crédito gerado</strong>
        <div style="font-size:0.9rem;">
          <div style="display:flex; justify-content:space-between; margin-bottom:6px;">
            <span>Valor:</span>
            <strong style="color:#27ae60;">${moeda(Math.abs(t.diferenca))}</strong>
          </div>
          <div style="display:flex; justify-content:space-between; margin-bottom:6px;">
            <span>Código:</span>
            <strong style="font-family:monospace; background:#fff; padding:4px 8px; border-radius:3px; border:1px solid #FFC107;">${t.vale_codigo || '—'}</strong>
          </div>
          <div style="display:flex; justify-content:space-between; margin-bottom:6px;">
            <span>Gerado em:</span>
            <strong>${t.data_hora.slice(0, 10).split('-').reverse().join('/')}</strong>
          </div>
          <div style="display:flex; justify-content:space-between; margin-bottom:12px;">
            <span>Status:</span>
            <strong style="color:#27ae60;">✓ Ativo (válido por 30 dias)</strong>
          </div>
          ${t.vale_codigo ? `<button class="btn" onclick="window.location.href='cupom-vale.html?codigo=${t.vale_codigo}';" style="width:100%; background:#F39C12; color:white; margin-bottom:8px;">📋 Reimprimir comprovante</button>` : ''}
          <div style="font-size:0.85rem; color:#666; background:white; padding:8px; border-radius:4px; border-left:3px solid #FFC107;">
            <strong>📌 Dica:</strong> Copie o código acima e use no PDV para aplicar como desconto, ou clique em "Reimprimir" para gerar o comprovante novamente.
          </div>
        </div>
      </div>
      ` : ''}

      ${!t.cancelada ? `
      <button class="btn" style="background:#E74C3C; color:white; width:100%;" onclick="cancelarTroca(${t.id})">🗑️ Cancelar troca</button>
      ` : ''}
    </div>
  `;
  document.getElementById('modalTroca').classList.add('aberto');
}

async function cancelarTroca(id) {
  if (!confirm('Tem certeza? Isso vai reverter o estoque e o caixa.')) return;
  try {
    await api('/trocas/' + id + '/cancelar', { method: 'PATCH', body: {} });
    toast('Troca cancelada com sucesso', 'sucesso');
    fecharModal();
    carregarHistorico();
  } catch (e) {
    toast(e.message, 'erro');
  }
}

function fecharModal() {
  document.getElementById('modalTroca').classList.remove('aberto');
}

function exportarHistorico() {
  if (!dadosHist.length) {
    toast('Nada para exportar', 'erro');
    return;
  }
  const linhas = dadosHist.map(t => ({
    ID: t.id, 'Venda #': t.venda_id || '', Data: t.data_hora.slice(0, 10),
    Hora: t.data_hora.slice(11, 16), 'Valor Devolvido': t.valor_devolvido,
    'Valor Levado': t.valor_levado, Diferença: t.diferenca,
    Cliente: t.cliente_nome || '', Forma: t.forma_pagamento_diferenca || '', Status: t.cancelada ? 'Cancelada' : 'Ativa'
  }));
  exportarCSV('historico-trocas-' + hojeLocalStr(), linhas);
}

// ===== VALES =====
let dadosVales = [];

function setupVales() {
  document.getElementById('filtrarValesBTN')?.addEventListener('click', carregarVales);
  document.getElementById('buscaVale')?.addEventListener('input', renderVales);
  document.getElementById('exportarValesBTN')?.addEventListener('click', exportarVales);
}

async function carregarVales() {
  try {
    const status = document.getElementById('filtroValeStatus').value;
    let url = '/vales';
    if (status && status !== 'todos') {
      url += '?status=' + status;
    }
    dadosVales = await api(url);
    renderVales();
  } catch (e) {
    toast(e.message, 'erro');
    dadosVales = [];
    renderVales();
  }
}

function renderVales() {
  const b = document.getElementById('buscaVale').value.toLowerCase();
  const arr = dadosVales.filter(v => {
    const codigoMatch = !b || (v.codigo && v.codigo.toLowerCase().includes(b));
    const clienteMatch = !b || (v.cliente_nome && v.cliente_nome.toLowerCase().includes(b));
    return codigoMatch || clienteMatch;
  });
  const div = document.getElementById('listaVales');
  if (arr.length === 0) {
    div.innerHTML = '<tr><td colspan="7" style="text-align:center; padding:32px;">Nenhum vale encontrado.</td></tr>';
    return;
  }
  div.innerHTML = arr.map(v => {
    const statusBadge = statusVale(v);
    return `<tr>
      <td style="font-family:monospace; font-weight:600;">${esc(v.codigo)}</td>
      <td>${v.cliente_nome ? esc(v.cliente_nome) : '<em>—</em>'}</td>
      <td class="moeda">${moeda(v.valor)}</td>
      <td class="moeda" style="color:${v.saldo > 0 ? '#27ae60' : '#999'};">${moeda(v.saldo)}</td>
      <td>${v.validade ? v.validade.slice(0, 10).split('-').reverse().join('/') : '—'}</td>
      <td><span class="status-badge ${statusBadge.classe}">${statusBadge.texto}</span></td>
      <td style="text-align:center;"><button class="btn btn-fino" onclick="window.location.href='cupom-vale.html?codigo=${esc(v.codigo)}';">📋</button></td>
    </tr>`;
  }).join('');
}

function statusVale(v) {
  if (!v.ativo) return { texto: 'Inativo', classe: 'status-cancelada' };
  if (v.venda_utilizacao_id) return { texto: 'Utilizado', classe: 'status-cancelada' };
  const hoje = new Date().toISOString().split('T')[0];
  if (v.validade && v.validade < hoje) return { texto: 'Expirado', classe: 'status-cancelada' };
  return { texto: 'Ativo', classe: 'status-ativa' };
}

function exportarVales() {
  if (!dadosVales.length) {
    toast('Nada para exportar', 'erro');
    return;
  }
  const linhas = dadosVales.map(v => {
    const sb = statusVale(v);
    return {
      Código: v.codigo,
      Cliente: v.cliente_nome || '',
      'Valor (R$)': v.valor.toFixed(2),
      'Saldo (R$)': v.saldo.toFixed(2),
      'Validade': v.validade ? v.validade.slice(0, 10).split('-').reverse().join('/') : '',
      'Status': sb.texto,
      'Utilizado em': v.venda_utilizacao_id ? 'Venda #' + v.venda_utilizacao_id : ''
    };
  });
  exportarCSV('vales-' + hojeLocalStr(), linhas);
}
