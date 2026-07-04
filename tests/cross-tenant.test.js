// ============================================================
// Teste de Isolamento Cross-Tenant
// Garante que um tenant não consegue acessar dados de outro
//
// Rodar: DB_DIR=./tests/.tmp-cross-tenant PORT=3002 npm run test:cross-tenant
// ============================================================

const http = require('http');
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { DatabaseSync } = require('node:sqlite');

const BASE_URL = 'http://localhost:3002';
const TMP_DB_DIR = './tests/.tmp-cross-tenant';

// Estado de teste (cópias do padrão golden-path.test.js)
let sessionIdA = null;
let sessionIdB = null;

// Dados de teste
const tenantA = { email: null, senha: null, clienteId: null, produtoId: null };
const tenantB = { email: null, senha: null, clienteId: null, produtoId: null };

// Helper para fazer requisições HTTP (adaptado de golden-path.test.js)
function request(method, path, body = null, useSessionB = false) {
  return new Promise((resolve, reject) => {
    const sessionId = useSessionB ? sessionIdB : sessionIdA;
    const url = new URL(path, BASE_URL);
    const options = {
      hostname: url.hostname,
      port: url.port || 3002,
      path: url.pathname + url.search,
      method: method,
      headers: {
        'Content-Type': 'application/json',
        'Cookie': sessionId ? `ds.sid=${sessionId}` : '',
      }
    };

    const req = http.request(options, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          const parsed = data ? JSON.parse(data) : null;
          // Capturar session ID do set-cookie (padrão golden-path)
          const setCookie = res.headers['set-cookie'];
          if (setCookie && setCookie[0]) {
            const match = setCookie[0].match(/ds\.sid=([^;]+)/);
            if (match) {
              if (useSessionB) {
                sessionIdB = match[1];
              } else {
                sessionIdA = match[1];
              }
            }
          }
          resolve({ status: res.statusCode, body: parsed, headers: res.headers });
        } catch (e) {
          reject(e);
        }
      });
    });

    req.on('error', reject);
    if (body) req.write(JSON.stringify(body));
    req.end();
  });
}

// Marcar email como verificado direto no banco de teste
function marcarEmailVerificado(email) {
  const dbPath = path.join(TMP_DB_DIR, 'dsstore.db');
  const db = new DatabaseSync(dbPath);
  db.exec('PRAGMA foreign_keys = ON');
  const result = db.prepare('UPDATE usuarios SET email_verificado = 1 WHERE email = ?').run(email);
  db.close();
  if (result.changes === 0) {
    throw new Error(`Email ${email} não encontrado no banco de teste`);
  }
}

// Cleanup de pasta temporária
function limparTmpDb() {
  if (fs.existsSync(TMP_DB_DIR)) {
    fs.rmSync(TMP_DB_DIR, { recursive: true, force: true });
  }
}

// Tests
async function runTests() {
  console.log('\n🧪 TESTE DE ISOLAMENTO CROSS-TENANT\n');

  try {
    // 1. Health check
    console.log('✓ Health check...');
    let res = await request('GET', '/health');
    assert.strictEqual(res.status, 200, 'Health check falhou');

    // 2. Registrar Tenant A
    console.log('✓ Registrar Tenant A...');
    tenantA.email = `tenantA-${Date.now()}@teste.local`;
    tenantA.senha = 'TeSt@123456';
    res = await request('POST', '/api/registro', {
      email: tenantA.email,
      senha: tenantA.senha,
      nome_loja: 'Loja Teste A',
      nome_responsavel: 'Responsável A',
      telefone: '85999999999',
      cpf_cnpj: '11144477735'
    });
    assert.strictEqual(res.status, 201, `Registro Tenant A falhou: ${res.status} - ${JSON.stringify(res.body)}`);

    // Marcar email como verificado
    console.log('  (marcando email A como verificado)');
    marcarEmailVerificado(tenantA.email);

    // 3. Login Tenant A
    console.log('✓ Login Tenant A...');
    res = await request('POST', '/api/login', { email: tenantA.email, senha: tenantA.senha });
    assert.strictEqual(res.status, 200, `Login Tenant A falhou: ${res.status} - ${JSON.stringify(res.body)}`);
    assert(res.body.ok === true, 'Login Tenant A não retornou ok');
    assert(sessionIdA, 'Não conseguiu capturar session ID de Tenant A');

    // 4. Tenant A cria 1 cliente
    console.log('✓ Tenant A cria cliente...');
    res = await request('POST', '/api/clientes', {
      nome: 'Cliente Teste A',
      telefone: '85988888888',
      email: `cliente-a-${Date.now()}@teste.local`,
      cpf_cnpj: '22233344456'
    });
    assert.strictEqual(res.status, 201, `Criar cliente A falhou: ${res.status} - ${JSON.stringify(res.body)}`);
    assert(res.body.id > 0, 'Cliente A ID inválido');
    tenantA.clienteId = res.body.id;

    // 5. Tenant A cria 1 produto
    console.log('✓ Tenant A cria produto...');
    res = await request('POST', '/api/produtos/rapido', {
      nome: 'Produto Teste A',
      preco_venda: 99.90,
      tamanho: 'M',
      quantidade: 5
    });
    assert.strictEqual(res.status, 201, `Criar produto A falhou: ${res.status} - ${JSON.stringify(res.body)}`);
    assert(res.body.produto_id > 0, 'Produto A ID inválido');
    tenantA.produtoId = res.body.produto_id;

    // 6. Registrar Tenant B
    console.log('✓ Registrar Tenant B...');
    tenantB.email = `tenantB-${Date.now()}@teste.local`;
    tenantB.senha = 'TeSt@654321';
    res = await request('POST', '/api/registro', {
      email: tenantB.email,
      senha: tenantB.senha,
      nome_loja: 'Loja Teste B',
      nome_responsavel: 'Responsável B',
      telefone: '85998888888',
      cpf_cnpj: '33344455567'
    });
    assert.strictEqual(res.status, 201, `Registro Tenant B falhou: ${res.status} - ${JSON.stringify(res.body)}`);

    // Marcar email como verificado
    console.log('  (marcando email B como verificado)');
    marcarEmailVerificado(tenantB.email);

    // 7. Login Tenant B
    console.log('✓ Login Tenant B...');
    res = await request('POST', '/api/login', { email: tenantB.email, senha: tenantB.senha }, true);
    assert.strictEqual(res.status, 200, `Login Tenant B falhou: ${res.status} - ${JSON.stringify(res.body)}`);
    assert(res.body.ok === true, 'Login Tenant B não retornou ok');
    assert(sessionIdB, 'Não conseguiu capturar session ID de Tenant B');

    // 8. Tenant B tenta acessar produto de A — deve retornar 404
    console.log('✓ Tenant B tenta GET produto de A (esperado: 404)...');
    res = await request('GET', `/api/produtos/${tenantA.produtoId}`, null, true);
    assert.strictEqual(res.status, 404, `FALHA: Tenant B conseguiu ver produto de A! Status: ${res.status}`);

    // 9. Tenant B tenta acessar cliente de A — deve retornar 404
    console.log('✓ Tenant B tenta GET cliente de A (esperado: 404)...');
    res = await request('GET', `/api/clientes/${tenantA.clienteId}`, null, true);
    assert.strictEqual(res.status, 404, `FALHA: Tenant B conseguiu ver cliente de A! Status: ${res.status}`);

    // 10. Tenant B lista produtos — não deve conter produto de A
    console.log('✓ Tenant B lista produtos (não deve conter de A)...');
    res = await request('GET', '/api/produtos', null, true);
    assert.strictEqual(res.status, 200, `Listagem produtos B falhou: ${res.status}`);
    assert(Array.isArray(res.body), 'Produtos B não é array');
    const temProdutoA = res.body.some(p => p.id === tenantA.produtoId);
    assert(!temProdutoA, `FALHA: Tenant B viu produto de A na listagem!`);

    // 11. Tenant B lista clientes — não deve conter cliente de A
    console.log('✓ Tenant B lista clientes (não deve conter de A)...');
    res = await request('GET', '/api/clientes', null, true);
    assert.strictEqual(res.status, 200, `Listagem clientes B falhou: ${res.status}`);
    assert(Array.isArray(res.body), 'Clientes B não é array');
    const temClienteA = res.body.some(c => c.id === tenantA.clienteId);
    assert(!temClienteA, `FALHA: Tenant B viu cliente de A na listagem!`);

    // 12. Tenant A acessa seus dados novamente — confirma isolamento
    console.log('✓ Tenant A acessa seus dados novamente (esperado: 200)...');
    res = await request('GET', `/api/produtos/${tenantA.produtoId}`);
    assert.strictEqual(res.status, 200, `Tenant A não conseguiu acessar seu próprio produto! Status: ${res.status}`);
    assert(res.body.id === tenantA.produtoId, 'Produto não é do Tenant A');

    res = await request('GET', `/api/clientes/${tenantA.clienteId}`);
    assert.strictEqual(res.status, 200, `Tenant A não conseguiu acessar seu próprio cliente! Status: ${res.status}`);
    assert(res.body.id === tenantA.clienteId, 'Cliente não é do Tenant A');

    // 13. Validação estática: grep por req.tenantId || 1 (antipadrão perigoso)
    console.log('✓ Validação estática: verificando req.tenantId || 1...');
    const routesDir = path.join(__dirname, '..', 'routes');
    let foundBadPattern = false;
    const files = fs.readdirSync(routesDir).filter(f => f.endsWith('.js'));
    for (const file of files) {
      const content = fs.readFileSync(path.join(routesDir, file), 'utf8');
      if (content.includes('req.tenantId || 1') || content.match(/req\.tenantId\s*\|\|/)) {
        console.error(`  ❌ Antipadrão encontrado em ${file}: req.tenantId || ...`);
        foundBadPattern = true;
      }
    }
    assert(!foundBadPattern, 'Encontrado req.tenantId || fallback em alguma rota!');

    // Cleanup
    console.log('✓ Limpando banco de teste...');
    limparTmpDb();

    console.log('\n✅ TODOS OS TESTES DE ISOLAMENTO CROSS-TENANT PASSARAM\n');
    process.exit(0);
  } catch (err) {
    console.error('\n❌ TESTE FALHOU:\n', err.message);
    console.error(err.stack);
    // Cleanup mesmo em caso de erro
    try {
      limparTmpDb();
    } catch (e) {
      console.error('Aviso: não conseguiu limpar banco de teste:', e.message);
    }
    process.exit(1);
  }
}

// Aguardar servidor inicializar (3s de margem)
setTimeout(runTests, 3000);
