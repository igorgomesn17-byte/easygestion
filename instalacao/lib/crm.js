// ============================================================
// CRM: Clube de fidelidade (selos), régua de relacionamento
// (mensagens prontas + gatilhos do dia) e Matriz RFM.
// Nome da loja e do clube vêm da config (personalizável por loja).
// Tudo semi-automático: gera as mensagens; o envio é 1 clique (wa.me).
// ============================================================
const { db, getConfig } = require('../db/database');

// ---------- Helpers ----------
function cfgNum(chave, fallback) { const v = getConfig(chave, null); return v !== null ? parseFloat(v) : fallback; }
function clubeAtivo() { return getConfig('clube_ativo', '1') === '1'; }
function apelido(nome) { return (nome || '').trim().split(/\s+/)[0] || 'cliente'; }
function soDigitos(t) { return String(t || '').replace(/\D/g, ''); }
function lojaNome() { return getConfig('loja_nome', 'nossa loja'); }
function lojaInsta() { return getConfig('loja_instagram', ''); }
// Link clicável do Instagram: usa a URL configurada, ou monta a partir do @
function lojaInstaUrl() {
  const url = getConfig('loja_instagram_url', '');
  if (url) return url;
  const handle = (getConfig('loja_instagram', '') || '').replace(/[@\s]/g, '');
  return handle ? `https://instagram.com/${handle}` : '';
}

// dias entre duas datas YYYY-MM-DD (a - b, em dias inteiros)
function diasEntre(aStr, bStr) {
  const a = new Date(aStr + 'T00:00:00'), b = new Date(bStr + 'T00:00:00');
  return Math.round((a - b) / 86400000);
}

// ---------- Configs do clube ----------
// Nome do clube vem da config (editável pela lojista). Fallback neutro.
function clubeNome() { return getConfig('clube_nome', 'Clube de Fidelidade'); }
function clubeCfg() {
  return {
    valorSelo: cfgNum('clube_valor_selo', 50),
    totalSelos: cfgNum('clube_total_selos', 10),
    valorPremio: cfgNum('clube_valor_premio', 50),
  };
}

// Selos de um cliente a partir do total_gasto
function selosDe(cliente) {
  const c = clubeCfg();
  const ativo = clubeAtivo();
  const selos = Math.floor((cliente.total_gasto || 0) / c.valorSelo);
  const noCiclo = c.totalSelos > 0 ? (selos % c.totalSelos) : selos;
  const premiosGanhos = c.totalSelos > 0 ? Math.floor(selos / c.totalSelos) : 0;
  const faltam = c.totalSelos > 0 ? (c.totalSelos - noCiclo) : 0;
  return { ativo, selos, noCiclo, faltam, premiosGanhos, ...c };
}

// ---------- Cupons (da régua original) ----------
const CUPONS = {
  pre_aniversario: { codigo: 'ANIV10', desconto: 10, validade: 7 },
  aniversario:     { codigo: 'ANIV10', desconto: 10, validade: 3 },
  reat2:           { codigo: 'VOLTE20', desconto: 20, validade: 7 },
  reat3:           { codigo: 'SAUDADE25', desconto: 25, validade: 7 },
};

// ---------- Mensagens (tom DS) ----------
const M = {
  dia1: (ap) => `Oi ${ap}! 🥰 Que alegria ter você aqui na ${lojaNome()}!\n\nSua compra foi confirmada e mal podemos esperar pra você arrasar com a peça nova 🤎\n\nSegue a gente no Instagram pra ver os lançamentos em primeira mão:\n📲 ${lojaInsta()}${lojaInstaUrl() ? '\n👉 ' + lojaInstaUrl() : ''}\n\nObrigada por escolher a ${lojaNome()}! 🛍️`,
  clube_bv: (ap, c) => `Oi ${ap}! 🤎\nSeja muito bem-vinda ao ${clubeNome()}! 🎉\n\nCom cada R$ ${c.valorSelo} em compras você acumula 1 selo.\nComplete ${c.totalSelos} selos e ganhe R$ ${c.valorPremio} pra usar como quiser aqui na loja! 🎁\n\nVocê já deu o primeiro passo — continue acumulando e aproveite as vantagens de ser uma DS Lover!`,
  clube_progresso: (ap, s) => `Oi ${ap}! 🌟\nVocê já tem ${s.noCiclo} selos no ${clubeNome()}! ${s.noCiclo >= 7 ? '🔥 Tá quase lá!' : '💪 Continue assim!'}\n\nFaltam só ${s.faltam} selos pra você ganhar R$ ${s.valorPremio} de presente 🎁\nCada R$ ${s.valorSelo} em compras = 1 selo a mais!\n\nVem garantir os próximos! 🤎`,
  clube_completo: (ap, c) => `Oi ${ap}! 🎊🎉\nPARABÉNS! Você completou o cartão do ${clubeNome()}!\n\nVocê ganhou R$ ${c.valorPremio} pra usar na sua próxima compra aqui na ${lojaNome()}! 🎁\n\nÉ só passar por aqui e apresentar essa mensagem 😊\nObrigada por ser uma DS Lover tão especial! 🤎`,
  pos_venda1: (ap) => `Oi ${ap}! 😊 Tudo bem?\nPassando pra saber se você ficou feliz com sua compra na ${lojaNome()}! 🛍️\n\nPode me contar rapidinho?\n⭐ De 1 a 5, que nota você dá pra sua experiência?\n👗 A peça ficou como esperava? O caimento ficou bom?\n\nSua opinião é muito importante pra a gente! 🤎`,
  google: (ap, link) => `Oi ${ap}! ⭐\nObrigada por ser uma DS Lover! Sua presença na ${lojaNome()} faz toda diferença 🤎\n\nVocê teria 1 minutinho pra deixar sua avaliação no Google? Isso ajuda muito a gente a crescer 🙏${link ? '\n\n👉 ' + link : ''}\n\nMuito obrigada!`,
  pos_venda2: (ap, c) => `Oi ${ap}! 🌟\nEsperamos que esteja amando sua peça da ${lojaNome()}! 🤎\n\nVocê faz parte do ${clubeNome()}: a cada R$ ${c.valorSelo} em compras acumula 1 selo — complete ${c.totalSelos} e ganhe R$ ${c.valorPremio}! 🎁\n\nE se indicar uma amiga e ela comprar, você ganha um mimo especial 😉 É só mandar o contato dela!`,
  pre_aniversario: (ap) => { const c = CUPONS.pre_aniversario; return `Oi ${ap}! 🎉\nSeu aniversário tá chegando e o ${clubeNome()} preparou algo especial!\n\nPassa aqui na ${lojaNome()} antes do seu dia e ganhe ${c.desconto}% de desconto em toda a loja 🎁\n\n🎟️ Seu cupom exclusivo: *${c.codigo}*\n⏳ Válido por ${c.validade} dias — não deixa passar!\n\nVocê merece ser celebrada com muito estilo! 🤎`; },
  aniversario: (ap) => { const c = CUPONS.aniversario; return `Feliz aniversário, ${ap}! 🎂🎉\nQue seu dia seja tão lindo quanto você!\n\nO ${clubeNome()} tem um presente: ${c.desconto}% de desconto em toda a ${lojaNome()}! 🎁\n\n🎟️ Seu cupom: *${c.codigo}*\n⏳ Válido por ${c.validade} dias — aproveita!\n\nPassa pra celebrar com a gente! 🤎`; },
  retorno: (ap) => `Oi ${ap}! 🌸\nChegaram novidades aqui na ${lojaNome()} e lembrei de você! 😍\n\nTem peças que ficam tudo no seu estilo — e cada compra acumula mais um selo no seu ${clubeNome()}! 🎁\nVem dar uma olhadinha?`,
  reat1: (ap, c) => `Oi ${ap}! 🌸\nSentimos sua falta aqui na ${lojaNome()}!\n\nChegaram peças lindas essa semana e lembrei de você 😍\nSeus selos do ${clubeNome()} ainda estão te esperando — cada visita te deixa mais perto dos R$ ${c.valorPremio} de presente! 🎁\n\nVem dar uma olhadinha?`,
  reat2: (ap) => { const c = CUPONS.reat2; return `Oi ${ap}! 💕\nFaz um tempinho que você não passa aqui na ${lojaNome()} e a gente quer muito te ver!\n\nPreparamos um cupom exclusivo de ${c.desconto}% pra você voltar com tudo 🎁\n🎟️ Cupom: *${c.codigo}*\n⏳ Válido por ${c.validade} dias — corre!\n\nTe esperamos! 🤎`; },
  reat3: (ap) => { const c = CUPONS.reat3; return `Oi ${ap}! 💌\nÉ a ${lojaNome()}! Não te esquecemos não 😊\n\nNosso melhor cupom, especialmente pra você voltar: ${c.desconto}% de desconto em toda a loja! 🎁\n🎟️ Cupom: *${c.codigo}*\n⏳ Válido por ${c.validade} dias\n\nPode passar essa semana? A gente adora te ver! 🛍️`; },
  lanc1: (ap, prod) => `Oi ${ap}! 🔥\nNovidade na ${lojaNome()}: acabou de chegar ${prod}!\n\nAs peças são lindas e estão voando 🚀\nVem garantir a sua antes que acabe! 🛍️`,
  lanc2: (ap, prod) => `Oi ${ap}! ⚡\nAinda dá tempo de garantir ${prod} aqui na ${lojaNome()}!\nAs peças estão acabando rápido — não deixa pra amanhã 😉`,
  lanc3: (ap, prod) => `Oi ${ap}! 🚨 Últimas unidades!\n${prod} na ${lojaNome()} tá quase esgotando. Se tava pensando, é agora — depois não tem mais! 🛍️`,
  pos_lanc: (ap, prod) => `Oi ${ap}! 📸\nEsperamos que esteja amando ${prod}! 🤎\nA gente ia adorar te ver com a peça — se quiser, manda uma foto ou nos marca no Instagram que a gente reposta com carinho 🥰`,
  // Convite de recompra (~dia 20): convite leve, SEM cupom — previne o esfriamento
  recompra: (ap) => `Oi ${ap}! ✨\nChegaram peças novas aqui na ${lojaNome()} e separei algumas pensando em você 😍\n\nVem dar uma espiadinha? Tenho certeza que vai encontrar algo que combina com seu estilo 🤎`,
  // Selos parados: cliente quase com o cartão cheio que parou de comprar
  selos_parados: (ap, s) => `Oi ${ap}! 🎁\nVocê está pertinho de ganhar um presente no ${clubeNome()}!\n\nTem ${s.noCiclo} selos — faltam só ${s.faltam} pra completar e ganhar R$ ${s.valorPremio} pra usar na loja 🤎\nQue tal garantir uma peça nova e já somar mais selos? Vem!`,
  // Data comercial genérica (a mensagem real vem do cadastro da data)
  data_comercial: (ap, texto) => texto.replace(/\{nome\}/g, ap),
};

// ============================================================
// AÇÕES DO DIA — varre a base e devolve quem contatar hoje
// ============================================================
function acoesDoDia(hoje, opc = {}) {
  const ativo = clubeAtivo();
  const c = clubeCfg();
  // régua não contata quem está arquivado nem quem pediu "não perturbe" (LGPD)
  const clientes = db.prepare('SELECT * FROM clientes WHERE arquivado = 0 AND nao_perturbe = 0').all();
  const acoes = [];
  const add = (a) => { if (a.telefone) acoes.push(a); };

  // mapeia DD/MM de hoje e de +3 dias
  const d = new Date(hoje + 'T12:00:00');
  const ddmm = (dt) => String(dt.getDate()).padStart(2, '0') + '/' + String(dt.getMonth() + 1).padStart(2, '0');
  const hojeDDMM = ddmm(d);
  const mais3 = new Date(d); mais3.setDate(d.getDate() + 3);
  const mais3DDMM = ddmm(mais3);

  for (const cli of clientes) {
    const ap = apelido(cli.nome);
    const base = { cliente_id: cli.id, nome: cli.nome, telefone: cli.telefone };

    // --- Aniversário (hoje) e pré (+3 dias) ---
    if (cli.aniversario === hojeDDMM)
      add({ ...base, tipo: 'ANIVERSARIO', label: '🎂 Aniversário hoje', prioridade: 1, detalhe: 'Faz aniversário hoje!', mensagem: M.aniversario(ap) });
    else if (cli.aniversario === mais3DDMM)
      add({ ...base, tipo: 'PRE_ANIV', label: '🎁 Pré-aniversário', prioridade: 1, detalhe: `Aniversário em 3 dias (${cli.aniversario})`, mensagem: M.pre_aniversario(ap) });

    // --- Gatilhos baseados em última compra ---
    if (cli.ultima_compra) {
      const dias = diasEntre(hoje, cli.ultima_compra);
      const s = selosDe(cli);
      const rfm = rfmDoCliente(cli, hoje);          // casa a régua com a RFM
      const segNome = SEGMENTOS[rfm.segmento] ? SEGMENTOS[rfm.segmento].nome : '';
      const meta = { segmento: rfm.segmento, segmento_nome: segNome }; // anexado em cada ação
      const ehRecente = SEG_RECENTE.includes(rfm.segmento);

      if (dias === 0) {
        // comprou hoje: boas-vindas + clube
        add({ ...base, ...meta, tipo: 'DIA1', label: '📲 Boas-vindas', prioridade: 1, detalhe: 'Comprou hoje', mensagem: M.dia1(ap) });
        if (ativo) {
          if (s.noCiclo === 0 && s.premiosGanhos > 0)
            add({ ...base, ...meta, tipo: 'CLUBE_OK', label: '🎊 Prêmio do clube', prioridade: 1, detalhe: `Completou ${c.totalSelos} selos!`, mensagem: M.clube_completo(ap, c) });
          else if (cli.num_compras === 1)
            add({ ...base, ...meta, tipo: 'CLUBE_BV', label: '🤎 Boas-vindas ao clube', prioridade: 2, detalhe: 'Primeira compra', mensagem: M.clube_bv(ap, c) });
          else
            add({ ...base, ...meta, tipo: 'CLUBE_PROG', label: '🌟 Progresso no clube', prioridade: 3, detalhe: `${s.noCiclo} selos • faltam ${s.faltam}`, mensagem: M.clube_progresso(ap, s) });
        }
      }
      else if (dias === 3) add({ ...base, ...meta, tipo: 'POS_VENDA_1', label: '🛍️ Pós-venda (satisfação)', prioridade: 2, detalhe: 'Comprou há 3 dias', mensagem: M.pos_venda1(ap) });
      else if (dias === 5) add({ ...base, ...meta, tipo: 'GOOGLE', label: '⭐ Avaliação Google', prioridade: 2, detalhe: 'Comprou há 5 dias', mensagem: M.google(ap, getConfig('loja_google_review', '')) });
      else if (dias === 10) add({ ...base, ...meta, tipo: 'POS_VENDA_2', label: '💬 Pós-venda (indicação)', prioridade: 3, detalhe: 'Comprou há 10 dias', mensagem: M.pos_venda2(ap, c) });
      // Convite de recompra (~dia 20): tampa o vazio dia 10→30. Sem cupom — é convite.
      else if (dias >= 18 && dias <= 22) add({ ...base, ...meta, tipo: 'RECOMPRA', label: '✨ Convite de recompra', prioridade: 3, detalhe: `${dias} dias da última compra`, mensagem: M.recompra(ap) });
      // Reativação: só pra quem NÃO está num segmento recente (não cobrar saudade de quem comprou)
      else if (dias >= 28 && dias <= 32) add({ ...base, ...meta, tipo: 'REAT_1', label: '💤 Reativação 30d', prioridade: ehRecente ? 6 : 4, detalhe: `${dias} dias sem comprar`, mensagem: M.reat1(ap, c) });
      else if (dias >= 58 && dias <= 62) add({ ...base, ...meta, tipo: 'REAT_2', label: '💜 Reativação 60d (cupom)', prioridade: rfm.segmento === 'risco' ? 2 : 4, detalhe: `${dias} dias • cupom ${CUPONS.reat2.codigo}${rfm.segmento==='risco'?' • EM RISCO ⚠️':''}`, mensagem: M.reat2(ap) });
      else if (dias >= 88 && dias <= 92) add({ ...base, ...meta, tipo: 'REAT_3', label: '💌 Reativação 90d (cupom)', prioridade: rfm.segmento === 'perdidas' ? 2 : 4, detalhe: `${dias} dias • cupom ${CUPONS.reat3.codigo}${rfm.segmento==='perdidas'?' • alto valor 💔':''}`, mensagem: M.reat3(ap) });

      // Selos parados: cartão quase cheio (faltam <=3) e parou de comprar (>=20 dias)
      if (ativo && s.faltam > 0 && s.faltam <= 3 && dias >= 20 && dias < 88)
        add({ ...base, ...meta, tipo: 'SELOS_PARADOS', label: '🎟️ Selos quase no prêmio', prioridade: 2, detalhe: `${s.noCiclo}/${c.totalSelos} selos • parou há ${dias}d`, mensagem: M.selos_parados(ap, s) });
    }
  }

  // --- Datas comerciais / sazonais ---
  let datasCom = [];
  try { datasCom = JSON.parse(getConfig('datas_comerciais', '[]')); } catch (e) { datasCom = []; }
  for (const dc of datasCom) {
    // dc.data = 'MM-DD' (anual) ou 'YYYY-MM-DD'; dispara em (data - dias_antes)
    const alvo = dc.data.length === 5 ? `${hoje.slice(0,4)}-${dc.data}` : dc.data;
    const diff = diasEntre(alvo, hoje); // dias do hoje até a data alvo
    if (diff === (dc.dias_antes || 0)) {
      for (const cli of clientes)
        add({ cliente_id: cli.id, nome: cli.nome, telefone: cli.telefone,
          tipo: 'DATA_COMERCIAL', label: `📅 ${dc.nome}`, prioridade: 2,
          detalhe: dc.dias_antes ? `Faltam ${dc.dias_antes} dias` : 'É hoje!',
          mensagem: M.data_comercial(apelido(cli.nome), dc.mensagem || '') });
    }
  }

  // --- Lançamento (opcional) ---
  if (opc.lancamento && opc.dataLanc) {
    const dl = diasEntre(hoje, opc.dataLanc);
    let fn = null, lbl = '';
    if (dl === 0) { fn = M.lanc1; lbl = '🔥 Lançamento — chegou!'; }
    else if (dl === 2) { fn = M.lanc2; lbl = '⚡ Lançamento — urgência'; }
    else if (dl === 5) { fn = M.lanc3; lbl = '🚨 Lançamento — últimas'; }
    if (fn) for (const cli of clientes)
      add({ cliente_id: cli.id, nome: cli.nome, telefone: cli.telefone, tipo: 'LANCAMENTO', label: lbl, prioridade: 2, detalhe: opc.lancamento, mensagem: fn(apelido(cli.nome), opc.lancamento) });
  }

  // remove as ações já ENVIADAS hoje (régua some o card depois do envio)
  let enviadas = [];
  try {
    enviadas = db.prepare('SELECT cliente_id, tipo FROM crm_acoes_enviadas WHERE data = ?').all(hoje);
  } catch (e) { enviadas = []; }
  const jaEnviada = new Set(enviadas.map(e => e.cliente_id + '|' + e.tipo));
  const pendentes = acoes.filter(a => !jaEnviada.has(a.cliente_id + '|' + a.tipo));

  pendentes.sort((a, b) => a.prioridade - b.prioridade);
  return pendentes;
}

// ============================================================
// MATRIZ RFM — segmentação por Recência, Frequência, Monetário
// ============================================================
// Nota por faixas fixas (robusto a base pequena, não depende de quartis).
// Recência calibrada pra moda feminina: ciclo de recompra ~30-45 dias.
// 60d sem comprar já é sinal de alerta; 90d+ é cliente sumida.
function notaR(dias) { if (dias <= 20) return 5; if (dias <= 40) return 4; if (dias < 60) return 3; if (dias < 90) return 2; return 1; }
function notaF(n)    { if (n >= 8) return 5; if (n >= 5) return 4; if (n >= 3) return 3; if (n >= 2) return 2; return 1; }
function notaM(v)    { if (v >= 2000) return 5; if (v >= 1000) return 4; if (v >= 500) return 3; if (v >= 200) return 2; return 1; }

// Segmento a partir de R/F/M. Prioriza recência (quem sumiu vira risco/perdida
// mesmo tendo sido boa cliente) — é o que orienta a campanha de reativação.
function segmentoDe(R, F, M) {
  const FM = (F + M) / 2;          // "força" da cliente (frequência + valor)
  // Sumiu faz muito tempo (R=1): perdida se já foi relevante, hibernando se não.
  if (R <= 1) return FM >= 2.5 ? 'perdidas' : 'hibernando';
  // Sumiu faz um tempo (R=2): em risco se era boa cliente, senão precisa de atenção.
  if (R === 2) return FM >= 3 ? 'risco' : 'atencao';
  // Recência média (R=3): fiel se compra com frequência/valor, senão atenção.
  if (R === 3) return FM >= 3.5 ? 'fieis' : 'atencao';
  // Recente (R>=4):
  if (FM >= 4) return 'campeas';            // recente + forte = VIP
  if (F >= 3)  return 'fieis';              // recente e compra sempre
  if (F <= 1)  return 'novas';              // recente, 1ª/2ª compra
  return 'promissoras';                      // recente, em formação
}

// Calcula R/F/M e segmento de um cliente (reusado pela régua e pela tela RFM)
function rfmDoCliente(cli, hoje) {
  const dias = cli.ultima_compra ? diasEntre(hoje, cli.ultima_compra) : 999;
  const R = notaR(dias), F = notaF(cli.num_compras || 0), Mn = notaM(cli.total_gasto || 0);
  const seg = segmentoDe(R, F, Mn);
  return { dias, R, F, M: Mn, rfm: `${R}${F}${Mn}`, segmento: seg };
}
// Segmentos "quentes" (compraram recente) — não devem receber reativação
const SEG_RECENTE = ['campeas', 'fieis', 'novas', 'promissoras'];

const SEGMENTOS = {
  campeas:     { nome: '🏆 Campeãs', cor: '#C9A24B', desc: 'Compram muito, recente e gastam bem. Suas VIPs.' },
  fieis:       { nome: '🤎 Fiéis', cor: '#6B5849', desc: 'Compram com frequência. A base da loja.' },
  novas:       { nome: '🌱 Novas', cor: '#2E7D32', desc: 'Compraram há pouco, ainda conhecendo a loja.' },
  promissoras: { nome: '✨ Promissoras', cor: '#1565C0', desc: 'Recentes, com potencial de virar fiéis.' },
  atencao:     { nome: '👀 Precisam de atenção', cor: '#F9A825', desc: 'Começando a espaçar. Reaproximar.' },
  risco:       { nome: '⚠️ Em risco', cor: '#E67E22', desc: 'Gastavam bem mas sumiram. Reativar com cupom.' },
  perdidas:    { nome: '💔 Perdidas', cor: '#C0392B', desc: 'Sumiram faz tempo. Última tentativa.' },
  hibernando:  { nome: '😴 Hibernando', cor: '#9E9E9E', desc: 'Baixo valor e inativas. Campanha leve.' },
};

// Mensagem de campanha sugerida por segmento (tom DS)
function campanhaSegmento(seg, ap) {
  switch (seg) {
    case 'campeas': return `Oi ${ap}! 👑 Você é uma das nossas clientes mais especiais na ${lojaNome()}!\nComo agradecimento, quero te mostrar em primeira mão nossas novidades antes de todo mundo 🤎 Posso te enviar?`;
    case 'fieis': return `Oi ${ap}! 🤎 Sempre um prazer te ter na ${lojaNome()}!\nChegaram peças novas que combinam com seu estilo — quer dar uma olhadinha?`;
    case 'novas': return M.pos_venda2(ap, clubeCfg());
    case 'promissoras': return `Oi ${ap}! 😍 Adoramos te ter na ${lojaNome()}!\nChegaram novidades lindas — vem ver, tenho certeza que vai amar 🤎`;
    case 'atencao': return M.retorno(ap);
    case 'risco': return M.reat2(ap);
    case 'perdidas': return M.reat3(ap);
    case 'hibernando': return M.retorno(ap);
    default: return M.retorno(ap);
  }
}

// Mensagem de REENCONTRO pra base fria (clientes que sumiram faz tempo): tom
// "a loja voltou / temos novidade", não "sentimos sua falta há pouco". Genérica
// e editável — sem cidade/marca chumbada (era específica da DS/Camacan).
function reencontroFrio(ap) {
  return `Oi ${ap}! Aqui é a ${lojaNome()}! ✨\n\nFaz um tempo que a gente não se vê e lembramos de você! 🥰 Chegou coleção nova linda e separamos algumas peças pensando no seu estilo.\n\nQuer dar uma olhadinha no que chegou? 😍`;
}

function segmentarRFM(hoje) {
  // RFM ignora clientes arquivados (mas mantém os "não perturbe" — aqui o envio é manual/decisão)
  const clientes = db.prepare('SELECT * FROM clientes WHERE num_compras > 0 AND arquivado = 0').all();
  const itens = clientes.map(cli => {
    const r = rfmDoCliente(cli, hoje);
    // base fria (sumiu faz muito tempo) usa a mensagem de reencontro; o resto, a campanha do segmento
    const ehFrio = (r.segmento === 'perdidas' || r.segmento === 'hibernando');
    return {
      id: cli.id, nome: cli.nome, telefone: cli.telefone, origem: cli.origem || null,
      ultima_compra: cli.ultima_compra, dias_sem_comprar: r.dias,
      num_compras: cli.num_compras || 0, total_gasto: +(cli.total_gasto || 0).toFixed(2),
      R: r.R, F: r.F, M: r.M, rfm: r.rfm,
      segmento: r.segmento, segmento_nome: SEGMENTOS[r.segmento].nome, segmento_cor: SEGMENTOS[r.segmento].cor,
      mensagem: ehFrio ? reencontroFrio(apelido(cli.nome)) : campanhaSegmento(r.segmento, apelido(cli.nome)),
    };
  });
  // resumo por segmento (na ordem definida)
  const resumo = Object.keys(SEGMENTOS).map(seg => {
    const list = itens.filter(i => i.segmento === seg);
    return {
      segmento: seg, nome: SEGMENTOS[seg].nome, cor: SEGMENTOS[seg].cor, desc: SEGMENTOS[seg].desc,
      n: list.length, valor: +list.reduce((s, i) => s + i.total_gasto, 0).toFixed(2),
    };
  });
  return { resumo, clientes: itens, total_clientes: itens.length };
}

module.exports = {
  apelido, soDigitos, selosDe, clubeAtivo, clubeCfg,
  acoesDoDia, segmentarRFM, SEGMENTOS, CUPONS,
  diasEntre, campanhaSegmento, M, // reaproveitados pelo inbox (follow-up / mensagem sugerida)
};
