// ============================================================
// Agendador de Cobrança e Bloqueio — SaaS Billing
// Roda diariamente às 03:00 para:
// 1. Verificar assinaturas vencidas e bloquear tenants
// 2. Hard-delete de contas marcadas pra deletion após 30 dias
// 3. Enviar emails de aviso de renovação
// ============================================================
const { db } = require('../db/database');
const { verificarEBloquearPorAtrasoComStrike } = require('./stripe');
const { enviarEmail, templateAvisoRenovacao, templateAvisoUltimoDia } = require('./email');

function iniciar_cobranca_scheduler() {
  console.log('[COBRANÇA] Agendador iniciado');

  async function executarVerificacao() {
    try {
      console.log(`[COBRANÇA] Executando verificação (${new Date().toLocaleString('pt-BR')})`);

      // 1️⃣ Verificar bloqueio por atraso de assinatura
      const tenants = db.prepare('SELECT id FROM tenants WHERE status = ?').all('ativo');
      for (const t of tenants) {
        await verificarEBloquearPorAtrasoComStrike(t.id);
      }

      // 2️⃣ Hard-delete de contas marcadas pra deletion
      const hoje = new Date().toISOString().split('T')[0];
      const parafDelete = db.prepare(`
        SELECT * FROM delecoes_agendadas
        WHERE DATE(agendado_para) <= ?
      `).all(hoje);

      for (const d of parafDelete) {
        try {
          console.log(`[DELECAO] Hard-delete iniciado para tenant ${d.tenant_id}`);

          const tx = db.transaction(() => {
            // Deletar todos os dados (cascata)
            db.prepare('DELETE FROM variacoes WHERE produto_id IN (SELECT id FROM produtos WHERE tenant_id = ?)').run(d.tenant_id);
            db.prepare('DELETE FROM produtos WHERE tenant_id = ?').run(d.tenant_id);
            db.prepare('DELETE FROM clientes WHERE tenant_id = ?').run(d.tenant_id);
            db.prepare('DELETE FROM venda_itens WHERE venda_id IN (SELECT id FROM vendas WHERE tenant_id = ?)').run(d.tenant_id);
            db.prepare('DELETE FROM venda_pagamentos WHERE venda_id IN (SELECT id FROM vendas WHERE tenant_id = ?)').run(d.tenant_id);
            db.prepare('DELETE FROM vendas WHERE tenant_id = ?').run(d.tenant_id);
            db.prepare('DELETE FROM usuarios WHERE tenant_id = ?').run(d.tenant_id);
            db.prepare('DELETE FROM assinaturas WHERE tenant_id = ?').run(d.tenant_id);
            db.prepare('DELETE FROM cobracas WHERE tenant_id = ?').run(d.tenant_id);
            db.prepare('DELETE FROM config WHERE tenant_id = ?').run(d.tenant_id);
            db.prepare('DELETE FROM tenants WHERE id = ?').run(d.tenant_id);
          });

          tx();

          console.log(`✅ [DELECAO] Tenant ${d.tenant_id} deletado permanentemente`);
        } catch (err) {
          console.error(`❌ [DELECAO] Erro ao deletar tenant ${d.tenant_id}:`, err.message);
        }

        // Remover da fila de deleção
        db.prepare('DELETE FROM delecoes_agendadas WHERE id = ?').run(d.id);
      }

      // 3️⃣ Enviar avisos de renovação
      const avisosRenovacao = db.prepare(`
        SELECT a.*, t.nome_loja, t.email
        FROM assinaturas a
        JOIN tenants t ON t.id = a.tenant_id
        WHERE a.cancelada_em IS NULL
          AND DATE(a.data_proxima_renovacao) = DATE('now', '+7 days')
      `).all();

      for (const aviso of avisosRenovacao) {
        try {
          await enviarEmail(aviso.email, {
            assunto: 'Sua assinatura renova em 7 dias',
            html: templateAvisoRenovacao(aviso.nome_loja, aviso.data_proxima_renovacao),
          });
          console.log(`📧 [AVISO] Email de renovação enviado para ${aviso.email}`);
        } catch (err) {
          console.error(`[AVISO] Erro ao enviar email para ${aviso.email}:`, err.message);
        }
      }

      // 4️⃣ Enviar avisos de último dia
      const avisosUltimoDia = db.prepare(`
        SELECT a.*, t.nome_loja, t.email
        FROM assinaturas a
        JOIN tenants t ON t.id = a.tenant_id
        WHERE a.cancelada_em IS NULL
          AND DATE(a.data_proxima_renovacao) = DATE('now', '+1 day')
      `).all();

      for (const aviso of avisosUltimoDia) {
        try {
          await enviarEmail(aviso.email, {
            assunto: 'Sua assinatura renova amanhã',
            html: templateAvisoUltimoDia(aviso.nome_loja),
          });
          console.log(`📧 [ÚLTIMO DIA] Email enviado para ${aviso.email}`);
        } catch (err) {
          console.error(`[ÚLTIMO DIA] Erro ao enviar email para ${aviso.email}:`, err.message);
        }
      }

      console.log('[COBRANÇA] Verificação concluída');
    } catch (err) {
      console.error('[COBRANÇA] Erro geral no scheduler:', err.message);
    }
  }

  // Calcular tempo até a próxima execução às 03:00
  const agora = new Date();
  const proximaExecucao = new Date(agora);
  proximaExecucao.setHours(3, 0, 0, 0);

  if (agora > proximaExecucao) {
    proximaExecucao.setDate(proximaExecucao.getDate() + 1);
  }

  const msAteProxima = proximaExecucao - agora;

  console.log(`[COBRANÇA] Próxima execução: ${proximaExecucao.toLocaleString('pt-BR')} (em ${Math.round(msAteProxima / 1000 / 60)} minutos)`);

  // Agendar primeira execução
  setTimeout(() => {
    executarVerificacao();

    // Repetir a cada 24 horas
    setInterval(executarVerificacao, 24 * 60 * 60 * 1000);
  }, msAteProxima);

  // Executar também 30 segundos após o boot (teste rápido)
  setTimeout(() => {
    console.log('[COBRANÇA] Verificação inicial de bloqueio (após 30s do boot)');
    executarVerificacao();
  }, 30000);
}

module.exports = { iniciar_cobranca_scheduler };
