# 🚀 DEPLOY - EasyGestão para AWS EC2

## 📊 INFORMAÇÕES DO SERVIDOR

| Campo | Valor |
|-------|-------|
| **IP Público** | `54.232.77.5` |
| **Usuário SSH** | `ubuntu` |
| **Caminho da App** | `/opt/easygestion` |
| **Chave Privada** | `easygestion-key.pem` (na pasta raiz) |
| **Porta Aplicação** | `3001` (Node.js) |
| **Proxy** | `Nginx` (porta 80/443) |
| **Process Manager** | `PM2` |
| **Banco de Dados** | `SQLite` (/var/lib/easygestion/db) |

---

## ⚡ DEPLOY RÁPIDO (Linux/Mac/WSL)

```bash
# 1. Dar permissão à chave
chmod 400 easygestion-key.pem

# 2. Conectar ao servidor
ssh -i easygestion-key.pem ubuntu@54.232.77.5

# 3. Dentro do servidor:
cd /opt/easygestion
git pull origin main
npm install --production
pm2 restart easygestion
pm2 save

# 4. Verificar se tá online
curl http://localhost:3001/health
```

---

## 🔧 DEPLOY AUTOMÁTICO (PowerShell Windows)

```powershell
# Execute este comando no PowerShell da pasta raiz:
.\DEPLOY_SCRIPT.sh
```

Ou se preferir via SSH direto do Windows:

```powershell
ssh -i "easygestion-key.pem" ubuntu@54.232.77.5 "cd /opt/easygestion && git pull origin main && npm install --production && pm2 restart easygestion && pm2 save"
```

---

## 📋 PASSO A PASSO MANUAL

### 1️⃣ Conectar ao Servidor

```bash
ssh -i easygestion-key.pem ubuntu@54.232.77.5
```

### 2️⃣ Atualizar Código

```bash
cd /opt/easygestion
git pull origin main
```

### 3️⃣ Instalar Dependências (se package.json mudou)

```bash
npm install --production
```

### 4️⃣ Reiniciar Aplicação

```bash
pm2 restart easygestion
pm2 save
```

### 5️⃣ Verificar Status

```bash
pm2 status
pm2 logs easygestion
```

### 6️⃣ Testar Aplicação

```bash
# No seu PC, abra:
http://54.232.77.5:3001
# Ou via domínio:
https://easygestion.com.br
```

---

## 🐛 TROUBLESHOOTING

### ❌ "Connection refused" (Servidor offline)

```bash
# Verificar se EC2 está running no AWS Console
# Se sim, aguarde 2-3 minutos para iniciar

# Verificar status:
ssh -i easygestion-key.pem ubuntu@54.232.77.5 "ps aux | grep node"
```

### ❌ "npm: not found"

```bash
# Instalar Node.js:
ssh -i easygestion-key.pem ubuntu@54.232.77.5 << 'EOF'
curl -fsSL https://deb.nodesource.com/setup_24.x | sudo -E bash -
sudo apt install -y nodejs npm
node --version
EOF
```

### ❌ "pm2: not found"

```bash
ssh -i easygestion-key.pem ubuntu@54.232.77.5 "sudo npm install -g pm2"
```

### ❌ Aplicação não responde (3001)

```bash
ssh -i easygestion-key.pem ubuntu@54.232.77.5 << 'EOF'
# Ver logs de erro
pm2 logs easygestion

# Reiniciar se travou
pm2 kill
pm2 start ecosystem.config.js
EOF
```

### ❌ Porta 80/443 não funciona (Nginx)

```bash
ssh -i easygestion-key.pem ubuntu@54.232.77.5 << 'EOF'
# Verificar Nginx
sudo nginx -t
sudo systemctl restart nginx
sudo systemctl status nginx
EOF
```

---

## 📊 MONITORAR APLICAÇÃO

### Ver Logs em Tempo Real

```bash
ssh -i easygestion-key.pem ubuntu@54.232.77.5 "pm2 logs easygestion"
```

### Ver Status de Todos os Processos

```bash
ssh -i easygestion-key.pem ubuntu@54.232.77.5 "pm2 status"
```

### Ver Uso de CPU/Memória

```bash
ssh -i easygestion-key.pem ubuntu@54.232.77.5 "pm2 monit"
```

---

## 🔒 SEGURANÇA - IMPORTANTE

### ⚠️ Nunca compartilhe:
- `easygestion-key.pem` (a chave privada)
- Credenciais do `.env` (senhas, API keys)
- IP do servidor em público

### ✅ Melhorias recomendadas:
1. Usar **Elastic IP** no AWS (IP não muda ao reiniciar)
2. Apontar domínio para o IP (deixa `54.232.77.5` escondido)
3. Usar **Security Groups** para restringir SSH apenas ao seu IP
4. Ativar **CloudWatch** para monitoramento

---

## 📅 CHECKLIST PÓS-DEPLOY

- [ ] Código foi atualizado (`git pull` executado)
- [ ] Dependências foram instaladas (`npm install`)
- [ ] Aplicação foi reiniciada (`pm2 restart`)
- [ ] Acessar `https://easygestion.com.br` funciona
- [ ] Admin consegue fazer login
- [ ] Produtos carregam corretamente
- [ ] Estoque funciona
- [ ] PDV e vendas respondem

---

## 🆘 SUPORTE RÁPIDO

Se algo der errado:

1. **Verificar logs:**
   ```bash
   ssh -i easygestion-key.pem ubuntu@54.232.77.5 "pm2 logs easygestion | tail -50"
   ```

2. **Verificar se servidor tá online:**
   ```bash
   ping 54.232.77.5
   ```

3. **Tentar reconectar e reiniciar:**
   ```bash
   ssh -i easygestion-key.pem ubuntu@54.232.77.5 "pm2 restart easygestion && sleep 5 && pm2 logs easygestion"
   ```

---

**Última atualização:** 2026-06-24  
**Versão:** 1.0
