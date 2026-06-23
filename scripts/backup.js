// ============================================================
// Backup do banco de dados. Rode com: npm run backup
// Copia o dsstore.db para backup/ com data e hora.
// ============================================================
const fs = require('fs');
const path = require('path');

const origem = path.join(__dirname, '..', 'db', 'dsstore.db');
const destinoDir = path.join(__dirname, '..', 'backup');
if (!fs.existsSync(destinoDir)) fs.mkdirSync(destinoDir, { recursive: true });

if (!fs.existsSync(origem)) { console.log('Banco ainda nao existe.'); process.exit(0); }

const carimbo = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
const destino = path.join(destinoDir, `dsstore-${carimbo}.db`);
fs.copyFileSync(origem, destino);
console.log('Backup criado:', destino);

// Mantem apenas os 30 backups mais recentes
const arquivos = fs.readdirSync(destinoDir).filter(f => f.endsWith('.db')).sort();
while (arquivos.length > 30) {
  const velho = arquivos.shift();
  fs.unlinkSync(path.join(destinoDir, velho));
  console.log('Backup antigo removido:', velho);
}
