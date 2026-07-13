// ============================================================
// AGENDADOR DA REGUA — materializa as tarefas de contato do dia.
//
// -- O PROBLEMA QUE ELE RESOLVE --
//
// No sistema de onde a regua veio nao havia scheduler: a tela recalculava tudo a
// cada visita. O preco disso era caro e invisivel — os gatilhos de dia EXATO
// (pos-venda no dia 3, avaliacao no 5, indicacao no 10) so existiam NO dia deles.
// Loja fechada na segunda? Todo mundo que comprou na sexta perdeu o pos-venda, pra
// sempre. Ninguem percebia, porque o que nao foi gerado nao aparece em lugar nenhum.
//
// Materializando numa tabela, a acao nasce no dia certo e fica esperando. E ainda
// paga tres coisas de graca: adiar (snooze), historico do que foi enviado, e a
// contagem de pendentes pro badge do menu.
//
// -- POR TENANT, NAO GLOBAL --
//
// Os outros schedulers deste projeto (backup, alertas, cobranca) rodam globais.
// Este NAO pode: acoesDoDia() exige tenantId, e cada loja tem sua config, seus
// clientes e seus templates. Ele itera os tenants e isola a falha de cada um —
// uma loja com dado corrompido nao pode impedir as outras de receberem a regua.
// ============================================================
const { db } = require('../db/database');
const { acoesDoDia } = require('./crm');
const { planoDoTenant, temFeature } = require('./planos');

const HORA_ALVO = 6;   // 06:00 — backup roda 02:00, renovacao/cobranca 03:00
const DIAS_RETENCAO = 90;

function hojeLocal() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

// Gera e grava as acoes do dia de UM tenant. Devolve quantas nasceram.
function gerarAcoesDoTenant(tenantId, data) {
  const acoes = acoesDoDia(tenantId, data);
  if (!acoes.length) return 0;

  // INSERT OR IGNORE contra o UNIQUE(tenant_id, data, cliente_id, tipo):
  //  - rodar 5x no mesmo dia nao duplica;
  //  - e, o que importa mais, NAO RESSUSCITA acao ja enviada ou ignorada. O IGNORE
  //    bate no UNIQUE, nao olha o status — a linha existe, entao nao insere de novo.
  const ins = db.prepare(`
    INSERT OR IGNORE INTO crm_acoes
      (tenant_id, data, cliente_id, tipo, prioridade, label, detalhe, mensagem, segmento, cupom, status)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pendente')
  `);

  let novas = 0;
  db.transaction(() => {
    for (const a of acoes) {
      const r = ins.run(tenantId, data, a.cliente_id, a.tipo, a.prioridade,
                        a.label || null, a.detalhe || null, a.mensagem,
                        a.segmento || null, a.cupom || null);
      if (r.changes) novas++;
    }
  })();
  return novas;
}

// Varre todos os tenants que podem usar a regua.
function gerarAcoesDoDia(data = hojeLocal()) {
  const tenants = db.prepare("SELECT id FROM tenants WHERE status IN ('ativo', 'teste')").all();
  let totalNovas = 0, lojas = 0;

  for (const t of tenants) {
    try {
      // Nao gera dado que a loja nao pode nem ver — e evita processar a base inteira
      // de quem nao contratou o recurso.
      if (!temFeature(planoDoTenant(t.id), 'relacionamento')) continue;
      const novas = gerarAcoesDoTenant(t.id, data);
      if (novas > 0) { totalNovas += novas; lojas++; }
    } catch (e) {
      // Uma loja com dado ruim nao pode calar a regua das outras.
      console.error(`[RELACIONAMENTO] tenant ${t.id} falhou: ${e.message}`);
    }
  }

  if (totalNovas > 0) {
    console.log(`[RELACIONAMENTO] ${totalNovas} ação(ões) geradas em ${lojas} loja(s) — ${data}`);
  }
  return totalNovas;
}

// Acao velha ja foi enviada, adiada ou perdeu a validade: nao serve pra nada.
function limparAcoesAntigas() {
  const r = db.prepare(`DELETE FROM crm_acoes WHERE data < date('now', '-${DIAS_RETENCAO} days')`).run();
  if (r.changes) console.log(`[RELACIONAMENTO] ${r.changes} ação(ões) antigas removidas`);
}

function iniciar_relacionamento_scheduler() {
  console.log('[RELACIONAMENTO] Agendador iniciado');

  function executar() {
    console.log(`[RELACIONAMENTO] Gerando ações do dia (${new Date().toLocaleString('pt-BR')})`);
    try {
      gerarAcoesDoDia();
      limparAcoesAntigas();
    } catch (e) {
      console.error('[RELACIONAMENTO] Falha na geração:', e.message);
    }
  }

  const agora = new Date();
  const proxima = new Date(agora);
  proxima.setHours(HORA_ALVO, 0, 0, 0);
  if (agora > proxima) proxima.setDate(proxima.getDate() + 1);
  const ms = proxima - agora;

  console.log(`[RELACIONAMENTO] Próxima execução: ${proxima.toLocaleString('pt-BR')} (em ${Math.round(ms / 60000)} minutos)`);
  setTimeout(() => {
    executar();
    setInterval(executar, 24 * 60 * 60 * 1000);
  }, ms);

  // CATCH-UP: o servidor pode ter passado das 06:00 fora do ar (deploy, reboot).
  // Sem isto, a regua daquele dia so apareceria no dia seguinte. O INSERT OR IGNORE
  // torna isso seguro — rodar de novo nao duplica nada.
  setTimeout(() => {
    console.log('[RELACIONAMENTO] Verificação inicial (10s após o boot)');
    try { gerarAcoesDoDia(); } catch (e) { console.error('[RELACIONAMENTO]', e.message); }
  }, 10000);
}

module.exports = {
  iniciar_relacionamento_scheduler,
  gerarAcoesDoDia,
  gerarAcoesDoTenant,
  limparAcoesAntigas,
  hojeLocal,
};
