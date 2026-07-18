// ============================================================
// DRE — Demonstração de Resultado do mês.
// FONTE ÚNICA do cálculo. Antes ele morava dentro de routes/financeiro.js
// e o dashboard não tinha como reaproveitá-lo sem passar pelos middlewares
// da rota (exigirPapel + exigirFeature + cache). Agora os dois importam daqui,
// então o "sobrou" do painel e o DRE completo NÃO PODEM divergir.
//
// Tudo é escopado por tenantId — inclusive as leituras de config. getConfig()
// tem `tenantId = 1` como default; omitir o argumento faz uma loja ler a
// alíquota de imposto e o regime fiscal de OUTRA.
// ============================================================
const { db, getConfig } = require('../db/database');

// Calcula o DRE de um mês ('YYYY-MM') para um tenant.
// Retorna o objeto completo que GET /api/financeiro/dre serve.
function calcularDRE(tenantId, mes) {
  const regimeFiscal = getConfig('regime_fiscal', 'simples', tenantId);

  const v = db.prepare(`
    SELECT COALESCE(SUM(total),0) AS receita_bruta,
           COALESCE(SUM(taxa_aplicada*total/100),0) AS taxas_cartao,
           COALESCE(SUM(comissao_valor),0) AS comissoes,
           COALESCE(SUM(custo_total),0) AS cmv,
           COALESCE(SUM(embalagem_total),0) AS embalagem,
           COUNT(*) AS num_vendas
    FROM vendas WHERE substr(data_hora,1,7) = ? AND tenant_id = ? AND (deletado IS NULL OR deletado = 0)
  `).get(mes, tenantId);

  // trocas do mes (impacto CMVR)
  const t = db.prepare(`
    SELECT COALESCE(SUM(cmvr_bruto),0) AS cmvr_trocas
    FROM trocas WHERE substr(data_hora,1,7) = ? AND tenant_id = ?
  `).get(mes, tenantId);

  // Despesas da EMPRESA (operacionais) — só centro='empresa'. Separadas em fixas/variáveis.
  const despFixas = db.prepare(`
    SELECT COALESCE(SUM(valor),0) AS v FROM despesas
    WHERE substr(data_competencia,1,7)=? AND recorrente=0 AND tipo='fixa' AND centro='empresa' AND tenant_id = ?
  `).get(mes, tenantId).v;
  const despVar = db.prepare(`
    SELECT COALESCE(SUM(valor),0) AS v FROM despesas
    WHERE substr(data_competencia,1,7)=? AND recorrente=0 AND tipo='variavel' AND centro='empresa' AND tenant_id = ?
  `).get(mes, tenantId).v;
  // Pró-labore / retiradas do dono (centro='pessoal') — abatem DEPOIS do operacional
  const proLabore = db.prepare(`
    SELECT COALESCE(SUM(valor),0) AS v FROM despesas
    WHERE substr(data_competencia,1,7)=? AND recorrente=0 AND centro='pessoal' AND tenant_id = ?
  `).get(mes, tenantId).v;

  const receitaBruta = +v.receita_bruta.toFixed(2);

  let impostos = 0;
  if (regimeFiscal === 'mei') {
    // MEI: paga boleto fixo mensal (incluído em despesas como categoria 'mei')
    const meiBoleto = db.prepare(`
      SELECT COALESCE(SUM(valor),0) AS v FROM despesas
      WHERE substr(data_competencia,1,7)=? AND recorrente=0 AND categoria='mei' AND tenant_id = ?
    `).get(mes, tenantId).v;
    impostos = +meiBoleto.toFixed(2);
  } else if (regimeFiscal === 'simples') {
    const impostoTaxa = parseFloat(getConfig('imposto_simples', '0', tenantId)) || 0;
    impostos = impostoTaxa > 0 ? +(receitaBruta * impostoTaxa / 100).toFixed(2) : 0;
  }

  const receitaLiquida = +(receitaBruta - impostos).toFixed(2);
  const cmv = +(v.cmv + t.cmvr_trocas).toFixed(2); // CMV + impacto de trocas
  const lucroBruto = +(receitaLiquida - cmv).toFixed(2);
  const taxasCartao = +v.taxas_cartao.toFixed(2);
  const comissoes = +v.comissoes.toFixed(2);
  const embalagem = +v.embalagem.toFixed(2);
  const despesasFixas = +despFixas.toFixed(2);
  const despesasVar = +despVar.toFixed(2);
  const proLaboreTotal = +proLabore.toFixed(2);
  // RESULTADO OPERACIONAL = lucro bruto - taxas - comissoes (vendedor) - embalagem - despesas da empresa
  // Inclui COMISSÃO porque é despesa operacional (paga o vendedor por vender)
  const resultadoOperacional = +(lucroBruto - taxasCartao - comissoes - embalagem - despesasFixas - despesasVar).toFixed(2);
  // RESULTADO FINAL = resultado operacional - pró-labore (retiradas do dono, não são operacionais)
  const resultadoFinal = +(resultadoOperacional - proLaboreTotal).toFixed(2);
  const margemOperacional = receitaBruta > 0 ? +((resultadoOperacional / receitaBruta) * 100).toFixed(1) : 0;
  const margemFinal = receitaBruta > 0 ? +((resultadoFinal / receitaBruta) * 100).toFixed(1) : 0;

  return {
    mes, num_vendas: v.num_vendas,
    receita_bruta: receitaBruta,
    impostos,
    receita_liquida: receitaLiquida,
    cmv,
    lucro_bruto: lucroBruto,
    taxas_cartao: taxasCartao,
    comissoes,
    embalagem,
    despesas_fixas: despesasFixas,
    despesas_variaveis: despesasVar,
    // resultado operacional (lucro da loja operando = antes de retiradas do dono)
    resultado_operacional: resultadoOperacional,
    margem_operacional: margemOperacional,
    // retiradas do dono (pró-labore) e resultado final (lucro de verdade)
    pro_labore: proLaboreTotal,
    resultado_final: resultadoFinal,
    margem_final: margemFinal,
    // compat: 'resultado' continua = operacional (telas antigas não quebram)
    resultado: resultadoOperacional,
    margem_liquida: margemOperacional,
  };
}

// "Esse mês entrou R$ X · saiu R$ Y · sobrou R$ Z" — a linha do painel.
// sobrou = resultado OPERACIONAL (antes das retiradas do dono): responde
// "a loja, operando, deu lucro?". Retirada do dono não é custo de operar.
// saiu é derivado de (entrou - sobrou) de propósito: assim os três números
// SEMPRE fecham na tela. Qualquer outra definição faz o lojista desconfiar da conta.
function resumoDoMes(tenantId, mes) {
  const dre = calcularDRE(tenantId, mes);
  const entrou = dre.receita_bruta;
  const sobrou = dre.resultado_operacional;
  const saiu = +(entrou - sobrou).toFixed(2);
  return { mes, entrou, saiu, sobrou, num_vendas: dre.num_vendas };
}

module.exports = { calcularDRE, resumoDoMes };
