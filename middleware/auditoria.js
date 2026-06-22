// ============================================================
// Middleware de Auditoria — registra TODAS as ações admin
// OBRIGATÓRIO PARA LGPD/GDPR: rastreabilidade de quem acessou dados pessoais
// ============================================================
const { db } = require('../db/database');

// Recursos que DEVEM ser auditados (DELETE ou PATCH significativo)
const RECURSOS_AUDITADOS = new Set([
  'cliente',      // tenant ou cliente de tenant
  'usuario',      // criação/edição/deleção de usuários
  'config',       // mudança de configuração (pode afetar múltiplos clientes)
  'produto',      // criação/deleção/edição de produto
  'venda',        // exclusão de venda (caso de fraude)
  'tenants',      // bloqueio/desbloqueio/deleção de tenants
]);

// Middleware: intercepta requisições e registra auditoria APÓS resposta
function middlewareAuditoria(req, res, next) {
  // Salvar referência original do send/json
  const originalSend = res.send;
  const originalJson = res.json;
  let responseBody = null;

  // Interceptar resposta
  res.send = function(data) {
    responseBody = data;
    return originalSend.call(this, data);
  };

  res.json = function(data) {
    responseBody = data;
    return originalJson.call(this, data);
  };

  // Após o handler executar, registrar auditoria
  res.on('finish', () => {
    const { method, path, body, session, ip, headers } = req;
    const status = res.statusCode;

    // Se é uma ação que deve ser auditada
    if (deveAuditar(method, path)) {
      registrarAuditoria({
        usuario_id: session?.usuario_id || null,
        usuario_nome: session?.nome || 'admin-env',
        tenant_id: req.tenantId || null,
        metodo: method,
        caminho: path,
        corpo: body,
        status,
        ip: getIp(req, headers),
      }).catch(err => console.error('[AUDITORIA] Erro ao registrar:', err));
    }
  });

  next();
}

// Lógica: detecta se uma requisição deve ser auditada
function deveAuditar(metodo, caminho) {
  // Apenas DELETE, PATCH (modificações), POST em rotas de admin
  const metodoCritico = ['DELETE', 'PATCH'].includes(metodo);
  if (***REMOVED***metodoCritico) return false;

  // Apenas admin/* routes
  if (***REMOVED***caminho.startsWith('/api/admin')) return false;

  return true;
}

// Registra um evento de auditoria no banco
async function registrarAuditoria({
  usuario_id,
  usuario_nome,
  tenant_id,
  metodo,
  caminho,
  corpo,
  status,
  ip,
}) {
  // Parse do caminho para extrair ação e recurso
  // Exemplos:
  //   DELETE /api/admin/clientes/5 → acao=DELETE, recurso=cliente, id=5
  //   PATCH  /api/admin/clientes/5 → acao=PATCH, recurso=cliente, id=5

  const partes = caminho.split('/');
  let recurso = null;
  let recursoId = null;
  let acao = metodo;

  if (partes[3]) { // /api/admin/{recurso}
    recurso = partes[3]; // 'clientes', 'usuarios', etc
    if (partes[4]) {
      recursoId = parseInt(partes[4], 10);
    }
  }

  // Registrar no banco
  try {
    db.prepare(`
      INSERT INTO auditoria (
        usuario_id, usuario_nome, tenant_id,
        acao, recurso, recurso_id,
        antes, depois,
        ip, status_http
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      usuario_id,
      usuario_nome,
      tenant_id,
      acao,
      recurso,
      recursoId,
      null, // antes (populado por trigger ou hook específico)
      JSON.stringify(corpo || {}), // depois
      ip,
      status,
    );
  } catch (err) {
    console.error('[AUDITORIA] Erro ao inserir:', err);
    // NÃO rejeitar a requisição principal por erro de auditoria
    // Apenas alertar e continuar
  }
}

// Extrair IP real (atrás de proxy)
function getIp(req, headers) {
  return (
    headers['x-forwarded-for']?.split(',')[0].trim() ||
    headers['cf-connecting-ip'] ||
    req.ip ||
    '0.0.0.0'
  );
}

// Função auxiliar: registrar auditoria de forma síncrona dentro de um handler
function auditarAcao(req, {
  acao,      // 'DELETE_cliente', 'PATCH_tenant', etc
  recurso,   // 'cliente', 'tenant', 'usuario'
  recurso_id,
  antes = null,
  depois = null,
  status = 200,
}) {
  try {
    db.prepare(`
      INSERT INTO auditoria (
        usuario_id, usuario_nome, tenant_id,
        acao, recurso, recurso_id,
        antes, depois,
        ip, status_http
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      req.session?.usuario_id || null,
      req.session?.nome || 'admin-env',
      req.tenantId || null,
      acao,
      recurso,
      recurso_id,
      antes ? JSON.stringify(antes) : null,
      depois ? JSON.stringify(depois) : null,
      req.ip || '0.0.0.0',
      status,
    );
  } catch (err) {
    console.error('[AUDITORIA] Erro ao registrar ação:', err);
  }
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
