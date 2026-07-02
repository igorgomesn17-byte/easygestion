-- ============================================================
-- Email Verification para signup
-- ============================================================

-- Tabela para guardar tokens de verificação de email
CREATE TABLE IF NOT EXISTS email_verifications (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  usuario_id INTEGER NOT NULL,
  token TEXT UNIQUE NOT NULL,
  criado_em DATETIME DEFAULT CURRENT_TIMESTAMP,
  expira_em DATETIME NOT NULL,
  verificado INTEGER DEFAULT 0,
  verificado_em DATETIME,
  FOREIGN KEY (usuario_id) REFERENCES usuarios(id) ON DELETE CASCADE
);

-- Coluna para marcar se email foi verificado
ALTER TABLE usuarios ADD COLUMN email_verificado INTEGER DEFAULT 0;

-- Índices para performance
CREATE INDEX IF NOT EXISTS idx_email_verifications_token ON email_verifications(token);
CREATE INDEX IF NOT EXISTS idx_email_verifications_usuario ON email_verifications(usuario_id);
CREATE INDEX IF NOT EXISTS idx_usuarios_email_verificado ON usuarios(email_verificado);
