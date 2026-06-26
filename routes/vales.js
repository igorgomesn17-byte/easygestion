// ============================================================
// API de VALES / CRÉDITOS
// Validação e utilização de vales gerados em trocas
// ============================================================
const express = require('express');
const router = express.Router();
const { db } = require('../db/database');

// GET /api/vales/:codigo -> consulta vale (valida e retorna saldo)
router.get('/:codigo', (req, res) => {
  try {
    const codigo = req.params.codigo.toUpperCase();

    const vale = db.prepare(`
      SELECT id, valor, saldo, utilizado, validade, ativo, data_geracao
      FROM vales
      WHERE codigo = ? AND tenant_id = ? AND ativo = 1
    `).get(codigo, req.tenantId);

    if (!vale) {
      return res.status(404).json({ erro: 'Vale não encontrado ou já cancelado' });
    }

    // Verificar validade
    if (vale.validade) {
      const hoje = new Date().toISOString().split('T')[0];
      if (hoje > vale.validade) {
        return res.status(422).json({ erro: 'Vale expirado', validade: vale.validade });
      }
    }

    // Retornar saldo disponível
    res.json({
      codigo,
      valor: vale.valor,
      saldo: vale.saldo,
      saldo_disponivel: vale.saldo,
      utilizado: vale.utilizado,
      validade: vale.validade,
      data_geracao: vale.data_geracao
    });
  } catch (e) {
    res.status(500).json({ erro: 'Erro interno do servidor' });
  }
});

// POST /api/vales/:codigo/usar -> usar vale em uma venda
// body: { valor_a_usar, venda_id }
router.post('/:codigo/usar', (req, res) => {
  const codigo = req.params.codigo.toUpperCase();
  const { valor_a_usar = 0, venda_id = null } = req.body;

  if (!valor_a_usar || valor_a_usar <= 0) {
    return res.status(400).json({ erro: 'Valor inválido para usar do vale' });
  }

  const vale = db.prepare(`
    SELECT id, saldo, valor
    FROM vales
    WHERE codigo = ? AND tenant_id = ? AND ativo = 1
  `).get(codigo, req.tenantId);

  if (!vale) {
    return res.status(404).json({ erro: 'Vale não encontrado' });
  }

  if (vale.saldo < valor_a_usar) {
    return res.status(422).json({
      erro: 'Saldo insuficiente no vale',
      saldo_disponivel: vale.saldo,
      valor_solicitado: valor_a_usar
    });
  }

  try {
    // Atualizar saldo do vale
    const novoSaldo = +(vale.saldo - valor_a_usar).toFixed(2);
    const novoUtilizado = +(vale.valor - novoSaldo).toFixed(2);

    db.prepare(`
      UPDATE vales
      SET saldo = ?, utilizado = ?
      WHERE id = ? AND tenant_id = ?
    `).run(novoSaldo, novoUtilizado, vale.id, req.tenantId);

    res.json({
      sucesso: true,
      codigo,
      valor_utilizado: valor_a_usar,
      novo_saldo: novoSaldo,
      venda_id
    });
  } catch (e) {
    res.status(500).json({ erro: e.message });
  }
});

// GET /api/vales -> lista vales ativos (filtros opcionais)
router.get('/', (req, res) => {
  const { ativo, cliente_id } = req.query;
  let sql = 'SELECT id, codigo, valor, saldo, data_geracao, validade, cliente_id FROM vales WHERE tenant_id = ?';
  const params = [req.tenantId];

  if (ativo !== undefined) {
    sql += ' AND ativo = ?';
    params.push(ativo === 'true' ? 1 : 0);
  }

  if (cliente_id) {
    sql += ' AND cliente_id = ?';
    params.push(cliente_id);
  }

  sql += ' ORDER BY data_geracao DESC LIMIT 100';
  const vales = db.prepare(sql).all(...params);
  res.json(vales);
});

module.exports = router;
