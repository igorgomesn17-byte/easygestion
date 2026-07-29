// ============================================================
// CONVERSAS — onde a mensagem vira card na tela de quem atende.
// ------------------------------------------------------------
// As tabelas `conversas` e `mensagens` sobreviveram ao Inbox removido em 2026, e
// foram bem desenhadas: ja preveem estagio de kanban, janela de 24h, dedup por
// external_id e a distincao entre recebida / enviada / nota interna. Este arquivo
// e' o motor que faltava.
//
// A regra que organiza tudo: TODA mensagem que chega precisa virar card. Quem
// escreve e cai no vazio e' contato que o marketing pagou pra conseguir.
// ============================================================
const { db } = require('../db/database');
const { normalizarTelefone, soDigitos } = require('./whatsapp');

// Janela de 24h: depois da ultima mensagem DELA, o WhatsApp oficial exige template
// aprovado pra reabrir a conversa. A Evolution nao impoe isso hoje, mas o campo e'
// gravado igual — quando o canal virar oficial, a regra ja esta medida, e o painel
// pode avisar "fora da janela" em vez de a lojista descobrir com erro de envio.
const JANELA_HORAS = 24;

function exigirTenant(tenantId) {
  const t = Number(tenantId);
  if (!t) throw new Error('conversas: tenantId obrigatorio');
  return t;
}

// ------------------------------------------------------------
// Quem e' que esta falando
// ------------------------------------------------------------
// Casa o telefone que chegou com a base de clientes. Compara pelos 8 digitos
// finais porque o mesmo numero chega em formatos diferentes (com/sem 55, com/sem
// o nono digito) — e uma comparacao exata partiria o historico da cliente em
// duas pessoas.
//
// Nao usa LIKE '%...' com indice porque o volume aqui e' pequeno (clientes de UMA
// loja) e a corretude importa mais: o sufixo de 8 digitos e' o que sobrevive a
// todas as variacoes.
function clientePorTelefone(tenantId, telefone) {
  const t = exigirTenant(tenantId);
  const alvo = soDigitos(telefone).slice(-8);
  if (alvo.length < 8) return null;

  return db.prepare(
    `SELECT id, nome, telefone, tipo, total_gasto, num_compras, ultima_compra
       FROM clientes
      WHERE tenant_id = ? AND arquivado = 0
        AND replace(replace(replace(replace(telefone,' ',''),'-',''),'(',''),')','') LIKE ?
      ORDER BY num_compras DESC, id ASC
      LIMIT 1`
  ).get(t, '%' + alvo);
}

// ------------------------------------------------------------
// A conversa
// ------------------------------------------------------------
// Acha a conversa aberta deste telefone, ou cria uma. O telefone e' a chave, nao o
// cliente_id: quem escreve pela primeira vez ainda nao e' cliente nenhum.
function acharOuCriarConversa(tenantId, { telefone, nome = null, origem = null, canal = 'whatsapp' }) {
  const t = exigirTenant(tenantId);
  const tel = normalizarTelefone(telefone);
  if (!tel) return null;
  const sufixo = tel.slice(-8);

  const existente = db.prepare(
    `SELECT * FROM conversas
      WHERE tenant_id = ? AND arquivada = 0
        AND replace(replace(replace(telefone,' ',''),'-',''),'+','') LIKE ?
      ORDER BY ultima_interacao DESC
      LIMIT 1`
  ).get(t, '%' + sufixo);

  if (existente) return existente;

  // Conversa nova: tenta amarrar numa cliente que ja existe. Se achar, o card ja
  // nasce com o historico dela do lado — que e' o que muda o tom do atendimento.
  const cli = clientePorTelefone(t, tel);

  const r = db.prepare(`
    INSERT INTO conversas (tenant_id, cliente_id, canal, telefone, contato_nome, estagio, origem, ultima_interacao)
    VALUES (?, ?, ?, ?, ?, ?, ?, datetime('now','localtime'))
  `).run(
    t,
    cli ? cli.id : null,
    canal,
    tel,
    nome || (cli ? cli.nome : null),
    // Quem JA e' cliente nao entra no funil de prospeccao — ela ja comprou, o
    // trabalho com ela e' de recompra (Comercial 2), nao de primeira venda.
    cli ? 'comprou' : 'novo',
    origem || null,
  );

  return db.prepare('SELECT * FROM conversas WHERE id = ?').get(Number(r.lastInsertRowid));
}

// ------------------------------------------------------------
// Registrar mensagem
// ------------------------------------------------------------
// IDEMPOTENTE POR external_id. O provedor reenvia o mesmo webhook quando nao
// recebe 200 rapido o bastante — sem esta guarda, a mesma frase da cliente apareceria
// duas vezes na tela, e a segunda ainda reabriria a janela de 24h errada.
//
// A coluna ja e' UNIQUE no schema; o INSERT OR IGNORE transforma a corrida em
// no-op em vez de excecao.
function registrarRecebida(tenantId, { conversaId, externalId, texto, tipo = 'text' }) {
  const t = exigirTenant(tenantId);

  if (externalId) {
    const jaTem = db.prepare('SELECT 1 FROM mensagens WHERE external_id = ?').get(externalId);
    if (jaTem) return { duplicada: true };
  }

  const r = db.prepare(`
    INSERT OR IGNORE INTO mensagens (tenant_id, conversa_id, direcao, external_id, tipo, texto, status)
    VALUES (?, ?, 'recebida', ?, ?, ?, 'recebida')
  `).run(t, conversaId, externalId || null, tipo, texto || null);

  if (!r.changes) return { duplicada: true };

  // A janela de 24h conta a partir da ULTIMA mensagem dela — e' a mensagem da
  // cliente que reabre o direito de responder livremente.
  db.prepare(`
    UPDATE conversas
       SET ultima_interacao = datetime('now','localtime'),
           janela_expira_em = datetime('now','localtime','+${JANELA_HORAS} hours'),
           arquivada = 0
     WHERE id = ? AND tenant_id = ?
  `).run(conversaId, t);

  return { duplicada: false, id: Number(r.lastInsertRowid) };
}

function registrarEnviada(tenantId, { conversaId, externalId, texto, usuarioId = null, tipo = 'text' }) {
  const t = exigirTenant(tenantId);

  const r = db.prepare(`
    INSERT OR IGNORE INTO mensagens (tenant_id, conversa_id, direcao, external_id, tipo, texto, status)
    VALUES (?, ?, 'enviada', ?, ?, ?, 'sent')
  `).run(t, conversaId, externalId || null, tipo, texto || null);

  // Enviar NAO reabre a janela (so a mensagem dela reabre) e nao mexe em
  // primeira_resposta_em se ja houver uma — a metrica e' do PRIMEIRO retorno.
  db.prepare(`
    UPDATE conversas
       SET ultima_interacao = datetime('now','localtime'),
           usuario_id = COALESCE(usuario_id, ?),
           primeira_resposta_em = COALESCE(primeira_resposta_em, datetime('now','localtime'))
     WHERE id = ? AND tenant_id = ?
  `).run(usuarioId, conversaId, t);

  return { id: Number(r.lastInsertRowid) };
}

// Nota interna: o que a lojista quer lembrar e a cliente nunca ve
// ("ela disse que volta depois do dia 20"). direcao='nota' ja existia no schema.
function registrarNota(tenantId, { conversaId, texto, usuarioId = null }) {
  const t = exigirTenant(tenantId);
  const r = db.prepare(`
    INSERT INTO mensagens (tenant_id, conversa_id, direcao, tipo, texto, status)
    VALUES (?, ?, 'nota', 'text', ?, 'recebida')
  `).run(t, conversaId, texto || null);
  db.prepare(`UPDATE conversas SET usuario_id = COALESCE(usuario_id, ?) WHERE id = ? AND tenant_id = ?`)
    .run(usuarioId, conversaId, t);
  return { id: Number(r.lastInsertRowid) };
}

// ------------------------------------------------------------
// Entrada: a mensagem que chegou
// ------------------------------------------------------------
// O caminho completo de quem escreve pra loja. Roda em TRANSACAO: conversa,
// mensagem e (quando for o caso) o prospect nascem juntos ou nao nascem — uma
// conversa sem a mensagem que a originou apareceria vazia na tela.
function receberMensagem(tenantId, msg) {
  const t = exigirTenant(tenantId);
  const tel = normalizarTelefone(msg.telefone);
  if (!tel) return { ok: false, erro: 'Telefone invalido' };

  // Checagem de duplicata ANTES da transacao: o caso mais comum e' justamente o
  // reenvio, e nao vale abrir transacao pra descobrir que nao ha nada a fazer.
  if (msg.externalId) {
    const jaTem = db.prepare('SELECT 1 FROM mensagens WHERE external_id = ?').get(msg.externalId);
    if (jaTem) return { ok: true, duplicada: true };
  }

  db.exec('BEGIN');
  try {
    const conversa = acharOuCriarConversa(t, {
      telefone: tel,
      nome: msg.nome,
      origem: msg.origem,
    });
    if (!conversa) { db.exec('ROLLBACK'); return { ok: false, erro: 'Nao foi possivel abrir a conversa' }; }

    // Audio/foto sem legenda chegam sem texto. Sem este rotulo o card apareceria
    // em branco na tela e o comercial passaria batido.
    const texto = msg.texto || (msg.temMidia ? `[${msg.tipo}]` : null);

    const r = registrarRecebida(t, {
      conversaId: conversa.id,
      externalId: msg.externalId,
      texto,
      tipo: msg.tipo || 'text',
    });
    if (r.duplicada) { db.exec('ROLLBACK'); return { ok: true, duplicada: true }; }

    // Numero que nao e' de ninguem vira PROSPECT — o contato dela E' o cadastro.
    // tipo='prospect' e' o que a mantem FORA da regua reativa: ela nunca comprou,
    // entao nao existe ausencia a lamentar, e "sentimos sua falta" pra quem nunca
    // veio queima o contato. Mesma logica que ja exclui 'balcao' e 'importado'.
    let clienteId = conversa.cliente_id;
    if (!clienteId && msg.nome) {
      const ins = db.prepare(`
        INSERT INTO clientes (tenant_id, nome, telefone, tipo, origem)
        VALUES (?, ?, ?, 'prospect', ?)
      `).run(t, String(msg.nome).slice(0, 120), tel, msg.origem || 'whatsapp');
      clienteId = Number(ins.lastInsertRowid);
      db.prepare('UPDATE conversas SET cliente_id = ? WHERE id = ? AND tenant_id = ?')
        .run(clienteId, conversa.id, t);
    }

    db.exec('COMMIT');
    return { ok: true, conversaId: conversa.id, clienteId, nova: !conversa.cliente_id };
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
}

// ------------------------------------------------------------
// Leitura pra tela
// ------------------------------------------------------------
function listarConversas(tenantId, { usuarioId = null, estagio = null, limite = 100 } = {}) {
  const t = exigirTenant(tenantId);
  const cond = ['c.tenant_id = ?', 'c.arquivada = 0'];
  const par = [t];
  if (usuarioId) { cond.push('c.usuario_id = ?'); par.push(usuarioId); }
  if (estagio)   { cond.push('c.estagio = ?');    par.push(estagio); }

  return db.prepare(`
    SELECT c.*, cl.nome AS cliente_nome, cl.total_gasto, cl.num_compras, cl.tipo AS cliente_tipo,
           u.nome AS dono_nome,
           (SELECT texto FROM mensagens m WHERE m.conversa_id = c.id ORDER BY m.id DESC LIMIT 1) AS ultima_msg,
           (SELECT direcao FROM mensagens m WHERE m.conversa_id = c.id ORDER BY m.id DESC LIMIT 1) AS ultima_direcao,
           -- "esperando resposta" = a ultima mensagem e' DELA. E' o unico jeito de
           -- saber que alguem ficou sem retorno sem ninguem marcar nada.
           (SELECT COUNT(*) FROM mensagens m WHERE m.conversa_id = c.id AND m.direcao = 'recebida') AS qtd_recebidas
      FROM conversas c
      LEFT JOIN clientes cl ON cl.id = c.cliente_id AND cl.tenant_id = c.tenant_id
      LEFT JOIN usuarios u  ON u.id = c.usuario_id  AND u.tenant_id = c.tenant_id
     WHERE ${cond.join(' AND ')}
     ORDER BY c.ultima_interacao DESC
     LIMIT ?
  `).all(...par, limite);
}

function mensagensDa(tenantId, conversaId, limite = 200) {
  const t = exigirTenant(tenantId);
  return db.prepare(`
    SELECT * FROM mensagens
     WHERE tenant_id = ? AND conversa_id = ?
     ORDER BY id ASC
     LIMIT ?
  `).all(t, conversaId, limite);
}

// Assumir a conversa. Idempotente e SEM roubo: quem ja tem dono continua com ele —
// e' isso que impede dois comerciais atenderem a mesma pessoa ao mesmo tempo.
// Devolve false quando ja era de outra pessoa, pra tela poder avisar.
function assumir(tenantId, conversaId, usuarioId) {
  const t = exigirTenant(tenantId);
  const r = db.prepare(`
    UPDATE conversas SET usuario_id = ?
     WHERE id = ? AND tenant_id = ? AND (usuario_id IS NULL OR usuario_id = ?)
  `).run(usuarioId, conversaId, t, usuarioId);
  return r.changes > 0;
}

function moverEstagio(tenantId, conversaId, estagio) {
  const t = exigirTenant(tenantId);
  const r = db.prepare(`
    UPDATE conversas SET estagio = ?, ultima_interacao = datetime('now','localtime')
     WHERE id = ? AND tenant_id = ?
  `).run(estagio, conversaId, t);
  return r.changes > 0;
}

module.exports = {
  clientePorTelefone, acharOuCriarConversa,
  registrarRecebida, registrarEnviada, registrarNota,
  receberMensagem, listarConversas, mensagensDa, assumir, moverEstagio,
  JANELA_HORAS,
};
