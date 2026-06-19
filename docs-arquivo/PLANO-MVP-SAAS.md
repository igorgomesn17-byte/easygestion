# PLANO MVP SAAS — O QUE FAZER AGORA
## EasyGestão | Guia Executivo para Lançamento

> **Igor:** Este é seu plano de ação. Os docs auditorados estão em:
> - `AUDITORIA-SAAS-EXPERIENCIA.md` (o que o cliente vive)
> - `AUDITORIA-SAAS-TECNICA.md` (segurança, arquitetura, compliance)

---

## 🎯 SITUAÇÃO ATUAL

✅ **Tem:**
- ERP funcional (produtos, vendas, caixa, estoque)
- Dashboard com KPIs
- Login com roles (admin, vendedor, relacionamento)
- Configurações de loja (logo, cor, imposto, taxa)
- NFC-e integrada

❌ **Não tem (bloqueadores SaaS):**
1. Email de usuário
2. Recuperação de senha
3. Convite de usuários por email
4. Alteração de senha pelo próprio usuário
5. Termos + Privacidade
6. Exportação de dados (LGPD)
7. Exclusão de conta
8. **Isolamento multi-tenant** (BIG ISSUE)

---

## 🚀 FASE 1: MVP (3-4 semanas)

### Semana 1: Email + Banco de Dados

**O que fazer:**

#### 1.1 Escolher serviço de email
```
Opções (recomendo nessa ordem):
1. SendGrid (melhor custo/feature ratio) → $10/mês
2. AWS SES (barato se já usa AWS) → $0.10 por 1k emails
3. Resend.com (moderno, ótimo para devs) → free até 100/dia
4. Gmail SMTP (NUNCA em produção, quebra rápido)

Ação: Abrir conta em sendgrid.com e gerar API key
Armazenar em .env: SENDGRID_API_KEY=...
```

#### 1.2 Adicionar email ao BD
```sql
-- db/schema.sql

ALTER TABLE usuarios ADD COLUMN email TEXT UNIQUE;
ALTER TABLE usuarios ADD COLUMN email_verificado INTEGER DEFAULT 0;
ALTER TABLE usuarios ADD COLUMN email_verificado_em TEXT;
ALTER TABLE usuarios ADD COLUMN aceito_termos INTEGER DEFAULT 0;
ALTER TABLE usuarios ADD COLUMN aceito_termos_em TEXT;

-- nova tabela para tokens de reset/verify:
CREATE TABLE IF NOT EXISTS tokens_verificacao (
  id INTEGER PRIMARY KEY,
  usuario_id INTEGER NOT NULL,
  token TEXT UNIQUE NOT NULL,  -- JWT ou random 32 bytes
  tipo TEXT NOT NULL,           -- 'reset-senha', 'verificar-email', 'convite'
  criado_em TEXT NOT NULL DEFAULT (datetime('now','localtime')),
  expires_em TEXT NOT NULL,     -- timestamp ISO (1h depois)
  usado_em TEXT,                -- NULL até usar
  FOREIGN KEY (usuario_id) REFERENCES usuarios(id) ON DELETE CASCADE
);

-- Índice para limpeza automática:
CREATE INDEX idx_tokens_expires ON tokens_verificacao(expires_em);
```

**Arquivo a editar:** `db/schema.sql` (add antes da função de migração)

---

#### 1.3 Instalar biblioteca de email
```bash
npm install nodemailer
# Ou se usar SendGrid:
npm install @sendgrid/mail
```

**Adicionar ao package.json → dependencies**

#### 1.4 Criar função auxiliar de email
**Novo arquivo:** `lib/email.js`

```javascript
// lib/email.js
const sgMail = require('@sendgrid/mail');
sgMail.setApiKey(process.env.SENDGRID_API_KEY || 'fake-key-dev');

const SITE_URL = process.env.SITE_URL || 'http://localhost:3000';
const LOJA_EMAIL = process.env.LOJA_EMAIL || 'noreply@easygestion.com';
const LOJA_NOME = process.env.LOJA_NOME || 'EasyGestão';

async function enviarEmail(para, assunto, htmlBody) {
  if (process.env.NODE_ENV === 'test') {
    console.log(`[EMAIL TEST] ${para}: ${assunto}`);
    return;
  }
  
  try {
    await sgMail.send({
      to: para,
      from: LOJA_EMAIL,
      subject: assunto,
      html: htmlBody,
    });
    console.log(`[EMAIL OK] ${para}: ${assunto}`);
    return true;
  } catch (err) {
    console.error(`[EMAIL FALHA] ${para}:`, err.message);
    return false;
  }
}

// Templates
function templateResetSenha(usuario, link) {
  return `
    <h2>Redefinir sua senha</h2>
    <p>Oi ${usuario},</p>
    <p>Clique no link abaixo para redefinir sua senha. O link expira em 1 hora.</p>
    <p><a href="${link}" style="background:#1a6f5e; color:white; padding:12px 24px; text-decoration:none; border-radius:6px; display:inline-block;">Redefinir senha</a></p>
    <p>Se não solicitou isso, ignore este email.</p>
    <p>Equipe ${LOJA_NOME}</p>
  `;
}

function templateVerificarEmail(usuario, link) {
  return `
    <h2>Confirme seu email</h2>
    <p>Oi ${usuario},</p>
    <p>Para ativar sua conta, clique no botão abaixo:</p>
    <p><a href="${link}" style="background:#1a6f5e; color:white; padding:12px 24px; text-decoration:none; border-radius:6px; display:inline-block;">Confirmar email</a></p>
    <p>O link expira em 24 horas.</p>
    <p>Equipe ${LOJA_NOME}</p>
  `;
}

function templateConvite(usuario, link) {
  return `
    <h2>Você foi convidado***REMOVED***</h2>
    <p>Oi,</p>
    <p><strong>${usuario}</strong> convidou você para acessar ${LOJA_NOME}.</p>
    <p>Clique abaixo para criar sua senha e começar:</p>
    <p><a href="${link}" style="background:#1a6f5e; color:white; padding:12px 24px; text-decoration:none; border-radius:6px; display:inline-block;">Aceitar convite</a></p>
    <p>Este link expira em 7 dias.</p>
    <p>Equipe ${LOJA_NOME}</p>
  `;
}

module.exports = {
  enviarEmail,
  templateResetSenha,
  templateVerificarEmail,
  templateConvite,
};
```

**Tempo:** ~30 min

---

### Semana 2: Recuperação de Senha

#### 2.1 Nova rota: Forgot Password
**Editar:** `routes/auth.js`

```javascript
const { enviarEmail, templateResetSenha } = require('../lib/email');
const crypto = require('crypto');
const jwt = require('jsonwebtoken');  // npm install jsonwebtoken

const TOKEN_SECRET = process.env.TOKEN_SECRET || 'change-me-in-env';

// POST /api/auth/forgot-password { email }
router.post('/forgot-password', async (req, res) => {
  const { email } = req.body;
  if (***REMOVED***email || ***REMOVED***email.includes('@')) {
    return res.status(400).json({ erro: 'Email inválido' });
  }

  // (1) Procura usuário
  const user = db.prepare('SELECT * FROM usuarios WHERE LOWER(email) = LOWER(?) AND ativo = 1').get(email.trim());
  if (***REMOVED***user) {
    // IMPORTANTE: não expor se existe ou não (segurança)
    return res.json({ ok: true, mensagem: 'Se existe uma conta com este email, um link de redefinição foi enviado.' });
  }

  // (2) Gera token válido por 1h
  const token = jwt.sign(
    { id: user.id, tipo: 'reset' },
    TOKEN_SECRET,
    { expiresIn: '1h' }
  );

  // (3) Salva na BD (para revogação posterior, se necessário)
  const expires = new Date(Date.now() + 3600000).toISOString();
  db.prepare(`
    INSERT INTO tokens_verificacao (usuario_id, token, tipo, criado_em, expires_em)
    VALUES (?, ?, ?, ?, ?)
  `).run(user.id, token, 'reset-senha', new Date().toISOString(), expires);

  // (4) Envia email
  const resetLink = `${process.env.SITE_URL || 'http://localhost:3000'}/reset-senha?token=${token}`;
  await enviarEmail(user.email, 'Redefinir sua senha', templateResetSenha(user.nome, resetLink));

  return res.json({ ok: true, mensagem: 'Email de redefinição enviado' });
});

// POST /api/auth/reset-senha { token, nova_senha }
router.post('/reset-senha', (req, res) => {
  const { token, nova_senha } = req.body;
  if (***REMOVED***token || ***REMOVED***nova_senha || nova_senha.length < 6) {
    return res.status(400).json({ erro: 'Token ou senha inválida' });
  }

  try {
    // (1) Valida token
    const decoded = jwt.verify(token, TOKEN_SECRET);
    if (decoded.tipo ***REMOVED***== 'reset') throw new Error('Token inválido');

    // (2) Procura usuário
    const user = db.prepare('SELECT * FROM usuarios WHERE id = ?').get(decoded.id);
    if (***REMOVED***user) return res.status(404).json({ erro: 'Usuário não encontrado' });

    // (3) Valida token no BD (já foi usado?)
    const tokenRec = db.prepare('SELECT * FROM tokens_verificacao WHERE token = ? AND tipo = ?')
      .get(token, 'reset-senha');
    if (***REMOVED***tokenRec || tokenRec.usado_em) {
      return res.status(400).json({ erro: 'Token já foi usado ou expirou' });
    }

    // (4) Atualiza senha
    const { hashSenha } = require('../middleware/seguranca');
    db.transaction(() => {
      db.prepare('UPDATE usuarios SET senha_hash = ? WHERE id = ?')
        .run(hashSenha(nova_senha), user.id);
      db.prepare('UPDATE tokens_verificacao SET usado_em = ? WHERE id = ?')
        .run(new Date().toISOString(), tokenRec.id);
    })();

    return res.json({ ok: true, mensagem: 'Senha redefinida com sucesso***REMOVED***' });
  } catch (err) {
    console.error('Reset error:', err.message);
    return res.status(400).json({ erro: 'Token inválido ou expirado' });
  }
});
```

#### 2.2 Tela de reset (pública)
**Novo arquivo:** `public/reset-senha.html`

```html
<***REMOVED***DOCTYPE html>
<html lang="pt-BR">
<head>
  <meta charset="UTF-8">
  <title>Redefinir senha • EasyGestão</title>
  <style>
    body { font-family:sans-serif; max-width:400px; margin:60px auto; }
    form { background:#f5f5f5; padding:30px; border-radius:8px; }
    input { width:100%; padding:10px; margin:10px 0; border:1px solid #ddd; border-radius:4px; }
    button { width:100%; padding:12px; background:#1a6f5e; color:white; border:none; border-radius:4px; cursor:pointer; }
    .erro { color:red; font-size:14px; margin:10px 0; }
    .ok { color:green; }
  </style>
</head>
<body>
  <form id="form" onsubmit="redefinir(event)">
    <h2>Redefinir senha</h2>
    <input type="hidden" id="token" required>
    <input type="password" id="nova_senha" placeholder="Nova senha" required minlength="6">
    <input type="password" id="confirma" placeholder="Confirme a senha" required minlength="6">
    <button type="submit">Redefinir</button>
    <div id="msg" class="erro"></div>
  </form>

  <script>
    // Pega token da URL (?token=...)
    const params = new URLSearchParams(location.search);
    document.getElementById('token').value = params.get('token');

    if (***REMOVED***params.get('token')) {
      document.getElementById('msg').textContent = 'Link inválido ou expirado';
      document.getElementById('form').style.display = 'none';
    }

    async function redefinir(ev) {
      ev.preventDefault();
      const nova = document.getElementById('nova_senha').value;
      const confirma = document.getElementById('confirma').value;
      if (nova ***REMOVED***== confirma) {
        document.getElementById('msg').textContent = 'Senhas não combinam';
        return;
      }

      const res = await fetch('/api/auth/reset-senha', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token: params.get('token'), nova_senha: nova })
      });
      const d = await res.json();
      const msg = document.getElementById('msg');
      if (res.ok) {
        msg.className = 'ok';
        msg.textContent = 'Senha redefinida***REMOVED*** Você pode fazer login agora. ' +
          '<a href="login.html">Clique aqui</a>';
      } else {
        msg.textContent = d.erro || 'Erro ao redefinir';
      }
    }
  </script>
</body>
</html>
```

#### 2.3 Editar login.html
**Arquivo:** `public/login.html`

Adicionar link "Esqueci minha senha" no final do form:

```html
<***REMOVED***-- Depois do <div class="erro"> -->
<a href="esqueci-senha.html" class="voltar" style="margin-top:22px;">Esqueci minha senha</a>
```

**Novo arquivo:** `public/esqueci-senha.html`

```html
<***REMOVED***DOCTYPE html>
<html lang="pt-BR">
<head>
  <meta charset="UTF-8">
  <title>Esqueci minha senha • EasyGestão</title>
  <style>
    body { font-family:sans-serif; max-width:400px; margin:60px auto; }
    form { background:#f5f5f5; padding:30px; border-radius:8px; }
    input { width:100%; padding:10px; margin:10px 0; border:1px solid #ddd; border-radius:4px; }
    button { width:100%; padding:12px; background:#1a6f5e; color:white; border:none; border-radius:4px; cursor:pointer; }
    .msg { margin:10px 0; padding:10px; border-radius:4px; }
    .ok { background:#d4edda; color:#155724; }
    .erro { background:#f8d7da; color:#721c24; }
  </style>
</head>
<body>
  <form id="form" onsubmit="enviar(event)">
    <h2>Redefinir senha</h2>
    <p style="color:#666; font-size:14px;">Informe seu email. Enviaremos um link para redefinir sua senha.</p>
    <input type="email" id="email" placeholder="Seu email" required autofocus>
    <button type="submit">Enviar link</button>
    <div id="msg" class="msg" style="display:none;"></div>
  </form>

  <script>
    async function enviar(ev) {
      ev.preventDefault();
      const email = document.getElementById('email').value;
      const res = await fetch('/api/auth/forgot-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email })
      });
      const d = await res.json();
      const msg = document.getElementById('msg');
      msg.style.display = 'block';
      if (res.ok) {
        msg.className = 'msg ok';
        msg.textContent = d.mensagem || 'Verifique seu email***REMOVED***';
        document.getElementById('form').style.display = 'none';
      } else {
        msg.className = 'msg erro';
        msg.textContent = d.erro || 'Erro ao enviar';
      }
    }
  </script>
</body>
</html>
```

**Tempo:** ~2-3 horas

---

#### 2.4 Adicionar `.env` de exemplo
**Editar:** `.env.example`

```bash
# Adicionar:
TOKEN_SECRET=seu-secret-aleatorio-min-32-chars
SENDGRID_API_KEY=sua-chave-sendgrid
SITE_URL=http://localhost:3000
LOJA_EMAIL=noreply@easygestion.com
LOJA_NOME=EasyGestão
```

**Tempo:** ~10 min

---

### Semana 3: Alterar senha própria + Email verification

#### 3.1 Tela "Minha conta"
**Novo arquivo:** `public/minha-conta.html`

```html
<***REMOVED***DOCTYPE html>
<html lang="pt-BR">
<head>
  <meta charset="UTF-8">
  <title>Minha conta • EasyGestão</title>
  <link rel="stylesheet" href="css/ds.css">
</head>
<body>
  <div class="conteudo">
    <h1>Minha conta</h1>
    
    <div class="card">
      <h2>Alterar senha</h2>
      <form id="formSenha" onsubmit="alterarSenha(event)">
        <div class="campo">
          <label>Senha atual</label>
          <input type="password" id="senhaAtual" required>
        </div>
        <div class="campo">
          <label>Nova senha</label>
          <input type="password" id="senhaNova" minlength="6" required>
        </div>
        <div class="campo">
          <label>Confirme</label>
          <input type="password" id="senhaConfirma" minlength="6" required>
        </div>
        <button type="submit" class="btn">Alterar senha</button>
        <div id="msg" style="margin-top:10px;"></div>
      </form>
    </div>

    <div class="card">
      <h2>Email</h2>
      <p id="emailStatus">Verificando…</p>
    </div>

    <div class="card">
      <h2>Exportar dados (LGPD)</h2>
      <p class="texto-cinza">Baixe todos seus dados em JSON.</p>
      <button class="btn btn-fino" onclick="exportarDados()">📥 Exportar meus dados</button>
    </div>

    <div class="card" style="border-left:4px solid #f44336;">
      <h2 style="color:#f44336;">Zona de perigo</h2>
      <p class="texto-cinza">Irreversível. Sua conta será completamente deletada.</p>
      <button class="btn btn-vermelho" onclick="deletarConta()">❌ Deletar minha conta</button>
    </div>
  </div>

  <script>
    montarLayout('minha-conta');

    // Carregar info da conta
    fetch('/api/me').then(r => r.json()).then(user => {
      // ...
    });

    async function alterarSenha(ev) {
      ev.preventDefault();
      const atual = document.getElementById('senhaAtual').value;
      const nova = document.getElementById('senhaNova').value;
      const confirma = document.getElementById('senhaConfirma').value;

      if (nova ***REMOVED***== confirma) {
        document.getElementById('msg').innerHTML = '<div class="erro">Senhas não combinam</div>';
        return;
      }

      const res = await fetch('/api/me/senha', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ senha_atual: atual, senha_nova: nova })
      });

      const d = await res.json();
      if (res.ok) {
        document.getElementById('msg').innerHTML = '<div class="ok">✅ Senha alterada***REMOVED***</div>';
        document.getElementById('formSenha').reset();
      } else {
        document.getElementById('msg').innerHTML = `<div class="erro">${d.erro}</div>`;
      }
    }

    async function exportarDados() {
      const res = await fetch('/api/me/dados');
      const json = await res.json();
      const blob = new Blob([JSON.stringify(json, null, 2)], { type: 'application/json' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = 'meus-dados.json';
      a.click();
    }

    async function deletarConta() {
      if (***REMOVED***confirm('Tem certeza? Esta ação é irreversível***REMOVED***')) return;
      const senha = prompt('Digite sua senha para confirmar:');
      if (***REMOVED***senha) return;

      const res = await fetch('/api/me/conta', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ senha })
      });

      if (res.ok) {
        alert('Conta deletada. Até logo***REMOVED***');
        location.href = 'login.html';
      } else {
        const d = await res.json();
        alert(d.erro || 'Erro ao deletar');
      }
    }
  </script>
</body>
</html>
```

#### 3.2 Rotas PATCH /api/me/*
**Editar:** `routes/auth.js` (adicionar ao final)

```javascript
// PATCH /api/me/senha { senha_atual, senha_nova }
router.patch('/me/senha', (req, res) => {
  if (***REMOVED***req.session || ***REMOVED***req.session.logado) {
    return res.status(401).json({ erro: 'Não autenticado' });
  }

  const { senha_atual, senha_nova } = req.body;
  if (***REMOVED***senha_atual || ***REMOVED***senha_nova || senha_nova.length < 6) {
    return res.status(400).json({ erro: 'Entrada inválida' });
  }

  // (1) Procura usuário
  const user = db.prepare('SELECT * FROM usuarios WHERE nome = ? AND ativo = 1')
    .get(req.session.usuario);
  if (***REMOVED***user) return res.status(404).json({ erro: 'Usuário não encontrado' });

  // (2) Valida senha atual
  if (***REMOVED***verificarSenha(senha_atual, user.senha_hash)) {
    return res.status(403).json({ erro: 'Senha atual incorreta' });
  }

  // (3) Atualiza senha
  db.prepare('UPDATE usuarios SET senha_hash = ? WHERE id = ?')
    .run(hashSenha(senha_nova), user.id);

  res.json({ ok: true, mensagem: 'Senha alterada com sucesso' });
});

// GET /api/me/dados { exporta JSON com meus dados }
router.get('/me/dados', (req, res) => {
  if (***REMOVED***req.session || ***REMOVED***req.session.logado) {
    return res.status(401).json({ erro: 'Não autenticado' });
  }

  const usuario = db.prepare('SELECT id, nome, email, papel, criado_em FROM usuarios WHERE nome = ?')
    .get(req.session.usuario);

  const exports = {
    usuario,
    meus_acessos: db.prepare(
      'SELECT ... FROM audit_logs WHERE usuario_id = ? ORDER BY criado_em DESC LIMIT 100'
    ).all(usuario.id),
    // minhas vendas, clientes, etc. (conforme access)
  };

  res.json(exports);
});

// DELETE /api/me/conta { senha }
router.delete('/me/conta', (req, res) => {
  if (***REMOVED***req.session || ***REMOVED***req.session.logado) {
    return res.status(401).json({ erro: 'Não autenticado' });
  }

  const { senha } = req.body;
  const user = db.prepare('SELECT * FROM usuarios WHERE nome = ?')
    .get(req.session.usuario);

  if (***REMOVED***verificarSenha(senha, user.senha_hash)) {
    return res.status(403).json({ erro: 'Senha incorreta' });
  }

  // Soft delete (não apaga, anônimiza)
  db.transaction(() => {
    db.prepare('UPDATE usuarios SET nome = ?, email = ?, ativo = 0 WHERE id = ?')
      .run(`[DELETADO] ${user.id}`, `[DELETADO-${user.id}@noreply.local]`, user.id);
  })();

  req.session.destroy();
  res.json({ ok: true });
});
```

**Tempo:** ~2-3 horas

---

### Semana 4: Termos + Privacidade + Multi-tenant prep

#### 4.1 Criar páginas legais
**Novo arquivo:** `public/termos.html`

```html
<***REMOVED***DOCTYPE html>
<html lang="pt-BR">
<head>
  <meta charset="UTF-8">
  <title>Termos de Uso • EasyGestão</title>
  <style>
    body { font-family:sans-serif; max-width:900px; margin:40px auto; line-height:1.6; }
    h2 { margin-top:30px; color:#1a6f5e; }
  </style>
</head>
<body>
  <h1>Termos de Uso do EasyGestão</h1>
  
  <h2>1. Aceitação dos Termos</h2>
  <p>Ao usar o EasyGestão, você concorda com estes termos...</p>

  <h2>2. Responsabilidades</h2>
  <p>Você é responsável por manter a segurança de sua senha...</p>

  <h2>3. Limitações de Responsabilidade</h2>
  <p>O EasyGestão é fornecido "no estado em que se encontra"...</p>

  <h2>4. Encerramento</h2>
  <p>Podemos encerrar sua conta se violar estes termos...</p>

  <h2>5. Alterações</h2>
  <p>Podemos alterar estes termos a qualquer momento...</p>

  <p style="margin-top:40px; color:#666; font-size:14px;">
    Última atualização: 18/06/2026. 
    Dúvidas? Entre em contato: contato@easygestion.com
  </p>
</body>
</html>
```

**Novo arquivo:** `public/privacidade.html`

```html
<***REMOVED***DOCTYPE html>
<html lang="pt-BR">
<head>
  <meta charset="UTF-8">
  <title>Política de Privacidade • EasyGestão</title>
  <style>
    body { font-family:sans-serif; max-width:900px; margin:40px auto; line-height:1.6; }
    h2 { margin-top:30px; color:#1a6f5e; }
  </style>
</head>
<body>
  <h1>Política de Privacidade do EasyGestão</h1>

  <h2>1. Coleta de Dados</h2>
  <p>Coletamos informações necessárias para operar o sistema:
    <ul>
      <li>Dados de conta (nome, email, senha)</li>
      <li>Dados operacionais (produtos, vendas, clientes)</li>
      <li>Logs de acesso (IP, timestamp, ação)</li>
    </ul>
  </p>

  <h2>2. Como Usamos seus Dados</h2>
  <p>
    <ul>
      <li>Fornecer o serviço</li>
      <li>Melhorar a segurança</li>
      <li>Cumprir leis (NFC-e, LGPD)</li>
    </ul>
  </p>

  <h2>3. Compartilhamento</h2>
  <p>Nunca compartilhamos seus dados com terceiros, exceto conforme exigido por lei.</p>

  <h2>4. Segurança</h2>
  <p>Usamos criptografia (HTTPS, AES) para proteger seus dados.</p>

  <h2>5. Seus Direitos (LGPD)</h2>
  <p>Você pode:
    <ul>
      <li>Acessar seus dados</li>
      <li>Exportar seus dados</li>
      <li>Deletar sua conta</li>
      <li>Revogar consentimento</li>
    </ul>
  </p>

  <p style="margin-top:40px; color:#666; font-size:14px;">
    Última atualização: 18/06/2026. 
    Contato: contato@easygestion.com
  </p>
</body>
</html>
```

#### 4.2 Preparar multi-tenant (começar refactor)

**Criar arquivo de migração:** `db/migrations/001-add-tenant-id.sql`

```sql
-- Multi-tenant: adicionar tenant_id a todas as tabelas

-- Criar tabela de tenants (lojas):
CREATE TABLE IF NOT EXISTS tenants (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  nome TEXT NOT NULL,
  criado_em TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);

-- Adicionar tenant_id às tabelas:
ALTER TABLE usuarios ADD COLUMN tenant_id INTEGER;
ALTER TABLE produtos ADD COLUMN tenant_id INTEGER;
ALTER TABLE vendas ADD COLUMN tenant_id INTEGER;
ALTER TABLE clientes ADD COLUMN tenant_id INTEGER;
ALTER TABLE config ADD COLUMN tenant_id INTEGER;
-- ... (todas as tabelas)

-- Criar índices de performance:
CREATE INDEX idx_usuarios_tenant ON usuarios(tenant_id);
CREATE INDEX idx_produtos_tenant ON produtos(tenant_id);
CREATE INDEX idx_vendas_tenant ON vendas(tenant_id);
-- ... etc

-- Migração: colocar todos em tenant 1:
UPDATE usuarios SET tenant_id = 1;
UPDATE produtos SET tenant_id = 1;
UPDATE vendas SET tenant_id = 1;
-- ... etc
```

**Editar:** `middleware/seguranca.js` (adicionar tenant middleware)

```javascript
// Novo middleware:
function exigirTenant(req, res, next) {
  if (***REMOVED***req.session.tenant_id) {
    return res.status(401).json({ erro: 'Tenant não encontrado' });
  }
  req.tenant_id = req.session.tenant_id;
  next();
}

module.exports = { ... exigirTenant };
```

**Tempo:** ~3-4 horas (preparação)

---

## 📋 Checklist Semana 1-4

### Semana 1 ✅
- [ ] Escolhida e configurada API SendGrid
- [ ] Adicionadas colunas de email ao BD
- [ ] Tabela `tokens_verificacao` criada
- [ ] `lib/email.js` implementado
- [ ] `.env.example` atualizado

### Semana 2 ✅
- [ ] Rota `/api/auth/forgot-password` funcional
- [ ] Rota `/api/auth/reset-senha` funcional
- [ ] `public/esqueci-senha.html` criado
- [ ] `public/reset-senha.html` criado
- [ ] Email de reset sendo enviado
- [ ] Teste: reset de senha completo

### Semana 3 ✅
- [ ] Rota `PATCH /api/me/senha` funcional
- [ ] Rota `GET /api/me/dados` funcional
- [ ] Rota `DELETE /api/me/conta` funcional
- [ ] `public/minha-conta.html` criado
- [ ] Usuário consegue alterar própria senha
- [ ] Usuário consegue exportar dados
- [ ] Usuário consegue deletar conta

### Semana 4 ✅
- [ ] `public/termos.html` criado (revisar com advogado***REMOVED***)
- [ ] `public/privacidade.html` criado (revisar com advogado***REMOVED***)
- [ ] Checkbox "Aceito os termos" no login
- [ ] Campo `email_verificado` em usuarios
- [ ] Migração multi-tenant preparada (schema)
- [ ] Middleware de tenant criado (ainda não integrado)

---

## 🎯 FASE 2: Convites + Verificação Email (Semana 5-6)

Depois de MVP:

1. **Convite por email**
   - Admin cria usuário com email
   - Envia link "Aceitar convite"
   - Usuário clica → define senha → ativado

2. **Verificação de email**
   - Novo usuário recebe "Confirme seu email"
   - Clica link
   - Email marcado como verificado

3. **Integração multi-tenant**
   - Aplicar tenant_id em todas as queries
   - Testar isolamento de dados

---

## 💰 Investimentos Necessários

| Item | Custo | Obrigatório? | Quando |
|------|-------|-------------|--------|
| SendGrid (email) | $10-30/mês | ✅ Sim | Agora |
| Domínio | $10/ano | ✅ Sim | Já tem? |
| HTTPS (Let's Encrypt) | Grátis | ✅ Sim | Agora |
| PostgreSQL (v1.1) | $12-50/mês | ❌ Não | Sept 2026 |
| Backup cloud (v1.1) | $5-20/mês | ❌ Não | Sept 2026 |

**Total MVP:** ~$10/mês (SendGrid) + domínio que já tem

---

## 🚀 Depois de lançar

**Imediatamente (Agosto):**
- Monitorar Sentry para erros
- Feedback de primeiros clientes
- Otimizar performance

**Setembro:**
- Começar migração PostgreSQL
- Backup automático
- 2FA (TOTP)

**Outubro+:**
- Integração Omie
- SSO (Google/Microsoft)
- Marketplace de integrações

---

## ✋ Último lembrete

> **PARAR agora,** refatorar Multi-tenant e LGPD, **DEPOIS lançar.**  
> Um cliente vendo dados de outro = game over.

Quer ajuda implementando? Chamar quando tiver pronto.

