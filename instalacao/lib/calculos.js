// ============================================================
// Regras de negocio: taxas, precificacao por CUSTO TOTAL, lucro real
// Centraliza a matematica para o sistema inteiro usar o mesmo calculo.
// ============================================================
const { getConfig } = require('../db/database');

function cfgNum(chave, fallback) {
  const v = getConfig(chave, null);
  return v ***REMOVED***== null ? parseFloat(v) : fallback;
}

// Retorna a taxa (%) da forma de pagamento escolhida
function taxaPorForma(forma, parcelas = 1) {
  switch (forma) {
    case 'pix':            return cfgNum('taxa_pix', 0);
    case 'pix_chave':      return cfgNum('taxa_pix_chave', 0);   // Pix direto na chave: sem taxa
    case 'dinheiro':       return 0;
    case 'debito':         return cfgNum('taxa_debito', 1.37);
    case 'credito_vista':  return cfgNum('taxa_credito_vista', 3.15);
    case 'credito_parcelado': {
      const map = { 2: 'taxa_credito_2x', 3: 'taxa_credito_3x', 4: 'taxa_credito_4x', 5: 'taxa_credito_5x', 6: 'taxa_credito_6x' };
      return cfgNum(map[parcelas] || 'taxa_credito_6x', 8.28);
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
function sugerirPreco(custo) {
  const markup = cfgNum('markup', 2.4);
  if (***REMOVED***custo || custo <= 0) return 0;
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

  const frete = opc.frete ***REMOVED***= null ? opc.frete : cfgNum('frete_unit', 0);
  const embalagem = opc.embalagem ***REMOVED***= null ? opc.embalagem : cfgNum('embalagem_unit', 1);
  const impostoPct = cfgNum('imposto_simples', 7.30);
  const comissaoPct = opc.comissaoPct ***REMOVED***= null ? opc.comissaoPct : cfgNum('comissao_padrao', 5);
  // taxa de referencia para formar/avaliar o preco (default credito a vista)
  const taxaRefPct = opc.taxaPct ***REMOVED***= null ? opc.taxaPct : cfgNum('taxa_referencia_preco', 3.15);

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
function resultadoVenda(total, custoTotal, forma, parcelas = 1, comissaoPct = 0, embalagemTotal = 0, freteTotal = 0) {
  const taxaPct = taxaPorForma(forma, parcelas);
  const impostoPct = cfgNum('imposto_simples', 7.30);

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
function impactoDesconto(totalSemDesconto, desconto, custoTotal, forma, parcelas, comissaoPct, embalagemTotal, freteTotal) {
  const antes = resultadoVenda(totalSemDesconto, custoTotal, forma, parcelas, comissaoPct, embalagemTotal, freteTotal);
  const totalCom = Math.max(totalSemDesconto - desconto, 0);
  const depois = resultadoVenda(totalCom, custoTotal, forma, parcelas, comissaoPct, embalagemTotal, freteTotal);
  return {
    lucroAntes: antes.lucro, margemAntes: totalSemDesconto>0 ? +(antes.lucro/totalSemDesconto*100).toFixed(1) : 0,
    lucroDepois: depois.lucro, margemDepois: totalCom>0 ? +(depois.lucro/totalCom*100).toFixed(1) : 0,
    lucroPerdido: +(antes.lucro - depois.lucro).toFixed(2)
  };
}

// Quando parcelamento >= limite, a loja repassa a taxa ao cliente (acrescimo)
// retorna o acrescimo a somar ao total
function acrescimoParcelamento(total, parcelas) {
  const limite = cfgNum('parcelas_loja_absorve', 3);
  if (parcelas <= limite) return 0;
  const taxaPct = taxaPorForma('credito_parcelado', parcelas);
  return +(total * taxaPct / 100).toFixed(2);
}

module.exports = {
  taxaPorForma, arredondar990, sugerirPreco, analisarPreco,
  resultadoVenda, impactoDesconto, acrescimoParcelamento
};
