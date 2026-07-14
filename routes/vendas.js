// ============================================================
// API de VENDAS (PDV) - registra venda, baixa estoque, atualiza caixa e cliente
// ============================================================
const express = require('express');
const router = express.Router();
const { db, getConfig } = require('../db/database');
const { exigirTenant } = require('../lib/tenant');
const { resultadoVenda, acrescimoParcelamento, taxaPorForma } = require('../lib/calculos');
const { hojeLocal } = require('../lib/datas');
const { gerarParcelas } = require('../lib/crediario');
const { salvarComprovanteBase64 } = require('../lib/comprovantes');
const { validarDesconto, validarQuantidade, validarParcelas, validarAcrescimo } = require('../lib/validadores');
const { obterImposto } = require('./config');
const { cacheRelatorioPorTenant } = require('../middleware/rate-limit-custoso');
const { schemaVenda } = require('../lib/schemas');
const { z } = require('zod');
const { exigirFeature } = require('../middleware/seguranca');
const { rotuloSku } = require('../lib/sku');
const { emitirPremioClube, registrarGastoSemSelo } = require('../lib/clube');
const { validarCupom, descontoDe, baixarCupom, devolverCupomDaVenda } = require('../lib/cupons');
const { temFeature, planoDoTenant } = require('../lib/planos');

// O vendedor só pode CRIAR venda (POST /). Toda leitura/edição (histórico com
// lucro/custo, detalhe, cancelamento) é exclusiva do admin. Bloqueia aqui dentro
// porque o mount libera 'vendedor' (pro POST funcionar).
router.use((req, res, next) => {
  if (req.session && req.session.papel === 'vendedor') {
    const ehCriarVenda = req.method === 'POST' && (req.path === '/' || req.path === '');
    if (!ehCriarVenda) return res.status(403).json({ erro: 'Sem permissão para esta área' });
  }
  next();
});

// POST /api/vendas  -> registra uma venda completa (COM VALIDAÇÃO)
// body: {
//   itens: [{ variacao_id, qtd }],
//   forma_pagamento, parcelas, desconto, cliente_id, observacao
// }
router.post('/', (req, res) => {
  try {
    // Itens: o cliente manda so variacao_id + qtd. O preco vem do banco
    // (preco_unit = v.preco_venda, mais abaixo), nunca do payload.
    if (Array.isArray(req.body.itens)) {
      for (const item of req.body.itens) {
        if (typeof item.qtd !== 'number' || item.qtd <= 0) {
          throw new Error(`Item com qtd inválida: ${item.qtd}`);
        }
      }
    }

    // Taxa: deve ser número entre 0-10
    if (req.body.taxa_percentual !== undefined) {
      const taxa = parseFloat(req.body.taxa_percentual);
      if (isNaN(taxa) || taxa < 0 || taxa > 10) {
        throw new Error(`Taxa inválida: ${req.body.taxa_percentual} (deve estar entre 0-10%)`);
      }
    }

    // Desconto: deve ser número não-negativo
    if (req.body.desconto !== undefined) {
      const desconto = parseFloat(req.body.desconto);
      if (isNaN(desconto) || desconto < 0) {
        throw new Error(`Desconto inválido: ${req.body.desconto} (não pode ser negativo)`);
      }
    }

    // Parcelas: deve ser número inteiro 1-12
    if (req.body.parcelas !== undefined) {
      const parcelas = parseInt(req.body.parcelas, 10);
      if (isNaN(parcelas) || parcelas < 1 || parcelas > 12) {
        throw new Error(`Parcelas inválidas: ${req.body.parcelas} (deve estar entre 1-12)`);
      }
    }

  } catch (validErr) {
    return res.status(400).json({
      erro: 'Dados da venda inválidos',
      mensagem: validErr.message
    });
  }

  // Prosseguir com a lógica original
  const { itens, forma_pagamento, parcelas = 1, desconto = 0, cliente_id = null, vendedor_id = null, observacao = null, origem = 'loja', pagamentos = null, comprovante = null, troco = 0, troco_forma = null, repassar_taxa = true, estado = 'default', categoria = 'default', vale_codigo = null, cupom_codigo = null, crediario = null } = req.body;
  if (!Array.isArray(itens) || itens.length === 0) return res.status(400).json({ erro: 'Venda sem itens' });
  // pagamento: aceita split (array `pagamentos`) ou forma unica (compatibilidade).
  const temSplit = Array.isArray(pagamentos) && pagamentos.length > 0;
  if (!temSplit && !forma_pagamento) return res.status(400).json({ erro: 'Forma de pagamento obrigatoria' });

  // A19: exige caixa do dia aberto pra registrar venda
  const cxHoje = db.prepare('SELECT aberto, fechado FROM caixa_dia WHERE data = ? AND tenant_id = ?').get(hojeLocal(), req.tenantId);
  if (!cxHoje || !cxHoje.aberto) {
    return res.status(400).json({ erro: 'Abra o caixa do dia antes de vender.' });
  }

  // comissao do vendedor (se houver)
  let comissaoPct = 0;
  if (vendedor_id) {
    const vend = db.prepare('SELECT comissao_pct FROM vendedores WHERE id = ? AND tenant_id = ?').get(vendedor_id, req.tenantId);
    if (vend) comissaoPct = vend.comissao_pct;
  }
  // 3o arg obrigatorio: getConfig cai no tenant 1 por default, e o custo de
  // embalagem entra no lucro da venda (e no "sobrou" do painel).
  const embalagemUnit = parseFloat(getConfig('embalagem_unit', '1', req.tenantId)) || 0;

  // Busca dados de cada item (preco, custo, estoque) e valida disponibilidade
  const getVar = db.prepare(`
    SELECT v.id AS variacao_id, v.quantidade, v.cor, v.tamanho, v.produto_id,
           p.nome, p.preco_venda, p.custo
    FROM variacoes v JOIN produtos p ON p.id = v.produto_id
    WHERE v.id = ? AND p.tenant_id = ?
  `);

  const linhas = [];
  for (const it of itens) {
    const v = getVar.get(it.variacao_id, req.tenantId);
    if (!v) return res.status(400).json({ erro: `Item invalido (id ${it.variacao_id})` });

    // Validar quantidade de cada item
    const valQtd = validarQuantidade(it.qtd, `Quantidade de ${v.nome}`);
    if (!valQtd.valido) return res.status(400).json({ erro: valQtd.erro });
    const qtd = valQtd.valor;

    if (v.quantidade < qtd) {
      // rotuloSku: "Vestido Amanda (Preto / M)" — sem a cor, o lojista nao sabe QUAL
      // peca faltou quando o modelo existe em 4 cores.
      return res.status(400).json({ erro: `Estoque insuficiente: ${rotuloSku(v.nome, v.cor, v.tamanho)} (tem ${v.quantidade}, pediu ${qtd})` });
    }
    linhas.push({ ...v, qtd, preco_unit: v.preco_venda, custo_unit: v.custo });
  }

  const qtdItens = linhas.reduce((s, l) => s + l.qtd, 0);
  const subtotal = linhas.reduce((s, l) => s + l.preco_unit * l.qtd, 0);

  // Validar desconto
  const valDesc = validarDesconto(desconto, subtotal);
  if (!valDesc.valido) return res.status(400).json({ erro: valDesc.erro });
  const descManual = parseFloat(desconto) || 0;

  // ----- CUPOM DA REGUA -----
  // O cupom e' NOMINAL (VOLTE20-K3P9, so daquela cliente, uso unico). Ele nao e' um
  // cano novo: vira parte do `desc` que ja existe — e portanto ja e' distribuido
  // proporcionalmente entre os itens (passo 2), ja entra no lucro, no imposto e no
  // DRE. Um campo separado teria que replicar tudo isso.
  //
  // CUPOM NAO E' VALE: cupom desconta (reduz o total ANTES do pagamento); vale e'
  // forma de pagamento (nao mexe no total). Podem coexistir na mesma venda.
  //
  // Valida AQUI FORA (pra devolver erro claro pra atendente) e baixa DENTRO da
  // transacao (passo 2d) — a licao que a baixa do vale ja ensinou neste arquivo.
  let cupomParaBaixar = null, descCupom = 0;
  if (cupom_codigo) {
    const v = validarCupom(req.tenantId, cupom_codigo, cliente_id, subtotal, hojeLocal());
    if (!v.ok) return res.status(v.http || 422).json({ erro: v.erro });
    cupomParaBaixar = v.cupom;
    descCupom = descontoDe(v.cupom, subtotal);
  }

  // Desconto manual + cupom podem somar (a lojista da' "mais uns R$10" e nao vai
  // entender uma recusa). Mas o clamp em `subtotal` e' obrigatorio: 90% na mao + 25%
  // de cupom daria total NEGATIVO.
  const desc = +Math.min(descManual + descCupom, subtotal).toFixed(2);

  // Validar parcelas
  const valParc = validarParcelas(parcelas);
  if (!valParc.valido) return res.status(400).json({ erro: valParc.erro });
  const parcelasValidas = valParc.valor;
  // acrescimo: parcelamento 4x+ repassa a taxa ao cliente (so na forma unica).
  // OPCIONAL: se repassar_taxa=false, a loja absorve (sem acrescimo; a taxa entra no lucro).
  const baseAposDesc = +(subtotal - desc).toFixed(2);
  // O tenant NAO e' opcional aqui: sem ele, acrescimoParcelamento lia
  // `parcelas_loja_absorve` e a taxa de credito DA LOJA 1 — e o acrescimo que a
  // CLIENTE PAGA saia calculado com a politica de repasse de outra loja.
  const acrescimo = (temSplit || repassar_taxa === false) ? 0 : acrescimoParcelamento(baseAposDesc, parcelasValidas, req.tenantId);

  // Validar acréscimo
  const valAcr = validarAcrescimo(acrescimo);
  if (!valAcr.valido) return res.status(400).json({ erro: valAcr.erro });
  const total = +(baseAposDesc + acrescimo).toFixed(2);
  const custoTotal = linhas.reduce((s, l) => s + l.custo_unit * l.qtd, 0);
  const embalagemTotal = +(embalagemUnit * qtdItens).toFixed(2);

  // Monta as partes de pagamento (normaliza forma unica como 1 parte).
  // Cada parte calcula a propria taxa SOBRE O VALOR DELA.
  let partes;
  if (temSplit) {
    partes = pagamentos.map(p => {
      const valor = +(parseFloat(p.valor) || 0).toFixed(2);
      const parc = parseInt(p.parcelas, 10) || 1;
      const taxaPct = taxaPorForma(p.forma, parc, req.tenantId);
      const valorTaxa = +(valor * taxaPct / 100).toFixed(2);
      return { forma: p.forma, parcelas: parc, valor, taxaPct, valorTaxa, liquido: +(valor - valorTaxa).toFixed(2) };
    });
    // validacoes do split: formas validas e soma == total
    const formasValidas = ['pix', 'pix_chave', 'dinheiro', 'debito', 'credito_vista', 'credito_parcelado', 'vale', 'crediario'];
    for (const p of partes) {
      if (!formasValidas.includes(p.forma)) return res.status(400).json({ erro: `Forma de pagamento invalida: ${p.forma}` });
      if (p.valor <= 0) return res.status(400).json({ erro: 'Cada pagamento precisa ter valor maior que zero' });
    }
    const somaPartes = +partes.reduce((s, p) => s + p.valor, 0).toFixed(2);
    if (Math.abs(somaPartes - total) > 0.01) {
      return res.status(400).json({ erro: `A soma dos pagamentos (${somaPartes.toFixed(2)}) nao bate com o total (${total.toFixed(2)})` });
    }
  } else {
    // Cada loja negocia a propria maquininha. Sem o tenant, TODA venda descontava a
    // taxa da LOJA 1 — o liquido e o lucro saiam errados em toda venda, sem erro
    // nenhum aparecer. Numa venda de R$1.000 no debito com taxa 1,37% (loja 1) vs
    // 0,85% (a real), sao R$5,20 de lucro fantasma. Toda venda.
    const taxaPct = taxaPorForma(forma_pagamento, parcelasValidas, req.tenantId);
    const valorTaxa = +(total * taxaPct / 100).toFixed(2);
    partes = [{ forma: forma_pagamento, parcelas: parcelasValidas, valor: total, taxaPct, valorTaxa, liquido: +(total - valorTaxa).toFixed(2) }];
  }

  // forma "principal" gravada na venda: a unica forma, ou 'misto' no split
  const formaPrincipal = partes.length === 1 ? partes[0].forma : 'misto';
  const parcelasPrincipal = partes.length === 1 ? partes[0].parcelas : 1;
  // taxa total = soma das taxas das partes; resultado financeiro usa o liquido real
  const valorTaxaTotal = +partes.reduce((s, p) => s + p.valorTaxa, 0).toFixed(2);
  const liquidoTotal = +(total - valorTaxaTotal).toFixed(2);

  // Imposto dinâmico por estado/categoria (fallback para config.imposto_simples se tabela vazia)
  // O obterImposto passava o tenant, mas o FALLBACK nao — e o fallback e' o caminho
  // NORMAL (a tabela de imposto por estado/categoria nasce vazia em toda loja nova).
  // Resultado: quase toda venda calculava imposto com a aliquota da loja 1.
  const impostoPct = obterImposto(req.tenantId, estado, categoria) || parseFloat(getConfig('imposto_simples', '7.30', req.tenantId)) || 0;
  const imposto = +(total * impostoPct / 100).toFixed(2);
  const comissao = +(total * comissaoPct / 100).toFixed(2);
  const lucro = +(liquidoTotal - imposto - comissao - custoTotal - embalagemTotal).toFixed(2);
  const taxaPctEfetiva = total > 0 ? +(valorTaxaTotal / total * 100).toFixed(2) : 0;
  const r = {
    taxaPct: taxaPctEfetiva, valorTaxa: valorTaxaTotal, impostoPct, imposto, comissaoPct, comissao,
    liquido: liquidoTotal, custoTotal: +custoTotal.toFixed(2), embalagemTotal: +embalagemTotal.toFixed(2),
    freteTotal: 0, lucro
  };

  const hoje = hojeLocal();

  // ----- VALE-CREDITO -----
  // A baixa do vale mora AQUI, dentro da transacao da venda. Antes ela era feita pelo
  // navegador (POST /vales/:codigo/usar) DEPOIS da venda gravada: se o valor calculado
  // no front fosse 0 — o que acontecia sempre que se pagava com vale, porque ele lia o
  // campo 'desconto' — a baixa nunca ocorria e o vale continuava reutilizavel.
  const valorEmVale = +partes.filter(p => p.forma === 'vale').reduce((s, p) => s + p.valor, 0).toFixed(2);
  // o codigo vem no topo (forma unica) ou dentro da linha do split (pagamentos[].vale_codigo)
  const codigoVale = vale_codigo || (Array.isArray(pagamentos)
    ? (pagamentos.find(p => p && p.forma === 'vale' && p.vale_codigo) || {}).vale_codigo
    : null);
  let valeParaDebitar = null;
  if (valorEmVale > 0) {
    // Pagar COM vale é feature do Growth (o Starter nem emite vale guardado — ver
    // routes/trocas.js). Gate só este ramo: a venda normal (pix/dinheiro/cartão) do
    // Starter passa intacta; só o pagamento em vale é recusado.
    if (!temFeature(planoDoTenant(req.tenantId), 'vale_credito')) {
      return res.status(403).json({
        erro: 'Pagamento com vale-crédito está disponível no plano Growth.',
        upgrade: true,
        feature: 'vale_credito',
      });
    }
    if (!codigoVale) return res.status(400).json({ erro: 'Pagamento em vale exige o codigo do vale' });
    const codigo = String(codigoVale).toUpperCase().trim();
    // `origem` distingue o vale de troca (dinheiro que ja era da cliente) do vale do
    // clube (premio que a loja deu). So o do clube tem compra minima e so ele bloqueia
    // selo novo — ver o anti-farming no passo 2b.
    const vale = db.prepare(`SELECT id, codigo, saldo, valor, validade, origem FROM vales
                             WHERE codigo = ? AND tenant_id = ? AND ativo = 1`).get(codigo, req.tenantId);
    if (!vale) return res.status(404).json({ erro: 'Vale nao encontrado, ja utilizado ou cancelado' });
    if (vale.validade && hoje > vale.validade) {
      return res.status(422).json({ erro: 'Vale expirado', validade: vale.validade });
    }
    if (vale.saldo < valorEmVale) {
      return res.status(422).json({ erro: 'Saldo insuficiente no vale', saldo_disponivel: vale.saldo, valor_solicitado: valorEmVale });
    }
    // O premio do clube vale a partir de uma compra minima: e' um incentivo pra voltar
    // e comprar, nao um desconto pra levar so o que o vale cobre.
    if (vale.origem === 'clube') {
      const minCompra = parseFloat(getConfig('clube_vale_min_compra', '0', req.tenantId)) || 0;
      if (minCompra > 0 && total < minCompra - 0.01) {
        return res.status(422).json({
          erro: `O vale do clube só vale em compras de R$ ${minCompra.toFixed(2)} ou mais. Esta compra é R$ ${total.toFixed(2)}.`,
          min_compra: minCompra,
        });
      }
    }
    valeParaDebitar = vale;
  } else if (codigoVale) {
    return res.status(400).json({ erro: 'Vale informado mas nenhum pagamento em vale' });
  }
  // um vale por venda: com 2+ linhas de vale no split so a 1a seria debitada
  if (partes.filter(p => p.forma === 'vale').length > 1) {
    return res.status(400).json({ erro: 'Use uma unica linha de vale por venda' });
  }

  // ----- CREDIARIO (o carne) -----
  // Valida AQUI fora e cria o carne DENTRO da transacao — mesma licao do vale: o que
  // depende do navegador pra acontecer depois, um dia nao acontece. Ou a venda e o
  // carne existem juntos, ou nenhum dos dois.
  const valorEmCrediario = +partes.filter(p => p.forma === 'crediario').reduce((s, p) => s + p.valor, 0).toFixed(2);
  let parcelasDoCarne = null;
  if (valorEmCrediario > 0) {
    if (partes.filter(p => p.forma === 'crediario').length > 1) {
      return res.status(400).json({ erro: 'Use uma unica linha de crediario por venda' });
    }
    // A regra de negocio mais importante do modulo: fiar exige saber PRA QUEM.
    // Trava no backend, nao so no front — o front pode ser contornado.
    if (!cliente_id) {
      return res.status(400).json({ erro: 'Crediario exige um cliente cadastrado. Selecione a cliente antes de fechar a venda.' });
    }
    const cli = db.prepare('SELECT id FROM clientes WHERE id = ? AND tenant_id = ?').get(cliente_id, req.tenantId);
    if (!cli) return res.status(404).json({ erro: 'Cliente nao encontrado' });

    const cfgCarne = crediario || {};
    const dataPrimeira = cfgCarne.data_primeira || cfgCarne.primeira_parcela;
    try {
      parcelasDoCarne = gerarParcelas(valorEmCrediario, cfgCarne.num_parcelas, dataPrimeira);
    } catch (e) {
      return res.status(400).json({ erro: e.message });
    }
  } else if (crediario && crediario.num_parcelas) {
    return res.status(400).json({ erro: 'Crediario informado mas nenhum pagamento em crediario' });
  }

  // salva o comprovante (se veio) ANTES da transacao — escrita em disco fora do BEGIN/COMMIT
  const comprovantePath = comprovante ? salvarComprovanteBase64(comprovante) : null;

  // preenchido dentro da tx; o front usa pra abrir o carne imprimivel
  let crediarioIdCriado = null;
  // preenchido dentro da tx se a compra fechou o cartao de selos; o PDV avisa o caixa
  // pra ele contar a novidade pra cliente na hora — o premio so vale se ela souber.
  let valeClubeCriado = null;

  const tx = db.transaction(() => {
    // 1. grava venda
    const trocoVal = +(parseFloat(troco) || 0).toFixed(2);
    const trocoForma = trocoVal > 0 ? (troco_forma === 'pix' ? 'pix' : 'dinheiro') : null;
    const info = db.prepare(`
      INSERT INTO vendas (tenant_id, cliente_id, vendedor_id, subtotal, desconto, acrescimo, total, forma_pagamento, origem, parcelas,
                          taxa_aplicada, valor_liquido, imposto, comissao_valor, embalagem_total, custo_total, lucro, observacao, comprovante, troco, troco_forma)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(req.tenantId, cliente_id || null, vendedor_id || null, subtotal, desc, acrescimo, total, formaPrincipal, origem || 'loja', parcelasPrincipal,
           r.taxaPct, r.liquido, r.imposto, r.comissao, r.embalagemTotal, r.custoTotal, r.lucro, observacao, comprovantePath, trocoVal, trocoForma);
    const vendaId = info.lastInsertRowid;

    // 1b. grava as formas de pagamento (1 linha por forma; forma unica tambem cai aqui)
    const insPgto = db.prepare(`INSERT INTO venda_pagamentos (venda_id, tenant_id, forma, parcelas, valor, taxa_pct, valor_taxa, valor_liquido)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)`);
    for (const p of partes) {
      insPgto.run(vendaId, req.tenantId, p.forma, p.parcelas, p.valor, p.taxaPct, p.valorTaxa, p.liquido);
    }

    // 2. itens + baixa de estoque + movimento
    // Distribuir desconto proporcionalmente: cada item recebe desconto proporcional ao seu valor
    const proporcaoDesconto = subtotal > 0 ? baseAposDesc / subtotal : 1;
    const insItem = db.prepare(`INSERT INTO venda_itens (venda_id, tenant_id, variacao_id, produto_id, descricao, qtd, preco_unit, custo_unit)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)`);
    const baixa = db.prepare('UPDATE variacoes SET quantidade = quantidade - ? WHERE id = ?');
    const mov = db.prepare("INSERT INTO movimentos_estoque (variacao_id, tipo, qtd, motivo) VALUES (?, 'saida', ?, ?)");
    for (const l of linhas) {
      const precoComDesconto = +(l.preco_unit * proporcaoDesconto).toFixed(2);
      // a descricao vai pro cupom e pro historico: precisa dizer QUAL peca saiu
      insItem.run(vendaId, req.tenantId, l.variacao_id, l.produto_id, rotuloSku(l.nome, l.cor, l.tamanho), l.qtd, precoComDesconto, l.custo_unit);
      baixa.run(l.qtd, l.variacao_id);
      mov.run(l.variacao_id, -l.qtd, `venda #${vendaId}`);
    }

    // 2b. debita o vale (mesma transacao da venda: ou os dois acontecem, ou nenhum).
    // O `AND saldo >= ?` faz a checagem no proprio UPDATE, fechando a janela de corrida
    // entre duas vendas simultaneas com o mesmo vale.
    if (valeParaDebitar) {
      const upd = db.prepare(`UPDATE vales
        SET saldo = saldo - ?, utilizado = utilizado + ?,
            ativo = CASE WHEN saldo - ? <= 0 THEN 0 ELSE 1 END,
            venda_utilizacao_id = ?, data_utilizacao = datetime('now','localtime')
        WHERE id = ? AND tenant_id = ? AND ativo = 1 AND saldo >= ?`)
        .run(valorEmVale, valorEmVale, valorEmVale, vendaId, valeParaDebitar.id, req.tenantId, valorEmVale);
      if (upd.changes !== 1) throw new Error('Vale indisponivel ou saldo insuficiente');

      // ANTI-FARMING: o que foi pago com o vale DO CLUBE nao gera selo novo. Sem isto
      // o premio de R$50 entra no total_gasto, vira 1 selo, e acelera o proximo premio:
      // a loja passa a financiar a propria fidelidade. Vale de TROCA nao entra aqui —
      // aquele dinheiro ja era da cliente.
      // Precisa vir ANTES do passo 3 (que soma o total_gasto), pra que o passo 3c leia
      // os dois campos ja atualizados.
      if (valeParaDebitar.origem === 'clube') {
        registrarGastoSemSelo(req.tenantId, cliente_id, valorEmVale);
      }
    }

    // 2d. queima o cupom (mesma transacao da venda). O UPDATE de baixarCupom carrega
    // `AND status='ativo' AND validade >= ?` no proprio WHERE — e' isso que fecha a
    // janela de corrida entre duas vendas simultaneas com o mesmo codigo, do mesmo
    // jeito que o `AND saldo >= ?` faz pro vale, logo acima.
    //
    // O throw derruba a transacao INTEIRA: a venda nao existe sem a baixa do cupom.
    // A alternativa (baixar depois, no front) ja custou caro neste sistema — era assim
    // que o vale ficava reutilizavel pra sempre quando o navegador nao chamava.
    if (cupomParaBaixar) {
      const ok = baixarCupom(req.tenantId, cupomParaBaixar.id, vendaId, cliente_id, descCupom, hoje);
      if (!ok) throw new Error('Cupom indisponivel, expirado ou ja utilizado');
    }

    // 2c. cria o carne do crediario (mesma transacao da venda: ou os dois, ou nenhum).
    // A entrada e' tudo que NAO foi crediario — a cliente pode ter dado 100 em dinheiro
    // e financiado 300; as duas coisas ja estao em venda_pagamentos como partes normais.
    if (parcelasDoCarne) {
      const entradaPaga = +(total - valorEmCrediario).toFixed(2);
      const carne = db.prepare(`
        INSERT INTO crediarios (tenant_id, venda_id, cliente_id, valor_total, entrada, num_parcelas, status)
        VALUES (?, ?, ?, ?, ?, ?, 'aberto')
      `).run(req.tenantId, vendaId, cliente_id, valorEmCrediario, entradaPaga, parcelasDoCarne.length);
      const carneId = carne.lastInsertRowid;

      const insParcela = db.prepare(`
        INSERT INTO crediario_parcelas (tenant_id, crediario_id, numero, valor, vencimento, status)
        VALUES (?, ?, ?, ?, ?, 'aberta')
      `);
      for (const p of parcelasDoCarne) {
        insParcela.run(req.tenantId, carneId, p.numero, p.valor, p.vencimento);
      }
      crediarioIdCriado = carneId;
    }

    // 3. atualiza cliente (se informado)
    //
    // O `total` aqui ja vem COM o desconto do cupom. Ou seja: cupom reduz o total_gasto
    // e portanto reduz os selos do clube. Isso e' CORRETO e nao deve ser compensado —
    // e' o oposto do gasto_sem_selo (o anti-farming do vale), e a diferenca importa:
    //   - o vale do clube e' dinheiro da LOJA voltando; se gerasse selo, o clube
    //     financiaria a si mesmo (premio virando premio).
    //   - o cupom e' dinheiro que a loja NAO recebeu. Ela comprou R$400 e pagou R$320:
    //     o faturamento dela e' 320. Dar selo sobre 400 seria a loja pagar DUAS VEZES
    //     pelo mesmo incentivo (o desconto E o progresso no cartao).
    // E total_gasto e' o historico de faturamento que a RFM e os relatorios leem —
    // infla-lo com desconto concedido corromperia os dois.
    if (cliente_id) {
      db.prepare(`UPDATE clientes SET total_gasto = total_gasto + ?, num_compras = num_compras + 1, ultima_compra = ?
                  WHERE id = ? AND tenant_id = ?`).run(total, hoje, cliente_id, req.tenantId);

      // 3c. CLUBE: esta compra fechou o cartao de selos? Entao o premio vira vale-credito
      // AGORA, na mesma transacao — nao num job noturno nem num clique do front. Ou a
      // venda e o premio existem juntos, ou nenhum dos dois (a licao que a baixa do vale
      // ja ensinou neste arquivo).
      // Depende do UPDATE acima: o calculo le o total_gasto JA somado.
      if (temFeature(planoDoTenant(req.tenantId), 'relacionamento')) {
        valeClubeCriado = emitirPremioClube(req.tenantId, cliente_id, vendaId);
      }
    }

    // 3b. troco devolvido por PIX: a gaveta ficou com a sobra física (cliente pagou em
    // espécie a mais), mas o troco saiu da CONTA via pix. Registra os dois lados pra
    // o fechamento bater: +suprimento dinheiro (sobra real na gaveta) e −sangria pix (conta).
    if (trocoForma === 'pix' && trocoVal > 0) {
      db.prepare(`INSERT INTO caixa_movimentos (data, tenant_id, tipo, valor, forma, motivo) VALUES (?, ?, 'suprimento', ?, 'dinheiro', ?)`)
        .run(hoje, req.tenantId, trocoVal, `Troco da venda #${vendaId} ficou na gaveta (devolvido por Pix)`);
      db.prepare(`INSERT INTO caixa_movimentos (data, tenant_id, tipo, valor, forma, motivo) VALUES (?, ?, 'sangria', ?, 'pix', ?)`)
        .run(hoje, req.tenantId, trocoVal, `Troco da venda #${vendaId} devolvido por Pix`);
      // recalcula sangrias/suprimentos do caixa contando só dinheiro (mesma regra do caixa.js)
      const m = db.prepare(`SELECT
          COALESCE(SUM(CASE WHEN tipo='sangria'    AND forma='dinheiro' THEN valor END),0) AS s,
          COALESCE(SUM(CASE WHEN tipo='suprimento' AND forma='dinheiro' THEN valor END),0) AS u
        FROM caixa_movimentos WHERE data = ? AND tenant_id = ?`).get(hoje, req.tenantId);
      db.prepare('UPDATE caixa_dia SET sangrias = ?, suprimentos = ? WHERE data = ? AND tenant_id = ?')
        .run(+m.s.toFixed(2), +m.u.toFixed(2), hoje, req.tenantId);
    }

    // 4. atualiza caixa do dia
    atualizarCaixaDia(hoje, req.tenantId);

    return vendaId;
  });

  try {
    const vendaId = tx();
    const mes = hoje.substring(0, 7); // YYYY-MM para invalidar DRE daquele mês
    cacheRelatorioPorTenant.invalidarTudo(req.tenantId);
    res.status(201).json({
      id: vendaId, total,
      crediario_id: crediarioIdCriado,
      vale_clube: valeClubeCriado,
      cupom: cupomParaBaixar ? { codigo: cupomParaBaixar.codigo, pct: cupomParaBaixar.pct, desconto: descCupom } : null,
      ...r,
    });
  } catch (e) {
    res.status(500).json({ erro: e.message });
  }
});

// Mapeia uma forma de pagamento para o bucket do caixa do dia.
// pix_chave conta como Pix; vale em sua própria categoria; resto em crédito.
//
// 'crediario' PRECISA vir antes do else: no crediário o dinheiro NÃO entrou (a
// loja fiou). Sem esta linha ele cairia no balde do crédito e o lojista veria
// dinheiro de maquininha que ninguém vai receber. acc.crediario existe só pra
// não contaminar os outros baldes — não é gravado em nenhuma coluna de caixa_dia.
function acumularForma(acc, forma, valor) {
  if (forma === 'pix' || forma === 'pix_chave') acc.pix += valor;
  else if (forma === 'debito') acc.debito += valor;
  else if (forma === 'dinheiro') acc.dinheiro += valor;
  else if (forma === 'vale') acc.vale += valor;
  else if (forma === 'crediario') acc.crediario += valor; // fiado: não entra em caixa nenhum
  else acc.credito += valor; // credito_vista, credito_parcelado, link_pagamento (combinado por enquanto)
}

// Recalcula o caixa do dia a partir das vendas (idempotente)
function atualizarCaixaDia(data, tenantId) {
  tenantId = exigirTenant(tenantId, 'vendas.atualizarCaixaDia');
  const vendas = db.prepare("SELECT * FROM vendas WHERE date(data_hora) = ? AND tenant_id = ?").all(data, tenantId);
  const acc = { pix: 0, debito: 0, credito: 0, dinheiro: 0, vale: 0, crediario: 0, bruto: 0, liquido: 0, lucro: 0, n: 0 };
  // soma por forma a partir das partes de pagamento (cobre vendas 'misto' corretamente)
  const partesDe = db.prepare('SELECT forma, valor FROM venda_pagamentos WHERE venda_id = ? AND tenant_id = ?');
  for (const v of vendas) {
    acc.bruto += v.total; acc.liquido += v.valor_liquido; acc.lucro += v.lucro; acc.n++;
    const partes = partesDe.all(v.id, tenantId);
    if (partes.length) {
      for (const p of partes) acumularForma(acc, p.forma, p.valor);
    } else {
      // vendas antigas (antes do split): usa a forma unica da venda
      acumularForma(acc, v.forma_pagamento, v.total);
    }
  }

  // CREDIARIO: a parcela paga hoje entra no caixa HOJE (na venda ela nao entrou).
  //
  // Esta funcao e' DESTRUTIVA: reescreve caixa_dia do zero a cada venda. Entao nao
  // adianta somar o recebimento na coluna por fora — a proxima venda do dia apagaria.
  // Em vez de brigar com o recalculo, ensinamos ele: os recebimentos entram AQUI,
  // dentro do mesmo passe, e o comportamento destrutivo vira aliado (recalcula tudo
  // sempre, e sempre acerta).
  //
  // De proposito FORA de bruto/liquido/lucro: esses tres alimentam o DRE, e a receita
  // ja foi reconhecida na DATA DA VENDA (competencia). Somar de novo aqui seria
  // contar a mesma receita duas vezes. So os baldes por forma (o que o caixa e o
  // fluxo de caixa leem) recebem o valor.
  const recebimentos = db.prepare(
    'SELECT forma, valor FROM crediario_recebimentos WHERE data = ? AND tenant_id = ?'
  ).all(data, tenantId);
  for (const rc of recebimentos) acumularForma(acc, rc.forma, rc.valor);
  // Tenta UPDATE; se não atualizar nada, INSERT
  const update = db.prepare(`
    UPDATE caixa_dia SET
      total_pix=?, total_debito=?, total_credito=?, total_dinheiro=?, total_vale=?,
      total_bruto=?, total_liquido=?, lucro_dia=?, num_vendas=?
    WHERE data=? AND tenant_id=?
  `).run(+acc.pix.toFixed(2), +acc.debito.toFixed(2), +acc.credito.toFixed(2), +acc.dinheiro.toFixed(2), +acc.vale.toFixed(2),
         +acc.bruto.toFixed(2), +acc.liquido.toFixed(2), +acc.lucro.toFixed(2), acc.n, data, tenantId);

  if (update.changes === 0) {
    db.prepare(`
      INSERT INTO caixa_dia (data, tenant_id, total_pix, total_debito, total_credito, total_dinheiro, total_vale, total_bruto, total_liquido, lucro_dia, num_vendas)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(data, tenantId, +acc.pix.toFixed(2), +acc.debito.toFixed(2), +acc.credito.toFixed(2), +acc.dinheiro.toFixed(2), +acc.vale.toFixed(2),
           +acc.bruto.toFixed(2), +acc.liquido.toFixed(2), +acc.lucro.toFixed(2), acc.n);
  }
}

// GET /api/vendas -> lista com filtros (data, de/ate, vendedor, cliente, forma)
router.get('/', (req, res) => {
  const { data, de, ate, vendedor_id, cliente_id, forma, origem, agrupado } = req.query;
  let sql = `SELECT v.*, c.nome AS cliente_nome, vd.nome AS vendedor_nome,
                    (SELECT COUNT(*) FROM venda_itens WHERE venda_id = v.id) AS num_itens
             FROM vendas v
             LEFT JOIN clientes c ON c.id = v.cliente_id
             LEFT JOIN vendedores vd ON vd.id = v.vendedor_id WHERE v.tenant_id = ?`;
  const params = [req.tenantId];
  if (data) { sql += ' AND date(v.data_hora) = ?'; params.push(data); }
  if (de)   { sql += ' AND date(v.data_hora) >= ?'; params.push(de); }
  if (ate)  { sql += ' AND date(v.data_hora) <= ?'; params.push(ate); }
  if (vendedor_id) { sql += ' AND v.vendedor_id = ?'; params.push(vendedor_id); }
  if (cliente_id)  { sql += ' AND v.cliente_id = ?'; params.push(cliente_id); }
  if (forma)       { sql += ' AND v.forma_pagamento = ?'; params.push(forma); }
  if (origem)      { sql += ' AND v.origem = ?'; params.push(origem); }
  sql += ' ORDER BY v.data_hora DESC LIMIT 500';
  const vendas = db.prepare(sql).all(...params);

  // resumo
  const resumo = vendas.reduce((a, v) => ({
    total: a.total + v.total, lucro: a.lucro + v.lucro, comissao: a.comissao + v.comissao_valor, n: a.n + 1
  }), { total: 0, lucro: 0, comissao: 0, n: 0 });
  resumo.total = +resumo.total.toFixed(2);
  resumo.lucro = +resumo.lucro.toFixed(2);
  resumo.comissao = +resumo.comissao.toFixed(2);
  resumo.ticketMedio = resumo.n > 0 ? +(resumo.total / resumo.n).toFixed(2) : 0;

  // PA (peças por atendimento)
  const pecasTotal = db.prepare(`
    SELECT COALESCE(SUM(vi.qtd), 0) AS pecas
    FROM venda_itens vi
    WHERE vi.venda_id IN (${vendas.map(() => '?').join(',')})
  `).get(...vendas.map(v => v.id));
  resumo.pa = resumo.n > 0 ? +(pecasTotal.pecas / resumo.n).toFixed(2) : 0;

  // Se agrupado=1, agrupa vendas por dia
  if (agrupado === '1') {
    const agrupadas = {};
    for (const v of vendas) {
      const dia = v.data_hora.slice(0, 10);
      if (!agrupadas[dia]) {
        agrupadas[dia] = { data: dia, vendas: [], total: 0, lucro: 0, comissao: 0, pecas: 0, num: 0 };
      }
      agrupadas[dia].vendas.push(v);
      agrupadas[dia].total += v.total;
      agrupadas[dia].lucro += v.lucro;
      agrupadas[dia].comissao += v.comissao_valor;
      agrupadas[dia].pecas += v.num_itens || 0;
      agrupadas[dia].num += 1;
    }
    // Converte para array e ordena por data DESC
    const diasAgrupados = Object.values(agrupadas)
      .map(d => ({
        ...d,
        total: +d.total.toFixed(2),
        lucro: +d.lucro.toFixed(2),
        comissao: +d.comissao.toFixed(2),
        pa: d.num > 0 ? +(d.pecas / d.num).toFixed(2) : 0
      }))
      .sort((a, b) => new Date(b.data) - new Date(a.data));
    res.json({ dias: diasAgrupados, resumo });
  } else {
    res.json({ vendas, resumo });
  }
});

// POST /api/vendas/impacto-desconto -> calcula impacto do desconto no lucro (preview no PDV)
router.post('/impacto-desconto', (req, res) => {
  const { subtotal, desconto, custoTotal, forma, parcelas = 1, comissaoPct = 0, embalagemTotal = 0 } = req.body;
  const { impactoDesconto } = require('../lib/calculos');
  res.json(impactoDesconto(parseFloat(subtotal)||0, parseFloat(desconto)||0, parseFloat(custoTotal)||0,
    forma, parseInt(parcelas)||1, parseFloat(comissaoPct)||0, parseFloat(embalagemTotal)||0, 0, req.tenantId));
});

// PATCH /api/vendas/:id/vendedor  body: { vendedor_id }
// Troca/define o vendedor de uma venda já feita e RECALCULA a comissão e o lucro
// com o % do novo vendedor (vendedor_id null = remover vendedor, comissão zera).
// GET /api/vendas/export.csv -> exporta vendas do período em CSV (feature Growth+)
// Query: de, ate (YYYY-MM-DD). Gate no SERVIDOR — o export do cliente sozinho não basta.
router.get('/export.csv', exigirFeature('export'), (req, res) => {
  const { de, ate } = req.query;
  let sql = `SELECT v.id, v.data_hora, c.nome AS cliente, vd.nome AS vendedor,
                    v.total, v.desconto, v.forma_pagamento, v.parcelas, v.lucro, v.origem
             FROM vendas v
             LEFT JOIN clientes c ON c.id = v.cliente_id
             LEFT JOIN vendedores vd ON vd.id = v.vendedor_id
             WHERE v.tenant_id = ? AND (v.deletado IS NULL OR v.deletado = 0)`;
  const params = [req.tenantId];
  if (de)  { sql += ' AND date(v.data_hora) >= ?'; params.push(de); }
  if (ate) { sql += ' AND date(v.data_hora) <= ?'; params.push(ate); }
  sql += ' ORDER BY v.data_hora DESC LIMIT 5000';
  const vendas = db.prepare(sql).all(...params);

  const cols = ['id', 'data_hora', 'cliente', 'vendedor', 'total', 'desconto', 'forma_pagamento', 'parcelas', 'lucro', 'origem'];
  const escCsv = (v) => {
    if (v == null) v = '';
    v = String(v).replace(/"/g, '""');
    return /[";\n]/.test(v) ? `"${v}"` : v;
  };
  const linhas = [cols.join(';')];
  for (const row of vendas) linhas.push(cols.map(c => escCsv(row[c])).join(';'));
  const csv = '﻿' + linhas.join('\r\n'); // BOM p/ acentos no Excel pt-BR

  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="vendas-${de || 'inicio'}_${ate || 'hoje'}.csv"`);
  res.send(csv);
});

router.patch('/:id/vendedor', (req, res) => {
  const v = db.prepare('SELECT * FROM vendas WHERE id = ? AND tenant_id = ?').get(req.params.id, req.tenantId);
  if (!v) return res.status(404).json({ erro: 'Venda não encontrada' });
  const vendedorId = req.body.vendedor_id || null;

  let comissaoPct = 0;
  if (vendedorId) {
    const vend = db.prepare('SELECT comissao_pct FROM vendedores WHERE id = ? AND tenant_id = ?').get(vendedorId, req.tenantId);
    if (!vend) return res.status(400).json({ erro: 'Vendedor inválido' });
    comissaoPct = vend.comissao_pct || 0;
  }
  const novaComissao = +(v.total * comissaoPct / 100).toFixed(2);
  // lucro ajustado: devolve a comissão antiga e desconta a nova
  const novoLucro = +(v.lucro + v.comissao_valor - novaComissao).toFixed(2);
  const hoje = v.data_hora.slice(0, 10);
  const tx = db.transaction(() => {
    db.prepare('UPDATE vendas SET vendedor_id = ?, comissao_valor = ?, lucro = ? WHERE id = ? AND tenant_id = ?')
      .run(vendedorId, novaComissao, novoLucro, v.id, req.tenantId);
    atualizarCaixaDia(hoje, req.tenantId); // lucro do dia muda
  });
  tx();
  res.json({ ok: true, comissao_valor: novaComissao, lucro: novoLucro });
});

// GET /api/vendas/:id -> detalhe com itens, cliente, vendedor e NFC-e
router.get('/:id', (req, res) => {
  const v = db.prepare(`SELECT v.*, c.nome AS cliente_nome, c.telefone AS cliente_tel,
                               vd.nome AS vendedor_nome
                        FROM vendas v
                        LEFT JOIN clientes c ON c.id = v.cliente_id
                        LEFT JOIN vendedores vd ON vd.id = v.vendedor_id
                        WHERE v.id = ? AND v.tenant_id = ?`).get(req.params.id, req.tenantId);
  if (!v) return res.status(404).json({ erro: 'Venda nao encontrada' });
  v.itens = db.prepare('SELECT * FROM venda_itens WHERE venda_id = ? AND tenant_id = ?').all(v.id, req.tenantId);
  v.pagamentos = db.prepare('SELECT forma, parcelas, valor FROM venda_pagamentos WHERE venda_id = ? AND tenant_id = ?').all(v.id, req.tenantId);
  v.nfce = db.prepare('SELECT * FROM nfce WHERE venda_id = ? AND tenant_id = ? ORDER BY id DESC LIMIT 1').get(v.id, req.tenantId);
  res.json(v);
});

// DELETE /api/vendas/:id -> cancela venda (devolve estoque)
router.delete('/:id', (req, res) => {
  const v = db.prepare('SELECT * FROM vendas WHERE id = ? AND tenant_id = ?').get(req.params.id, req.tenantId);
  if (!v) return res.status(404).json({ erro: 'Venda nao encontrada' });
  const itens = db.prepare('SELECT * FROM venda_itens WHERE venda_id = ? AND tenant_id = ?').all(v.id, req.tenantId);
  const hoje = v.data_hora.slice(0, 10);
  const tx = db.transaction(() => {
    for (const it of itens) {
      if (it.variacao_id) {
        db.prepare('UPDATE variacoes SET quantidade = quantidade + ? WHERE id = ?').run(it.qtd, it.variacao_id);
        db.prepare("INSERT INTO movimentos_estoque (variacao_id, tipo, qtd, motivo) VALUES (?, 'entrada', ?, ?)")
          .run(it.variacao_id, it.qtd, `cancelamento venda #${v.id}`);
      }
    }
    if (v.cliente_id) {
      db.prepare('UPDATE clientes SET total_gasto = total_gasto - ?, num_compras = MAX(num_compras - 1, 0) WHERE id = ? AND tenant_id = ?')
        .run(v.total, v.cliente_id, req.tenantId);

      // Se a venda cancelada foi paga com vale DO CLUBE, o gasto_sem_selo tem que voltar
      // junto com o total_gasto. Devolver so um dos dois faria a cliente PERDER selos:
      // o gasto sai da conta, mas o "desconto do anti-farming" fica pra sempre.
      // (O vale em si NAO e' cancelado nem devolvido — premio entregue e' compromisso
      // com a cliente. O high-water mark de clube_ciclo impede reemitir o mesmo cartao.)
      const valeDoClube = db.prepare(`
        SELECT COALESCE(SUM(vp.valor), 0) AS v
        FROM venda_pagamentos vp
        JOIN vales va ON va.venda_utilizacao_id = vp.venda_id AND va.tenant_id = vp.tenant_id
        WHERE vp.venda_id = ? AND vp.tenant_id = ? AND vp.forma = 'vale' AND va.origem = 'clube'
      `).get(v.id, req.tenantId).v;
      if (valeDoClube > 0) {
        db.prepare('UPDATE clientes SET gasto_sem_selo = MAX(gasto_sem_selo - ?, 0) WHERE id = ? AND tenant_id = ?')
          .run(valeDoClube, v.cliente_id, req.tenantId);
      }
    }

    // O cupom VOLTA a valer — a venda deixou de existir, o desconto tambem. Queimar
    // deixaria a cliente sem a peca E sem o beneficio. E' o oposto da regra do premio
    // do clube (que NAO volta: aquele vale ja esta na mao dela, e premio entregue e'
    // compromisso). A validade nao e' estendida: se venceu no meio tempo, ele volta
    // 'ativo' mas vencido, e o PDV recusa na hora.
    devolverCupomDaVenda(req.tenantId, v.id);

    // Marcar como deletado em vez de apagar (auditoria)
    db.prepare('UPDATE vendas SET deletado = 1 WHERE id = ? AND tenant_id = ?').run(v.id, req.tenantId);
    atualizarCaixaDia(hoje, req.tenantId);
  });
  tx();
  cacheRelatorioPorTenant.invalidarTudo(req.tenantId);
  res.json({ ok: true });
});

module.exports = router;
module.exports.atualizarCaixaDia = atualizarCaixaDia;
