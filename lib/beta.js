// ============================================================
// BETA DE PROSPECÇÃO — Growth completo por 30 dias, em vez dos 14 padrão.
//
// Duas portas de entrada, UMA regra (esta lib). Se a regra morasse em cada porta,
// elas divergiriam no primeiro ajuste de prazo:
//
//   1. LINK DE CONVITE (o caminho principal): o Igor manda
//      easygestao.com/registro.html?beta=BETA30 na prospecção. Quem se cadastra por
//      ele já NASCE com 30 dias, sem ninguém tocar no backoffice.
//
//   2. BACKOFFICE (a rede de segurança): a lojista que se cadastrou sozinha, sem o
//      link, é convertida à mão pelo admin. Serve pra quem esqueceu o link, achou
//      a landing pelo Google, ou entrou antes da campanha existir.
//
// ⚠️ POR QUE O LIMITE DE 20 É TRAVADO AQUI, mas NÃO no backoffice:
// o link é público e copiável — uma cliente posta no grupo de lojistas e vira
// desconto geral. O teto é o que impede o vazamento de custar vaga infinita. No
// backoffice quem decide é o Igor, na conversa, e travar ali viraria estorvo no dia
// em que ele quiser abrir uma vaga a mais pra uma loja boa.
// ============================================================
const { db } = require('../db/database');

// O código do link. Compartilhado (um só pra toda a prospecção) em vez de um por
// lojista: um link só é o que cabe numa conversa de WhatsApp, e o teto de vagas já
// limita o dano do vazamento. Pra virar um-por-indicação, este é o ponto de troca.
const BETA_CODIGO = 'BETA30';

// 30 dias em vez dos 14 padrão (routes/auth.js). É o que o Igor promete na conversa.
const BETA_DIAS = 30;

// As 20 vagas da campanha. No LINK isto é uma trava real (ver o aviso acima).
const BETA_VAGAS = 20;

// Normaliza o que veio da URL: a lojista pode digitar em minúscula, colar com
// espaço, ou o WhatsApp pode grudar pontuação no fim do link.
function normalizarCodigo(bruto) {
  return String(bruto || '').trim().toUpperCase().replace(/[^A-Z0-9]/g, '');
}

// Quantas vagas já foram usadas. Conta por `assinaturas.beta = 1` (migration 051) —
// a marca explícita. Inferir por duração ("fim - início > 14") confundiria um beta
// com um trial que o suporte esticou, e a contagem mentiria.
function vagasUsadas() {
  return db.prepare('SELECT COUNT(*) AS n FROM assinaturas WHERE beta = 1').get().n;
}

function placarVagas() {
  const usadas = vagasUsadas();
  return { vagas: BETA_VAGAS, usadas, restantes: Math.max(0, BETA_VAGAS - usadas), dias: BETA_DIAS };
}

// O código confere E ainda há vaga? Usado pelo signup (decide o prazo do trial) e
// pela página de registro (decide se mostra a faixa "você foi convidado").
//
// Devolve o MOTIVO da recusa, não só um booleano: "as 20 vagas acabaram" e "esse
// código não existe" pedem respostas diferentes na tela — a primeira é uma notícia
// (chegou tarde), a segunda é um erro de digitação.
function validarConvite(codigoBruto) {
  const codigo = normalizarCodigo(codigoBruto);
  if (!codigo) return { valido: false, motivo: 'ausente' };
  if (codigo !== BETA_CODIGO) return { valido: false, motivo: 'invalido' };

  const placar = placarVagas();
  if (placar.restantes <= 0) return { valido: false, motivo: 'esgotado', ...placar };

  return { valido: true, dias: BETA_DIAS, ...placar };
}

// Quantos dias de trial esta conta nasce tendo, e se ela é beta.
//
// Isto é chamado DENTRO da transação do signup. Não lança nem devolve erro de
// propósito: convite inválido, vago esgotado ou ausente cai no trial normal de 14
// dias. Recusar o cadastro porque o código venceu perderia um cliente real por um
// detalhe de campanha — ele quer entrar, o benefício é que não se aplica.
function planoDeEntrada(codigoBruto, diasPadrao = 14) {
  const r = validarConvite(codigoBruto);
  return r.valido
    ? { dias: BETA_DIAS, beta: 1, motivo: 'convite' }
    : { dias: diasPadrao, beta: 0, motivo: r.motivo };
}

module.exports = {
  BETA_CODIGO, BETA_DIAS, BETA_VAGAS,
  normalizarCodigo, vagasUsadas, placarVagas, validarConvite, planoDeEntrada,
};
