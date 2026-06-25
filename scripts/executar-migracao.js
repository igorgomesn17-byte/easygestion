// ============================================================
// Script: Executar migrations SQL
// Uso: node scripts/executar-migracao.js
// ============================================================

const fs = require('fs');
const path = require('path');
const { db } = require('../db/database');

console.log('🔄 Executando migrations...\n');

const migDir = path.join(__dirname, '..', 'db', 'migrations');
if (!fs.existsSync(migDir)) {
  console.log('📂 Pasta de migrations não existe. Criando...');
  fs.mkdirSync(migDir, { recursive: true });
}

const files = fs.readdirSync(migDir)
  .filter(f => f.endsWith('.sql'))
  .sort();

if (files.length === 0) {
  console.log('❌ Nenhuma migration encontrada em db/migrations/');
  process.exit(0);
}

let sucesso = 0;
let erro = 0;

for (const file of files) {
  const filePath = path.join(migDir, file);
  const sql = fs.readFileSync(filePath, 'utf-8');

  try {
    console.log(`▶️  ${file}...`);
    db.exec(sql);
    console.log(`✅ ${file} — OK\n`);
    sucesso++;
  } catch (err) {
    console.error(`❌ ${file} — ERRO:`);
    console.error(`   ${err.message}\n`);
    erro++;
  }
}

console.log(`\n📊 Resultado: ${sucesso} OK, ${erro} erros`);
process.exit(erro > 0 ? 1 : 0);
