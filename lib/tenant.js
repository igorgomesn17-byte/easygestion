// ============================================================
// O GUARD DE TENANT — a defesa contra a classe de bug mais cara deste projeto.
//
// -- O PADRAO QUE JA MORDEU TRES VEZES --
//
// Uma funcao declarada como `function f(x, tenantId = 1)` parece defensiva. Nao e'.
// Se alguem chama sem passar o tenant, ela opera sobre a LOJA 1 em silencio — e nao
// existe erro, nao existe log, nao existe sintoma. Ate alguem conferir na mao.
//
// Aconteceu, em ordem:
//   1. getConfig(chave, fallback, tenantId = 1) — uma loja lia a config de outra.
//      Afetou DRE, metas e o lucro da venda.
//   2. injetarTenant: `if (papel==='admin' && !tenant_id) req.tenantId = 1` — abrir o
//      backoffice fazia o dono entrar na LOJA-FANTASMA do tenant 1 ("sumiu tudo").
//   3. lib/calculos.js: 5 funcoes com `tenantId = 1`, e o PDV chamando sem o tenant —
//      TODA VENDA descontava a taxa de maquininha da loja 1. R$5,20 de lucro fantasma
//      numa venda de R$1.000 no debito. Toda venda.
//
// A licao das tres: **um default de tenant nao quebra — ELE MENTE.** E mentira
// silenciosa e' pior que erro barulhento, porque ninguem vai atras do que nao doi.
//
// -- COMO ESTE GUARD SE COMPORTA --
//
// Em dev e teste: DERRUBA. E' impossivel introduzir o bug sem que o teste exploda.
// Em producao:    grita no log e segue com o tenant 1 (o comportamento antigo) — porque
//                 derrubar a venda na frente da cliente e' pior que um numero errado
//                 que o log denuncia. Se `[TENANT] ⚠️` aparecer no log de producao,
//                 e' uma chamada nova sem tenant: conserte, nao ignore.
// ============================================================

function exigirTenant(tenantId, ondeEstou) {
  const t = Number(tenantId);
  if (Number.isInteger(t) && t > 0) return t;

  const msg = `${ondeEstou || 'tenant'}: tenantId obrigatorio — sem ele esta loja opera sobre os dados de OUTRA`;
  if (process.env.NODE_ENV !== 'production') throw new Error(msg);

  console.error('[TENANT] ⚠️  ' + msg);
  return 1;
}

module.exports = { exigirTenant };
