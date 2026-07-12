// ============================================================
// CREDIARIO (carne) — a matematica pura.
//
// Sem I/O, sem banco: e' aqui que mora a regra, e e' isto que os testes atacam
// (tests/crediario.test.js). Quem fala com o banco e' routes/crediario.js.
//
// Crediario NAO e' parcelamento no cartao. No cartao a maquininha assume o risco
// e o dinheiro cai. Aqui quem financia e' a LOJA: a cliente leva a peca hoje e
// paga em N parcelas direto pra loja, e o calote e' prejuizo do lojista.
//
// Por decisao de produto NAO existe: juros, multa, mora, negativacao, consulta a
// bureau (SPC/Serasa). O alerta de credito sai 100% do historico da propria loja.
// ============================================================

const MAX_PARCELAS = 24;

// Soma meses a uma data 'YYYY-MM-DD' preservando o dia quando possivel.
//
// Construimos a data com componentes locais (new Date(ano, mes, dia)) em vez de
// new Date('2026-01-31'): a string ISO e' interpretada como UTC e, no fuso -3,
// volta um dia. O projeto ja foi mordido por isso (ver lib/datas.js).
//
// Virada de mes: 31/01 + 1 mes nao existe em fevereiro. O dia "transborda" pro
// mes seguinte (03/03) se deixarmos o Date resolver sozinho, e o vencimento
// pularia fevereiro inteiro. Entao prendemos no ultimo dia do mes de destino:
// 31/01 -> 28/02, e a parcela seguinte volta a cair em 31/03.
function somarMeses(dataISO, meses) {
  const [ano, mes, dia] = String(dataISO).split('-').map(Number);
  const alvoAno = ano + Math.floor((mes - 1 + meses) / 12);
  const alvoMes = ((mes - 1 + meses) % 12 + 12) % 12; // 0-11
  const ultimoDiaDoMes = new Date(alvoAno, alvoMes + 1, 0).getDate();
  const diaFinal = Math.min(dia, ultimoDiaDoMes);
  const d = new Date(alvoAno, alvoMes, diaFinal);
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${d.getFullYear()}-${mm}-${dd}`;
}

function ehDataValida(dataISO) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(dataISO || ''))) return false;
  const [ano, mes, dia] = String(dataISO).split('-').map(Number);
  const d = new Date(ano, mes - 1, dia);
  return d.getFullYear() === ano && d.getMonth() === mes - 1 && d.getDate() === dia;
}

// Gera as parcelas do carne. Vencimentos mensais a partir de dataPrimeira.
//
// O resto dos centavos: 400 / 3 = 133,333... Se arredondarmos todas igual, a soma
// da 399,99 ou 400,02 e o carne nao fecha com a venda. Regra: todas as parcelas
// levam o valor arredondado pra baixo e a DIFERENCA vai na PRIMEIRA. A loja recebe
// o centavo a mais cedo, e a ultima parcela (a que a cliente lembra) sai redonda.
//   400 em 3x -> 133,34 + 133,33 + 133,33 = 400,00
function gerarParcelas(valorFinanciado, numParcelas, dataPrimeira) {
  const valor = +(parseFloat(valorFinanciado) || 0).toFixed(2);
  const n = parseInt(numParcelas, 10);

  if (!(valor > 0)) throw new Error('Valor financiado precisa ser maior que zero');
  if (!Number.isInteger(n) || n < 1) throw new Error('Numero de parcelas precisa ser pelo menos 1');
  if (n > MAX_PARCELAS) throw new Error(`Numero de parcelas nao pode passar de ${MAX_PARCELAS}`);
  if (!ehDataValida(dataPrimeira)) throw new Error('Data da primeira parcela invalida (use YYYY-MM-DD)');

  const centavos = Math.round(valor * 100);
  const base = Math.floor(centavos / n);
  const sobra = centavos - base * n; // 0..n-1 centavos

  const parcelas = [];
  for (let i = 0; i < n; i++) {
    const centavosDaParcela = base + (i === 0 ? sobra : 0);
    parcelas.push({
      numero: i + 1,
      valor: +(centavosDaParcela / 100).toFixed(2),
      vencimento: somarMeses(dataPrimeira, i),
    });
  }
  return parcelas;
}

// Aplica um pagamento (possivelmente PARCIAL) a uma parcela.
//
// Pagamento parcial e' cidadao de primeira classe: a cliente paga "um pouco agora
// e o resto depois" — e' assim que funciona de verdade no balcao. R$30 numa parcela
// de R$50 deixa a parcela 'parcial' com valor_pago = 30, nao rejeita o pagamento.
//
// Recebe {valor, valor_pago} e devolve o novo estado. Nao muta a entrada.
function aplicarPagamento(parcela, valorPago) {
  const valorParcela = +(parseFloat(parcela && parcela.valor) || 0).toFixed(2);
  const jaPago = +(parseFloat(parcela && parcela.valor_pago) || 0).toFixed(2);
  const pgto = +(parseFloat(valorPago) || 0).toFixed(2);

  if (!(pgto > 0)) throw new Error('O valor do pagamento precisa ser maior que zero');

  const saldo = +(valorParcela - jaPago).toFixed(2);
  if (saldo <= 0) throw new Error('Esta parcela ja esta quitada');
  // tolerancia de 1 centavo: arredondamento nao pode barrar quem quer quitar
  if (pgto > saldo + 0.01) {
    throw new Error(`O valor passa do que falta nesta parcela (R$ ${saldo.toFixed(2)})`);
  }

  const novoPago = +(jaPago + pgto).toFixed(2);
  const quitada = novoPago >= valorParcela - 0.01;
  return {
    valor_pago: novoPago,
    saldo: +Math.max(0, valorParcela - novoPago).toFixed(2),
    status: quitada ? 'paga' : 'parcial',
  };
}

// Situacao de credito do cliente — o alerta do PDV.
//
// E' SINAL, NAO BLOQUEIO. O lojista pode vender assim mesmo, e vai. O que ele nao
// tem hoje nao e' bureau, e' MEMORIA: ele decide credito por relacionamento, mas
// nao lembra das outras trinta clientes. Entao damos memoria, nao veredito.
//
// Recebe os numeros ja lidos do banco (funcao pura). Historico BOM tambem conta:
// quem ja quitou carne merece ouvir isso em voz alta.
function avaliarCredito(d) {
  const deve = +(parseFloat(d.deve) || 0).toFixed(2);
  const atrasadas = parseInt(d.parcelas_atrasadas, 10) || 0;
  const diasAtrasoMax = parseInt(d.dias_atraso_max, 10) || 0;
  const quitados = parseInt(d.carnes_quitados, 10) || 0;
  const totalGasto = +(parseFloat(d.total_gasto) || 0).toFixed(2);

  if (atrasadas > 0 && (diasAtrasoMax > 30 || atrasadas >= 3)) {
    const motivo = diasAtrasoMax > 30
      ? `parcela vencida ha ${diasAtrasoMax} dias`
      : `${atrasadas} parcelas em atraso`;
    return { recomendacao: 'risco', razao: `Ja deve R$ ${deve.toFixed(2)} e tem ${motivo}.` };
  }

  if (atrasadas > 0) {
    const plural = atrasadas > 1 ? 'parcelas em atraso' : 'parcela em atraso';
    return {
      recomendacao: 'atencao',
      razao: `${atrasadas} ${plural}, a mais antiga ha ${diasAtrasoMax} ${diasAtrasoMax === 1 ? 'dia' : 'dias'}.`,
    };
  }

  // Deve mais de um terco de tudo que ja comprou na vida: nada esta atrasado ainda,
  // mas a exposicao ja e' grande pro tamanho do relacionamento.
  if (deve > 0 && totalGasto > 0 && deve > totalGasto / 3) {
    return {
      recomendacao: 'atencao',
      razao: `Esta em dia, mas ja deve R$ ${deve.toFixed(2)} — bastante pro historico dela.`,
    };
  }

  if (quitados > 0 && deve === 0) {
    return {
      recomendacao: 'ok',
      razao: `Ja quitou ${quitados} ${quitados === 1 ? 'carne' : 'carnes'}, sempre em dia.`,
    };
  }

  if (deve > 0) {
    return { recomendacao: 'ok', razao: `Deve R$ ${deve.toFixed(2)}, tudo em dia.` };
  }

  return { recomendacao: 'ok', razao: 'Sem nada em aberto.' };
}

module.exports = { gerarParcelas, aplicarPagamento, avaliarCredito, somarMeses, MAX_PARCELAS };
