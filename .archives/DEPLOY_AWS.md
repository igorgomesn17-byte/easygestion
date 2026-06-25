# Deploy EASYGESTION em AWS (EC2 + RDS)

## 🎯 Comparação: DigitalOcean vs AWS

| Aspecto | DigitalOcean | AWS |
|---------|--------------|-----|
| **Preço** | R$35-50/mês (simples) | R$15-30/mês (EC2) + R$30-50/mês (RDS) = R$45-80/mês |
| **Complexidade** | ⭐ Simples | ⭐⭐⭐⭐ Complexa |
| **Escalabilidade** | Boa | Excelente |
| **Suporte** | Comunidade | AWS Support (pago) |
| **Tempo de Setup** | 2-3 horas | 4-6 horas |
| **Ideal para** | MVP/Beta | Produção em escala |

---

## 🚀 DEPLOY AWS (Recomendado para você agora?)

**Vantagens AWS:**
- ✅ Escala automaticamente (Auto Scaling Group)
- ✅ Banco separado (RDS) — backup automático
- ✅ Load balancer integrado (ALB)
- ✅ CloudWatch (monitoramento completo)
- ✅ IAM (controle fino de permissões)

**Desvantagens AWS:**
- ❌ Mais caro (R$45-80/mês vs R$35-50)
- ❌ Mais complexo (VPC, Security Groups, IAM)
- ❌ Free tier limitado (12 meses, depois paga)
- ❌ Curva de aprendizado maior

---

## 📋 PASSO 1: Setup AWS

### 1.1 Criar Conta AWS
1. Vá para https://aws.amazon.com
2. Clique em **"Create an AWS Account"**
3. Siga os passos (email, cartão de crédito)
4. Escolha plano **Free Tier** (12 meses grátis com limites)

### 1.2 Acessar Console
- Vá para https://console.aws.amazon.com
- Escolha região: **São Paulo (sa-east-1)**

---

## PASSO 2: Criar EC2 Instance

### 2.1 Ir para EC2
Console AWS → Serviços → EC2 → Instances → Launch Instance

### 2.2 Configurar Instance
```
Name: easygestion-prod
AMI: Ubuntu Server 22.04 LTS (Free Tier eligible)
Instance Type: t2.micro (Free Tier) ou t3.small (R$20/mês)
  - t2.micro: 1GB RAM (tight, mas funciona)
  - t3.small: 2GB RAM (recomendado, R$25/mês)
Key Pair: 
  - Criar nova: easygestion-key.pem (SALVAR SEGURO***REMOVED***)
  - Ou usar SSH key existente
```

### 2.3 Security Group (Firewall)
```
Inbound Rules:
- SSH (22): source = Seu IP
- HTTP (80): source = 0.0.0.0/0 (qualquer um)
- HTTPS (443): source = 0.0.0.0/0 (qualquer um)
- (Opcional) Custom TCP (3001): source = 0.0.0.0/0 (para teste direto)

Outbound Rules:
- All traffic (padrão)
```

### 2.4 Storage
```
30 GB (Free Tier inclui 30 GB)
General Purpose (gp2)
Delete on Termination: Yes
```

### 2.5 Launch
- Clique em **"Launch Instance"**
- Esperar ~2 minutos
- Copiar **Public IPv4 address** (tipo: 54.232.189.113)

---

## PASSO 3: Conectar ao EC2

### 3.1 SSH (de casa)
```bash
# No seu PC (com a chave privada)
chmod 400 easygestion-key.pem
ssh -i easygestion-key.pem ubuntu@54.232.189.113
# Ou com senha (se configurou)
ssh ubuntu@54.232.189.113
```

### 3.2 Atualizar Sistema
```bash
sudo apt update && sudo apt upgrade -y
sudo apt install -y git curl wget build-essential
```

### 3.3 Instalar Node.js
```bash
curl -fsSL https://deb.nodesource.com/setup_24.x | sudo -E bash -
sudo apt install -y nodejs npm
node --version
```

---

## PASSO 4: Setup do Banco (Opções)

### Opção A: SQLite Local (Simples, recomendado pro beta)
```bash
mkdir -p /var/lib/easygestion/db
sudo chown ubuntu:ubuntu /var/lib/easygestion
```

### Opção B: RDS PostgreSQL (Profissional, R$30-50/mês)
```
AWS Console → RDS → Create Database
Engine: PostgreSQL 15
Instance Class: db.t3.micro
Storage: 20 GB
Publicly Accessible: No (acessar via Security Group)
Create Database

Salvar endpoint: easygestion-db.xxx.us-east-1.rds.amazonaws.com
Usuário: admin
Senha: (gerar segura)
```

**Para beta: Usar SQLite (simples, zero custo)**

---

## PASSO 5: Clonar e Instalar

```bash
cd /opt
sudo git clone https://github.com/seu-usuario/easygestion.git
cd easygestion
sudo npm install --production
```

---

## PASSO 6: Configurar .env

```bash
sudo nano /opt/easygestion/.env
# Ou com cat:
sudo tee /opt/easygestion/.env > /dev/null << 'EOF'
NODE_ENV=production
PORT=3001
ADMIN_SENHA_HASH=scrypt$...sua-senha-aqui...
TOKEN_SECRET=seu-uuid-aleatorio
DB_DIR=/var/lib/easygestion/db
SENDGRID_API_KEY=SG.xxx
STRIPE_SECRET_KEY=sk_test_...
STRIPE_PUBLISHABLE_KEY=pk_test_...
STRIPE_WEBHOOK_SECRET=whsec_...
SITE_URL=https://seu-dominio.com.br
EOF

sudo chmod 600 /opt/easygestion/.env
```

---

## PASSO 7: Instalar PM2

```bash
sudo npm install -g pm2

# Arquivo de config
sudo tee /opt/easygestion/ecosystem.config.js > /dev/null << 'EOF'
module.exports = {
  apps: [{
    name: 'easygestion',
    script: 'npm',
    args: 'start',
    cwd: '/opt/easygestion',
    instances: 1,
    exec_mode: 'cluster',
    error_file: '/var/log/easygestion-error.log',
    out_file: '/var/log/easygestion-out.log',
    max_memory_restart: '500M',
    autorestart: true
  }]
};
EOF

# Iniciar
cd /opt/easygestion
sudo pm2 start ecosystem.config.js
sudo pm2 save
sudo pm2 startup ubuntu -u ubuntu --hp /home/ubuntu
```

---

## PASSO 8: Instalar Nginx (Proxy + SSL)

```bash
sudo apt install -y nginx certbot python3-certbot-nginx
```

### 8.1 Config Nginx
```bash
sudo tee /etc/nginx/sites-available/easygestion > /dev/null << 'EOF'
upstream easygestion {
  server 127.0.0.1:3001;
}

server {
  listen 80;
  server_name seu-dominio.com.br www.seu-dominio.com.br;
  return 301 https://$server_name$request_uri;
}

server {
  listen 443 ssl http2;
  server_name seu-dominio.com.br www.seu-dominio.com.br;

  ssl_certificate /etc/letsencrypt/live/seu-dominio.com.br/fullchain.pem;
  ssl_certificate_key /etc/letsencrypt/live/seu-dominio.com.br/privkey.pem;

  add_header Strict-Transport-Security "max-age=31536000" always;
  add_header X-Frame-Options "SAMEORIGIN" always;

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

  client_max_body_size 100M;
}
EOF

sudo ln -s /etc/nginx/sites-available/easygestion /etc/nginx/sites-enabled/
sudo rm -f /etc/nginx/sites-enabled/default
sudo nginx -t
sudo systemctl reload nginx
```

### 8.2 SSL (Let's Encrypt)
```bash
# Substituir seu-dominio.com.br
sudo certbot certonly --nginx \
  -d seu-dominio.com.br \
  -d www.seu-dominio.com.br

# Auto-renew
sudo certbot renew --dry-run
sudo systemctl enable certbot.timer
```

---

## PASSO 9: Apontar Domínio (Seu Registrador)

Seu registrador (GoDaddy, NameCheap, etc):
```
Tipo: A
Nome: @ (ou seu-dominio)
Valor: 54.232.189.113  (seu IP Elástico AWS)
TTL: 3600
```

**⚠️ IMPORTANTE:** Usar **Elastic IP** no AWS para não perder IP ao reiniciar:
1. EC2 Dashboard → Elastic IPs → Allocate
2. Selecionar instance
3. Apontar domínio pro IP Elástico

---

## PASSO 10: Backup Automático

### Option A: S3 (Recomendado AWS)
```bash
# Instalar AWS CLI
sudo apt install -y awscli

# Criar bucket S3
aws s3 mb s3://easygestion-backups-seu-usuario --region sa-east-1

# Script de backup
sudo tee /usr/local/bin/backup-easygestion.sh > /dev/null << 'EOF'
#***REMOVED***/bin/bash
DB_FILE="/var/lib/easygestion/db/dsstore.db"
DATE=$(date +%Y-%m-%d_%H-%M-%S)

# Fazer backup
cp $DB_FILE /tmp/dsstore_$DATE.db

# Upload para S3
aws s3 cp /tmp/dsstore_$DATE.db s3://easygestion-backups-seu-usuario/

# Limpar local
rm /tmp/dsstore_*.db

echo "✅ Backup enviado para S3"
EOF

sudo chmod +x /usr/local/bin/backup-easygestion.sh

# Cron
(crontab -l 2>/dev/null; echo "0 2 * * * /usr/local/bin/backup-easygestion.sh") | crontab -
```

### Option B: Local (Simples)
```bash
sudo tee /usr/local/bin/backup-easygestion.sh > /dev/null << 'EOF'
#***REMOVED***/bin/bash
BACKUP_DIR="/backups"
DB_FILE="/var/lib/easygestion/db/dsstore.db"
DATE=$(date +%Y-%m-%d_%H-%M-%S)

mkdir -p $BACKUP_DIR
cp $DB_FILE $BACKUP_DIR/dsstore_$DATE.db

# Manter só 7 backups
find $BACKUP_DIR -name "dsstore_*.db" -mtime +7 -delete
EOF

sudo chmod +x /usr/local/bin/backup-easygestion.sh
(crontab -l 2>/dev/null; echo "0 2 * * * /usr/local/bin/backup-easygestion.sh") | crontab -
```

---

## PASSO 11: CloudWatch (Monitoramento - Opcional)

AWS Console → CloudWatch:
```
✅ Ativar monitoring de EC2
✅ Alertas se CPU > 80%
✅ Alertas se disco > 90%
✅ Logs de aplicação (via PM2)
```

---

## PASSO 12: Testar

```bash
# Acessar
https://seu-dominio.com.br

# Testar fluxo completo
1. Registrar
2. Fazer onboarding
3. Cadastrar produto
4. Fazer venda
5. Ver DRE
6. Fazer troca
```

---

## ⚠️ CUSTO AWS ESTIMADO

| Serviço | Preço/mês | Free Tier? |
|---------|-----------|-----------|
| EC2 t2.micro | GRÁTIS | ✅ 12 meses |
| EC2 t3.small | R$25 | ❌ Após free tier |
| RDS PostgreSQL | R$30-50 | ❌ Não |
| Data Transfer | R$0-10 | Parcial |
| **Total (sqlite)** | **GRÁTIS (12m), depois R$25/mês** | |
| **Total (RDS)** | **R$60-75/mês** | |

---

## 📊 COMPARAÇÃO FINAL

### Para Beta (3-4 semanas):
- **DigitalOcean:** Mais fácil, mais barato
- **AWS:** Mais complexo, free tier 12 meses

### Para Produção:
- **DigitalOcean:** Limite de escalabilidade
- **AWS:** Melhor para crescimento

---

## ✅ RECOMENDAÇÃO

**PARA VOCÊ AGORA:**

Se você quer **rápido e fácil (2-3h):** 
→ Use **DigitalOcean** (DEPLOY_DIGITALOCEAN.md)

Se você quer **free tier 12 meses** (e tem tempo 4-6h):
→ Use **AWS** (este guia)

---

**Qual você prefere?**
