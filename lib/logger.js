// ============================================================
// Logger estruturado com Pino
// Uso: const logger = require('./lib/logger');
// logger.info('mensagem', { campo: 'valor' });
// ============================================================

const pino = require('pino');

const isDev = process.env.NODE_ENV !== 'production';

// Transporte com pretty-print em desenvolvimento
const transport = isDev
  ? pino.transport({
      target: 'pino-pretty',
      options: {
        colorize: true,
        translateTime: 'SYS:standard',
        ignore: 'pid,hostname',
        singleLine: false
      }
    })
  : undefined;

// Logger em produção: JSON estruturado (sem pretty)
const logger = pino(
  {
    level: process.env.LOG_LEVEL || (isDev ? 'debug' : 'info'),
    serializers: {
      req: (req) => ({
        method: req.method,
        url: req.url,
        path: req.path,
        ip: req.ip || req.connection.remoteAddress,
        headers: {
          'user-agent': req.headers['user-agent']
        }
      }),
      res: (res) => ({
        statusCode: res.statusCode,
        responseTime: res.responseTime
      }),
      err: pino.stdSerializers.err
    },
    formatters: {
      level: (label) => {
        return { level: label.toUpperCase() };
      }
    }
  },
  isDev ? transport : undefined
);

// Helpers para não expor dados sensíveis em produção
function sanitizarEmail(email) {
  if (!email || !isDev) return '[EMAIL]';
  return email;
}

function sanitizarIP(ip) {
  if (!ip) return 'unknown';
  if (!isDev) return ip.split('.').slice(0, 3).join('.') + '.***'; // 123.456.789.***
  return ip;
}

function sanitizarDados(obj) {
  if (!obj || isDev) return obj;

  const sanitizado = { ...obj };
  const campsSensiveis = [
    'password', 'senha', 'token', 'secret', 'apiKey', 'creditCard', 'ssn', 'cnpj', 'cpf'
  ];

  for (const campo of campsSensiveis) {
    if (sanitizado[campo]) sanitizado[campo] = '[REDACTED]';
  }

  return sanitizado;
}

module.exports = logger;
module.exports.sanitizarEmail = sanitizarEmail;
module.exports.sanitizarIP = sanitizarIP;
module.exports.sanitizarDados = sanitizarDados;
