// ============================================================
// CUPOM DA REGUA — o que prova se o relacionamento funciona.
//
// Ate aqui o "VOLTE20" da mensagem era so TEXTO: nao validava, nao descontava, e —
// o que mais importa — nao MEDIA. Nao dava pra responder "a regua se paga?".
//
// -- NOMINAL: um codigo por cliente, nao um por campanha --
//
// A Maria recebe VOLTE20-K3P9; a Ana, VOLTE20-M7X2. Uso unico. Isso resolve duas
// coisas de uma vez:
//   1. VAZAMENTO — a cliente posta o codigo no grupo do WhatsApp e ele nao serve
//      pra mais ninguem. O sistema recusa: "este cupom e' da Maria".
//   2. ATRIBUICAO — sei exatamente qual mensagem trouxe qual venda. Sem isso,
//      "faturei R$ 2.400 esse mes" nao diz se foi a regua ou o acaso.
//
// -- CUPOM NAO E' VALE --
//
// Cupom = DESCONTO: reduz o total ANTES do pagamento (entra em vendas.desconto).
// Vale  = DINHEIRO: e' forma de pagamento (venda_pagamentos, caixa_dia.total_vale).
// Podem coexistir na mesma venda. Nao confundir os dois no PDV.
//
// -- A BAIXA MORA NO BACKEND --
//
// Como a do vale (que ja doeu neste sistema: morava no navegador, o front as vezes
// nao chamava, e o vale ficava reutilizavel pra sempre). O consumo do cupom acontece
// DENTRO da transacao da venda, com UPDATE condicional. Nunca no front.
// ============================================================
const { db } = require('../db/database');
const { exigirTenant, apelido } = require('./crm');

const MAX_PCT = 50;   // teto de seguranca: cupom_pct > 50 e' quase sempre erro de digitacao

// Sufixo de 4 chars, alfabeto sem I, O, 0 e 1 — a cliente le o codigo em voz alta
// pro caixa, e "VOLTE20-I0O1" e' um pedido de desculpas esperando pra acontecer.
// CONFERE contra o banco antes de devolver (mesmo molde de gerarCodigoVale): uma
// colisao estouraria o UNIQUE dentro da transacao do scheduler.
function gerarCodigo(tenantId, prefixo, tentativas = 12) {
  const t = exigirTenant(tenantId);
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const base = String(prefixo || 'CUPOM').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 12) || 'CUPOM';
  const jaExiste = db.prepare('SELECT 1 FROM crm_cupons WHERE codigo = ? AND tenant_id = ?');
  for (let i = 0; i < tentativas; i++) {
    let sufixo = '';
    for (let c = 0; c < 4; c++) sufixo += chars.charAt(Math.floor(Math.random() * chars.length));
    const codigo = `${base}-${sufixo}`;
    if (!jaExiste.get(codigo, t)) return codigo;
  }
  throw new Error('Não foi possível gerar um código de cupom único. Tente novamente.');
}

function emDias(dias, base = new Date()) {
  const d = new Date(base);
  d.setDate(d.getDate() + (Number(dias) > 0 ? Number(dias) : 7));
  return d.toISOString().slice(0, 10);
}

// ============================================================
// EMISSAO
//
// Nasce RASCUNHO por padrao. O cupom so passa a valer quando a lojista de fato
// ENVIA a mensagem (ativarCupomDaAcao) — e a validade conta a partir dali, que e' o
// justo: a mensagem diz "valido por 7 dias", e a cliente leu hoje, nao no dia em que
// o servidor gerou a fila.
//
// Chamada de DENTRO da transacao do scheduler. Nao abre transacao propria.
// ============================================================
function emitirCupom(tenantId, { clienteId, acaoId = null, tipo, prefixo, pct, dias, minCompra = 0, status = 'rascunho' }) {
  const t = exigirTenant(tenantId);
  if (!clienteId) return null;
  if (!(pct > 0)) return null;                    // cupom de 0% nao e' cupom
  if (pct > MAX_PCT) return null;                 // guarda: 100% seria a loja dando tudo

  const codigo = gerarCodigo(t, prefixo);
  const info = db.prepare(`
    INSERT INTO crm_cupons (tenant_id, codigo, cliente_id, acao_id, tipo, pct, min_compra, validade, status)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(t, codigo, clienteId, acaoId, tipo, pct, minCompra || 0, emDias(dias), status);

  return { id: Number(info.lastInsertRowid), codigo, pct, dias, validade: emDias(dias), status };
}

// A lojista enviou a mensagem: o cupom vira valido, e o relogio da validade comeca
// a correr AGORA (nao no dia em que o scheduler gerou a fila).
function ativarCupomDaAcao(tenantId, acaoId, dias) {
  const t = exigirTenant(tenantId);
  const cup = db.prepare("SELECT id FROM crm_cupons WHERE tenant_id = ? AND acao_id = ? AND status = 'rascunho'").get(t, acaoId);
  if (!cup) return null;
  const validade = emDias(dias);
  db.prepare("UPDATE crm_cupons SET status = 'ativo', validade = ? WHERE id = ? AND tenant_id = ?")
    .run(validade, cup.id, t);
  return { id: cup.id, validade };
}

// A lojista tirou o contato da lista: o cupom morre junto. Sem isso ficaria um
// desconto pendurado, valendo, pra uma cliente que nunca recebeu o codigo.
function cancelarCupomDaAcao(tenantId, acaoId) {
  const t = exigirTenant(tenantId);
  db.prepare("UPDATE crm_cupons SET status = 'cancelado' WHERE tenant_id = ? AND acao_id = ? AND status IN ('rascunho','ativo')")
    .run(t, acaoId);
}

// ============================================================
// VALIDACAO — o que a atendente ve quando digita o codigo.
//
// Devolve { ok, cupom, erro, http }. Nao decide nada sozinha: e' PREVIEW. A decisao
// financeira acontece no UPDATE condicional de baixarCupom, dentro da tx da venda.
// ============================================================
function validarCupom(tenantId, codigo, clienteId, subtotal, hoje) {
  const t = exigirTenant(tenantId);
  const cod = String(codigo || '').toUpperCase().trim();
  if (!cod) return { ok: false, http: 400, erro: 'Informe o código do cupom.' };

  const c = db.prepare('SELECT * FROM crm_cupons WHERE codigo = ? AND tenant_id = ?').get(cod, t);

  // Rascunho e inexistente dao a MESMA resposta de proposito: um cupom que a lojista
  // ainda nao enviou nao deve ser "descobrivel" no balcao.
  if (!c || c.status === 'rascunho') return { ok: false, http: 404, erro: 'Cupom não encontrado.' };
  if (c.status === 'cancelado') return { ok: false, http: 422, erro: 'Este cupom foi cancelado.' };
  if (c.status === 'usado') {
    const q = c.usado_em ? ` em ${c.usado_em.slice(8, 10)}/${c.usado_em.slice(5, 7)}` : '';
    return { ok: false, http: 422, erro: `Este cupom já foi usado${q}.` };
  }

  // Expiracao LAZY: comparada aqui e no UPDATE da baixa. Nao existe job que marca
  // 'expirado' — job que nao roda (deploy, reboot) deixaria cupom vencido passar.
  const hj = hoje || new Date().toISOString().slice(0, 10);
  if (c.validade < hj) {
    return { ok: false, http: 422, erro: `Cupom expirado em ${c.validade.slice(8, 10)}/${c.validade.slice(5, 7)}.` };
  }

  // NOMINAL: e' aqui que o codigo vazado no grupo do WhatsApp para.
  if (!clienteId) {
    return { ok: false, http: 422, erro: 'Este cupom é de uma cliente específica. Selecione a cliente na venda.' };
  }
  if (Number(clienteId) !== Number(c.cliente_id)) {
    const dona = db.prepare('SELECT nome FROM clientes WHERE id = ? AND tenant_id = ?').get(c.cliente_id, t);
    // So o primeiro nome: a atendente precisa saber de quem e', nao o cadastro dela.
    const nome = dona ? apelido(dona.nome) : 'outra cliente';
    return { ok: false, http: 422, erro: `Este cupom é da ${nome}. Cada cliente tem o código dela.` };
  }

  if (c.min_compra > 0 && Number(subtotal) < c.min_compra - 0.01) {
    return { ok: false, http: 422, erro: `Este cupom vale em compras a partir de R$ ${c.min_compra.toFixed(2)}.` };
  }

  return { ok: true, cupom: c };
}

// Quanto este cupom desconta de uma compra. Sempre sobre o SUBTOTAL (a mercadoria),
// nunca sobre o total — o acrescimo de parcelamento e' calculado depois do desconto.
function descontoDe(cupom, subtotal) {
  return +((Number(subtotal) * Number(cupom.pct)) / 100).toFixed(2);
}

// ============================================================
// BAIXA — DENTRO da transacao da venda. Nunca no navegador.
//
// O `AND status='ativo' AND validade >= ?` no proprio UPDATE fecha a janela de
// corrida entre duas vendas simultaneas com o mesmo codigo — mesma tecnica do
// `AND saldo >= ?` da baixa do vale. Se changes !== 1, quem chama derruba a
// transacao inteira: a venda NAO existe sem a baixa do cupom.
// ============================================================
function baixarCupom(tenantId, cupomId, vendaId, clienteId, valorDesconto, hoje) {
  const t = exigirTenant(tenantId);
  const hj = hoje || new Date().toISOString().slice(0, 10);
  const upd = db.prepare(`
    UPDATE crm_cupons
    SET status = 'usado', venda_id = ?, valor_desconto = ?, usado_em = datetime('now','localtime')
    WHERE id = ? AND tenant_id = ? AND cliente_id = ? AND status = 'ativo' AND validade >= ?
  `).run(vendaId, valorDesconto, cupomId, t, clienteId, hj);
  return upd.changes === 1;
}

// ============================================================
// DEVOLUCAO — a venda foi cancelada.
//
// O cupom VOLTA a valer (nao queima). A venda deixou de existir, o desconto tambem:
// queimar o cupom deixaria a cliente sem a peca E sem o benefício. E' o oposto da
// regra do premio do clube (que NAO volta — aquele vale ja esta na mao dela).
//
// A validade NAO e' estendida. Se venceu no meio tempo, ele volta 'ativo' mas
// vencido, e o PDV recusa na hora (a checagem e' lazy).
// ============================================================
function devolverCupomDaVenda(tenantId, vendaId) {
  const t = exigirTenant(tenantId);
  const r = db.prepare(`
    UPDATE crm_cupons SET status = 'ativo', venda_id = NULL, valor_desconto = NULL, usado_em = NULL
    WHERE tenant_id = ? AND venda_id = ? AND status = 'usado'
  `).run(t, vendaId);
  return r.changes;
}

// Cupons que a cliente pode usar AGORA (pro PDV oferecer sozinho — a cliente esquece
// o codigo, a atendente nao deveria depender disso).
function cuponsAtivosDe(tenantId, clienteId, hoje) {
  const t = exigirTenant(tenantId);
  const hj = hoje || new Date().toISOString().slice(0, 10);
  return db.prepare(`
    SELECT id, codigo, tipo, pct, min_compra, validade FROM crm_cupons
    WHERE tenant_id = ? AND cliente_id = ? AND status = 'ativo' AND validade >= ?
    ORDER BY validade ASC
  `).all(t, clienteId, hj);
}

module.exports = {
  MAX_PCT, gerarCodigo, emitirCupom, ativarCupomDaAcao, cancelarCupomDaAcao,
  validarCupom, descontoDe, baixarCupom, devolverCupomDaVenda, cuponsAtivosDe, emDias,
};
