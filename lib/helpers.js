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

// ============================================================
// SLUG UTILITIES para vitrine pública
// ============================================================

// Slugs reservados que não podem ser usados por tenants
const SLUGS_RESERVADOS = new Set([
  'admin', 'painel', 'api', 'login', 'logout', 'registro', 'planos',
  'config', 'img', 'health', 'verify-email', 'reset-senha',
  'forgot-password', 'onboarding', 'assinatura', 'minha-conta',
  'privacidade', 'termos', 'favicon.ico', 'robots.txt', 'sitemap.xml',
  'landing', 'index', 'js', 'css', 'public', 'api-docs', 'ds-store',
  '.ds-store', 'thumbs.db'
]);

// Gerar slug a partir do nome da loja
function gerarSlug(nomeLoja) {
  if (!nomeLoja || typeof nomeLoja !== 'string') return '';

  return nomeLoja
    .toLowerCase()
    .trim()
    // Remove acentos
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    // Substitui espaços e caracteres especiais por hífen
    .replace(/[^a-z0-9]+/g, '-')
    // Remove hifens nas extremidades
    .replace(/^-+|-+$/g, '')
    // Limita tamanho
    .substring(0, 50);
}

// Verificar se um slug está disponível (não reservado e não existe no banco)
function slugDisponivel(db, slugCandidato, tenantIdAtual = null) {
  // Checar se é reservado
  if (SLUGS_RESERVADOS.has(slugCandidato)) {
    return { disponivel: false, motivo: 'slug_reservado' };
  }

  // Checar se já existe no banco (exceto o próprio tenant se for edição)
  const existe = db.prepare('SELECT id FROM tenants WHERE slug = ?').get(slugCandidato);
  if (existe && (!tenantIdAtual || existe.id !== tenantIdAtual)) {
    return { disponivel: false, motivo: 'slug_existente' };
  }

  return { disponivel: true, motivo: null };
}

// Gerar um slug único (resolve colisões com sufixo numérico)
function gerarSlugUnico(db, nomeLoja, tenantIdAtual = null) {
  let slug = gerarSlug(nomeLoja);
  if (!slug) slug = 'loja'; // fallback se nome_loja ficar vazio após normalização

  // Verificar disponibilidade
  let check = slugDisponivel(db, slug, tenantIdAtual);
  if (check.disponivel) return slug;

  // Se não está disponível, adicionar sufixo numérico
  let contador = 2;
  while (contador <= 999) {
    const slugComSufixo = `${slug}-${contador}`;
    check = slugDisponivel(db, slugComSufixo, tenantIdAtual);
    if (check.disponivel) return slugComSufixo;
    contador++;
  }

  // Fallback extremo (nunca deveria chegar aqui)
  throw new Error('Não conseguiu gerar slug único após 999 tentativas');
}

module.exports = {
  validarEmail,
  validarCPFCNPJ,
  sanitizarParaLog,
  responderSucesso,
  responderErro,
  validarTenantDoUsuario,
  gerarSlug,
  slugDisponivel,
  gerarSlugUnico,
  SLUGS_RESERVADOS
};
