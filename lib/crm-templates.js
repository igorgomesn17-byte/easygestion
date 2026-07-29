// ============================================================
// TEMPLATES DA REGUA — as mensagens que a lojista manda no WhatsApp.
//
// Eram funcoes JS chumbadas no lib/crm.js, no tom de UMA loja ("Clube DS Lover
// 🤎"). Num SaaS multi-loja isso nao serve: cada loja tem voz. Aqui elas viram
// DADO — texto com placeholders, que a loja pode reescrever (tabela crm_templates).
//
// SEM SEED. Uma loja que nunca editou nao tem NENHUMA linha em crm_templates e
// roda com estes defaults. So grava quem personaliza. Se semeassemos 17 linhas por
// tenant no cadastro, qualquer melhoria futura nestes textos ficaria enterrada sob
// copias velhas — ninguem receberia.
//
// SOBRE O CUPOM (mudou em 13/07/2026): o campo `cupom` aqui e' o PREFIXO da campanha
// ('VOLTE20'), nao o codigo que a cliente usa. O codigo real e' NOMINAL — 'VOLTE20-K3P9',
// so dela, uso unico — emitido pelo scheduler (lib/cupons.js) e injetado no {cupom} na
// hora de gerar a fila. Ele VALIDA e DESCONTA no PDV de verdade.
//
// Era so texto ate aqui, e por isso a regua era cega: nao dava pra saber se funcionava.
// ============================================================

// Interpola {chave} com o valor. Chave desconhecida fica LITERAL de proposito:
// se a lojista escrever {nomee} por engano, ela ve o {nomee} na tela e conserta —
// em vez de o texto sair com um buraco silencioso no meio.
function interpolar(texto, vars) {
  return String(texto || '').replace(/\{(\w+)\}/g, (m, k) => (vars[k] !== undefined ? String(vars[k]) : m));
}

// tipo -> { texto, cupom?, cupom_pct?, cupom_dias? }
// Variaveis disponiveis: {nome} {loja} {clube} {instagram} {instagram_url}
// {google_review} {valor_selo} {total_selos} {valor_premio} {selos} {faltam}
// {dias} {cupom} {cupom_pct} {cupom_dias} {produto}
const DEFAULT_TEMPLATES = {
  // --- Pos-compra imediato ---
  //
  // A PRIMEIRA mensagem decide se as outras 16 serao lidas ou silenciadas. Por isso
  // ela abre com SERVICO (o prazo de troca, enquanto ele ainda vale), nao com pedido
  // de follow. O Instagram entra depois, como oferta, nao como o assunto.
  //
  // O PRAZO DE TROCA VIVE AQUI, no dia 0, de proposito: com prazo curto (o padrao e'
  // 3 dias uteis, configuravel em `troca_prazo_dias`), avisar no dia 3 seria avisar
  // no dia em que expira — ou depois dele, se a compra caiu numa sexta.
  DIA1: {
    // {ps} = o pedaco do clube, montado pelo acoesDoDia (selos/premio/boas-vindas).
    // Vazio quando o clube esta desligado. Fica no FIM de proposito: o assunto da
    // mensagem e' a compra dela, o clube e' o extra.
    texto: `{nome}, obrigada por hoje! 🥰\n\nQualquer coisa com a peça (troca, ajuste ou dúvida) é só me chamar por aqui. O prazo de troca é de {troca_prazo} a partir de hoje.\n\nSe quiser ver o que chega antes de ir pra loja: {instagram}{ps}`,
  },

  // --- Clube de fidelidade ---
  // Estes NAO disparam mais sozinhos no dia 0 (viravam a 2a mensagem do mesmo dia).
  // O scheduler acopla o clube ao DIA1 numa mensagem so; estes textos ficam pra quem
  // desligou o DIA1 e pra edicao manual.
  CLUBE_BV: {
    texto: `{nome}, você acabou de entrar no {clube}! ✨\n\nA cada R$ {valor_selo} em compras você ganha 1 selo. Completou {total_selos}, ganha R$ {valor_premio} pra gastar como quiser aqui na loja.\n\nO primeiro selo já é seu.`,
  },
  CLUBE_PROG: {
    texto: `{nome}, você já tem {selos} selos no {clube}! 🌟\n\nFaltam {faltam} pra você ganhar R$ {valor_premio} de presente. Cada R$ {valor_selo} em compras vale mais um selo.`,
  },
  CLUBE_OK: {
    texto: `{nome}, você completou o cartão do {clube}! 🎊\n\nSão R$ {valor_premio} de vale pra usar na próxima compra. Já está no sistema, é só passar aqui e falar comigo.`,
  },
  // O gancho mais forte da regua: nao e' desconto, e' algo que ela JA conquistou e
  // pode perder de vista. Custa zero de margem.
  SELOS_PARADOS: {
    texto: `{nome}, você está a {faltam} selos de ganhar R$ {valor_premio} na {loja}! 🎁\n\nJá tem {selos} guardados. Cada R$ {valor_selo} em compras completa mais um.\n\nQuer que eu separe alguma coisa pra você ver?`,
  },

  // --- Pos-venda ---
  // UMA pergunta, binaria, respondivel em uma palavra. A versao antiga fazia tres
  // (nota de 1 a 5 + caimento + expectativa) e por isso nao era respondida: pedia
  // "rapidinho" e entregava trabalho.
  POS_VENDA_1: {
    texto: `{nome}, a peça serviu direitinho? 😊\n\nSe tiver qualquer coisa, me fala que a gente resolve.`,
  },
  GOOGLE: {
    texto: `{nome}, tudo bem? ⭐\n\nSe você gostou do atendimento na {loja}, uma avaliação no Google ajuda demais a loja a aparecer pra quem ainda não conhece:\n{google_review}\n\nLeva 1 minuto. Obrigada!`,
  },
  POS_VENDA_2: {
    texto: `{nome}, tudo certo com a peça? 🌟\n\nUma coisa que talvez você não saiba: se você indicar uma amiga e ela comprar, você ganha um mimo. É só me mandar o contato dela.`,
  },

  // --- Aniversario ---
  PRE_ANIV: {
    texto: `{nome}, seu aniversário está chegando! 🎉\n\nA {loja} tem um presente: {cupom_pct}% de desconto em qualquer peça.\n\nCupom: *{cupom}* (é só seu)\nVale até {cupom_validade}\n\nPassa aqui pra escolher!`,
    cupom: 'ANIV10', cupom_pct: 10, cupom_dias: 7,
  },
  ANIVERSARIO: {
    texto: `Feliz aniversário, {nome}! 🎂\n\nSeu presente da {loja}: {cupom_pct}% de desconto em qualquer peça.\n\nCupom: *{cupom}*\nVale até {cupom_validade}\n\nAproveita o seu dia!`,
    cupom: 'ANIV10', cupom_pct: 10, cupom_dias: 3,
  },

  // --- Recompra e reativacao ---
  // RECOMPRA (dia ~20) e' a unica que fala com quem NAO sumiu. Ela oferece um
  // servico (separar antes de ir pra arara), nao desconto — de proposito: premiar
  // com cupom so quem some ensina a base a sumir.
  RECOMPRA: {
    texto: `{nome}, chegou coleção nova na {loja} e tem umas peças com a sua cara! ✨\n\nQuer que eu separe pra você ver antes de ir pra arara? É só me falar o que você está procurando.`,
  },
  // CARRINHO — o contato mais quente que existe. Ela escolheu, viu o total e parou
  // HA POUCAS HORAS. O tom nao e' de saudade nem de cobranca: e' de ajuda, porque
  // na maioria das vezes o que travou foi duvida (tamanho, frete, forma de pagar),
  // nao falta de vontade. Sem cupom de proposito: dar desconto pra quem ja estava
  // comprando destroi margem e, pior, ensina a base a abandonar o carrinho pra
  // ganhar desconto.
  CARRINHO: {
    texto: `{nome}, vi que você separou umas peças aqui na {loja} 😊\n\nFicou alguma dúvida sobre tamanho ou entrega? Me chama que eu te ajudo a fechar — e garanto as peças pra você.`,
  },
  // CATALOGO_SEMANAL — cadencia, nao reacao. Nao depende de a cliente ter sumido
  // nem de ter comprado: e' o "toda semana a loja recebe o catalogo", que no
  // atacado e' o que sustenta o giro. Sem cupom.
  CATALOGO_SEMANAL: {
    texto: `{nome}, chegaram as novidades da semana na {loja}! 🌿\n\nDá uma olhada e me chama pra separar o que você gostar.`,
  },
  // UM gancho so. A versao antiga misturava saudade + novidade + selos, e o gancho
  // de selos (o mais forte) ficava enterrado no fim. O clube agora e' trabalho do
  // SELOS_PARADOS, que dispara em paralelo a partir dos 20 dias.
  REAT_1: {
    texto: `{nome}, quanto tempo! 🌸\n\nChegou coleção nova na {loja} essa semana e lembrei de você quando vi umas peças.\n\nQuer dar uma olhadinha no que chegou?`,
  },
  REAT_2: {
    texto: `{nome}, faz um tempo que você não passa aqui na {loja}! 💕\n\nSeparei um cupom de {cupom_pct}% pra você voltar:\n\nCupom: *{cupom}*\nVale até {cupom_validade}\n\nEle é nominal, só funciona no seu nome. Te espero!`,
    cupom: 'VOLTE20', cupom_pct: 20, cupom_dias: 7,
  },
  REAT_3: {
    texto: `{nome}, aqui é a {loja}! 💌\n\nFaz bastante tempo que a gente não se vê, então preparei o meu melhor cupom pra você: {cupom_pct}% em qualquer peça.\n\nCupom: *{cupom}*\nVale até {cupom_validade}\n\nÉ só seu. Consegue passar essa semana?`,
    cupom: 'SAUDADE25', cupom_pct: 25, cupom_dias: 7,
  },

  // --- Lancamento de colecao (disparado sob demanda, com nome do produto) ---
  //
  // ESCASSEZ HONESTA: estes disparam por DATA (dia 0, 2, 5), nao por estoque real —
  // o sistema nao consulta a grade aqui. Por isso os textos NAO afirmam mais
  // "últimas unidades" nem "está acabando": seria escassez inventada, e a cliente
  // que chega na loja e ve a arara cheia nunca mais acredita no proximo aviso.
  // O que substitui: prioridade real (quem chega antes escolhe melhor) e o fato
  // verdadeiro de que as grades do meio (P/M) saem primeiro.
  LANC_1: {
    texto: `{nome}, chegou {produto} na {loja}! 🔥\n\nAvisando você primeiro, antes de ir pro Instagram. Quer que eu separe a sua numeração?`,
  },
  LANC_2: {
    texto: `{nome}, ainda dá tempo de ver {produto} na {loja}! ⚡\n\nAs grades do meio costumam sair primeiro. Se quiser garantir a sua numeração, me fala qual é que eu separo.`,
  },
  LANC_3: {
    texto: `{nome}, última chamada pra {produto}! 🛍️\n\nSe você estava pensando, me chama que eu vejo o que ainda tem na sua numeração.`,
  },

  // --- Convite generico de retorno (usado nas campanhas por segmento RFM) ---
  RETORNO: {
    texto: `{nome}, chegou novidade na {loja} e lembrei de você! 🌸\n\nTem peça que combina demais com seu estilo. Quer dar uma olhadinha?`,
  },
};

// Campanhas por segmento RFM (tela de Segmentos, envio em massa manual).
// Segmento sem texto proprio cai no RETORNO.
const TEMPLATES_SEGMENTO = {
  campeas:     { texto: `{nome}, você é uma das clientes mais especiais da {loja}! 👑\n\nChegou coleção nova e quero te mostrar antes de ir pro Instagram. Posso te mandar as fotos?` },
  fieis:       { texto: `{nome}, sempre um prazer te ver na {loja}! ✨\n\nChegaram peças novas que têm tudo a ver com seu estilo. Quer dar uma olhadinha?` },
  promissoras: { texto: `{nome}, que bom te ter na {loja}! 😍\n\nChegou coleção nova essa semana. Quer ver o que chegou?` },
  // Base fria: tom de REENCONTRO ("a loja voltou / tem novidade"), nao de
  // "sentimos sua falta ontem". Quem sumiu ha 6 meses estranha intimidade.
  perdidas:    { texto: `{nome}, aqui é a {loja}! ✨\n\nFaz um tempo que a gente não se vê. Chegou coleção nova e separei umas peças pensando no seu estilo.\n\nQuer dar uma olhadinha no que chegou?` },
  hibernando:  { texto: `{nome}, aqui é a {loja}! ✨\n\nFaz um tempo que a gente não se vê. Chegou coleção nova e tem bastante coisa boa.\n\nQuer que eu te mande umas fotos?` },
  // novas / atencao / risco caem em templates da regua (POS_VENDA_2, RETORNO, REAT_2)
};

// ============================================================
// VARIANTES POR SEGMENTO DENTRO DA REGUA
//
// A regua decide QUANDO falar (dias sem comprar). O RFM decide COMO falar.
// Antes disto, a campea que gastou R$3.000 e sumiu recebia exatamente o mesmo
// "sentimos sua falta" da cliente de uma compra de R$49 — mesma palavra, mesmo
// desconto. Perder uma dessas custa muito mais que a outra.
//
// PROPOSITALMENTE ESPARSO: nao ha variante pra todo (tipo x segmento). Seriam 40
// textos pra manter sincronizados, e a maioria diria a mesma coisa. So existe
// variante onde o tom REALMENTE muda — no reconhecimento de quem vale mais.
// Sem variante, cai no texto padrao do tipo (o comportamento de hoje).
//
// Chave: `${tipo}:${segmento}`.
const VARIANTES_SEGMENTO = {
  // A campea sumida e' a perda mais cara da loja. O tom nao e' "sentimos sua
  // falta" generico — e' reconhecimento explicito de que ela e' especial.
  'REAT_1:campeas': `{nome}, quanto tempo! 👑\n\nVocê é uma das clientes mais especiais da {loja} e senti sua falta por aqui.\n\nChegou coleção nova e separei umas peças pensando em você. Passa essa semana?`,
  'REAT_2:campeas': `{nome}, você é uma das nossas clientes mais queridas e faz um tempo que a gente não se vê! 👑\n\nSeparei um mimo pra você voltar: {cupom_pct}% de desconto.\n\nCupom: *{cupom}*\nVale até {cupom_validade}\n\nÉ só seu. Te espero!`,
  'REAT_3:campeas': `{nome}, você sempre foi uma das clientes especiais da {loja} e faz muito tempo que não te vejo. 💛\n\nQuero te ter de volta, então preparei o meu melhor: {cupom_pct}% em qualquer peça.\n\nCupom: *{cupom}*\nVale até {cupom_validade}\n\nMe dá o prazer de te atender de novo?`,

  // "Em risco" = gastava bem e esta sumindo. E' a hora de agir, e ela merece
  // um tom mais pessoal que o padrao.
  'REAT_2:risco': `{nome}, você é cliente de casa e faz um tempo que não passa aqui na {loja}! 💕\n\nSeparei um cupom de {cupom_pct}% pra te ver de novo:\n\nCupom: *{cupom}*\nVale até {cupom_validade}\n\nTe espero!`,

  // Fiel que sumiu: ela tem HABITO com a loja. Lembrar disso funciona melhor
  // que desconto.
  'REAT_1:fieis': `{nome}, você sempre dá as caras aqui na {loja} e essa semana senti sua falta! 🤍\n\nChegaram peças novas com a sua cara. Vem dar uma espiadinha?`,
};

// Rotulos pra tela de edicao — a lojista precisa saber QUANDO cada mensagem dispara.
const ROTULOS = {
  DIA1:          { label: '📲 Boas-vindas',            quando: 'No dia da compra (o clube entra junto, no fim)' },
  CLUBE_BV:      { label: '✨ Boas-vindas ao clube',   quando: 'Texto do clube na 1ª compra (vai dentro das boas-vindas)' },
  CLUBE_PROG:    { label: '🌟 Progresso no clube',     quando: 'Texto dos selos (vai dentro das boas-vindas)' },
  CLUBE_OK:      { label: '🎊 Prêmio do clube',        quando: 'Texto do prêmio (vai dentro das boas-vindas)' },
  SELOS_PARADOS: { label: '🎟️ Selos quase no prêmio',  quando: 'Faltam ≤3 selos e parou de comprar há 20+ dias' },
  POS_VENDA_1:   { label: '🛍️ Pós-venda (satisfação)', quando: '3 dias depois da compra' },
  GOOGLE:        { label: '⭐ Avaliação no Google',     quando: '7 dias depois da compra' },
  POS_VENDA_2:   { label: '💬 Pós-venda (indicação)',  quando: '10 dias depois da compra' },
  RECOMPRA:      { label: '✨ Convite de recompra',    quando: '~20 dias depois da compra (sem cupom)' },
  CARRINHO:      { label: '🛒 Carrinho abandonado',   quando: 'montou pedido na loja online e não finalizou' },
  CATALOGO_SEMANAL: { label: '🌿 Novidades da semana', quando: 'no dia da semana escolhido (cadência)' },
  REAT_1:        { label: '💤 Reativação 30 dias',     quando: '~30 dias sem comprar' },
  REAT_2:        { label: '💜 Reativação 60 dias',     quando: '~60 dias sem comprar (com cupom)' },
  REAT_3:        { label: '💌 Reativação 90 dias',     quando: '~90 dias sem comprar (último cupom)' },
  PRE_ANIV:      { label: '🎁 Pré-aniversário',        quando: '3 dias antes do aniversário' },
  ANIVERSARIO:   { label: '🎂 Aniversário',            quando: 'No dia do aniversário' },
  LANC_1:        { label: '🔥 Lançamento — chegou',    quando: 'No dia do lançamento (manual)' },
  LANC_2:        { label: '⚡ Lançamento — urgência',  quando: '2 dias depois do lançamento (manual)' },
  LANC_3:        { label: '🚨 Lançamento — últimas',   quando: '5 dias depois do lançamento (manual)' },
  RETORNO:       { label: '🌸 Convite de retorno',     quando: 'Campanhas por segmento' },
};

const VARIAVEIS_DISPONIVEIS = [
  '{nome}', '{loja}', '{clube}', '{instagram}', '{google_review}',
  '{valor_selo}', '{total_selos}', '{valor_premio}',
  '{selos}', '{faltam}', '{dias}',
  // Prazo de troca ja escrito por extenso ("3 dias úteis"), pronto pra frase.
  // Configuravel em `troca_prazo_dias` / `troca_prazo_uteis`.
  '{troca_prazo}',
  // {cupom} vira o codigo NOMINAL da cliente (VOLTE20-K3P9), nao o prefixo.
  // {cupom_validade} e' a data (DD/MM) — "vale ate 20/07" converte mais que
  // "valido por 7 dias", porque o prazo vira uma coisa concreta na cabeca dela.
  '{cupom}', '{cupom_pct}', '{cupom_dias}', '{cupom_validade}', '{produto}',
];

module.exports = {
  DEFAULT_TEMPLATES, TEMPLATES_SEGMENTO, VARIANTES_SEGMENTO, ROTULOS, VARIAVEIS_DISPONIVEIS, interpolar,
};
