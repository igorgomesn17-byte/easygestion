document.addEventListener('DOMContentLoaded', () => {
  const emailInput = document.getElementById('email');
  const senhaInput = document.getElementById('senha');
  const botao = document.getElementById('btn-login');
  const erroDiv = document.getElementById('erro');

  // Toggle de visibilidade da senha
  document.getElementById('toggleSenha').addEventListener('click', (e) => {
    e.preventDefault();
    senhaInput.type = senhaInput.type === 'password' ? 'text' : 'password';
  });

  async function login() {
    const email = emailInput.value.trim();
    const senha = senhaInput.value;

    if (!email) {
      erroDiv.textContent = 'Digite o email';
      erroDiv.classList.add('show');
      return;
    }

    if (!senha) {
      erroDiv.textContent = 'Digite a senha';
      erroDiv.classList.add('show');
      return;
    }

    botao.disabled = true;
    botao.textContent = 'Autenticando...';
    erroDiv.classList.remove('show');

    try {
      const res = await fetch('/api/admin/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ email, senha })
      });

      const data = await res.json();

      // Senha OK → segue para o 2FA (verify se já configurou, setup na 1ª vez).
      // O login só se completa após o 2º fator; não vai direto ao dashboard.
      if (res.ok && data.sucesso) {
        window.location.href = data.destino || '/admin-2fa.html';
        return;
      }

      // Erro
      erroDiv.textContent = data.erro || 'Erro ao autenticar.';
      erroDiv.classList.add('show');
      botao.disabled = false;
      botao.textContent = 'Próximo';
    } catch (err) {
      erroDiv.textContent = 'Erro de conexão. Tente novamente.';
      erroDiv.classList.add('show');
      botao.disabled = false;
      botao.textContent = 'Próximo';
    }
  }

  // Enter para submeter
  document.addEventListener('keypress', (e) => {
    if (e.key === 'Enter' && document.activeElement !== botao) login();
  });

  // Limpar erro ao digitar
  emailInput.addEventListener('input', () => erroDiv.classList.remove('show'));
  senhaInput.addEventListener('input', () => erroDiv.classList.remove('show'));

  // Listener para o botão de login
  botao.addEventListener('click', login);
});
