// ============================================================
// Lógica do INBOX — conversas unificadas (WhatsApp + Instagram).
//
// registrarEntrada() é o PONTO DE ENTRADA ÚNICO: chamado tanto pelo
// webhook da Meta (mensagem recebida) quanto pelo registro manual.
// Por isso "manual hoje, automático amanhã" é o mesmo código.
//
// Reaproveita o tom DS do lib/crm.js (mensagens prontas, dedup de tel).
// ============================================================
const { db, getConfig } = require('../db/database');
const { apelido, soDigitos, diasEntre, campanhaSegmento, M } = require('./crm');

// ---------- helpers ----------
function hojeLocal() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
function agoraLocal() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  return `${hojeLocal()} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}
// janela de 24h a partir de agora (quando a CLIENTE manda, reseta)
function janela24h() {
  const d = new Date(Date.now() + 24 * 3600 * 1000);
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}

// Acha cliente existente por telefone (mesma regra do leadVitrine: últimos 8 dígitos)
function acharClientePorTelefone(tel) {
  const d = soDigitos(tel);
  if (d.length < 8) return null;
  return db.prepare(
    "SELECT * FROM clientes WHERE REPLACE(REPLACE(REPLACE(REPLACE(telefone,'(',''),')',''),'-',''),' ','') LIKE ?"
  ).get('%' + d.slice(-8) + '%') || null;
}

// ============================================================
// registrarEntrada — cria/acha a conversa e grava a mensagem.
// Usado pelo webhook (direcao='recebida') e pelo registro manual.
// Idempotente: external_id UNIQUE evita duplicar reentrega de webhook.
// ============================================================
function registrarEntrada({ canal = 'whatsapp', external_contact_id = null, telefone = null,
                            nome = null, texto = '', direcao = 'nota', tipo = 'text',
                            external_id = null, media_id = null, status = null }) {
  const tx = db.transaction(() => {
    // dedup de mensagem (webhook pode reentregar)
    if (external_id) {
      const dup = db.prepare('SELECT id FROM mensagens WHERE external_id = ?').get(external_id);
      if (dup) return { duplicada: true, mensagem_id: dup.id };
    }

    // acha conversa aberta por contato externo (ou por telefone) no mesmo canal
    let conversa = null;
    if (external_contact_id) {
      conversa = db.prepare(
        'SELECT * FROM conversas WHERE canal = ? AND external_contact_id = ? AND arquivada = 0 ORDER BY id DESC LIMIT 1'
      ).get(canal, external_contact_id);
    }
    if (!conversa && telefone) {
      const d = soDigitos(telefone);
      if (d.length >= 8) {
        conversa = db.prepare(
          "SELECT * FROM conversas WHERE arquivada = 0 AND REPLACE(REPLACE(REPLACE(REPLACE(telefone,'(',''),')',''),'-',''),' ','') LIKE ? ORDER BY id DESC LIMIT 1"
        ).get('%' + d.slice(-8) + '%');
      }
    }

    // se não existe, cria — já tentando vincular a um cliente conhecido
    let criouConversa = false;
    if (!conversa) {
      const cli = telefone ? acharClientePorTelefone(telefone) : null;
      const info = db.prepare(`
        INSERT INTO conversas (cliente_id, canal, external_contact_id, contato_nome, telefone,
                               janela_expira_em, ultima_interacao, criado_em)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `).run(cli?.id || null, canal, external_contact_id,
             nome || cli?.nome || null, soDigitos(telefone) || null,
             direcao === 'recebida' ? janela24h() : null, agoraLocal(), agoraLocal());
      conversa = db.prepare('SELECT * FROM conversas WHERE id = ?').get(info.lastInsertRowid);
      criouConversa = true;
    }

    // grava a mensagem
    const msg = db.prepare(`
      INSERT INTO mensagens (conversa_id, direcao, external_id, tipo, texto, media_id, status, criado_em)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(conversa.id, direcao, external_id, tipo, texto || null, media_id || null,
           status || (direcao === 'recebida' ? 'recebida' : 'sent'), agoraLocal());

    // atualiza a conversa: última interação e, se a cliente mandou, reseta a janela
    if (direcao === 'recebida') {
      db.prepare('UPDATE conversas SET ultima_interacao = ?, janela_expira_em = ? WHERE id = ?')
        .run(agoraLocal(), janela24h(), conversa.id);
    } else {
      db.prepare('UPDATE conversas SET ultima_interacao = ? WHERE id = ?').run(agoraLocal(), conversa.id);
    }

    return { conversa_id: conversa.id, mensagem_id: msg.lastInsertRowid, criou_conversa: criouConversa };
  });
  return tx();
}

// ============================================================
// taxaCaptura — o placar do vazamento (meta: 11% → 70%).
// conversa "salva" = vinculada a um cliente do CRM.
// ============================================================
function taxaCaptura() {
  const tot = db.prepare('SELECT COUNT(*) n FROM conversas WHERE arquivada = 0').get().n;
  const salvos = db.prepare('SELECT COUNT(*) n FROM conversas WHERE arquivada = 0 AND cliente_id IS NOT NULL').get().n;
  return {
    conversas: tot,
    salvos,
    taxa_pct: tot ? Math.round((salvos / tot) * 100) : 0,
    meta_pct: 70,
  };
}

// ============================================================
// mensagemSugerida — texto de follow-up no tom DS.
// Usa o segmento RFM do cliente (se vinculado) ou o estágio da conversa.
// ============================================================
function mensagemSugerida(conversa) {
  const ap = apelido(conversa.contato_nome || conversa.cliente_nome || 'cliente');
  if (conversa.cliente_id) {
    // tenta o segmento da matriz RFM
    try {
      const seg = (require('./crm').segmentarRFM(hojeLocal()).clientes || [])
        .find(i => i.id === conversa.cliente_id);
      if (seg?.segmento) return campanhaSegmento(seg.segmento, ap);
    } catch { /* segue pro fallback */ }
  }
  // fallback por estágio da conversa
  if (conversa.estagio === 'negociando') return M.recompra(ap);
  if (conversa.estagio === 'comprou')    return M.pos_venda1(ap);
  return M.retorno(ap);
}

// ============================================================
// sugestoesFollowup — o painel "pra fazer hoje".
// Une (a) follow-ups manuais vencidos/hoje e (b) automáticos derivados:
// conversas em 'negociando' paradas há >= inbox_followup_dias, sem follow pendente.
// ============================================================
function sugestoesFollowup(hoje = hojeLocal()) {
  const itens = [];

  // (a) manuais pendentes (data_alvo <= hoje)
  const manuais = db.prepare(`
    SELECT f.id AS followup_id, f.motivo, c.*, cl.nome AS cliente_nome
    FROM conversa_followups f
    JOIN conversas c ON c.id = f.conversa_id
    LEFT JOIN clientes cl ON cl.id = c.cliente_id
    WHERE f.status = 'pendente' AND f.data_alvo <= ? AND c.arquivada = 0
    ORDER BY f.data_alvo ASC
  `).all(hoje);
  for (const m of manuais) {
    itens.push({ tipo: 'manual', followup_id: m.followup_id, conversa_id: m.id,
      canal: m.canal, contato_nome: m.contato_nome || m.cliente_nome, telefone: m.telefone,
      cliente_id: m.cliente_id, motivo: m.motivo || 'manual',
      mensagem_sugerida: mensagemSugerida(m) });
  }

  // (b) automáticos: negociando parado, sem follow pendente
  const dias = parseInt(getConfig('inbox_followup_dias', '2'), 10) || 2;
  const candidatos = db.prepare(`
    SELECT c.*, cl.nome AS cliente_nome
    FROM conversas c
    LEFT JOIN clientes cl ON cl.id = c.cliente_id
    WHERE c.arquivada = 0 AND c.estagio = 'negociando'
      AND NOT EXISTS (SELECT 1 FROM conversa_followups f WHERE f.conversa_id = c.id AND f.status = 'pendente')
  `).all();
  for (const c of candidatos) {
    const ultima = (c.ultima_interacao || '').slice(0, 10);
    if (ultima && diasEntre(hoje, ultima) >= dias) {
      itens.push({ tipo: 'auto', followup_id: null, conversa_id: c.id,
        canal: c.canal, contato_nome: c.contato_nome || c.cliente_nome, telefone: c.telefone,
        cliente_id: c.cliente_id, motivo: 'negociando_parado',
        mensagem_sugerida: mensagemSugerida(c) });
    }
  }

  return { data: hoje, total: itens.length, itens };
}

// tags de uma conversa
function tagsDe(conversaId) {
  return db.prepare('SELECT tag FROM conversa_tags WHERE conversa_id = ? ORDER BY tag').all(conversaId).map(r => r.tag);
}

module.exports = {
  registrarEntrada, taxaCaptura, sugestoesFollowup, mensagemSugerida, tagsDe,
  hojeLocal, agoraLocal, janela24h, acharClientePorTelefone,
};
