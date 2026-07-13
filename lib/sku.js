// ============================================================
// SKU — a peca que existe na arara: um par (cor, tamanho) de um produto.
//
// O produto e' o MODELO ("Vestido Amanda"). O SKU e' a peca concreta
// ("Vestido Amanda, preto, M"), com estoque e codigo de barras proprios.
//
// Este arquivo existe pra que a regra do codigo de barras nao se espalhe: ela e'
// usada no cadastro, na edicao, na entrada de estoque e na busca do PDV. Se cada
// rota tivesse a sua copia, elas divergiriam.
// ============================================================
const { db } = require('../db/database');

// Cor padrao de quem nao tem cor. Nunca NULL: no SQLite NULL != NULL, entao com
// cor NULL o UNIQUE(produto_id, cor, tamanho) nao barraria duplicata nenhuma.
const COR_PADRAO = 'Unica';

// Normaliza o que veio do formulario. Cor e' texto livre digitado pelo lojista
// ("preto", "Preto ", "PRETO") — sem normalizar, viram tres cores diferentes na
// mesma arara, o UNIQUE(produto_id, cor, tamanho) nao barra a duplicata, e a curva
// por cor mente.
//
// Title Case por palavra: "PRETO" e "preto" viram "Preto"; "azul marinho" vira
// "Azul Marinho". Nao basta subir a primeira letra e manter o resto — CAPS LOCK
// ligado (comum em digitacao de balcao) passaria batido.
function normalizarCor(cor) {
  const c = String(cor == null ? '' : cor).trim().replace(/\s+/g, ' ');
  if (!c) return COR_PADRAO;
  return c
    .split(' ')
    .map((palavra) => palavra.charAt(0).toUpperCase() + palavra.slice(1).toLowerCase())
    .join(' ');
}

function normalizarTamanho(tamanho) {
  return String(tamanho == null ? '' : tamanho).trim().toUpperCase();
}

// Como a peca aparece pro lojista e pra cliente: "Vestido Amanda (Preto / M)".
// Quando nao tem cor de verdade, nao poluir com "Unica" — vira so "(M)".
function rotuloSku(nome, cor, tamanho) {
  const partes = [];
  if (cor && cor !== COR_PADRAO) partes.push(cor);
  if (tamanho) partes.push(tamanho);
  return partes.length ? `${nome} (${partes.join(' / ')})` : String(nome);
}

// ------------------------------------------------------------
// CODIGO DE BARRAS
//
// Dois caminhos, e o lojista escolhe por SKU:
//   1. VINCULAR o codigo que ja veio na peca (o fornecedor etiquetou de fabrica).
//      Raro na moda de atacado, mas quando existe evita reetiquetar a loja inteira.
//   2. GERAR um codigo interno (o caso comum). Prefixo 200-299 e' reservado pra
//      uso interno pelo padrao GS1 — nao colide com EAN de fabricante nenhum.
// ------------------------------------------------------------

// Digito verificador do EAN-13 (mod 10, pesos 1 e 3 alternados).
function digitoVerificadorEan13(base12) {
  let soma = 0;
  for (let i = 0; i < 12; i++) {
    soma += parseInt(base12[i], 10) * (i % 2 === 0 ? 1 : 3);
  }
  return String((10 - (soma % 10)) % 10);
}

function ean13Valido(codigo) {
  const c = String(codigo || '').trim();
  if (!/^\d{13}$/.test(c)) return false;
  return digitoVerificadorEan13(c.slice(0, 12)) === c[12];
}

// Aceita o codigo que o lojista bipou/digitou.
// Nao exigimos EAN-13: fornecedor pequeno usa codigo interno de qualquer formato,
// e a impressao (bwip-js) cai em code128 quando nao e' EAN valido. Mas se PARECE
// um EAN-13 (13 digitos), o digito verificador tem que fechar — 13 digitos com
// verificador errado e' quase sempre erro de digitacao, e o leitor nunca acharia
// aquela peca.
function validarCodigoBarras(codigo) {
  const c = String(codigo == null ? '' : codigo).trim();
  if (!c) return { ok: true, codigo: null };  // vazio = sem codigo, e' valido
  if (!/^[A-Za-z0-9._-]{4,48}$/.test(c)) {
    return { ok: false, erro: 'Código de barras inválido (use letras, números, ponto, hífen ou _; 4 a 48 caracteres)' };
  }
  if (/^\d{13}$/.test(c) && !ean13Valido(c)) {
    return { ok: false, erro: `Código EAN-13 inválido: o dígito verificador de "${c}" não confere. Confira a digitação.` };
  }
  return { ok: true, codigo: c };
}

// Gera um EAN-13 interno unico. O prefixo 2 (200-299) e' o range que a GS1 reserva
// pra uso interno de loja: e' garantido que nao colide com produto de fabricante.
//
// Tenta ate achar um que nao exista. O UNIQUE parcial em variacoes(codigo_barras)
// e' a garantia final — isto so evita o erro de constraint no caminho normal.
function gerarCodigoBarras(tentativas = 12) {
  const jaExiste = db.prepare('SELECT 1 FROM variacoes WHERE codigo_barras = ? UNION SELECT 1 FROM produtos WHERE codigo_barras = ?');
  for (let i = 0; i < tentativas; i++) {
    // 2 + 11 digitos aleatorios = 12, + verificador = 13.
    let base = '2';
    for (let d = 0; d < 11; d++) base += Math.floor(Math.random() * 10);
    const codigo = base + digitoVerificadorEan13(base);
    if (!jaExiste.get(codigo, codigo)) return codigo;
  }
  throw new Error('Não foi possível gerar um código de barras único. Tente novamente.');
}

// O codigo ja esta em uso por OUTRO SKU? (ignorando o proprio, numa edicao)
// Checa tambem produtos.codigo_barras: os produtos antigos ainda tem o deles, e
// dois codigos iguais fariam a busca do PDV achar a peca errada.
function codigoEmUso(codigo, tenantId, variacaoIdIgnorar = null) {
  if (!codigo) return false;
  const emVariacao = db.prepare(`
    SELECT v.id FROM variacoes v
    JOIN produtos p ON p.id = v.produto_id
    WHERE v.codigo_barras = ? AND p.tenant_id = ? AND v.id != ?
  `).get(codigo, tenantId, variacaoIdIgnorar || -1);
  if (emVariacao) return true;
  return !!db.prepare('SELECT id FROM produtos WHERE codigo_barras = ? AND tenant_id = ?').get(codigo, tenantId);
}

// Resolve o codigo de barras de UM SKU no cadastro/edicao.
// - veio codigo do lojista -> valida e usa (o do fornecedor)
// - nao veio               -> gera interno
// `gerar: false` permite salvar SKU sem codigo (ex: edicao que nao mexeu nisso).
function resolverCodigoBarras(codigoInformado, tenantId, { variacaoIdIgnorar = null, gerar = true } = {}) {
  const val = validarCodigoBarras(codigoInformado);
  if (!val.ok) throw Object.assign(new Error(val.erro), { status: 400 });

  if (val.codigo) {
    if (codigoEmUso(val.codigo, tenantId, variacaoIdIgnorar)) {
      throw Object.assign(
        new Error(`O código "${val.codigo}" já está em uso por outra peça. Cada peça precisa do seu.`),
        { status: 400 }
      );
    }
    return val.codigo;
  }
  return gerar ? gerarCodigoBarras() : null;
}

module.exports = {
  COR_PADRAO,
  normalizarCor,
  normalizarTamanho,
  rotuloSku,
  ean13Valido,
  validarCodigoBarras,
  gerarCodigoBarras,
  codigoEmUso,
  resolverCodigoBarras,
};
