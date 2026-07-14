// ============================================================
// API da MAQUININHA (Mercado Pago Point)
//
// 🔒 O GATE DE PLANO NAO MORA AQUI — mora no `app.use` do server.js:
//     app.use('/api/maquininha', pdvOuAdmin, exigirFeature('maquininha_integrada'), ...)
//   No mount, rota nova nasce protegida. Mesma licao de routes/vales.js.
//
// ⚠️ `maquininha_integrada` NAO e' a feature `maquininha` (que ja existe e e' true no
//   Growth): aquela e' so "ver a tela de percentuais de taxa". Esta COBRA NO CARTAO.
//   Ver o comentario em lib/planos.js.
//
// pdvOuAdmin (nao apenasAdmin): quem cobra e' a VENDEDORA no balcao. Mas as rotas de
// CONFIGURACAO (conectar/desconectar/escolher terminal) sao apenasAdmin — vendedora
// nao mexe na credencial que move o dinheiro da loja.
// ============================================================
const express = require('express');
const router = express.Router();
const { apenasAdmin } = require('../middleware/seguranca');
const mp = require('../lib/mercadopago');

// Toda rota de cobranca precisa da loja conectada. Erro em portugues de gente:
// a vendedora nao sabe o que e' "credencial ausente".
function exigirConexao(req, res, next) {
  const cred = mp.credencialDe(req.tenantId);
  if (!cred) {
    return res.status(409).json({ erro: 'A maquininha ainda nao foi conectada. Va em Configuracoes > Maquininha.', nao_conectada: true });
  }
  if (!cred.terminal_id) {
    return res.status(409).json({ erro: 'Falta escolher qual maquininha usar. Va em Configuracoes > Maquininha.', sem_terminal: true });
  }
  req.mp = cred;
  next();
}

// ---------- STATUS (o PDV pergunta antes de mostrar o botao) ----------
router.get('/status', (req, res) => {
  const cred = mp.credencialDe(req.tenantId);
  res.json({
    conectada: !!cred,
    terminal_id: cred?.terminal_id || null,
    terminal_nome: cred?.terminal_nome || null,
    pronta: !!(cred && cred.terminal_id),
  });
});

// ---------- CONEXAO (admin) ----------
// Hoje: token colado (plano interno, so a DS usa). Quando virar produto, isto vira o
// callback do OAuth — a lojista nao pode manusear um Access Token. O resto da API
// (cobrar, webhook, gravar) nao muda uma linha.
router.post('/conectar', apenasAdmin, async (req, res, next) => {
  try {
    const token = String(req.body?.access_token || '').trim();
    if (!token) return res.status(400).json({ erro: 'Cole o Access Token do Mercado Pago' });
    if (!/^(APP_USR|TEST)-/.test(token)) {
      return res.status(400).json({ erro: 'Isso nao parece um Access Token do Mercado Pago (comeca com APP_USR- ou TEST-)' });
    }

    // Valida ANTES de gravar: token que nao fala com o MP nao entra no banco.
    const terminais = await mp.listarTerminais(token);
    mp.salvarCredencial(req.tenantId, { access_token: token });

    // Uma maquininha so? Escolhe sozinho e ja liga o modo PDV — um passo a menos.
    if (terminais.length === 1) {
      const t = terminais[0];
      await mp.ativarModoPdv(token, t.id);
      mp.escolherTerminal(req.tenantId, t.id, t.id);
    }

    res.json({ ok: true, terminais, escolhido: terminais.length === 1 ? terminais[0].id : null });
  } catch (e) {
    if (e.status === 401) return res.status(400).json({ erro: 'O Mercado Pago recusou esse token. Confira se copiou o de PRODUCAO.' });
    next(e);
  }
});

router.get('/terminais', apenasAdmin, exigirConexao, async (req, res, next) => {
  try {
    res.json({ terminais: await mp.listarTerminais(req.mp.access_token), escolhido: req.mp.terminal_id });
  } catch (e) { next(e); }
});

// Escolher a maquininha JA liga o modo PDV. Sem isso ela ignora as cobrancas — e nao
// avisa (o default do MP e' STANDALONE). Nunca deixar esse passo pro usuario.
router.post('/terminal', apenasAdmin, exigirConexao, async (req, res, next) => {
  try {
    const id = String(req.body?.terminal_id || '').trim();
    if (!id) return res.status(400).json({ erro: 'Escolha uma maquininha' });
    await mp.ativarModoPdv(req.mp.access_token, id);
    mp.escolherTerminal(req.tenantId, id, req.body?.terminal_nome || id);
    res.json({ ok: true, terminal_id: id });
  } catch (e) { next(e); }
});

router.delete('/conectar', apenasAdmin, (req, res) => {
  mp.desconectar(req.tenantId);
  res.json({ ok: true });
});

// ---------- COBRAR (a vendedora, no balcao) ----------
// Manda o valor pra maquininha. Ela acende e pede o cartao.
// A VENDA AINDA NAO EXISTE aqui: ela so' e' gravada se o pagamento aprovar.
router.post('/cobrar', exigirConexao, async (req, res, next) => {
  try {
    const valor = +parseFloat(req.body?.valor || 0).toFixed(2);
    const forma = String(req.body?.forma || '');
    const parcelas = parseInt(req.body?.parcelas, 10) || 1;

    if (!(valor > 0)) return res.status(400).json({ erro: 'Valor invalido' });
    if (!mp.tipoPagamentoMp(forma)) {
      return res.status(400).json({ erro: 'So debito e credito passam na maquininha' });
    }

    const r = await mp.criarCobranca(req.mp.access_token, {
      terminalId: req.mp.terminal_id,
      valor, forma, parcelas,
      // ainda nao ha venda_id — a referencia amarra a cobranca a este caixa/tentativa
      referencia: `t${req.tenantId}_${Date.now()}`,
    });

    res.status(201).json({ order_id: r.orderId, status: r.status, valor });
  } catch (e) {
    // 409 (ja tem cobranca aberta) e 400 ja vem com mensagem de gente
    if (e.status === 409 || e.status === 400) return res.status(e.status).json({ erro: e.message });
    next(e);
  }
});

// O PDV pergunta "ja passou o cartao?" a cada 2s enquanto a tela de espera esta aberta.
// (O webhook e' a fonte da verdade pra gravar; este polling e' so pra tela reagir.)
router.get('/cobranca/:orderId', exigirConexao, async (req, res, next) => {
  try {
    const order = await mp.consultarOrder(req.mp.access_token, req.params.orderId);
    const dados = mp.extrairDaOrder(order);

    // Aprovou? Busca a TAXA REAL (2o hop). E' o motivo de tudo isso existir.
    if (dados.status_transacao === 'aprovado' && dados.nsu) {
      const det = await mp.detalhesPagamento(req.mp.access_token, dados.nsu);
      if (det) Object.assign(dados, det);
    }

    res.json({ status: order.status, ...dados });
  } catch (e) { next(e); }
});

// Cliente desistiu. So funciona enquanto a cobranca nao foi pro terminal — depois
// disso o cancelamento e' NA MAQUININHA. O 409 diz isso pra vendedora nao ficar
// clicando num botao morto.
router.post('/cobranca/:orderId/cancelar', exigirConexao, async (req, res, next) => {
  try {
    const ok = await mp.cancelarOrder(req.mp.access_token, req.params.orderId);
    if (!ok) {
      return res.status(409).json({ erro: 'A cobranca ja esta na maquininha. Cancele por ela (tecla vermelha).' });
    }
    res.json({ ok: true });
  } catch (e) { next(e); }
});

module.exports = router;
