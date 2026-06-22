#***REMOVED***/usr/bin/env node

/**
 * Script: Criar usuário admin na tabela de usuários
 * Uso: node scripts/criar-admin.js
 *
 * Este script cria um usuário admin de verdade na tabela `usuarios`.
 * Ele é necessário para que a auditoria LGPD funcione corretamente.
 *
 * Comportamento:
 * - Se o usuário "admin" já existe, pergunta se quer sobrescrever
 * - Se não existe, cria novo com papel='admin' e ativo=1
 */

const readline = require('readline');
const { db } = require('../db/database');
const { hashSenha, validarSenha } = require('../middleware/seguranca');

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
});

function pergunta(texto) {
  return new Promise((resolve) => {
    rl.question(texto, (resposta) => {
      resolve(resposta.trim());
    });
  });
}

async function main() {
  console.log('\n═══════════════════════════════════════════════════');
  console.log('   Criar Usuário Admin (Sistema de Auditoria)');
  console.log('═══════════════════════════════════════════════════\n');

  try {
    // Verificar se admin já existe
    const adminExistente = db.prepare(
      'SELECT id, nome FROM usuarios WHERE nome = ? AND papel = ?'
    ).get('admin', 'admin');

    if (adminExistente) {
      console.log(`✓ Usuário admin já existe (ID: ${adminExistente.id})`);
      const sobrescrever = await pergunta('\nSobrescrever senha? (s/n): ');
      if (sobrescrever.toLowerCase() ***REMOVED***== 's') {
        console.log('\n✗ Operação cancelada.\n');
        rl.close();
        return;
      }
    }

    // Solicitar senha
    console.log('\n');
    const senha = await pergunta('Nova senha para admin: ');
    const senhaConfirm = await pergunta('Confirme a senha: ');

    if (senha ***REMOVED***== senhaConfirm) {
      console.log('\n✗ Senhas não coincidem***REMOVED***\n');
      rl.close();
      return;
    }

    const validacao = validarSenha(senha);
    if (***REMOVED***validacao.valida) {
      console.log(`\n✗ ${validacao.erro}\n`);
      rl.close();
      return;
    }

    const email = await pergunta('Email (opcional, deixe em branco): ');

    // Hash a senha
    const senhaHash = hashSenha(senha);

    // Criar ou atualizar
    if (adminExistente) {
      db.prepare(
        'UPDATE usuarios SET senha_hash = ?, email = ? WHERE id = ?'
      ).run(senhaHash, email || null, adminExistente.id);
      console.log(`\n✓ Senha do admin atualizada***REMOVED***\n`);
    } else {
      const result = db.prepare(`
        INSERT INTO usuarios (tenant_id, nome, email, senha_hash, papel, ativo)
        VALUES (?, ?, ?, ?, ?, ?)
      `).run(1, 'admin', email || null, senhaHash, 'admin', 1);

      console.log(`\n✓ Usuário admin criado***REMOVED*** (ID: ${result.lastInsertRowid})\n`);
    }

    console.log('═══════════════════════════════════════════════════');
    console.log('   Setup concluído com sucesso***REMOVED***');
    console.log('═══════════════════════════════════════════════════\n');
    console.log('   Próximos passos:');
    console.log('   1. Acesse /admin');
    console.log('   2. Login com usuário: admin');
    console.log('   3. A auditoria LGPD agora está ativa***REMOVED***\n');

  } catch (err) {
    console.error('\n✗ Erro:', err.message, '\n');
  } finally {
    rl.close();
  }
}

main();
