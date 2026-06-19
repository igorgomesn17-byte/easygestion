// ============================================================
// Agendador de backup automático
// Roda backup S3 todo dia às 22h (10 PM)
// ============================================================
const cron = require('node-cron');
const { spawn } = require('child_process');
const path = require('path');

function iniciar_backup_scheduler() {
  // Rodar backup todo dia às 22:00
  cron.schedule('0 22 * * *', () => {
    console.log(`\n⏰ [${new Date().toLocaleString('pt-BR')}] Iniciando backup automático...`);

    const backup = spawn('node', [path.join(__dirname, '..', 'scripts', 'backup-s3.js')], {
      cwd: path.join(__dirname, '..'),
      stdio: 'inherit',
    });

    backup.on('close', (code) => {
      if (code === 0) {
        console.log(`✅ Backup completado com sucesso***REMOVED***\n`);
      } else {
        console.error(`❌ Backup falhou com código ${code}\n`);
      }
    });
  });

  console.log('✨ Agendador de backup ativado***REMOVED*** Backup rodará diariamente às 22:00');
}

module.exports = { iniciar_backup_scheduler };
