#***REMOVED***/bin/bash
# ============================================================
# Script de Setup para Deploy do EASYGESTION
# Para rodar em produção (VPS, servidor dedicado, etc)
# ============================================================

set -e  # Exit on error

echo "🚀 Setup EASYGESTION para Deploy"
echo "================================="

# 1. Verificar Node
echo ""
echo "1️⃣  Verificando Node.js..."
if ***REMOVED*** command -v node &> /dev/null; then
  echo "❌ Node.js não instalado. Instale em: https://nodejs.org"
  exit 1
fi
NODE_VERSION=$(node --version)
echo "✅ Node.js $NODE_VERSION"

# 2. Instalar dependências
echo ""
echo "2️⃣  Instalando dependências..."
npm install --production
echo "✅ npm install concluído"

# 3. Criar .env
echo ""
echo "3️⃣  Verificando arquivo .env..."
if [ -f .env ]; then
  echo "✅ .env já existe"
else
  echo "⚠️  Criando .env de exemplo"
  cat > .env.example << 'EOF'
# ============================================================
# EASYGESTION - Variáveis de Ambiente
# ============================================================

# Node
NODE_ENV=production
PORT=3001

# Admin
ADMIN_SENHA_HASH=scrypt$...  # Gerar com: node scripts/gerar-hash.js

# Banco (opcional, se não usar SQLite local)
DB_DIR=./db

# Token JWT
TOKEN_SECRET=seu-uuid-aqui-aleatorio-lonqo

# Email (SendGrid)
SENDGRID_API_KEY=SG.xxx

# Stripe (teste)
STRIPE_SECRET_KEY=sk_test_...
STRIPE_PUBLISHABLE_KEY=pk_test_...
STRIPE_WEBHOOK_SECRET=whsec_...

# Site URL (para links em emails, etc)
SITE_URL=https://seu-dominio.com.br
EOF
  echo ""
  echo "📝 Arquivo .env.example criado"
  echo "➜ Copie para .env e preencha as credenciais:"
  echo "   cp .env.example .env"
  echo "   # Edite com suas chaves"
fi

# 4. Gerar ADMIN_SENHA_HASH
echo ""
echo "4️⃣  Gerando ADMIN_SENHA_HASH..."
cat > scripts/gerar-hash.js << 'EOF'
#***REMOVED***/usr/bin/env node
const crypto = require('crypto');
const readline = require('readline');

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout
});

rl.question('Digite a senha de admin: ', (senha) => {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(String(senha), salt, 64).toString('hex');
  const resultado = `scrypt$${salt}$${hash}`;

  console.log('\n✅ Hash gerado:');
  console.log(resultado);
  console.log('\nCopie este valor e cole em seu .env como ADMIN_SENHA_HASH');

  rl.close();
});
EOF
chmod +x scripts/gerar-hash.js
echo "✅ Script gerar-hash.js criado"
echo "➜ Para gerar a senha, rode: node scripts/gerar-hash.js"

# 5. Testar conexão
echo ""
echo "5️⃣  Testando aplicação..."
echo "➜ Para iniciar, rode: npm start"
echo "➜ Aplicação estará em: http://localhost:3001"

# 6. Instruções finais
echo ""
echo "✅ Setup concluído***REMOVED***"
echo ""
echo "📋 Próximas etapas:"
echo "   1. Configure o arquivo .env:"
echo "      cp .env.example .env"
echo "      # Edite com suas credenciais"
echo ""
echo "   2. Gere a senha de admin:"
echo "      node scripts/gerar-hash.js"
echo ""
echo "   3. Inicie a aplicação:"
echo "      npm start"
echo ""
echo "   4. Acesse em seu navegador:"
echo "      http://localhost:3001"
echo ""
echo "🎉 Pronto para deploy***REMOVED***"
