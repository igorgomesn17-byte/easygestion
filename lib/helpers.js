// ============================================================
// Helpers reutilizáveis (DRY - Don't Repeat Yourself)
// ============================================================

// Validar email em múltiplos places
function validarEmail(email) {
  if (!email || email.trim() === '') return { valido: true, erro: null };
  const regex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!regex.test(email)) {
    return { valido: false, erro: 'Email inválido' };
  }
  if (email.length > 255) {
    return { valido: false, erro: 'Email muito longo' };
  }
  return { valido: true, erro: null };
}

// Validar CPF ou CNPJ
function validarCPFCNPJ(valor, optional = true) {
  if (!valor || valor.trim() === '') {
    return optional ? { valido: true, erro: null, tipo: null } : { valido: false, erro: 'CPF/CNPJ obrigatório' };
  }

  const limpo = valor.replace(/\D/g, '');

  // CPF: 11 dígitos
  if (limpo.length === 11) {
    // Validação básica (não valida checksum, apenas formato)
    return { valido: true, erro: null, tipo: 'CPF', valor: limpo };
  }

  // CNPJ: 14 dígitos
  if (limpo.length === 14) {
    return { valido: true, erro: null, tipo: 'CNPJ', valor: limpo };
  }

  return { valido: false, erro: 'CPF ou CNPJ inválido (11 ou 14 dígitos)', tipo: null };
}

// Sanitizar dados sensíveis para logging
function sanitizarParaLog(obj) {
  if (!obj || typeof obj !== 'object') return obj;

  const sanitizado = { ...obj };
  const camposSensiveis = [
    'password', 'senha', 'token', 'secret', 'apiKey', 'creditCard',
    'ssn', 'cnpj', 'cpf', 'email', 'telefone', 'endereco'
  ];

  for (const campo of camposSensiveis) {
    if (sanitizado[campo]) sanitizado[campo] = '[REDACTED]';
  }

  return sanitizado;
}

// Response helper (sucesso)
function responderSucesso(res, dados, statusCode = 200) {
  res.status(statusCode).json(dados);
}

// Response helper (erro)
function responderErro(res, mensagem, statusCode = 400, logger = null) {
  if (logger) {
    logger.warn({ statusCode, erro: mensagem }, `Erro na requisição`);
  }
  res.status(statusCode).json({ erro: mensagem });
}

// Validar se tenant pertence ao usuário
function validarTenantDoUsuario(userTenantId, requestTenantId) {
  if (userTenantId !== requestTenantId) {
    return { valido: false, erro: 'Sem permissão para acessar este tenant' };
  }
  return { valido: true, erro: null };
}

module.exports = {
  validarEmail,
  validarCPFCNPJ,
  sanitizarParaLog,
  responderSucesso,
  responderErro,
  validarTenantDoUsuario
};
