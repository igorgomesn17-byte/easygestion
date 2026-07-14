// ============================================================
// Regras de negocio: taxas, precificacao por CUSTO TOTAL, lucro real
// Centraliza a matematica para o sistema inteiro usar o mesmo calculo.
// ============================================================
const { getConfig } = require('../db/database');

// ============================================================
// O TENANT E' OBRIGATORIO AQUI. LEIA ANTES DE MEXER.
//
// Estas funcoes decidem QUANTO A LOJA COBRA e QUANTO ELA LUCRA: taxa da maquininha,
// imposto, comissao, acrescimo de parcelamento, preco sugerido.
//
// Ate 14/07/2026 todas tinham `tenantId = 1` como default. E o PDV chamava sem passar
// o tenant. Efeito: TODA VENDA descontava a taxa de cartao da LOJA 1. Numa venda de
// R$1.000 no debito, com a loja 1 em 1,37% e a loja real em 0,85%, sao R$5,20 de
// lucro fantasma — em toda venda, sem nenhum erro aparecer em lugar nenhum.
//
// E' a mesma classe de bug do getConfig(chave, fallback, tenantId = 1): um default de
// tenant NAO QUEBRA — ELE MENTE. Por isso o guard abaixo, e por isso nenhuma funcao
// daqui volta a ter default.
// ============================================================
function exigirTenant(tenantId, fn) {
  const t = Number(tenantId);
  if (Number.isInteger(t) && t > 0) return t;

  const msg = `calculos.${fn}: tenantId obrigatorio — sem ele a loja calcula com a taxa/imposto de OUTRA loja`;
  // Em dev e teste, derruba: e' impossivel introduzir o bug sem perceber.
  if (process.env.NODE_ENV !== 'production') throw new Error(msg);
  // Em producao, nao derruba a venda na frente da cliente — mas grita no log.
  // (Cair no tenant 1 aqui e' o comportamento antigo; o log e' o que o denuncia.)
  console.error('[CALCULOS] ⚠️  ' + msg);
  return 1;
}

function cfgNum(chave, fallback, tenantId) {
  const v = getConfig(chave, null, exigirTenant(tenantId, 'cfgNum'));
  return v !== null ? parseFloat(v) : fallback;
}

// Retorna a taxa (%) da forma de pagamento escolhida
function taxaPorForma(forma, parcelas = 1, tenantId) {
  switch (forma) {
    case 'pix':            return cfgNum('taxa_pix', 0, tenantId);
    case 'pix_chave':      return cfgNum('taxa_pix_chave', 0, tenantId);   // Pix direto na chave: sem taxa
    case 'dinheiro':       return 0;
    // Crediário: quem financia é a loja, não passa maquininha — não há taxa a
    // descontar. Cairia no default e daria 0 do mesmo jeito, mas explícito é o que
    // impede alguém de mexer no default amanhã e cobrar taxa de cartão num carnê.
    case 'crediario':      return 0;
    case 'debito':         return cfgNum('taxa_debito', 1.37, tenantId);
    case 'credito_vista':  return cfgNum('taxa_credito_vista', 3.15, tenantId);
    case 'credito_parcelado': {
      const map = { 2: 'taxa_credito_2x', 3: 'taxa_credito_3x', 4: 'taxa_credito_4x', 5: 'taxa_credito_5x', 6: 'taxa_credito_6x' };
      return cfgNum(map[parcelas] || 'taxa_credito_6x', 8.28, tenantId);
    }
    default: return 0;
  }
}

// Arredonda PRA CIMA para o proximo valor terminando em 9,90 (ex: 96 -> 99,90; 120 -> 129,90)
function arredondar990(v) {
  const dezenaBase = Math.floor(v / 10) * 10;
  let candidato = dezenaBase + 9.90;
  if (candidato < v - 0.001) candidato += 10;
  return +candidato.toFixed(2);
}

// Sugere preco a partir do custo: custo * markup, arredondado para ...9,90
function sugerirPreco(custo, tenantId) {
  const markup = cfgNum('markup', 2.4, tenantId);
  if (!custo || custo <= 0) return 0;
  return arredondar990(custo * markup);
}

// Analise COMPLETA de precificacao por custo total.
// Mostra a margem de contribuicao real, decompondo todos os custos.
// formaPgto: forma usada para a taxa (default = taxa de referencia configurada)
// comissaoPct: % de comissao do vendedor (default = comissao_padrao)
function analisarPreco(custo, precoVenda, opc = {}) {
  custo = parseFloat(custo) || 0;
  precoVenda = parseFloat(precoVenda) || 0;
  if (precoVenda <= 0) return null;

  const tenantId = exigirTenant(opc.tenantId, 'analisarPreco');
  const frete = opc.frete != null ? opc.frete : cfgNum('frete_unit', 0, tenantId);
  const embalagem = opc.embalagem != null ? opc.embalagem : cfgNum('embalagem_unit', 1, tenantId);
  const impostoPct = cfgNum('imposto_simples', 7.30, tenantId);
  const comissaoPct = opc.comissaoPct != null ? opc.comissaoPct : cfgNum('comissao_padrao', 5, tenantId);
  // taxa de referencia para formar/avaliar o preco (default credito a vista)
  const taxaRefPct = opc.taxaPct != null ? opc.taxaPct : cfgNum('taxa_referencia_preco', 3.15, tenantId);

  const custoDireto = custo + frete + embalagem;

  const vImposto  = +(precoVenda * impostoPct / 100).toFixed(2);
  const vComissao = +(precoVenda * comissaoPct / 100).toFixed(2);
  const vTaxa     = +(precoVenda * taxaRefPct / 100).toFixed(2);

  const lucro = +(precoVenda - custoDireto - vImposto - vComissao - vTaxa).toFixed(2);
  const margemPct = +((lucro / precoVenda) * 100).toFixed(1);

  // cenario Pix (sem taxa de cartao)
  const lucroPix = +(precoVenda - custoDireto - vImposto - vComissao).toFixed(2);
  const margemPixPct = +((lucroPix / precoVenda) * 100).toFixed(1);

  const markup = custo > 0 ? +(precoVenda / custo).toFixed(2) : 0;

  return {
    custo, frete, embalagem, custoDireto, precoVenda, markup,
    impostoPct, vImposto, comissaoPct, vComissao, taxaRefPct, vTaxa,
    lucro, margemPct,           // cenario referencia (cartao)
    lucroPix, margemPixPct      // cenario Pix
  };
}

// Resultado financeiro REAL de uma venda concreta (usado no PDV/registro)
// total = valor que o cliente paga (ja com desconto/acrescimo)
// custoTotal = soma custo das pecas; embalagemTotal = embalagem * qtd itens
// comissaoPct = do vendedor da venda
function resultadoVenda(total, custoTotal, forma, parcelas = 1, comissaoPct = 0, embalagemTotal = 0, freteTotal = 0, tenantId) {
  const taxaPct = taxaPorForma(forma, parcelas, tenantId);
  const impostoPct = cfgNum('imposto_simples', 7.30, tenantId);

  const valorTaxa = +(total * taxaPct / 100).toFixed(2);
  const imposto   = +(total * impostoPct / 100).toFixed(2);
  const comissao  = +(total * comissaoPct / 100).toFixed(2);
  const liquido   = +(total - valorTaxa).toFixed(2);
  const lucro     = +(liquido - imposto - comissao - custoTotal - embalagemTotal - freteTotal).toFixed(2);

  return {
    taxaPct, valorTaxa, impostoPct, imposto, comissaoPct, comissao,
    liquido, custoTotal: +custoTotal.toFixed(2), embalagemTotal: +embalagemTotal.toFixed(2),
    freteTotal: +freteTotal.toFixed(2), lucro
  };
}

// Calcula impacto de um desconto no lucro (para o PDV mostrar)
// retorna lucro antes, lucro depois, e quanto se perde
//
// O tenantId nao existia aqui: a tela dizia "voce perde R$X de lucro com esse
// desconto" usando a taxa de cartao e o imposto DA LOJA 1. E' o numero que a
// atendente olha pra decidir se da' o desconto — nao pode ser da loja errada.
function impactoDesconto(totalSemDesconto, desconto, custoTotal, forma, parcelas, comissaoPct, embalagemTotal, freteTotal, tenantId) {
  const antes = resultadoVenda(totalSemDesconto, custoTotal, forma, parcelas, comissaoPct, embalagemTotal, freteTotal, tenantId);
  const totalCom = Math.max(totalSemDesconto - desconto, 0);
  const depois = resultadoVenda(totalCom, custoTotal, forma, parcelas, comissaoPct, embalagemTotal, freteTotal, tenantId);
  return {
    lucroAntes: antes.lucro, margemAntes: totalSemDesconto>0 ? +(antes.lucro/totalSemDesconto*100).toFixed(1) : 0,
    lucroDepois: depois.lucro, margemDepois: totalCom>0 ? +(depois.lucro/totalCom*100).toFixed(1) : 0,
    lucroPerdido: +(antes.lucro - depois.lucro).toFixed(2)
  };
}

// Quando parcelamento >= limite, a loja repassa a taxa ao cliente (acrescimo)
// retorna o acrescimo a somar ao total
function acrescimoParcelamento(total, parcelas, tenantId) {
  const limite = cfgNum('parcelas_loja_absorve', 3, tenantId);
  if (parcelas <= limite) return 0;
  const taxaPct = taxaPorForma('credito_parcelado', parcelas, tenantId);
  return +(total * taxaPct / 100).toFixed(2);
}

module.exports = {
  taxaPorForma, arredondar990, sugerirPreco, analisarPreco,
  resultadoVenda, impactoDesconto, acrescimoParcelamento
};
