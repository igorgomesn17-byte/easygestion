// ============================================================
// Sistema de Alertas — Detecta clientes em risco de churn
// Executado diariamente por agendador (cron)
// ============================================================
const { db } = require('../db/database');

/**
 * Gera alertas de risco de churn baseado em:
 * 1. Pagamentos atrasados (>7 dias vencido)
 * 2. Inatividade (>7 dias sem login)
 * 3. Nunca usou (cadastrou mas não entrou)
 * 4. Erros de integração (sincronização falhou)
 */
function gerarAlertas() {
  try {
    const hoje = new Date();
    const hoje_str = hoje.toISOString().split('T')[0]; // YYYY-MM-DD

    console.log(`[ALERTAS] Iniciando geração de alertas (${hoje_str})`);

    // 1️⃣ ALERTAS DE ATRASO DE PAGAMENTO
    // Cobranças vencidas há > 7 dias
    const diasAtrasoMinimo = 7;
    const pagamentosAtrasados = db.prepare(`
      SELECT
        c.tenant_id,
        t.nome_loja,
        t.email,
        COUNT(*) as qtd_atrasadas,
        MIN(c.data_cobranca) as primeira_vencida,
        SUM(CASE WHEN c.status = 'pendente' THEN c.valor ELSE 0 END) as valor_pendente,
        JULIANDAY(?) - JULIANDAY(c.data_cobranca) as dias_atraso
      FROM cobracas c
      JOIN tenants t ON t.id = c.tenant_id
      JOIN assinaturas a ON a.id = c.assinatura_id
      WHERE c.status IN ('pendente', 'vencido')
        AND JULIANDAY(?) - JULIANDAY(c.data_cobranca) > ?
        AND t.status = 'ativo'
      GROUP BY c.tenant_id
    `).all(hoje_str, hoje_str, diasAtrasoMinimo);

    pagamentosAtrasados.forEach(p => {
      // Verificar se já existe alerta ativo deste tipo
      const alertaExistente = db.prepare(`
        SELECT id FROM alertas_clientes
        WHERE tenant_id = ? AND tipo = 'atraso_pagamento' AND resolvido_em IS NULL
      `).get(p.tenant_id);

      if (!alertaExistente) {
        db.prepare(`
          INSERT INTO alertas_clientes (tenant_id, tipo, dias_atraso, valor_em_risco, mensagem, criado_em)
          VALUES (?, 'atraso_pagamento', ?, ?, ?, datetime('now', 'localtime'))
        `).run(
          p.tenant_id,
          Math.floor(p.dias_atraso),
          p.valor_pendente,
          `${p.qtd_atrasadas} cobrança(s) ${Math.floor(p.dias_atraso)} dias vencida(s)`
        );
        console.log(`  ✅ Alerta: ${p.nome_loja} tem pagamento atrasado`);
      }
    });

    // 2️⃣ ALERTAS DE INATIVIDADE
    // Não acessam há > 7 dias
    const diasInatividadeMinima = 7;
    const clientesInativos = db.prepare(`
      SELECT
        t.id as tenant_id,
        t.nome_loja,
        t.email,
        t.ultimo_acesso,
        a.valor_mensal,
        JULIANDAY(?) - JULIANDAY(COALESCE(t.ultimo_acesso, t.data_cadastro)) as dias_inativo
      FROM tenants t
      LEFT JOIN assinaturas a ON a.tenant_id = t.id
      WHERE t.status = 'ativo'
        AND JULIANDAY(?) - JULIANDAY(COALESCE(t.ultimo_acesso, t.data_cadastro)) > ?
        AND t.data_cadastro < datetime(?, '-' || ? || ' days')  -- cadastrou há > 2 semanas
    `).all(
      hoje_str, hoje_str, diasInatividadeMinima,
      hoje_str, diasInatividadeMinima + 7
    );

    clientesInativos.forEach(c => {
      const alertaExistente = db.prepare(`
        SELECT id FROM alertas_clientes
        WHERE tenant_id = ? AND tipo = 'inativo' AND resolvido_em IS NULL
      `).get(c.tenant_id);

      if (!alertaExistente) {
        db.prepare(`
          INSERT INTO alertas_clientes (tenant_id, tipo, dias_sem_atividade, valor_em_risco, mensagem, criado_em)
          VALUES (?, 'inativo', ?, ?, ?, datetime('now', 'localtime'))
        `).run(
          c.tenant_id,
          Math.floor(c.dias_inativo),
          c.valor_mensal || 0,
          `Sem atividade há ${Math.floor(c.dias_inativo)} dias`
        );
        console.log(`  ✅ Alerta: ${c.nome_loja} está inativo`);
      }
    });

    // 3️⃣ ALERTAS: NUNCA USOU
    // Cadastrou há > 14 dias mas não entrou no app
    const diasPraEntrarMinimo = 14;
    const clientesNuncaUsaram = db.prepare(`
      SELECT
        t.id as tenant_id,
        t.nome_loja,
        t.email,
        t.data_cadastro,
        a.valor_mensal,
        JULIANDAY(?) - JULIANDAY(t.data_cadastro) as dias_cadastro
      FROM tenants t
      LEFT JOIN assinaturas a ON a.tenant_id = t.id
      WHERE t.status = 'ativo'
        AND t.ultimo_acesso IS NULL
        AND JULIANDAY(?) - JULIANDAY(t.data_cadastro) > ?
    `).all(hoje_str, hoje_str, diasPraEntrarMinimo);

    clientesNuncaUsaram.forEach(c => {
      const alertaExistente = db.prepare(`
        SELECT id FROM alertas_clientes
        WHERE tenant_id = ? AND tipo = 'nunca_usou' AND resolvido_em IS NULL
      `).get(c.tenant_id);

      if (!alertaExistente) {
        db.prepare(`
          INSERT INTO alertas_clientes (tenant_id, tipo, dias_sem_atividade, valor_em_risco, mensagem, criado_em)
          VALUES (?, 'nunca_usou', ?, ?, ?, datetime('now', 'localtime'))
        `).run(
          c.tenant_id,
          Math.floor(c.dias_cadastro),
          c.valor_mensal || 0,
          `Cadastrou há ${Math.floor(c.dias_cadastro)} dias mas nunca entrou no app`
        );
        console.log(`  ✅ Alerta: ${c.nome_loja} nunca usou o sistema`);
      }
    });

    console.log('[ALERTAS] ✅ Geração de alertas concluída');
  } catch (err) {
    console.error('[ALERTAS] ❌ Erro ao gerar alertas:', err.message);
  }
}

/**
 * Limpa alertas muito antigos (>30 dias resolvidos)
 */
function limparAlertasAntigos() {
  try {
    const result = db.prepare(`
      DELETE FROM alertas_clientes
      WHERE resolvido_em IS NOT NULL
        AND JULIANDAY(datetime('now')) - JULIANDAY(resolvido_em) > 30
    `).run();

    console.log(`[ALERTAS] Limpeza: ${result.changes} alertas antigos removidos`);
  } catch (err) {
    console.error('[ALERTAS] Erro ao limpar alertas:', err.message);
  }
}

module.exports = {
  gerarAlertas,
  limparAlertasAntigos
};
