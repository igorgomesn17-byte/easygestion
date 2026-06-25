# Deploy EASYGESTION em DigitalOcean (VPS)

## 🎯 Objetivo
Colocar EasyGestão online em um servidor DigitalOcean em **2-3 horas**.

## 📋 Pre-requisitos
- Conta DigitalOcean (gratuita, cria com email)
- Terminal/SSH client
- Git instalado localmente
- `npm` instalado localmente (já tem)

---

## PASSO 1: Criar Droplet no DigitalOcean (15 min)

### 1.1 Acessar DigitalOcean
1. Vá para https://www.digitalocean.com
2. Crie conta ou entre
3. No painel, clique em **"Create" → "Droplets"**

### 1.2 Configurar Droplet
```
Imagem: Ubuntu 22.04 x64
Tamanho: $6/mês (1 vCPU, 1GB RAM) — OK para beta
Região: São Paulo (spl1) ou New York
Autenticação: SSH Key (copie sua chave pública)
                OU Password (mais fácil, recebe por email)
Hostname: easygestion-prod
```

### 1.3 Pegar IP
Quando droplet ficar "green", você terá um IP público tipo:
```
123.45.67.89
```

**Salve esse IP** — vamos usar pra SSH.

---

## PASSO 2: Conectar ao Servidor (5 min)

### 2.1 SSH no Droplet
```bash
# No seu PC/Mac
ssh root@123.45.67.89
# Responda 'yes' à pergunta de fingerprint
# Você entrará como root@easygestion-prod:~#
```

### 2.2 Atualizar Sistema
```bash
apt update && apt upgrade -y
apt install -y git curl wget build-essential
```

### 2.3 Instalar Node.js (v24)
```bash
curl -fsSL https://deb.nodesource.com/setup_24.x | sudo -E bash -
apt install -y nodejs npm
node --version  # Confirmar v24+
npm --version   # Confirmar npm 10+
```

---

## PASSO 3: Clonar Código do Git (10 min)

### 3.1 Clonar Repositório
```bash
cd /opt
git clone https://github.com/seu-usuario/easygestion.git
cd easygestion
```

### 3.2 Instalar Dependências
```bash
npm install --production
```

### 3.3 Criar Diretório de Banco
```bash
mkdir -p /var/lib/easygestion/db
chown nobody:nogroup /var/lib/easygestion
```

---

## PASSO 4: Configurar Variáveis de Ambiente (10 min)

### 4.1 Gerar Senha de Admin
**Na sua máquina local:**
```bash
node scripts/gerar-hash.js
# Digite sua senha
# Copie o hash gerado
```

### 4.2 Criar .env no Servidor
```bash
# No servidor, como root
cat > /opt/easygestion/.env << 'EOF'
NODE_ENV=production
PORT=3001
ADMIN_SENHA_HASH=scrypt$...cole-o-hash-aqui...
TOKEN_SECRET=seu-uuid-aleatorio-12345678-abcd
DB_DIR=/var/lib/easygestion/db
SENDGRID_API_KEY=SG.seu-key-aqui
STRIPE_SECRET_KEY=sk_test_...
STRIPE_PUBLISHABLE_KEY=pk_test_...
STRIPE_WEBHOOK_SECRET=whsec_...
SITE_URL=https://seu-dominio.com.br
EOF
```

### 4.3 Restringir Permissões
```bash
chmod 600 /opt/easygestion/.env
```

---

## PASSO 5: Instalar PM2 (Gerenciador de Processos)

### 5.1 Instalar Globalmente
```bash
npm install -g pm2
```

### 5.2 Criar Arquivo de Configuração
```bash
cat > /opt/easygestion/ecosystem.config.js << 'EOF'
module.exports = {
  apps: [{
    name: 'easygestion',
    script: 'npm',
    args: 'start',
    cwd: '/opt/easygestion',
    instances: 1,
    exec_mode: 'cluster',
    env: {
      NODE_ENV: 'production'
    },
    error_file: '/var/log/easygestion-error.log',
    out_file: '/var/log/easygestion-out.log',
    log_date_format: 'YYYY-MM-DD HH:mm:ss Z',
    max_memory_restart: '500M',
    autorestart: true,
    watch: false
  }]
};
EOF
```

### 5.3 Iniciar com PM2
```bash
cd /opt/easygestion
pm2 start ecosystem.config.js
pm2 save
pm2 startup
# Siga as instruções para fazer PM2 iniciar no boot
```

### 5.4 Verificar Status
```bash
pm2 status
pm2 logs easygestion
```

---

## PASSO 6: Instalar Nginx (Proxy Reverso)

### 6.1 Instalar Nginx
```bash
apt install -y nginx certbot python3-certbot-nginx
```

### 6.2 Criar Config do Nginx
```bash
cat > /etc/nginx/sites-available/easygestion << 'EOF'
upstream easygestion {
  server 127.0.0.1:3001;
}

server {
  listen 80;
  server_name seu-dominio.com.br www.seu-dominio.com.br;

  # Redirect HTTP → HTTPS
  return 301 https://$server_name$request_uri;
}

server {
  listen 443 ssl http2;
  server_name seu-dominio.com.br www.seu-dominio.com.br;

  # SSL (Let's Encrypt via Certbot)
  ssl_certificate /etc/letsencrypt/live/seu-dominio.com.br/fullchain.pem;
  ssl_certificate_key /etc/letsencrypt/live/seu-dominio.com.br/privkey.pem;

  # Headers de Segurança
  add_header Strict-Transport-Security "max-age=31536000; includeSubDomains" always;
  add_header X-Frame-Options "SAMEORIGIN" always;
  add_header X-Content-Type-Options "nosniff" always;
  add_header X-XSS-Protection "1; mode=block" always;

  # Logging
  access_log /var/log/nginx/easygestion_access.log;
  error_log /var/log/nginx/easygestion_error.log;

  # Proxy reverso
  location / {
    proxy_pass http://easygestion;
    proxy_http_version 1.1;
    proxy_set_header Upgrade $http_upgrade;
    proxy_set_header Connection 'upgrade';
    proxy_set_header Host $host;
    proxy_cache_bypass $http_upgrade;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
  }

  # Limite de upload (100MB)
  client_max_body_size 100M;
}
EOF
```

### 6.3 Ativar Site
```bash
ln -s /etc/nginx/sites-available/easygestion /etc/nginx/sites-enabled/
rm -f /etc/nginx/sites-enabled/default
nginx -t  # Testar sintaxe
systemctl reload nginx
```

### 6.4 Configurar SSL (Let's Encrypt)
```bash
# Substitua seu-dominio.com.br pelo domínio real
certbot certonly --nginx -d seu-dominio.com.br -d www.seu-dominio.com.br
# Follow prompts, escolha email seu

# Renovação automática
certbot renew --dry-run  # Testar
systemctl enable certbot.timer  # Ativar auto-renew
```

---

## PASSO 7: Apontar Domínio (Seu Registrador)

### 7.1 DNS Apontamento
Seu registrador (GoDaddy, NameCheap, etc):
```
Tipo: A
Nome: @ (ou seu-dominio)
Valor: 123.45.67.89  (seu IP DigitalOcean)
TTL: 3600
```

### 7.2 Esperar Propagação (5-30 min)
```bash
# Testar quando resolver
nslookup seu-dominio.com.br
ping seu-dominio.com.br
```

---

## PASSO 8: Backup Automático

### 8.1 Script de Backup Diário
```bash
cat > /usr/local/bin/backup-easygestion.sh << 'EOF'
#***REMOVED***/bin/bash
BACKUP_DIR="/backups"
DB_FILE="/var/lib/easygestion/db/dsstore.db"
DATE=$(date +%Y-%m-%d_%H-%M-%S)

mkdir -p $BACKUP_DIR
cp $DB_FILE $BACKUP_DIR/dsstore_$DATE.db

# Manter só últimas 7 backups
find $BACKUP_DIR -name "dsstore_*.db" -mtime +7 -delete

echo "✅ Backup concluído: $BACKUP_DIR/dsstore_$DATE.db"
EOF

chmod +x /usr/local/bin/backup-easygestion.sh
```

### 8.2 Agendar com Cron
```bash
# Executar todo dia às 2 da manhã
(crontab -l 2>/dev/null; echo "0 2 * * * /usr/local/bin/backup-easygestion.sh") | crontab -
```

---

## PASSO 9: Testar Deploy (15 min)

### 9.1 Acessar pela Web
```
https://seu-dominio.com.br/login.html
```

### 9.2 Fluxo de Teste
1. ✅ Acessa login
2. ✅ Registra conta de teste
3. ✅ Completa onboarding
4. ✅ Cadastra 1 produto
5. ✅ Faz 1 venda
6. ✅ Verifica DRE
7. ✅ Faz 1 troca
8. ✅ Verifica CMV incluído

### 9.3 Verificar Logs
```bash
pm2 logs easygestion
tail -f /var/log/nginx/easygestion_access.log
```

---

## PASSO 10: Monitoramento & Manutenção

### 10.1 Verificar Saúde
```bash
# Todos os dias
pm2 status
df -h  # Espaço em disco
free -h  # Memória
```

### 10.2 Ver Logs
```bash
pm2 logs easygestion --lines 100
```

### 10.3 Reiniciar Aplicação
```bash
pm2 restart easygestion
```

### 10.4 Renovar SSL (automático, mas testar)
```bash
certbot renew --dry-run
```

---

## 📊 Checklist de Deploy

- [ ] Droplet criado em DigitalOcean
- [ ] IP anotado (123.45.67.89)
- [ ] SSH conectado, sistema atualizado
- [ ] Node.js v24 instalado
- [ ] Código clonado do Git
- [ ] .env criado com credenciais
- [ ] PM2 instalado e rodando
- [ ] Nginx configurado
- [ ] SSL (Let's Encrypt) gerado
- [ ] Domínio apontando pro IP
- [ ] Teste completo funcionando
- [ ] Backup automático agendado

---

## 🚨 Troubleshooting

### App não inicia
```bash
pm2 logs easygestion
# Ver erro exato e ajustar .env
```

### Nginx devolve 502
```bash
pm2 status
systemctl restart easygestion  # se rodando com systemd
# Ou pm2 restart easygestion
```

### SSL não gera
```bash
certbot --nginx -d seu-dominio.com.br
# Verificar que domínio resolve pro IP correto
```

### Banco corrompido
```bash
# Restaurar do backup
cp /backups/dsstore_YYYY-MM-DD.db /var/lib/easygestion/db/dsstore.db
pm2 restart easygestion
```

---

## 💰 Custos Estimados

| Item | Custo |
|------|-------|
| Droplet DigitalOcean (1GB RAM) | R$35-50/mês |
| Domínio (.com.br) | R$40-80/ano |
| SSL (Let's Encrypt) | Gratuito |
| **Total** | **R$35-50/mês** |

---

## ✅ Status Após Deploy

- ✅ App online em `https://seu-dominio.com.br`
- ✅ SSL automático (cadeado verde)
- ✅ PM2 mantém app vivo 24/7
- ✅ Backup diário automático
- ✅ Logs centralizados
- ✅ Pronto para beta com lojistas

---

## 🎉 Próximos Passos

1. **Hoje:** Deploy concluído
2. **Amanhã:** Convidar 3-5 lojistas para testar
3. **Semana 1:** Monitorar bugs, fazer iterações
4. **Semana 2-3:** Ajustar feedback, preparar lançamento
5. **Semana 4:** Público geral

**Estimativa total: 3-4 semanas até lançamento público**

---

**Tempo de setup: ~2-3 horas**
**Dificuldade: Média (segue passo-a-passo)**
**Suporte: Abra issue se travar em algum passo**
