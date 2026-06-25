// ============================================================
// Validadores reutilizáveis para entrada de dados críticos
// Evita inconsistências e fraudes (desconto > 100%, qtd negativa, etc)
// ============================================================

// Valida desconto: deve ser >= 0 e <= subtotal
// Retorna { valido: bool, erro: string|null }
function validarDesconto(desconto, subtotal) {
  if (desconto === undefined || desconto === null || desconto === '') {
    return { valido: true, erro: null }; // desconto opcional = 0
  }

  const desc = parseFloat(desconto);
  if (isNaN(desc)) {
    return { valido: false, erro: 'Desconto deve ser um número' };
  }

  if (desc < 0) {
    return { valido: false, erro: 'Desconto não pode ser negativo' };
  }

  if (desc > subtotal) {
    return { valido: false, erro: `Desconto não pode ser maior que o subtotal (R$ ${subtotal.toFixed(2)})` };
  }

  return { valido: true, erro: null };
}

// Valida quantidade: deve ser > 0 e inteiro
// Retorna { valido: bool, valor: number, erro: string|null }
function validarQuantidade(qtd, campoNome = 'Quantidade') {
  if (qtd === undefined || qtd === null || qtd === '') {
    return { valido: false, valor: null, erro: `${campoNome} é obrigatória` };
  }

  const q = parseInt(qtd, 10);
  if (isNaN(q)) {
    return { valido: false, valor: null, erro: `${campoNome} deve ser um número inteiro` };
  }

  if (q <= 0) {
    return { valido: false, valor: null, erro: `${campoNome} deve ser maior que zero` };
  }

  return { valido: true, valor: q, erro: null };
}

// Valida parcelas: deve ser 1-12
// Retorna { valido: bool, valor: number, erro: string|null }
function validarParcelas(parcelas) {
  const p = parseInt(parcelas || 1, 10);
  if (isNaN(p) || p < 1 || p > 12) {
    return { valido: false, valor: null, erro: 'Parcelas deve ser entre 1 e 12' };
  }

  return { valido: true, valor: p, erro: null };
}

// Valida acréscimo: deve ser >= 0 (taxa de parcelamento)
// Retorna { valido: bool, valor: number, erro: string|null }
function validarAcrescimo(acrescimo) {
  if (acrescimo === undefined || acrescimo === null || acrescimo === '') {
    return { valido: true, valor: 0, erro: null };
  }

  const acr = parseFloat(acrescimo);
  if (isNaN(acr)) {
    return { valido: false, valor: null, erro: 'Acréscimo deve ser um número' };
  }

  if (acr < 0) {
    return { valido: false, valor: null, erro: 'Acréscimo não pode ser negativo' };
  }

  // Limite razoável: 30% de taxa é muito alto
  if (acr > (0.30 * parseFloat(process.env.DESCONTO_MAX || 50) || 15)) {
    return { valido: false, valor: null, erro: 'Acréscimo parece muito alto, verifique' };
  }

  return { valido: true, valor: acr, erro: null };
}

// Valida preço/valor: deve ser > 0
// Retorna { valido: bool, valor: number, erro: string|null }
function validarPreco(preco, campoNome = 'Preço') {
  const p = parseFloat(preco);
  if (isNaN(p)) {
    return { valido: false, valor: null, erro: `${campoNome} deve ser um número` };
  }

  if (p <= 0) {
    return { valido: false, valor: null, erro: `${campoNome} deve ser maior que zero` };
  }

  return { valido: true, valor: p, erro: null };
}

// Valida margem de lucro (não deixar produto com lucro negativo ao vender)
// Retorna { valido: bool, erro: string|null }
function validarMargemLucro(precoVenda, custoProduto) {
  const margem = precoVenda - custoProduto;
  if (margem < 0) {
    return { valido: false, erro: `Preço de venda (R$ ${precoVenda.toFixed(2)}) não pode ser menor que o custo (R$ ${custoProduto.toFixed(2)})` };
  }

  return { valido: true, erro: null };
}

module.exports = {
  validarDesconto,
  validarQuantidade,
  validarParcelas,
  validarAcrescimo,
  validarPreco,
  validarMargemLucro
};
