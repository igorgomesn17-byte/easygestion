// ============================================================
// LIMPAR todos os dados de movimento (vendas, caixa, clientes, produtos)
// Deixa o banco zerado para uso real. NAO apaga as configuracoes.
// Rode com: node scripts/limpar-dados.js
// ============================================================
const { db } = require('../db/database');

const tx = db.transaction(() => {
  db.exec('DELETE FROM troca_itens');
  db.exec('DELETE FROM trocas');
  db.exec('DELETE FROM venda_itens');
  db.exec('DELETE FROM vendas');
  db.exec('DELETE FROM movimentos_estoque');
  db.exec('DELETE FROM produto_fotos');
  db.exec('DELETE FROM variacoes');
  db.exec('DELETE FROM produtos');
  db.exec('DELETE FROM clientes');
  db.exec('DELETE FROM vendedores');
  db.exec('DELETE FROM caixa_dia');
  db.exec('DELETE FROM caixa_movimentos');
  db.exec('DELETE FROM despesas');
  // reseta os contadores de id (autoincrement)
  db.exec("DELETE FROM sqlite_sequence WHERE name IN ('produtos','variacoes','vendas','venda_itens','clientes','vendedores','movimentos_estoque','caixa_dia','caixa_movimentos','trocas','troca_itens','despesas')");
});
tx();
console.log('Banco limpo. Pronto para cadastro real. (Configuracoes preservadas.)');
