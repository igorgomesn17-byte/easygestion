// Testes do lib/sku.js — a regra do codigo de barras e da normalizacao de cor.
// Estas funcoes sao usadas em 4 rotas (cadastro, edicao, entrada de estoque, PDV);
// se elas divergirem, o leitor de codigo de barras acha a peca errada.
const { test } = require('node:test');
const assert = require('node:assert');

const {
  COR_PADRAO, normalizarCor, normalizarTamanho, rotuloSku,
  ean13Valido, validarCodigoBarras, gerarCodigoBarras,
} = require('../lib/sku');

test('normalizarCor: sem cor vira "Unica", nunca vazio nem NULL', () => {
  // NULL/vazio quebraria o UNIQUE(produto_id, cor, tamanho): no SQLite NULL != NULL.
  assert.equal(normalizarCor(''),        COR_PADRAO);
  assert.equal(normalizarCor('   '),     COR_PADRAO);
  assert.equal(normalizarCor(null),      COR_PADRAO);
  assert.equal(normalizarCor(undefined), COR_PADRAO);
});

test('normalizarCor: "preto", "Preto " e "PRETO" nao viram 3 cores diferentes', () => {
  // Sem isso, a curva por cor mentiria: a mesma arara apareceria fatiada em 3.
  // O CAPS LOCK ("PRETO") e' o caso que mais escapa — digitacao de balcao. Uma versao
  // anterior desta funcao so subia a primeira letra e mantinha o resto: "PRETO"
  // passava batido e virava uma cor separada de "Preto".
  for (const entrada of ['preto', 'Preto ', ' preto', 'PRETO', 'PrEtO']) {
    assert.equal(normalizarCor(entrada), 'Preto', `"${entrada}" deveria virar "Preto"`);
  }
});

test('normalizarCor: cor composta vira Title Case ("Azul Marinho")', () => {
  assert.equal(normalizarCor('Azul Marinho'), 'Azul Marinho');
  assert.equal(normalizarCor('azul marinho'), 'Azul Marinho');
  assert.equal(normalizarCor('AZUL MARINHO'), 'Azul Marinho');
  assert.equal(normalizarCor('off White'),    'Off White');
  // espaco duplicado nao pode gerar uma cor "diferente"
  assert.equal(normalizarCor('azul  marinho'), 'Azul Marinho');
});

test('normalizarTamanho: caixa alta e sem espaco', () => {
  assert.equal(normalizarTamanho(' m '), 'M');
  assert.equal(normalizarTamanho('gg'),  'GG');
  assert.equal(normalizarTamanho('38'),  '38');
});

test('rotuloSku: mostra cor e tamanho, mas nao polui com "Unica"', () => {
  assert.equal(rotuloSku('Vestido Amanda', 'Preto', 'M'), 'Vestido Amanda (Preto / M)');
  // peca sem cor: o lojista nao quer ler "(Unica / M)" no cupom
  assert.equal(rotuloSku('Blusa', COR_PADRAO, 'P'), 'Blusa (P)');
  assert.equal(rotuloSku('Bolsa', COR_PADRAO, ''),  'Bolsa');
});

test('ean13Valido: confere o digito verificador', () => {
  assert.ok(ean13Valido('7891000315507'), 'EAN real (Nescau) deveria passar');
  assert.ok(!ean13Valido('7891000315508'), 'digito verificador errado deveria falhar');
  assert.ok(!ean13Valido('789100031550'),  '12 digitos nao e EAN-13');
  assert.ok(!ean13Valido('abcdefghijklm'), 'letra nao e EAN');
});

test('validarCodigoBarras: vazio e valido (a peca simplesmente nao tem codigo)', () => {
  assert.deepEqual(validarCodigoBarras(''),   { ok: true, codigo: null });
  assert.deepEqual(validarCodigoBarras(null), { ok: true, codigo: null });
});

test('validarCodigoBarras: aceita codigo de fornecedor que NAO e EAN-13', () => {
  // Fornecedor pequeno usa codigo interno de qualquer formato. Exigir EAN-13 aqui
  // impediria o lojista de reaproveitar a etiqueta que ja veio na peca — e a
  // impressao cai em code128 mesmo.
  assert.deepEqual(validarCodigoBarras('ABC-123'),   { ok: true, codigo: 'ABC-123' });
  assert.deepEqual(validarCodigoBarras('  X9901  '), { ok: true, codigo: 'X9901' }, 'deveria fazer trim');
  assert.deepEqual(validarCodigoBarras('123456789'), { ok: true, codigo: '123456789' }, 'EAN-8/interno numerico nao-13 passa direto');
});

test('validarCodigoBarras: 13 digitos com verificador errado e REJEITADO', () => {
  // Se tem 13 digitos, e' quase certo que quiseram digitar um EAN. Verificador
  // errado = erro de digitacao, e o leitor nunca acharia aquela peca. Melhor
  // barrar no cadastro do que descobrir no caixa com a cliente esperando.
  const r = validarCodigoBarras('7891000315508');
  assert.equal(r.ok, false);
  assert.match(r.erro, /verificador/i);
  // mas o EAN certo passa
  assert.equal(validarCodigoBarras('7891000315507').ok, true);
});

test('validarCodigoBarras: rejeita lixo e coisa curta demais', () => {
  assert.equal(validarCodigoBarras('ab').ok, false, 'curto demais');
  assert.equal(validarCodigoBarras("'; DROP TABLE produtos;--").ok, false, 'caractere fora do permitido');
  assert.equal(validarCodigoBarras('a'.repeat(60)).ok, false, 'longo demais');
});

test('gerarCodigoBarras: gera EAN-13 valido no range interno (prefixo 2)', () => {
  const c = gerarCodigoBarras();
  assert.match(c, /^\d{13}$/, 'deveria ter 13 digitos');
  assert.ok(ean13Valido(c), 'o proprio gerador produziu um EAN com verificador errado');
  // Prefixo 2 = range que a GS1 reserva pra uso interno da loja. Fora dele,
  // o codigo poderia colidir com um produto de fabricante de verdade.
  assert.equal(c[0], '2', 'codigo interno tem que comecar com 2');
});

test('gerarCodigoBarras: nao repete', () => {
  const gerados = new Set();
  for (let i = 0; i < 40; i++) gerados.add(gerarCodigoBarras());
  assert.equal(gerados.size, 40, 'o gerador repetiu um codigo');
});
