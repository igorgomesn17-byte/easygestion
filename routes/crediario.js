// ============================================================
// API de CREDIARIO (o carne)
//
// A loja financia: a cliente leva a peca hoje e paga em N parcelas direto pra
// loja. NAO e' parcelamento de cartao (la a maquininha assume o risco e o dinheiro
// cai). Aqui o calote e' prejuizo do lojista. Sem juros, multa ou negativacao.
//
// O CARNE E' CRIADO EM routes/vendas.js, dentro da transacao da venda — nao aqui.
// Este arquivo cuida do que vem depois: consultar, receber parcela e cancelar.
// ============================================================
const express = require('express');
const router = express.Router();
const { db } = require('../db/database');
const { hojeLocal } = require('../lib/datas');
const { aplicarPagamento } = require('../lib/crediario');
const { atualizarCaixaDia } = require('./vendas');
const { cacheRelatorioPorTenant } = require('../middleware/rate-limit-custoso');

// 'atrasada' e' DERIVADO, nunca gravado: a parcela vira atrasada sozinha a
// meia-noite. Job noturno seria mais uma engrenagem pra falhar — e ficaria errada
// o dia seguinte inteiro se falhasse.
const SQL_STATUS_EFETIVO = `
  CASE WHEN p.status <> 'paga' AND p.vencimento < ? THEN 'atrasada' ELSE p.status END`;
const SQL_DIAS_ATRASO = `
  CASE WHEN p.status <> 'paga' AND p.vencimento < ?
       THEN CAST(julianday(?) - julianday(p.vencimento) AS INTEGER) ELSE 0 END`;

// So o admin decide fiar/desfiar. A vendedora vende no carne e recebe parcela
// (e' ela que esta no balcao quando a cliente chega pra pagar), mas cancelar um
// carne mexe no que a cliente deve: e' decisao de dono.
function apenasAdminAqui(req, res, next) {
  if (req.session && req.session.papel === 'vendedor') {
    return res.status(403).json({ erro: 'Sem permissão para esta área' });
  }
  next();
}

// GET /api/crediario/parcelas -> a tela de Cobranca.
// Filtros: ?status=atrasada|aberta|parcial|paga  ?vencimento_ate=YYYY-MM-DD  ?cliente_id=
router.get('/parcelas', apenasAdminAqui, (req, res) => {
  try {
    const hoje = hojeLocal();
    const { status, vencimento_ate, cliente_id, limit, offset } = req.query;

    let sql = `
      SELECT p.id, p.crediario_id, p.numero, p.valor, p.vencimento, p.valor_pago,
             p.data_pagamento, p.status,
             ${SQL_STATUS_EFETIVO} AS status_efetivo,
             ${SQL_DIAS_ATRASO}    AS dias_atraso,
             ROUND(p.valor - p.valor_pago, 2) AS saldo,
             cr.venda_id, cr.num_parcelas,
             c.id AS cliente_id, c.nome AS cliente_nome, c.telefone AS cliente_telefone
      FROM crediario_parcelas p
      JOIN crediarios cr ON cr.id = p.crediario_id AND cr.tenant_id = p.tenant_id
      JOIN clientes    c  ON c.id = cr.cliente_id  AND c.tenant_id = cr.tenant_id
      WHERE p.tenant_id = ? AND cr.status <> 'cancelado'`;
    const params = [hoje, hoje, hoje, req.tenantId];

    if (status === 'atrasada') {
      sql += ` AND p.status <> 'paga' AND p.vencimento < ?`;
      params.push(hoje);
    } else if (status) {
      sql += ' AND p.status = ?';
      params.push(status);
    }
    if (vencimento_ate) { sql += ' AND p.vencimento <= ?'; params.push(vencimento_ate); }
    if (cliente_id)     { sql += ' AND cr.cliente_id = ?'; params.push(parseInt(cliente_id, 10)); }

    // quem esta ha mais tempo devendo aparece primeiro
    sql += ' ORDER BY dias_atraso DESC, p.vencimento ASC';
    const lim = Math.min(parseInt(limit, 10) || 200, 500);
    sql += ' LIMIT ?';
    params.push(lim);
    if (offset) { sql += ' OFFSET ?'; params.push(parseInt(offset, 10) || 0); }

    res.json(db.prepare(sql).all(...params));
  } catch (e) {
    res.status(500).json({ erro: 'Erro ao listar as parcelas' });
  }
});

// GET /api/crediario/cliente/:id -> o que essa cliente deve, com historico
router.get('/cliente/:id', (req, res) => {
  try {
    const hoje = hojeLocal();
    const clienteId = parseInt(req.params.id, 10);

    const carnes = db.prepare(`
      SELECT cr.id, cr.venda_id, cr.valor_total, cr.entrada, cr.num_parcelas, cr.status, cr.criado_em,
             ROUND(COALESCE(SUM(p.valor - p.valor_pago), 0), 2) AS saldo_devedor
      FROM crediarios cr
      LEFT JOIN crediario_parcelas p ON p.crediario_id = cr.id AND p.tenant_id = cr.tenant_id
      WHERE cr.tenant_id = ? AND cr.cliente_id = ?
      GROUP BY cr.id
      ORDER BY cr.criado_em DESC
    `).all(req.tenantId, clienteId);

    const parcelas = db.prepare(`
      SELECT p.id, p.crediario_id, p.numero, p.valor, p.vencimento, p.valor_pago, p.status,
             ${SQL_STATUS_EFETIVO} AS status_efetivo,
             ${SQL_DIAS_ATRASO}    AS dias_atraso,
             ROUND(p.valor - p.valor_pago, 2) AS saldo
      FROM crediario_parcelas p
      JOIN crediarios cr ON cr.id = p.crediario_id AND cr.tenant_id = p.tenant_id
      WHERE p.tenant_id = ? AND cr.cliente_id = ? AND cr.status <> 'cancelado'
      ORDER BY p.vencimento ASC
    `).all(hoje, hoje, hoje, req.tenantId, clienteId);

    const deve = +parcelas.reduce((s, p) => s + p.saldo, 0).toFixed(2);
    res.json({ cliente_id: clienteId, deve, carnes, parcelas });
  } catch (e) {
    res.status(500).json({ erro: 'Erro ao buscar o crediário do cliente' });
  }
});

// GET /api/crediario/:id -> um carne com parcelas e recebimentos (alimenta o carne imprimivel)
router.get('/:id', (req, res) => {
  try {
    const hoje = hojeLocal();
    const id = parseInt(req.params.id, 10);

    const carne = db.prepare(`
      SELECT cr.*, c.nome AS cliente_nome, c.telefone AS cliente_telefone, c.cidade AS cliente_cidade,
             v.data_hora AS venda_data, v.total AS venda_total
      FROM crediarios cr
      JOIN clientes c ON c.id = cr.cliente_id AND c.tenant_id = cr.tenant_id
      LEFT JOIN vendas v ON v.id = cr.venda_id AND v.tenant_id = cr.tenant_id
      WHERE cr.id = ? AND cr.tenant_id = ?
    `).get(id, req.tenantId);
    if (!carne) return res.status(404).json({ erro: 'Carnê não encontrado' });

    carne.parcelas = db.prepare(`
      SELECT p.id, p.numero, p.valor, p.vencimento, p.valor_pago, p.data_pagamento, p.status,
             ${SQL_STATUS_EFETIVO} AS status_efetivo,
             ${SQL_DIAS_ATRASO}    AS dias_atraso,
             ROUND(p.valor - p.valor_pago, 2) AS saldo
      FROM crediario_parcelas p
      WHERE p.crediario_id = ? AND p.tenant_id = ?
      ORDER BY p.numero ASC
    `).all(hoje, hoje, hoje, id, req.tenantId);

    carne.recebimentos = db.prepare(`
      SELECT r.id, r.parcela_id, r.data, r.valor, r.forma, p.numero AS parcela_numero
      FROM crediario_recebimentos r
      JOIN crediario_parcelas p ON p.id = r.parcela_id AND p.tenant_id = r.tenant_id
      WHERE p.crediario_id = ? AND r.tenant_id = ?
      ORDER BY r.data ASC, r.id ASC
    `).all(id, req.tenantId);

    carne.saldo_devedor = +carne.parcelas.reduce((s, p) => s + p.saldo, 0).toFixed(2);
    res.json(carne);
  } catch (e) {
    res.status(500).json({ erro: 'Erro ao buscar o carnê' });
  }
});

// POST /api/crediario/parcelas/:id/pagar -> recebe (pode ser PARCIAL) e lanca no caixa
//
// NAO exige caixa aberto (vender exige). A cliente aparece pra pagar o carne a
// qualquer hora, inclusive num dia em que a loja nao abriu o caixa. Travar isso
// seria criar um problema que o caderno de papel nao tinha.
router.post('/parcelas/:id/pagar', (req, res) => {
  const FORMAS = ['dinheiro', 'pix', 'pix_chave', 'debito', 'credito_vista'];
  try {
    const parcelaId = parseInt(req.params.id, 10);
    const valor = +(parseFloat(req.body.valor) || 0).toFixed(2);
    const forma = String(req.body.forma || 'dinheiro');
    const data = req.body.data || hojeLocal();

    if (!FORMAS.includes(forma)) return res.status(400).json({ erro: `Forma de pagamento inválida: ${forma}` });
    if (!/^\d{4}-\d{2}-\d{2}$/.test(data)) return res.status(400).json({ erro: 'Data inválida' });

    // o JOIN com crediarios e' o que prova o dono: a parcela sozinha nao prova nada
    const parcela = db.prepare(`
      SELECT p.id, p.valor, p.valor_pago, p.status, p.crediario_id, cr.status AS carne_status
      FROM crediario_parcelas p
      JOIN crediarios cr ON cr.id = p.crediario_id AND cr.tenant_id = p.tenant_id
      WHERE p.id = ? AND p.tenant_id = ?
    `).get(parcelaId, req.tenantId);

    if (!parcela) return res.status(404).json({ erro: 'Parcela não encontrada' });
    if (parcela.carne_status === 'cancelado') return res.status(422).json({ erro: 'Este carnê foi cancelado' });

    // a regra mora em lib/crediario.js (pura, testada). Aqui so persistimos.
    let novo;
    try {
      novo = aplicarPagamento(parcela, valor);
    } catch (e) {
      return res.status(422).json({ erro: e.message });
    }

    const tx = db.transaction(() => {
      db.prepare(`INSERT INTO crediario_recebimentos (tenant_id, parcela_id, data, valor, forma)
                  VALUES (?, ?, ?, ?, ?)`).run(req.tenantId, parcelaId, data, valor, forma);

      // A guarda mora no proprio UPDATE (mesmo truque da baixa do vale): se duas
      // atendentes receberem a mesma parcela ao mesmo tempo, a segunda nao passa.
      const upd = db.prepare(`
        UPDATE crediario_parcelas
        SET valor_pago = valor_pago + ?, status = ?, data_pagamento = ?
        WHERE id = ? AND tenant_id = ? AND valor_pago + ? <= valor + 0.01
      `).run(valor, novo.status, novo.status === 'paga' ? data : null, parcelaId, req.tenantId, valor);
      if (upd.changes !== 1) throw new Error('Esta parcela mudou enquanto o pagamento era registrado. Confira e tente de novo.');

      // ultima parcela quitada -> o carne se quita sozinho
      const restam = db.prepare(`SELECT COUNT(*) AS n FROM crediario_parcelas
                                 WHERE crediario_id = ? AND tenant_id = ? AND status <> 'paga'`)
        .get(parcela.crediario_id, req.tenantId).n;
      if (restam === 0) {
        db.prepare(`UPDATE crediarios SET status = 'quitado' WHERE id = ? AND tenant_id = ?`)
          .run(parcela.crediario_id, req.tenantId);
      }

      // o dinheiro entra no caixa AGORA (na venda ele nao entrou). A linha do dia
      // pode nem existir (loja nao abriu o caixa): garante antes de recalcular.
      db.prepare('INSERT OR IGNORE INTO caixa_dia (data, tenant_id) VALUES (?, ?)').run(data, req.tenantId);
      atualizarCaixaDia(data, req.tenantId);

      return restam === 0;
    });

    const quitou = tx();
    cacheRelatorioPorTenant.invalidarTudo(req.tenantId);
    res.status(201).json({ ok: true, parcela_id: parcelaId, ...novo, carne_quitado: quitou });
  } catch (e) {
    res.status(500).json({ erro: e.message });
  }
});

// DELETE /api/crediario/:id -> cancela o carne (nao apaga: vira 'cancelado')
router.delete('/:id', apenasAdminAqui, (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    const carne = db.prepare('SELECT id, status FROM crediarios WHERE id = ? AND tenant_id = ?')
      .get(id, req.tenantId);
    if (!carne) return res.status(404).json({ erro: 'Carnê não encontrado' });
    if (carne.status === 'cancelado') return res.status(422).json({ erro: 'Este carnê já está cancelado' });

    // Recebimento ja lancado ficou no caixa daquele dia — e o dinheiro entrou de
    // verdade. Cancelar o carne nao desfaz caixa passado; so para de cobrar.
    db.prepare(`UPDATE crediarios SET status = 'cancelado' WHERE id = ? AND tenant_id = ?`)
      .run(id, req.tenantId);
    res.json({ ok: true, id, status: 'cancelado' });
  } catch (e) {
    res.status(500).json({ erro: 'Erro ao cancelar o carnê' });
  }
});

module.exports = router;
