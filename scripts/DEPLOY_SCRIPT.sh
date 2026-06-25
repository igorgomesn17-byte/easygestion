#!/bin/bash
# ============================================================
# DEPLOY SCRIPT - EasyGestão para AWS EC2
# ============================================================

# Configurações
SERVER_IP="54.232.189.113"
SERVER_USER="ubuntu"
KEY_PATH="easygestion-key.pem"
APP_DIR="/opt/easygestion"

echo "🚀 Iniciando deploy para AWS EC2..."
echo "📍 Servidor: $SERVER_USER@$SERVER_IP"
echo "📁 Diretório: $APP_DIR"
echo ""

# Conectar ao servidor e executar comandos
ssh -i "$KEY_PATH" "$SERVER_USER@$SERVER_IP" << 'DEPLOY_COMMANDS'

echo "📥 Puxando código atualizado do GitHub..."
cd /opt/easygestion
git pull origin main

echo "📦 Instalando dependências..."
npm install --production

echo "🔄 Reiniciando aplicação com PM2..."
pm2 restart easygestion
pm2 save

echo "✅ Aguardando aplicação iniciar (5s)..."
sleep 5

echo "🧪 Testando aplicação..."
curl -s http://localhost:3001/health | grep -q "ok" && echo "✅ Aplicação respondendo!" || echo "⚠️ Verificar logs: pm2 logs easygestion"

echo ""
echo "✅ DEPLOY CONCLUÍDO!"
echo "🌐 Acessar: https://easygestion.com.br (ou IP: http://$SERVER_IP:3001)"
echo ""
echo "📋 Comandos úteis:"
echo "  - Ver logs: pm2 logs easygestion"
echo "  - Status: pm2 status"
echo "  - Reiniciar: pm2 restart easygestion"

DEPLOY_COMMANDS

echo "✅ Deploy script finalizado!"
