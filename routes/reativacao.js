// ============================================================
// REATIVACAO DA BASE IMPORTADA
//
// A base migrada de outro sistema (clientes.tipo='importado') tem historico
// AGREGADO — veio quanto a cliente gastou e quantas vezes, mas nao as vendas
// individuais. Por isso ela ficou FORA da regua diaria (migration 040): a regua leria
// `ultima_compra` e diria "28 dias sem comprar" pra quem sumiu ha mais de um ano.
//
// Essa base merece CAMPANHA, nao regua:
//   - a regua e' um fluxo continuo, disparado por dias sem comprar;
//   - a campanha tem comeco e fim, e ataca por ONDAS de valor (o dinheiro esta
//     concentrado: na DS, 15% dos clientes = 50% do faturamento historico).
//
// E o TOM e' outro. Quem sumiu ha 17 meses nao recebe "sentimos sua falta" — recebe
// REENCONTRO ("a loja voltou, e a gente ainda entrega ai").
//
// GATE: exigirFeature('base_importada'), hoje so no plano `interno`. Isto e'
// ferramenta da campanha da DS, nao produto. A tela e as mensagens sao GENERICAS
// (nunca citam a cidade nem a loja da campanha), entao virar produto e' so ligar a
// feature no growth — nada de texto pra reescrever.
// ============================================================
const express = require('express');
const router = express.Router();
const { db, getConfig } = require('../db/database');
const { urlWhatsApp, varsDe, exigirTenant } = require('../lib/crm');
const { interpolar } = require('../lib/crm-templates');
const { emitirCupom } = require('../lib/cupons');

// As ondas sao FAIXAS DE VALOR HISTORICO. Atacar por valor (e nao por data) e' o que
// concentra o esforco onde o retorno esta: a VIP que gastou R$3.000 merece mensagem
// pessoal; quem gastou R$50 entra num lote depois, se as ondas anteriores derem
// retorno. `min`/`max` em reais.
const ONDAS = {
  vip:   { nome: 'VIP',    min: 1000, max: Infinity, desc: 'As mais valiosas — mensagem pessoal, uma a uma' },
  alta:  { nome: 'Alta',   min: 500,  max: 1000,     desc: 'Boas clientes — semi-personalizada' },
  media: { nome: 'Média',  min: 200,  max: 500,      desc: 'Volume — template com o nome' },
  baixa: { nome: 'Baixa',  min: 0,    max: 200,      desc: 'Só depois de as anteriores darem retorno' },
};

// Mensagem padrao de REENCONTRO.
//
// -- O GANCHO E' O QUE FAZ ESTA CAMPANHA FUNCIONAR --
//
// Uma base importada raramente "esqueceu" a loja: ela parou por um MOTIVO concreto
// (a loja da cidade dela fechou, mudou de endereco, parou de entregar). Uma mensagem
// que so diz "chegou colecao nova, quer ver?" bate direto na objecao que ela ja tem
// pronta: "ver como, se voces sairam daqui?". A copy morre ali, por mais bonita
// que seja.
//
// Por isso existe {gancho}: a frase que derruba essa objecao especifica — tipicamente
// a entrega ("continuamos pertinho de voce: entregamos ai"). Vem da config
// `reativacao_gancho`, entao o codigo continua GENERICO (nenhuma cidade chumbada,
// ver tests/reativacao.test.js) e cada loja escreve o gancho dela sem deploy.
//
// Sem gancho configurado a frase simplesmente nao aparece: a mensagem continua
// valida, so mais fraca. O /resumo devolve `gancho` pra tela poder avisar.
const MSG_PADRAO =
  'Oi {nome}! 🤎 Aqui é a {loja}!\n\n' +
  'Faz um tempo que a gente não se vê e lembrei de você!{gancho} ' +
  'Chegou coleção nova e separei algumas peças pensando no seu estilo.\n\n' +
  'Quer dar uma olhadinha no que chegou? 😍';

// O gancho ja vem com o espacamento pronto pra encaixar na frase (ou vazio).
function ganchoDe(tenantId) {
  const g = (getConfig('reativacao_gancho', '', tenantId) || '').trim();
  return g ? ` ${g}` : '';
}

function ondaDe(gasto) {
  const g = Number(gasto) || 0;
  for (const [k, o] of Object.entries(ONDAS)) if (g >= o.min && g < o.max) return k;
  return 'baixa';
}

// GET /api/reativacao/resumo -> o tamanho de cada onda e o quanto ja foi contatado
router.get('/resumo', (req, res) => {
  const t = exigirTenant(req.tenantId);
  const linhas = db.prepare(`
    SELECT c.id, c.total_gasto,
           CASE WHEN rc.id IS NULL THEN 0 ELSE 1 END AS contatado,
           COALESCE(rc.respondeu, 0) AS respondeu
    FROM clientes c
    LEFT JOIN reativacao_contatos rc ON rc.cliente_id = c.id AND rc.tenant_id = c.tenant_id
    WHERE c.tenant_id = ? AND c.tipo = 'importado' AND c.arquivado = 0 AND c.nao_perturbe = 0
  `).all(t);

  const base = {};
  for (const k of Object.keys(ONDAS)) {
    base[k] = { ...ONDAS[k], id: k, total: 0, contatados: 0, responderam: 0, valor: 0 };
    if (base[k].max === Infinity) base[k].max = null;   // JSON nao serializa Infinity
  }
  for (const l of linhas) {
    const o = base[ondaDe(l.total_gasto)];
    o.total++; o.valor += l.total_gasto || 0;
    if (l.contatado) o.contatados++;
    if (l.respondeu) o.responderam++;
  }

  const tot = linhas.length;
  res.json({
    ondas: Object.values(base).map(o => ({ ...o, valor: +o.valor.toFixed(2) })),
    total: tot,
    contatados: linhas.filter(l => l.contatado).length,
    responderam: linhas.filter(l => l.respondeu).length,
    // A tela usa isto pra avisar antes do primeiro disparo: sem o gancho, a
    // mensagem nao responde "por que voce sumiu", que e' a objecao real da base.
    gancho: (getConfig('reativacao_gancho', '', t) || '').trim() || null,
  });
});

// GET /api/reativacao/clientes?onda=vip&pendentes=1
// A lista de ataque, ordenada por VALOR (quem vale mais primeiro).
router.get('/clientes', (req, res) => {
  const t = exigirTenant(req.tenantId);
  const onda = ONDAS[req.query.onda] ? req.query.onda : null;
  const soPendentes = req.query.pendentes === '1';

  let sql = `
    SELECT c.id, c.nome, c.telefone, c.total_gasto, c.num_compras, c.ultima_compra,
           CAST(julianday('now') - julianday(c.ultima_compra) AS INT) AS dias,
           rc.id AS contato_id, rc.contatado_em, rc.respondeu, rc.cupom AS cupom_enviado
    FROM clientes c
    LEFT JOIN reativacao_contatos rc ON rc.cliente_id = c.id AND rc.tenant_id = c.tenant_id
    WHERE c.tenant_id = ? AND c.tipo = 'importado' AND c.arquivado = 0 AND c.nao_perturbe = 0
  `;
  const params = [t];
  if (onda) {
    sql += ' AND c.total_gasto >= ?';
    params.push(ONDAS[onda].min);
    if (ONDAS[onda].max !== Infinity) { sql += ' AND c.total_gasto < ?'; params.push(ONDAS[onda].max); }
  }
  if (soPendentes) sql += ' AND rc.id IS NULL';
  sql += ' ORDER BY c.total_gasto DESC LIMIT 400';

  const gancho = ganchoDe(t);
  const lista = db.prepare(sql).all(...params).map(c => {
    const texto = interpolar(MSG_PADRAO, { ...varsDe(t, c), gancho });
    return {
      ...c,
      onda: ondaDe(c.total_gasto),
      mensagem: texto,
      wa_url: urlWhatsApp(c.telefone, texto),
      contatado: !!c.contato_id,
    };
  });
  res.json({ clientes: lista, total: lista.length });
});

// POST /api/reativacao/contatos/:clienteId -> marca como contatada.
// Body: { mensagem, onda, cupom_pct } — se cupom_pct > 0, emite o codigo NOMINAL.
//
// O cupom nasce 'ativo' (nao 'rascunho' como na regua): aqui o envio E o clique, nao
// ha um passo posterior de "marcar como enviada" onde ele seria ativado.
router.post('/contatos/:clienteId', (req, res) => {
  const t = exigirTenant(req.tenantId);
  const clienteId = parseInt(req.params.clienteId, 10);
  const { mensagem, onda, cupom_pct, cupom_dias } = req.body || {};

  const cli = db.prepare(
    `SELECT id, nome FROM clientes WHERE id = ? AND tenant_id = ? AND tipo = 'importado'`
  ).get(clienteId, t);
  if (!cli) return res.status(404).json({ erro: 'Cliente não encontrada na base importada' });

  let cupom = null;
  db.transaction(() => {
    const pct = Number(cupom_pct) || 0;
    if (pct > 0) {
      cupom = emitirCupom(t, {
        clienteId, tipo: 'REATIVACAO', prefixo: 'VOLTA', pct,
        dias: Number(cupom_dias) || 15, status: 'ativo',
      });
    }
    db.prepare(`
      INSERT INTO reativacao_contatos (tenant_id, cliente_id, onda, mensagem, cupom)
      VALUES (?, ?, ?, ?, ?)
      ON CONFLICT (tenant_id, cliente_id) DO UPDATE SET
        onda = excluded.onda, mensagem = excluded.mensagem,
        cupom = COALESCE(excluded.cupom, reativacao_contatos.cupom),
        contatado_em = datetime('now','localtime')
    `).run(t, clienteId, onda || null, mensagem || null, cupom ? cupom.codigo : null);
  })();

  res.json({ ok: true, cliente_id: clienteId, cupom: cupom ? cupom.codigo : null,
             cupom_validade: cupom ? cupom.validade : null });
});

// DELETE /api/reativacao/contatos/:clienteId -> desmarca (erro de clique / reabordar)
router.delete('/contatos/:clienteId', (req, res) => {
  const t = exigirTenant(req.tenantId);
  const r = db.prepare('DELETE FROM reativacao_contatos WHERE cliente_id = ? AND tenant_id = ?')
    .run(parseInt(req.params.clienteId, 10), t);
  if (!r.changes) return res.status(404).json({ erro: 'Contato não encontrado' });
  res.json({ ok: true });
});

// PATCH /api/reativacao/contatos/:clienteId/respondeu -> ela respondeu.
// E' a metrica que decide se a campanha continua: taxa de resposta baixa significa
// que a MENSAGEM nao convence, e insistir gastaria o resto da base do mesmo jeito.
router.patch('/contatos/:clienteId/respondeu', (req, res) => {
  const t = exigirTenant(req.tenantId);
  const valor = req.body && req.body.respondeu === false ? 0 : 1;
  const r = db.prepare(
    'UPDATE reativacao_contatos SET respondeu = ? WHERE cliente_id = ? AND tenant_id = ?'
  ).run(valor, parseInt(req.params.clienteId, 10), t);
  if (!r.changes) return res.status(404).json({ erro: 'Contato não encontrado' });
  res.json({ ok: true, respondeu: !!valor });
});

module.exports = router;
