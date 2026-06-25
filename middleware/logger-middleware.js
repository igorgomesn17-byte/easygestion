// ============================================================
// Middleware: Injetar logger em req e medir tempo de resposta
// ============================================================

const logger = require('../lib/logger');
const { recordRequest, recordError } = require('../lib/monitoring');

module.exports = (req, res, next) => {
  // Injetar logger na requisição
  req.logger = logger.child({
    requestId: req.id || `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
    method: req.method,
    path: req.path,
    ip: req.ip || req.connection.remoteAddress
  });

  // Medir tempo de resposta
  const startTime = Date.now();

  // Override res.json para logar respostas
  const originalJson = res.json.bind(res);
  res.json = function(data) {
    const duration = Date.now() - startTime;
    req.logger.info(
      { statusCode: res.statusCode, duration: `${duration}ms` },
      `${req.method} ${req.path} → ${res.statusCode}`
    );
    recordRequest(res.statusCode, duration);
    return originalJson(data);
  };

  // Override res.status para capturar status de erro
  const originalStatus = res.status.bind(res);
  res.status = function(code) {
    if (code >= 400) {
      const duration = Date.now() - startTime;
      req.logger.warn(
        { statusCode: code, duration: `${duration}ms` },
        `${req.method} ${req.path} → ${code}`
      );
    }
    return originalStatus(code);
  };

  next();
};
