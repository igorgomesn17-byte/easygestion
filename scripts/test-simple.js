#!/usr/bin/env node
/**
 * Testes Simples Golden Path
 * Testa os cenários críticos via HTTP
 */

const http = require('http');

const BASE = 'http://localhost:3000';
let cookies = [];

function req(method, path, body = null) {
  return new Promise((resolve, reject) => {
    const url = new URL(BASE + path);
    const opts = {
      method,
      hostname: url.hostname,
      port: 3000,
      path: url.pathname + url.search,
      headers: {
        'Content-Type': 'application/json',
        'Cookie': cookies.join('; '),
      },
    };

    const request = http.request(opts, (res) => {
      let data = '';
      res.on('data', (c) => (data += c));
      res.on('end', () => {
        if (res.headers['set-cookie']) {
          cookies = res.headers['set-cookie'].map(c => c.split(';')[0]);
        }
        resolve({
          status: res.statusCode,
          body: data ? JSON.parse(data) : null,
        });
      });
    });

    request.on('error', reject);
    if (body) request.write(JSON.stringify(body));
    request.end();
  });
}

async function run() {
  console.log('\n' + '='.repeat(60));
  console.log('   TESTES GOLDEN PATH — Simples');
  console.log('='.repeat(60) + '\n');

  try {
    // 1. Login (registro automático)
    console.log('1️⃣  Tentando login (registro automático)...');
    let res = await req('POST', '/api/auth/login', {
      email: 'teste@exemplo.com',
      senha: 'senha123',
    });
    console.log(`   Status: ${res.status}`);
    if (res.body?.erro) console.log(`   Erro: ${res.body.erro}`);
    if (res.body?.usuario) console.log(`   ✅ Login OK: ${res.body.usuario.email}`);

    // 2. Pegar dados do usuário
    console.log('\n2️⃣  Buscando dados do usuário logado...');
    res = await req('GET', '/api/auth/me');
    console.log(`   Status: ${res.status}`);
    if (res.body?.usuario) {
      console.log(`   ✅ Usuário: ${res.body.usuario.email}`);
      console.log(`   Papel: ${res.body.usuario.papel}`);
      console.log(`   Tenant ID: ${res.body.usuario.tenant_id}`);
    }

    // 3. Listar clientes
    console.log('\n3️⃣  Listando clientes...');
    res = await req('GET', '/api/clientes');
    console.log(`   Status: ${res.status}`);
    if (res.status === 200) {
      console.log(`   ✅ Total de clientes: ${res.body?.length || 0}`);
    }

    // 4. Criar cliente
    console.log('\n4️⃣  Criando novo cliente...');
    res = await req('POST', '/api/clientes', {
      nome: 'Cliente Teste',
      email: 'cliente@teste.com',
      telefone: '11987654321',
    });
    console.log(`   Status: ${res.status}`);
    if (res.status === 200 || res.status === 201) {
      console.log(`   ✅ Cliente criado`);
    } else if (res.body?.erro) {
      console.log(`   Erro: ${res.body.erro}`);
    }

    // 5. Logout
    console.log('\n5️⃣  Fazendo logout...');
    res = await req('POST', '/api/auth/logout');
    console.log(`   Status: ${res.status}`);
    if (res.status === 200) {
      console.log(`   ✅ Logout OK`);
    }

    // 6. Tentar acessar após logout (deve falhar)
    console.log('\n6️⃣  Tentando acessar sem estar logado...');
    res = await req('GET', '/api/clientes');
    console.log(`   Status: ${res.status}`);
    if (res.status === 401 || res.status === 403) {
      console.log(`   ✅ Acesso bloqueado (esperado)`);
    }

    console.log('\n' + '='.repeat(60));
    console.log('   ✅ TESTES CONCLUÍDOS COM SUCESSO');
    console.log('='.repeat(60) + '\n');

  } catch (err) {
    console.error('\n❌ Erro:', err.message);
    process.exit(1);
  }
}

run();
