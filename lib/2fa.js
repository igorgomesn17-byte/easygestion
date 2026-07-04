// ============================================================
// 2FA (TOTP) Helpers — Autenticação de dois fatores para Admin
// ============================================================
const speakeasy = require('speakeasy');
const QRCode = require('qrcode');

// Gerar um novo secret TOTP (base32 encoded)
function gerarSecret(label = 'EasyGestão Admin') {
  return speakeasy.generateSecret({
    name: label,
    issuer: 'EasyGestão',
    length: 32
  });
}

// Gerar QR Code como Data URL (para escanear com Google Authenticator, Authy, etc)
async function gerarQRCode(secret) {
  try {
    return await QRCode.toDataURL(secret.otpauth_url);
  } catch (err) {
    console.error('[2FA] Erro ao gerar QR code:', err.message);
    throw err;
  }
}

// Validar token TOTP (6 dígitos)
// secret: string em base32 (o secret.base32 de gerarSecret)
// token: string com 6 dígitos do Google Authenticator / Authy
// window: tolerância de janelas de tempo (default 2 = ±1min)
function validarToken(secret, token) {
  if (!secret || !token) {
    return false;
  }

  try {
    const valid = speakeasy.totp.verify({
      secret: secret,
      encoding: 'base32',
      token: String(token).trim(),
      window: 2 // permite ±2 janelas (30s cada) = 1 minuto de tolerância
    });
    return valid;
  } catch (err) {
    console.error('[2FA] Erro ao validar token:', err.message);
    return false;
  }
}

// Gerar 10 códigos de backup únicos (8 caracteres alfanuméricos cada)
function gerarBackupCodes() {
  const codes = [];
  for (let i = 0; i < 10; i++) {
    codes.push(Math.random().toString(36).substring(2, 10).toUpperCase());
  }
  return codes;
}

// Validar um código de backup contra um array de hashes
// Requer a função verificarSenha importada de middleware/seguranca.js
function validarBackupCode(codigosHashados, codigoDigitado, verificarSenhaFn) {

  if (!codigosHashados || !codigoDigitado) {
    return { valido: false, indexConsumido: -1 };
  }

  try {
    const codes = typeof codigosHashados === 'string' ? JSON.parse(codigosHashados) : codigosHashados;
    if (!Array.isArray(codes)) {
      return { valido: false, indexConsumido: -1 };
    }

    for (let i = 0; i < codes.length; i++) {
      if (verificarSenhaFn(codigoDigitado.trim(), codes[i])) {
        return { valido: true, indexConsumido: i };
      }
    }
    return { valido: false, indexConsumido: -1 };
  } catch (err) {
    console.error('[2FA] Erro ao validar backup code:', err.message);
    return { valido: false, indexConsumido: -1 };
  }
}

module.exports = {
  gerarSecret,
  gerarQRCode,
  validarToken,
  gerarBackupCodes,
  validarBackupCode
};
