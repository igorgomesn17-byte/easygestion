# ✅ CHECKLIST PRÉ-DEPLOY (IMPRIMÍVEL)

**Data:** 2026-06-23  
**Responsável:** ________________  
**Assinado em:** ________________  

---

## 📋 FASE 1: CÓDIGO & LGPD (Dia 1)

### Desenvolvimento
- [ ] Criar `routes/conta.js` com 3 endpoints (export, delete, status)
- [ ] Montar rota em `server.js` linha 175
- [ ] Testar GET /api/conta/dados-export (retorna ZIP JSON)
- [ ] Testar POST /api/conta/solicitar-delecao (agenda 30 dias)
- [ ] Testar GET /api/conta/status-delecao
- [ ] Testar DELETE /api/conta/cancelar-delecao

### UI/UX
- [ ] Atualizar `public/minha-conta.html` com botões LGPD
- [ ] Adicionar CSS para seção LGPD
- [ ] Adicionar JavaScript (exportarDados, solicitarDelecao, etc)
- [ ] Testar UX: cliente consegue clicar? Funciona? Email chega?

### Testes Manuais LGPD
- [ ] Registrar cliente teste (teste@lgpd.test)
- [ ] Login como cliente teste
- [ ] Clicar em "Exportar dados" → ZIP gerado
- [ ] Verificar email: link de download chega
- [ ] Fazer download do ZIP → contém JSON
- [ ] Clicar em "Solicitar deleção" → confirmação
- [ ] Verificar data_delecao = hoje + 30 dias
- [ ] Verificar email de confirmação chega
- [ ] Clicar "Cancelar deleção" → reversa
- [ ] Confirmar que deleção foi cancelada

---

## 🔐 FASE 2: CRIPTOGRAFIA (Dia 2)

### Backup Encryption
- [ ] Atualizar `lib/backup-scheduler.js` com AES-256-CBC
- [ ] Implementar `criptografarBackup()` (salt + iv + encrypted)
- [ ] Implementar `descriptografarBackup()` (reverse)
- [ ] Adicionar `BACKUP_ENCRYPT_KEY` ao `.env`
- [ ] Gerar chave segura: `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`
- [ ] Verificar `.env` tem chave (mínimo 32 chars)

### Upload S3
- [ ] Testar upload: arquivo gerado como `.db.enc`
- [ ] Verificar metadata: cipher=aes-256-cbc, kdf=pbkdf2
- [ ] Testar restore: descriptografar recupera DB original
- [ ] Verificar bucket ACL: PRIVATE (não público)

### Testes Criptografia
- [ ] Executar backup manualmente
- [ ] Verificar arquivo: `backup-2026-06-23-*.db.enc`
- [ ] Tentar abrir em editor: ILEGÍVEL (ótimo!)
- [ ] Restaurar: `descriptografarBackup(arquivo, BACKUP_ENCRYPT_KEY)`
- [ ] Verificar: DB recuperado = original
- [ ] Testar com senha errada: erro "falha ao descriptografar"

---

## 🧪 FASE 3: QA & TESTES (Dia 3-4)

### Load Testing
- [ ] Criar 50 clientes teste simultaneamente
- [ ] Simular 50 requests/segundo por 10 minutos
- [ ] Verificar: CPU < 70%, Memory < 80%, DB connections < 50
- [ ] Latência média < 2s, P99 < 5s
- [ ] Sem timeout, sem erro 500

### Edge Cases
- [ ] Cancelar deleção após 29 dias (1 dia antes)
- [ ] Tentar cancelar deleção após 30 dias (deve falhar)
- [ ] Exportar dados com 10k vendas (ZIP < 50MB)
- [ ] Restaurar backup com senha errada (erro claro)
- [ ] Backup de arquivo vazio (raro, mas testar)

### Security Review
- [ ] Senhas de teste NÃO estão em logs
- [ ] BACKUP_ENCRYPT_KEY não está em console.log()
- [ ] SQL injection: não há (prepared statements)
- [ ] CORS está restrito a ORIGIN
- [ ] Rate limit está ativo (100 req/15min)
- [ ] CSV injection: não há (JSON, não CSV)

### Regression Testing
- [ ] Login ainda funciona
- [ ] Pagamentos Stripe ainda funcionam
- [ ] Cobrança automática ainda funciona
- [ ] Bloqueio por atraso ainda funciona
- [ ] Backup diário ainda funciona
- [ ] Webhooks ainda recebem eventos

---

## 🏥 FASE 4: OPERAÇÃO (Dia 4-5)

### Monitoring & Alertas
- [ ] Endpoint `/health` criado e retorna 200
- [ ] Monitoramento ativo (Uptime Robot, Sentry)
- [ ] Alertas configuradas (Discord/Slack/email)
- [ ] On-call definido: quem responde emergência?
- [ ] Runbook escrito: "Servidor caiu, o que fazer?"

### Documentação
- [ ] README.md atualizado com LGPD
- [ ] API docs: endpoints LGPD documentados
- [ ] Operação: como restaurar backup criptografado
- [ ] Segurança: BACKUP_ENCRYPT_KEY é crítica
- [ ] Rollback: como desfazer deploy em 5 min

### Staging Environment
- [ ] Deploy em staging feito
- [ ] Smoke tests em staging:
  - [ ] Registrar cliente
  - [ ] Login funciona
  - [ ] Exportar dados funciona
  - [ ] Solicitar deleção funciona
  - [ ] Pagamento Stripe funciona
  - [ ] Scheduler executa (manualmente forçar)
  - [ ] Backup executado (testar restore)
- [ ] Logs verifica: nenhum erro 500
- [ ] Performance medida: latência OK?

### Produção Prep
- [ ] Backup de produção feito (ANTES do deploy)
- [ ] Rollback plan testado (consegue voltar?)
- [ ] DNS está pronto (apontar para novo servidor)
- [ ] CDN cacheado (limpar caches)
- [ ] On-call disponível (24h monitoramento)

---

## 🚀 FASE 5: DEPLOY (Dia 5-6)

### Pré-Deploy
- [ ] Todas as fases anteriores completadas ✅
- [ ] Nenhum checklist item marcado ❌
- [ ] Code review aprovado
- [ ] Teste de segurança passado
- [ ] On-call confirmado

### Deploy (Gradual)
- [ ] Deploy 10% do tráfego (canary)
  - [ ] Esperar 10 minutos
  - [ ] Monitorar erros: 0 erros 500?
  - [ ] Latência OK? (<2s)
  - [ ] Se OK: próximo passo
  - [ ] Se erro: rollback imediato

- [ ] Deploy 50% do tráfego
  - [ ] Esperar 30 minutos
  - [ ] Testar endpoints críticos:
    - [ ] GET /api/me (autenticação)
    - [ ] POST /api/assinaturas/checkout (pagamento)
    - [ ] POST /api/conta/dados-export (LGPD)
    - [ ] GET /health (monitoring)

- [ ] Deploy 100% do tráfego
  - [ ] Esperar 1 hora
  - [ ] Monitor geral
  - [ ] Customer support pronto para calls

### Pós-Deploy (24h)
- [ ] Monitoramento ativo: CPU, Memory, Latência
- [ ] Nenhum erro 500 por 1 hora
- [ ] Nenhum alert crítica disparada
- [ ] Clientes reportando uso normal
- [ ] Scheduler rodou no horário correto
- [ ] Backup foi feito automaticamente
- [ ] On-call não foi acionado (ou resolveu rápido)

---

## 📊 RESUMO DE ASSINATURAS

```
╔═════════════════════════════════════════╗
║ APROVAÇÃO DE DEPLOY                     ║
╠═════════════════════════════════════════╣
║                                         ║
║ Desenvolvimento .................... ___
║ QA/Testes ......................... ___
║ Segurança ......................... ___
║ Operação .......................... ___
║ Executivo ......................... ___
║                                         ║
║ Data: ________________                 ║
║                                         ║
╚═════════════════════════════════════════╝
```

---

## 📈 STATUS POR DATA

### 2026-06-24
```
LGPD: ☐ Iniciado ☐ Em progresso ☐ Completado
Tempo estimado: 4-5 horas
```

### 2026-06-25
```
Encryption: ☐ Iniciado ☐ Em progresso ☐ Completado
Tempo estimado: 4 horas
```

### 2026-06-26
```
QA/Review: ☐ Iniciado ☐ Em progresso ☐ Completado
Tempo estimado: 4-5 horas
```

### 2026-06-27
```
Staging: ☐ Iniciado ☐ Em progresso ☐ Completado
Tempo estimado: 4 horas
```

### 2026-06-28
```
Prod Prep: ☐ Iniciado ☐ Em progresso ☐ Completado
Tempo estimado: 2 horas
On-call: ☐ Confirmado
```

### 2026-06-29
```
DEPLOY: ☐ Canary 10% ☐ Canary 50% ☐ Full 100%
Monitoramento: ☐ 24h em atividade
```

---

## 🎯 DECISÃO FINAL

**Todas as caixas foram marcadas?**

- [ ] ✅ SIM → Aprovado para Deploy
- [ ] ⚠️ PARCIAL → Ressalvas (listar):
  ```
  ___________________________________________
  ___________________________________________
  ___________________________________________
  ```
- [ ] ❌ NÃO → Bloqueado (listar):
  ```
  ___________________________________________
  ___________________________________________
  ___________________________________________
  ```

---

## 📞 EMERGÊNCIA

**Se der problema durante deploy:**

1. **Rollback imediato**: `git revert <commit>`
2. **Notifique**: on-call, tech lead, executivo
3. **Log do erro**: Screenshot de logs/monitoramento
4. **Root cause**: Qual foi o problema?
5. **Fix**: Quanto tempo para corrigir?
6. **Retry**: Quando tentar novamente?

**Contatos de emergência:**
- Tech Lead: ___________________________
- On-Call: ___________________________
- Executivo: ___________________________

---

**Imprimível em 4 páginas.** Print, preencha com caneta, fotografe, anexe em email.

Boa sorte! 🚀
