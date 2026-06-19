// ============================================================
// API de DASHBOARD (painel principal)
// ============================================================
const express = require('express');
const router = express.Router();
const { db, getConfig } = require('../db/database');
const { hojeLocal } = require('../lib/datas');

router.get('/', (req, res) => {
  const hoje = hojeLocal();
  const mesPrefixo = hoje.slice(0, 7);

  // Faturamento de hoje (sem lucro - lucro nao vai no painel principal)
  const caixaHoje = db.prepare('SELECT total_bruto, num_vendas FROM caixa_dia WHERE data = ?').get(hoje)
                    || { total_bruto: 0, num_vendas: 0 };

  // Faturamento do mes
  const mes = db.prepare(`
    SELECT COALESCE(SUM(total_bruto),0) AS bruto, COALESCE(SUM(num_vendas),0) AS vendas
    FROM caixa_dia WHERE data LIKE ?
  `).get(mesPrefixo + '%');

  // Metas: informa-se só a MENSAL; a DIÁRIA é calculada automaticamente
  // dividindo pela quantidade de dias de funcionamento (seg-sáb) do mês atual.
  const metaMensal = parseFloat(getConfig('meta_mensal', '0')) || 0;
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
  const aniversariantes = db.prepare('SELECT nome, telefone, cidade FROM clientes WHERE aniversario = ?').all(ddmm);

  // Top produtos do mes
  const topProdutos = db.prepare(`
    SELECT vi.produto_id, p.nome, SUM(vi.qtd) AS qtd
    FROM venda_itens vi JOIN vendas v ON v.id = vi.venda_id
    LEFT JOIN produtos p ON p.id = vi.produto_id
    WHERE date(v.data_hora) LIKE ?
    GROUP BY vi.produto_id ORDER BY qtd DESC LIMIT 5
  `).all(mesPrefixo + '%');

  // Estoque baixo / ruptura (mesmo criterio da tela Estoque)
  const minAlerta = parseInt(getConfig('estoque_minimo_alerta', '1'), 10);
  const estoqueBaixo = db.prepare(`
    SELECT p.codigo, p.nome, v.tamanho, v.quantidade
    FROM produtos p JOIN variacoes v ON v.produto_id = p.id
    WHERE p.ativo = 1 AND v.quantidade <= ?
    ORDER BY v.quantidade ASC, p.nome LIMIT 12
  `).all(minAlerta);
  const estoqueBaixoTotal = db.prepare(`
    SELECT COUNT(*) AS n FROM produtos p JOIN variacoes v ON v.produto_id = p.id
    WHERE p.ativo = 1 AND v.quantidade <= ?
  `).get(minAlerta).n;

  // ----- Marketing (A3) -----
  // Vendas por canal no mês (origem da venda)
  const vendasPorCanal = db.prepare(`
    SELECT COALESCE(origem,'loja') AS canal, COUNT(*) AS n, COALESCE(SUM(total),0) AS valor
    FROM vendas WHERE date(data_hora) LIKE ?
    GROUP BY canal ORDER BY valor DESC
  `).all(mesPrefixo + '%');

  // Aquisição: de onde vieram os clientes (origem do cadastro) — base toda
  const clientesPorOrigem = db.prepare(`
    SELECT COALESCE(origem,'(não informado)') AS origem, COUNT(*) AS n
    FROM clientes GROUP BY origem ORDER BY n DESC
  `).all();

  // Leads da vitrine (origem 'Vitrine/Site')
  const leadsVitrine = db.prepare("SELECT COUNT(*) AS n FROM clientes WHERE origem = 'Vitrine/Site'").get().n;
  const leadsConvertidos = db.prepare("SELECT COUNT(*) AS n FROM clientes WHERE origem = 'Vitrine/Site' AND num_compras > 0").get().n;

  // Base total + novos clientes no mês
  const baseTotal = db.prepare('SELECT COUNT(*) AS n FROM clientes').get().n;
  const novosNoMes = db.prepare("SELECT COUNT(*) AS n FROM clientes WHERE substr(criado_em,1,7) = ?").get(mesPrefixo).n;

  const marketing = { vendasPorCanal, clientesPorOrigem, leadsVitrine, leadsConvertidos, baseTotal, novosNoMes };

  res.json({ hoje: caixaHoje, mes, meta, aniversariantes, topProdutos, ddmm,
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
    if (dow ***REMOVED***== 0) n++;
  }
  return n;
}

module.exports = router;
