// Aguardar DOM pronto
document.addEventListener('DOMContentLoaded', () => {
  // Toggle de visibilidade da senha
  document.getElementById('toggleSenha').addEventListener('click', (e) => {
    e.preventDefault();
    const input = document.getElementById('senha');
    input.type = input.type === 'password' ? 'text' : 'password';
  });

  // Event listener do form
  document.getElementById('form').addEventListener('submit', entrar);

  // Aplicar marca da loja
  aplicarMarca();

  // Verificar se já está logado
  fetch('/api/me', { credentials: 'same-origin' }).then(async r => {
    if (r.ok) { const me = await r.json().catch(()=>({})); location.href = destinoPorPapel(me.papel); }
  });
});

// destino conforme o papel de quem está logado
function destinoPorPapel(papel){ return papel === 'relacionamento' ? 'relacionamento.html' : 'index.html'; }

// Identidade da loja (nome, logo, cor) — vem da config pública, sem login.
async function aplicarMarca(){
  try {
    const r = await fetch('/api/loja-publica');
    const cfg = await r.json();
    const nome = (cfg.loja_nome || 'Minha Loja').trim();
    const cor = (cfg.marca_cor || '').trim();
    if (cor) {
      document.documentElement.style.setProperty('--marca', cor);
      // deriva um tom mais escuro pro gradiente/hover
      const h = cor.replace('#','');
      if (h.length === 6) {
        const n = parseInt(h,16);
        const esc = c => Math.max(0, Math.round(c*0.78));
        const r2=esc((n>>16)&255), g2=esc((n>>8)&255), b2=esc(n&255);
        document.documentElement.style.setProperty('--marca-escura', '#'+((1<<24)+(r2<<16)+(g2<<8)+b2).toString(16).slice(1));
      }
    }
    const img = document.querySelector('.logo'), marca = document.querySelector('.marca');
    marca.textContent = nome;
    document.title = 'Entrar • ' + nome;
    if (cfg.loja_logo) {
      img.src = cfg.loja_logo;
      img.alt = nome;
      img.style.display='block';
      marca.style.display='none';
    } else {
      img.style.display='block';
      marca.style.display='none';
    }
  } catch(e) {
    // Em caso de erro, mantém a logo padrão visível
    document.querySelector('.logo').style.display='block';
    document.querySelector('.marca').style.display='none';
  }
}

async function entrar(ev) {
  ev.preventDefault();
  const btn = document.getElementById('btn'), erro = document.getElementById('erro');
  const email = document.getElementById('email').value.trim();
  const senha = document.getElementById('senha').value;

  if (!email || !senha) {
    erro.textContent = 'Email e senha são obrigatórios';
    return;
  }

  erro.textContent = '';
  btn.disabled = true;
  btn.textContent = 'Entrando...';

  try {
    // Pega redirect param se existir
    const urlParams = new URLSearchParams(window.location.search);
    const redirect = urlParams.get('redirect');

    const resp = await fetch('/api/login' + (redirect ? '?redirect=' + encodeURIComponent(redirect) : ''), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'same-origin',
      body: JSON.stringify({ email, senha })
    });

    const d = await resp.json().catch(() => ({}));

    if (resp.ok && d.ok) {
      // Login bem-sucedido
      location.href = d.destino || 'index.html';
    } else {
      erro.textContent = d.erro || 'Falha ao entrar';
      btn.disabled = false;
      btn.textContent = 'Entrar';
    }
  } catch (e) {
    erro.textContent = 'Erro de conexão';
    btn.disabled = false;
    btn.textContent = 'Entrar';
  }
}
