# 🔍 Discovery: Módulo Financeiro JÁ EXISTE***REMOVED***

> Auditoria do código copiado de SAAS para DRE-EXPRESS

---

## ✅ O QUE JÁ ESTÁ IMPLEMENTADO

### 1. **Banco de Dados (Schema)**
- ✅ Tabela `despesas` — despesas fixas/variáveis, recorrentes, com vencimento
- ✅ Tabela `nfce` — emissão de NFC-e, integração com Focus
- ✅ Suporte a migrations idempotentes (ALTER TABLE)

### 2. **Rotas API**
- ✅ `/api/despesas` — CRUD completo (GET, POST, PUT, DELETE)
  - Filtros: por mês, centro (empresa/pessoal), status (pago/apagar)
  - Suporte a despesas recorrentes (fixas mensais)
  - Endpoint `/gerar-mes` para gerar despesas do mês automaticamente
  
- ✅ `/api/financeiro` — análise completa
  - `/fluxo` — entradas vs saídas do mês
  - `/dre` — Demonstração de Resultado (receita, custos, lucro)
  - `/curva-abc` — classificação de produtos por faturamento
  
- ✅ `/api/nfce` — emissão de cupom fiscal
  - `/config` — status da integração Focus
  - `/emitir/:vendaId` — emitir NFC-e
  - `/relatorio` — histórico de emissões
  - Suporte a tentativas de reemissão (retry)

### 3. **Frontend (Telas HTML)**
- ✅ `financeiro.html` — gestão de despesas (listar, criar, editar, pagar)
- ✅ `fluxo.html` — visualização de fluxo de caixa (entradas vs saídas)
- ✅ `nfce-relatorio.html` — histórico de emissões fiscais

### 4. **Menu de Navegação**
- ✅ "Despesas" no menu principal (ícone de despesas)
- ✅ "Fluxo & DRE" no menu principal (ícone de gráfico)
- ✅ Descrições no tooltip: "Despesas e contas", "Fluxo de caixa & DRE"

### 5. **Integração com Focus NFC-e**
- ✅ Library `lib/focusNfe.js` — chamadas à API Focus
- ✅ Suporte a dois ambientes: homologação (testes) e produção
- ✅ Armazenamento seguro de certificado A1 (criptografado no banco)
- ✅ Tratamento de erros e rejeições da SEFAZ
- ✅ URLs do DANFE (cupom) e XML autorizado

---

## 📊 O que Falta (MVP)

1. **Tela de Configuração Fiscal** 
   - Upload do certificado A1 (.pfx)
   - Input para inscrição estadual (IE)
   - Input para série/numeração de NFC-e
   - Teste de conexão com Focus

2. **Botão Emitir NFC-e no PDV**
   - Após finalizar venda, opção "Emitir NFC-e"
   - Status visual (✅ autorizada, ⏳ pendente, ❌ erro)

3. **Recibo WhatsApp com NFC-e**
   - Após venda finalizada, enviar recibo no WhatsApp
   - Incluir link para download do DANFE/QRCode

4. **Upload de Foto do Produto**
   - Campo na tela de produtos
   - Exibição no PDV

5. **Entrada de Estoque em Lote**
   - Página pra importar CSV (SKU, tamanho, quantidade)

6. **Polimento UI**
   - Cores/identidade visual do DRE Express
   - Responsividade em celular
   - Testes de usabilidade

---

## 🎯 Roadmap Simplificado

### Semana 1: Fiscal (NFC-e)
```
✅ PRONTO: rotas, banco, lib Focus
⏳ TODO:   tela config, botão PDV, recibo WhatsApp
```

### Semana 2: Polimento
```
✅ PRONTO: financeiro.html, fluxo.html
⏳ TODO:   upload foto, entrada lote, testes
```

### Semana 3: Deploy
```
⏳ TODO:   deploy Render, landing, testes end-to-end
```

---

## 🔧 Próximas Ações (Começar por Aqui)

1. **Criar tela de Config Fiscal** (`config-fiscal.html`)
   - Upload certificado A1
   - Input IE, série
   - Teste conexão Focus

2. **Adicionar botão Emitir NFC-e** no PDV (`pdv.html`)
   - POST /api/nfce/emitir/:vendaId
   - Mostrar status

3. **Teste Manual**
   - Logar em http://localhost:3001
   - Fazer uma venda
   - Tentar emitir NFC-e (vai falhar sem certificado, mas testa fluxo)

---

## 📝 Checklist do MVP

- [x] Banco de dados (despesas, NFC-e)
- [x] Rotas financeiro/despesas
- [x] Rotas NFC-e
- [x] Telas financeiro.html, fluxo.html
- [x] Menu integrado
- [x] Library Focus NFC-e
- [ ] Tela config fiscal
- [ ] Botão emitir NFC-e no PDV
- [ ] Recibo WhatsApp
- [ ] Upload foto produto
- [ ] Entrada estoque lote
- [ ] Testes e polimento
- [ ] Deploy

---

**Conclusão:** O core está 80% pronto. Faltam integrações UI e polimento. MVP em 2 semanas é realista.
