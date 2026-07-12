// ============================================================
// Testes do CREDIARIO (a matematica do carne)
// Rodar: npm run test:crediario
// ============================================================

const { gerarParcelas, aplicarPagamento, avaliarCredito, somarMeses } = require('../lib/crediario');

// soma os valores das parcelas em CENTAVOS (float nao fecha: 133.34+133.33+133.33)
const somaCentavos = (parcelas) => parcelas.reduce((s, p) => s + Math.round(p.valor * 100), 0);

describe('gerarParcelas', () => {
  test('parcela unica leva o valor cheio', () => {
    const p = gerarParcelas(400, 1, '2026-08-10');
    expect(p).toHaveLength(1);
    expect(p[0]).toEqual({ numero: 1, valor: 400, vencimento: '2026-08-10' });
  });

  test('divisao exata: 300 em 3x', () => {
    const p = gerarParcelas(300, 3, '2026-08-10');
    expect(p.map(x => x.valor)).toEqual([100, 100, 100]);
    expect(somaCentavos(p)).toBe(30000);
  });

  test('o resto dos centavos vai na PRIMEIRA parcela e a soma fecha', () => {
    // 400/3 = 133,333... — se arredondasse igual, somaria 399,99
    const p = gerarParcelas(400, 3, '2026-08-10');
    expect(p.map(x => x.valor)).toEqual([133.34, 133.33, 133.33]);
    expect(somaCentavos(p)).toBe(40000); // fecha exatamente com a venda
  });

  test('a soma sempre fecha com o financiado, em varias combinacoes', () => {
    const casos = [
      [100, 3], [0.05, 5], [999.99, 7], [1234.56, 11], [89.9, 6], [10, 24],
    ];
    for (const [valor, n] of casos) {
      const p = gerarParcelas(valor, n, '2026-08-10');
      expect(p).toHaveLength(n);
      expect(somaCentavos(p)).toBe(Math.round(valor * 100));
    }
  });

  test('vencimentos sao mensais a partir da primeira data', () => {
    const p = gerarParcelas(300, 3, '2026-08-10');
    expect(p.map(x => x.vencimento)).toEqual(['2026-08-10', '2026-09-10', '2026-10-10']);
  });

  test('virada de mes: dia 31 nao pula fevereiro, prende no ultimo dia', () => {
    const p = gerarParcelas(400, 4, '2026-01-31');
    expect(p.map(x => x.vencimento)).toEqual([
      '2026-01-31',
      '2026-02-28', // fevereiro nao tem 31: prende no ultimo dia (nao vaza pra 03/03)
      '2026-03-31', // e volta pro dia 31
      '2026-04-30', // abril tem 30
    ]);
  });

  test('virada de ANO', () => {
    const p = gerarParcelas(300, 3, '2026-11-15');
    expect(p.map(x => x.vencimento)).toEqual(['2026-11-15', '2026-12-15', '2027-01-15']);
  });

  test('ano bissexto: fevereiro de 2028 tem 29', () => {
    const p = gerarParcelas(200, 2, '2028-01-31');
    expect(p[1].vencimento).toBe('2028-02-29');
  });

  test('rejeita entradas invalidas', () => {
    expect(() => gerarParcelas(0, 3, '2026-08-10')).toThrow(/maior que zero/);
    expect(() => gerarParcelas(-50, 3, '2026-08-10')).toThrow(/maior que zero/);
    expect(() => gerarParcelas(400, 0, '2026-08-10')).toThrow(/pelo menos 1/);
    expect(() => gerarParcelas(400, 25, '2026-08-10')).toThrow(/24/);
    expect(() => gerarParcelas(400, 3, '10/08/2026')).toThrow(/invalida/);
    expect(() => gerarParcelas(400, 3, '2026-02-30')).toThrow(/invalida/);
  });
});

describe('somarMeses', () => {
  test('nao escorrega de dia por causa de fuso (o bug do toISOString)', () => {
    expect(somarMeses('2026-01-01', 0)).toBe('2026-01-01');
    expect(somarMeses('2026-03-01', 1)).toBe('2026-04-01');
  });
});

describe('aplicarPagamento', () => {
  const parcela = { valor: 50, valor_pago: 0 };

  test('pagamento parcial: R$30 numa parcela de R$50 deixa parcial', () => {
    const r = aplicarPagamento(parcela, 30);
    expect(r).toEqual({ valor_pago: 30, saldo: 20, status: 'parcial' });
  });

  test('o resto quita: +R$20 vira paga', () => {
    const r = aplicarPagamento({ valor: 50, valor_pago: 30 }, 20);
    expect(r).toEqual({ valor_pago: 50, saldo: 0, status: 'paga' });
  });

  test('pagamento exato quita de uma vez', () => {
    const r = aplicarPagamento(parcela, 50);
    expect(r.status).toBe('paga');
    expect(r.saldo).toBe(0);
  });

  test('tolera 1 centavo de arredondamento pra quitar', () => {
    const r = aplicarPagamento({ valor: 133.33, valor_pago: 0 }, 133.34);
    expect(r.status).toBe('paga');
  });

  test('rejeita valor acima do saldo (nao aceita pagar mais do que deve)', () => {
    expect(() => aplicarPagamento(parcela, 80)).toThrow(/passa do que falta/);
    expect(() => aplicarPagamento({ valor: 50, valor_pago: 30 }, 25)).toThrow(/passa do que falta/);
  });

  test('rejeita valor zero ou negativo', () => {
    expect(() => aplicarPagamento(parcela, 0)).toThrow(/maior que zero/);
    expect(() => aplicarPagamento(parcela, -10)).toThrow(/maior que zero/);
  });

  test('rejeita pagamento em parcela ja quitada', () => {
    expect(() => aplicarPagamento({ valor: 50, valor_pago: 50 }, 10)).toThrow(/ja esta quitada/);
  });

  test('nao muta a parcela original', () => {
    const p = { valor: 50, valor_pago: 0 };
    aplicarPagamento(p, 30);
    expect(p.valor_pago).toBe(0);
  });
});

describe('avaliarCredito', () => {
  test('sem nada em aberto: ok', () => {
    const r = avaliarCredito({ deve: 0, parcelas_atrasadas: 0, dias_atraso_max: 0, carnes_quitados: 0, total_gasto: 0 });
    expect(r.recomendacao).toBe('ok');
  });

  test('deve mas esta tudo em dia: ok', () => {
    const r = avaliarCredito({ deve: 200, parcelas_atrasadas: 0, dias_atraso_max: 0, carnes_quitados: 0, total_gasto: 2000 });
    expect(r.recomendacao).toBe('ok');
  });

  test('1 parcela com 5 dias de atraso: atencao', () => {
    const r = avaliarCredito({ deve: 130, parcelas_atrasadas: 1, dias_atraso_max: 5, carnes_quitados: 0, total_gasto: 900 });
    expect(r.recomendacao).toBe('atencao');
    expect(r.razao).toMatch(/1 parcela em atraso/);
  });

  test('atraso acima de 30 dias: risco', () => {
    const r = avaliarCredito({ deve: 380, parcelas_atrasadas: 1, dias_atraso_max: 47, carnes_quitados: 0, total_gasto: 900 });
    expect(r.recomendacao).toBe('risco');
    expect(r.razao).toMatch(/47 dias/);
  });

  test('3 parcelas atrasadas (mesmo que recentes): risco', () => {
    const r = avaliarCredito({ deve: 390, parcelas_atrasadas: 3, dias_atraso_max: 12, carnes_quitados: 0, total_gasto: 2000 });
    expect(r.recomendacao).toBe('risco');
  });

  test('em dia, mas deve mais de um terco do que ja comprou na vida: atencao', () => {
    const r = avaliarCredito({ deve: 500, parcelas_atrasadas: 0, dias_atraso_max: 0, carnes_quitados: 0, total_gasto: 900 });
    expect(r.recomendacao).toBe('atencao');
  });

  test('historico bom conta: ja quitou carnes e nao deve nada', () => {
    const r = avaliarCredito({ deve: 0, parcelas_atrasadas: 0, dias_atraso_max: 0, carnes_quitados: 3, total_gasto: 3200 });
    expect(r.recomendacao).toBe('ok');
    expect(r.razao).toMatch(/quitou 3 carnes/);
  });
});
