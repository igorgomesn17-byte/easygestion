// ============================================================
// API de VALES / CRÉDITOS
// Validação e utilização de vales gerados em trocas
// ============================================================
const express = require('express');
const router = express.Router();
const { db } = require('../db/database');
const { exigirFeature } = require('../middleware/seguranca');

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
router.post('/:codigo/usar', exigirFeature('vale_credito'), (req, res) => {
  const codigo = req.params.codigo.toUpperCase();
  const { valor_a_usar = 0, venda_id = null } = req.body;

  if (!valor_a_usar || valor_a_usar <= 0) {
    return res.status(400).json({ erro: 'Valor inválido para usar do vale' });
  }

  const vale = db.prepare(`
    SELECT id, saldo, valor
    FROM vales
    WHERE codigo = ? AND tenant_id = ? AND saldo > 0
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
    const estaInativo = novoSaldo <= 0 ? 0 : 1; // Marcar como inativo se saldo zerou

    db.prepare(`
      UPDATE vales
      SET saldo = ?, utilizado = ?, ativo = ?, venda_utilizacao_id = ?
      WHERE id = ? AND tenant_id = ?
    `).run(novoSaldo, novoUtilizado, estaInativo, venda_id, vale.id, req.tenantId);

    res.json({
      sucesso: true,
      codigo,
      valor_utilizado: valor_a_usar,
      novo_saldo: novoSaldo,
      ativo: estaInativo,
      venda_id
    });
  } catch (e) {
    res.status(500).json({ erro: e.message });
  }
});

// GET /api/vales -> lista vales (filtros: status, busca, paginação)
router.get('/', (req, res) => {
  const { ativo, cliente_id, status, busca, limit, offset } = req.query;
  let sql = `
    SELECT vl.id, vl.codigo, vl.valor, vl.saldo, vl.utilizado, vl.data_geracao,
           vl.validade, vl.cliente_id, vl.ativo, vl.troca_id, vl.venda_utilizacao_id, vl.notas,
           c.nome AS cliente_nome
    FROM vales vl
    LEFT JOIN clientes c ON c.id = vl.cliente_id AND c.tenant_id = vl.tenant_id
    WHERE vl.tenant_id = ?`;
  const params = [req.tenantId];

  // Filtros legados (compatibilidade)
  if (ativo !== undefined) {
    sql += ' AND vl.ativo = ?';
    params.push(ativo === 'true' ? 1 : 0);
  }
  if (cliente_id) {
    sql += ' AND vl.cliente_id = ?';
    params.push(cliente_id);
  }

  // Novo filtro por status derivado
  const hoje = new Date().toISOString().split('T')[0];
  if (status === 'ativo') {
    sql += ' AND vl.ativo = 1 AND (vl.validade IS NULL OR vl.validade >= ?)';
    params.push(hoje);
  } else if (status === 'utilizado') {
    sql += ' AND vl.ativo = 0 AND vl.utilizado > 0';
  } else if (status === 'expirado') {
    sql += ' AND vl.ativo = 1 AND vl.validade IS NOT NULL AND vl.validade < ?';
    params.push(hoje);
  }

  // Busca textual
  if (busca) {
    sql += ' AND (vl.codigo LIKE ? OR c.nome LIKE ?)';
    const like = `%${busca}%`;
    params.push(like, like);
  }

  sql += ' ORDER BY vl.data_geracao DESC';

  // Paginação
  const lim = Math.min(parseInt(limit, 10) || 100, 300);
  sql += ' LIMIT ?';
  params.push(lim);

  if (offset) {
    sql += ' OFFSET ?';
    params.push(parseInt(offset, 10) || 0);
  }

  const vales = db.prepare(sql).all(...params);
  res.json(vales);
});

module.exports = router;
