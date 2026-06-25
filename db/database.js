// ============================================================
// Conexao com o banco SQLite NATIVO do Node (node:sqlite)
// Nao precisa compilar nada. Requer Node 22.5+ (temos 24).
// Expoe uma interface compativel estilo better-sqlite3:
//   db.prepare(sql).get(...) / .all(...) / .run(...)
//   db.exec(sql)
//   db.transaction(fn)
// ============================================================
const path = require('path');
const fs = require('fs');
const { DatabaseSync } = require('node:sqlite');

// DB_DIR configurável por env (disco persistente na nuvem); default = pasta local.
const DB_DIR = process.env.DB_DIR || __dirname;
if (!fs.existsSync(DB_DIR)) fs.mkdirSync(DB_DIR, { recursive: true });
const DB_PATH = path.join(DB_DIR, 'dsstore.db');
const SCHEMA_PATH = path.join(__dirname, 'schema.sql');

// PROTEÇÃO CRÍTICA: verificar ANTES de abrir (DatabaseSync cria arquivo vazio!)
// Considerar "existe" se o arquivo tem > 1000 bytes (banco real, não vazio)
const bankExistedBefore = fs.existsSync(DB_PATH) && fs.statSync(DB_PATH).size > 1000;

// Fazer backup se banco existir e tiver dados reais (segurança extra)
if (bankExistedBefore && !process.env.SKIP_BACKUP) {
  const backup = DB_PATH + '.backup-' + new Date().getTime();
  fs.copyFileSync(DB_PATH, backup);
  console.log(`💾 Backup criado: ${backup}`);
}

const raw = new DatabaseSync(DB_PATH);
raw.exec('PRAGMA journal_mode = WAL;');
raw.exec('PRAGMA foreign_keys = ON;');

// Executa schema (CREATE TABLE IF NOT EXISTS é idempotente e seguro)
const schema = fs.readFileSync(SCHEMA_PATH, 'utf8');
try {
  raw.exec(schema);
  if (!bankExistedBefore) {
    console.log(`✅ Novo banco criado em ${DB_PATH}`);
  }
} catch (err) {
  console.error('❌ Erro ao executar schema:', err.message);
  console.error('Tentando criar tabelas novamente...');
  // Tentar de novo com mais cuidado
  raw.exec(schema);
}

// Executar migrations (nunca deletam dados, apenas atualizam schema)
const { executarMigrations } = require('./migrations');
executarMigrations(raw);

// Agora sim, banco tá pronto — mostrar status
if (bankExistedBefore) {
  const tabelas = raw.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map(t => t.name);
  try {
    const vendas = raw.prepare('SELECT COUNT(*) as cnt FROM vendas').get().cnt;
    console.log(`✅ Banco existente PRESERVADO (${tabelas.length} tabelas, ${vendas} vendas)`);
  } catch (e) {
    console.log(`✅ Banco existente PRESERVADO (${tabelas.length} tabelas)`);
  }
}

// --- Migracoes idempotentes (para bancos ja existentes ganharem colunas novas) ---
function colunasDe(tabela) {
  return raw.prepare(`PRAGMA table_info(${tabela})`).all().map(c => c.name);
}
function garantirColuna(tabela, coluna, definicao) {
  if (!colunasDe(tabela).includes(coluna)) {
    raw.exec(`ALTER TABLE ${tabela} ADD COLUMN ${coluna} ${definicao}`);
  }
}
// caixa_dia: colunas de abertura/fechamento (v6)
garantirColuna('caixa_dia', 'fundo_troco', 'REAL NOT NULL DEFAULT 0');
garantirColuna('caixa_dia', 'sangrias', 'REAL NOT NULL DEFAULT 0');
garantirColuna('caixa_dia', 'suprimentos', 'REAL NOT NULL DEFAULT 0');
garantirColuna('caixa_dia', 'dinheiro_contado', 'REAL');
garantirColuna('caixa_dia', 'diferenca', 'REAL');
garantirColuna('caixa_dia', 'aberto_em', 'TEXT');
garantirColuna('caixa_dia', 'fechado_em', 'TEXT');
garantirColuna('caixa_dia', 'aberto', 'INTEGER NOT NULL DEFAULT 0');
garantirColuna('caixa_dia', 'fechado', 'INTEGER NOT NULL DEFAULT 0');
// caixa_dia: saldo inicial da CONTA bancária (v19) — informado/editável pelo usuário
// olhando o app do banco. Serve pra bater a conta no fim do dia (gaveta x conta).
garantirColuna('caixa_dia', 'saldo_conta_inicial', 'REAL');
garantirColuna('caixa_dia', 'conta_conferida', 'REAL'); // saldo da conta conferido no fechamento
// vendas: canal de origem (v6)
garantirColuna('vendas', 'origem', "TEXT NOT NULL DEFAULT 'loja'");
// vendas: comprovante (v17) — print do Pix por chave anexado a venda
garantirColuna('vendas', 'comprovante', 'TEXT');
// vendas: vínculo com encomenda (v18) — a venda foi gerada por uma encomenda paga.
// venda de encomenda NÃO baixa estoque na criação (a peça pode ainda não existir).
garantirColuna('vendas', 'encomenda_id', 'INTEGER');
// caixa_movimentos: forma de pagamento da sangria/suprimento (v18).
// só 'dinheiro' afeta o dinheiro físico da gaveta; pix/cartão saem/entram na conta.
garantirColuna('caixa_movimentos', 'forma', "TEXT NOT NULL DEFAULT 'dinheiro'");
// caixa_movimentos: vínculo com a despesa gerada (v19) — saída do dia cria despesa;
// apagar o movimento apaga a despesa junto (e vice-versa).
garantirColuna('caixa_movimentos', 'despesa_id', 'INTEGER');
// vendas: troco (v18) — valor recebido a mais e como o troco foi devolvido.
// troco em dinheiro sai da gaveta; em pix sai da conta (vira sangria pix no caixa).
garantirColuna('vendas', 'troco', 'REAL NOT NULL DEFAULT 0');
garantirColuna('vendas', 'troco_forma', "TEXT");
// encomendas: comprovante (v17) — print do pagamento adiantado.
// só roda se a tabela já existir (bancos que criaram encomendas antes da coluna).
try { garantirColuna('encomendas', 'comprovante', 'TEXT'); } catch (e) { /* tabela nova já nasce com a coluna */ }
// clientes: origem de AQUISICAO (como conheceu a DS) (v12) — diferente da origem da venda
garantirColuna('clientes', 'origem', 'TEXT');
// clientes: arquivar/inativar + opt-out de mensagens (LGPD) + indicação (v14)
garantirColuna('clientes', 'arquivado', 'INTEGER NOT NULL DEFAULT 0');
garantirColuna('clientes', 'nao_perturbe', 'INTEGER NOT NULL DEFAULT 0');
garantirColuna('clientes', 'indicada_por', 'INTEGER'); // id do cliente que indicou
// produtos: coleção (v16) — separar lançamentos (São João 2026, Estoque Antigo, etc.)
garantirColuna('produtos', 'colecao', 'TEXT');
// config: lista de coleções (editável na tela de config)
raw.exec(`INSERT OR IGNORE INTO config (chave, valor) VALUES ('colecoes', '["São João 2026","Estoque Antigo"]')`);
// config: origens de venda (v6) — caso o banco ja exista sem essa chave
raw.exec(`INSERT OR IGNORE INTO config (chave, valor) VALUES ('origens', '["loja","instagram","whatsapp","indicacao"]')`);
// config: origens de AQUISICAO do cliente (como conheceu) (v12)
raw.exec(`INSERT OR IGNORE INTO config (chave, valor) VALUES ('origens_cliente', '["Passou na loja","Instagram","Indicação","Google","WhatsApp","Influencer","Cliente Camacan","Outro"]')`);
raw.exec(`INSERT OR IGNORE INTO config (chave, valor) VALUES ('categorias', '["vestido","blusa","calca","short","saia","conjunto","macacao","alfaiataria","acessorio","body","outro"]')`);
// migracao (v14): garante que 'body' exista na lista de categorias mesmo em banco ja criado
try {
  const row = raw.prepare("SELECT valor FROM config WHERE chave = 'categorias'").get();
  if (row) {
    let cats = JSON.parse(row.valor);
    if (!cats.includes('body')) {
      // insere 'body' antes de 'outro' (se houver), senao no fim
      const i = cats.indexOf('outro');
      if (i >= 0) cats.splice(i, 0, 'body'); else cats.push('body');
      raw.prepare("UPDATE config SET valor = ? WHERE chave = 'categorias'").run(JSON.stringify(cats));
    }
  }
} catch (e) { /* nao quebra o boot por causa disso */ }
// config: cupom automático no pós-venda (v14) — imprime sozinho ao finalizar a venda
raw.exec(`INSERT OR IGNORE INTO config (chave, valor) VALUES ('cupom_auto_imprimir', '1')`);
// config: taxa do Pix por chave (sem taxa) (v17)
raw.exec(`INSERT OR IGNORE INTO config (chave, valor) VALUES ('taxa_pix_chave', '0')`);
// config: NFC-e via Focus NFe (v20) — dados FISCAIS (nao-secretos) ficam aqui.
// O segredo (token da Focus) vem SEMPRE do .env, NUNCA do banco (ver FOCUS abaixo).
raw.exec(`INSERT OR IGNORE INTO config (chave, valor) VALUES ('nfce_ativo', '0')`);
raw.exec(`INSERT OR IGNORE INTO config (chave, valor) VALUES ('nfce_ambiente', 'homologacao')`);
raw.exec(`INSERT OR IGNORE INTO config (chave, valor) VALUES ('nfce_csc_id', '')`);
raw.exec(`INSERT OR IGNORE INTO config (chave, valor) VALUES ('nfce_serie', '1')`);
raw.exec(`INSERT OR IGNORE INTO config (chave, valor) VALUES ('nfce_ncm_padrao', '61099000')`);
raw.exec(`INSERT OR IGNORE INTO config (chave, valor) VALUES ('nfce_cfop_padrao', '5102')`);
// trocas: colunas de custo para CMVR (v21) — rastreia impacto nas trocas
garantirColuna('trocas', 'custo_devolvido', 'REAL NOT NULL DEFAULT 0');
garantirColuna('trocas', 'custo_levado', 'REAL NOT NULL DEFAULT 0');
garantirColuna('trocas', 'cmvr_bruto', 'REAL NOT NULL DEFAULT 0');
// troca_itens: custo unitário para auditoria (v21)
garantirColuna('troca_itens', 'custo_unit', 'REAL NOT NULL DEFAULT 0');
raw.exec(`INSERT OR IGNORE INTO config (chave, valor) VALUES ('nfce_csosn_padrao', '102')`);
raw.exec(`INSERT OR IGNORE INTO config (chave, valor) VALUES ('nfce_origem_padrao', '0')`);
raw.exec(`INSERT OR IGNORE INTO config (chave, valor) VALUES ('nfce_unidade_padrao', 'UN')`);
raw.exec(`INSERT OR IGNORE INTO config (chave, valor) VALUES ('loja_im', '')`);
raw.exec(`INSERT OR IGNORE INTO config (chave, valor) VALUES ('loja_codigo_municipio', '2914802')`);
// produtos: NCM proprio por peca (v20) — sobrepoe o NCM padrao da NFC-e quando informado.
garantirColuna('produtos', 'ncm', 'TEXT');
// limpeza (v17): remove a config 'Link de pagamento' (forma descontinuada)
raw.exec(`DELETE FROM config WHERE chave = 'taxa_link_pagamento'`);
// config: Inbox (v15) — canais de atendimento e prazo de follow-up automático
raw.exec(`INSERT OR IGNORE INTO config (chave, valor) VALUES ('inbox_canais', '["whatsapp","instagram","manual"]')`);
raw.exec(`INSERT OR IGNORE INTO config (chave, valor) VALUES ('inbox_followup_dias', '2')`);
// config: vitrine/site (v7) — nascem VAZIAS; a lojista preenche na tela de Config (self-service)
raw.exec(`INSERT OR IGNORE INTO config (chave, valor) VALUES ('loja_whatsapp', '')`);
raw.exec(`INSERT OR IGNORE INTO config (chave, valor) VALUES ('loja_whatsapp_link', '')`);
raw.exec(`INSERT OR IGNORE INTO config (chave, valor) VALUES ('loja_instagram_url', '')`);
raw.exec(`INSERT OR IGNORE INTO config (chave, valor) VALUES ('loja_maps', '')`);
raw.exec(`INSERT OR IGNORE INTO config (chave, valor) VALUES ('vitrine_frase', 'Bem-vinda à nossa loja')`);
// config: IDENTIDADE DA LOJA (v21) — personalização self-service. Nascem neutras.
// A lojista define na tela de Config: nome, @, logo (caminho do arquivo enviado) e cor da marca.
raw.exec(`INSERT OR IGNORE INTO config (chave, valor) VALUES ('loja_nome', 'EasyGestão')`);
raw.exec(`INSERT OR IGNORE INTO config (chave, valor) VALUES ('loja_instagram', '')`);
raw.exec(`INSERT OR IGNORE INTO config (chave, valor) VALUES ('loja_logo', 'img/marca/logo-vertical-reverse.svg')`);            // caminho da logo enviada (ex: /img/marca/logo.png)
raw.exec(`INSERT OR IGNORE INTO config (chave, valor) VALUES ('marca_cor', '#1a6f5e')`);    // cor principal da marca (default verde EasyGestão)
// config: nome do clube de fidelidade — editável (era 'Clube DS Lover 🤎' chumbado no código)
raw.exec(`INSERT OR IGNORE INTO config (chave, valor) VALUES ('clube_nome', 'Clube de Fidelidade')`);
// config: Clube DS Lover (v8)
raw.exec(`INSERT OR IGNORE INTO config (chave, valor) VALUES ('clube_ativo', '1')`);
raw.exec(`INSERT OR IGNORE INTO config (chave, valor) VALUES ('clube_valor_selo', '50')`);
raw.exec(`INSERT OR IGNORE INTO config (chave, valor) VALUES ('clube_total_selos', '10')`);
raw.exec(`INSERT OR IGNORE INTO config (chave, valor) VALUES ('clube_valor_premio', '50')`);
// config: Datas comerciais / sazonais (v9) — principais do varejo de moda BR.
// data 'MM-DD' (anual); dias_antes = quantos dias antes dispara; {nome} = apelido do cliente.
raw.exec(`INSERT OR IGNORE INTO config (chave, valor) VALUES ('datas_comerciais', '${JSON.stringify([
  { nome: 'Dia dos Namorados', data: '06-09', dias_antes: 3, mensagem: 'Oi {nome}! 💕 O Dia dos Namorados tá chegando! Que tal se presentear (ou ganhar um mimo)? Separamos peças lindas na DS Store. Vem ver! 🤎' },
  { nome: 'São João', data: '06-21', dias_antes: 3, mensagem: 'Oi {nome}! 🎉 É São João na DS Store! Chegou a coleção pra você arrasar nas festas juninas com muito estilo. Corre que tá voando! 🌽🔥' },
  { nome: 'Dia dos Pais', data: '08-08', dias_antes: 3, mensagem: 'Oi {nome}! 💙 Dia dos Pais chegando — e toda mãe/filha merece se cuidar também. Passa na DS Store ver as novidades! 🤎' },
  { nome: 'Dia das Crianças', data: '10-12', dias_antes: 3, mensagem: 'Oi {nome}! 🧡 Mês das crianças! E você também merece um presente, né? Vem ver o que chegou na DS Store! 🤎' },
  { nome: 'Black Friday', data: '11-28', dias_antes: 2, mensagem: 'Oi {nome}! 🖤 BLACK FRIDAY DS Store chegando! Prepara o carrinho — vão ser ofertas que você não vai querer perder. Te aviso em primeira mão! 🔥' },
  { nome: 'Natal', data: '12-25', dias_antes: 7, mensagem: 'Oi {nome}! 🎄 O Natal tá chegando! Que tal garantir aquele look lindo pra ceia (ou um presente especial)? Vem pra DS Store! 🤎✨' },
]).replace(/'/g, "''")}')`);

// --- Migracoes: Adicionar tenant_id a tabelas operacionais (multi-tenant) ---
garantirColuna('usuarios', 'tenant_id', 'INTEGER');
garantirColuna('produtos', 'tenant_id', 'INTEGER');
garantirColuna('variacoes', 'tenant_id', 'INTEGER');
garantirColuna('vendas', 'tenant_id', 'INTEGER');
garantirColuna('venda_itens', 'tenant_id', 'INTEGER');
garantirColuna('venda_pagamentos', 'tenant_id', 'INTEGER');
garantirColuna('clientes', 'tenant_id', 'INTEGER');
garantirColuna('vendedores', 'tenant_id', 'INTEGER');
garantirColuna('caixa_dia', 'tenant_id', 'INTEGER');
garantirColuna('caixa_movimentos', 'tenant_id', 'INTEGER');
garantirColuna('despesas', 'tenant_id', 'INTEGER');
garantirColuna('trocas', 'tenant_id', 'INTEGER');
garantirColuna('trocas', 'cancelada', 'INTEGER NOT NULL DEFAULT 0');
garantirColuna('trocas', 'data_troca', 'TEXT');
garantirColuna('trocas', 'venda_id', 'INTEGER');
garantirColuna('troca_itens', 'tenant_id', 'INTEGER');
garantirColuna('permutas', 'tenant_id', 'INTEGER');
try { garantirColuna('estoque', 'tenant_id', 'INTEGER'); } catch (e) { /* tabela pode nao existir */ }
garantirColuna('encomendas', 'tenant_id', 'INTEGER');
garantirColuna('config', 'tenant_id', 'INTEGER');
garantirColuna('nfce', 'tenant_id', 'INTEGER');

// CRM tables — adicionar tenant_id para isolamento multi-tenant
garantirColuna('conversas', 'tenant_id', 'INTEGER');
garantirColuna('mensagens', 'tenant_id', 'INTEGER');
garantirColuna('conversa_followups', 'tenant_id', 'INTEGER');
garantirColuna('conversa_tags', 'tenant_id', 'INTEGER');
garantirColuna('crm_acoes_enviadas', 'tenant_id', 'INTEGER');

// Stripe — colunas para integração
garantirColuna('tenants', 'stripe_customer_id', 'TEXT');
garantirColuna('tenants', 'stripe_subscription_id', 'TEXT');
garantirColuna('assinaturas', 'stripe_subscription_id', 'TEXT');
garantirColuna('assinaturas', 'tentativas_pagamento', 'INTEGER DEFAULT 0');
// Trial/Teste grátis — 14 dias antes de cobrar
garantirColuna('assinaturas', 'em_teste', 'INTEGER NOT NULL DEFAULT 0');
garantirColuna('assinaturas', 'data_inicio_teste', 'TEXT');
garantirColuna('assinaturas', 'data_fim_teste', 'TEXT');
garantirColuna('assinaturas', 'cartao_salvo', 'INTEGER NOT NULL DEFAULT 0');

// Criar indices de tenant_id (performance) — safe porque colunas ja foram adicionadas
raw.exec(`
  CREATE INDEX IF NOT EXISTS idx_usuarios_tenant ON usuarios(tenant_id);
  CREATE INDEX IF NOT EXISTS idx_produtos_tenant ON produtos(tenant_id);
  CREATE INDEX IF NOT EXISTS idx_variacoes_tenant ON variacoes(tenant_id);
  CREATE INDEX IF NOT EXISTS idx_vendas_tenant ON vendas(tenant_id);
  CREATE INDEX IF NOT EXISTS idx_venda_itens_tenant ON venda_itens(tenant_id);
  CREATE INDEX IF NOT EXISTS idx_venda_pagamentos_tenant ON venda_pagamentos(tenant_id);
  CREATE INDEX IF NOT EXISTS idx_clientes_tenant ON clientes(tenant_id);
  CREATE INDEX IF NOT EXISTS idx_vendedores_tenant ON vendedores(tenant_id);
  CREATE INDEX IF NOT EXISTS idx_caixa_dia_tenant ON caixa_dia(tenant_id);
  CREATE INDEX IF NOT EXISTS idx_caixa_movimentos_tenant ON caixa_movimentos(tenant_id);
  CREATE INDEX IF NOT EXISTS idx_despesas_tenant ON despesas(tenant_id);
  CREATE INDEX IF NOT EXISTS idx_trocas_tenant ON trocas(tenant_id);
  CREATE INDEX IF NOT EXISTS idx_permutas_tenant ON permutas(tenant_id);
  CREATE INDEX IF NOT EXISTS idx_encomendas_tenant ON encomendas(tenant_id);
  CREATE INDEX IF NOT EXISTS idx_config_tenant ON config(tenant_id);
  CREATE INDEX IF NOT EXISTS idx_nfce_tenant ON nfce(tenant_id);
  CREATE INDEX IF NOT EXISTS idx_conversas_tenant ON conversas(tenant_id);
  CREATE INDEX IF NOT EXISTS idx_mensagens_tenant ON mensagens(tenant_id);
  CREATE INDEX IF NOT EXISTS idx_conversa_followups_tenant ON conversa_followups(tenant_id);
  CREATE INDEX IF NOT EXISTS idx_crm_acoes_tenant ON crm_acoes_enviadas(tenant_id);
`);

// --- Seed tenant padrão (DS Store) se não existir nenhum ---
try {
  const hasTenant = raw.prepare('SELECT COUNT(*) as cnt FROM tenants').get().cnt > 0;
  if (!hasTenant) {
    raw.exec(`INSERT INTO tenants (id, nome_loja, nome_responsavel, telefone, email, senha_hash)
      VALUES (1, 'DS Store', 'Admin', '0000-0000', 'admin@dsstore.local', 'placeholder')`);
  }
} catch (e) { /* tabela pode estar vazia, seguir com migracoes */ }

// --- Atualizar dados existentes (orfãos com tenant_id = NULL) para tenant 1 (padrão) ---
raw.exec(`UPDATE usuarios SET tenant_id = 1 WHERE tenant_id IS NULL`);
raw.exec(`UPDATE produtos SET tenant_id = 1 WHERE tenant_id IS NULL`);
raw.exec(`UPDATE variacoes SET tenant_id = 1 WHERE tenant_id IS NULL`);
raw.exec(`UPDATE vendas SET tenant_id = 1 WHERE tenant_id IS NULL`);
raw.exec(`UPDATE venda_itens SET tenant_id = 1 WHERE tenant_id IS NULL`);
raw.exec(`UPDATE venda_pagamentos SET tenant_id = 1 WHERE tenant_id IS NULL`);
raw.exec(`UPDATE clientes SET tenant_id = 1 WHERE tenant_id IS NULL`);
raw.exec(`UPDATE vendedores SET tenant_id = 1 WHERE tenant_id IS NULL`);
raw.exec(`UPDATE caixa_dia SET tenant_id = 1 WHERE tenant_id IS NULL`);
raw.exec(`UPDATE caixa_movimentos SET tenant_id = 1 WHERE tenant_id IS NULL`);
raw.exec(`UPDATE despesas SET tenant_id = 1 WHERE tenant_id IS NULL`);
raw.exec(`UPDATE trocas SET tenant_id = 1 WHERE tenant_id IS NULL`);
raw.exec(`UPDATE permutas SET tenant_id = 1 WHERE tenant_id IS NULL`);
raw.exec(`UPDATE encomendas SET tenant_id = 1 WHERE tenant_id IS NULL`);
raw.exec(`UPDATE config SET tenant_id = 1 WHERE tenant_id IS NULL`);
raw.exec(`UPDATE nfce SET tenant_id = 1 WHERE tenant_id IS NULL`);
raw.exec(`UPDATE conversas SET tenant_id = 1 WHERE tenant_id IS NULL`);
raw.exec(`UPDATE mensagens SET tenant_id = 1 WHERE tenant_id IS NULL`);
raw.exec(`UPDATE conversa_followups SET tenant_id = 1 WHERE tenant_id IS NULL`);
raw.exec(`UPDATE conversa_tags SET tenant_id = 1 WHERE tenant_id IS NULL`);
raw.exec(`UPDATE crm_acoes_enviadas SET tenant_id = 1 WHERE tenant_id IS NULL`);

// --- Wrapper para compatibilidade de API (estilo better-sqlite3) ---
function prepare(sql) {
  const stmt = raw.prepare(sql);
  return {
    get: (...args) => stmt.get(...args),
    all: (...args) => stmt.all(...args),
    run: (...args) => {
      const r = stmt.run(...args);
      // node:sqlite retorna { changes, lastInsertRowid }
      return { changes: Number(r.changes), lastInsertRowid: Number(r.lastInsertRowid) };
    },
  };
}

function exec(sql) { raw.exec(sql); }

// Transacao: executa fn dentro de BEGIN/COMMIT, ROLLBACK em erro
function transaction(fn) {
  return (...args) => {
    raw.exec('BEGIN');
    try {
      const result = fn(...args);
      raw.exec('COMMIT');
      return result;
    } catch (e) {
      raw.exec('ROLLBACK');
      throw e;
    }
  };
}

const db = { prepare, exec, transaction, _raw: raw };

// Helpers de config — suportam tenant_id opcionalmente
function getConfig(chave, fallback = null, tenantId = 1) {
  const row = db.prepare('SELECT valor FROM config WHERE chave = ? AND tenant_id = ?').get(chave, tenantId);
  return row ? row.valor : fallback;
}
function setConfig(chave, valor, tenantId = 1) {
  db.prepare('INSERT INTO config (chave, valor, tenant_id) VALUES (?, ?, ?) ON CONFLICT(chave, tenant_id) DO UPDATE SET valor = excluded.valor')
    .run(chave, String(valor), tenantId);
}

// Credenciais das APIs da Meta (Inbox) — vêm do ambiente (.env), NUNCA do banco.
// Sem elas, o inbox roda em "modo registro" (registra conversas, mas não envia/recebe via Meta).
const META = {
  // WhatsApp Cloud API
  WHATSAPP_TOKEN:    process.env.WHATSAPP_TOKEN || '',
  WHATSAPP_PHONE_ID: process.env.WHATSAPP_PHONE_ID || '',
  WABA_ID:           process.env.WABA_ID || '',
  // Instagram Messaging API
  INSTAGRAM_TOKEN:   process.env.INSTAGRAM_TOKEN || '',
  INSTAGRAM_ID:      process.env.INSTAGRAM_ID || '',
  // Comum
  META_VERIFY_TOKEN: process.env.META_VERIFY_TOKEN || '',   // string que VOCÊ inventa, p/ verificar o webhook
  META_APP_SECRET:   process.env.META_APP_SECRET || '',     // valida assinatura X-Hub-Signature-256
  GRAPH_VERSION:     process.env.META_GRAPH_VERSION || 'v21.0',
};
META.whatsappAtivo  = !!(META.WHATSAPP_TOKEN && META.WHATSAPP_PHONE_ID);
META.instagramAtivo = !!(META.INSTAGRAM_TOKEN && META.INSTAGRAM_ID);

// Tokens da Focus NFe (NFC-e) — SEGREDO: vêm do ambiente (.env / Render), NUNCA do banco
// nem do código. São dois ambientes independentes, cada um com seu token:
//   FOCUS_TOKEN_HOMOLOGACAO  -> testes (notas sem valor fiscal)
//   FOCUS_TOKEN_PRODUCAO     -> notas reais
// O CSC e o ID do CSC ficam no painel da Focus (não precisamos deles aqui pra emitir).
// O ambiente atual ('homologacao'|'producao') é escolhido na tela de Config (não-secreto).
const FOCUS = {
  TOKEN_HOMOLOGACAO: process.env.FOCUS_TOKEN_HOMOLOGACAO || '',
  TOKEN_PRODUCAO:    process.env.FOCUS_TOKEN_PRODUCAO || '',
  // URLs base de cada ambiente (padrão Focus)
  URL_HOMOLOGACAO: process.env.FOCUS_URL_HOMOLOGACAO || 'https://homologacao.focusnfe.com.br',
  URL_PRODUCAO:    process.env.FOCUS_URL_PRODUCAO || 'https://api.focusnfe.com.br',
};
// Token do ambiente pedido ('homologacao' default). Vazio = integração não configurada.
FOCUS.tokenDe = (ambiente) => ambiente === 'producao' ? FOCUS.TOKEN_PRODUCAO : FOCUS.TOKEN_HOMOLOGACAO;
FOCUS.urlDe   = (ambiente) => ambiente === 'producao' ? FOCUS.URL_PRODUCAO : FOCUS.URL_HOMOLOGACAO;
FOCUS.configurado = (ambiente) => !!FOCUS.tokenDe(ambiente);

module.exports = { db, getConfig, setConfig, DB_PATH, META, FOCUS };
