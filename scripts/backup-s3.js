// ============================================================
// Backup automático pra AWS S3 (com criptografia AES-256-CBC)
// Rode com: npm run backup-s3
// ============================================================
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { S3Client, PutObjectCommand, ListObjectsV2Command, DeleteObjectCommand } = require('@aws-sdk/client-s3');

const origem = path.join(__dirname, '..', 'db', 'dsstore.db');
const bucketName = process.env.AWS_S3_BUCKET;
const region = process.env.AWS_REGION || 'sa-east-1';

if (!process.env.AWS_ACCESS_KEY_ID || !process.env.AWS_SECRET_ACCESS_KEY) {
  console.error('❌ ERRO: AWS_ACCESS_KEY_ID ou AWS_SECRET_ACCESS_KEY não definidos no .env');
  process.exit(1);
}

if (!bucketName) {
  console.error('❌ ERRO: AWS_S3_BUCKET não definido no .env');
  process.exit(1);
}

if (!fs.existsSync(origem)) {
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

// Criptografa buffer com AES-256-CBC usando PBKDF2
function criptografarBackup(buffer, chave) {
  const salt = crypto.randomBytes(16);
  const iv = crypto.randomBytes(16);
  const keyDerived = crypto.pbkdf2Sync(chave, salt, 100000, 32, 'sha256');
  const cipher = crypto.createCipheriv('aes-256-cbc', keyDerived, iv);
  const encrypted = Buffer.concat([cipher.update(buffer), cipher.final()]);
  // Formato: [salt(16)][iv(16)][encrypted]
  return Buffer.concat([salt, iv, encrypted]);
}

async function fazer_backup() {
  try {
    const carimbo = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    const nomeBackup = `dsstore-${carimbo}.db.enc`;

    console.log(`📦 Iniciando backup pro AWS S3...`);
    console.log(`🪣 Bucket: ${bucketName}`);
    console.log(`💾 Arquivo: ${nomeBackup}`);

    // Ler arquivo
    const fileBuffer = fs.readFileSync(origem);
    let backupBuffer = fileBuffer;
    const fileSize = fileBuffer.length;

    // Criptografar se BACKUP_ENCRYPT_KEY estiver definida
    if (process.env.BACKUP_ENCRYPT_KEY) {
      if (process.env.BACKUP_ENCRYPT_KEY.length < 16) {
        console.warn('⚠️  Aviso: BACKUP_ENCRYPT_KEY muito curta (mín. 16 chars); usando sem criptografia');
      } else {
        console.log(`🔐 Criptografando com AES-256-CBC...`);
        backupBuffer = criptografarBackup(fileBuffer, process.env.BACKUP_ENCRYPT_KEY);
        console.log(`   ✓ Criptografado (salt+iv+encrypted)`);
      }
    } else if (process.env.NODE_ENV === 'production') {
      console.warn('⚠️  AVISO CRÍTICO: BACKUP_ENCRYPT_KEY não definida em PRODUÇÃO!');
      console.warn('   Backup será enviado SEM criptografia. Defina BACKUP_ENCRYPT_KEY imediatamente.');
    } else {
      console.log(`ℹ️  DEV: BACKUP_ENCRYPT_KEY não definida; enviando sem criptografia`);
    }

    // Upload pra S3
    const uploadCommand = new PutObjectCommand({
      Bucket: bucketName,
      Key: nomeBackup,
      Body: backupBuffer,
      ContentType: 'application/octet-stream',
      Metadata: {
        'cipher': 'aes-256-cbc',
        'kdf': 'pbkdf2',
        'backup-date': new Date().toISOString(),
        'original-size': String(fileSize),
      },
    });

    await s3Client.send(uploadCommand);

    console.log(`✅ Backup enviado com sucesso!`);
    console.log(`   Tamanho original: ${(fileSize / 1024 / 1024).toFixed(2)} MB`);
    console.log(`   Tamanho enviado: ${(backupBuffer.length / 1024 / 1024).toFixed(2)} MB`);
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
  console.log('\n✨ Processo concluído!');
  process.exit(0);
}).catch(err => {
  console.error('Erro fatal:', err);
  process.exit(1);
});
