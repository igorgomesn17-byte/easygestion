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
  DIA1: {
    texto: `Oi {nome}! 🥰 Que alegria ter você aqui na {loja}!\n\nSua compra foi confirmada e mal podemos esperar pra você arrasar com a peça nova ✨\n\nSegue a gente pra ver os lançamentos em primeira mão:\n📲 {instagram}\n\nObrigada por escolher a {loja}! 🛍️`,
  },

  // --- Clube de fidelidade ---
  CLUBE_BV: {
    texto: `Oi {nome}! ✨\nSeja muito bem-vinda ao {clube}! 🎉\n\nA cada R$ {valor_selo} em compras você ganha 1 selo.\nComplete {total_selos} selos e ganhe R$ {valor_premio} pra usar como quiser aqui na loja! 🎁\n\nVocê já deu o primeiro passo — continue acumulando!`,
  },
  CLUBE_PROG: {
    texto: `Oi {nome}! 🌟\nVocê já tem {selos} selos no {clube}!\n\nFaltam só {faltam} selos pra você ganhar R$ {valor_premio} de presente 🎁\nCada R$ {valor_selo} em compras = 1 selo a mais.\n\nVem garantir os próximos! ✨`,
  },
  CLUBE_OK: {
    texto: `Oi {nome}! 🎊🎉\nPARABÉNS! Você completou o cartão do {clube}!\n\nVocê ganhou um vale de R$ {valor_premio} pra usar na sua próxima compra aqui na {loja}! 🎁\n\nO vale já está no sistema — é só passar por aqui 😊\nObrigada por ser uma cliente tão especial! ✨`,
  },
  SELOS_PARADOS: {
    texto: `Oi {nome}! 🎁\nVocê está pertinho de ganhar um presente no {clube}!\n\nTem {selos} selos — faltam só {faltam} pra completar e ganhar R$ {valor_premio} pra usar na loja ✨\nQue tal garantir uma peça nova e já somar mais selos? Vem!`,
  },

  // --- Pos-venda ---
  POS_VENDA_1: {
    texto: `Oi {nome}! 😊 Tudo bem?\nPassando pra saber se você ficou feliz com sua compra na {loja}! 🛍️\n\nPode me contar rapidinho?\n⭐ De 1 a 5, que nota você dá pra sua experiência?\n👗 A peça ficou como esperava? O caimento ficou bom?\n\nSua opinião é muito importante pra gente! ✨`,
  },
  GOOGLE: {
    texto: `Oi {nome}! ⭐\nObrigada por comprar com a gente! Sua presença na {loja} faz toda diferença ✨\n\nVocê teria 1 minutinho pra deixar sua avaliação no Google? Isso ajuda muito a gente a crescer 🙏\n👉 {google_review}\n\nMuito obrigada!`,
  },
  POS_VENDA_2: {
    texto: `Oi {nome}! 🌟\nEsperamos que esteja amando sua peça da {loja}! ✨\n\nVocê faz parte do {clube}: a cada R$ {valor_selo} em compras acumula 1 selo — complete {total_selos} e ganhe R$ {valor_premio}! 🎁\n\nE se indicar uma amiga e ela comprar, você ganha um mimo especial 😉 É só mandar o contato dela!`,
  },

  // --- Aniversario ---
  PRE_ANIV: {
    texto: `Oi {nome}! 🎉\nSeu aniversário tá chegando e a {loja} preparou algo especial!\n\nPassa aqui antes do seu dia e ganhe {cupom_pct}% de desconto em toda a loja 🎁\n\n🎟️ Seu cupom exclusivo: *{cupom}*\n⏳ Vale até {cupom_validade} — não deixa passar!\n\nVocê merece ser celebrada com muito estilo! ✨`,
    cupom: 'ANIV10', cupom_pct: 10, cupom_dias: 7,
  },
  ANIVERSARIO: {
    texto: `Feliz aniversário, {nome}! 🎂🎉\nQue seu dia seja tão lindo quanto você!\n\nA {loja} tem um presente: {cupom_pct}% de desconto em toda a loja! 🎁\n\n🎟️ Seu cupom: *{cupom}*\n⏳ Vale até {cupom_validade} — aproveita!\n\nPassa pra celebrar com a gente! ✨`,
    cupom: 'ANIV10', cupom_pct: 10, cupom_dias: 3,
  },

  // --- Recompra e reativacao ---
  RECOMPRA: {
    texto: `Oi {nome}! ✨\nChegaram peças novas aqui na {loja} e separei algumas pensando em você 😍\n\nVem dar uma espiadinha? Tenho certeza que vai encontrar algo que combina com seu estilo 🤍`,
  },
  REAT_1: {
    texto: `Oi {nome}! 🌸\nSentimos sua falta aqui na {loja}!\n\nChegaram peças lindas essa semana e lembrei de você 😍\nSeus selos do {clube} ainda estão te esperando — cada visita te deixa mais perto dos R$ {valor_premio} de presente! 🎁\n\nVem dar uma olhadinha?`,
  },
  REAT_2: {
    texto: `Oi {nome}! 💕\nFaz um tempinho que você não passa aqui na {loja} e a gente quer muito te ver!\n\nPreparamos um cupom exclusivo de {cupom_pct}% pra você voltar com tudo 🎁\n🎟️ Cupom: *{cupom}*\n⏳ Vale até {cupom_validade} — corre!\n\nÉ só seu, ninguém mais usa 😉 Te esperamos! ✨`,
    cupom: 'VOLTE20', cupom_pct: 20, cupom_dias: 7,
  },
  REAT_3: {
    texto: `Oi {nome}! 💌\nÉ a {loja}! Não te esquecemos não 😊\n\nNosso melhor cupom, especialmente pra você voltar: {cupom_pct}% de desconto em toda a loja! 🎁\n🎟️ Cupom: *{cupom}*\n⏳ Vale até {cupom_validade}\n\nPode passar essa semana? A gente adora te ver! 🛍️`,
    cupom: 'SAUDADE25', cupom_pct: 25, cupom_dias: 7,
  },

  // --- Lancamento de colecao (disparado sob demanda, com nome do produto) ---
  LANC_1: {
    texto: `Oi {nome}! 🔥\nNovidade na {loja}: acabou de chegar {produto}!\n\nAs peças são lindas e estão voando 🚀\nVem garantir a sua antes que acabe! 🛍️`,
  },
  LANC_2: {
    texto: `Oi {nome}! ⚡\nAinda dá tempo de garantir {produto} aqui na {loja}!\nAs peças estão acabando rápido — não deixa pra amanhã 😉`,
  },
  LANC_3: {
    texto: `Oi {nome}! 🚨 Últimas unidades!\n{produto} na {loja} tá quase esgotando. Se tava pensando, é agora — depois não tem mais! 🛍️`,
  },

  // --- Convite generico de retorno (usado nas campanhas por segmento RFM) ---
  RETORNO: {
    texto: `Oi {nome}! 🌸\nChegaram novidades aqui na {loja} e lembrei de você! 😍\n\nTem peças que ficam tudo no seu estilo — e cada compra acumula mais um selo no seu {clube} 🎁\nVem dar uma olhadinha?`,
  },
};

// Campanhas por segmento RFM (tela de Segmentos, envio em massa manual).
// Segmento sem texto proprio cai no RETORNO.
const TEMPLATES_SEGMENTO = {
  campeas:     { texto: `Oi {nome}! 👑 Você é uma das nossas clientes mais especiais na {loja}!\n\nComo agradecimento, quero te mostrar em primeira mão nossas novidades antes de todo mundo ✨ Posso te enviar?` },
  fieis:       { texto: `Oi {nome}! ✨ Sempre um prazer te ter na {loja}!\n\nChegaram peças novas que combinam com seu estilo — quer dar uma olhadinha?` },
  promissoras: { texto: `Oi {nome}! 😍 Adoramos te ter na {loja}!\n\nChegaram novidades lindas — vem ver, tenho certeza que vai amar 🤍` },
  // Base fria: tom de REENCONTRO ("a loja voltou / tem novidade"), nao de
  // "sentimos sua falta ontem". Quem sumiu ha 6 meses estranha intimidade.
  perdidas:    { texto: `Oi {nome}! Aqui é a {loja}! ✨\n\nFaz um tempo que a gente não se vê e lembramos de você! 🥰 Chegou coleção nova linda e separamos algumas peças pensando no seu estilo.\n\nQuer dar uma olhadinha no que chegou? 😍` },
  hibernando:  { texto: `Oi {nome}! Aqui é a {loja}! ✨\n\nFaz um tempo que a gente não se vê e lembramos de você! 🥰 Chegou coleção nova linda e separamos algumas peças pensando no seu estilo.\n\nQuer dar uma olhadinha no que chegou? 😍` },
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
  'REAT_1:campeas': `Oi {nome}! 👑\nVocê é uma das clientes mais especiais da {loja} e faz um tempinho que não te vejo por aqui!\n\nChegou coleção nova e separei umas peças pensando em você 😍\nPassa aqui essa semana?`,
  'REAT_2:campeas': `Oi {nome}! 👑\nSenti sua falta! Você é uma das nossas clientes mais queridas e faz um tempo que a gente não se vê.\n\nSeparei um mimo especial pra você voltar: {cupom_pct}% de desconto 🎁\n🎟️ Cupom: *{cupom}*\n⏳ Vale até {cupom_validade}\n\nÉ só seu, viu? Te espero! ✨`,
  'REAT_3:campeas': `Oi {nome}! 💛\nVocê sempre foi uma das nossas clientes especiais e faz muito tempo que não te vejo. Fiquei com saudade de verdade!\n\nQuero muito te ter de volta, então preparei o meu melhor: {cupom_pct}% em toda a loja 🎁\n🎟️ Cupom: *{cupom}*\n⏳ Vale até {cupom_validade}\n\nMe dá o prazer de te atender de novo? 🤍`,

  // "Em risco" = gastava bem e esta sumindo. E' a hora de agir, e ela merece
  // um tom mais pessoal que o padrao.
  'REAT_2:risco': `Oi {nome}! 💕\nVocê é cliente de casa e faz um tempo que não passa aqui na {loja} — senti sua falta!\n\nPreparei um cupom exclusivo de {cupom_pct}% pra te ver de novo 🎁\n🎟️ Cupom: *{cupom}*\n⏳ Vale até {cupom_validade}\n\nTe espero! ✨`,

  // Fiel que sumiu: ela tem HABITO com a loja. Lembrar disso funciona melhor
  // que desconto.
  'REAT_1:fieis': `Oi {nome}! 🤍\nVocê sempre dá as caras aqui na {loja} e essa semana senti sua falta!\n\nChegaram peças novas com a sua cara 😍\nVem dar uma espiadinha?`,
};

// Rotulos pra tela de edicao — a lojista precisa saber QUANDO cada mensagem dispara.
const ROTULOS = {
  DIA1:          { label: '📲 Boas-vindas',            quando: 'No dia da compra' },
  CLUBE_BV:      { label: '✨ Boas-vindas ao clube',   quando: 'Na primeira compra' },
  CLUBE_PROG:    { label: '🌟 Progresso no clube',     quando: 'A cada compra, mostrando os selos' },
  CLUBE_OK:      { label: '🎊 Prêmio do clube',        quando: 'Quando completa o cartão de selos' },
  SELOS_PARADOS: { label: '🎟️ Selos quase no prêmio',  quando: 'Faltam ≤3 selos e parou de comprar há 20+ dias' },
  POS_VENDA_1:   { label: '🛍️ Pós-venda (satisfação)', quando: '3 dias depois da compra' },
  GOOGLE:        { label: '⭐ Avaliação no Google',     quando: '5 dias depois da compra' },
  POS_VENDA_2:   { label: '💬 Pós-venda (indicação)',  quando: '10 dias depois da compra' },
  RECOMPRA:      { label: '✨ Convite de recompra',    quando: '~20 dias depois da compra (sem cupom)' },
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
  // {cupom} vira o codigo NOMINAL da cliente (VOLTE20-K3P9), nao o prefixo.
  // {cupom_validade} e' a data (DD/MM) — "vale ate 20/07" converte mais que
  // "valido por 7 dias", porque o prazo vira uma coisa concreta na cabeca dela.
  '{cupom}', '{cupom_pct}', '{cupom_dias}', '{cupom_validade}', '{produto}',
];

module.exports = {
  DEFAULT_TEMPLATES, TEMPLATES_SEGMENTO, VARIANTES_SEGMENTO, ROTULOS, VARIAVEIS_DISPONIVEIS, interpolar,
};
