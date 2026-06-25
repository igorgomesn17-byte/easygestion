// ============================================================
// Testes de Golden Path (fluxo principal)
// Usa a API real sem mocks
//
// Rodar: npm test
// ============================================================

const http = require('http');
const assert = require('assert');

const BASE_URL = 'http://localhost:3001';
let sessionId = null;
let customerId = null;
let productId = null;

// Helper para fazer requisições HTTP
function request(method, path, body = null, headers = {}) {
  return new Promise((resolve, reject) => {
    const url = new URL(path, BASE_URL);
    const options = {
      hostname: url.hostname,
      port: url.port || 3001,
      path: url.pathname + url.search,
      method: method,
      headers: {
        'Content-Type': 'application/json',
        'Cookie': sessionId ? `ds.sid=${sessionId}` : '',
        ...headers
      }
    };

    const req = http.request(options, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          const parsed = data ? JSON.parse(data) : null;
          // Capturar session ID do set-cookie
          const setCookie = res.headers['set-cookie'];
          if (setCookie && setCookie[0]) {
            const match = setCookie[0].match(/ds\.sid=([^;]+)/);
            if (match) sessionId = match[1];
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

// Tests
async function runTests() {
  console.log('\n🧪 TESTE DE GOLDEN PATH - EASYGESTION\n');

  try {
    // 1. Health check
    console.log('✓ Health check...');
    let res = await request('GET', '/health');
    assert.strictEqual(res.status, 200, 'Health check falhou');
    assert(res.body.status === 'ok', 'Status não é "ok"');

    // 2. Login
    console.log('✓ Login admin...');
    res = await request('POST', '/api/admin/login', { senha: 'dsstore' });
    assert.strictEqual(res.status, 200, `Login falhou: ${res.status}`);
    assert(res.body.ok === true, 'Login não retornou ok');

    // 3. Get config (precisa estar logado)
    console.log('✓ Get config (autenticado)...');
    res = await request('GET', '/api/config');
    assert.strictEqual(res.status, 200, 'Não conseguiu buscar config');
    assert(typeof res.body === 'object', 'Config não é objeto');

    // 4. Criar cliente
    console.log('✓ Criar cliente...');
    res = await request('POST', '/api/clientes', {
      nome: 'Maria Silva',
      telefone: '85987654321',
      email: `maria-${Date.now()}@test.com`,
      cpf_cnpj: '12345678910'
    });
    assert.strictEqual(res.status, 201, `Criação cliente falhou: ${res.status} - ${JSON.stringify(res.body)}`);
    assert(res.body.id > 0, 'Cliente ID inválido');
    customerId = res.body.id;

    // 5. Listar clientes
    console.log('✓ Listar clientes...');
    res = await request('GET', '/api/clientes');
    assert.strictEqual(res.status, 200, 'Listagem clientes falhou');
    assert(Array.isArray(res.body), 'Clientes não é array');

    // 6. Criar produto
    console.log('✓ Criar produto...');
    res = await request('POST', '/api/produtos/rapido', {
      nome: 'Camiseta Test',
      preco_venda: 49.90,
      tamanho: 'M',
      quantidade: 10
    });
    assert.strictEqual(res.status, 201, `Criação produto falhou: ${res.status}`);
    assert(res.body.variacao_id > 0, 'Variação ID inválido');
    productId = res.body.produto_id;

    // 7. Listar produtos
    console.log('✓ Listar produtos...');
    res = await request('GET', '/api/produtos');
    assert.strictEqual(res.status, 200, 'Listagem produtos falhou');
    assert(Array.isArray(res.body), 'Produtos não é array');

    // 8. Get estoque
    console.log('✓ Get estoque...');
    res = await request('GET', '/api/estoque');
    assert.strictEqual(res.status, 200, 'Estoque falhou');
    assert(Array.isArray(res.body), 'Estoque não é array');

    // 9. Get dashboard
    console.log('✓ Get dashboard...');
    res = await request('GET', '/api/dashboard');
    assert.strictEqual(res.status, 200, 'Dashboard falhou');
    assert(typeof res.body === 'object', 'Dashboard não é objeto');

    // 10. Logout
    console.log('✓ Logout...');
    res = await request('POST', '/api/logout');
    assert.strictEqual(res.status, 200, 'Logout falhou');

    console.log('\n✅ TODOS OS TESTES PASSARAM\n');
    process.exit(0);
  } catch (err) {
    console.error('\n❌ TESTE FALHOU:\n', err.message);
    console.error(err);
    process.exit(1);
  }
}

// Aguardar servidor inicializar
setTimeout(runTests, 2000);
