// ============================================================
// CLUBE DE FIDELIDADE — o cartao de selo que vira vale-credito.
//
// A cada R$ X gastos a cliente ganha 1 selo; N selos completam o cartao e viram um
// vale-credito de verdade (tabela `vales`), com validade. Nao e' pontos e nao e'
// cashback: e' o cartao de carimbo da padaria, digital.
//
// -- POR QUE O PREMIO NASCE DENTRO DA TRANSACAO DA VENDA --
//
// Ja aconteceu neste sistema: a baixa do vale morava no navegador, DEPOIS da venda
// gravada. Quando o front nao chamava (ou calculava 0), o vale ficava reutilizavel
// pra sempre. Aqui e' o mesmo risco invertido — se o premio nascer num job noturno
// ou num clique do front, existe o estado "a venda completou o cartao mas o vale nao
// existe". Ou os dois acontecem, ou nenhum.
//
// -- AS DUAS ARMADILHAS QUE ESTE ARQUIVO EVITA --
//
// 1. ANTI-FARMING: se o gasto pago COM o vale do clube gerasse selo, a cliente
//    ganharia premio em cima do premio e a loja financiaria a propria fidelidade.
//    Dai `clientes.gasto_sem_selo`: o quanto do total_gasto foi pago com vale do
//    clube. O calculo de selos subtrai isso.
//
// 2. HIGH-WATER MARK: DELETE /api/vendas devolve o total_gasto da cliente — ou seja,
//    CANCELAR UMA VENDA FAZ OS SELOS DIMINUIREM. Um controle ingenuo
//    ("selos % total === 0 -> emite") reemitiria o mesmo premio na proxima compra.
//    Por isso a idempotencia e' MAX(clube_ciclo): o numero do ultimo cartao ja pago
//    nunca anda pra tras, mesmo que o gasto ande.
// ============================================================
const { db, getConfig } = require('../db/database');
const { clubeCfg, clubeAtivo, exigirTenant } = require('./crm');

// Codigo do vale: 6 chars sem I, O, 0 e 1 — a cliente le em voz alta pro caixa.
function gerarCodigoVale() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let codigo = '';
  for (let i = 0; i < 6; i++) codigo += chars.charAt(Math.floor(Math.random() * chars.length));
  return 'VALE-' + codigo;
}

function validadeEmDias(dias) {
  const d = new Date();
  d.setDate(d.getDate() + (Number(dias) > 0 ? Number(dias) : 30));
  return d.toISOString().slice(0, 10);
}

// Quantos cartoes a cliente JA fechou, pelo gasto que conta pra selo.
function ciclosCompletosDe(cfg, cliente) {
  const gastoElegivel = Math.max(0, (cliente.total_gasto || 0) - (cliente.gasto_sem_selo || 0));
  const selos = Math.floor(gastoElegivel / cfg.valorSelo);
  return Math.floor(selos / cfg.totalSelos);
}

// ============================================================
// Emite o premio se a venda fechou um cartao novo. Devolve o vale criado, ou null.
//
// RODA DENTRO DA TRANSACAO DA VENDA — nao abre transacao propria, e precisa ser
// chamada DEPOIS do UPDATE que soma o total_gasto (senao le o valor velho).
// ============================================================
function emitirPremioClube(tenantId, clienteId, vendaId) {
  const t = exigirTenant(tenantId);
  if (!clienteId) return null;
  if (!clubeAtivo(t)) return null;

  const cfg = clubeCfg(t);
  // Config zerada faria Math.floor(x / 0) = Infinity — premio infinito. Guarda seca.
  if (!(cfg.valorSelo > 0) || !(cfg.totalSelos >= 1) || !(cfg.valorPremio > 0)) return null;

  const cli = db.prepare(
    'SELECT id, nome, total_gasto, gasto_sem_selo FROM clientes WHERE id = ? AND tenant_id = ?'
  ).get(clienteId, t);
  if (!cli) return null;

  const ciclos = ciclosCompletosDe(cfg, cli);
  if (ciclos < 1) return null;

  // A marca d'agua: o maior cartao ja premiado. MAX() nunca anda pra tras.
  const hw = db.prepare(`
    SELECT COALESCE(MAX(clube_ciclo), 0) AS ciclo FROM vales
    WHERE tenant_id = ? AND cliente_id = ? AND origem = 'clube'
  `).get(t, clienteId).ciclo;
  if (ciclos <= hw) return null;   // nada novo fechou

  // UM vale por venda, mesmo que a compra tenha pulado dois cartoes de uma vez
  // (compra enorme): grava o ciclo do TOPO, e o proximo premio so vem no cartao seguinte.
  const codigo = gerarCodigoVale();
  const validade = validadeEmDias(cfg.validadeDias);
  const nomeClube = cfg.nome;
  const info = db.prepare(`
    INSERT INTO vales (tenant_id, codigo, valor, saldo, origem, clube_ciclo, cliente_id, validade, notas, ativo)
    VALUES (?, ?, ?, ?, 'clube', ?, ?, ?, ?, 1)
  `).run(t, codigo, cfg.valorPremio, cfg.valorPremio, ciclos, clienteId, validade,
         `Prêmio do ${nomeClube} — ${ciclos}º cartão (venda #${vendaId})`);

  return {
    id: Number(info.lastInsertRowid),
    codigo,
    valor: cfg.valorPremio,
    validade,
    ciclo: ciclos,
    min_compra: cfg.minCompra,
    clube: nomeClube,
    cliente_nome: cli.nome,
  };
}

// ============================================================
// Registra que parte da compra foi paga com vale DO CLUBE — o anti-farming.
// Chamar dentro da tx da venda, ANTES do UPDATE do total_gasto.
// ============================================================
function registrarGastoSemSelo(tenantId, clienteId, valor) {
  const t = exigirTenant(tenantId);
  if (!clienteId || !(valor > 0)) return;
  db.prepare('UPDATE clientes SET gasto_sem_selo = gasto_sem_selo + ? WHERE id = ? AND tenant_id = ?')
    .run(valor, clienteId, t);
}

// Progresso do cartao pra exibir (cupom, tela da cliente, PDV).
function progressoDe(tenantId, clienteId) {
  const t = exigirTenant(tenantId);
  const cli = db.prepare('SELECT total_gasto, gasto_sem_selo FROM clientes WHERE id = ? AND tenant_id = ?').get(clienteId, t);
  if (!cli) return null;
  const { selosDe } = require('./crm');
  return selosDe(t, cli);
}

module.exports = { emitirPremioClube, registrarGastoSemSelo, progressoDe, gerarCodigoVale, validadeEmDias };
