// ============================================================
// Gerenciamento de Assinaturas (SaaS)
// GET  /api/assinaturas/minha        → detalhes da assinatura do cliente
// GET  /api/assinaturas/pagamentos   → histórico de cobranças
// GET  /api/admin/assinaturas        → lista todas (admin)
// PATCH /api/admin/assinaturas/:id   → atualizar plano (admin)
// ============================================================
const express = require('express');
const { db } = require('../db/database');
const { exigirPapel, apenasAdmin } = require('../middleware/seguranca');
const { obterStatusAssinatura, renovarAssinatura, cancelarAssinatura } = require('../lib/assinatura');
const router = express.Router();

// --- GET /minha → detalhes da assinatura do cliente logado ---
router.get('/minha', (req, res) => {
  if (***REMOVED***req.session?.logado || ***REMOVED***req.session?.tenant_id) {
    return res.status(401).json({ erro: 'Não autenticado' });
  }

  try {
    const tenantId = req.session.tenant_id;
    const assinatura = db.prepare('SELECT * FROM assinaturas WHERE tenant_id = ?').get(tenantId);
    const status = obterStatusAssinatura(tenantId);

    if (***REMOVED***assinatura) {
      return res.json({
        assinatura: null,
        status,
        mensagem: 'Cliente em período de teste (sem assinatura)',
      });
    }

    res.json({
      assinatura,
      status,
    });
  } catch (err) {
    console.error('[ASSINATURA] Erro ao buscar minha assinatura:', err);
    return res.status(500).json({ erro: 'Erro ao buscar assinatura' });
  }
});

// --- GET /pagamentos → histórico de cobranças do cliente ---
router.get('/pagamentos', (req, res) => {
  if (***REMOVED***req.session?.logado || ***REMOVED***req.session?.tenant_id) {
    return res.status(401).json({ erro: 'Não autenticado' });
  }

  try {
    const tenantId = req.session.tenant_id;
    const cobracas = db.prepare(`
      SELECT * FROM cobracas
      WHERE tenant_id = ?
      ORDER BY data_cobranca DESC
      LIMIT 12
    `).all(tenantId);

    // Calcular resumo
    const resumo = {
      total_pago: 0,
      total_pendente: 0,
      proxima_cobranca: null,
    };

    cobracas.forEach(c => {
      if (c.status === 'pago') {
        resumo.total_pago += c.valor;
      } else if (c.status === 'pendente') {
        resumo.total_pendente += c.valor;
        if (***REMOVED***resumo.proxima_cobranca || c.data_cobranca < resumo.proxima_cobranca) {
          resumo.proxima_cobranca = c.data_cobranca;
        }
      }
    });

    res.json({
      cobracas,
      resumo,
    });
  } catch (err) {
    console.error('[ASSINATURA] Erro ao buscar pagamentos:', err);
    return res.status(500).json({ erro: 'Erro ao buscar histórico' });
  }
});

// --- GET /admin/assinaturas → lista todas as assinaturas (admin) ---
router.get('/admin/assinaturas', apenasAdmin, (req, res) => {
  try {
    const assinaturas = db.prepare(`
      SELECT
        a.*,
        t.nome_loja,
        t.email,
        t.status as tenant_status,
        COUNT(DISTINCT c.id) as num_cobracas
      FROM assinaturas a
      JOIN tenants t ON t.id = a.tenant_id
      LEFT JOIN cobracas c ON c.assinatura_id = a.id
      GROUP BY a.id
      ORDER BY a.data_inicio DESC
    `).all();

    // Enriquecer com status
    const resultado = assinaturas.map(a => ({
      ...a,
      status_atual: obterStatusAssinatura(a.tenant_id),
    }));

    res.json({ assinaturas: resultado, total: resultado.length });
  } catch (err) {
    console.error('[ASSINATURA] Erro ao listar assinaturas:', err);
    return res.status(500).json({ erro: 'Erro ao listar assinaturas' });
  }
});

// --- GET /admin/assinaturas/:id → detalhes de uma assinatura ---
router.get('/admin/assinaturas/:id', apenasAdmin, (req, res) => {
  try {
    const assinatura = db.prepare(`
      SELECT
        a.*,
        t.nome_loja,
        t.email,
        t.status as tenant_status
      FROM assinaturas a
      JOIN tenants t ON t.id = a.tenant_id
      WHERE a.id = ?
    `).get(req.params.id);

    if (***REMOVED***assinatura) {
      return res.status(404).json({ erro: 'Assinatura não encontrada' });
    }

    const cobracas = db.prepare(`
      SELECT * FROM cobracas
      WHERE assinatura_id = ?
      ORDER BY data_cobranca DESC
    `).all(assinatura.id);

    res.json({
      assinatura,
      status_atual: obterStatusAssinatura(assinatura.tenant_id),
      cobracas,
    });
  } catch (err) {
    console.error('[ASSINATURA] Erro ao buscar assinatura:', err);
    return res.status(500).json({ erro: 'Erro ao buscar assinatura' });
  }
});

// --- PATCH /admin/assinaturas/:id → mudar plano ou status ---
router.patch('/admin/assinaturas/:id', apenasAdmin, (req, res) => {
  try {
    const assinatura = db.prepare('SELECT * FROM assinaturas WHERE id = ?').get(req.params.id);
    if (***REMOVED***assinatura) {
      return res.status(404).json({ erro: 'Assinatura não encontrada' });
    }

    const { plano, valor_mensal } = req.body;

    if (***REMOVED***plano || ***REMOVED***valor_mensal) {
      return res.status(400).json({ erro: 'Plano e valor_mensal são obrigatórios' });
    }

    const result = db.prepare(`
      UPDATE assinaturas
      SET plano = ?, valor_mensal = ?
      WHERE id = ?
    `).run(plano, valor_mensal, req.params.id);

    if (result.changes === 0) {
      return res.status(400).json({ erro: 'Falha ao atualizar assinatura' });
    }

    const atualizada = db.prepare('SELECT * FROM assinaturas WHERE id = ?').get(req.params.id);

    console.log(`[ASSINATURA] Plano atualizado: ${plano} (R$ ${valor_mensal}/mês)`);
    res.json({
      sucesso: true,
      assinatura: atualizada,
    });
  } catch (err) {
    console.error('[ASSINATURA] Erro ao atualizar assinatura:', err);
    return res.status(500).json({ erro: 'Erro ao atualizar assinatura' });
  }
});

// --- DELETE /admin/assinaturas/:id → cancelar assinatura ---
router.delete('/admin/assinaturas/:id', apenasAdmin, (req, res) => {
  try {
    const assinatura = db.prepare('SELECT * FROM assinaturas WHERE id = ?').get(req.params.id);
    if (***REMOVED***assinatura) {
      return res.status(404).json({ erro: 'Assinatura não encontrada' });
    }

    const motivo = req.body?.motivo || 'Cancelamento administrativo';
    cancelarAssinatura(assinatura.tenant_id, motivo);

    console.log(`[ASSINATURA] Cancelada (tenant ${assinatura.tenant_id}, motivo: ${motivo})`);
    res.json({
      sucesso: true,
      mensagem: 'Assinatura cancelada',
      motivo,
    });
  } catch (err) {
    console.error('[ASSINATURA] Erro ao cancelar assinatura:', err);
    return res.status(500).json({ erro: 'Erro ao cancelar assinatura' });
  }
});

module.exports = router;
