/**
 * config.js
 * Extraído de: public/config.html
 * Data: 2026-07-03
 *
 * Contém toda a lógica de configurações da loja (identidade visual, dados cadastrais,
 * precificação, taxas, NFC-e, categorias, coleções, certificado A1, tokens Focus).
 *
 * Dependências: comum.js (para montarLayout, api, toast, esc, etc)
 */

montarLayout('config');

// Estrutura de campos por seção (substitui arrays CAMPOS/CAMPOS_TEXTO antigos)
const CAMPOS_CONFIG = {
  marca: [ { id: 'marca_cor', tipo: 'texto' } ],
  loja: [
    { id: 'loja_nome', tipo: 'texto' }, { id: 'loja_endereco', tipo: 'texto' },
    { id: 'loja_telefone', tipo: 'texto' }, { id: 'loja_instagram', tipo: 'texto' },
  ],
  cupom: [
    { id: 'cupom_auto_imprimir', tipo: 'checkbox_invertido' },
    { id: 'cupom_mensagem_rodape', tipo: 'texto' }, { id: 'cupom_politica_troca', tipo: 'texto' },
  ],
  catalogo: [],
  vitrine: [
    { id: 'vitrine_ativa', tipo: 'checkbox' }, { id: 'vitrine_frase', tipo: 'texto' },
    { id: 'loja_whatsapp', tipo: 'texto' }, { id: 'loja_whatsapp_link', tipo: 'texto' },
    { id: 'loja_instagram_url', tipo: 'texto' }, { id: 'loja_maps', tipo: 'texto' },
  ],
  fiscal: [
    { id: 'loja_razao_social', tipo: 'texto' }, { id: 'loja_nome_fantasia', tipo: 'texto' },
    { id: 'loja_cnpj', tipo: 'texto' }, { id: 'loja_ie', tipo: 'texto' }, { id: 'loja_regime', tipo: 'texto' },
    { id: 'loja_cep', tipo: 'texto' }, { id: 'loja_cidade', tipo: 'texto' }, { id: 'loja_uf', tipo: 'texto' },
    { id: 'nfce_ativo', tipo: 'checkbox' }, { id: 'nfce_ambiente', tipo: 'texto' },
    { id: 'nfce_serie', tipo: 'texto' }, { id: 'nfce_csc_id', tipo: 'texto' },
    { id: 'nfce_ncm_padrao', tipo: 'texto' }, { id: 'nfce_cfop_padrao', tipo: 'texto' },
    { id: 'nfce_csosn_padrao', tipo: 'texto' }, { id: 'nfce_origem_padrao', tipo: 'texto' },
    { id: 'nfce_unidade_padrao', tipo: 'texto' }, { id: 'loja_codigo_municipio', tipo: 'texto' },
  ],
  precos: [
    { id: 'meta_mensal', tipo: 'numero' }, { id: 'markup', tipo: 'numero' },
    { id: 'embalagem_unit', tipo: 'numero' }, { id: 'frete_unit', tipo: 'numero' },
    { id: 'regime_fiscal', tipo: 'texto' }, { id: 'imposto_simples', tipo: 'numero' },
    { id: 'comissao_padrao', tipo: 'numero' },
  ],
  maquininha: [
    { id: 'taxa_pix', tipo: 'numero' }, { id: 'taxa_debito', tipo: 'numero' },
    { id: 'taxa_credito_vista', tipo: 'numero' },
    { id: 'taxa_credito_2x', tipo: 'numero' }, { id: 'taxa_credito_3x', tipo: 'numero' },
    { id: 'taxa_credito_4x', tipo: 'numero' }, { id: 'taxa_credito_5x', tipo: 'numero' },
    { id: 'taxa_credito_6x', tipo: 'numero' }, { id: 'parcelas_loja_absorve', tipo: 'numero' },
    { id: 'prazo_debito_dias', tipo: 'numero' }, { id: 'prazo_debito_tipo', tipo: 'texto' },
    { id: 'prazo_credito_vista_dias', tipo: 'numero' }, { id: 'prazo_credito_vista_tipo', tipo: 'texto' },
    { id: 'prazo_credito_parc_dias', tipo: 'numero' }, { id: 'prazo_credito_parc_tipo', tipo: 'texto' },
  ],
};

let CFG_CACHE = {};

function preencherCampo(campo, valor) {
  const el = document.getElementById(campo.id);
  if (!el || valor == null) return;
  if (campo.tipo === 'checkbox') el.checked = (valor === '1');
  else if (campo.tipo === 'checkbox_invertido') el.checked = (valor === '0');
  else el.value = valor;
}

function lerCampo(campo) {
  const el = document.getElementById(campo.id);
  if (!el) return null;
  if (campo.tipo === 'checkbox' || campo.tipo === 'checkbox_invertido') return el.checked ? '1' : '0';
  if (campo.tipo === 'numero') return el.value || '0';
  return el.value;
}

async function carregarTudo() {
  CFG_CACHE = await api('/config');
  Object.keys(CAMPOS_CONFIG).forEach(secao => CAMPOS_CONFIG[secao].forEach(c => preencherCampo(c, CFG_CACHE[c.id])));
  aplicarCorNaTela(CFG_CACHE.marca_cor || '#1a6f5e');
  mostrarLogo(CFG_CACHE.loja_logo || '');
  await carregarCategorias_config();
  await carregarColecoes_config();
  preencherSlugEVitrine(CFG_CACHE);
  checarNfce();
}

async function salvarSecao(nomeSecao) {
  const campos = CAMPOS_CONFIG[nomeSecao];
  if (!campos) return;
  const body = {};
  campos.forEach(c => { body[c.id] = lerCampo(c); });
  try {
    await api('/config', { method: 'POST', body });
    toast('Seção salva', 'sucesso');
    if (nomeSecao === 'fiscal') checarNfce();
  } catch (e) { toast(e.message, 'erro'); }
}

async function carregar() {
  await carregarTudo();
}

// ---------- Identidade visual: logo + cor ----------
function mostrarLogo(caminho) {
  const box = document.getElementById('logoPreview');
  const btnRem = document.getElementById('btnRemoverLogo');
  if (caminho) {
    box.innerHTML = `<img src="${esc(caminho)}?t=${Date.now()}" style="width:100%; height:100%; object-fit:contain;">`;
    btnRem.style.display = '';
  } else {
    box.innerHTML = '<span class="texto-cinza" style="font-size:0.72rem; text-align:center;">sem logo</span>';
    btnRem.style.display = 'none';
  }
}

async function enviarLogo(input) {
  const file = input.files && input.files[0];
  if (!file) return;
  if (file.size > 2 * 1024 * 1024) { toast('A imagem precisa ter até 2MB','erro'); input.value=''; return; }
  const dataUrl = await new Promise((res, rej) => {
    const r = new FileReader(); r.onload = () => res(r.result); r.onerror = rej; r.readAsDataURL(file);
  });
  try {
    const resp = await api('/config/logo', { method:'POST', body:{ logo: dataUrl } });
    mostrarLogo(resp.loja_logo);
    toast('Logo atualizada 🎨','sucesso');
  } catch (e) { toast(e.message,'erro'); }
  input.value = '';
}

async function removerLogo() {
  if (!confirm('Remover a logo? Volta a mostrar o nome da loja em texto.')) return;
  try { await api('/config/logo', { method:'DELETE' }); mostrarLogo(''); toast('Logo removida'); }
  catch (e) { toast(e.message,'erro'); }
}

// sincroniza os dois campos de cor (o seletor e o hex digitado) + preview ao vivo
function previewCor(v) {
  document.getElementById('marca_cor_hex').value = v;
  document.documentElement.style.setProperty('--marca', v);
}

function sincCorHex(v) {
  if (/^#[0-9a-fA-F]{6}$/.test(v)) {
    document.getElementById('marca_cor').value = v;
    document.documentElement.style.setProperty('--marca', v);
  }
}

async function restaurarPadrao() {
  if (!confirm('Restaurar logo e cor padrão do EasyGestão?')) return;
  try {
    await api('/config/logo', { method: 'DELETE' });
    await api('/config', { method: 'POST', body: { marca_cor: '#1a6f5e' } });
    invalidarCacheMarca();
    document.getElementById('marca_cor').value = '#1a6f5e';
    document.getElementById('marca_cor_hex').value = '#1a6f5e';
    previewCor('#1a6f5e');
    mostrarLogo('');
    toast('Padrão restaurado Recarregue para ver a mudança na sidebar.', 'sucesso');
  } catch (e) { toast(e.message, 'erro'); }
}

// ---------- Categorias de produtos ----------
let categorias = [];

async function carregarCategorias_config() {
  const cfg = await api('/config');
  try { categorias = JSON.parse(cfg.categorias || '[]'); } catch(e) { categorias = []; }
  if (!categorias.length) categorias = ['vestido','blusa','calca','short','saia','conjunto','macacao','alfaiataria','acessorio','outro'];
  renderizarCategorias();
}

function renderizarCategorias() {
  const div = document.getElementById('listaCategorias');
  div.innerHTML = categorias.map(c => `
    <div class="chip-tam" style="background:#f9fbfa; border:1px solid #e0e8e5; border-radius:6px; padding:8px 12px; display:flex; justify-content:space-between; align-items:center;">
      <span>${esc(c)}</span>
      <button class="btn btn-fino btn-vermelho" onclick="removerCategoria('${esc(c)}')" style="padding:4px 8px; font-size:0.75rem;">✕</button>
    </div>`).join('');
}

async function adicionarCategoria() {
  const input = document.getElementById('novaCategoriaInput');
  const nova = input.value.trim().toLowerCase();
  if (!nova) { toast('Digite uma categoria', 'erro'); return; }
  if (categorias.includes(nova)) { toast('Categoria já existe', 'erro'); return; }
  categorias.push(nova);
  await api('/config', { method:'POST', body: { categorias: JSON.stringify(categorias) } });
  input.value = '';
  renderizarCategorias();
  toast('Categoria adicionada 🎯', 'sucesso');
  invalidarCacheColecoes(); // invalida cache pra atualizar selects
}

async function removerCategoria(cat) {
  if (!confirm(`Remover categoria "${cat}"?`)) return;
  categorias = categorias.filter(c => c !== cat);
  await api('/config', { method:'POST', body: { categorias: JSON.stringify(categorias) } });
  renderizarCategorias();
  toast('Categoria removida', 'sucesso');
  invalidarCacheColecoes();
}

// ---------- Coleções de produtos ----------
let colecoes = [];

async function carregarColecoes_config() {
  const cfg = await api('/config');
  try { colecoes = JSON.parse(cfg.colecoes || '[]'); } catch(e) { colecoes = []; }
  renderizarColecoes();
}

function renderizarColecoes() {
  const div = document.getElementById('listaColecoes');
  div.innerHTML = colecoes.length === 0 ? '<div class="texto-cinza">Nenhuma coleção cadastrada</div>' :
    colecoes.map(c => `
    <div class="chip-tam" style="background:#f9fbfa; border:1px solid #e0e8e5; border-radius:6px; padding:8px 12px; display:flex; justify-content:space-between; align-items:center;">
      <span>${esc(c)}</span>
      <button class="btn btn-fino btn-vermelho" onclick="removerColecao('${esc(c)}')" style="padding:4px 8px; font-size:0.75rem;">✕</button>
    </div>`).join('');
}

async function adicionarColecao() {
  const input = document.getElementById('novaColecaoInput');
  const nova = input.value.trim();
  if (!nova) { toast('Digite uma coleção', 'erro'); return; }
  if (colecoes.includes(nova)) { toast('Coleção já existe', 'erro'); return; }
  colecoes.push(nova);
  await api('/config', { method:'POST', body: { colecoes: JSON.stringify(colecoes) } });
  input.value = '';
  renderizarColecoes();
  toast('Coleção adicionada 📦', 'sucesso');
  invalidarCacheColecoes();
}

async function removerColecao(col) {
  if (!confirm(`Remover coleção "${col}"?`)) return;
  colecoes = colecoes.filter(c => c !== col);
  await api('/config', { method:'POST', body: { colecoes: JSON.stringify(colecoes) } });
  renderizarColecoes();
  toast('Coleção removida', 'sucesso');
  invalidarCacheColecoes();
}

async function salvar() {
  const body = {};
  CAMPOS.forEach(c => {
    const el = document.getElementById(c); if (!el) return;
    if (CAMPOS_TEXTO.includes(c)) {
      body[c] = el.value;
    } else if (el.type === 'checkbox') {
      body[c] = el.checked ? '1' : '0';
    } else {
      body[c] = el.value || '0';
    }
  });
  body.cupom_auto_imprimir = document.getElementById('cupom_auto_imprimir').checked ? '1' : '0';
  await api('/config', { method:'POST', body });
  toast('Configurações salvas','sucesso');
  checarNfce();
}

// Mostra se tem token salvo no banco de dados
async function checarNfce() {
  const el = document.getElementById('nfceStatus');
  if (!el) return;
  try {
    const status = await fetch('/api/config/focus-token', { credentials: 'include' }).then(r => r.json());
    const amb = document.getElementById('nfce_ambiente').value || 'producao';
    const temToken = amb === 'producao' ? status.tem_token_producao : status.tem_token_homologacao;

    if (temToken) {
      el.innerHTML = `✅ Token de <strong>${amb === 'producao' ? 'produção' : 'homologação'}</strong> configurado. Pronto pra emitir!`;
      el.style.color = 'var(--verde,#2e7d32)';
    } else {
      el.innerHTML = `⚠️ Falta adicionar o token de <strong>${amb === 'producao' ? 'produção' : 'homologação'}</strong>. Configure na seção abaixo.`;
      el.style.color = 'var(--dourado,#8a6d3b)';
    }
  } catch (e) {
    el.innerHTML = '⏳ Verificando configuração…';
    el.style.color = 'var(--cinza,#999)';
  }
}

document.getElementById('nfce_ambiente').addEventListener('change', checarNfce);

// ---------- Certificado A1 ----------
async function checarCertificado() {
  const el = document.getElementById('certStatus');
  try {
    const s = await api('/nfce/config');
    if (s.certificado_instalado) {
      el.innerHTML = `✅ Certificado instalado e válido. Vencimento: ${s.certificado_vencimento || 'não informado'}`;
      el.style.color = 'var(--verde,#2e7d32)';
      document.getElementById('btnRemoverCert').style.display = '';
    } else {
      el.innerHTML = '⚠️ Nenhum certificado instalado ainda.';
      el.style.color = 'var(--dourado,#8a6d3b)';
      document.getElementById('btnRemoverCert').style.display = 'none';
    }
  } catch (e) {
    el.innerHTML = '⚠️ Não foi possível verificar o certificado.';
    el.style.color = 'var(--cinza,#666)';
  }
}

function previewCert(input) {
  const file = input.files && input.files[0];
  if (!file) return;
  if (!file.name.endsWith('.pfx') && !file.name.endsWith('.p12')) {
    toast('Envie um arquivo .pfx ou .p12','erro');
    input.value = '';
    return;
  }
  const el = document.getElementById('certStatus');
  el.innerHTML = `📁 Arquivo selecionado: <strong>${file.name}</strong> (${(file.size / 1024).toFixed(0)}KB)`;
  el.style.color = 'var(--azul,#1976d2)';
}

async function testarCertificado() {
  const file = document.getElementById('certFile').files && document.getElementById('certFile').files[0];
  const senha = document.getElementById('certSenha').value;

  if (!file) { toast('Selecione um arquivo .pfx primeiro','erro'); return; }
  if (!senha) { toast('Informe a senha do certificado','erro'); return; }

  const reader = new FileReader();
  reader.onload = async (e) => {
    try {
      const el = document.getElementById('certStatus');
      el.innerHTML = '⏳ Testando certificado…';

      const dataUrl = e.target.result;
      const resp = await api('/config/certificado-a1', {
        method: 'POST',
        body: { certificado: dataUrl, senha }
      });

      if (resp.ok) {
        el.innerHTML = `✅ Certificado válido Vencimento: ${resp.vencimento || 'OK'}`;
        el.style.color = 'var(--verde,#2e7d32)';
        toast('Certificado salvo com segurança 🔐','sucesso');
        document.getElementById('btnRemoverCert').style.display = '';
        document.getElementById('certFile').value = '';
        document.getElementById('certSenha').value = '';
      } else {
        el.innerHTML = `❌ ${resp.erro || 'Erro ao validar certificado'}`;
        el.style.color = 'var(--vermelho,#c62828)';
        toast('Erro: ' + (resp.erro || 'Certificado inválido ou senha incorreta'),'erro');
      }
    } catch (err) {
      document.getElementById('certStatus').innerHTML = `❌ Erro: ${err.message}`;
      document.getElementById('certStatus').style.color = 'var(--vermelho,#c62828)';
      toast('Erro ao testar: ' + err.message,'erro');
    }
  };
  reader.readAsDataURL(file);
}

async function removerCertificado() {
  if (!confirm('Remover o certificado? Você não conseguirá emitir NFC-e até instalar um novo.')) return;
  try {
    await api('/config/certificado-a1', { method: 'DELETE' });
    toast('Certificado removido');
    document.getElementById('btnRemoverCert').style.display = 'none';
    checarCertificado();
  } catch (e) {
    toast('Erro ao remover: ' + e.message,'erro');
  }
}

// ---------- Token Focus NFe ----------
async function salvarTokenFocus(ambiente) {
  const inputId = `focus_token_${ambiente}`;
  const token = document.getElementById(inputId).value.trim();
  if (!token) { toast('Digite o token', 'erro'); return; }

  try {
    const resp = await fetch('/api/config/focus-token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({ token, ambiente })
    });

    const data = await resp.json();
    if (!resp.ok) {
      toast(`Erro: ${data.erro || 'Falha ao salvar'}`, 'erro');
      return;
    }

    toast(`Token de ${ambiente} salvo com segurança 🔐`, 'sucesso');
    document.getElementById(inputId).value = '';
    verificarTokensFocus();
  } catch (e) {
    console.error('Erro ao salvar token:', e);
    toast('Erro ao salvar: ' + e.message, 'erro');
  }
}

async function removerTokenFocus(ambiente) {
  if (!confirm(`Remover token de ${ambiente}?`)) return;
  try {
    const resp = await fetch(`/api/config/focus-token/${ambiente}`, {
      method: 'DELETE',
      credentials: 'include'
    });

    const data = await resp.json();
    if (!resp.ok) {
      toast(`Erro: ${data.erro || 'Falha ao remover'}`, 'erro');
      return;
    }

    toast(`Token de ${ambiente} removido`, 'sucesso');
    verificarTokensFocus();
  } catch (e) {
    console.error('Erro ao remover token:', e);
    toast('Erro ao remover: ' + e.message, 'erro');
  }
}

async function verificarTokensFocus() {
  try {
    const resp = await fetch('/api/config/focus-token', {
      credentials: 'include'
    });
    const status = await resp.json();
    document.getElementById('btnRemoverTokenHomolog').style.display = status.tem_token_homologacao ? '' : 'none';
    document.getElementById('btnRemoverTokenProd').style.display = status.tem_token_producao ? '' : 'none';
  } catch (e) {
    console.error('Erro ao verificar tokens:', e);
  }
}

// ============================================================
// VITRINE — Slug validation + links
// ============================================================
let slugAtual = '', slugValidado = { disponivel: true }, debounceSlug = null;

function preencherSlugEVitrine(cfg) {
  api('/config/slug').then(r => {
    slugAtual = r.slug || '';
    const slugInput = document.getElementById('vitrine_slug');
    if (slugInput) {
      slugInput.value = slugAtual;
      // Se slug já existe, marcar como validado
      slugValidado = { disponivel: true };
    }
    atualizarLinkVitrine();
  }).catch(() => {});
}

function agendarValidacaoSlug() {
  clearTimeout(debounceSlug);
  const statusEl = document.getElementById('slugStatus');
  if (statusEl) statusEl.textContent = '...';
  debounceSlug = setTimeout(validarSlug, 500);
}

async function validarSlug() {
  const inputSlug = document.getElementById('vitrine_slug');
  if (!inputSlug) return;
  const valor = inputSlug.value.trim().toLowerCase();
  const statusEl = document.getElementById('slugStatus'), erroEl = document.getElementById('slugErro');

  if (valor === slugAtual) {
    if (statusEl) statusEl.textContent = '';
    if (erroEl) erroEl.textContent='';
    slugValidado = {disponivel:true};
    return;
  }

  if (!/^[a-z0-9-]{3,50}$/.test(valor)) {
    if (statusEl) statusEl.textContent = '✗';
    if (erroEl) erroEl.textContent = 'Use só letras minúsculas, números e hífen (mín. 3 caracteres).';
    slugValidado = { disponivel: false };
    return;
  }

  try {
    const r = await api('/config/slug/disponivel?slug=' + encodeURIComponent(valor));
    slugValidado = r;
    if (r.disponivel) {
      if (statusEl) statusEl.textContent = '✓';
      if (erroEl) erroEl.textContent = '';
    }
    else {
      if (statusEl) statusEl.textContent = '✗';
      if (erroEl) erroEl.textContent = r.motivo === 'slug_reservado' ? 'Esse endereço é reservado pelo sistema.' : 'Esse endereço já está em uso.';
    }
  } catch (e) {
    if (statusEl) statusEl.textContent = '';
  }
}

async function salvarSecaoVitrine() {
  const inputSlug = document.getElementById('vitrine_slug');
  if (!inputSlug) return;
  const novoSlug = inputSlug.value.trim().toLowerCase();

  try {
    if (novoSlug !== slugAtual) {
      if (!slugValidado || !slugValidado.disponivel) {
        toast('Corrija o endereço da vitrine antes de salvar', 'erro');
        return;
      }
      await api('/config/slug', { method: 'PATCH', body: { slug: novoSlug } });
      slugAtual = novoSlug;
    }
    await salvarSecao('vitrine');
    atualizarLinkVitrine();
    toast('Vitrine salva', 'sucesso');
  } catch (e) {
    toast(e.message, 'erro');
  }
}

function atualizarLinkVitrine() {
  const btnVitrine = document.getElementById('btnVerVitrine');
  if (btnVitrine) {
    btnVitrine.onclick = () => {
      if (slugAtual) {
        window.open('/' + slugAtual, '_blank');
      } else {
        toast('Salve a vitrine primeiro para ver o link', 'aviso');
      }
    };
  }
}

function abrirVitrine() {
  if (slugAtual) {
    window.open('/' + slugAtual, '_blank');
  } else {
    toast('Salve a vitrine primeiro para ver o link', 'aviso');
  }
}

// ============================================================
// NAVEGAÇÃO DE SEÇÕES
// ============================================================
const SECOES_CONFIG = ['marca','loja','cupom','catalogo','vitrine','fiscal','precos','maquininha'];
const SECAO_TO_ELID = {
  marca:'secaoMarca', loja:'secaoLoja', cupom:'secaoCupom',
  catalogo:'secaoCatalogo', vitrine:'secaoVitrine', fiscal:'secaoFiscal',
  precos:'secaoPrecos', maquininha:'secaoMaquininha'
};

function trocarSecaoConfig(secao) {
  document.querySelectorAll('.config-subnav-item').forEach(a =>
    a.classList.toggle('ativo', a.dataset.secao === secao)
  );
  SECOES_CONFIG.forEach(s => {
    const el = document.getElementById(SECAO_TO_ELID[s]);
    if (el) el.style.display = (s === secao ? 'block' : 'none');
  });
  localStorage.setItem('config-secao-ativa', secao);
}

// Inicialização
window.addEventListener('DOMContentLoaded', () => {
  carregar();
  checarCertificado();
  verificarTokensFocus();

  // Restaurar seção anterior ou defaultar para "marca"
  const secaoSalva = localStorage.getItem('config-secao-ativa') || 'marca';
  trocarSecaoConfig(secaoSalva);
});
