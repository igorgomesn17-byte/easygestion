// ============================================================
// Agendador de Alertas — roda geração de alertas diariamente
// Executa às 02:00 da manhã (horário local)
// ============================================================
const { gerarAlertas, limparAlertasAntigos } = require('./alertas');

function iniciar_alertas_scheduler() {
  console.log('[ALERTAS] Agendador iniciado');

  // Executar geração de alertas
  function executarGerador() {
    console.log(`[ALERTAS] Executando geração (${new Date().toLocaleString('pt-BR')})`);
    gerarAlertas();
    limparAlertasAntigos();
  }

  // Calcular tempo até a próxima execução às 02:00
  const agora = new Date();
  const proximaExecucao = new Date(agora);
  proximaExecucao.setHours(2, 0, 0, 0);

  // Se já passou de 02:00 hoje, agendar para amanhã
  if (agora > proximaExecucao) {
    proximaExecucao.setDate(proximaExecucao.getDate() + 1);
  }

  const msAteProxima = proximaExecucao - agora;

  console.log(`[ALERTAS] Próxima execução: ${proximaExecucao.toLocaleString('pt-BR')} (em ${Math.round(msAteProxima / 1000 / 60)} minutos)`);

  // Agendar primeira execução
  setTimeout(() => {
    executarGerador();

    // Depois, repetir a cada 24 horas
    setInterval(executarGerador, 24 * 60 * 60 * 1000);
  }, msAteProxima);

  // Executar também na primeira inicialização (se passaram > 24h sem rodar)
  // Pequeno delay pra não sobrecarregar o boot
  setTimeout(() => {
    console.log('[ALERTAS] Verificação inicial de alertas (após 10s do boot)');
    gerarAlertas();
  }, 10000);
}

module.exports = { iniciar_alertas_scheduler };
