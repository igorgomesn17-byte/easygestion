// ============================================================
// Job de Renovação Automática de Assinaturas
// Executa todo dia às 03:00 para cobrar assinaturas que venceram
// ============================================================
const { db } = require('../db/database');
const { obterStatusAssinatura, criarCobranca, renovarAssinatura } = require('./assinatura');
const { criarAlerta } = require('./alertas');

let schedulerEmExecucao = false;

// ✅ Função principal: processar renovações
function procesarRenovacoes() {
  if (schedulerEmExecucao) {
    console.log('[RENOVAÇÃO] Job já em execução, aguardando...');
    return;
  }

  schedulerEmExecucao = true;
  const inicio = Date.now();

  try {
    const hoje = new Date().toISOString().split('T')[0];
    console.log(`\n[RENOVAÇÃO] Iniciando processamento em ${hoje} às ${new Date().toLocaleTimeString()}`);

    // 1️⃣ Encontrar assinaturas que venceram HOJE
    const assinaturasVencidas = db.prepare(`
      SELECT a.*, t.email, t.nome_loja
      FROM assinaturas a
      JOIN tenants t ON t.id = a.tenant_id
      WHERE a.data_proxima_renovacao = ?
        AND a.cancelada_em IS NULL
    `).all(hoje);

    console.log(`   📋 ${assinaturasVencidas.length} assinaturas para renovar hoje`);

    let cobradasComSucesso = 0;
    let erros = 0;

    assinaturasVencidas.forEach(ass => {
      try {
        // 2️⃣ Criar cobrança
        const cobranca = criarCobranca(ass.tenant_id, ass.valor_mensal, hoje);
        console.log(`   ✅ Cobrança criada: tenant=${ass.tenant_id} valor=R$${ass.valor_mensal} ref=${cobranca.id}`);

        // 3️⃣ Renovar data de próxima renovação
        renovarAssinatura(ass.tenant_id);
        console.log(`   🔄 Data de renovação atualizada: ${ass.tenant_id}`);

        // 4️⃣ Registrar alerta de cobrança pendente
        criarAlerta(ass.tenant_id, 'cobranca_pendente', {
          dias_atraso: 0,
          valor_em_risco: ass.valor_mensal,
          mensagem: `Cobrança de R$${ass.valor_mensal} criada. Pendente de pagamento.`,
        });

        cobradasComSucesso++;
      } catch (err) {
        console.error(`   ❌ Erro ao processar tenant ${ass.tenant_id}:`, err.message);
        erros++;
      }
    });

    // 5️⃣ Resumo
    const duracao = Date.now() - inicio;
    console.log(`\n[RENOVAÇÃO] ✨ Concluído em ${duracao}ms`);
    console.log(`   📊 Sucesso: ${cobradasComSucesso} | Erros: ${erros}`);

  } catch (err) {
    console.error('[RENOVAÇÃO] Erro crítico:', err);
  } finally {
    schedulerEmExecucao = false;
  }
}

// ✅ Calcular próxima execução (sempre às 03:00)
function calcularProximaExecucao() {
  const agora = new Date();
  const proxima = new Date();

  proxima.setHours(3, 0, 0, 0); // 03:00:00

  // Se já passou das 03:00, próxima é amanhã
  if (proxima <= agora) {
    proxima.setDate(proxima.getDate() + 1);
  }

  const milissegundos = proxima - agora;
  return { proxima, milissegundos };
}

// ✅ Iniciar scheduler
function iniciar_renovacao_scheduler() {
  console.log('[RENOVAÇÃO] 🚀 Iniciando scheduler de renovações...');

  // Executar uma vez na inicialização (após 10 segundos)
  setTimeout(() => {
    console.log('[RENOVAÇÃO] Executando verificação inicial...');
    procesarRenovacoes();
  }, 10000);

  // Agendar próxima execução
  function agendar() {
    const { proxima, milissegundos } = calcularProximaExecucao();
    console.log(`[RENOVAÇÃO] ⏰ Próxima execução: ${proxima.toLocaleString()}`);

    setTimeout(() => {
      procesarRenovacoes();
      agendar(); // Reagendar após execução
    }, milissegundos);
  }

  agendar();
}

module.exports = {
  iniciar_renovacao_scheduler,
  procesarRenovacoes,
};
