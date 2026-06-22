// ============================================================
// Lógica de Assinaturas e Cobranças (SaaS)
// ============================================================
const { db } = require('../db/database');

// Estados possíveis de uma assinatura
const ESTADOS_ASSINATURA = {
  ATIVA: 'ativa',
  VENCIDA: 'vencida',
  PAGAMENTO_PENDENTE: 'pagamento_pendente',
  CANCELADA: 'cancelada',
  TRIAL: 'trial',
};

// Planos disponíveis
const PLANOS = {
  GRATIS: { nome: 'Grátis', valor: 0, dias_trial: 14 },
  BASICO: { nome: 'Básico', valor: 99, dias_trial: 0 },
  PRO: { nome: 'Pro', valor: 299, dias_trial: 0 },
  ENTERPRISE: { nome: 'Enterprise', valor: 999, dias_trial: 0 },
};

// ✅ Obter status atual da assinatura de um cliente
function obterStatusAssinatura(tenantId) {
  const assinatura = db.prepare(`
    SELECT a.*, t.status as tenant_status
    FROM assinaturas a
    LEFT JOIN tenants t ON t.id = a.tenant_id
    WHERE a.tenant_id = ?
  `).get(tenantId);

  if (***REMOVED***assinatura) {
    return {
      status: ESTADOS_ASSINATURA.TRIAL,
      motivo: 'Sem assinatura (trial)',
      dias_restantes: null,
      bloqueado: false,
    };
  }

  const hoje = new Date().toISOString().split('T')[0];
  const dataVencimento = assinatura.data_proxima_renovacao;

  // Se foi cancelada
  if (assinatura.cancelada_em) {
    return {
      status: ESTADOS_ASSINATURA.CANCELADA,
      motivo: `Cancelada em ${assinatura.cancelada_em}`,
      bloqueado: true,
      dataVencimento,
    };
  }

  // Verificar se há cobrança pendente (não paga)
  const cobrancaPendente = db.prepare(`
    SELECT * FROM cobracas
    WHERE tenant_id = ? AND status = 'pendente'
    ORDER BY data_cobranca DESC
    LIMIT 1
  `).get(tenantId);

  if (cobrancaPendente) {
    const diasAtraso = Math.floor((new Date(hoje) - new Date(cobrancaPendente.data_cobranca)) / (1000 * 60 * 60 * 24));
    return {
      status: ESTADOS_ASSINATURA.PAGAMENTO_PENDENTE,
      motivo: `Falta de pagamento (${diasAtraso} dias de atraso)`,
      bloqueado: diasAtraso > 7, // Bloqueia após 7 dias de atraso
      diasAtraso,
      dataVencimento,
    };
  }

  // Calcular dias restantes
  const diasRestantes = Math.floor((new Date(dataVencimento) - new Date(hoje)) / (1000 * 60 * 60 * 24));

  if (diasRestantes < 0) {
    return {
      status: ESTADOS_ASSINATURA.VENCIDA,
      motivo: `Assinatura vencida há ${Math.abs(diasRestantes)} dias`,
      bloqueado: true,
      diasRestantes,
      dataVencimento,
    };
  }

  return {
    status: ESTADOS_ASSINATURA.ATIVA,
    motivo: 'Assinatura ativa',
    bloqueado: false,
    diasRestantes,
    dataVencimento,
  };
}

// ✅ Criar assinatura para novo cliente
function criarAssinatura(tenantId, plano = 'basico', dataInicio = null) {
  const dataI = dataInicio || new Date().toISOString().split('T')[0];
  const planoConfig = PLANOS[plano.toUpperCase()] || PLANOS.BASICO;

  // Próxima renovação = hoje + 30 dias
  const dataProxRenovacao = new Date(dataI);
  dataProxRenovacao.setDate(dataProxRenovacao.getDate() + 30);
  const dataProxRenovacaoStr = dataProxRenovacao.toISOString().split('T')[0];

  const result = db.prepare(`
    INSERT INTO assinaturas (tenant_id, plano, valor_mensal, data_inicio, data_proxima_renovacao)
    VALUES (?, ?, ?, ?, ?)
  `).run(tenantId, plano, planoConfig.valor, dataI, dataProxRenovacaoStr);

  return {
    id: result.lastInsertRowid,
    tenant_id: tenantId,
    plano,
    valor_mensal: planoConfig.valor,
    data_inicio: dataI,
    data_proxima_renovacao: dataProxRenovacaoStr,
  };
}

// ✅ Criar cobrança (chamada quando assinatura vence)
function criarCobranca(tenantId, valor, dataCobranca = null) {
  const assinatura = db.prepare('SELECT id FROM assinaturas WHERE tenant_id = ?').get(tenantId);
  if (***REMOVED***assinatura) {
    throw new Error('Assinatura não encontrada para este tenant');
  }

  const dataC = dataCobranca || new Date().toISOString().split('T')[0];

  const result = db.prepare(`
    INSERT INTO cobracas (tenant_id, assinatura_id, data_cobranca, valor, status)
    VALUES (?, ?, ?, ?, 'pendente')
  `).run(tenantId, assinatura.id, dataC, valor);

  return {
    id: result.lastInsertRowid,
    tenant_id: tenantId,
    assinatura_id: assinatura.id,
    data_cobranca: dataC,
    valor,
    status: 'pendente',
  };
}

// ✅ Marcar cobrança como paga
function pagarCobranca(cobrancaId, metodoPagamento = 'stripe') {
  const dataPagamento = new Date().toISOString().split('T')[0];

  const result = db.prepare(`
    UPDATE cobracas
    SET status = 'pago', data_pagamento = ?, metodo_pagamento = ?
    WHERE id = ?
  `).run(dataPagamento, metodoPagamento, cobrancaId);

  if (result.changes === 0) {
    throw new Error('Cobrança não encontrada');
  }

  return {
    id: cobrancaId,
    status: 'pago',
    data_pagamento: dataPagamento,
    metodo_pagamento: metodoPagamento,
  };
}

// ✅ Renovar assinatura (próxima data de renovação)
function renovarAssinatura(tenantId) {
  const assinatura = db.prepare('SELECT * FROM assinaturas WHERE tenant_id = ?').get(tenantId);
  if (***REMOVED***assinatura) {
    throw new Error('Assinatura não encontrada');
  }

  // Próxima renovação = data_proxima_renovacao + 30 dias
  const dataProxRenovacao = new Date(assinatura.data_proxima_renovacao);
  dataProxRenovacao.setDate(dataProxRenovacao.getDate() + 30);
  const dataProxRenovacaoStr = dataProxRenovacao.toISOString().split('T')[0];

  const result = db.prepare(`
    UPDATE assinaturas
    SET data_proxima_renovacao = ?
    WHERE tenant_id = ?
  `).run(dataProxRenovacaoStr, tenantId);

  return {
    tenant_id: tenantId,
    data_proxima_renovacao: dataProxRenovacaoStr,
  };
}

// ✅ Cancelar assinatura
function cancelarAssinatura(tenantId, motivo = 'Cancelamento do cliente') {
  const resultado = db.prepare(`
    UPDATE assinaturas
    SET cancelada_em = ?, motivo_cancelamento = ?
    WHERE tenant_id = ?
  `).run(new Date().toISOString().split('T')[0], motivo, tenantId);

  if (resultado.changes === 0) {
    throw new Error('Assinatura não encontrada');
  }

  return {
    tenant_id: tenantId,
    cancelada_em: new Date().toISOString().split('T')[0],
    motivo: motivo,
  };
}

// ✅ Obter histórico de cobranças
function obterHistoricoCobracas(tenantId, dias = 90) {
  return db.prepare(`
    SELECT * FROM cobracas
    WHERE tenant_id = ? AND date(data_cobranca) >= date('now', '-' || ? || ' days')
    ORDER BY data_cobranca DESC
  `).all(tenantId, dias);
}

// ✅ Bloquear cliente automaticamente por atraso de pagamento
function verificarEBloquearPorAtraso(tenantId, diasAtrasoLimite = 7) {
  const status = obterStatusAssinatura(tenantId);

  if (status.bloqueado && status.status === ESTADOS_ASSINATURA.PAGAMENTO_PENDENTE) {
    // Buscar tenant
    const tenant = db.prepare('SELECT status FROM tenants WHERE id = ?').get(tenantId);

    if (tenant && tenant.status ***REMOVED***== 'bloqueado') {
      // Bloquear automaticamente
      db.prepare('UPDATE tenants SET status = ? WHERE id = ?').run('bloqueado', tenantId);

      console.log(`[ASSINATURA] Cliente ${tenantId} bloqueado por atraso de pagamento`);
      return {
        bloqueado: true,
        motivo: `Falta de pagamento (${status.diasAtraso} dias de atraso)`,
      };
    }
  }

  return {
    bloqueado: false,
    motivo: null,
  };
}

// ✅ Reativar cliente após pagamento
function reativarAposPagamento(tenantId) {
  const status = obterStatusAssinatura(tenantId);

  // Só reativa se a assinatura está ativa agora
  if (status.status === ESTADOS_ASSINATURA.ATIVA) {
    db.prepare('UPDATE tenants SET status = ? WHERE id = ?').run('ativo', tenantId);
    console.log(`[ASSINATURA] Cliente ${tenantId} reativado após pagamento`);
    return true;
  }

  return false;
}

module.exports = {
  ESTADOS_ASSINATURA,
  PLANOS,
  obterStatusAssinatura,
  criarAssinatura,
  criarCobranca,
  pagarCobranca,
  renovarAssinatura,
  cancelarAssinatura,
  obterHistoricoCobracas,
  verificarEBloquearPorAtraso,
  reativarAposPagamento,
};
