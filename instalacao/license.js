// ============================================================
// Sistema de Licença com código de ativação (30 dias)
// ============================================================
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const LICENSE_FILE = path.join(__dirname, '.license');

class LicenseManager {
  // Gerar um código de ativação válido por 30 dias
  static generateCode(clientName = 'Cliente') {
    const expiryDate = new Date();
    expiryDate.setDate(expiryDate.getDate() + 30);

    const data = {
      name: clientName,
      issued: new Date().toISOString(),
      expires: expiryDate.toISOString(),
      timestamp: Date.now()
    };

    const json = JSON.stringify(data);
    const hash = crypto
      .createHash('sha256')
      .update(json + process.env.LICENSE_SECRET || 'easygestion-secret')
      .digest('hex')
      .substring(0, 16)
      .toUpperCase();

    return `EG-${data.timestamp}-${hash}`;
  }

  // Validar código de ativação
  static validateCode(code) {
    if (!code || typeof code !== 'string') {
      return { valid: false, error: 'Código inválido' };
    }

    try {
      const parts = code.split('-');
      if (parts.length !== 3 || parts[0] !== 'EG') {
        return { valid: false, error: 'Formato de código incorreto' };
      }

      const timestamp = parseInt(parts[1]);
      const providedHash = parts[2];

      // Reconstruir a data aproximadamente
      const issueDate = new Date(timestamp);
      const expiryDate = new Date(issueDate);
      expiryDate.setDate(expiryDate.getDate() + 30);

      const now = new Date();

      // Verificar se expirou
      if (now > expiryDate) {
        return {
          valid: false,
          error: 'Licença expirada',
          expiredAt: expiryDate.toLocaleDateString('pt-BR')
        };
      }

      const daysLeft = Math.ceil((expiryDate - now) / (1000 * 60 * 60 * 24));

      return {
        valid: true,
        issuedAt: issueDate.toLocaleDateString('pt-BR'),
        expiresAt: expiryDate.toLocaleDateString('pt-BR'),
        daysLeft: daysLeft
      };
    } catch (err) {
      return { valid: false, error: 'Erro ao validar código' };
    }
  }

  // Salvar licença ativada
  static saveLicense(code) {
    const validation = this.validateCode(code);

    if (!validation.valid) {
      return { success: false, error: validation.error };
    }

    try {
      fs.writeFileSync(LICENSE_FILE, code, 'utf8');
      return {
        success: true,
        message: 'Licença ativada com sucesso!',
        expiresAt: validation.expiresAt,
        daysLeft: validation.daysLeft
      };
    } catch (err) {
      return { success: false, error: 'Erro ao salvar licença' };
    }
  }

  // Verificar se está licenciado
  static isLicensed() {
    try {
      if (!fs.existsSync(LICENSE_FILE)) {
        return { licensed: false, error: 'Licença não encontrada. Ative o sistema.' };
      }

      const code = fs.readFileSync(LICENSE_FILE, 'utf8').trim();
      const validation = this.validateCode(code);

      if (!validation.valid) {
        return { licensed: false, error: validation.error, expiredAt: validation.expiredAt };
      }

      return {
        licensed: true,
        expiresAt: validation.expiresAt,
        daysLeft: validation.daysLeft
      };
    } catch (err) {
      return { licensed: false, error: 'Erro ao verificar licença' };
    }
  }

  // Remover licença (desativar)
  static revokeLicense() {
    try {
      if (fs.existsSync(LICENSE_FILE)) {
        fs.unlinkSync(LICENSE_FILE);
        return { success: true, message: 'Licença removida' };
      }
      return { success: false, error: 'Licença não encontrada' };
    } catch (err) {
      return { success: false, error: 'Erro ao remover licença' };
    }
  }
}

module.exports = LicenseManager;
