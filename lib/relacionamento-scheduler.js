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
const { emitirCupom } = require('./cupons');
const { planoDoTenant, temFeature } = require('./planos');

const HORA_ALVO = 6;   // 06:00 — backup roda 02:00, renovacao/cobranca 03:00
const DIAS_RETENCAO = 90;

function hojeLocal() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

// Gera e grava as acoes do dia de UM tenant. Devolve quantas nasceram.
//
// -- ONDE O CUPOM NASCE, E POR QUE AQUI --
//
// A `mensagem` e' gravada JA INTERPOLADA (migration 031): o texto que a lojista leu
// ontem e' o que ela manda hoje. Entao o codigo nominal do cupom (VOLTE20-K3P9)
// precisa existir ANTES de a mensagem ser escrita — nao da' pra "injetar depois"
// num texto que a lojista talvez ja tenha editado.
//
// O cupom nasce RASCUNHO: ele NAO vale no PDV ate a lojista de fato enviar a
// mensagem (routes/relacionamento.js -> ativarCupomDaAcao). Assim, contato que ela
// nunca enviou nao deixa desconto pendurado, e a validade so comeca a contar quando
// a cliente de fato recebe o codigo.
function gerarAcoesDoTenant(tenantId, data) {
  // IDEMPOTENCIA: o scheduler roda todo dia as 06:00 E no catch-up de 10s do boot.
  // Se eu emitisse o cupom e SO DEPOIS descobrisse (pelo INSERT OR IGNORE) que a
  // acao ja existia, cada rerun deixaria um cupom orfao no banco. Entao a checagem
  // vem ANTES: sei o que ja existe, e nem chego a emitir.
  const jaExiste = db.prepare(
    'SELECT 1 FROM crm_acoes WHERE tenant_id = ? AND data = ? AND cliente_id = ? AND tipo = ?'
  );

  let novas = 0;

  db.transaction(() => {
    // Cupons emitidos nesta rodada, pra amarrar ao id da acao logo apos o INSERT.
    // (O cupom nasce antes da acao existir — a acao_id so e' conhecida depois.)
    const paraAmarrar = [];

    const acoes = acoesDoDia(tenantId, data, {
      // O gerador (acoesDoDia) e' PURO: ele nao escreve no banco. Quem escreve e'
      // este callback, que so o scheduler passa. Ele emite o codigo nominal e o
      // devolve pro crm.js re-renderizar a mensagem JA COM ele.
      emitirCupom: (cli, tipo, { prefixo, pct, dias }) => {
        if (jaExiste.get(tenantId, data, cli.id, tipo)) return null;  // acao ja existe: nao emite
        return emitirCupom(tenantId, {
          clienteId: cli.id, tipo, prefixo, pct, dias, status: 'rascunho',
        });
      },
    });

    if (!acoes.length) return;

    // INSERT OR IGNORE continua sendo a rede de seguranca contra o UNIQUE
    // (tenant_id, data, cliente_id, tipo) — e o que impede ressuscitar acao ja
    // enviada ou ignorada (o IGNORE bate no UNIQUE, nao olha o status).
    const ins = db.prepare(`
      INSERT OR IGNORE INTO crm_acoes
        (tenant_id, data, cliente_id, tipo, prioridade, label, detalhe, mensagem, segmento, cupom, cupom_id, status)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pendente')
    `);
    const amarrar = db.prepare('UPDATE crm_cupons SET acao_id = ? WHERE id = ? AND tenant_id = ?');

    for (const a of acoes) {
      const r = ins.run(tenantId, data, a.cliente_id, a.tipo, a.prioridade,
                        a.label || null, a.detalhe || null, a.mensagem,
                        a.segmento || null, a.cupom || null, a.cupom_id || null);
      if (r.changes) {
        novas++;
        if (a.cupom_id) paraAmarrar.push([Number(r.lastInsertRowid), a.cupom_id]);
      } else if (a.cupom_id) {
        // Cinto e suspensorio: se o INSERT foi ignorado apesar da checagem acima
        // (corrida entre dois processos), o cupom recem-criado nao tem dono. Apaga.
        db.prepare('DELETE FROM crm_cupons WHERE id = ? AND tenant_id = ?').run(a.cupom_id, tenantId);
      }
    }

    for (const [acaoId, cupomId] of paraAmarrar) amarrar.run(acaoId, cupomId, tenantId);
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

  // Cupom que nunca foi enviado (rascunho) ou que a lojista cancelou nao vale nada e
  // nao mede nada. Os USADOS ficam pra sempre (sao a evidencia da atribuicao: "o
  // REAT_2 trouxe 6 clientes"), e os ATIVOS expirados tambem — "mandei 40, 30
  // expiraram" e' justamente o sinal mais valioso do relatorio.
  const c = db.prepare(`
    DELETE FROM crm_cupons
    WHERE status IN ('rascunho', 'cancelado') AND emitido_em < date('now', '-${DIAS_RETENCAO} days')
  `).run();
  if (c.changes) console.log(`[RELACIONAMENTO] ${c.changes} cupom(ns) não usados removidos`);
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
