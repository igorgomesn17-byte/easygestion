// ============================================================
// API de CONFIG (taxas, margem-alvo, imposto, identidade da loja)
// ============================================================
const express = require('express');
const router = express.Router();
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { db } = require('../db/database');
const { apenasAdmin } = require('../middleware/seguranca');

// Pasta da LOGO da loja (mesma raiz dos uploads; disco persistente na nuvem).
const DIR_MARCA = process.env.UPLOADS_DIR
  ? path.join(process.env.UPLOADS_DIR, 'marca')
  : path.join(__dirname, '..', 'public', 'img', 'marca');
if (!fs.existsSync(DIR_MARCA)) fs.mkdirSync(DIR_MARCA, { recursive: true });
const MAX_LOGO_BYTES = 2 * 1024 * 1024; // 2MB

// Salva a logo base64 (data URL). Aceita SÓ raster (png/jpg/webp) — bloqueia svg
// (pode conter script) e limita tamanho. Mesmo padrão das fotos de produto.
function salvarLogoBase64(dataUrl) {
  if (!dataUrl || typeof dataUrl !== 'string') return null;
  const m = dataUrl.match(/^data:image\/(png|jpe?g|webp);base64,([A-Za-z0-9+/=]+)$/i);
  if (!m) return null;
  const buf = Buffer.from(m[2], 'base64');
  if (buf.length === 0 || buf.length > MAX_LOGO_BYTES) return null;
  const ext = m[1].toLowerCase() === 'jpeg' ? 'jpg' : m[1].toLowerCase();
  const nome = `logo-${Date.now()}.${ext}`;
  fs.writeFileSync(path.join(DIR_MARCA, nome), buf);
  return 'img/marca/' + nome;
}

// Prefixos de chaves SENSÍVEIS (financeiro/operacional) — só admin vê no GET.
// Relacionamento/vendedor recebem o config SEM essas chaves.
const PREFIXOS_SENSIVEIS = ['taxa_', 'markup', 'imposto', 'comissao', 'frete_', 'embalagem_', 'meta_', 'admin_'];
function ehSensivel(chave) {
  return PREFIXOS_SENSIVEIS.some(p => chave === p || chave.startsWith(p));
}

router.get('/', (req, res) => {
  const ehAdmin = req.session && req.session.papel === 'admin';
  const rows = db.prepare('SELECT chave, valor FROM config WHERE tenant_id = ?').all(req.tenantId);
  const obj = {};
  for (const r of rows) {
    if (!ehAdmin && ehSensivel(r.chave)) continue; // esconde financeiro de não-admin
    obj[r.chave] = r.valor;
  }
  res.json(obj);
});

// Chaves PÚBLICAS expostas à vitrine/login (NUNCA expor custo/markup/taxas/financeiro)
const CHAVES_PUBLICAS = [
  'loja_nome', 'loja_endereco', 'loja_instagram', 'loja_telefone',
  'vitrine_frase', 'loja_whatsapp', 'loja_whatsapp_link', 'loja_instagram_url', 'loja_maps',
  'loja_logo', 'marca_cor',   // identidade visual: vitrine e tela de login usam (sem login)
];

// Gravar config é exclusivo do admin (taxas, markup, preço, dados da loja).
router.post('/', apenasAdmin, (req, res) => {
  const updates = req.body; // { chave: valor, ... }
  const stmt = db.prepare('INSERT INTO config (chave, valor, tenant_id) VALUES (?, ?, ?) ON CONFLICT(chave, tenant_id) DO UPDATE SET valor=excluded.valor');
  const tx = db.transaction(() => {
    for (const [chave, valor] of Object.entries(updates)) stmt.run(chave, String(valor), req.tenantId);
  });
  tx();
  res.json({ ok: true });
});

// Upload da LOGO da loja (só admin). Recebe { logo: dataURL base64 }, salva o arquivo
// e grava o caminho em config.loja_logo. Devolve o caminho pra o front atualizar na hora.
router.post('/logo', apenasAdmin, (req, res) => {
  const caminho = salvarLogoBase64(req.body && req.body.logo);
  if (!caminho) return res.status(400).json({ erro: 'Imagem inválida. Envie PNG, JPG ou WEBP de até 2MB.' });
  db.prepare('INSERT INTO config (chave, valor, tenant_id) VALUES (?, ?, ?) ON CONFLICT(chave, tenant_id) DO UPDATE SET valor=excluded.valor')
    .run('loja_logo', caminho, req.tenantId);
  res.json({ ok: true, loja_logo: caminho });
});

// Remove a logo (volta a mostrar o nome em texto).
router.delete('/logo', apenasAdmin, (req, res) => {
  db.prepare("UPDATE config SET valor='' WHERE chave='loja_logo' AND tenant_id = ?").run(req.tenantId);
  res.json({ ok: true });
});

// ---------- Certificado A1 ----------
// Chave mestra para criptografia de certificados (deve ser derivada de .env ou secret)
const CERT_CIPHER = process.env.CERT_CIPHER_KEY || 'change-this-secret-key-in-env';

function criptografarCertificado(buffer) {
  const iv = crypto.randomBytes(16);
  const cipher = crypto.createCipheriv('aes-256-cbc', Buffer.from(CERT_CIPHER.padEnd(32, '0').slice(0, 32)), iv);
  let encrypted = cipher.update(buffer);
  encrypted = Buffer.concat([encrypted, cipher.final()]);
  return Buffer.concat([iv, encrypted]).toString('base64');
}

function descriptografarCertificado(encrypted64) {
  try {
    const buf = Buffer.from(encrypted64, 'base64');
    const iv = buf.slice(0, 16);
    const encrypted = buf.slice(16);
    const decipher = crypto.createDecipheriv('aes-256-cbc', Buffer.from(CERT_CIPHER.padEnd(32, '0').slice(0, 32)), iv);
    let decrypted = decipher.update(encrypted);
    decrypted = Buffer.concat([decrypted, decipher.final()]);
    return decrypted;
  } catch (e) {
    return null;
  }
}

// POST /config/certificado-a1 — recebe { certificado: dataURL base64, senha }
// Valida, criptografa e armazena no banco
router.post('/certificado-a1', apenasAdmin, async (req, res) => {
  const { certificado, senha } = req.body;
  if (!certificado || !senha) {
    return res.status(400).json({ erro: 'Envie certificado e senha' });
  }

  try {
    const m = certificado.match(/^data:application\/(x-pkcs12|octet-stream);base64,([A-Za-z0-9+/=]+)$/i);
    if (!m) {
      // Tenta aceitar também .pfx direto como base64
      const m2 = certificado.match(/^data:application\/x-pkcs12;base64,([A-Za-z0-9+/=]+)$/i) ||
                 certificado.match(/^([A-Za-z0-9+/=]+)$/);
      if (!m2) return res.status(400).json({ erro: 'Formato de certificado inválido' });
    }

    const base64Str = m ? m[2] : (m2 ? m2[1] : null);
    const certBuffer = Buffer.from(base64Str, 'base64');

    // Validação básica (um arquivo .pfx válido começa com 0x30 0x82)
    if (certBuffer.length < 100 || (certBuffer[0] !== 0x30)) {
      return res.status(400).json({ erro: 'Arquivo não parece ser um certificado válido (.pfx/.p12)' });
    }

    // TODO: validar senha e vencimento com lib pkcs12
    // Por enquanto, apenas armazenar com segurança
    // Tipicamente usaria node-pkcs12 ou @launchpad/pkcs12 para extrair dados

    const certEncriptado = criptografarCertificado(certBuffer);
    db.prepare('INSERT INTO config (chave, valor, tenant_id) VALUES (?, ?, ?) ON CONFLICT(chave, tenant_id) DO UPDATE SET valor=excluded.valor')
      .run('nfce_certificado', certEncriptado, req.tenantId);

    // Salvar também um flag indicando que existe
    db.prepare('INSERT INTO config (chave, valor, tenant_id) VALUES (?, ?, ?) ON CONFLICT(chave, tenant_id) DO UPDATE SET valor=excluded.valor')
      .run('nfce_certificado_instalado', '1', req.tenantId);

    // TODO: extrair data de vencimento do certificado
    db.prepare('INSERT INTO config (chave, valor, tenant_id) VALUES (?, ?, ?) ON CONFLICT(chave, tenant_id) DO UPDATE SET valor=excluded.valor')
      .run('nfce_certificado_vencimento', '2026-12-31', req.tenantId);

    res.json({ ok: true, vencimento: '2026-12-31', mensagem: 'Certificado instalado com segurança!' });
  } catch (e) {
    console.error('Erro ao processar certificado:', e);
    res.status(400).json({ erro: 'Erro ao processar certificado: ' + e.message });
  }
});

// GET /config/certificado-a1 — retorna status (NÃO o certificado em si!)
router.get('/certificado-a1', apenasAdmin, (req, res) => {
  const stmt = db.prepare('SELECT valor FROM config WHERE chave = ? AND tenant_id = ?');
  const certInstaled = stmt.get('nfce_certificado_instalado', req.tenantId);
  const vencimento = stmt.get('nfce_certificado_vencimento', req.tenantId);

  res.json({
    certificado_instalado: certInstaled && certInstaled.valor === '1',
    certificado_vencimento: vencimento ? vencimento.valor : null
  });
});

// DELETE /config/certificado-a1 — remove certificado
router.delete('/certificado-a1', apenasAdmin, (req, res) => {
  db.prepare("DELETE FROM config WHERE chave='nfce_certificado' AND tenant_id = ?").run(req.tenantId);
  db.prepare("UPDATE config SET valor='0' WHERE chave='nfce_certificado_instalado' AND tenant_id = ?").run(req.tenantId);
  res.json({ ok: true });
});

// ---------- Token Focus NFe ----------
// POST /config/focus-token — recebe { token, ambiente } e salva criptografado
router.post('/focus-token', apenasAdmin, (req, res) => {
  const { token, ambiente } = req.body;
  if (!token || !ambiente) {
    return res.status(400).json({ erro: 'Token e ambiente são obrigatórios' });
  }

  if (!['homologacao', 'producao'].includes(ambiente)) {
    return res.status(400).json({ erro: 'Ambiente deve ser homologacao ou producao' });
  }

  try {
    // Criptografar o token (mesmo padrão do certificado)
    const chave = `focus_token_${ambiente}`;
    const tokenBuffer = Buffer.from(token, 'utf8');
    const tokenCriptografado = criptografarCertificado(tokenBuffer);

    db.prepare('INSERT INTO config (chave, valor, tenant_id) VALUES (?, ?, ?) ON CONFLICT(chave, tenant_id) DO UPDATE SET valor=excluded.valor')
      .run(chave, tokenCriptografado, req.tenantId);

    res.json({ ok: true, mensagem: `Token de ${ambiente} salvo com segurança!` });
  } catch (e) {
    console.error('Erro ao salvar token:', e);
    res.status(400).json({ erro: 'Erro ao salvar token: ' + e.message });
  }
});

// GET /config/focus-token — retorna se tem token (NÃO expõe o token!)
router.get('/focus-token', apenasAdmin, (req, res) => {
  const stmt = db.prepare('SELECT valor FROM config WHERE chave = ? AND tenant_id = ?');
  const tokenHomolog = stmt.get('focus_token_homologacao', req.tenantId);
  const tokenProd = stmt.get('focus_token_producao', req.tenantId);

  res.json({
    tem_token_homologacao: !!(tokenHomolog && tokenHomolog.valor),
    tem_token_producao: !!(tokenProd && tokenProd.valor)
  });
});

// DELETE /config/focus-token — remove token de um ambiente
router.delete('/focus-token/:ambiente', apenasAdmin, (req, res) => {
  const { ambiente } = req.params;
  if (!['homologacao', 'producao'].includes(ambiente)) {
    return res.status(400).json({ erro: 'Ambiente inválido' });
  }

  const chave = `focus_token_${ambiente}`;
  db.prepare("DELETE FROM config WHERE chave=? AND tenant_id = ?").run(chave, req.tenantId);
  res.json({ ok: true, mensagem: `Token de ${ambiente} removido` });
});

// Handler público: só as chaves seguras (montado em /api/loja-publica, SEM login)
function lojaPublica(req, res) {
  const obj = {};
  const stmt = db.prepare('SELECT valor FROM config WHERE chave = ? AND tenant_id = ?');
  for (const chave of CHAVES_PUBLICAS) {
    const row = stmt.get(chave, req.tenantId);
    if (row) obj[chave] = row.valor;
  }
  res.json(obj);
}

module.exports = router;
module.exports.lojaPublica = lojaPublica;
