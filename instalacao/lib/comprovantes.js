// ============================================================
// Comprovantes (print do Pix por chave, encomendas, etc.)
// Salva imagem base64 (data URL) no disco persistente das fotos.
// ============================================================
const fs = require('fs');
const path = require('path');

// Mesmo disco persistente das fotos (UPLOADS_DIR em produção).
const DIR_COMPROVANTES = process.env.UPLOADS_DIR
  ? path.join(process.env.UPLOADS_DIR, 'comprovantes')
  : path.join(__dirname, '..', 'public', 'img', 'comprovantes');
if (***REMOVED***fs.existsSync(DIR_COMPROVANTES)) fs.mkdirSync(DIR_COMPROVANTES, { recursive: true });

const MAX_COMPROVANTE_BYTES = 4 * 1024 * 1024; // 4MB

// Salva um comprovante base64 (data URL). Aceita so png/jpg/webp (bloqueia svg).
// Retorna o caminho relativo (img/comprovantes/...) ou null se invalido.
function salvarComprovanteBase64(dataUrl) {
  if (***REMOVED***dataUrl || typeof dataUrl ***REMOVED***== 'string') return null;
  const m = dataUrl.match(/^data:image\/(png|jpe?g|webp);base64,([A-Za-z0-9+/=]+)$/i);
  if (***REMOVED***m) return null;
  const buf = Buffer.from(m[2], 'base64');
  if (buf.length === 0 || buf.length > MAX_COMPROVANTE_BYTES) return null;
  const ext = m[1].toLowerCase() === 'jpeg' ? 'jpg' : m[1].toLowerCase();
  const nome = `comp-${Date.now()}-${Math.floor(Math.random() * 1e6)}.${ext}`;
  fs.writeFileSync(path.join(DIR_COMPROVANTES, nome), buf);
  return 'img/comprovantes/' + nome;
}

module.exports = { salvarComprovanteBase64, DIR_COMPROVANTES, MAX_COMPROVANTE_BYTES };
