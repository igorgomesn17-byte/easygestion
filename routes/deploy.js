const express = require('express');
const { execSync } = require('child_process');
const router = express.Router();

// ⚠️ WEBHOOK DE DEPLOY - Requer token secreto
// ✅ CRÍTICO: DEPLOY_TOKEN é obrigatório (sem fallback padrão)
router.post('/webhook', (req, res) => {
  const token = req.body.token || req.headers['x-deploy-token'];
  const secretToken = process.env.DEPLOY_TOKEN || (process.env.NODE_ENV !== 'production' ? null : null);

  // Validação: DEPLOY_TOKEN obrigatório sempre
  if (!secretToken) {
    console.error('[DEPLOY] ERRO: DEPLOY_TOKEN não configurado!');
    console.error(`
❌ ERRO CRÍTICO: Webhook de deploy está desabilitado!

Você DEVE definir:
  export DEPLOY_TOKEN="<string-aleatória-de-32-caracteres>"

Gere com:
  node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"

Sem isso, ninguém consegue disparar deploys (proteção contra RCE).
`);
    return res.status(500).json({ erro: 'Deploy não configurado' });
  }

  // Verificar token
  if (!token || token !== secretToken) {
    return res.status(401).json({ erro: 'Token inválido' });
  }

  try {
    console.log('[DEPLOY] Iniciando deploy webhook...');

    // 1. Puxar código
    console.log('[DEPLOY] git pull origin main');
    execSync('cd /opt/easygestion && git pull origin main', { stdio: 'inherit' });

    // 2. Instalar dependências
    console.log('[DEPLOY] npm install --production');
    execSync('npm install --production', {
      cwd: '/opt/easygestion',
      stdio: 'inherit'
    });

    // 3. Reiniciar PM2
    console.log('[DEPLOY] pm2 restart easygestion');
    execSync('pm2 restart easygestion && pm2 save', { stdio: 'inherit' });

    // 4. Aguardar
    setTimeout(() => {}, 2000);

    console.log('[DEPLOY] ✅ Concluído!');
    res.json({
      ok: true,
      mensagem: 'Deploy realizado com sucesso!',
      timestamp: new Date().toISOString()
    });

  } catch (e) {
    console.error('[DEPLOY ERROR]', e.message);
    res.status(500).json({
      erro: 'Erro ao fazer deploy: ' + e.message
    });
  }
});

module.exports = router;
