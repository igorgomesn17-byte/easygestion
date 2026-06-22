// ============================================================
// Middleware de Auditoria — registra TODAS as ações
// OBRIGATÓRIO PARA LGPD/GDPR: rastreabilidade de quem acessou dados pessoais
// ============================================================
const { db } = require('../db/database');

// Rotas que DEVEM ser auditadas (DELETE, PATCH, POST que cria recurso)
const ROTAS_AUDITADAS = new Map([
  // Format: [método + caminho_padrão] → { recurso, capturar_antes }
  ['DELETE:/api/clientes/:id', { recurso: 'cliente', capturar_antes: true }],
  ['PATCH:/api/clientes/:id', { recurso: 'cliente', capturar_antes: true }],
  ['POST:/api/clientes', { recurso: 'cliente', capturar_antes: false }],

  ['DELETE:/api/vendas/:id', { recurso: 'venda', capturar_antes: true }],
  ['PATCH:/api/vendas/:id', { recurso: 'venda', capturar_antes: true }],
  ['POST:/api/vendas', { recurso: 'venda', capturar_antes: false }],

  ['DELETE:/api/usuarios/:id', { recurso: 'usuario', capturar_antes: true }],
  ['PATCH:/api/usuarios/:id', { recurso: 'usuario', capturar_antes: true }],
  ['PATCH:/api/usuarios/:id/ativo', { recurso: 'usuario', capturar_antes: true }],
  ['PATCH:/api/usuarios/:id/senha', { recurso: 'usuario', capturar_antes: false }], // não auditar senha
  ['POST:/api/usuarios', { recurso: 'usuario', capturar_antes: false }],
  ['PATCH:/api/auth/me/senha', { recurso: 'usuario', capturar_antes: false }], // não auditar mudança de senha pessoal

  ['DELETE:/api/produtos/:id', { recurso: 'produto', capturar_antes: true }],
  ['PATCH:/api/produtos/:id', { recurso: 'produto', capturar_antes: true }],
  ['POST:/api/produtos', { recurso: 'produto', capturar_antes: false }],

  ['PATCH:/api/config/:chave', { recurso: 'config', capturar_antes: true }],

  ['PATCH:/api/admin/tenants/:id/bloquear', { recurso: 'tenant', capturar_antes: false }],
  ['PATCH:/api/admin/tenants/:id/desbloquear', { recurso: 'tenant', capturar_antes: false }],
  ['DELETE:/api/admin/tenants/:id', { recurso: 'tenant', capturar_antes: true }],
]);

// Middleware: intercepta requisições e registra auditoria APÓS resposta
function middlewareAuditoria(req, res, next) {
  const { method, path } = req;
  const config = encontrarConfigRota(method, path);

  // Se não é rota auditada, passa adiante
  if (***REMOVED***config) return next();

  // Se é DELETE ou PATCH, capturar estado "antes"
  let estadoAntes = null;
  if ((method === 'DELETE' || method === 'PATCH') && config.capturar_antes) {
    const id = extrairIdDaRota(path);
    estadoAntes = buscarEstadoAntes(config.recurso, id);
  }

  // Salvar referência original do json/send
  const originalJson = res.json;
  let responseBody = null;

  res.json = function(data) {
    responseBody = data;
    return originalJson.call(this, data);
  };

  // Após resposta, registrar auditoria
  res.on('finish', () => {
    const status = res.statusCode;
    const id = extrairIdDaRota(path);
    const ip = getIp(req);

    // Só registrar se sucesso (2xx)
    if (status >= 200 && status < 300) {
      registrarAuditoria({
        usuario_id: req.session?.usuario_id || null,
        usuario_nome: req.session?.usuario || req.session?.nome || null,
        tenant_id: req.tenantId || null,
        acao: `${method}_${config.recurso}`,
        recurso: config.recurso,
        recurso_id: id,
        antes: estadoAntes,
        depois: responseBody,
        ip,
        status,
      }).catch(err => console.error('[AUDITORIA] Erro ao registrar:', err));
    }
  });

  next();
}

// Encontra config da rota em ROTAS_AUDITADAS
function encontrarConfigRota(metodo, caminho) {
  // Normalizar caminho removendo IDs
  let padrao = `${metodo}:${caminho}`;

  // Tentar match exato primeiro
  if (ROTAS_AUDITADAS.has(padrao)) {
    return ROTAS_AUDITADAS.get(padrao);
  }

  // Tentar match com wildcard (:id, :chave)
  for (const [chave, config] of ROTAS_AUDITADAS) {
    const regex = chave
      .replace(/:[a-z_]+/g, '[^/]+') // /api/clientes/123 → /api/clientes/[^/]+
      .replace(/\//g, '\\/')
      .replace(/\?/g, '\\?');
    if (new RegExp(`^${regex}$`).test(padrao)) {
      return config;
    }
  }

  return null;
}

// Extrai ID numérico da rota
function extrairIdDaRota(caminho) {
  const partes = caminho.split('/');
  const ultimo = partes[partes.length - 1];
  return /^\d+$/.test(ultimo) ? parseInt(ultimo, 10) : null;
}

// Busca estado ANTES de uma mudança (para comparação no audit trail)
function buscarEstadoAntes(recurso, id) {
  if (***REMOVED***id) return null;

  try {
    let sql, result;

    switch (recurso) {
      case 'cliente':
        result = db.prepare('SELECT * FROM clientes WHERE id = ?').get(id);
        break;
      case 'venda':
        result = db.prepare('SELECT * FROM vendas WHERE id = ?').get(id);
        break;
      case 'usuario':
        result = db.prepare('SELECT id, tenant_id, nome, email, papel, ativo FROM usuarios WHERE id = ?').get(id);
        break;
      case 'produto':
        result = db.prepare('SELECT * FROM produtos WHERE id = ?').get(id);
        break;
      case 'tenant':
        result = db.prepare('SELECT id, nome_loja, status FROM tenants WHERE id = ?').get(id);
        break;
      default:
        return null;
    }

    return result || null;
  } catch (err) {
    console.error(`[AUDITORIA] Erro ao buscar estado anterior (${recurso}):`, err);
    return null;
  }
}

// Registra um evento de auditoria no banco
function registrarAuditoria({
  usuario_id,
  usuario_nome,
  tenant_id,
  acao,
  recurso,
  recurso_id,
  antes,
  depois,
  ip,
  status,
}) {
  try {
    db.prepare(`
      INSERT INTO auditoria (
        usuario_id, usuario_nome, tenant_id,
        acao, recurso, recurso_id,
        antes, depois,
        ip, status_http, criado_em
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now', 'localtime'))
    `).run(
      usuario_id,
      usuario_nome,
      tenant_id,
      acao,
      recurso,
      recurso_id,
      antes ? JSON.stringify(antes) : null,
      depois ? JSON.stringify(depois) : null,
      ip,
      status,
    );
  } catch (err) {
    console.error('[AUDITORIA] Erro ao inserir:', err);
  }
}

// Extrair IP real (atrás de proxy)
function getIp(req) {
  const headers = req.headers || {};
  return (
    headers['x-forwarded-for']?.split(',')[0].trim() ||
    headers['cf-connecting-ip'] ||
    req.ip ||
    '0.0.0.0'
  );
}

// Função auxiliar: registrar auditoria manualmente dentro de um handler
function auditarAcao(req, {
  acao,      // 'DELETE_cliente', 'PATCH_tenant', etc
  recurso,   // 'cliente', 'tenant', 'usuario'
  recurso_id,
  antes = null,
  depois = null,
  status = 200,
}) {
  registrarAuditoria({
    usuario_id: req.session?.usuario_id || null,
    usuario_nome: req.session?.usuario || null,
    tenant_id: req.tenantId || null,
    acao,
    recurso,
    recurso_id,
    antes,
    depois,
    ip: getIp(req),
    status,
  });
}

// Função: recuperar histórico de auditoria de um recurso específico
function buscarAuditoria(filtros) {
  // filtros: { recurso, recurso_id, usuario_id, tenant_id, dias }
  const { recurso, recurso_id, usuario_id, tenant_id, dias = 90 } = filtros;

  let sql = `
    SELECT * FROM auditoria
    WHERE criado_em >= datetime('now', '-' || ? || ' days')
  `;
  const params = [dias];

  if (recurso) {
    sql += ` AND recurso = ?`;
    params.push(recurso);
  }
  if (recurso_id) {
    sql += ` AND recurso_id = ?`;
    params.push(recurso_id);
  }
  if (usuario_id) {
    sql += ` AND usuario_id = ?`;
    params.push(usuario_id);
  }
  if (tenant_id) {
    sql += ` AND tenant_id = ?`;
    params.push(tenant_id);
  }

  sql += ` ORDER BY criado_em DESC LIMIT 1000`;

  return db.prepare(sql).all(...params);
}

module.exports = {
  middlewareAuditoria,
  auditarAcao,
  buscarAuditoria,
};
