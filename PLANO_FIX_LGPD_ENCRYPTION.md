# 🔧 PLANO DE FIX — LGPD + ENCRYPTION

**Status:** 🟠 EM EXECUÇÃO (6 dias até deploy)  
**Responsável:** Igor (você)  
**Timeline:** 2026-06-23 até 2026-06-29  

---

## TAREFA 1: IMPLEMENTAR LGPD (1 dia)

### 1.1 Criar `routes/conta.js` (NOVO ARQUIVO)

**Tempo:** 2 horas  
**Dependências:** nenhuma (usa DB, email, crypto)  

```javascript
// routes/conta.js
// LGPD endpoints: exportar dados + solicitar deleção

const express = require('express');
const { db } = require('../db/database');
const { exigirLogin } = require('../middleware/seguranca');
const { enviarEmail } = require('../lib/email');
const fs = require('fs');
const path = require('path');
const archiver = require('archiver');
const crypto = require('crypto');

const router = express.Router();

// ============================================================
// LGPD: Direito ao acesso (Art. 18)
// GET /api/conta/dados-export
// Retorna ZIP com todos os dados do tenant em JSON
// ============================================================
router.get('/dados-export', exigirLogin, async (req, res) => {
  try {
    const tenantId = req.session.tenant_id;

    // Buscar tenant
    const tenant = db.prepare('SELECT * FROM tenants WHERE id = ?').get(tenantId);
    if (!tenant) {
      return res.status(404).json({ erro: 'Tenant não encontrado' });
    }

    // Criar pasta temporária para os arquivos JSON
    const tmpDir = path.join(__dirname, '..', '.tmp', `export-${tenantId}-${Date.now()}`);
    if (!fs.existsSync(tmpDir)) fs.mkdirSync(tmpDir, { recursive: true });

    // Exportar dados por tabela
    const exports = {
      tenant: tenant,
      usuarios: db.prepare('SELECT * FROM usuarios WHERE tenant_id = ?').all(tenantId),
      produtos: db.prepare('SELECT * FROM produtos WHERE tenant_id = ?').all(tenantId),
      clientes: db.prepare('SELECT * FROM clientes WHERE tenant_id = ?').all(tenantId),
      vendas: db.prepare('SELECT * FROM vendas WHERE tenant_id = ?').all(tenantId),
      venda_itens: db.prepare('SELECT vi.* FROM venda_itens vi JOIN vendas v ON v.id = vi.venda_id WHERE v.tenant_id = ?').all(tenantId),
      assinaturas: db.prepare('SELECT * FROM assinaturas WHERE tenant_id = ?').all(tenantId),
      cobracas: db.prepare('SELECT * FROM cobracas WHERE tenant_id = ?').all(tenantId),
      auditoria: db.prepare('SELECT * FROM auditoria WHERE tenant_id = ? ORDER BY data_acao DESC').all(tenantId),
      config: db.prepare('SELECT * FROM config WHERE tenant_id = ?').all(tenantId),
    };

    // Escrever JSONs na pasta temporária
    for (const [chave, dados] of Object.entries(exports)) {
      const filePath = path.join(tmpDir, `${chave}.json`);
      // Remover senhas do export (LGPD: dados públicos)
      const dadosSanitizados = Array.isArray(dados) 
        ? dados.map(d => ({ ...d, senha_hash: undefined, admin_senha: undefined }))
        : { ...dados, senha_hash: undefined, admin_senha: undefined };
      
      fs.writeFileSync(filePath, JSON.stringify(dadosSanitizados, null, 2));
    }

    // Criar metadata do export
    fs.writeFileSync(
      path.join(tmpDir, 'LEIA-ME.txt'),
      `EXPORTAÇÃO DE DADOS PESSOAIS (LGPD Art. 18)
=====================================

Data da Exportação: ${new Date().toLocaleString('pt-BR')}
Solicitante: ${tenant.email}
Loja: ${tenant.nome_loja}

Arquivos incluídos:
- tenant.json: Dados da loja
- usuarios.json: Usuários da loja
- produtos.json: Catálogo de produtos
- clientes.json: Base de clientes
- vendas.json: Histórico de vendas
- venda_itens.json: Itens de cada venda
- assinaturas.json: Histórico de assinaturas
- cobracas.json: Cobranças registradas
- auditoria.json: Log de quem fez o quê
- config.json: Configurações da loja

Observações:
- Senhas foram removidas por segurança
- Dados em formato JSON (abrir com Excel, Google Sheets, etc)
- Validade: 30 dias (depois será deletado automaticamente)

Dúvidas? Contato: suporte@easygestao.com`
    );

    // Criar ZIP
    const zipPath = path.join(__dirname, '..', '.tmp', `export-${tenantId}-${Date.now()}.zip`);
    const output = fs.createWriteStream(zipPath);
    const archive = archiver('zip');

    output.on('close', async () => {
      // Enviar email com link de download
      try {
        await enviarEmail(tenant.email, {
          assunto: 'Seus dados foram exportados (LGPD)',
          html: `
            <p>Olá ${tenant.nome_loja},</p>
            <p>Sua solicitação de exportação de dados foi processada com sucesso!</p>
            <p>
              <a href="${process.env.SITE_URL}/export-download?token=${crypto.randomBytes(32).toString('hex')}">
                📥 Baixar seus dados (ZIP - ${Math.round(fs.statSync(zipPath).size / 1024)} KB)
              </a>
            </p>
            <p>O arquivo estará disponível por 30 dias.</p>
            <p>EasyGestão © ${new Date().getFullYear()}</p>
          `
        });

        // Deletar pasta temporária (ZIP será servido/deletado depois)
        // Por enquanto, guardar por 30 dias
        setTimeout(() => {
          if (fs.existsSync(tmpDir)) fs.rmSync(tmpDir, { recursive: true });
          if (fs.existsSync(zipPath)) fs.unlinkSync(zipPath);
        }, 30 * 24 * 60 * 60 * 1000); // 30 dias

        res.json({
          ok: true,
          mensagem: 'Seus dados foram exportados com sucesso!',
          tamanho_kb: Math.round(fs.statSync(zipPath).size / 1024),
          link_download: `${process.env.SITE_URL}/export-download?token=...`,
          nota: 'Email foi enviado para você. Arquivo estará disponível por 30 dias.',
        });
      } catch (err) {
        console.error('[LGPD EXPORT] Erro ao enviar email:', err);
        res.status(500).json({ erro: 'Erro ao enviar link de download' });
      }
    });

    archive.on('error', (err) => {
      console.error('[LGPD EXPORT] Erro ao criar ZIP:', err);
      res.status(500).json({ erro: 'Erro ao criar arquivo' });
    });

    archive.pipe(output);
    archive.directory(tmpDir, false);
    archive.finalize();

  } catch (err) {
    console.error('[LGPD EXPORT] Erro geral:', err);
    res.status(500).json({ erro: 'Erro ao exportar dados' });
  }
});

// ============================================================
// LGPD: Direito ao esquecimento (Art. 17)
// POST /api/conta/solicitar-delecao
// Agenda deleção permanente em 30 dias
// Cliente tem 30 dias para mudar de ideia
// ============================================================
router.post('/solicitar-delecao', exigirLogin, async (req, res) => {
  try {
    const tenantId = req.session.tenant_id;

    // Verificar se já tem deleção agendada
    const existente = db.prepare(
      'SELECT * FROM delecoes_agendadas WHERE tenant_id = ?'
    ).get(tenantId);

    if (existente) {
      return res.status(400).json({
        erro: 'Você já tem uma deleção agendada',
        data_delecao: existente.agendado_para,
        dias_restantes: Math.ceil(
          (new Date(existente.agendado_para) - new Date()) / (24 * 60 * 60 * 1000)
        )
      });
    }

    // Buscar tenant
    const tenant = db.prepare('SELECT * FROM tenants WHERE id = ?').get(tenantId);
    if (!tenant) return res.status(404).json({ erro: 'Tenant não encontrado' });

    // Agendar deleção em 30 dias
    const dataDeletao = new Date(new Date().getTime() + 30 * 24 * 60 * 60 * 1000)
      .toISOString()
      .split('T')[0];

    db.prepare(
      'INSERT INTO delecoes_agendadas (tenant_id, agendado_para) VALUES (?, ?)'
    ).run(tenantId, dataDeletao);

    // Email de confirmação
    try {
      await enviarEmail(tenant.email, {
        assunto: '⚠️ Sua conta será deletada em 30 dias (LGPD)',
        html: `
          <p>Olá ${tenant.nome_loja},</p>
          <p>Você solicitou a deleção de sua conta. <strong>Ela será deletada permanentemente em 30 dias</strong> (${dataDeletao}).</p>
          <p>Você tem 30 dias para mudar de ideia. Nesse caso, acesse sua conta e cancele a deleção.</p>
          <p>
            <a href="${process.env.SITE_URL}/login">Acessar minha conta</a>
          </p>
          <p style="color: #666; font-size: 12px;">
            Se não foi você quem fez essa solicitação, acesse sua conta imediatamente e cancele a deleção.
          </p>
          <p>EasyGestão © ${new Date().getFullYear()}</p>
        `
      });
    } catch (emailErr) {
      console.warn('[LGPD DELETE] Erro ao enviar email (mas deleção agendada):', emailErr);
    }

    // Log de auditoria
    console.log(`[LGPD] Deleção agendada para tenant ${tenantId} em ${dataDeletao}`);

    res.json({
      ok: true,
      mensagem: 'Sua conta será deletada permanentemente em 30 dias',
      data_delecao: dataDeletao,
      nota: 'Você pode cancelar a deleção acessando sua conta a qualquer momento',
    });

  } catch (err) {
    console.error('[LGPD DELETE] Erro:', err);
    res.status(500).json({ erro: 'Erro ao agendar deleção' });
  }
});

// ============================================================
// LGPD: Status de deleção
// GET /api/conta/status-delecao
// Retorna se conta está marcada para deleção
// ============================================================
router.get('/status-delecao', exigirLogin, (req, res) => {
  try {
    const tenantId = req.session.tenant_id;

    const delecao = db.prepare(
      'SELECT * FROM delecoes_agendadas WHERE tenant_id = ?'
    ).get(tenantId);

    if (!delecao) {
      return res.json({ deletando: false, mensagem: 'Sua conta não está marcada para deleção' });
    }

    const agora = new Date();
    const dataDeletao = new Date(delecao.agendado_para);
    const diasRestantes = Math.ceil((dataDeletao - agora) / (24 * 60 * 60 * 1000));

    res.json({
      deletando: true,
      data_delecao: delecao.agendado_para,
      dias_restantes: Math.max(0, diasRestantes),
      status: diasRestantes > 0 ? 'agendado' : 'será deletado hoje',
    });

  } catch (err) {
    console.error('[LGPD STATUS] Erro:', err);
    res.status(500).json({ erro: 'Erro ao verificar status' });
  }
});

// ============================================================
// LGPD: Cancelar deleção
// DELETE /api/conta/cancelar-delecao
// Remove de delecoes_agendadas se ainda não foi deletado
// ============================================================
router.delete('/cancelar-delecao', exigirLogin, async (req, res) => {
  try {
    const tenantId = req.session.tenant_id;

    const delecao = db.prepare(
      'SELECT * FROM delecoes_agendadas WHERE tenant_id = ?'
    ).get(tenantId);

    if (!delecao) {
      return res.status(400).json({ erro: 'Sua conta não está marcada para deleção' });
    }

    // Cancelar deleção
    db.prepare('DELETE FROM delecoes_agendadas WHERE tenant_id = ?').run(tenantId);

    // Email confirmando
    const tenant = db.prepare('SELECT * FROM tenants WHERE id = ?').get(tenantId);
    await enviarEmail(tenant.email, {
      assunto: '✅ Deleção de conta cancelada',
      html: `
        <p>Olá ${tenant.nome_loja},</p>
        <p>A deleção de sua conta foi <strong>cancelada com sucesso</strong>.</p>
        <p>Sua loja continua ativa e todos os seus dados foram preservados.</p>
        <p>EasyGestão © ${new Date().getFullYear()}</p>
      `
    });

    console.log(`[LGPD] Deleção cancelada para tenant ${tenantId}`);

    res.json({
      ok: true,
      mensagem: 'Deleção de conta cancelada. Sua conta está ativa novamente!',
    });

  } catch (err) {
    console.error('[LGPD CANCEL] Erro:', err);
    res.status(500).json({ erro: 'Erro ao cancelar deleção' });
  }
});

module.exports = router;
```

### 1.2 Montar rota no `server.js`

**Localização:** `server.js` linha 175 (depois de /assinaturas, antes de /pagamentos)

```javascript
// Adicionar ANTES de /pagamentos:
app.use('/api/conta', exigirLogin, require('./routes/conta')); // LGPD: dados e deleção
```

### 1.3 Atualizar `public/minha-conta.html`

**Tempo:** 1 hora

Adicionar botões na tela de configurações:

```html
<!-- public/minha-conta.html -->
<!-- Adicionar na seção de segurança/dados -->

<section class="config-lgpd">
  <h2>📋 Dados Pessoais (LGPD)</h2>
  <p>Você tem direito a acessar, exportar e deletar seus dados conforme a Lei Geral de Proteção de Dados.</p>

  <div class="lgpd-actions">
    <!-- Botão 1: Exportar dados -->
    <div class="action">
      <h3>📥 Exportar Meus Dados</h3>
      <p>Baixe um ZIP com todos os seus dados em formato JSON.</p>
      <button onclick="exportarDados()" class="btn btn-primary">
        Exportar Dados
      </button>
      <p class="help-text">Você receberá um email com o link de download</p>
    </div>

    <!-- Botão 2: Deletar conta -->
    <div class="action">
      <h3>🗑️ Deletar Minha Conta</h3>
      <p>Sua conta será deletada permanentemente em 30 dias após a solicitação.</p>
      <button onclick="solicitarDelecao()" class="btn btn-danger">
        Solicitar Deleção
      </button>
      <p class="help-text">Você ainda terá 30 dias para mudar de ideia</p>
    </div>

    <!-- Status de deleção -->
    <div id="status-delecao" style="display:none;">
      <h3>⚠️ Sua conta está marcada para deleção</h3>
      <p id="dias-restantes"></p>
      <button onclick="cancelarDelecao()" class="btn btn-secondary">
        Cancelar Deleção
      </button>
    </div>
  </div>
</section>

<style>
  .config-lgpd {
    border: 1px solid #ddd;
    padding: 20px;
    border-radius: 8px;
    background: #f9f9f9;
    margin-top: 30px;
  }
  .lgpd-actions {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(300px, 1fr));
    gap: 20px;
    margin-top: 20px;
  }
  .action {
    border: 1px solid #e0e0e0;
    padding: 15px;
    border-radius: 6px;
    background: white;
  }
  .action h3 {
    margin-top: 0;
    color: #333;
  }
  .help-text {
    font-size: 12px;
    color: #999;
    margin-top: 10px;
  }
</style>

<script>
async function exportarDados() {
  try {
    const res = await fetch('/api/conta/dados-export', { method: 'GET' });
    const data = await res.json();
    if (data.ok) {
      alert(`✅ Pronto! Email com link de download foi enviado para você.\n\nTamanho: ${data.tamanho_kb} KB`);
    } else {
      alert(`❌ Erro: ${data.erro}`);
    }
  } catch (err) {
    alert(`❌ Erro ao exportar: ${err.message}`);
  }
}

async function solicitarDelecao() {
  const confirmacao = confirm(
    '⚠️ Você tem certeza que deseja deletar sua conta?\n\n' +
    'Sua conta será permanentemente deletada em 30 dias.\n' +
    'Você ainda terá 30 dias para mudar de ideia.\n\n' +
    'Deseja continuar?'
  );

  if (!confirmacao) return;

  try {
    const res = await fetch('/api/conta/solicitar-delecao', { method: 'POST' });
    const data = await res.json();
    if (data.ok) {
      alert(`✅ Deleção agendada para ${data.data_delecao}\n\nVocê receberá um email de confirmação.`);
      verificarStatusDelecao();
    } else {
      alert(`❌ Erro: ${data.erro}`);
    }
  } catch (err) {
    alert(`❌ Erro: ${err.message}`);
  }
}

async function cancelarDelecao() {
  try {
    const res = await fetch('/api/conta/cancelar-delecao', { method: 'DELETE' });
    const data = await res.json();
    if (data.ok) {
      alert('✅ Deleção cancelada! Sua conta está ativa novamente.');
      verificarStatusDelecao();
    }
  } catch (err) {
    alert(`❌ Erro: ${err.message}`);
  }
}

async function verificarStatusDelecao() {
  try {
    const res = await fetch('/api/conta/status-delecao');
    const data = await res.json();
    const div = document.getElementById('status-delecao');
    
    if (data.deletando) {
      div.style.display = 'block';
      document.getElementById('dias-restantes').innerHTML =
        `Sua conta será deletada em <strong>${data.dias_restantes} dias</strong> (${data.data_delecao})`;
    } else {
      div.style.display = 'none';
    }
  } catch (err) {
    console.error('Erro ao verificar status:', err);
  }
}

// Verificar status ao carregar a página
document.addEventListener('DOMContentLoaded', verificarStatusDelecao);
</script>
```

---

## TAREFA 2: CRIPTOGRAFAR BACKUPS (4 horas)

### 2.1 Adicionar dependência

```bash
npm install archiver  # se ainda não estiver instalado
```

### 2.2 Atualizar `lib/backup-scheduler.js`

**Localização:** `lib/backup-scheduler.js`  
**Tempo:** 2 horas  
**O que mudar:** Adicionar criptografia AES-256 antes de enviar para S3

```javascript
// lib/backup-scheduler.js (parte relevante)

const crypto = require('crypto');
const fs = require('fs');
const { Upload } = require('@aws-sdk/lib-storage');
const { S3Client } = require('@aws-sdk/client-s3');

function criptografarBackup(dbPath, senhaEncryption) {
  try {
    // Ler arquivo DB
    const dados = fs.readFileSync(dbPath);
    
    // Gerar salt aleatório (16 bytes)
    const salt = crypto.randomBytes(16);
    
    // Derivar chave da senha usando PBKDF2
    const key = crypto.pbkdf2Sync(
      senhaEncryption,
      salt,
      100000,  // 100k iterações (OWASP recomenda 100k+)
      32,      // 32 bytes = 256 bits para AES-256
      'sha256'
    );
    
    // IV aleatório (16 bytes para AES)
    const iv = crypto.randomBytes(16);
    
    // Criptografar com AES-256-CBC
    const cipher = crypto.createCipheriv('aes-256-cbc', key, iv);
    let encrypted = cipher.update(dados);
    encrypted = Buffer.concat([encrypted, cipher.final()]);
    
    // Retornar: salt + iv + encrypted (não precisa de autenticação extra, SQL não é crítico)
    // Formato: [salt(16)] [iv(16)] [encrypted(N)]
    const resultado = Buffer.concat([salt, iv, encrypted]);
    
    console.log(`[BACKUP CRYPTO] Arquivo criptografado: ${dados.length} → ${resultado.length} bytes`);
    return resultado;
  } catch (err) {
    console.error('[BACKUP CRYPTO] Erro ao criptografar:', err);
    throw err;
  }
}

async function enviarBackupParaS3(caminhoDb) {
  try {
    const s3 = new S3Client({ region: process.env.AWS_REGION });
    
    // Criptografar antes de enviar
    const senhaEncryption = process.env.BACKUP_ENCRYPT_KEY;
    if (!senhaEncryption || senhaEncryption.length < 32) {
      throw new Error('BACKUP_ENCRYPT_KEY deve estar configurada (mínimo 32 caracteres)');
    }
    
    const dadosCriptografados = criptografarBackup(caminhoDb, senhaEncryption);
    
    // Data/hora do backup
    const agora = new Date();
    const data = agora.toISOString().split('T')[0]; // YYYY-MM-DD
    const hora = agora.toISOString().split('T')[1].replace(/[:.]/g, ''); // HHMMSS
    
    // Nome do arquivo: backup-2026-06-23-143052.db.enc
    const nomeArquivo = `backup-${data}-${hora}.db.enc`;
    
    // Upload para S3 (sem ACL público, privado por padrão)
    const uploader = new Upload({
      client: s3,
      params: {
        Bucket: process.env.AWS_S3_BUCKET,
        Key: `backups/${nomeArquivo}`,
        Body: dadosCriptografados,
        ServerSideEncryption: 'AES256', // S3 também criptografa (dupla proteção)
        Metadata: {
          'encrypted-at': new Date().toISOString(),
          'cipher': 'aes-256-cbc',
          'kdf': 'pbkdf2-100000',
        }
      }
    });
    
    await uploader.done();
    
    console.log(`[BACKUP S3] ✅ Upload completo: ${nomeArquivo} (${Math.round(dadosCriptografados.length / 1024 / 1024)} MB)`);
    
    return { ok: true, arquivo: nomeArquivo, tamanho: dadosCriptografados.length };
  } catch (err) {
    console.error('[BACKUP S3] ❌ Erro:', err);
    throw err;
  }
}

// Função de restauração (adicionar em lib/backup-restore.js depois)
function descriptografarBackup(arquivoCriptografado, senhaEncryption) {
  try {
    // Extrair salt (primeiros 16 bytes)
    const salt = arquivoCriptografado.slice(0, 16);
    
    // Extrair IV (próximos 16 bytes)
    const iv = arquivoCriptografado.slice(16, 32);
    
    // Resto é encrypted
    const encrypted = arquivoCriptografado.slice(32);
    
    // Derivar mesma chave
    const key = crypto.pbkdf2Sync(senhaEncryption, salt, 100000, 32, 'sha256');
    
    // Descriptografar
    const decipher = crypto.createDecipheriv('aes-256-cbc', key, iv);
    let decrypted = decipher.update(encrypted);
    decrypted = Buffer.concat([decrypted, decipher.final()]);
    
    console.log(`[BACKUP DECRYPT] Arquivo descriptografado: ${decrypted.length} bytes`);
    return decrypted;
  } catch (err) {
    console.error('[BACKUP DECRYPT] Erro:', err);
    throw new Error('Falha ao descriptografar backup (senha inválida?)');
  }
}

module.exports = { criptografarBackup, descriptografarBackup, enviarBackupParaS3 };
```

### 2.3 Adicionar `BACKUP_ENCRYPT_KEY` ao `.env`

```bash
# .env
BACKUP_ENCRYPT_KEY=SuaSenhaForteAleatoria32CharacterMinimum!@#$%
```

**Como gerar uma senha forte:**
```bash
# Terminal/PowerShell
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"

# Resultado: a1b2c3d4e5f6...
```

### 2.4 Verificar `.gitignore`

Adicionar (para não commitar `.env`):
```bash
# .gitignore (verificar se existe)
.env
.env.local
.env.production
```

---

## TAREFA 3: TESTE INTEGRADO (1 dia)

### 3.1 Testar LGPD Export

```bash
# 1. Criar cliente teste
curl -X POST http://localhost:3001/api/registro \
  -H "Content-Type: application/json" \
  -d '{"email":"teste@lgpd.test","senha":"Test123!@#","nome_loja":"Teste LGPD"}'

# 2. Login
curl -X POST http://localhost:3001/api/login \
  -H "Content-Type: application/json" \
  -d '{"email":"teste@lgpd.test","senha":"Test123!@#"}' \
  -c cookies.txt

# 3. Exportar dados
curl http://localhost:3001/api/conta/dados-export \
  -b cookies.txt

# Resultado esperado:
# {
#   "ok": true,
#   "tamanho_kb": 45,
#   "mensagem": "Seus dados foram exportados com sucesso!",
#   "link_download": "..."
# }
```

### 3.2 Testar LGPD Delete

```bash
# 1. Solicitar deleção
curl -X POST http://localhost:3001/api/conta/solicitar-delecao \
  -b cookies.txt

# Resultado esperado:
# {
#   "ok": true,
#   "data_delecao": "2026-07-23",
#   "dias_restantes": 30
# }

# 2. Verificar status
curl http://localhost:3001/api/conta/status-delecao \
  -b cookies.txt

# 3. Cancelar deleção
curl -X DELETE http://localhost:3001/api/conta/cancelar-delecao \
  -b cookies.txt
```

### 3.3 Testar Backup Criptografado

```bash
# 1. Forçar backup (adicionar endpoint temporário de teste)
curl -X POST http://localhost:3001/api/backup/testar-criptografia \
  -H "Authorization: Bearer ADMIN_TOKEN"

# Verificar S3:
# aws s3 ls s3://easygestao-backups/backups/

# Resultado esperado:
# 2026-06-23 14:30:52       1234567 backup-2026-06-23-143052.db.enc
#                           ^^^^^^^^ arquivo .enc, não .db
```

---

## CRONOGRAMA FINAL

```
┌─────────────────────────────────────────────┐
│ DIA 1 (2026-06-24)                          │
├─────────────────────────────────────────────┤
│ [ ] Criar routes/conta.js                   │ 2h
│ [ ] Montar rota em server.js                │ 30min
│ [ ] Testar endpoints LGPD                   │ 1h
│ [ ] Atualizar public/minha-conta.html       │ 1h
│ TOTAL: 4.5h                                 │
└─────────────────────────────────────────────┘

┌─────────────────────────────────────────────┐
│ DIA 2 (2026-06-25)                          │
├─────────────────────────────────────────────┤
│ [ ] Atualizar lib/backup-scheduler.js       │ 2h
│ [ ] Adicionar BACKUP_ENCRYPT_KEY ao .env    │ 30min
│ [ ] Criar lib/backup-restore.js (decrypt)   │ 1h
│ [ ] Testar criptografia/descriptografia     │ 1h
│ TOTAL: 4.5h                                 │
└─────────────────────────────────────────────┘

┌─────────────────────────────────────────────┐
│ DIA 3-4 (2026-06-26 a 2026-06-27)           │
├─────────────────────────────────────────────┤
│ [ ] Code review (segurança)                 │ 2h
│ [ ] Testes de edge case                     │ 2h
│ [ ] Load test (50 clientes concurrent)      │ 2h
│ [ ] Health check endpoint                   │ 1h
│ [ ] Documentação de operação                │ 2h
│ TOTAL: 9h (divididos em 2 dias)             │
└─────────────────────────────────────────────┘

┌─────────────────────────────────────────────┐
│ DIA 5 (2026-06-28)                          │
├─────────────────────────────────────────────┤
│ [ ] Deploy em staging                       │ 1h
│ [ ] Smoke tests                             │ 1h
│ [ ] Monitoramento 24h                       │ 1h
│ [ ] Preparar rollback                       │ 1h
│ TOTAL: 4h                                   │
└─────────────────────────────────────────────┘

┌─────────────────────────────────────────────┐
│ DIA 6 (2026-06-29)                          │
├─────────────────────────────────────────────┤
│ 🚀 DEPLOY PARA PRODUÇÃO                     │
│ [ ] Backup da prod antes de deploy          │ 30min
│ [ ] Deploy gradual (canary 10%)             │ 30min
│ [ ] Monitoramento pós-deploy                │ 24h on-call
│ TOTAL: Até 25h de monitoramento             │
└─────────────────────────────────────────────┘
```

---

## ✅ CHECKLIST PRÉ-DEPLOY

### ANTES DE COMMITAR
- [ ] Code review de routes/conta.js
- [ ] Testes LGPD executados manualmente
- [ ] Backup encryption testado
- [ ] Senhas não estão em logs

### ANTES DE STAGING
- [ ] .env tem BACKUP_ENCRYPT_KEY (32+ chars)
- [ ] .env tem SESSION_SECRET (32+ chars)
- [ ] STRIPE_WEBHOOK_SECRET está válida
- [ ] SENDGRID_API_KEY funciona

### ANTES DE PRODUÇÃO
- [ ] Health check endpoint criado e testado
- [ ] Alertas configuradas (Discord/Slack/email)
- [ ] Monitoring ativo (Uptime Robot, Sentry)
- [ ] On-call setup (quem responde a 3AM)
- [ ] Runbook de incidentes escrito

---

## 📞 SUPORTE TÉCNICO

### Se der erro em LGPD export
```
Erro: "ENOENT: no such file or directory"
→ Criar pasta .tmp no root do projeto: mkdir .tmp

Erro: "ZIP é vazio"
→ Verificar que tenant_id está correto na sessão
→ Executar: db.prepare("SELECT COUNT(*) FROM produtos WHERE tenant_id = ?").get(tenantId)
```

### Se der erro em backup encryption
```
Erro: "BACKUP_ENCRYPT_KEY must have at least 32 characters"
→ Gerar: node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
→ Adicionar ao .env

Erro: "Upload to S3 failed"
→ Verificar AWS credentials: AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY
→ Verificar bucket existe: aws s3 ls s3://easygestao-backups
```

---

**Bom trabalho! Qualquer dúvida, leia AUDITORIA_PRE_DEPLOY_FINAL.md** 🚀
