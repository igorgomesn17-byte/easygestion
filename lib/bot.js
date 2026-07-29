// ============================================================
// BOT DE SAC — a portaria, não o vendedor.
// ------------------------------------------------------------
// O canal é SAC: o bot tira dúvida e aponta pra vitrine. Vender é trabalho da
// vitrine e do humano. Ele descobre em qual dos nove públicos do MCC a pessoa está
// e entrega pro departamento certo — nunca comprou vai pro Comercial 1, já comprou
// vai pro Comercial 2.
//
// A REGRA QUE DECIDE SE ELE AJUDA OU ESPANTA: nunca inventa e nunca insiste.
// Estudos de atendimento apontam que uma passagem malfeita pro humano derruba a
// satisfação em até 22 pontos — e bot que empurra venda quando não sabe responder
// é motivo de cliente bloquear número de loja. Na dúvida, ele passa: errar pro lado
// de chamar o humano é barato; errar pro lado de insistir custa a cliente.
//
// A VANTAGEM QUE ESTE BOT TEM: ele mora DENTRO do Easy. Bot de loja normal responde
// texto decorado porque não enxerga o sistema. Este lê estoque, pedido e ficha no
// banco — "restam 4 na M e 2 na G" em vez de "consulte nosso catálogo".
//
// Sem LLM na v1: as perguntas frequentes do balcão são poucas e repetitivas, e
// regra é grátis, instantânea e nunca alucina. Quando a mensagem sair do que ele
// conhece, ele passa — que é exatamente o que deve fazer de qualquer forma.
// ============================================================
const { db, getConfig } = require('../db/database');

// Palavras que fazem o bot PARAR na hora e chamar gente. Não é lista de bloqueio:
// é a fronteira entre o que é informação (bot resolve) e o que é decisão ou
// relação (só humano).
const GATILHOS_HUMANO = [
  // Negociação — margem é decisão de gente, sempre.
  'desconto', 'abatimento', 'melhor preço', 'melhor preco', 'faz por', 'fazer por',
  'baratinho', 'promoção', 'promocao', 'condição', 'condicao', 'prazo', 'parcelar',
  'parcela', 'fiado', 'boleto', 'negociar',
  // Reclamação — vai pro humano E entra como urgente.
  'defeito', 'rasgad', 'furad', 'manchad', 'errad', 'reclamação', 'reclamacao',
  'não chegou', 'nao chegou', 'atrasad', 'devolver', 'devolução', 'devolucao',
  'estorno', 'reembolso', 'procon', 'processar',
  // Pedido explícito de humano — sempre atendido, em qualquer momento.
  'falar com', 'atendente', 'pessoa', 'humano', 'alguém', 'alguem', 'gerente',
  'responsável', 'responsavel', 'dona', 'vendedora',
];

// Sinais de irritação. Separados dos outros porque mudam a PRIORIDADE do card,
// não só o roteamento.
//
// ⚠️ Só palavras que SÓ aparecem quando alguém está bravo. "cadê" e "urgente"
// estavam aqui e capturavam consulta legítima — "cadê meu pedido A7K2?" é a
// pergunta mais comum do SAC, e tratá-la como reclamação mandava pro humano algo
// que o bot resolve em um segundo. Falso positivo aqui custa atendimento humano
// desperdiçado; falso negativo custa só a prioridade do card.
const SINAIS_IRRITACAO = [
  'absurdo', 'ridículo', 'ridiculo', 'péssimo', 'pessimo', 'horrível', 'horrivel',
  'nunca mais', 'decepcion', 'palhaçada', 'palhacada', 'vergonha', 'enrolando',
  'descaso', 'inaceitável', 'inaceitavel', 'me responde', 'ninguém responde',
  'ninguem responde',
];

const MENU = `Oi! 🌿 Aqui é o atendimento da {loja}.
Como posso ajudar?

*1* Quero comprar
*2* Acompanhar meu pedido
*3* Troca ou devolução
*4* Dúvida sobre uma peça
*5* Falar com atendente`;

function normalizar(t) {
  return String(t || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').trim();
}

function contem(texto, lista) {
  const n = normalizar(texto);
  return lista.some((p) => n.includes(normalizar(p)));
}

function lojaNome(tenantId) { return getConfig('loja_nome', 'nossa loja', tenantId); }

// ------------------------------------------------------------
// Consultas ao banco — é o que separa este bot de um FAQ
// ------------------------------------------------------------

// "Tem na M?" — responde com o número real, e o número real desconta reservas
// (peça com Pix em aberto está prometida a outra pessoa).
//
// A busca é por PALAVRAS, não pela frase inteira. A cliente escreve "tem vestido
// chemise na M?" e o que sobra depois de tirar as palavras de pergunta é
// "vestido chemise M" — um LIKE com essa string nunca casaria com "Vestido
// Chemise Linho". Cada palavra vira um AND, e a peça é achada por interseção.
function estoqueDoProduto(tenantId, termo) {
  const palavras = String(termo || '')
    .split(/\s+/)
    .map((p) => p.trim())
    // Palavra de 1-2 letras é ruído ("M", "na", "o") — e "M" aqui é o TAMANHO,
    // não parte do nome. Filtrar evita casar com qualquer produto que tenha "m".
    .filter((p) => p.length >= 3)
    .slice(0, 4);   // frase longa demais vira busca impossível

  if (!palavras.length) return null;

  const where = palavras.map(() => 'nome LIKE ?').join(' AND ');
  const params = palavras.map((p) => `%${p}%`);

  let produto = db.prepare(`
    SELECT id, nome, preco_venda FROM produtos
     WHERE tenant_id = ? AND ativo = 1 AND (${where})
     ORDER BY LENGTH(nome) ASC LIMIT 1
  `).get(tenantId, ...params);

  // Não achou com todas as palavras? Tenta com a mais longa — é a mais
  // característica ("chemise" identifica melhor que "vestido").
  if (!produto && palavras.length > 1) {
    const maisLonga = palavras.slice().sort((a, b) => b.length - a.length)[0];
    produto = db.prepare(`
      SELECT id, nome, preco_venda FROM produtos
       WHERE tenant_id = ? AND ativo = 1 AND (nome LIKE ? OR codigo LIKE ?)
       ORDER BY LENGTH(nome) ASC LIMIT 1
    `).get(tenantId, `%${maisLonga}%`, `%${maisLonga}%`);
  }

  if (!produto) return null;

  const grade = db.prepare(`
    SELECT id, cor, tamanho, quantidade FROM variacoes
     WHERE tenant_id = ? AND produto_id = ? AND quantidade > 0
     ORDER BY cor, tamanho
  `).all(tenantId, produto.id);

  const reservas = require('./reserva').mapaDeReservas(tenantId);
  const disponivel = grade
    .map((g) => ({ ...g, quantidade: Math.max(0, g.quantidade - (reservas.get(g.id) || 0)) }))
    .filter((g) => g.quantidade > 0);

  return { produto, grade: disponivel };
}

function statusDoPedido(tenantId, codigo) {
  return db.prepare(`
    SELECT codigo, status, total, qtd_itens, venda_id, criado_em
      FROM vitrine_pedidos WHERE tenant_id = ? AND codigo = ?
  `).get(tenantId, String(codigo).toUpperCase());
}

// O código do pedido no meio da frase: "cadê o A7K2?" tem que funcionar. 4
// caracteres alfanuméricos, o formato que gerarCodigo produz.
function acharCodigo(texto) {
  const m = String(texto || '').toUpperCase().match(/\b([A-Z0-9]{4})\b/g);
  if (!m) return null;
  // Descarta o que é claramente outra coisa (ano, valor).
  return m.find((c) => /[A-Z]/.test(c) && /[0-9]/.test(c)) || null;
}

// ------------------------------------------------------------
// Decidir o que fazer com a mensagem
// ------------------------------------------------------------
// Devolve { acao, resposta, motivo, prioridade }.
//   acao: 'responder' → o bot resolve
//         'transferir' → humano assume (com motivo pro card)
function decidir(tenantId, texto, contexto = {}) {
  const t = normalizar(texto);
  const loja = lojaNome(tenantId);

  // 1. TUDO QUE SAI DO ESCOPO DO BOT — em qualquer momento, mesmo no meio do menu.
  //    Bot que prende a pessoa é o que faz bloquear o número da loja.
  //
  //    A ORDEM aqui não é estética: uma mensagem pode bater em mais de uma lista
  //    ("isso é um absurdo, quero falar com alguém" bate em irritação E em pedido
  //    de humano). Classificar do mais grave pro menos grave garante que a
  //    reclamação não vire "negociação" e caia no fim da fila.
  const RECLAMACAO = ['defeito', 'rasgad', 'furad', 'manchad', 'errad', 'reclamação',
    'reclamacao', 'nao chegou', 'não chegou', 'atrasad', 'devolver', 'devolução',
    'devolucao', 'estorno', 'reembolso', 'procon', 'processar'];
  const PEDIU_HUMANO = ['falar com', 'atendente', 'pessoa', 'humano', 'alguém', 'alguem',
    'gerente', 'responsável', 'responsavel', 'dona', 'vendedora'];
  const NEGOCIACAO = ['desconto', 'abatimento', 'melhor preço', 'melhor preco', 'faz por',
    'fazer por', 'baratinho', 'promoção', 'promocao', 'condição', 'condicao', 'prazo',
    'parcelar', 'parcela', 'fiado', 'boleto', 'negociar'];

  if (contem(texto, GATILHOS_HUMANO) || contem(texto, SINAIS_IRRITACAO)) {
    const reclamacao = contem(texto, RECLAMACAO);
    const irritada = contem(texto, SINAIS_IRRITACAO);
    const pediuHumano = contem(texto, PEDIU_HUMANO);
    const negociacao = contem(texto, NEGOCIACAO);

    // Mais grave primeiro. Reclamação e irritação vão pro TOPO da fila, acima de
    // qualquer venda — quem está bravo não pode esperar atrás de quem quer comprar.
    const motivo = reclamacao ? 'reclamacao'
      : irritada ? 'irritada'
      : pediuHumano ? 'pediu_humano'
      : negociacao ? 'negociacao'
      : 'pediu_humano';

    return {
      acao: 'transferir',
      motivo,
      prioridade: (reclamacao || irritada) ? 1 : 2,
      resposta: reclamacao
        ? 'Poxa, sinto muito 😔\n\nJá estou passando pra nossa equipe resolver isso pra você agora.'
        : irritada
          ? 'Entendo, e sinto muito por isso 😔\n\nJá estou chamando alguém da equipe pra te atender agora.'
          : 'Claro! Já estou chamando alguém da equipe pra falar com você 😊',
    };
  }

  // 2. Menu por número
  if (/^[1-5]$/.test(t)) {
    if (t === '1') {
      const slug = getConfig('loja_slug', '', tenantId) || contexto.slug || '';
      const site = process.env.SITE_URL || '';
      const min = getConfig('pedido_minimo', '', tenantId);
      return {
        acao: 'responder',
        resposta: `Que bom! 🌿\n\nNosso catálogo com o estoque atualizado está aqui:\n${site}/${slug}\n\n`
          + (min ? `O pedido mínimo é R$ ${min}. ` : '')
          + 'Você monta direto por lá e o Pix sai na hora. Qualquer dúvida me chama!',
      };
    }
    if (t === '2') {
      return { acao: 'responder', resposta: 'Claro! Me manda o código do seu pedido (ex: A7K2) que eu consulto pra você 😊' };
    }
    if (t === '3') {
      const prazo = getConfig('prazo_troca_dias', '7', tenantId);
      return {
        acao: 'transferir', motivo: 'troca', prioridade: 2,
        resposta: `Sem problema! Nosso prazo de troca é de ${prazo} dias.\n\nJá estou chamando alguém pra te ajudar com isso.`,
      };
    }
    if (t === '4') {
      return { acao: 'responder', resposta: 'Me diz o nome da peça que você quer saber e eu confiro o que temos disponível 😊' };
    }
    if (t === '5') {
      return { acao: 'transferir', motivo: 'pediu_humano', prioridade: 2,
               resposta: 'Já estou chamando alguém da equipe 😊' };
    }
  }

  // 3. Código de pedido na mensagem
  const codigo = acharCodigo(texto);
  if (codigo && contem(texto, ['pedido', 'cade', 'cadê', 'chegou', 'status', 'entrega', codigo])) {
    const p = statusDoPedido(tenantId, codigo);
    if (p) {
      if (p.venda_id) {
        return { acao: 'responder', resposta: `Seu pedido *${p.codigo}* está pago e confirmado! ✅\n\nJá vamos separar tudo. Qualquer coisa me chama.` };
      }
      return { acao: 'responder', resposta: `Achei seu pedido *${p.codigo}* — ${p.qtd_itens} ${p.qtd_itens === 1 ? 'item' : 'itens'}, R$ ${Number(p.total).toFixed(2).replace('.', ',')}.\n\nEle ainda está aguardando o pagamento. Quer que eu reenvie o Pix?` };
      }
    // Código que não existe: NÃO inventa. Passa, porque a cliente tem um código na
    // mão e alguém precisa descobrir de onde ele veio.
    return { acao: 'transferir', motivo: 'pedido_nao_encontrado', prioridade: 2,
             resposta: 'Não encontrei esse código aqui 🤔 Vou chamar alguém da equipe pra verificar pra você.' };
  }

  // 4. Pergunta de estoque ("tem na M?", "tem o vestido chemise?")
  if (contem(texto, ['tem ', 'tem?', 'ainda tem', 'disponivel', 'disponível', 'numeração', 'numeracao', 'tamanho'])) {
    // Tira as palavras de pergunta pra sobrar o nome da peça.
    const termo = String(texto)
      .replace(/\b(tem|ainda|voce|você|vcs|disponivel|disponível|no|na|em|o|a|de|pra|para|qual|quais|tamanho|numeracao|numeração)\b/gi, ' ')
      .replace(/[?!.,]/g, ' ').trim();

    if (termo.length >= 3) {
      const r = estoqueDoProduto(tenantId, termo);
      if (r && r.grade.length) {
        const porCor = {};
        for (const g of r.grade) (porCor[g.cor || 'Única'] = porCor[g.cor || 'Única'] || []).push(`${g.tamanho} (${g.quantidade})`);
        const linhas = Object.entries(porCor).map(([cor, ts]) => `*${cor}*: ${ts.join(', ')}`).join('\n');
        return {
          acao: 'responder',
          resposta: `Temos sim! 🌿 *${r.produto.nome}* — R$ ${Number(r.produto.preco_venda).toFixed(2).replace('.', ',')}\n\n${linhas}\n\nQuer que eu separe?`,
        };
      }
      if (r) {
        // O produto EXISTE mas está sem estoque. Dizer isso é diferente de dizer
        // que não existe — e é a informação certa.
        return { acao: 'responder', resposta: `A *${r.produto.nome}* está esgotada no momento 😕\n\nQuer que eu avise quando chegar?` };
      }
    }
    // Não achou a peça: passa em vez de chutar.
    return { acao: 'transferir', motivo: 'duvida_produto', prioridade: 3,
             resposta: 'Deixa eu confirmar isso certinho pra você — já estou chamando alguém da equipe 😊' };
  }

  // 5. Saudação → menu
  if (contem(texto, ['oi', 'ola', 'olá', 'bom dia', 'boa tarde', 'boa noite', 'tudo bem', 'menu'])) {
    return { acao: 'responder', resposta: MENU.replace('{loja}', loja) };
  }

  // 6. NÃO SEI. Passa. Este é o caminho mais importante do arquivo: a alternativa
  //    seria inventar, e uma resposta errada sobre estoque ou prazo queima a cliente.
  return { acao: 'transferir', motivo: 'fora_do_escopo', prioridade: 3, resposta: null };
}

// ------------------------------------------------------------
// Pra quem transferir — a regra vem do MCC
// ------------------------------------------------------------
// Nunca comprou → Comercial 1 (falta a primeira venda, esforço alto/ticket baixo).
// Já comprou    → Comercial 2 (a relação é dele; esforço baixo/ticket alto).
function departamentoDe(tenantId, clienteId) {
  if (!clienteId) return 'c1';
  const c = db.prepare('SELECT num_compras, tipo FROM clientes WHERE id = ? AND tenant_id = ?')
    .get(clienteId, tenantId);
  if (!c) return 'c1';
  if (c.tipo === 'prospect') return 'c1';
  return Number(c.num_compras) > 0 ? 'c2' : 'c1';
}

// Fora do horário o bot é honesto: responde o que sabe e diz quando alguém volta,
// em vez de fingir que tem gente do outro lado.
function dentroDoHorario(tenantId) {
  const ini = parseInt(getConfig('atendimento_inicio', '8', tenantId), 10);
  const fim = parseInt(getConfig('atendimento_fim', '18', tenantId), 10);
  const h = new Date().getHours();
  return h >= ini && h < fim;
}

function avisoForaDoHorario(tenantId) {
  const ini = getConfig('atendimento_inicio', '8', tenantId);
  return `Nosso atendimento volta a partir das ${ini}h. Assim que abrirmos, alguém te responde por aqui 🌿`;
}

module.exports = {
  decidir, departamentoDe, dentroDoHorario, avisoForaDoHorario,
  estoqueDoProduto, statusDoPedido, acharCodigo,
  MENU, GATILHOS_HUMANO,
};
