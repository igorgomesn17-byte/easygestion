// ============================================================
// CUPONS — consulta pro PDV (preview).
//
// NENHUMA decisao financeira acontece aqui. Estas rotas so respondem "esse codigo
// serve?" pra atendente ver na tela antes de fechar a venda. A validacao que VALE e'
// a que roda dentro da transacao da venda (routes/vendas.js, passo 2d) — e ela
// revalida tudo do zero. Se este endpoint dissesse "ok" e o cupom fosse consumido no
// meio tempo, a venda ainda assim recusaria.
//
// Montado com `pdvOuAdmin` e SEM exigirFeature: a vendedora precisa fechar a venda, e
// POST /api/vendas tambem nao tem gate de feature. Quem nao tem o Relacionamento
// simplesmente nao tem cupom nenhum no banco — nao ha o que barrar.
// ============================================================
const express = require('express');
const { validarCupom, descontoDe, cuponsAtivosDe } = require('../lib/cupons');
const { hojeLocal } = require('../lib/datas');

const router = express.Router();

// GET /api/cupons/cliente/:id — o que esta cliente pode usar AGORA.
// E' o que faz o PDV OFERECER o cupom sozinho: a cliente esquece o codigo, e a
// atendente nao deveria depender da memoria dela pra loja receber o retorno da
// mensagem que ja foi paga (em tempo e em desconto).
//
// Vem ANTES de /:codigo — senao 'cliente' seria lido como um codigo de cupom.
router.get('/cliente/:id', (req, res) => {
  const clienteId = parseInt(req.params.id, 10);
  if (!clienteId) return res.status(400).json({ erro: 'Cliente inválido' });
  const cupons = cuponsAtivosDe(req.tenantId, clienteId, hojeLocal());
  res.json({ cupons });
});

// GET /api/cupons/:codigo?cliente_id=N&subtotal=400
// Devolve o cupom e quanto ele desconta — ou o motivo da recusa, na lingua da
// atendente ("este cupom e' da Joana", "expirou em 12/07").
router.get('/:codigo', (req, res) => {
  const clienteId = req.query.cliente_id ? parseInt(req.query.cliente_id, 10) : null;
  const subtotal = parseFloat(req.query.subtotal) || 0;

  const v = validarCupom(req.tenantId, req.params.codigo, clienteId, subtotal, hojeLocal());
  if (!v.ok) return res.status(v.http || 422).json({ erro: v.erro });

  const c = v.cupom;
  res.json({
    id: c.id,
    codigo: c.codigo,
    pct: c.pct,
    min_compra: c.min_compra,
    validade: c.validade,
    tipo: c.tipo,
    cliente_id: c.cliente_id,
    desconto: subtotal > 0 ? descontoDe(c, subtotal) : 0,
  });
});

module.exports = router;
