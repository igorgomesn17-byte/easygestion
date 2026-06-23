#!/usr/bin/env node

/**
 * Script: Testa se a tabela de auditoria está criada e funcional
 * Uso: node scripts/teste-auditoria.js
 */

const { db } = require('../db/database');

console.log('\n🔍 Testando sistema de auditoria...\n');

try {
  // 1. Verificar se tabela existe
  const tables = db.prepare(`
    SELECT name FROM sqlite_master
    WHERE type='table' AND name='auditoria'
  `).all();

  if (tables.length === 0) {
    console.log('❌ Tabela auditoria NÃO existe!');
    console.log('   Verifique db/schema.sql e reinicie o servidor.');
    process.exit(1);
  }

  console.log('✅ Tabela auditoria existe');

  // 2. Verificar estrutura da tabela
  const colunas = db.prepare('PRAGMA table_info(auditoria)').all();
  console.log('   Colunas:', colunas.map(c => `${c.name}(${c.type})`).join(', '));

  // 3. Contar registros
  const { count } = db.prepare('SELECT COUNT(*) as count FROM auditoria').get();
  console.log(`\n📊 Total de registros: ${count}`);

  if (count > 0) {
    const recente = db.prepare(`
      SELECT id, acao, recurso, usuario_nome, criado_em
      FROM auditoria
      ORDER BY criado_em DESC
      LIMIT 1
    `).get();

    console.log('   Registro mais recente:');
    console.log(`   - ID: ${recente.id}`);
    console.log(`   - Ação: ${recente.acao}`);
    console.log(`   - Recurso: ${recente.recurso}`);
    console.log(`   - Usuário: ${recente.usuario_nome}`);
    console.log(`   - Data: ${recente.criado_em}`);
  }

  // 4. Testar insert
  console.log('\n🧪 Testando INSERT de auditoria...');
  db.prepare(`
    INSERT INTO auditoria (
      usuario_id, usuario_nome, tenant_id,
      acao, recurso, recurso_id,
      antes, depois,
      ip, status_http
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    null,
    'teste-script',
    1,
    'TEST_teste',
    'teste',
    999,
    JSON.stringify({ teste: 'antes' }),
    JSON.stringify({ teste: 'depois' }),
    '127.0.0.1',
    200,
  );

  console.log('✅ Insert funcionou');

  // 5. Verificar índices
  const indices = db.prepare(`
    SELECT name FROM sqlite_master
    WHERE type='index' AND tbl_name='auditoria'
  `).all();

  console.log(`\n🔑 Índices criados: ${indices.length}`);
  indices.forEach(idx => {
    console.log(`   - ${idx.name}`);
  });

  console.log('\n✅ Sistema de auditoria está PRONTO!');
  console.log('   Você pode acessar o dashboard em: /auditoria.html\n');

} catch (err) {
  console.error('❌ Erro:', err.message);
  process.exit(1);
}
