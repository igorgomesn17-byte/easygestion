// ============================================================
// Importa a base de clientes de Camacan (origem 'Cliente Camacan').
// Lê o JSON gerado a partir do xlsx (06-CLIENTES/_camacan.json).
// IDEMPOTENTE: dedup por telefone (últimos 8 dígitos) — rodar 2x não duplica.
// NÃO apaga nada; só insere quem ainda não existe.
// Uso: node scripts/importar-camacan.js
// ============================================================
const fs = require('fs');
const path = require('path');
const { db } = require('../db/database');

// scripts/ -> DS-SISTEMA -> 07-OPERACOES -> (raiz do OS) -> 06-CLIENTES
const JSON_PATH = path.join(__dirname, '..', '..', '..', '06-CLIENTES', '_camacan.json');

function soDigitos(t) { return String(t || '').replace(/\D/g, ''); }
function chaveTel(t) { const d = soDigitos(t); return d.slice(-8); } // ignora DDD/9 pra casar duplicado

if (!fs.existsSync(JSON_PATH)) {
  console.error('Arquivo não encontrado:', JSON_PATH, '\nRode antes o _to_json.py em 06-CLIENTES.');
  process.exit(1);
}

const lista = JSON.parse(fs.readFileSync(JSON_PATH, 'utf8'));

// mapa de telefones já existentes (pra dedup)
const existentes = db.prepare('SELECT telefone FROM clientes WHERE telefone IS NOT NULL').all();
const jaTem = new Set(existentes.map(c => chaveTel(c.telefone)).filter(Boolean));

const insert = db.prepare(`
  INSERT INTO clientes (nome, telefone, origem, total_gasto, num_compras, ultima_compra)
  VALUES (?, ?, 'Cliente Camacan', ?, ?, ?)
`);

let inseridos = 0, pulados = 0;
const tx = db.transaction(() => {
  for (const c of lista) {
    const k = chaveTel(c.telefone);
    if (!k || jaTem.has(k)) { pulados++; continue; }
    insert.run(c.nome, soDigitos(c.telefone), c.total_gasto || 0, c.num_compras || 0, c.ultima_compra || null);
    jaTem.add(k);
    inseridos++;
  }
});
tx();

const total = db.prepare('SELECT COUNT(*) c FROM clientes').get().c;
const totalCamacan = db.prepare("SELECT COUNT(*) c FROM clientes WHERE origem = 'Cliente Camacan'").get().c;
console.log(`Importação concluída.`);
console.log(`  Inseridos agora: ${inseridos}`);
console.log(`  Pulados (já existiam/sem telefone): ${pulados}`);
console.log(`  Total clientes no banco: ${total}`);
console.log(`  Total origem 'Cliente Camacan': ${totalCamacan}`);
