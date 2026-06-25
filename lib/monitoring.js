// ============================================================
// Sistema de Monitoramento e Alertas
// Rastreia métricas e gera alertas
// ============================================================

const logger = require('./logger');

class Monitor {
  constructor() {
    this.metrics = {
      errorsTotal: 0,
      errors5xx: 0,
      errors4xx: 0,
      requestsTotal: 0,
      requestsPerMinute: 0,
      avgResponseTime: 0,
      lastErrorAt: null,
      lastError: null
    };

    this.thresholds = {
      errorRate: 0.05, // 5% de erro
      errorSpikeCount: 10, // 10 erros em 1 min
      responseTime: 2000, // 2 segundos
      dbConnectionPoolExhausted: 0.8 // 80%
    };

    this.alerts = [];

    // Resetar métricas por minuto
    setInterval(() => this.resetMinuteMetrics(), 60 * 1000);
  }

  recordRequest(statusCode, duration) {
    this.metrics.requestsTotal++;
    this.metrics.avgResponseTime = (this.metrics.avgResponseTime * 0.9) + (duration * 0.1);

    if (statusCode >= 500) {
      this.metrics.errors5xx++;
      this.metrics.errorsTotal++;
    } else if (statusCode >= 400 && statusCode !== 429) { // não contar rate limit
      this.metrics.errors4xx++;
    }

    if (duration > this.thresholds.responseTime) {
      this.alert('SLOW_REQUEST', `Requisição lenta: ${duration}ms`);
    }

    // Verificar taxa de erro
    const errorRate = this.metrics.errorsTotal / this.metrics.requestsTotal;
    if (errorRate > this.thresholds.errorRate && this.metrics.requestsTotal > 100) {
      this.alert('HIGH_ERROR_RATE', `Taxa de erro: ${(errorRate * 100).toFixed(2)}%`);
    }
  }

  recordError(error, context) {
    this.metrics.lastErrorAt = new Date();
    this.metrics.lastError = error.message;

    // Alert em espike de erros
    if (this.metrics.errors5xx > this.thresholds.errorSpikeCount) {
      this.alert('ERROR_SPIKE', `${this.metrics.errors5xx} erros em 1 minuto`);
    }

    logger.error({ error: error.message, context }, 'Erro registrado');
  }

  alert(type, message) {
    const alert = {
      type,
      message,
      timestamp: new Date(),
      severity: this.getSeverity(type)
    };

    this.alerts.push(alert);
    logger.warn(alert, `⚠️ ALERTA: ${message}`);

    // Manter apenas últimas 100 alerts em memória
    if (this.alerts.length > 100) {
      this.alerts.shift();
    }
  }

  getSeverity(type) {
    const severities = {
      'SLOW_REQUEST': 'low',
      'HIGH_ERROR_RATE': 'high',
      'ERROR_SPIKE': 'critical',
      'DB_POOL_EXHAUSTED': 'critical',
      'MEMORY_LEAK': 'critical'
    };
    return severities[type] || 'medium';
  }

  resetMinuteMetrics() {
    this.metrics.requestsPerMinute = this.metrics.requestsTotal;
    // Não resetar requestsTotal, apenas manter rolling count
  }

  getMetrics() {
    return {
      ...this.metrics,
      errorRate: (this.metrics.errorsTotal / this.metrics.requestsTotal * 100).toFixed(2) + '%',
      uptime: process.uptime(),
      memory: process.memoryUsage()
    };
  }

  getAlerts(type = null, severity = null) {
    let filtered = this.alerts;

    if (type) {
      filtered = filtered.filter(a => a.type === type);
    }

    if (severity) {
      filtered = filtered.filter(a => a.severity === severity);
    }

    return filtered;
  }
}

// Singleton
let monitor = null;

function getMonitor() {
  if (!monitor) {
    monitor = new Monitor();
  }
  return monitor;
}

module.exports = {
  getMonitor,
  recordRequest: (status, duration) => getMonitor().recordRequest(status, duration),
  recordError: (error, context) => getMonitor().recordError(error, context),
  alert: (type, message) => getMonitor().alert(type, message),
  getMetrics: () => getMonitor().getMetrics(),
  getAlerts: (type, severity) => getMonitor().getAlerts(type, severity)
};
