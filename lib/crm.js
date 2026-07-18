// ============================================================
// RELACIONAMENTO — o motor da regua (quem contatar hoje), a matriz RFM
// (segmentacao de clientes) e o calculo do clube de fidelidade (selos).
//
// -- MULTI-TENANCY: LEIA ANTES DE MEXER --
//
// Este arquivo veio de um sistema de UMA loja so. Na versao original ele fazia
// `SELECT * FROM clientes` sem WHERE tenant_id, e chamava getConfig(chave, fallback)
// omitindo o 3o argumento — que em db/database.js tem `tenantId = 1` como DEFAULT.
// Ligado assim num SaaS, uma loja veria os clientes de TODAS as outras e leria a
// configuracao da loja 1.
//
// Por isso a regra aqui e' mais dura que no resto do projeto: toda funcao que toca
// o banco recebe `tenantId` como PRIMEIRO parametro, obrigatorio, e exigirTenant()
// derruba na hora se ele nao vier. Um default silencioso e' exatamente o bug.
//
// A regua NAO envia nada sozinha: ela monta a fila de contatos do dia com a
// mensagem pronta. O envio e' um clique humano no wa.me.
// ============================================================
const { db, getConfig } = require('../db/database');
const { DEFAULT_TEMPLATES, TEMPLATES_SEGMENTO, ROTULOS, interpolar } = require('./crm-templates');

// ---------- Guard de tenant ----------
// Transforma "esqueci de passar o tenant" em crash barulhento, em vez de
// vazamento silencioso de dados entre lojas.
function exigirTenant(tenantId) {
  const t = Number(tenantId);
  if (!Number.isInteger(t) || t <= 0) {
    throw new Error('crm: tenantId obrigatorio — sem ele uma loja le os dados de outra');
  }
  return t;
}

// ---------- Helpers ----------
function cfgNum(tenantId, chave, fallback) {
  const v = getConfig(chave, null, tenantId);
  const n = v !== null ? parseFloat(v) : NaN;
  return Number.isFinite(n) ? n : fallback;
}
function apelido(nome) { return (nome || '').trim().split(/\s+/)[0] || 'cliente'; }
function soDigitos(t) { return String(t || '').replace(/\D/g, ''); }
function lojaNome(tenantId) { return getConfig('loja_nome', 'nossa loja', exigirTenant(tenantId)); }
function clubeNome(tenantId) { return getConfig('clube_nome', 'Clube de Fidelidade', exigirTenant(tenantId)); }
function clubeAtivo(tenantId) { return getConfig('clube_ativo', '1', exigirTenant(tenantId)) === '1'; }

// Instagram: prefere a URL configurada; senao monta a partir do @
function lojaInsta(tenantId) { return getConfig('loja_instagram', '', exigirTenant(tenantId)); }
function lojaInstaUrl(tenantId) {
  const t = exigirTenant(tenantId);
  const url = getConfig('loja_instagram_url', '', t);
  if (url) return url;
  const handle = (getConfig('loja_instagram', '', t) || '').replace(/[@\s]/g, '');
  return handle ? `https://instagram.com/${handle}` : '';
}

// dias entre duas datas YYYY-MM-DD (a - b, em dias inteiros)
function diasEntre(aStr, bStr) {
  const a = new Date(aStr + 'T00:00:00'), b = new Date(bStr + 'T00:00:00');
  return Math.round((a - b) / 86400000);
}

// URL do WhatsApp com a mensagem pronta. Telefone sem DDI ganha o 55.
function urlWhatsApp(telefone, mensagem) {
  const tel = soDigitos(telefone);
  if (!tel) return null;
  const full = tel.length <= 11 ? '55' + tel : tel;
  return `https://wa.me/${full}?text=${encodeURIComponent(mensagem || '')}`;
}

// ---------- Clube de fidelidade ----------
function clubeCfg(tenantId) {
  const t = exigirTenant(tenantId);
  return {
    valorSelo: cfgNum(t, 'clube_valor_selo', 50),
    totalSelos: cfgNum(t, 'clube_total_selos', 10),
    valorPremio: cfgNum(t, 'clube_valor_premio', 50),
    validadeDias: cfgNum(t, 'clube_vale_validade_dias', 30),
    minCompra: cfgNum(t, 'clube_vale_min_compra', 100),
    nome: clubeNome(t),
  };
}

// Selos de um cliente. Nao ha tabela de pontos: o saldo e' DERIVADO do quanto ela
// gastou. `gasto_sem_selo` desconta o que foi pago com vale do proprio clube —
// sem isso o premio geraria selo, e o clube financiaria a si mesmo.
function selosDe(tenantId, cliente) {
  const t = exigirTenant(tenantId);
  const c = clubeCfg(t);
  const ativo = clubeAtivo(t);
  const gastoElegivel = Math.max(0, (cliente.total_gasto || 0) - (cliente.gasto_sem_selo || 0));
  // valorSelo = 0 faria Math.floor(x/0) = Infinity (premio infinito). Guarda seca.
  const selos = c.valorSelo > 0 ? Math.floor(gastoElegivel / c.valorSelo) : 0;
  const noCiclo = c.totalSelos > 0 ? (selos % c.totalSelos) : selos;
  const premiosGanhos = c.totalSelos > 0 ? Math.floor(selos / c.totalSelos) : 0;
  const faltam = c.totalSelos > 0 ? (c.totalSelos - noCiclo) : 0;
  return { ativo, selos, noCiclo, faltam, premiosGanhos, ...c };
}

// ---------- Templates (override da loja > default do codigo) ----------
// Sem seed: loja que nunca editou nao tem linha em crm_templates e usa o default.
// `ativo = 0` e' como a lojista desliga um gatilho ("nao quero pedir avaliacao").
function templateDe(tenantId, tipo) {
  const t = exigirTenant(tenantId);
  const base = DEFAULT_TEMPLATES[tipo];
  if (!base) return null;
  let row = null;
  try {
    row = db.prepare('SELECT texto, cupom, cupom_pct, cupom_dias, ativo FROM crm_templates WHERE tenant_id = ? AND tipo = ?').get(t, tipo);
  } catch (e) { row = null; }   // tabela ainda nao migrada: cai no default
  if (!row) return { ...base, ativo: 1 };
  if (!row.ativo) return null;  // desligado por esta loja
  // Override PARCIAL: campo que a loja nao preencheu continua vindo do default.
  const merged = { ...base };
  for (const k of ['texto', 'cupom', 'cupom_pct', 'cupom_dias']) {
    if (row[k] !== null && row[k] !== undefined && row[k] !== '') merged[k] = row[k];
  }
  return merged;
}

// Monta o contexto de interpolacao de um cliente (o que {chave} pode virar).
function varsDe(tenantId, cli, extras = {}) {
  const t = exigirTenant(tenantId);
  const c = clubeCfg(t);
  const s = selosDe(t, cli);
  return {
    nome: apelido(cli.nome),
    loja: lojaNome(t),
    clube: c.nome,
    instagram: lojaInsta(t),
    instagram_url: lojaInstaUrl(t),
    google_review: getConfig('loja_google_review', '', t),
    valor_selo: c.valorSelo,
    total_selos: c.totalSelos,
    valor_premio: c.valorPremio,
    selos: s.noCiclo,
    faltam: s.faltam,
    ...extras,
  };
}

// Renderiza um template do tipo pedido pra um cliente. null = tipo desligado.
//
// SOBRE O CUPOM: `tpl.cupom` e' o PREFIXO da campanha ('VOLTE20'), nao o codigo que
// a cliente usa. O codigo real e' NOMINAL ('VOLTE20-K3P9', so dela) e e' emitido pelo
// scheduler, que o passa aqui em `extras.cupom` — sobrescrevendo o prefixo na hora de
// interpolar. Sem `extras.cupom`, cai no prefixo (usado so em preview).
//
// Devolve tambem os metadados do cupom (prefixo/pct/dias) pra quem for EMITIR saber
// o que emitir — sem precisar reabrir o template.
function mensagemDe(tenantId, tipo, cli, extras = {}) {
  const tpl = templateDe(tenantId, tipo);
  if (!tpl) return null;
  const vars = varsDe(tenantId, cli, {
    cupom: tpl.cupom || '', cupom_pct: tpl.cupom_pct || '', cupom_dias: tpl.cupom_dias || '',
    ...extras,
  });
  return {
    texto: interpolar(tpl.texto, vars),
    cupom: extras.cupom || tpl.cupom || null,
    cupom_prefixo: tpl.cupom || null,
    cupom_pct: tpl.cupom_pct || null,
    cupom_dias: tpl.cupom_dias || null,
  };
}

// ============================================================
// ACOES DO DIA — quem contatar hoje, e o que dizer.
//
// GERADOR PURO: devolve as candidatas do dia. Nao deduplica e nao grava — quem
// materializa em crm_acoes (e portanto decide o que ja foi enviado) e' o
// lib/relacionamento-scheduler.js. Separar geracao de leitura e' o que da' snooze,
// historico e badge de pendentes de graca.
// ============================================================
function acoesDoDia(tenantId, hoje, opc = {}) {
  const t = exigirTenant(tenantId);
  const ativo = clubeAtivo(t);
  const c = clubeCfg(t);

  // A regua nao contata quem foi arquivado nem quem pediu "nao perturbe" (LGPD).
  // O `AND tenant_id = ?` e' o que impede uma loja de varrer a base de outra.
  // FORA DA FILA DIARIA (migration 040):
  //   'balcao'    = o "Consumidor nao identificado". Nao e' pessoa, nao tem telefone,
  //                 nao se contata. Sem este filtro ele viraria a cliente mais assidua
  //                 da loja e apareceria na fila todo dia.
  //   'importado' = base migrada com historico agregado. `ultima_compra` e' a ultima
  //                 venda no sistema ANTIGO, entao a regua diria "28 dias sem comprar"
  //                 pra quem sumiu ha um ano — mensagem errada, no tom errado, pra
  //                 muita gente. Essa base sai por CAMPANHA de reencontro, nao pela
  //                 regua. (Ela continua no RFM e nos segmentos: o valor dela e' real.)
  const clientes = db.prepare(
    `SELECT * FROM clientes
     WHERE tenant_id = ? AND arquivado = 0 AND nao_perturbe = 0
       AND (tipo IS NULL OR tipo NOT IN ('balcao', 'importado'))`
  ).all(t);

  const acoes = [];
  // Cliente sem telefone nao tem como ser contatada: nao entra na fila.
  const add = (a) => { if (a && a.telefone && a.mensagem) acoes.push(a); };

  // Monta uma acao ja com a mensagem renderizada. Se o tipo estiver desligado
  // pela loja, mensagemDe devolve null e o add ignora.
  //
  // O CUPOM NOMINAL: quem chama pode passar `opc.emitirCupom(cli, tipo, {prefixo,
  // pct, dias})` — uma funcao que cria o codigo exclusivo da cliente e devolve
  // {id, codigo}. So o SCHEDULER passa (ele e' quem grava). Sem ela, esta funcao
  // continua PURA: nao emite nada, nao escreve no banco, e a mensagem sai com o
  // prefixo da campanha (util pra preview, inutil pro caixa).
  const montar = (cli, tipo, prioridade, detalhe, extras = {}, meta = {}) => {
    const previa = mensagemDe(t, tipo, cli, extras);
    if (!previa) return null;   // tipo desligado por esta loja

    let cupom = previa.cupom, cupomId = null, cupomValidade = null;
    let m = previa;

    // Este tipo tem cupom E quem chamou sabe emitir? Entao o codigo nasce agora, e a
    // mensagem e' re-renderizada COM ele — nunca com o prefixo cru.
    if (previa.cupom_prefixo && previa.cupom_pct > 0 && typeof opc.emitirCupom === 'function') {
      const c = opc.emitirCupom(cli, tipo, {
        prefixo: previa.cupom_prefixo, pct: previa.cupom_pct, dias: previa.cupom_dias,
      });
      if (c) {
        cupom = c.codigo; cupomId = c.id; cupomValidade = c.validade;
        m = mensagemDe(t, tipo, cli, {
          ...extras,
          cupom: c.codigo,
          cupom_validade: c.validade ? c.validade.slice(8, 10) + '/' + c.validade.slice(5, 7) : '',
        });
      }
    }

    return {
      cliente_id: cli.id, nome: cli.nome, telefone: cli.telefone,
      tipo, prioridade, detalhe,
      label: (ROTULOS[tipo] || {}).label || tipo,
      mensagem: m.texto,
      cupom, cupom_id: cupomId, cupom_validade: cupomValidade,
      cupom_pct: previa.cupom_pct || null,
      ...meta,
    };
  };

  // DD/MM de hoje e de +3 dias (aniversario e' guardado sem ano)
  const d = new Date(hoje + 'T12:00:00');
  const ddmm = (dt) => String(dt.getDate()).padStart(2, '0') + '/' + String(dt.getMonth() + 1).padStart(2, '0');
  const hojeDDMM = ddmm(d);
  const mais3 = new Date(d); mais3.setDate(d.getDate() + 3);
  const mais3DDMM = ddmm(mais3);

  for (const cli of clientes) {
    // --- Aniversario (hoje) e pre-aniversario (+3 dias) ---
    if (cli.aniversario === hojeDDMM) {
      add(montar(cli, 'ANIVERSARIO', 1, 'Faz aniversário hoje!'));
    } else if (cli.aniversario === mais3DDMM) {
      add(montar(cli, 'PRE_ANIV', 1, `Aniversário em 3 dias (${cli.aniversario})`));
    }

    if (!cli.ultima_compra) continue;

    const dias = diasEntre(hoje, cli.ultima_compra);
    const s = selosDe(t, cli);
    const rfm = rfmDoCliente(cli, hoje);
    const meta = { segmento: rfm.segmento };
    // Quem comprou ha pouco nao leva mensagem de "sentimos sua falta".
    const ehRecente = SEG_RECENTE.includes(rfm.segmento);

    if (dias === 0) {
      // Comprou hoje: boas-vindas + a mensagem certa do clube
      add(montar(cli, 'DIA1', 1, 'Comprou hoje', {}, meta));
      if (ativo) {
        if (s.noCiclo === 0 && s.premiosGanhos > 0) {
          add(montar(cli, 'CLUBE_OK', 1, `Completou ${c.totalSelos} selos!`, {}, meta));
        } else if (cli.num_compras === 1) {
          add(montar(cli, 'CLUBE_BV', 2, 'Primeira compra', {}, meta));
        } else {
          add(montar(cli, 'CLUBE_PROG', 3, `${s.noCiclo} selos • faltam ${s.faltam}`, {}, meta));
        }
      }
    }
    // Os gatilhos de dia EXATO (3, 5, 10) so funcionam porque o scheduler roda
    // todo dia e materializa. Sem ele, um dia sem abrir a tela perdia o gatilho.
    else if (dias === 3)  add(montar(cli, 'POS_VENDA_1', 2, 'Comprou há 3 dias', { dias }, meta));
    else if (dias === 5)  add(montar(cli, 'GOOGLE',      2, 'Comprou há 5 dias', { dias }, meta));
    else if (dias === 10) add(montar(cli, 'POS_VENDA_2', 3, 'Comprou há 10 dias', { dias }, meta));
    // Convite de recompra (~dia 20): tampa o vazio entre o dia 10 e o dia 30. Sem cupom.
    else if (dias >= 18 && dias <= 22) add(montar(cli, 'RECOMPRA', 3, `${dias} dias da última compra`, { dias }, meta));
    // Reativacao em 3 ondas, com cupom crescente. A RFM tempera a prioridade:
    // quem "esta em risco" (era boa cliente e sumiu) sobe na fila.
    else if (dias >= 28 && dias <= 32) {
      add(montar(cli, 'REAT_1', ehRecente ? 6 : 4, `${dias} dias sem comprar`, { dias }, meta));
    } else if (dias >= 58 && dias <= 62) {
      const risco = rfm.segmento === 'risco';
      add(montar(cli, 'REAT_2', risco ? 2 : 4, `${dias} dias sem comprar${risco ? ' • EM RISCO ⚠️' : ''}`, { dias }, meta));
    } else if (dias >= 88 && dias <= 92) {
      const perdida = rfm.segmento === 'perdidas';
      add(montar(cli, 'REAT_3', perdida ? 2 : 4, `${dias} dias sem comprar${perdida ? ' • alto valor 💔' : ''}`, { dias }, meta));
    }

    // Selos parados: cartao quase cheio e a cliente sumiu. Fora do else-if de
    // proposito — acumula com a reativacao, porque e' o gancho mais forte que existe.
    if (ativo && s.faltam > 0 && s.faltam <= 3 && dias >= 20 && dias < 88) {
      add(montar(cli, 'SELOS_PARADOS', 2, `${s.noCiclo}/${c.totalSelos} selos • parou há ${dias}d`, { dias }, meta));
    }
  }

  // --- Datas comerciais (Natal, Namorados...): disparam pra base inteira ---
  let datasCom = [];
  try { datasCom = JSON.parse(getConfig('datas_comerciais', '[]', t)); } catch (e) { datasCom = []; }
  for (const dc of datasCom) {
    if (!dc || !dc.data || !dc.mensagem) continue;
    // dc.data = 'MM-DD' (anual) ou 'YYYY-MM-DD'; dispara em (data - dias_antes)
    const alvo = dc.data.length === 5 ? `${hoje.slice(0, 4)}-${dc.data}` : dc.data;
    if (diasEntre(alvo, hoje) !== (dc.dias_antes || 0)) continue;
    for (const cli of clientes) {
      if (!cli.telefone) continue;
      acoes.push({
        cliente_id: cli.id, nome: cli.nome, telefone: cli.telefone,
        tipo: 'DATA_COMERCIAL', prioridade: 2,
        label: `📅 ${dc.nome || 'Data comercial'}`,
        detalhe: dc.dias_antes ? `Faltam ${dc.dias_antes} dias` : 'É hoje!',
        mensagem: interpolar(dc.mensagem, varsDe(t, cli)), cupom: null,
      });
    }
  }

  // --- Lancamento de colecao (opcional, disparado pela lojista) ---
  if (opc.lancamento && opc.dataLanc) {
    const dl = diasEntre(hoje, opc.dataLanc);
    const tipo = dl === 0 ? 'LANC_1' : dl === 2 ? 'LANC_2' : dl === 5 ? 'LANC_3' : null;
    if (tipo) {
      for (const cli of clientes) {
        add(montar(cli, tipo, 2, opc.lancamento, { produto: opc.lancamento }));
      }
    }
  }

  acoes.sort((a, b) => a.prioridade - b.prioridade);
  return acoes;
}

// ============================================================
// MATRIZ RFM — segmenta a base por Recencia, Frequencia e valor Monetario.
// ============================================================
// Notas por faixa fixa, nao por quartil: com base pequena (o caso de toda loja
// que esta comecando) quartil da' segmento instavel — a mesma cliente pula de
// grupo porque OUTRA comprou. Faixa fixa e' estavel e explicavel pra lojista.
// Calibrado pra moda feminina: ciclo de recompra ~30-45 dias, 60d ja e' alerta.
function notaR(dias) { if (dias <= 20) return 5; if (dias <= 40) return 4; if (dias < 60) return 3; if (dias < 90) return 2; return 1; }
function notaF(n)    { if (n >= 8) return 5; if (n >= 5) return 4; if (n >= 3) return 3; if (n >= 2) return 2; return 1; }
function notaM(v)    { if (v >= 2000) return 5; if (v >= 1000) return 4; if (v >= 500) return 3; if (v >= 200) return 2; return 1; }

// Recencia MANDA: quem sumiu vira risco/perdida mesmo tendo sido boa cliente —
// e' justamente essa a lista que a lojista precisa pra campanha de reativacao.
function segmentoDe(R, F, M) {
  const FM = (F + M) / 2;                    // "forca" da cliente
  if (R <= 1) return FM >= 2.5 ? 'perdidas' : 'hibernando';
  if (R === 2) return FM >= 3   ? 'risco'    : 'atencao';
  if (R === 3) return FM >= 3.5 ? 'fieis'    : 'atencao';
  if (FM >= 4) return 'campeas';             // recente + forte = VIP
  if (F >= 3)  return 'fieis';
  if (F <= 1)  return 'novas';
  return 'promissoras';
}

function rfmDoCliente(cli, hoje) {
  const dias = cli.ultima_compra ? diasEntre(hoje, cli.ultima_compra) : 999;
  const R = notaR(dias), F = notaF(cli.num_compras || 0), Mn = notaM(cli.total_gasto || 0);
  return { dias, R, F, M: Mn, rfm: `${R}${F}${Mn}`, segmento: segmentoDe(R, F, Mn) };
}

// Segmentos "quentes" — nao devem receber mensagem de reativacao.
const SEG_RECENTE = ['campeas', 'fieis', 'novas', 'promissoras'];

const SEGMENTOS = {
  campeas:     { nome: '🏆 Campeãs', cor: '#C9A24B', desc: 'Compram muito, recente e gastam bem. Suas VIPs.' },
  fieis:       { nome: '🤍 Fiéis', cor: '#6B5849', desc: 'Compram com frequência. A base da loja.' },
  novas:       { nome: '🌱 Novas', cor: '#2E7D32', desc: 'Compraram há pouco, ainda conhecendo a loja.' },
  promissoras: { nome: '✨ Promissoras', cor: '#1565C0', desc: 'Recentes, com potencial de virar fiéis.' },
  atencao:     { nome: '👀 Precisam de atenção', cor: '#F9A825', desc: 'Começando a espaçar. Reaproximar.' },
  risco:       { nome: '⚠️ Em risco', cor: '#E67E22', desc: 'Gastavam bem mas sumiram. Reativar com cupom.' },
  perdidas:    { nome: '💔 Perdidas', cor: '#C0392B', desc: 'Sumiram faz tempo. Última tentativa.' },
  hibernando:  { nome: '😴 Hibernando', cor: '#9E9E9E', desc: 'Baixo valor e inativas. Campanha leve.' },
};

// Mensagem sugerida pra campanha de um segmento. Segmento sem texto proprio
// reaproveita o template da regua que faz o mesmo trabalho.
const SEGMENTO_FALLBACK = { novas: 'POS_VENDA_2', atencao: 'RETORNO', risco: 'REAT_2' };

function campanhaSegmento(tenantId, seg, cli) {
  const t = exigirTenant(tenantId);
  const proprio = TEMPLATES_SEGMENTO[seg];
  if (proprio) return interpolar(proprio.texto, varsDe(t, cli));
  const m = mensagemDe(t, SEGMENTO_FALLBACK[seg] || 'RETORNO', cli);
  return m ? m.texto : interpolar(DEFAULT_TEMPLATES.RETORNO.texto, varsDe(t, cli));
}

function segmentarRFM(tenantId, hoje) {
  const t = exigirTenant(tenantId);
  // RFM ignora arquivados, mas MANTEM os "nao perturbe": aqui o envio e' decisao
  // manual da lojista, e ela precisa enxergar a base inteira pra entender o negocio.
  // (A tela marca quem e' "nao perturbe" e nao oferece o botao de WhatsApp.)
  // O 'balcao' sai: ele acumularia as vendas de toda a loja e viraria uma "campea"
  // fantasma com centenas de compras, distorcendo os segmentos e as medias.
  // O 'importado' FICA: o valor e a frequencia dele sao reais e dizem quanto aquela
  // base vale — e' exatamente o que a lojista precisa ver pra decidir a campanha de
  // reencontro. Ele so nao entra na FILA diaria (ver acoesDoDia).
  const clientes = db.prepare(
    `SELECT * FROM clientes
     WHERE tenant_id = ? AND num_compras > 0 AND arquivado = 0
       AND (tipo IS NULL OR tipo != 'balcao')`
  ).all(t);

  const itens = clientes.map((cli) => {
    const r = rfmDoCliente(cli, hoje);
    const mensagem = campanhaSegmento(t, r.segmento, cli);
    return {
      id: cli.id, nome: cli.nome, telefone: cli.telefone, origem: cli.origem || null,
      nao_perturbe: !!cli.nao_perturbe,
      ultima_compra: cli.ultima_compra, dias_sem_comprar: r.dias,
      num_compras: cli.num_compras || 0, total_gasto: +(cli.total_gasto || 0).toFixed(2),
      R: r.R, F: r.F, M: r.M, rfm: r.rfm,
      segmento: r.segmento,
      segmento_nome: SEGMENTOS[r.segmento].nome,
      segmento_cor: SEGMENTOS[r.segmento].cor,
      mensagem,
      wa_url: cli.nao_perturbe ? null : urlWhatsApp(cli.telefone, mensagem),
    };
  });

  const resumo = Object.keys(SEGMENTOS).map((seg) => {
    const list = itens.filter((i) => i.segmento === seg);
    return {
      segmento: seg, ...SEGMENTOS[seg],
      n: list.length,
      valor: +list.reduce((s, i) => s + i.total_gasto, 0).toFixed(2),
    };
  });

  return { resumo, clientes: itens, total_clientes: itens.length };
}

// ============================================================
// RECONCILIACAO DA REGUA COM A REALIDADE
//
// A regua materializa as acoes numa tabela (crm_acoes) e as congela: a mensagem, o
// "dias sem comprar" e o motivo nascem no dia da geracao e ficam parados esperando.
// Isso e' o que faz o gatilho de dia exato nao se perder — mas cria dois furos se
// nada reconciliar a linha parada com o que aconteceu DEPOIS:
//
//   1. A cliente COMPRA. A acao "sentimos sua falta, 28 dias sem comprar" continua
//      pendente e aparece na fila — falando de uma ausencia que ja acabou.
//   2. A janela do gatilho tem largura (REAT_1 e' 28..32 dias). Como o UNIQUE de
//      crm_acoes inclui a `data`, cada dia dentro da janela cria UMA nova linha do
//      mesmo tipo pro mesmo cliente — a cliente se repete na tela.
//
// Os TIPOS que "falam de ausencia" sao os unicos que uma nova compra torna sem
// sentido. Pos-venda/aniversario/datas comerciais NAO entram: uma compra nao
// invalida "parabens pelo aniversario".
const TIPOS_DE_AUSENCIA = ['RECOMPRA', 'REAT_1', 'REAT_2', 'REAT_3', 'SELOS_PARADOS'];

// Ja existe uma acao ATIVA (pendente ou adiada) deste tipo pra este cliente, em
// QUALQUER data? Usada pelo gerador pra nao materializar a mesma reativacao de novo
// enquanto a anterior nao foi resolvida — e' isto que impede a multiplicacao dentro
// da janela do gatilho. (De proposito ignora a `data`: o UNIQUE ja cobre "mesmo dia".)
function existeAcaoAtiva(tenantId, clienteId, tipo) {
  const t = exigirTenant(tenantId);
  return !!db.prepare(
    `SELECT 1 FROM crm_acoes
     WHERE tenant_id = ? AND cliente_id = ? AND tipo = ? AND status IN ('pendente','adiada')
     LIMIT 1`
  ).get(t, clienteId, tipo);
}

// A cliente comprou: as acoes de AUSENCIA dela perderam o motivo. Marca como
// 'obsoleta' (nao apaga — o historico da regua continua auditavel, e 'obsoleta' e'
// distinto de 'enviada'/'ignorada': ninguem contatou, a compra e' que resolveu).
// Chamada DENTRO da transacao da venda (routes/vendas.js), logo apos atualizar o
// cliente. Idempotente e barata (indice em tenant_id, cliente_id).
function obsoletarAcoesDeAusencia(tenantId, clienteId) {
  const t = exigirTenant(tenantId);
  const placeholders = TIPOS_DE_AUSENCIA.map(() => '?').join(',');
  const r = db.prepare(
    `UPDATE crm_acoes
     SET status = 'obsoleta', resolvido_em = datetime('now','localtime')
     WHERE tenant_id = ? AND cliente_id = ?
       AND status IN ('pendente','adiada')
       AND tipo IN (${placeholders})`
  ).run(t, clienteId, ...TIPOS_DE_AUSENCIA);
  return r.changes;
}

// ============================================================
// CONSUMIDOR NAO IDENTIFICADO — o cliente de balcao
//
// Antes disto, venda sem cliente gravava cliente_id NULL. O efeito colateral era
// perder a distincao entre os dois casos que geram esse NULL:
//
//   "a atendente esqueceu"  (recuperavel: da' pra vincular depois)
//   "a cliente nao quis"    (legitimo: nao ha o que recuperar)
//
// Com um registro proprio, os dois viram dados diferentes — e a loja passa a saber
// quanto do faturamento esta fora do CRM, em vez de so intuir.
//
// Ele NAO e' pessoa: nasce sem telefone (a regua ja descarta quem nao tem) e com
// tipo='balcao', que o tira da regua E do RFM.
const NOME_BALCAO = 'Consumidor não identificado';

function clienteBalcao(tenantId) {
  const t = exigirTenant(tenantId);
  const achado = db.prepare(
    `SELECT id, nome FROM clientes WHERE tenant_id = ? AND tipo = 'balcao' LIMIT 1`
  ).get(t);
  if (achado) return achado;

  // Nasce sob demanda: loja que nunca fechou venda anonima nao ganha registro inutil.
  const info = db.prepare(
    `INSERT INTO clientes (tenant_id, nome, telefone, origem, tipo, total_gasto, num_compras, arquivado, nao_perturbe)
     VALUES (?, ?, NULL, 'Balcão', 'balcao', 0, 0, 0, 1)`
  ).run(t, NOME_BALCAO);
  return { id: Number(info.lastInsertRowid), nome: NOME_BALCAO };
}

module.exports = {
  NOME_BALCAO, clienteBalcao,
  exigirTenant, apelido, soDigitos, diasEntre, urlWhatsApp,
  clubeCfg, clubeAtivo, clubeNome, selosDe, lojaNome,
  templateDe, mensagemDe, varsDe,
  acoesDoDia, segmentarRFM, campanhaSegmento, rfmDoCliente,
  SEGMENTOS, SEG_RECENTE,
  TIPOS_DE_AUSENCIA, existeAcaoAtiva, obsoletarAcoesDeAusencia,
};
