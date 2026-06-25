// ============================================================
// Testes de Validadores
// Rodar: npx jest tests/validadores.test.js
// ============================================================

const {
  validarDesconto,
  validarQuantidade,
  validarParcelas,
  validarAcrescimo,
  validarPreco,
  validarMargemLucro
} = require('../lib/validadores');

describe('Validadores', () => {
  describe('validarDesconto', () => {
    test('desconto válido (0%)', () => {
      const result = validarDesconto(0, 100);
      expect(result.valido).toBe(true);
      expect(result.erro).toBeNull();
    });

    test('desconto válido (50%)', () => {
      const result = validarDesconto(50, 100);
      expect(result.valido).toBe(true);
    });

    test('desconto inválido (>100%)', () => {
      const result = validarDesconto(150, 100);
      expect(result.valido).toBe(false);
      expect(result.erro).toContain('não pode ser maior');
    });

    test('desconto inválido (negativo)', () => {
      const result = validarDesconto(-10, 100);
      expect(result.valido).toBe(false);
      expect(result.erro).toContain('não pode ser negativo');
    });

    test('desconto undefined (opcional)', () => {
      const result = validarDesconto(undefined, 100);
      expect(result.valido).toBe(true);
    });
  });

  describe('validarQuantidade', () => {
    test('quantidade válida (1)', () => {
      const result = validarQuantidade(1);
      expect(result.valido).toBe(true);
      expect(result.valor).toBe(1);
    });

    test('quantidade válida (100)', () => {
      const result = validarQuantidade(100);
      expect(result.valido).toBe(true);
      expect(result.valor).toBe(100);
    });

    test('quantidade inválida (0)', () => {
      const result = validarQuantidade(0);
      expect(result.valido).toBe(false);
      expect(result.erro).toContain('maior que zero');
    });

    test('quantidade inválida (negativa)', () => {
      const result = validarQuantidade(-5);
      expect(result.valido).toBe(false);
    });

    test('quantidade inválida (não-número)', () => {
      const result = validarQuantidade('abc');
      expect(result.valido).toBe(false);
      expect(result.erro).toContain('número');
    });

    test('quantidade inválida (undefined)', () => {
      const result = validarQuantidade(undefined);
      expect(result.valido).toBe(false);
      expect(result.erro).toContain('obrigatória');
    });
  });

  describe('validarParcelas', () => {
    test('parcelas válidas (1)', () => {
      const result = validarParcelas(1);
      expect(result.valido).toBe(true);
      expect(result.valor).toBe(1);
    });

    test('parcelas válidas (12)', () => {
      const result = validarParcelas(12);
      expect(result.valido).toBe(true);
      expect(result.valor).toBe(12);
    });

    test('parcelas inválidas (0)', () => {
      const result = validarParcelas(0);
      expect(result.valido).toBe(false);
      expect(result.erro).toContain('1 e 12');
    });

    test('parcelas inválidas (13)', () => {
      const result = validarParcelas(13);
      expect(result.valido).toBe(false);
      expect(result.erro).toContain('1 e 12');
    });

    test('parcelas default (1)', () => {
      const result = validarParcelas(undefined);
      expect(result.valido).toBe(true);
      expect(result.valor).toBe(1);
    });
  });

  describe('validarPreco', () => {
    test('preço válido (10.50)', () => {
      const result = validarPreco(10.50);
      expect(result.valido).toBe(true);
      expect(result.valor).toBe(10.50);
    });

    test('preço inválido (0)', () => {
      const result = validarPreco(0);
      expect(result.valido).toBe(false);
      expect(result.erro).toContain('maior que zero');
    });

    test('preço inválido (negativo)', () => {
      const result = validarPreco(-5.50);
      expect(result.valido).toBe(false);
    });

    test('preço inválido (não-número)', () => {
      const result = validarPreco('abc');
      expect(result.valido).toBe(false);
      expect(result.erro).toContain('número');
    });
  });

  describe('validarMargemLucro', () => {
    test('margem válida (venda > custo)', () => {
      const result = validarMargemLucro(100, 50);
      expect(result.valido).toBe(true);
    });

    test('margem válida (venda == custo, break-even)', () => {
      const result = validarMargemLucro(100, 100);
      expect(result.valido).toBe(true);
    });

    test('margem inválida (venda < custo)', () => {
      const result = validarMargemLucro(50, 100);
      expect(result.valido).toBe(false);
      expect(result.erro).toContain('não pode ser menor');
    });
  });
});
