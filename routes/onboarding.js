// ============================================================
// Onboarding: Sistema de boas-vindas e dados demo
// POST /api/onboarding/demo-data → carrega dados de exemplo
// ============================================================
const express = require('express');
const { exigirLogin, injetarTenant } = require('../middleware/seguranca');
const { db } = require('../db/database');
const router = express.Router();

// --- POST /demo-data → carrega 5 produtos + 2 clientes + vendas fake ---
router.post('/demo-data', exigirLogin, injetarTenant, (req, res) => {
  try {
    const tenantId = req.tenantId;
    if (!tenantId) {
      return res.status(401).json({ erro: 'Tenant não identificado' });
    }

    // Verificar se já tem dados (não recarregar se já houver produtos)
    const jaTemProdutos = db.prepare(
      'SELECT COUNT(*) as cnt FROM produtos WHERE tenant_id = ?'
    ).get(tenantId);

    if (jaTemProdutos.cnt > 0) {
      return res.status(400).json({ erro: 'Você já tem produtos cadastrados. Demo não foi carregada.' });
    }

    // ===== PRODUTOS DEMO =====
    const produtosDemo = [
      {
        codigo: 'DEMO-001',
        nome: 'Vestido Floral Verão',
        categoria: 'vestido',
        descricao: 'Vestido leve em algodão 100% — perfeito para dias quentes',
        cor: 'Azul Floral',
        custo: 35.00,
        preco_venda: 89.90,
      },
      {
        codigo: 'DEMO-002',
        nome: 'Blusa Branca Premium',
        categoria: 'blusa',
        descricao: 'Blusa básica branca em malha premium — versátil',
        cor: 'Branco',
        custo: 15.00,
        preco_venda: 49.90,
      },
      {
        codigo: 'DEMO-003',
        nome: 'Calça Jeans Skinny',
        categoria: 'calca',
        descricao: 'Calça jeans escuro, modelo skinny — clássico',
        cor: 'Azul Escuro',
        custo: 45.00,
        preco_venda: 119.90,
      },
      {
        codigo: 'DEMO-004',
        nome: 'Short Jeans Premium',
        categoria: 'short',
        descricao: 'Short jeans solto — ideal para o verão',
        cor: 'Azul Claro',
        custo: 28.00,
        preco_venda: 79.90,
      },
      {
        codigo: 'DEMO-005',
        nome: 'Saia Plissada Elegante',
        categoria: 'saia',
        descricao: 'Saia social em tons neutros — versátil',
        cor: 'Bege',
        custo: 40.00,
        preco_venda: 129.90,
      },
    ];

    const produtosInseridos = [];
    produtosDemo.forEach(p => {
      const result = db.prepare(`
        INSERT INTO produtos
        (tenant_id, codigo, nome, categoria, descricao, cor, custo, preco_venda, ativo, criado_em)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, datetime('now', 'localtime'))
      `).run(tenantId, p.codigo, p.nome, p.categoria, p.descricao, p.cor, p.custo, p.preco_venda);

      produtosInseridos.push(result.lastInsertRowid);
    });

    // ===== CLIENTES DEMO =====
    const clientesDemo = [
      {
        nome: '👩 Maria Silva (Demo)',
        telefone: '73999999999',
        cidade: 'Itabuna',
        origem: 'instagram',
      },
      {
        nome: '👩 Juliana Costa (Demo)',
        telefone: '73988888888',
        cidade: 'Itabuna',
        origem: 'indicacao',
      },
    ];

    const clientesInseridos = [];
    clientesDemo.forEach(c => {
      const result = db.prepare(`
        INSERT INTO clientes
        (tenant_id, nome, telefone, cidade, origem, criado_em)
        VALUES (?, ?, ?, ?, ?, datetime('now', 'localtime'))
      `).run(tenantId, c.nome, c.telefone, c.cidade, c.origem);

      clientesInseridos.push(result.lastInsertRowid);
    });

    // ===== VENDA DEMO (para o dashboard mostrar algo) =====
    if (produtosInseridos.length > 0 && clientesInseridos.length > 0) {
      const vendaResult = db.prepare(`
        INSERT INTO vendas
        (tenant_id, cliente_id, vendedor_id, subtotal, desconto, acrescimo, total, forma_pagamento, origem, parcelas, valor_liquido, lucro, criado_em)
        VALUES (?, ?, NULL, ?, 0, 0, ?, 'pix', 'loja', 1, ?, ?, datetime('now', 'localtime'))
      `).run(
        tenantId,
        clientesInseridos[0],
        89.90 + 49.90, // subtotal: 2 produtos
        89.90 + 49.90,
        89.90 + 49.90,
        (89.90 + 49.90) - (35 + 15) // lucro
      );

      const vendaId = vendaResult.lastInsertRowid;

      // Adicionar itens da venda
      db.prepare(`
        INSERT INTO venda_itens (venda_id, produto_id, descricao, qtd, preco_unit, custo_unit)
        VALUES (?, ?, ?, 1, ?, ?)
      `).run(vendaId, produtosInseridos[0], 'Vestido Floral', 89.90, 35.00);

      db.prepare(`
        INSERT INTO venda_itens (venda_id, produto_id, descricao, qtd, preco_unit, custo_unit)
        VALUES (?, ?, ?, 1, ?, ?)
      `).run(vendaId, produtosInseridos[1], 'Blusa Branca', 49.90, 15.00);

      // Registrar pagamento
      db.prepare(`
        INSERT INTO venda_pagamentos (venda_id, forma, parcelas, valor, taxa_pct, valor_taxa, valor_liquido)
        VALUES (?, 'pix', 1, ?, 0, 0, ?)
      `).run(vendaId, 89.90 + 49.90, 89.90 + 49.90);
    }

    console.log(`✅ [ONBOARDING] Dados de demo carregados para tenant ${tenantId}`);

    res.json({
      sucesso: true,
      mensagem: 'Dados de exemplo carregados com sucesso!',
      produtos: produtosInseridos.length,
      clientes: clientesInseridos.length,
    });
  } catch (err) {
    console.error('[ONBOARDING] Erro ao carregar demo data:', err);
    return res.status(500).json({ erro: 'Erro ao carregar dados de exemplo' });
  }
});

// --- GET /estado → retorna o estado do onboarding (etapa atual, progresso) ---
router.get('/estado', exigirLogin, injetarTenant, (req, res) => {
  try {
    const tenantId = req.tenantId;
    if (!tenantId) {
      return res.status(401).json({ erro: 'Tenant não identificado' });
    }

    const tenant = db.prepare('SELECT onboarding_estado FROM tenants WHERE id = ?').get(tenantId);
    if (!tenant) {
      return res.status(404).json({ erro: 'Tenant não encontrado' });
    }

    const estado = tenant.onboarding_estado ? JSON.parse(tenant.onboarding_estado) : {
      etapa: 'identidade',
      concluido: false,
      pulado: false,
      banner_dispensado: false
    };

    res.json(estado);
  } catch (err) {
    console.error('[ONBOARDING] Erro ao ler estado:', err);
    return res.status(500).json({ erro: 'Erro ao ler estado do onboarding' });
  }
});

// --- PATCH /estado → atualiza o estado do onboarding (merge com estado atual) ---
router.patch('/estado', exigirLogin, injetarTenant, (req, res) => {
  try {
    const tenantId = req.tenantId;
    if (!tenantId) {
      return res.status(401).json({ erro: 'Tenant não identificado' });
    }

    const updates = req.body || {};
    const tenant = db.prepare('SELECT onboarding_estado FROM tenants WHERE id = ?').get(tenantId);
    if (!tenant) {
      return res.status(404).json({ erro: 'Tenant não encontrado' });
    }

    // Parse estado atual e fazer merge com updates
    const estadoAtual = tenant.onboarding_estado ? JSON.parse(tenant.onboarding_estado) : {
      etapa: 'identidade',
      concluido: false,
      pulado: false,
      banner_dispensado: false
    };

    const estadoNovo = { ...estadoAtual, ...updates };

    // Atualizar no banco
    db.prepare('UPDATE tenants SET onboarding_estado = ? WHERE id = ?')
      .run(JSON.stringify(estadoNovo), tenantId);

    console.log(`✅ [ONBOARDING] Estado atualizado para tenant ${tenantId}:`, estadoNovo);

    res.json(estadoNovo);
  } catch (err) {
    console.error('[ONBOARDING] Erro ao atualizar estado:', err);
    return res.status(500).json({ erro: 'Erro ao atualizar estado do onboarding' });
  }
});

// --- GET /progresso → calcula o progresso do checklist gamificado (4 itens, 25% cada) ---
router.get('/progresso', exigirLogin, injetarTenant, (req, res) => {
  try {
    const tenantId = req.tenantId;
    if (!tenantId) {
      return res.status(401).json({ erro: 'Tenant não identificado' });
    }

    // Verificar cada item do checklist
    const config = db.prepare('SELECT * FROM config WHERE tenant_id = ?').all(tenantId);
    const configMap = {};
    config.forEach(row => {
      configMap[row.chave] = row.valor;
    });

    const items = [];
    let percentual = 0;

    // 1. Identidade: loja_nome E marca_cor preenchidos
    const identidadeCompleta = !!(configMap.loja_nome && configMap.marca_cor);
    items.push({
      chave: 'identidade',
      label: 'Identidade',
      concluido: identidadeCompleta
    });
    if (identidadeCompleta) percentual += 25;

    // 2. Financeiro: markup, regime_fiscal, taxas presentes (ou com valores não-default)
    // Critério: se a chave existe no config, considera concluído (usuário confirmou/ajustou)
    const financeiroCompleto = !!(
      configMap.markup &&
      configMap.regime_fiscal &&
      (configMap.taxa_pix || configMap.taxa_debito || configMap.taxa_credito_vista)
    );
    items.push({
      chave: 'financeiro',
      label: 'Financeiro',
      concluido: financeiroCompleto
    });
    if (financeiroCompleto) percentual += 25;

    // 3. Dados da loja: endereço OU redes sociais preenchidas
    const dadosCompletos = !!(
      configMap.loja_endereco ||
      configMap.loja_telefone ||
      configMap.loja_instagram ||
      configMap.loja_whatsapp
    );
    items.push({
      chave: 'dados_loja',
      label: 'Dados da Loja',
      concluido: dadosCompletos
    });
    if (dadosCompletos) percentual += 25;

    // 4. Produtos: pelo menos 1 produto ativo cadastrado
    const produtoCount = db.prepare(
      'SELECT COUNT(*) as cnt FROM produtos WHERE tenant_id = ? AND ativo = 1'
    ).get(tenantId);
    const produtosCompleto = produtoCount.cnt > 0;
    items.push({
      chave: 'produtos',
      label: 'Produtos',
      concluido: produtosCompleto
    });
    if (produtosCompleto) percentual += 25;

    res.json({
      percentual,
      itens: items
    });
  } catch (err) {
    console.error('[ONBOARDING] Erro ao calcular progresso:', err);
    return res.status(500).json({ erro: 'Erro ao calcular progresso' });
  }
});

// --- POST /dispensar → marca o banner de retomada como dispensado ---
router.post('/dispensar', exigirLogin, injetarTenant, (req, res) => {
  try {
    const tenantId = req.tenantId;
    if (!tenantId) {
      return res.status(401).json({ erro: 'Tenant não identificado' });
    }

    const tenant = db.prepare('SELECT onboarding_estado FROM tenants WHERE id = ?').get(tenantId);
    if (!tenant) {
      return res.status(404).json({ erro: 'Tenant não encontrado' });
    }

    const estadoAtual = tenant.onboarding_estado ? JSON.parse(tenant.onboarding_estado) : {
      etapa: 'identidade',
      concluido: false,
      pulado: false,
      banner_dispensado: false
    };

    const estadoNovo = { ...estadoAtual, banner_dispensado: true };

    db.prepare('UPDATE tenants SET onboarding_estado = ? WHERE id = ?')
      .run(JSON.stringify(estadoNovo), tenantId);

    console.log(`✅ [ONBOARDING] Banner de retomada dispensado para tenant ${tenantId}`);

    res.json(estadoNovo);
  } catch (err) {
    console.error('[ONBOARDING] Erro ao dispensar banner:', err);
    return res.status(500).json({ erro: 'Erro ao dispensar banner' });
  }
});

module.exports = router;
