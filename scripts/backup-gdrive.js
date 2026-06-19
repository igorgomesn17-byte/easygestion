// ============================================================
// Backup para Google Drive usando Google API Key
// Rode com: npm run backup-gdrive
// ============================================================
const fs = require('fs');
const path = require('path');
const { google } = require('googleapis');

const origem = path.join(__dirname, '..', 'db', 'dsstore.db');
const googleDriveFolderId = process.env.GOOGLE_DRIVE_BACKUP_FOLDER_ID;
const googleApiKey = process.env.GOOGLE_API_KEY;

if (***REMOVED***googleDriveFolderId) {
  console.error('❌ ERRO: GOOGLE_DRIVE_BACKUP_FOLDER_ID não está definido no .env');
  process.exit(1);
}

if (***REMOVED***googleApiKey) {
  console.error('❌ ERRO: GOOGLE_API_KEY não está definido no .env');
  process.exit(1);
}

if (***REMOVED***fs.existsSync(origem)) {
  console.log('ℹ️  Banco ainda não existe.');
  process.exit(0);
}

async function fazer_backup() {
  try {
    const carimbo = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    const nomeBackup = `dsstore-${carimbo}.db`;

    console.log(`📦 Iniciando backup para Google Drive...`);
    console.log(`📁 Pasta: ${googleDriveFolderId}`);
    console.log(`💾 Arquivo: ${nomeBackup}`);

    // Criar cliente do Google Drive
    const drive = google.drive({
      version: 'v3',
      auth: googleApiKey,
    });

    // Ler arquivo do banco
    const fileStream = fs.createReadStream(origem);
    const fileSize = fs.statSync(origem).size;

    // Upload para Google Drive
    const response = await drive.files.create({
      requestBody: {
        name: nomeBackup,
        parents: [googleDriveFolderId],
      },
      media: {
        mimeType: 'application/x-sqlite3',
        body: fileStream,
      },
      fields: 'id, name, size, createdTime',
    });

    console.log(`✅ Backup enviado com sucesso***REMOVED***`);
    console.log(`   ID: ${response.data.id}`);
    console.log(`   Tamanho: ${(fileSize / 1024 / 1024).toFixed(2)} MB`);
    console.log(`   Data: ${response.data.createdTime}`);

    // Limpeza de backups antigos (manter últimos 30 no Google Drive)
    await limpar_backups_antigos(drive);

  } catch (err) {
    console.error('❌ Erro ao fazer backup:', err.message);
    process.exit(1);
  }
}

async function limpar_backups_antigos(drive) {
  try {
    console.log('\n🧹 Limpando backups antigos...');

    // Listar backups na pasta
    const response = await drive.files.list({
      q: `'${googleDriveFolderId}' in parents and name contains 'dsstore-' and trashed = false`,
      spaces: 'drive',
      fields: 'files(id, name, createdTime)',
      orderBy: 'createdTime desc',
    });

    const arquivos = response.data.files || [];

    if (arquivos.length > 30) {
      const aRemover = arquivos.slice(30);
      console.log(`   Removendo ${aRemover.length} backup(s) antigo(s)...`);

      for (const arquivo of aRemover) {
        await drive.files.delete({ fileId: arquivo.id });
        console.log(`   🗑️  Removido: ${arquivo.name}`);
      }
    } else {
      console.log(`   Total de backups: ${arquivos.length} (dentro do limite)`);
    }

  } catch (err) {
    console.warn('⚠️  Aviso ao limpar backups antigos:', err.message);
  }
}

fazer_backup().then(() => {
  console.log('\n✨ Processo concluído***REMOVED***');
  process.exit(0);
}).catch(err => {
  console.error('Erro fatal:', err);
  process.exit(1);
});
