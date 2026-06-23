// ============================================================
// Agendador de backup automático com health check
// Roda backup S3 todo dia às 22h (10 PM)
// ============================================================
const cron = require('node-cron');
const { spawn } = require('child_process');
const path = require('path');
const { db } = require('../db/database');
const sgMail = require('@sendgrid/mail');

function iniciar_backup_scheduler() {
  if (process.env.SENDGRID_API_KEY) {
    sgMail.setApiKey(process.env.SENDGRID_API_KEY);
  }

  // Rodar backup todo dia às 22:00
  cron.schedule('0 22 * * *', () => {
    const agora = new Date().toLocaleString('pt-BR');
    const inicio = Date.now();

    console.log(`\n⏰ [${agora}] Iniciando backup automático...`);

    const backup = spawn('node', [path.join(__dirname, '..', 'scripts', 'backup-s3.js')], {
      cwd: path.join(__dirname, '..'),
      stdio: 'pipe',
    });

    let stdout = '';
    let stderr = '';

    backup.stdout?.on('data', (data) => {
      stdout += data.toString();
      console.log(data.toString());
    });

    backup.stderr?.on('data', (data) => {
      stderr += data.toString();
      console.error(data.toString());
    });

    backup.on('close', (code) => {
      const duracao = Date.now() - inicio;

      if (code === 0) {
        console.log(`✅ Backup completado com sucesso em ${duracao}ms\n`);

        // Registrar sucesso no banco
        try {
          const nomeArquivo = extrairNomeArquivoDoLog(stdout);
          const tamanho = extrairTamanhoDoLog(stdout);

          db.prepare(`
            INSERT INTO backup_logs (arquivo_s3, tamanho_bytes, status, tempo_exec_ms)
            VALUES (?, ?, 'sucesso', ?)
          `).run(nomeArquivo || 'desconhecido', tamanho || 0, duracao);

          console.log('✅ Backup registrado no banco de dados');
        } catch (err) {
          console.error('⚠️  Erro ao registrar backup:', err.message);
        }
      } else {
        const msg = stderr || stdout || `Processo saiu com código ${code}`;
        console.error(`❌ Backup falhou: ${msg}\n`);

        // Registrar falha no banco
        try {
          db.prepare(`
            INSERT INTO backup_logs (status, mensagem, tempo_exec_ms)
            VALUES ('erro', ?, ?)
          `).run(msg.substring(0, 500), duracao);
        } catch (err) {
          console.error('⚠️  Erro ao registrar falha:', err.message);
        }

        // ⚠️ Enviar alerta por email
        enviarAlertaBackupFalhou(msg);
      }
    });
  });

  // Health check: rodar todo dia às 8h da manhã
  // Se não houve backup bem-sucedido nas últimas 24h, envia alerta
  cron.schedule('0 8 * * *', () => {
    console.log('🔍 Verificando saúde dos backups...');
    verificarSaudeBackups(db);
  });

  console.log('✨ Agendador de backup ativado!');
  console.log('   Backup automático: diariamente às 22:00');
  console.log('   Health check: diariamente às 08:00');
}

// Extrai nome do arquivo do log (parse output do script)
function extrairNomeArquivoDoLog(log) {
  const match = log.match(/s3:\/\/.+?\/(.+?)$/m);
  return match ? match[1] : null;
}

// Extrai tamanho do arquivo do log
function extrairTamanhoDoLog(log) {
  const match = log.match(/Tamanho:\s+([\d.]+)\s+MB/);
  return match ? Math.round(parseFloat(match[1]) * 1024 * 1024) : 0;
}

// Verifica se há backup bem-sucedido nos últimos 24h
function verificarSaudeBackups(db) {
  try {
    const ultimoBackupBom = db.prepare(`
      SELECT data_backup FROM backup_logs
      WHERE status = 'sucesso'
      AND datetime(data_backup) > datetime('now', '-24 hours')
      ORDER BY data_backup DESC
      LIMIT 1
    `).get();

    if (!ultimoBackupBom) {
      const ultimaTentativa = db.prepare(`
        SELECT status, mensagem, criado_em FROM backup_logs
        ORDER BY criado_em DESC
        LIMIT 1
      `).get();

      const msg = ultimaTentativa
        ? `Último backup falhou em ${ultimaTentativa.criado_em}: ${ultimaTentativa.mensagem}`
        : 'Nenhum backup encontrado nos últimos 24h';

      console.error(`🚨 ALERTA CRÍTICO: ${msg}`);
      enviarAlertaBackupFalhou(msg);
    } else {
      console.log(`✅ Backup OK: última execução bem-sucedida em ${ultimoBackupBom.data_backup}`);
    }
  } catch (err) {
    console.error('❌ Erro ao verificar saúde dos backups:', err.message);
  }
}

// Envia email de alerta quando backup falha
async function enviarAlertaBackupFalhou(mensagem) {
  if (!process.env.SENDGRID_API_KEY || !process.env.ADMIN_EMAIL) {
    console.warn('⚠️  Não foi possível enviar alerta: SENDGRID_API_KEY ou ADMIN_EMAIL não configurados');
    return;
  }

  try {
    await sgMail.send({
      to: process.env.ADMIN_EMAIL,
      from: 'noreply@easygestao.com',
      subject: '🚨 ALERTA: Backup Falhou — Ação Imediata Requerida',
      html: `
        <h2>🚨 Falha Crítica de Backup</h2>
        <p>O backup automático da base de dados falhou.</p>
        <p><strong>Erro:</strong></p>
        <pre>${mensagem.substring(0, 500)}</pre>
        <p>
          <strong>Ação requerida:</strong> Verifique os logs do servidor e restaure a execução do backup.
        </p>
        <p>
          <a href="${process.env.ORIGIN || 'http://localhost:3000'}/admin">
            Ver dashboard →
          </a>
        </p>
      `,
    });
    console.log('📧 Email de alerta enviado ao admin');
  } catch (err) {
    console.error('❌ Erro ao enviar email de alerta:', err.message);
  }
}

module.exports = { iniciar_backup_scheduler };
