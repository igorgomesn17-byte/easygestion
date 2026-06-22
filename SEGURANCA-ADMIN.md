# 🔐 Segurança do Admin — Configuração Obrigatória

## ⚠️ Problema Corrigido

**Antes:** Em produção, se `ADMIN_SENHA_HASH` não estava setado, o sistema usava fallback hardcoded `"dsstore"` (senha de desenvolvimento). Isso deixava o sistema acessível com uma senha conhecida.

**Agora:** Em produção, o sistema **obriga** uma das duas opções:
- `ADMIN_SENHA_HASH` (recomendado)
- `ADMIN_SENHA` (será hasheado ao boot)

Se nenhuma estiver configurada e `NODE_ENV=production`, o servidor **falha no boot** com erro claro.

---

## ✅ Como Configurar em Produção

### Opção 1: ADMIN_SENHA_HASH (Recomendado)

**Vantagem:** Senha já vem em hash, nunca passa em texto plano.

**Passo 1:** Gere um hash com o script:
```bash
node scripts/criar-admin.js
```

Siga as prompts:
```
Digite sua nova senha: SuaSenhaForte123***REMOVED***@#
Confirme a senha: SuaSenhaForte123***REMOVED***@#
```

O script exibe algo como:
```
✅ Hash gerado:
scrypt$f4a3e9d7c2b1a8e6d5f4c3b2a1f0e9d8$8f7e6d5c4b3a2f1e0d9c8b7a6f5e4d3c2b1a0f9e8d7c6b5a4f3e2d1c0b9a
```

**Passo 2:** Configure em produção (Render, Docker, etc):
```bash
export ADMIN_SENHA_HASH="scrypt$f4a3e9d7c2b1a8e6d5f4c3b2a1f0e9d8$8f7e6d5c4b3a2f1e0d9c8b7a6f5e4d3c2b1a0f9e8d7c6b5a4f3e2d1c0b9a"
```

**No Render:**
1. Vá para projeto > Environment
2. Adicione variável: `ADMIN_SENHA_HASH = scrypt$...`
3. Deploy

### Opção 2: ADMIN_SENHA (Simples)

**Vantagem:** Mais fácil — basta uma senha forte.
**Desvantagem:** Senha em texto plano na variável de ambiente (menos seguro).

**Passo 1:** Configure uma senha forte (8+ chars, maiúscula, minúscula, número, símbolo):
```bash
export ADMIN_SENHA="SenhaForte123***REMOVED***@#"
```

**Sistema valida:**
- ✅ Mínimo 8 caracteres
- ✅ Pelo menos uma maiúscula (A-Z)
- ✅ Pelo menos uma minúscula (a-z)
- ✅ Pelo menos um número (0-9)
- ✅ Pelo menos um símbolo (***REMOVED***@#$%^&*...)

Se a senha não atender, server falha no boot com mensagem clara.

---

## 🚨 O Que Acontece Se Não Configurar

### Em Desenvolvimento (NODE_ENV=development)
✅ Funciona — usa fallback `"dsstore"` para facilitar testes

### Em Produção (NODE_ENV=production)
❌ **ERRO NO BOOT:**
```
❌ ERRO CRÍTICO: Senha do admin não está configurada***REMOVED***

Em produção, você DEVE definir uma das variáveis de ambiente:
  • ADMIN_SENHA_HASH  (recomendado: já em hash scrypt)
  • ADMIN_SENHA       (alternativo: será hasheada ao boot)

Exemplo com ADMIN_SENHA_HASH (seguro):
  export ADMIN_SENHA_HASH="scrypt$<salt>$<hash>"

Exemplo com ADMIN_SENHA (simples):
  export ADMIN_SENHA="SuaSenhaForte123***REMOVED***@#"

NÃO use o fallback de desenvolvimento (dsstore) em produção***REMOVED***
```

---

## 📝 Banco de Dados vs Env

### Admin do .env (ADMIN_SENHA_HASH)
- Definido em variáveis de ambiente
- Usad o para login no backoffice (`/admin`)
- NÃO aparece na tabela `usuarios`
- Login: `POST /api/admin/login { nome: "admin", senha: "..." }`

### Admin do Banco (usuarios.papel='admin')
- Criado com `node scripts/criar-admin.js`
- Fica na tabela `usuarios` (DB)
- Pode ter permissões específicas
- Também acessa `/admin`

**Fluxo:**
1. Tenta buscar `usuarios` com `nome` e `papel='admin'`
2. Se não acha, tenta `ADMIN_SENHA_HASH` do .env
3. Se nenhum funciona → 401 "Usuário ou senha incorretos"

---

## 🔍 Validação de Login

### Resposta em Sucesso
```json
{
  "sucesso": true,
  "mensagem": "Logado como administrador",
  "usuario": "admin",
  "origen": "env"  // ou "db"
}
```

### Resposta em Erro
```json
{
  "erro": "Usuário ou senha incorretos.",
  "dica": "Verifique a senha."
}
```

Ou:
```json
{
  "erro": "Usuário ou senha incorretos.",
  "dica": "Usuário admin não existe. Use o script: node scripts/criar-admin.js"
}
```

---

## 📊 Logging

Todas as tentativas de login de admin são registradas:

```
[ADMIN] ✅ Login bem-sucedido: admin (env) • IP: 203.0.113.1 • 2026-06-22T15:30:45Z
[ADMIN] ❌ Login falhou: admin (senha incorreta) • IP: 203.0.113.2 • 2026-06-22T15:35:12Z
[ADMIN] ❌ Login falhou: admin (usuário não encontrado) • IP: 203.0.113.3 • 2026-06-22T15:40:00Z
```

---

## ✅ Checklist para Deploy

- [ ] `NODE_ENV=production` configurado
- [ ] `SESSION_SECRET` = string 32+ chars aleatória
- [ ] `ADMIN_SENHA_HASH` OU `ADMIN_SENHA` setado
- [ ] `ORIGIN` = seu domínio (ex: https://seu-dominio.com)
- [ ] Testar login em `/admin` antes de colocar em produção
- [ ] Verificar logs para confirmar que não usa fallback "dsstore"

---

## 🛡️ Boas Práticas

1. **Use ADMIN_SENHA_HASH em produção** (mais seguro)
2. **Rotacione senhas regularmente** (altere via `node scripts/criar-admin.js`)
3. **Use senha forte:** 12+ chars com símbolos
4. **Enable MFA** (autenticação de dois fatores) — futuro
5. **Monitore logs** de login em `/admin` (detectar força bruta)
6. **Não commite .env** — está em `.gitignore`

---

## Referências

- Script: `scripts/criar-admin.js`
- Rota de login: `routes/admin.js`
- Middleware de segurança: `middleware/seguranca.js`
- Configuração: `.env.example`
