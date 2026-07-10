// ============================================================
// API de DASHBOARD (painel principal)
// ============================================================
const express = require('express');
const router = express.Router();
const { db, getConfig } = require('../db/database');
const { hojeLocal } = require('../lib/datas');
const { resumoDoMes } = require('../lib/dre');

router.get('/', (req, res) => {
  const hoje = hojeLocal();
  const mesPrefixo = hoje.slice(0, 7);

  // "Esse mês entrou X · saiu Y · sobrou Z" — a primeira coisa que o lojista ve,
  // nos DOIS planos, sem clicar. Usa o MESMO calculo do /dre (lib/dre.js), senao
  // o painel e o relatorio divergem. Relatorio que exige clique nao e' usado.
  const resumo = resumoDoMes(req.tenantId, mesPrefixo);

  // Faturamento de hoje
  const caixaHoje = db.prepare('SELECT total_bruto, num_vendas FROM caixa_dia WHERE data = ? AND tenant_id = ?').get(hoje, req.tenantId)
                    || { total_bruto: 0, num_vendas: 0 };

  // Faturamento do mes
  const mes = db.prepare(`
    SELECT COALESCE(SUM(total_bruto),0) AS bruto, COALESCE(SUM(num_vendas),0) AS vendas
    FROM caixa_dia WHERE data LIKE ? AND tenant_id = ?
  `).get(mesPrefixo + '%', req.tenantId);

  // Metas: informa-se só a MENSAL; a DIÁRIA é calculada automaticamente
  // dividindo pela quantidade de dias de funcionamento (seg-sáb) do mês atual.
  // getConfig tem tenantId=1 como default: sem o 3o argumento, toda loja lia a meta da loja 1.
  const metaMensal = parseFloat(getConfig('meta_mensal', '0', req.tenantId)) || 0;
  const diasUteisMes = contarDiasSegASab(mesPrefixo); // dias seg-sáb no mês
  const metaDiaria = (metaMensal > 0 && diasUteisMes > 0) ? +(metaMensal / diasUteisMes).toFixed(2) : 0;
  const meta = {
    mensal: metaMensal,
    mensal_pct: metaMensal > 0 ? +((mes.bruto / metaMensal) * 100).toFixed(1) : 0,
    diaria: metaDiaria,
    diaria_pct: metaDiaria > 0 ? +((caixaHoje.total_bruto / metaDiaria) * 100).toFixed(1) : 0,
    dias_uteis_mes: diasUteisMes,
  };

  // Aniversariantes do dia (aniversario salvo como DD/MM)
  const d = new Date();
  const ddmm = String(d.getDate()).padStart(2, '0') + '/' + String(d.getMonth() + 1).padStart(2, '0');
  const aniversariantes = db.prepare('SELECT nome, telefone, cidade FROM clientes WHERE aniversario = ? AND tenant_id = ?').all(ddmm, req.tenantId);

  // Top produtos do mes
  const topProdutos = db.prepare(`
    SELECT vi.produto_id, p.nome, SUM(vi.qtd) AS qtd
    FROM venda_itens vi JOIN vendas v ON v.id = vi.venda_id AND v.tenant_id = vi.tenant_id
    LEFT JOIN produtos p ON p.id = vi.produto_id
    WHERE date(v.data_hora) LIKE ? AND v.tenant_id = ?
    GROUP BY vi.produto_id ORDER BY qtd DESC LIMIT 5
  `).all(mesPrefixo + '%', req.tenantId);

  // Estoque baixo / ruptura (mesmo criterio da tela Estoque)
  const minAlerta = parseInt(getConfig('estoque_minimo_alerta', '1', req.tenantId), 10);
  // Sem o filtro de tenant, o painel de uma loja listava produtos (codigo e nome)
  // das OUTRAS lojas.
  const estoqueBaixo = db.prepare(`
    SELECT p.codigo, p.nome, v.tamanho, v.quantidade
    FROM produtos p JOIN variacoes v ON v.produto_id = p.id
    WHERE p.ativo = 1 AND v.quantidade <= ? AND p.tenant_id = ?
    ORDER BY v.quantidade ASC, p.nome LIMIT 12
  `).all(minAlerta, req.tenantId);
  const estoqueBaixoTotal = db.prepare(`
    SELECT COUNT(*) AS n FROM produtos p JOIN variacoes v ON v.produto_id = p.id
    WHERE p.ativo = 1 AND v.quantidade <= ? AND p.tenant_id = ?
  `).get(minAlerta, req.tenantId).n;

  // ----- Marketing (A3) -----
  // Vendas por canal no mês (origem da venda)
  const vendasPorCanal = db.prepare(`
    SELECT COALESCE(origem,'loja') AS canal, COUNT(*) AS n, COALESCE(SUM(total),0) AS valor
    FROM vendas WHERE date(data_hora) LIKE ? AND tenant_id = ?
    GROUP BY canal ORDER BY valor DESC
  `).all(mesPrefixo + '%', req.tenantId);

  // Aquisição: de onde vieram os clientes (origem do cadastro) — base toda
  const clientesPorOrigem = db.prepare(`
    SELECT COALESCE(origem,'(não informado)') AS origem, COUNT(*) AS n
    FROM clientes WHERE tenant_id = ? GROUP BY origem ORDER BY n DESC
  `).all(req.tenantId);

  // Leads da vitrine (origem 'Vitrine/Site')
  const leadsVitrine = db.prepare("SELECT COUNT(*) AS n FROM clientes WHERE origem = 'Vitrine/Site' AND tenant_id = ?").get(req.tenantId).n;
  const leadsConvertidos = db.prepare("SELECT COUNT(*) AS n FROM clientes WHERE origem = 'Vitrine/Site' AND num_compras > 0 AND tenant_id = ?").get(req.tenantId).n;

  // Base total + novos clientes no mês
  const baseTotal = db.prepare('SELECT COUNT(*) AS n FROM clientes WHERE tenant_id = ?').get(req.tenantId).n;
  const novosNoMes = db.prepare("SELECT COUNT(*) AS n FROM clientes WHERE substr(criado_em,1,7) = ? AND tenant_id = ?").get(mesPrefixo, req.tenantId).n;

  const marketing = { vendasPorCanal, clientesPorOrigem, leadsVitrine, leadsConvertidos, baseTotal, novosNoMes };

  res.json({ resumo, hoje: caixaHoje, mes, meta, aniversariantes, topProdutos, ddmm,
             estoqueBaixo, estoqueBaixoTotal, marketing });
});

// Conta os dias de funcionamento (segunda a sábado) de um mês 'YYYY-MM'.
// Domingo (getDay()===0) não conta — a DS funciona seg-sáb.
function contarDiasSegASab(mesPrefixo) {
  const [ano, mes] = mesPrefixo.split('-').map(Number);
  const diasNoMes = new Date(ano, mes, 0).getDate(); // último dia do mês
  let n = 0;
  for (let dia = 1; dia <= diasNoMes; dia++) {
    const dow = new Date(ano, mes - 1, dia).getDay(); // 0=dom ... 6=sáb
    if (dow !== 0) n++;
  }
  return n;
}

module.exports = router;
