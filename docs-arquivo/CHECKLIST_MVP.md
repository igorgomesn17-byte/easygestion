# ✅ CHECKLIST PRÉ-LANÇAMENTO MVP — DRE-EXPRESS

**URL Base:** http://localhost:3003
**Teste iniciado:** 2026-06-11

---

## 🔐 BLOCO 1: AUTH & SETUP (5 min)

### 1.1 Login funciona
- [ ] Abrir http://localhost:3003/login.html
- [ ] Tentar login com credenciais erradas → deve dar erro
- [ ] Login com credenciais certas (usar usuário já criado ou criar um novo)
- [ ] Redireciona para dashboard automaticamente
- [ ] Logout retorna pra página de login

**Checklist:**
- [ ] Usuário consegue fazer login/logout
- [ ] Sem acesso a rotas sem autenticação (ex: PDV com logout)

---

## 📱 BLOCO 2: VENDAS (30 min)

### 2.1 PDV — Buscar e adicionar produto
- [ ] Abrir http://localhost:3003/pdv.html
- [ ] Modal de abertura de caixa aparece (deixar fundo de troco zerado)
- [ ] Clicar "Abrir caixa"
- [ ] Buscar um produto por nome → resultado aparece com foto (se tiver)
- [ ] Clicar no resultado → modal de tamanho abre
- [ ] Selecionar um tamanho → produto entra no carrinho
- [ ] Foto do produto aparece na busca após clique (mini preview)

**Checklist:**
- [ ] Foto carrega corretamente (ou placeholder se sem foto)
- [ ] Carrinho atualiza ao adicionar
- [ ] Modal fecha após seleção

### 2.2 PDV — Desconto e formas de pagamento
- [ ] Adicionar mais um produto ao carrinho
- [ ] Aplicar desconto em R$ (ex: R$10)
- [ ] Aplicar desconto em % (ex: 10%)
- [ ] Selecionar forma de pagamento: Pix, Dinheiro, Débito, Crédito à vista
- [ ] Selecionar Crédito parcelado → campo de parcelas aparece
- [ ] Parcelas mudam o acréscimo (taxa)
- [ ] Checkbox "Repassar a taxa" funciona

**Checklist:**
- [ ] Desconto em R$ desconta exatamente
- [ ] Desconto em % desconta exatamente
- [ ] Parcelas mostram acréscimo correto
- [ ] Total atualiza em tempo real

### 2.3 PDV — Pagamento dinheiro com troco
- [ ] Selecionar Dinheiro
- [ ] Campo "Valor recebido" aparece
- [ ] Inserir valor maior que total (ex: total R$100, inserir R$200)
- [ ] Troco aparece corretamente (R$100)
- [ ] Opção de devolver troco em Dinheiro ou Pix
- [ ] Selecionar Pix → campo "Comprovante" aparece

**Checklist:**
- [ ] Troco calcula certo
- [ ] Devolver em Pix aceita imagem

### 2.4 PDV — Finalizar venda
- [ ] Clicar "Finalizar (sem nota)"
- [ ] Venda é processada
- [ ] Redireciona para cupom.html
- [ ] Cupom mostra: data, itens, total, forma pagamento, troco

**Checklist:**
- [ ] Cupom formatado para 80mm
- [ ] Botão "Imprimir cupom" funciona (abre print do navegador)
- [ ] Botão "Enviar recibo no WhatsApp" aparece se cliente tem telefone

### 2.5 Histórico de vendas
- [ ] Abrir http://localhost:3003/historico.html
- [ ] Última venda que foi finalizada aparece na lista
- [ ] Filtros de data funcionam (buscar por período)

**Checklist:**
- [ ] Venda recém-criada está listada
- [ ] Filtro por mês/período funciona

### 2.6 Trocas/Devoluções
- [ ] Abrir http://localhost:3003/trocas.html
- [ ] Clicar "Processar uma troca"
- [ ] Buscar uma venda recente (da que foi feita acima)
- [ ] Sistema valida: 7 dias limite
- [ ] Selecionar item a devolver
- [ ] Sistema pede autorização (input)
- [ ] Confirmar devolução
- [ ] Estoque volta ao normal

**Checklist:**
- [ ] Troca dentro de 7 dias → permite
- [ ] Troca fora de 7 dias → bloqueia
- [ ] Estoque incrementa após devolução

---

## 💰 BLOCO 3: CAIXA (20 min)

### 3.1 Caixa do dia — Resumo
- [ ] Abrir http://localhost:3003/caixa.html
- [ ] Mostrar cards: Dinheiro (gaveta), PIX (conta), Total aberto
- [ ] Gaveta mostra valor da venda anterior em dinheiro
- [ ] Conta mostra valor de PIX/transferência

**Checklist:**
- [ ] Valores batem com o que foi vendido
- [ ] Dinheiro está na gaveta, PIX na conta

### 3.2 Caixa — Suprimento
- [ ] Clicar "Adicionar suprimento" (dinheiro pra gaveta)
- [ ] Inserir valor (ex: R$50)
- [ ] Selecionar método: depositar cheque, buscar dinheiro, etc.
- [ ] Gaveta aumenta em R$50

**Checklist:**
- [ ] Suprimento entra corretamente na gaveta
- [ ] Movimiento registrado na lista

### 3.3 Caixa — Sangria
- [ ] Clicar "Sangria" (sacar dinheiro da gaveta)
- [ ] Inserir valor (ex: R$30)
- [ ] Inserir motivo
- [ ] Gaveta diminui em R$30

**Checklist:**
- [ ] Sangria sai corretamente
- [ ] Movimento registrado

### 3.4 Caixa — Fechamento
- [ ] Clicar "Fechar caixa do dia"
- [ ] Sistema pede confirmação
- [ ] Modal mostra resumo (dinheiro final, movimentos)
- [ ] Confirmado → caixa fecha
- [ ] PDV agora exige reabertura para vender

**Checklist:**
- [ ] Fechamento bloqueia vendas até reabertura
- [ ] Dados salvos

---

## 📊 BLOCO 4: FINANCEIRO (20 min)

### 4.1 Despesas — Conta a pagar
- [ ] Abrir http://localhost:3003/financeiro.html
- [ ] Clicar aba "Contas a pagar"
- [ ] Se não houver despesas, criar uma: clicar "+ Nova despesa"
  - Nome: "Aluguel"
  - Valor: R$ 5.000
  - Data vencimento: hoje
  - Categoria: Aluguel
  - Salvar
- [ ] Despesa aparece em "Contas a pagar"
- [ ] Status: Não pago

**Checklist:**
- [ ] Despesa aparece na lista
- [ ] Campo de valor preenchido corretamente

### 4.2 Despesas — Pagar uma despesa
- [ ] Clicar botão "Pagar" na despesa
- [ ] Modal abre com:
  - [ ] Forma de pagamento (dinheiro/pix/cartão/transferência/boleto)
  - [ ] Data de pagamento
  - [ ] Aviso se caixa fechado
- [ ] Selecionar forma: "Dinheiro"
- [ ] Clicar "Confirmar pagamento"
- [ ] Despesa sai de "Contas a pagar" (muda status pra "Pago")
- [ ] Abrir caixa.html → Sangria foi registrada automaticamente

**Checklist:**
- [ ] Despesa marca como paga
- [ ] Caixa registra sangria automática

### 4.3 DRE (Demonstração de Resultado)
- [ ] Abrir http://localhost:3003/fluxo.html
- [ ] Selecionar mês atual
- [ ] Mostra:
  - [ ] Receita bruta (vendas)
  - [ ] Custo (itens * custo)
  - [ ] Margem bruta
  - [ ] Despesas operacionais (fixas + variáveis)
  - [ ] Lucro operacional
  - [ ] Impostos (MEI ou Simples conforme config)
  - [ ] Pró-labore (subtraído após imposto)
  - [ ] Lucro líquido

**Checklist:**
- [ ] Números batem com as vendas criadas
- [ ] Pró-labore está separado (não é despesa operacional)
- [ ] Regime fiscal está configurado (MEI ou Simples)

### 4.4 Fluxo de Caixa
- [ ] Abrir http://localhost:3003/fluxo-caixa.html
- [ ] Selecionar "Diário"
- [ ] Escolher uma data (preferente hoje ou dia da venda)
- [ ] Mostra: Entradas, Saídas, Saldo
- [ ] Selecionar "Semanal"
- [ ] Navegar semanas com botões
- [ ] Mostra agregado de seg-dom
- [ ] Selecionar "Mensal"
- [ ] Mostra calendário completo

**Checklist:**
- [ ] Diário mostra a venda como entrada
- [ ] Semanal agrega dados da semana
- [ ] Mensal mostra mês todo
- [ ] Números batem com caixa real

### 4.5 Configuração de prazos de maquininha
- [ ] Abrir http://localhost:3003/config.html
- [ ] Descer até "Maquininha / Prazos de recebimento"
- [ ] Campos aparecem:
  - [ ] Débito: dias + tipo (úteis/corridos)
  - [ ] Crédito à vista: dias + tipo
  - [ ] Crédito parcelado: dias + tipo
- [ ] Mudar valores (ex: débito pra 2 dias)
- [ ] Salvar
- [ ] Voltar para Fluxo de Caixa
- [ ] Datas de recebimento se ajustam (débito agora é dia+2)

**Checklist:**
- [ ] Config salva corretamente
- [ ] Fluxo de caixa recalcula prazos

---

## 📦 BLOCO 5: ESTOQUE (15 min)

### 5.1 Produtos — Cadastro com foto
- [ ] Abrir http://localhost:3003/produtos.html
- [ ] Clicar "+ Nova peça"
- [ ] Modal de cadastro abre
- [ ] **Seção "Fotos da peça":**
  - [ ] Input "Fotos" aparece (até 5)
  - [ ] Clicar área de upload
  - [ ] Selecionar uma imagem do computador
  - [ ] Foto aparece na galeria (thumbnail)
  - [ ] Dica: "primeira foto é a capa"
- [ ] Preencher:
  - Nome: "Vestido Floral"
  - Categoria: selecionar
  - Preço venda: R$ 150
  - Custo: R$ 50
- [ ] Grade de tamanhos: marcar P, M, G
  - P: 5 unidades
  - M: 8 unidades
  - G: 3 unidades
- [ ] Clicar "Salvar peça"
- [ ] Volta lista
- [ ] Nova peça aparece com foto pequena (capa)

**Checklist:**
- [ ] Upload aceitou imagem
- [ ] Foto aparece na lista (thumbnail)
- [ ] Foto aparece no PDV quando busca o produto

### 5.2 Estoque — Entrada em lote
- [ ] Abrir http://localhost:3003/lote.html
- [ ] Clicar "Baixar template CSV"
- [ ] Arquivo baixa (lote_template.csv)
- [ ] Abrir em Excel/Sheets, preencher:
  ```
  Codigo,Tamanho,Quantidade,Motivo
  VES001,P,10,Compra
  VES001,M,15,Compra
  VES001,G,8,Compra
  ```
- [ ] Salvar como CSV
- [ ] Volta pro navegador
- [ ] Clicar "Selecionar arquivo" e enviar
- [ ] Preview aparece com linhas validadas (✅ se ok, ❌ se erro)
- [ ] Se tudo ok, clicar "Importar"
- [ ] Volta em Estoque → quantidades subiram

**Checklist:**
- [ ] Template baixa corretamente
- [ ] Upload de arquivo funciona
- [ ] Preview mostra validação
- [ ] Import atualiza estoque

### 5.3 Estoque — Movimentos
- [ ] Abrir http://localhost:3003/estoque.html
- [ ] Clicar em um produto
- [ ] Abas aparecem: Movimentos, Saídas
- [ ] Aba "Movimentos" mostra histórico de entrada/saída
- [ ] Cada movimento tem: data, tipo, quantidade, motivo, responsável

**Checklist:**
- [ ] Movimentos registram entrada do lote
- [ ] Movimentos registram saída das vendas

---

## 👥 BLOCO 6: CLIENTES & EQUIPE (10 min)

### 6.1 Clientes — Novo cliente no PDV
- [ ] Volta no PDV (já na venda anterior)
- [ ] Campo "Cliente" aparece (na seção de pagamento)
- [ ] Clicar lupa (buscar cliente)
- [ ] Digitar nome de um cliente criado anteriormente
- [ ] Cliente aparece na lista (abaixo)
- [ ] Clicar para selecionar
- [ ] Badge do cliente aparece (com botão trocar)

**Checklist:**
- [ ] Busca de cliente funciona
- [ ] Cliente selecionado aparece no cupom

### 6.2 Clientes — Histórico
- [ ] Abrir http://localhost:3003/clientes.html
- [ ] Clicar em um cliente
- [ ] Abas: Dados, Histórico de compras
- [ ] Aba histórico mostra vendas do cliente
- [ ] Cada venda: data, itens, total

**Checklist:**
- [ ] Cliente aparece na lista
- [ ] Histórico mostra vendas

### 6.3 Equipe — Vendedores
- [ ] Abrir http://localhost:3003/vendedores.html
- [ ] Criar novo vendedor: clicar "+ Novo vendedor"
  - Nome: "Maria"
  - Comissão: 5% (percentual)
- [ ] Salvar
- [ ] Volta lista
- [ ] Vendedor aparece

**Checklist:**
- [ ] Vendedor aparece na lista
- [ ] Aparece no select de vendedores do PDV

---

## ⚙️ BLOCO 7: CONFIGURAÇÕES (10 min)

### 7.1 Identidade da loja
- [ ] Abrir http://localhost:3003/config.html
- [ ] Seção "Sua loja":
  - [ ] Nome da loja
  - [ ] Logo (upload)
  - [ ] Cor da marca (color picker)
  - [ ] Endereço, Instagram, telefone
- [ ] Mudar cor da marca
- [ ] Salvar
- [ ] Abrir Dashboard (index.html) → cor foi aplicada (topbar, botões)

**Checklist:**
- [ ] Logo carrega corretamente
- [ ] Cor é aplicada ao sistema todo
- [ ] Dados aparecem no cupom

### 7.2 Regime fiscal
- [ ] Config.html, seção "Fiscal"
- [ ] Regime: MEI ou Simples Nacional
- [ ] Se Simples: aliquota (ex: 7,3%)
- [ ] Salvar
- [ ] Abrir DRE (fluxo.html)
- [ ] Impostos calculam conforme regime

**Checklist:**
- [ ] Regime salva
- [ ] DRE recalcula impostos

### 7.3 Meta de vendas
- [ ] Config.html, seção "Metas"
- [ ] Meta dia: R$ 2.000
- [ ] Meta mês: R$ 40.000
- [ ] Salvar
- [ ] Abrir Dashboard
- [ ] Anéis mostram progresso vs meta

**Checklist:**
- [ ] Meta salva
- [ ] Dashboard mostra anéis com progresso

---

## 🚨 BLOCO 8: CASOS EXTREMOS (10 min)

### 8.1 Sem estoque
- [ ] PDV, buscar produto
- [ ] Produto com quantidade zerada
- [ ] Botão de tamanho fica desabilitado (cinza)
- [ ] Não consegue adicionar

**Checklist:**
- [ ] Produto sem estoque não entra no carrinho

### 8.2 Devolução fora do prazo (>7 dias)
- [ ] Trocas.html, buscar venda antiga (>7 dias)
- [ ] Sistema bloqueia: "Prazo de troca expirado"

**Checklist:**
- [ ] Validação de 7 dias funciona

### 8.3 Caixa fechado
- [ ] Fechar caixa (caixa.html)
- [ ] Tentar vender (PDV)
- [ ] Modal de reabertura obriga abrir antes

**Checklist:**
- [ ] PDV bloqueia até abrir caixa

### 8.4 Logout & permissões
- [ ] Se houver 2 usuários (admin + vendedor):
  - [ ] Vendedor NÃO vê Config
  - [ ] Vendedor NÃO vê Financeiro
  - [ ] Admin vê tudo
- [ ] Se só 1 usuário: saltar este teste

**Checklist:**
- [ ] Papéis funcionam (se houver múltiplos)

---

## 📋 RESUMO DOS TESTES

| Bloco | Testes | Status |
|-------|--------|--------|
| Auth | 3 | [ ] Passou |
| Vendas | 6 | [ ] Passou |
| Caixa | 4 | [ ] Passou |
| Financeiro | 5 | [ ] Passou |
| Estoque | 3 | [ ] Passou |
| Clientes & Equipe | 3 | [ ] Passou |
| Config | 3 | [ ] Passou |
| Casos extremos | 4 | [ ] Passou |
| **TOTAL** | **31 testes** | [ ] **PRONTO PARA LANÇAR** |

---

## 🔴 BLOQUEADORES CRÍTICOS
Se algum desses falhar, **NÃO lançar**:
- [ ] Login/Auth funcionando
- [ ] PDV consegue fazer uma venda completa (do início ao cupom)
- [ ] Cupom imprime/exibe corretamente
- [ ] Caixa registra a venda
- [ ] Financeiro mostra os valores

---

## 📝 NOTAS

**Data do teste:** 2026-06-11  
**Testado por:** _________________  
**Bugs encontrados:** (listar aqui)  
**Status final:** [ ] Pronto [ ] Bloqueado [ ] Revisar

