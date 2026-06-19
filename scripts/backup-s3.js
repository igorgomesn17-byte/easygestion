// ============================================================
// Backup automático pra AWS S3
// Rode com: npm run backup-s3
// ============================================================
const fs = require('fs');
const path = require('path');
const { S3Client, PutObjectCommand, ListObjectsV2Command, DeleteObjectCommand } = require('@aws-sdk/client-s3');

const origem = path.join(__dirname, '..', 'db', 'dsstore.db');
const bucketName = process.env.AWS_S3_BUCKET;
const region = process.env.AWS_REGION || 'sa-east-1';

if (***REMOVED***process.env.AWS_ACCESS_KEY_ID || ***REMOVED***process.env.AWS_SECRET_ACCESS_KEY) {
  console.error('❌ ERRO: AWS_ACCESS_KEY_ID ou AWS_SECRET_ACCESS_KEY não definidos no .env');
  process.exit(1);
}

if (***REMOVED***bucketName) {
  console.error('❌ ERRO: AWS_S3_BUCKET não definido no .env');
  process.exit(1);
}

if (***REMOVED***fs.existsSync(origem)) {
  console.log('ℹ️  Banco ainda não existe.');
  process.exit(0);
}

// Criar cliente S3
const s3Client = new S3Client({
  region: region,
  credentials: {
    accessKeyId: process.env.AWS_ACCESS_KEY_ID,
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
  },
});

async function fazer_backup() {
  try {
    const carimbo = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    const nomeBackup = `dsstore-${carimbo}.db`;

    console.log(`📦 Iniciando backup pro AWS S3...`);
    console.log(`🪣 Bucket: ${bucketName}`);
    console.log(`💾 Arquivo: ${nomeBackup}`);

    // Ler arquivo
    const fileBuffer = fs.readFileSync(origem);
    const fileSize = fileBuffer.length;

    // Upload pra S3
    const uploadCommand = new PutObjectCommand({
      Bucket: bucketName,
      Key: nomeBackup,
      Body: fileBuffer,
      ContentType: 'application/x-sqlite3',
    });

    await s3Client.send(uploadCommand);

    console.log(`✅ Backup enviado com sucesso***REMOVED***`);
    console.log(`   Tamanho: ${(fileSize / 1024 / 1024).toFixed(2)} MB`);
    console.log(`   S3 URI: s3://${bucketName}/${nomeBackup}`);

    // Limpeza de backups antigos (manter últimos 30)
    await limpar_backups_antigos();

  } catch (err) {
    console.error('❌ Erro ao fazer backup:', err.message);
    process.exit(1);
  }
}

async function limpar_backups_antigos() {
  try {
    console.log('\n🧹 Limpando backups antigos...');

    // Listar objetos no bucket
    const listCommand = new ListObjectsV2Command({
      Bucket: bucketName,
      Prefix: 'dsstore-',
    });

    const response = await s3Client.send(listCommand);
    const arquivos = (response.Contents || [])
      .sort((a, b) => new Date(b.LastModified) - new Date(a.LastModified));

    if (arquivos.length > 30) {
      const aRemover = arquivos.slice(30);
      console.log(`   Removendo ${aRemover.length} backup(s) antigo(s)...`);

      for (const arquivo of aRemover) {
        const deleteCommand = new DeleteObjectCommand({
          Bucket: bucketName,
          Key: arquivo.Key,
        });

        await s3Client.send(deleteCommand);
        console.log(`   🗑️  Removido: ${arquivo.Key}`);
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
