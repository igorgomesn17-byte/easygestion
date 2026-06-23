-- ============================================================
-- DS SISTEMA - Banco de dados (SQLite)
-- Estrutura das tabelas. Executado automaticamente ao iniciar.
-- ============================================================

PRAGMA foreign_keys = ON;

-- ------------------------------------------------------------
-- PRODUTOS: cada peca cadastrada
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS produtos (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  tenant_id     INTEGER NOT NULL DEFAULT 1,    -- isolamento multi-tenant
  codigo        TEXT NOT NULL,                 -- ex: V001
  codigo_barras TEXT,                          -- EAN gerado
  nome          TEXT NOT NULL,
  categoria     TEXT,                          -- vestido, calca, blusa...
  descricao     TEXT,
  cor           TEXT,
  custo         REAL NOT NULL DEFAULT 0,        -- quanto custou (compra)
  preco_venda   REAL NOT NULL DEFAULT 0,        -- preco de etiqueta
  foto          TEXT,                          -- caminho/nome do arquivo de foto
  colecao       TEXT,                          -- coleção/linha do produto
  ativo         INTEGER NOT NULL DEFAULT 1,     -- 1 ativo, 0 inativo
  criado_em     TEXT NOT NULL DEFAULT (datetime('now','localtime')),
  UNIQUE(tenant_id, codigo),
  UNIQUE(tenant_id, codigo_barras)
);

-- ------------------------------------------------------------
-- PRODUTO_FOTOS: fotos extras da peça (galeria). A foto principal/capa
-- continua em produtos.foto. Aqui ficam as adicionais (até 4 extras).
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS produto_fotos (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  produto_id  INTEGER NOT NULL,
  caminho     TEXT NOT NULL,
  ordem       INTEGER NOT NULL DEFAULT 0,
  FOREIGN KEY (produto_id) REFERENCES produtos(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_produto_fotos ON produto_fotos(produto_id);

-- ------------------------------------------------------------
-- VARIACOES: a grade (um registro por tamanho de cada produto)
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS variacoes (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  produto_id  INTEGER NOT NULL,
  tamanho     TEXT NOT NULL,
  quantidade  INTEGER NOT NULL DEFAULT 0,
  FOREIGN KEY (produto_id) REFERENCES produtos(id) ON DELETE CASCADE,
  UNIQUE (produto_id, tamanho)
);

-- ------------------------------------------------------------
-- CLIENTES
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS clientes (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  tenant_id     INTEGER NOT NULL DEFAULT 1,    -- isolamento multi-tenant
  nome          TEXT NOT NULL,
  telefone      TEXT,
  cidade        TEXT,
  aniversario   TEXT,                          -- DD/MM
  origem        TEXT,                          -- como conheceu a DS: instagram, indicacao, google, loja...
  indicada_por  INTEGER,                       -- cliente que indicou (referral)
  total_gasto   REAL NOT NULL DEFAULT 0,
  num_compras   INTEGER NOT NULL DEFAULT 0,
  ultima_compra TEXT,
  arquivado     INTEGER NOT NULL DEFAULT 0,    -- 1 = cliente arquivado
  nao_perturbe  INTEGER NOT NULL DEFAULT 0,    -- 1 = não ligar/enviar mensagens
  criado_em     TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);

-- ------------------------------------------------------------
-- VENDEDORES (com % de comissao individual)
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS vendedores (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  nome         TEXT NOT NULL,
  telefone     TEXT,
  comissao_pct REAL NOT NULL DEFAULT 0,
  ativo        INTEGER NOT NULL DEFAULT 1,
  criado_em    TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);

-- ------------------------------------------------------------
-- VENDAS
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS vendas (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  tenant_id       INTEGER NOT NULL DEFAULT 1,    -- isolamento multi-tenant (CRÍTICO)
  data_hora       TEXT NOT NULL DEFAULT (datetime('now','localtime')),
  cliente_id      INTEGER,
  vendedor_id     INTEGER,
  subtotal        REAL NOT NULL DEFAULT 0,
  desconto        REAL NOT NULL DEFAULT 0,
  acrescimo       REAL NOT NULL DEFAULT 0,       -- taxa repassada ao cliente (parcelamento 4x+)
  total           REAL NOT NULL DEFAULT 0,       -- o que o cliente paga
  forma_pagamento TEXT NOT NULL,
  origem          TEXT NOT NULL DEFAULT 'loja',  -- canal: loja, instagram, whatsapp, indicacao...
  parcelas        INTEGER NOT NULL DEFAULT 1,
  taxa_aplicada   REAL NOT NULL DEFAULT 0,
  valor_liquido   REAL NOT NULL DEFAULT 0,
  imposto         REAL NOT NULL DEFAULT 0,
  comissao_valor  REAL NOT NULL DEFAULT 0,
  embalagem_total REAL NOT NULL DEFAULT 0,
  custo_total     REAL NOT NULL DEFAULT 0,
  lucro           REAL NOT NULL DEFAULT 0,       -- margem de contribuicao
  observacao      TEXT,
  comprovante     TEXT,                          -- caminho do print (ex: Pix por chave)
  encomenda_id    INTEGER,                        -- venda gerada por uma encomenda paga (nao baixa estoque na criacao)
  FOREIGN KEY (cliente_id) REFERENCES clientes(id) ON DELETE SET NULL,
  FOREIGN KEY (vendedor_id) REFERENCES vendedores(id) ON DELETE SET NULL
);

-- ------------------------------------------------------------
-- VENDA_ITENS
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS venda_itens (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  venda_id    INTEGER NOT NULL,
  variacao_id INTEGER,
  produto_id  INTEGER,
  descricao   TEXT,
  qtd         INTEGER NOT NULL DEFAULT 1,
  preco_unit  REAL NOT NULL DEFAULT 0,
  custo_unit  REAL NOT NULL DEFAULT 0,
  FOREIGN KEY (venda_id) REFERENCES vendas(id) ON DELETE CASCADE,
  FOREIGN KEY (variacao_id) REFERENCES variacoes(id) ON DELETE SET NULL,
  FOREIGN KEY (produto_id) REFERENCES produtos(id) ON DELETE SET NULL
);

-- ------------------------------------------------------------
-- VENDA_PAGAMENTOS: 1 venda -> N formas de pagamento (pagamento dividido).
-- Cada parte guarda sua forma, valor, parcelas e a taxa/liquido que ELA gera.
-- Venda de forma unica tambem grava 1 linha aqui (consistencia).
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS venda_pagamentos (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  venda_id      INTEGER NOT NULL,
  forma         TEXT NOT NULL,                 -- pix, dinheiro, debito, credito_vista, credito_parcelado
  parcelas      INTEGER NOT NULL DEFAULT 1,
  valor         REAL NOT NULL DEFAULT 0,       -- quanto o cliente pagou nesta forma
  taxa_pct      REAL NOT NULL DEFAULT 0,       -- % da taxa desta forma
  valor_taxa    REAL NOT NULL DEFAULT 0,       -- R$ de taxa desta parte
  valor_liquido REAL NOT NULL DEFAULT 0,       -- valor - valor_taxa
  FOREIGN KEY (venda_id) REFERENCES vendas(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_venda_pagamentos ON venda_pagamentos(venda_id);

-- ------------------------------------------------------------
-- PERMUTAS: saida de pecas por permuta/marketing (blogueiras).
-- Nao e venda: baixa estoque e lanca o CUSTO como despesa de marketing.
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS permutas (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  data_hora     TEXT NOT NULL DEFAULT (datetime('now','localtime')),
  influencer    TEXT NOT NULL,                 -- nome/@ da blogueira
  custo_total   REAL NOT NULL DEFAULT 0,       -- soma do custo das pecas (vira despesa)
  valor_tabela  REAL NOT NULL DEFAULT 0,       -- soma do preco de venda (valor "de marketing" entregue)
  despesa_id    INTEGER,                       -- despesa de marketing gerada
  obs           TEXT,
  FOREIGN KEY (despesa_id) REFERENCES despesas(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS permuta_itens (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  permuta_id  INTEGER NOT NULL,
  variacao_id INTEGER,
  produto_id  INTEGER,
  descricao   TEXT,
  qtd         INTEGER NOT NULL DEFAULT 1,
  custo_unit  REAL NOT NULL DEFAULT 0,
  preco_unit  REAL NOT NULL DEFAULT 0,
  FOREIGN KEY (permuta_id) REFERENCES permutas(id) ON DELETE CASCADE,
  FOREIGN KEY (variacao_id) REFERENCES variacoes(id) ON DELETE SET NULL,
  FOREIGN KEY (produto_id) REFERENCES produtos(id) ON DELETE SET NULL
);
CREATE INDEX IF NOT EXISTS idx_permuta_itens ON permuta_itens(permuta_id);

-- ------------------------------------------------------------
-- ENCOMENDAS: pedido sob encomenda (cliente paga adiantado uma peca
-- que ainda nao temos em estoque). O pagamento entra no caixa no dia
-- (como suprimento). Na ENTREGA baixa o estoque (se peca cadastrada)
-- e marca como entregue. So vira venda de faturamento na entrega.
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS encomendas (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  data_hora       TEXT NOT NULL DEFAULT (datetime('now','localtime')),
  cliente_id      INTEGER,
  cliente_nome    TEXT,                          -- nome digitado (se nao tiver cadastro)
  cliente_tel     TEXT,                          -- whatsapp pra avisar quando chegar
  descricao       TEXT NOT NULL,                 -- o que a cliente encomendou
  variacao_id     INTEGER,                       -- se a peca ja e cadastrada (baixa estoque na entrega)
  tamanho         TEXT,                          -- tamanho pedido (texto livre se nao cadastrada)
  valor_total     REAL NOT NULL DEFAULT 0,
  valor_pago      REAL NOT NULL DEFAULT 0,       -- quanto ja entrou (paga adiantado = valor_total)
  forma_pagamento TEXT,                          -- forma do pagamento adiantado
  data_pagamento  TEXT,                          -- dia que o dinheiro entrou no caixa
  status          TEXT NOT NULL DEFAULT 'aguardando', -- aguardando, chegou, entregue, cancelada
  venda_id        INTEGER,                       -- venda gerada na entrega
  comprovante     TEXT,                          -- print do pagamento adiantado
  obs             TEXT,
  chegou_em       TEXT,
  entregue_em     TEXT,
  FOREIGN KEY (cliente_id) REFERENCES clientes(id) ON DELETE SET NULL,
  FOREIGN KEY (variacao_id) REFERENCES variacoes(id) ON DELETE SET NULL,
  FOREIGN KEY (venda_id) REFERENCES vendas(id) ON DELETE SET NULL
);
CREATE INDEX IF NOT EXISTS idx_encomendas_status ON encomendas(status);

-- ------------------------------------------------------------
-- NFCE: nota fiscal de consumidor eletronica emitida pela Focus NFe.
-- Uma linha por tentativa/emissao, vinculada a uma venda. A nota em si e
-- gerada/autorizada pela SEFAZ via Focus; aqui guardamos a referencia,
-- o status e os retornos (numero, chave, link do DANFE/QRCode).
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS nfce (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  venda_id        INTEGER,                        -- venda que originou a nota
  ref             TEXT UNIQUE NOT NULL,           -- referencia unica enviada a Focus (idempotencia)
  ambiente        TEXT NOT NULL DEFAULT 'homologacao', -- homologacao | producao
  status          TEXT NOT NULL DEFAULT 'processando', -- processando | autorizado | erro | cancelado | denegado
  numero          TEXT,                           -- numero da NFC-e (apos autorizada)
  serie           TEXT,
  chave           TEXT,                           -- chave de acesso (44 digitos)
  protocolo       TEXT,                           -- protocolo de autorizacao da SEFAZ
  caminho_danfe   TEXT,                           -- URL do DANFE (cupom) na Focus
  caminho_xml     TEXT,                           -- URL do XML autorizado na Focus
  qrcode_url      TEXT,                           -- URL do QRCode (consulta pelo consumidor)
  mensagem_sefaz  TEXT,                           -- mensagem de retorno (erro/sucesso) da SEFAZ
  valor_total     REAL NOT NULL DEFAULT 0,
  emitido_em      TEXT NOT NULL DEFAULT (datetime('now','localtime')),
  cancelado_em    TEXT,
  FOREIGN KEY (venda_id) REFERENCES vendas(id) ON DELETE SET NULL
);
CREATE INDEX IF NOT EXISTS idx_nfce_venda ON nfce(venda_id);
CREATE INDEX IF NOT EXISTS idx_nfce_status ON nfce(status);

-- ------------------------------------------------------------
-- MOVIMENTOS_ESTOQUE
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS movimentos_estoque (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  variacao_id INTEGER NOT NULL,
  tipo        TEXT NOT NULL,
  qtd         INTEGER NOT NULL,
  motivo      TEXT,
  data        TEXT NOT NULL DEFAULT (datetime('now','localtime')),
  FOREIGN KEY (variacao_id) REFERENCES variacoes(id) ON DELETE CASCADE
);

-- ------------------------------------------------------------
-- CAIXA_DIA
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS caixa_dia (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  tenant_id       INTEGER NOT NULL DEFAULT 1,    -- isolamento multi-tenant (CRÍTICO)
  data            TEXT NOT NULL,
  total_pix       REAL NOT NULL DEFAULT 0,
  total_debito    REAL NOT NULL DEFAULT 0,
  total_credito   REAL NOT NULL DEFAULT 0,
  total_dinheiro  REAL NOT NULL DEFAULT 0,
  total_bruto     REAL NOT NULL DEFAULT 0,
  total_liquido   REAL NOT NULL DEFAULT 0,
  lucro_dia       REAL NOT NULL DEFAULT 0,
  num_vendas      INTEGER NOT NULL DEFAULT 0,
  conciliado      INTEGER NOT NULL DEFAULT 0,
  obs             TEXT,
  saldo_conta_inicial REAL,                   -- saldo inicial da conta (reconciliação)
  conta_conferida REAL,                        -- valor conferido na conta
  -- abertura / fechamento de caixa
  fundo_troco     REAL NOT NULL DEFAULT 0,   -- dinheiro inicial (troco)
  sangrias        REAL NOT NULL DEFAULT 0,   -- total retirado durante o dia
  suprimentos     REAL NOT NULL DEFAULT 0,   -- total adicionado durante o dia
  dinheiro_contado REAL,                      -- dinheiro fisico contado no fechamento
  diferenca       REAL,                       -- contado - esperado
  aberto_em       TEXT,
  fechado_em      TEXT,
  aberto          INTEGER NOT NULL DEFAULT 0, -- 1 = caixa aberto no dia
  fechado         INTEGER NOT NULL DEFAULT 0, -- 1 = caixa fechado
  UNIQUE(tenant_id, data)
);

-- ------------------------------------------------------------
-- CAIXA_MOVIMENTOS: log de aberturas, sangrias e suprimentos
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS caixa_movimentos (
  id        INTEGER PRIMARY KEY AUTOINCREMENT,
  data      TEXT NOT NULL,                    -- YYYY-MM-DD do caixa
  tipo      TEXT NOT NULL,                    -- abertura, sangria, suprimento
  valor     REAL NOT NULL DEFAULT 0,
  forma     TEXT NOT NULL DEFAULT 'dinheiro', -- dinheiro, pix, debito, credito, transferencia (só dinheiro afeta a gaveta)
  motivo    TEXT,
  criado_em TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);

-- ------------------------------------------------------------
-- TROCAS: troca/devolucao a partir de uma venda de origem
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS trocas (
  id                       INTEGER PRIMARY KEY AUTOINCREMENT,
  venda_origem_id          INTEGER,
  data_hora                TEXT NOT NULL DEFAULT (datetime('now','localtime')),
  valor_devolvido          REAL NOT NULL DEFAULT 0,  -- soma das pecas que voltaram
  valor_levado             REAL NOT NULL DEFAULT 0,  -- soma das pecas que sairam
  diferenca                REAL NOT NULL DEFAULT 0,  -- levado - devolvido (>0 cliente paga, <0 recebe)
  forma_pagamento_diferenca TEXT,
  obs                      TEXT,
  FOREIGN KEY (venda_origem_id) REFERENCES vendas(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS troca_itens (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  troca_id    INTEGER NOT NULL,
  tipo        TEXT NOT NULL,                  -- 'devolvido' ou 'levado'
  variacao_id INTEGER,
  produto_id  INTEGER,
  descricao   TEXT,
  qtd         INTEGER NOT NULL DEFAULT 1,
  valor_unit  REAL NOT NULL DEFAULT 0,
  FOREIGN KEY (troca_id) REFERENCES trocas(id) ON DELETE CASCADE,
  FOREIGN KEY (variacao_id) REFERENCES variacoes(id) ON DELETE SET NULL,
  FOREIGN KEY (produto_id) REFERENCES produtos(id) ON DELETE SET NULL
);

-- ------------------------------------------------------------
-- CRM_ACOES_ENVIADAS: marca quais ações da régua já foram enviadas
-- num dia (cliente + tipo + data). A régua some o card depois de enviado.
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS crm_acoes_enviadas (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  data        TEXT NOT NULL,                    -- YYYY-MM-DD do envio
  cliente_id  INTEGER NOT NULL,
  tipo        TEXT NOT NULL,                    -- DIA1, POS_VENDA_1, ANIVERSARIO...
  enviado_em  TEXT NOT NULL DEFAULT (datetime('now','localtime')),
  UNIQUE (data, cliente_id, tipo)
);
CREATE INDEX IF NOT EXISTS idx_crm_enviadas ON crm_acoes_enviadas(data);

-- ------------------------------------------------------------
-- DESPESAS: tudo que SAI (contas, fornecedor, pro-labore, dividas)
-- E o que faltava pro DRE e fluxo de caixa reais.
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS despesas (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  descricao     TEXT NOT NULL,
  valor         REAL NOT NULL DEFAULT 0,
  categoria     TEXT,                          -- aluguel, energia, fornecedor, pro-labore, divida...
  tipo          TEXT NOT NULL DEFAULT 'variavel', -- 'fixa' ou 'variavel'
  centro        TEXT NOT NULL DEFAULT 'empresa',  -- 'empresa' ou 'pessoal'
  data_competencia TEXT NOT NULL,              -- a que mes pertence (YYYY-MM-DD, normalmente dia 01)
  vencimento    TEXT,                          -- data de vencimento (contas a pagar)
  data_pagamento TEXT,                         -- quando foi efetivamente paga
  pago          INTEGER NOT NULL DEFAULT 0,    -- 0 a pagar, 1 paga
  forma_pagamento TEXT,                        -- pix, dinheiro, cartao, transferencia...
  recorrente    INTEGER NOT NULL DEFAULT 0,    -- 1 = repete todo mes (modelo)
  recorrente_id INTEGER,                       -- aponta pro modelo recorrente que gerou esta
  obs           TEXT,
  criado_em     TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);

-- ------------------------------------------------------------
-- INBOX / CONVERSAS: thread de atendimento por contato+canal.
-- A plataforma age como WhatsApp/Instagram: lê e responde de dentro.
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS conversas (
  id                  INTEGER PRIMARY KEY AUTOINCREMENT,
  cliente_id          INTEGER,                          -- NULL = ainda não salvo no CRM (conta na métrica de captura)
  canal               TEXT NOT NULL DEFAULT 'whatsapp',  -- 'whatsapp' | 'instagram' | 'manual'
  external_contact_id TEXT,                              -- wa_id (WhatsApp) ou IGSID (Instagram) — quem é a cliente na Meta
  contato_nome        TEXT,                              -- nome que veio da Meta ou digitado
  telefone            TEXT,                              -- só dígitos; dedup e wa.me
  estagio             TEXT NOT NULL DEFAULT 'novo',      -- novo, negociando, comprou, nao_levou
  ordem_kanban        INTEGER NOT NULL DEFAULT 0,        -- posição do card dentro da coluna
  ia_pausada          INTEGER NOT NULL DEFAULT 0,        -- transbordo IA→humano (inerte na v1; pronto pro futuro)
  janela_expira_em    TEXT,                              -- fim da janela de 24h (última msg da cliente + 24h)
  ultima_interacao    TEXT NOT NULL DEFAULT (datetime('now','localtime')),
  arquivada           INTEGER NOT NULL DEFAULT 0,
  criado_em           TEXT NOT NULL DEFAULT (datetime('now','localtime')),
  FOREIGN KEY (cliente_id) REFERENCES clientes(id) ON DELETE SET NULL
);

-- ------------------------------------------------------------
-- MENSAGENS: log append-only de cada mensagem da conversa (histórico).
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS mensagens (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  conversa_id  INTEGER NOT NULL,
  direcao      TEXT NOT NULL DEFAULT 'nota',     -- 'recebida' (cliente), 'enviada' (loja), 'nota' (interna)
  external_id  TEXT UNIQUE,                       -- WAMID/mid da Meta (dedup/idempotência do webhook)
  tipo         TEXT NOT NULL DEFAULT 'text',      -- text, image, audio, video, document, template
  texto        TEXT,
  media_id     TEXT,                              -- id da mídia na Meta (baixar depois)
  media_local  TEXT,                              -- caminho do arquivo baixado
  status       TEXT NOT NULL DEFAULT 'recebida',  -- recebida | sent | delivered | read | failed
  criado_em    TEXT NOT NULL DEFAULT (datetime('now','localtime')),
  FOREIGN KEY (conversa_id) REFERENCES conversas(id) ON DELETE CASCADE
);

-- ------------------------------------------------------------
-- FOLLOW-UPS da conversa: lembretes (manual agendado ou auto aceito).
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS conversa_followups (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  conversa_id INTEGER NOT NULL,
  data_alvo   TEXT NOT NULL,                      -- YYYY-MM-DD (quando lembrar)
  motivo      TEXT,                               -- 'manual' ou regra automática
  status      TEXT NOT NULL DEFAULT 'pendente',   -- pendente, feito, adiado, cancelado
  criado_em   TEXT NOT NULL DEFAULT (datetime('now','localtime')),
  feito_em    TEXT,
  FOREIGN KEY (conversa_id) REFERENCES conversas(id) ON DELETE CASCADE
);

-- ------------------------------------------------------------
-- TAGS livres da conversa (ex: "interessada vestido", "pediu desconto").
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS conversa_tags (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  conversa_id INTEGER NOT NULL,
  tag         TEXT NOT NULL,
  criado_em   TEXT NOT NULL DEFAULT (datetime('now','localtime')),
  FOREIGN KEY (conversa_id) REFERENCES conversas(id) ON DELETE CASCADE,
  UNIQUE (conversa_id, tag)
);

-- ------------------------------------------------------------
-- USUARIOS: login multiusuário com papel (admin / relacionamento).
-- O admin principal vem do .env (ADMIN_SENHA) e NÃO fica aqui —
-- esta tabela guarda os usuários adicionais (ex: a pessoa que opera
-- só o sistema de Relacionamento, sem ver financeiro).
-- ✅ NOVO: usuário admin de verdade com papel='admin' pode existir aqui também.
-- O sistema tenta .env primeiro; se não existir, tenta usuario admin na tabela.
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS usuarios (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  tenant_id  INTEGER NOT NULL DEFAULT 1,                 -- isolamento multi-tenant
  nome       TEXT NOT NULL,                              -- login (case-insensitive na consulta)
  email      TEXT,                                       -- email do usuário (para recovery)
  senha_hash TEXT NOT NULL,                              -- scrypt$salt$hash (mesmo formato do admin)
  papel      TEXT NOT NULL DEFAULT 'relacionamento',     -- 'admin' | 'vendedor' | 'relacionamento'
  ativo      INTEGER NOT NULL DEFAULT 1,
  criado_em  TEXT NOT NULL DEFAULT (datetime('now','localtime')),
  UNIQUE(tenant_id, nome),
  UNIQUE(tenant_id, email)
);
CREATE INDEX IF NOT EXISTS idx_usuarios_tenant ON usuarios(tenant_id);

-- ------------------------------------------------------------
-- AUDITORIA: log de TODAS as ações administrativas
-- Registra: quem fez o quê, quando, em qual tenant, e payload da ação
-- Critério: DELETE, PATCH (exceto certos campos), POST que modifica estado global
-- ✅ OBRIGATÓRIO PARA LGPD: rastreabilidade de acesso a dados pessoais (GDPR/LGPD)
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS auditoria (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  usuario_id   INTEGER,                           -- quem fez a ação (NULL se admin do .env)
  usuario_nome TEXT,                              -- nome do usuário (snapshot para forensics)
  tenant_id    INTEGER,                           -- em qual tenant foi feita a ação
  acao         TEXT NOT NULL,                     -- DELETE_cliente, PATCH_cliente, etc
  recurso      TEXT NOT NULL,                     -- 'cliente', 'usuario', 'config', etc
  recurso_id   INTEGER,                           -- ID do que foi modificado (se aplicável)
  antes        TEXT,                              -- JSON com valores ANTES (para audit trail)
  depois       TEXT,                              -- JSON com valores DEPOIS (para audit trail)
  ip           TEXT,                              -- IP da requisição
  status_http  INTEGER,                           -- 200, 400, 403, 500, etc
  criado_em    TEXT NOT NULL DEFAULT (datetime('now','localtime')),
  FOREIGN KEY (usuario_id) REFERENCES usuarios(id) ON DELETE SET NULL
);
CREATE INDEX IF NOT EXISTS idx_auditoria_usuario ON auditoria(usuario_id);
CREATE INDEX IF NOT EXISTS idx_auditoria_tenant ON auditoria(tenant_id);
CREATE INDEX IF NOT EXISTS idx_auditoria_recurso ON auditoria(recurso);
CREATE INDEX IF NOT EXISTS idx_auditoria_data ON auditoria(criado_em);

-- ------------------------------------------------------------
-- CONFIG
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS config (
  chave TEXT NOT NULL,
  valor TEXT NOT NULL,
  tenant_id INTEGER NOT NULL DEFAULT 1,
  PRIMARY KEY (chave, tenant_id)
);

INSERT OR IGNORE INTO config (chave, valor, tenant_id) VALUES
  ('taxa_pix', '0', 1),
  ('taxa_pix_chave', '0', 1),
  ('taxa_debito', '1.37', 1),
  ('taxa_credito_vista', '3.15', 1),
  ('taxa_credito_2x', '5.39', 1),
  ('taxa_credito_3x', '6.12', 1),
  ('taxa_credito_4x', '6.85', 1),
  ('taxa_credito_5x', '7.57', 1),
  ('taxa_credito_6x', '8.28', 1),
  ('imposto_simples', '7.30', 1),
  ('comissao_padrao', '5', 1),
  ('embalagem_unit', '1', 1),
  ('frete_unit', '0', 1),
  ('markup', '2.4', 1),
  ('taxa_referencia_preco', '3.15', 1),
  ('parcelas_loja_absorve', '3', 1),
  ('estoque_minimo_alerta', '1', 1),
  ('meta_mensal', '0', 1),
  ('meta_diaria', '0', 1),
  ('loja_nome', 'EasyGestão', 1),
  ('loja_endereco', '', 1),
  ('loja_telefone', '', 1),
  ('loja_instagram', '', 1),
  ('loja_razao_social', '', 1),
  ('loja_nome_fantasia', '', 1),
  ('loja_cnpj', '', 1),
  ('loja_ie', '', 1),
  ('loja_regime', 'Simples Nacional', 1),
  ('loja_cep', '', 1),
  ('loja_cidade', '', 1),
  ('loja_uf', '', 1),
  ('loja_im', '', 1),
  ('loja_codigo_municipio', '', 1),
  ('nfce_ambiente', 'homologacao', 1),
  ('nfce_ativo', '0', 1),
  ('nfce_csc_id', '', 1),
  ('nfce_serie', '1', 1),
  ('nfce_ncm_padrao', '61099000', 1),
  ('nfce_cfop_padrao', '5102', 1),
  ('nfce_csosn_padrao', '102', 1),
  ('nfce_origem_padrao', '0', 1),
  ('nfce_unidade_padrao', 'UN', 1),
  ('categorias', '["vestido","blusa","calca","short","saia","conjunto","macacao","alfaiataria","acessorio","outro"]', 1),
  ('origens', '["loja","instagram","whatsapp","indicacao"]', 1),
  ('loja_whatsapp', '', 1),
  ('loja_whatsapp_link', '', 1),
  ('loja_instagram_url', '', 1),
  ('loja_maps', '', 1),
  ('vitrine_frase', 'Bem-vinda à nossa loja', 1),
  ('loja_logo', 'img/marca/logo-vertical-reverse.svg', 1),
  ('marca_cor', '#1a6f5e', 1),
  ('clube_nome', 'Clube de Fidelidade', 1),
  ('clube_ativo', '1', 1),
  ('clube_valor_selo', '50', 1),
  ('clube_total_selos', '10', 1),
  ('clube_valor_premio', '50', 1),
  ('cupom_mensagem_rodape', 'Obrigada por comprar conosco***REMOVED***', 1),
  ('cupom_politica_troca', 'TROCAS EM ATÉ 7 DIAS\ncom a peça e este cupom', 1),
  ('colecoes', '[]', 1);

CREATE INDEX IF NOT EXISTS idx_despesas_competencia ON despesas(data_competencia);
CREATE INDEX IF NOT EXISTS idx_despesas_vencimento ON despesas(vencimento);
CREATE INDEX IF NOT EXISTS idx_variacoes_produto ON variacoes(produto_id);
CREATE INDEX IF NOT EXISTS idx_venda_itens_venda ON venda_itens(venda_id);
CREATE INDEX IF NOT EXISTS idx_vendas_data ON vendas(data_hora);
CREATE INDEX IF NOT EXISTS idx_vendas_vendedor ON vendas(vendedor_id);
CREATE INDEX IF NOT EXISTS idx_mov_variacao ON movimentos_estoque(variacao_id);
-- Inbox
CREATE INDEX IF NOT EXISTS idx_conversas_cliente ON conversas(cliente_id);
CREATE INDEX IF NOT EXISTS idx_conversas_estagio ON conversas(estagio);
CREATE INDEX IF NOT EXISTS idx_conversas_contato ON conversas(canal, external_contact_id);
CREATE INDEX IF NOT EXISTS idx_mensagens_conversa ON mensagens(conversa_id);
CREATE INDEX IF NOT EXISTS idx_followups_data ON conversa_followups(data_alvo, status);
CREATE INDEX IF NOT EXISTS idx_conversa_tags ON conversa_tags(conversa_id);

-- ============================================================
-- BACKUP_LOGS: rastreia cada tentativa de backup
-- ============================================================
CREATE TABLE IF NOT EXISTS backup_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  data_backup TEXT NOT NULL DEFAULT (datetime('now','localtime')),
  arquivo_s3 TEXT,                          -- nome do arquivo no S3 (ex: dsstore-2026-06-22T15-30-45.db)
  tamanho_bytes INTEGER,                    -- tamanho do backup em bytes
  status TEXT NOT NULL,                     -- 'sucesso' | 'erro' | 'pendente'
  mensagem TEXT,                            -- erro detalhado se falhou
  tempo_exec_ms INTEGER,                    -- quanto tempo levou (em milissegundos)
  criado_em TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);
CREATE INDEX IF NOT EXISTS idx_backup_logs_status ON backup_logs(status);
CREATE INDEX IF NOT EXISTS idx_backup_logs_data ON backup_logs(criado_em);

-- ============================================================
-- TENANTS (Clientes SaaS) — NOVA TABELA
-- ============================================================
CREATE TABLE IF NOT EXISTS tenants (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  email TEXT UNIQUE NOT NULL,
  senha_hash TEXT NOT NULL,
  nome_loja TEXT NOT NULL,
  razao_social TEXT,
  cnpj TEXT UNIQUE,
  nome_responsavel TEXT NOT NULL,
  telefone TEXT NOT NULL,
  endereco TEXT,
  cidade TEXT,
  uf TEXT,
  cep TEXT,
  inscricao_estadual TEXT,
  regime TEXT DEFAULT 'simples',
  website TEXT,
  instagram TEXT,
  whatsapp TEXT,
  plano TEXT DEFAULT 'basico',
  status TEXT DEFAULT 'teste',
  data_cadastro TEXT NOT NULL DEFAULT (datetime('now','localtime')),
  data_trial_expira TEXT,
  data_ativado TEXT,
  data_cancelado TEXT,
  segmento TEXT,
  ultimo_acesso TEXT,
  num_vendas INTEGER DEFAULT 0,
  receita_total REAL DEFAULT 0,
  aceito_termos INTEGER DEFAULT 0,
  data_aceito_termos TEXT,
  aceito_privacidade INTEGER DEFAULT 0,
  data_aceito_privacidade TEXT,
  observacoes TEXT,
  stripe_customer_id TEXT,
  stripe_subscription_id TEXT
);

CREATE INDEX IF NOT EXISTS idx_tenants_email ON tenants(email);
CREATE INDEX IF NOT EXISTS idx_tenants_status ON tenants(status);
CREATE INDEX IF NOT EXISTS idx_tenants_plano ON tenants(plano);

-- ============================================================
-- ASSINATURAS (Controle de planos SaaS)
-- ============================================================
CREATE TABLE IF NOT EXISTS assinaturas (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  tenant_id INTEGER NOT NULL UNIQUE,
  plano TEXT NOT NULL,
  valor_mensal REAL NOT NULL,
  data_inicio TEXT NOT NULL,
  data_proxima_renovacao TEXT NOT NULL,
  cancelada_em TEXT,
  cancelado_por TEXT,
  motivo_cancelamento TEXT,
  em_teste INTEGER NOT NULL DEFAULT 0,
  data_inicio_teste TEXT,
  data_fim_teste TEXT,
  cartao_salvo INTEGER NOT NULL DEFAULT 0,
  stripe_subscription_id TEXT,
  tentativas_pagamento INTEGER DEFAULT 0,
  FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_assinaturas_tenant ON assinaturas(tenant_id);

-- ============================================================
-- COBRACAS (Histórico de cobranças)
-- ============================================================
CREATE TABLE IF NOT EXISTS cobracas (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  tenant_id INTEGER NOT NULL,
  assinatura_id INTEGER,
  data_cobranca TEXT NOT NULL,
  valor REAL NOT NULL,
  status TEXT DEFAULT 'pendente',
  metodo_pagamento TEXT,
  referencia TEXT,
  data_pagamento TEXT,
  tentativas INTEGER DEFAULT 0,
  FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_cobracas_tenant ON cobracas(tenant_id);
CREATE INDEX IF NOT EXISTS idx_cobracas_status ON cobracas(status);

-- ============================================================
-- TOKENS_VERIFICACAO (Para reset/verify/convites)
-- ============================================================
CREATE TABLE IF NOT EXISTS tokens_verificacao (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  usuario_id INTEGER NOT NULL,
  token TEXT UNIQUE NOT NULL,
  tipo TEXT NOT NULL,
  criado_em TEXT NOT NULL DEFAULT (datetime('now','localtime')),
  expires_em TEXT NOT NULL,
  usado_em TEXT,
  FOREIGN KEY (usuario_id) REFERENCES usuarios(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_tokens_expires ON tokens_verificacao(expires_em);
CREATE INDEX IF NOT EXISTS idx_tokens_usuario ON tokens_verificacao(usuario_id);

-- ============================================================
-- ALERTAS_CLIENTES (Observabilidade de risco de churn)
-- ============================================================
CREATE TABLE IF NOT EXISTS alertas_clientes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  tenant_id INTEGER NOT NULL UNIQUE,
  tipo TEXT NOT NULL,                      -- 'atraso_pagamento', 'inativo', 'nunca_usou', 'erro_integracao', 'suporte_aberto'
  dias_sem_atividade INTEGER DEFAULT 0,    -- quantos dias sem login/uso
  valor_em_risco REAL DEFAULT 0,           -- MRR desse cliente em risco
  dias_atraso INTEGER DEFAULT 0,           -- dias vencidos
  mensagem TEXT,                           -- descrição do alerta
  criado_em TEXT NOT NULL DEFAULT (datetime('now','localtime')),
  resolvido_em TEXT,                       -- NULL = ativo; preenchido = resolvido
  FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_alertas_tipo ON alertas_clientes(tipo);
CREATE INDEX IF NOT EXISTS idx_alertas_ativo ON alertas_clientes(resolvido_em);
CREATE INDEX IF NOT EXISTS idx_alertas_tenant ON alertas_clientes(tenant_id);

-- ============================================================
-- DELECOES_AGENDADAS — LGPD: Grace period de 30 dias pra deletion
-- ============================================================
CREATE TABLE IF NOT EXISTS delecoes_agendadas (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  tenant_id INTEGER UNIQUE NOT NULL,
  agendado_para TEXT NOT NULL,    -- data/hora quando será hard-delete
  criado_em TEXT NOT NULL DEFAULT (datetime('now','localtime')),
  FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_delecoes_agendado ON delecoes_agendadas(agendado_para);
