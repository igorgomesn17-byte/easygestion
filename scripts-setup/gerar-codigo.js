#***REMOVED***/usr/bin/env node
// ============================================================
// Script para gerar códigos de ativação
// Use: node gerar-codigo.js "Nome do Cliente"
// ============================================================

const LicenseManager = require('./license');

const nomeCliente = process.argv[2] || 'Cliente Teste';

console.log('\n╔════════════════════════════════════════════╗');
console.log('║     GERADOR DE CÓDIGO DE ATIVAÇÃO          ║');
console.log('╚════════════════════════════════════════════╝\n');

const codigo = LicenseManager.generateCode(nomeCliente);

console.log(`Cliente: ${nomeCliente}`);
console.log(`Código:  ${codigo}`);
console.log(`\nValidade: 30 dias`);
console.log(`\nCopie este código e envie para o cliente.\n`);

// Validar o código gerado (para confirmar que funciona)
const validation = LicenseManager.validateCode(codigo);
if (validation.valid) {
  console.log('✅ Código validado com sucesso***REMOVED***');
  console.log(`   Expira em: ${validation.expiresAt}`);
  console.log(`   Dias: ${validation.daysLeft}\n`);
} else {
  console.log('❌ Erro ao validar código\n');
}
