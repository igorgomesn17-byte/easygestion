// ============================================================
// Defaults de config do RELACIONAMENTO (clube de fidelidade + regua).
//
// Mora aqui, e nao solto na migration ou no signup, porque precisa dos DOIS:
// a migration 033 semeia os tenants que ja existem, e o signup semeia os que
// nascem depois dela. Duas listas separadas divergem no primeiro dia em que
// alguem adiciona uma chave num lado so.
//
// datas_comerciais nasce '[]' de proposito: as datas comemorativas de uma loja
// (com o texto da mensagem dentro) NAO podem vazar pra base de outra.
// ============================================================

const DEFAULTS_RELACIONAMENTO = {
  clube_nome: 'Clube de Fidelidade',
  clube_ativo: '1',
  clube_valor_selo: '50',           // a cada R$ 50 gastos, 1 selo
  clube_total_selos: '10',          // 10 selos completam o cartao
  clube_valor_premio: '50',         // premio = vale-credito de R$ 50
  clube_vale_validade_dias: '30',   // o vale do clube expira em 30 dias
  clube_vale_min_compra: '100',     // e' usavel em compra a partir de R$ 100
  loja_instagram: '',
  loja_instagram_url: '',
  loja_google_review: '',
  datas_comerciais: '[]',
};

// Semeia os defaults de UM tenant. INSERT OR IGNORE: nao sobrescreve quem ja
// configurou. Idempotente — pode rodar quantas vezes quiser.
function semearConfigRelacionamento(db, tenantId) {
  const ins = db.prepare('INSERT OR IGNORE INTO config (tenant_id, chave, valor) VALUES (?, ?, ?)');
  for (const [chave, valor] of Object.entries(DEFAULTS_RELACIONAMENTO)) {
    ins.run(tenantId, chave, valor);
  }
}

module.exports = { DEFAULTS_RELACIONAMENTO, semearConfigRelacionamento };
