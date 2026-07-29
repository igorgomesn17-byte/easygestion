// ============================================================
// CANAL DE WHATSAPP — o que precisa estar certo antes de qualquer tela.
//
// Este teste existe por quatro riscos concretos:
//
//   1. DEDUP. O provedor reenvia o webhook quando nao recebe 200 rapido. Sem a
//      guarda por external_id, a mesma frase da cliente aparece duas vezes na tela
//      e reabre a janela de 24h errada.
//   2. TELEFONE. O mesmo numero chega em quatro formatos (com/sem 55, com/sem o
//      nono digito). Comparacao exata parte o historico da cliente em duas pessoas.
//   3. PROSPECT FORA DA REGUA. Quem escreveu e nunca comprou nao pode receber
//      "sentimos sua falta" — ela nunca veio. Queima o contato que o anuncio pagou.
//   4. ISOLAMENTO. Uma loja nao pode ver a conversa da outra. O `cross-tenant` e'
//      um grep no codigo: nao pega SELECT sem WHERE. So um teste que povoa dois
//      tenants pega.
//
//   node tests/whatsapp-canal.test.js
// ============================================================
process.env.DB_DIR = process.env.DB_DIR || './tests/.tmp-whatsapp';
process.env.CERT_CIPHER_KEY = process.env.CERT_CIPHER_KEY || 'chave-de-teste-com-32-caracteres!';

const fs = require('fs');
const path = require('path');

const dir = path.resolve(process.env.DB_DIR);
if (fs.existsSync(dir)) fs.rmSync(dir, { recursive: true, force: true });
fs.mkdirSync(dir, { recursive: true });

const { db } = require('../db/database');
const wa = require('../lib/whatsapp');
const conv = require('../lib/conversas');
const evolution = require('../lib/whatsapp-evolution');
const crm = require('../lib/crm');

let falhas = 0;
function ok(desc, cond, extra = '') {
  if (cond) console.log(`  ✅ ${desc}`);
  else { console.log(`  ❌ ${desc}${extra ? ' → ' + extra : ''}`); falhas++; }
}
function secao(t) { console.log(`\n${t}`); }

function criarTenant(nome, email) {
  const r = db.prepare(`
    INSERT INTO tenants (nome_loja, nome_responsavel, telefone, email, senha_hash, plano, status)
    VALUES (?, ?, '73999990000', ?, 'x', 'interno', 'ativo')
  `).run(nome, nome, email);
  return Number(r.lastInsertRowid);
}

const A = criarTenant('Loja A', 'a@teste.com');
const B = criarTenant('Loja B', 'b@teste.com');

// ------------------------------------------------------------
secao('1. Telefone: o mesmo numero em formatos diferentes');
// ------------------------------------------------------------
ok('digitado pela lojista vira E164', wa.normalizarTelefone('73 98888-7777') === '5573988887777',
   wa.normalizarTelefone('73 98888-7777'));
ok('o que o WhatsApp devolve nao muda', wa.normalizarTelefone('5573988887777') === '5573988887777');
ok('com parenteses e espaco', wa.normalizarTelefone('(73) 9 8888-7777') === '5573988887777');
ok('fixo de 10 digitos e valido', wa.normalizarTelefone('7332221100') === '557332221100');
ok('numero curto demais nao passa', wa.normalizarTelefone('99999') === '');
ok('vazio nao quebra', wa.normalizarTelefone('') === '' && wa.normalizarTelefone(null) === '');
ok('mesma pessoa em formatos diferentes', wa.mesmoNumero('73988887777', '5573988887777'));
ok('pessoas diferentes nao se confundem', !wa.mesmoNumero('73988887777', '73988887778'));

// ------------------------------------------------------------
secao('2. Credencial: cifrada, por tenant, e o webhook sabe de quem e');
// ------------------------------------------------------------
const tokenA = wa.salvarCredencial(A, { base_url: 'http://evo.local', instancia: 'lojaA', token: 'segredo-A', numero: '5573911111111' });
const tokenB = wa.salvarCredencial(B, { base_url: 'http://evo.local', instancia: 'lojaB', token: 'segredo-B', numero: '5573922222222' });

const cruA = db.prepare('SELECT token FROM integracoes_canal WHERE tenant_id = ?').get(A).token;
ok('token NAO fica em texto puro no banco', cruA !== 'segredo-A' && !cruA.includes('segredo'));
ok('mas volta decifrado pra quem tem a chave', wa.credencialDe(A).token === 'segredo-A');
ok('loja B tem a credencial dela', wa.credencialDe(B).token === 'segredo-B');
ok('webhook token aponta pro tenant certo', wa.tenantDoWebhookToken(tokenA) === A && wa.tenantDoWebhookToken(tokenB) === B);
ok('token inventado nao acha ninguem', wa.tenantDoWebhookToken('nao-existe') === null);
ok('token vazio nao acha ninguem', wa.tenantDoWebhookToken('') === null && wa.tenantDoWebhookToken(null) === null);

// reconectar nao duplica
wa.salvarCredencial(A, { base_url: 'http://evo.local', instancia: 'lojaA', token: 'segredo-A2' });
const qtd = db.prepare('SELECT COUNT(*) n FROM integracoes_canal WHERE tenant_id = ?').get(A).n;
ok('reconectar faz UPDATE, nao duplica', qtd === 1, `${qtd} linhas`);
ok('token novo substitui o antigo', wa.credencialDe(A).token === 'segredo-A2');

// ------------------------------------------------------------
secao('3. Leitura do webhook: o que NAO deve virar conversa');
// ------------------------------------------------------------
const msgBoa = {
  event: 'messages.upsert',
  data: { key: { id: 'WAMID001', remoteJid: '5573988887777@s.whatsapp.net', fromMe: false },
          pushName: 'Maria', message: { conversation: 'oi, tem na M?' } },
};
const lida = evolution.lerWebhook(msgBoa);
ok('mensagem normal e lida', lida && lida.externalId === 'WAMID001' && lida.telefone === '5573988887777');
ok('pega o nome do WhatsApp', lida.nome === 'Maria');
ok('pega o texto', lida.texto === 'oi, tem na M?');

ok('eco da NOSSA mensagem e ignorado',
   evolution.lerWebhook({ ...msgBoa, data: { ...msgBoa.data, key: { ...msgBoa.data.key, fromMe: true } } }) === null);
ok('mensagem de GRUPO e ignorada',
   evolution.lerWebhook({ ...msgBoa, data: { ...msgBoa.data, key: { ...msgBoa.data.key, remoteJid: '12345@g.us' } } }) === null);
ok('evento que nao e mensagem e ignorado',
   evolution.lerWebhook({ event: 'connection.update', data: { state: 'open' } }) === null);
ok('payload sem id e ignorado', evolution.lerWebhook({ data: { message: { conversation: 'x' } } }) === null);

const audio = evolution.lerWebhook({
  event: 'messages.upsert',
  data: { key: { id: 'WAMID_AUDIO', remoteJid: '5573988887777@s.whatsapp.net', fromMe: false },
          message: { audioMessage: { seconds: 5 } } },
});
ok('audio e reconhecido como midia', audio && audio.tipo === 'audio' && audio.temMidia === true);

// ------------------------------------------------------------
secao('4. Mensagem que chega vira card — e o contato E o cadastro');
// ------------------------------------------------------------
const r1 = conv.receberMensagem(A, lida);
ok('primeira mensagem cria conversa', r1.ok && r1.conversaId > 0);
ok('numero desconhecido vira cliente', r1.clienteId > 0);

const prospect = db.prepare('SELECT * FROM clientes WHERE id = ?').get(r1.clienteId);
ok('nasce com tipo=prospect', prospect.tipo === 'prospect', prospect.tipo);
ok('guarda o nome que veio do WhatsApp', prospect.nome === 'Maria');
ok('telefone normalizado no cadastro', prospect.telefone === '5573988887777');

const c1 = db.prepare('SELECT * FROM conversas WHERE id = ?').get(r1.conversaId);
ok('conversa nasce no estagio novo', c1.estagio === 'novo', c1.estagio);
ok('janela de 24h foi carimbada', !!c1.janela_expira_em);

const msgs = conv.mensagensDa(A, r1.conversaId);
ok('a mensagem foi gravada', msgs.length === 1 && msgs[0].direcao === 'recebida');

// ------------------------------------------------------------
secao('5. DEDUP: o provedor reenvia o mesmo webhook');
// ------------------------------------------------------------
const r2 = conv.receberMensagem(A, lida);   // MESMO externalId
ok('reenvio e detectado', r2.ok && r2.duplicada === true);
ok('nao gravou mensagem duplicada', conv.mensagensDa(A, r1.conversaId).length === 1);
const qtdCli = db.prepare('SELECT COUNT(*) n FROM clientes WHERE tenant_id = ?').get(A).n;
ok('nao criou cliente duplicado', qtdCli === 1, `${qtdCli} clientes`);

// segunda mensagem DE VERDADE, mesma pessoa
conv.receberMensagem(A, { ...lida, externalId: 'WAMID002', texto: 'ainda tem?' });
ok('mensagem nova entra na MESMA conversa', conv.mensagensDa(A, r1.conversaId).length === 2);
ok('e nao cria outro cliente', db.prepare('SELECT COUNT(*) n FROM clientes WHERE tenant_id = ?').get(A).n === 1);

// mesma pessoa, formato diferente do telefone
conv.receberMensagem(A, { externalId: 'WAMID003', telefone: '73988887777', nome: 'Maria', texto: 'oi de novo' });
ok('mesmo numero em OUTRO formato nao abre conversa nova',
   db.prepare('SELECT COUNT(*) n FROM conversas WHERE tenant_id = ?').get(A).n === 1);

// ------------------------------------------------------------
secao('6. Quem JA e cliente: card ja nasce com o historico');
// ------------------------------------------------------------
const cliReal = db.prepare(`
  INSERT INTO clientes (tenant_id, nome, telefone, total_gasto, num_compras, ultima_compra)
  VALUES (?, 'Juliana', '73977776666', 2180, 4, date('now','-10 days'))
`).run(A);
const cliRealId = Number(cliReal.lastInsertRowid);

const r3 = conv.receberMensagem(A, {
  externalId: 'WAMID010', telefone: '5573977776666', nome: 'Ju', texto: 'chegou a 44?',
});
const c3 = db.prepare('SELECT * FROM conversas WHERE id = ?').get(r3.conversaId);
ok('casou com a cliente existente', c3.cliente_id === cliRealId);
ok('quem ja comprou nao entra no funil de prospeccao', c3.estagio === 'comprou', c3.estagio);
ok('NAO criou cliente novo', db.prepare('SELECT COUNT(*) n FROM clientes WHERE tenant_id = ?').get(A).n === 2);

const listada = conv.listarConversas(A).find((x) => x.id === r3.conversaId);
ok('o card traz o valor dela', listada.total_gasto === 2180 && listada.num_compras === 4);

// ------------------------------------------------------------
secao('7. O PROSPECT FICA FORA DA REGUA REATIVA');
// ------------------------------------------------------------
// O risco: ela escreveu ontem, nunca comprou, e amanha as 06:00 recebe
// "sentimos sua falta, 30 dias sem comprar". Queima o contato que o anuncio pagou.
// Envelhece o prospect pra provar que nem assim ele entra.
db.prepare(`UPDATE clientes SET criado_em = date('now','-120 days') WHERE id = ?`).run(r1.clienteId);

const acoes = crm.acoesDoDia(A, new Date().toISOString().slice(0, 10));
const doProspect = acoes.filter((a) => a.cliente_id === r1.clienteId);
ok('prospect NAO gera nenhuma acao de regua', doProspect.length === 0,
   doProspect.map((a) => a.tipo).join(','));

// e a cliente de verdade continua sendo vista (a exclusao e' do prospect, nao geral)
db.prepare(`UPDATE clientes SET ultima_compra = date('now','-30 days') WHERE id = ?`).run(cliRealId);
const acoes2 = crm.acoesDoDia(A, new Date().toISOString().slice(0, 10));
ok('cliente de verdade continua na regua', acoes2.some((a) => a.cliente_id === cliRealId));

// ------------------------------------------------------------
secao('8. Isolamento: uma loja nao ve a conversa da outra');
// ------------------------------------------------------------
conv.receberMensagem(B, { externalId: 'WAMID_B1', telefone: '5573955554444', nome: 'Cliente da B', texto: 'oi' });

const convA = conv.listarConversas(A);
const convB = conv.listarConversas(B);
ok('loja A so ve as conversas dela', convA.every((c) => c.tenant_id === A) && convA.length === 2, `${convA.length}`);
ok('loja B so ve a dela', convB.length === 1 && convB[0].tenant_id === B);
ok('cliente da B nao aparece na A', !convA.some((c) => c.contato_nome === 'Cliente da B'));

// mensagem da conversa de OUTRA loja nao vaza
const msgsCruzado = conv.mensagensDa(B, r1.conversaId);
ok('mensagens de conversa alheia nao vazam', msgsCruzado.length === 0);

// ------------------------------------------------------------
secao('9. Dono: assumir e nao roubar');
// ------------------------------------------------------------
const u1 = Number(db.prepare(`INSERT INTO usuarios (tenant_id, nome, senha_hash, papel) VALUES (?, 'carla', 'x', 'relacionamento')`).run(A).lastInsertRowid);
const u2 = Number(db.prepare(`INSERT INTO usuarios (tenant_id, nome, senha_hash, papel) VALUES (?, 'rita', 'x', 'relacionamento')`).run(A).lastInsertRowid);

ok('primeiro a assumir fica com a conversa', conv.assumir(A, r1.conversaId, u1) === true);
ok('o outro NAO rouba', conv.assumir(A, r1.conversaId, u2) === false);
ok('assumir de novo e idempotente', conv.assumir(A, r1.conversaId, u1) === true);
ok('a conversa aponta pro dono certo',
   db.prepare('SELECT usuario_id FROM conversas WHERE id = ?').get(r1.conversaId).usuario_id === u1);

const filaCarla = conv.listarConversas(A, { usuarioId: u1 });
ok('a fila de cada um e separada', filaCarla.length === 1 && filaCarla[0].id === r1.conversaId);
ok('fila de quem nao assumiu nada vem vazia', conv.listarConversas(A, { usuarioId: u2 }).length === 0);

// ------------------------------------------------------------
secao('10. Envio sem canal configurado degrada, nao quebra');
// ------------------------------------------------------------
(async () => {
  const semCanal = await wa.enviarTexto(B + 999, '73988887777', 'oi');
  ok('loja sem canal devolve semCanal (pro fallback wa.me)', semCanal.semCanal === true && semCanal.ok === false);

  const telRuim = await wa.enviarTexto(A, 'abc', 'oi');
  ok('telefone invalido nao explode', telRuim.ok === false && !telRuim.semCanal);

  const vazio = await wa.enviarTexto(A, '73988887777', '   ');
  ok('mensagem vazia nao e enviada', vazio.ok === false);

  ok('temCanal responde certo', wa.temCanal(A) === true && wa.temCanal(B + 999) === false);

  // ------------------------------------------------------------
  secao('11. Envio REAL contra um provedor de mentira');
  // ------------------------------------------------------------
  // Este bloco existe por um motivo especifico: whatsapp.js requer o adaptador, e o
  // adaptador chegou a requerer whatsapp.js de volta. O ciclo entrega module.exports
  // pela metade — fetchComTimeout vinha `undefined` e SO quebraria no primeiro envio
  // de verdade, em producao. Nenhum teste que apenas importa os modulos pega isso;
  // so um que EXERCITA o caminho HTTP inteiro.
  const http = require('http');
  const recebidos = [];
  const fake = http.createServer((req, res) => {
    let corpo = '';
    req.on('data', (c) => { corpo += c; });
    req.on('end', () => {
      recebidos.push({ url: req.url, apikey: req.headers.apikey, corpo: JSON.parse(corpo || '{}') });
      if (req.url.includes('erro')) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({ message: 'instancia desconectada' }));
      }
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ key: { id: 'WAMID_ENVIADO_1' } }));
    });
  });

  await new Promise((r) => fake.listen(0, '127.0.0.1', r));
  const porta = fake.address().port;

  wa.salvarCredencial(A, {
    base_url: `http://127.0.0.1:${porta}`, instancia: 'lojaA', token: 'apikey-secreta',
  });

  const env = await wa.enviarTexto(A, '73988887777', 'oi Maria, chegou coleção nova');
  ok('envio real devolve ok', env.ok === true, env.erro);
  ok('e traz o id da mensagem (dedup do eco depende dele)', env.externalId === 'WAMID_ENVIADO_1');
  ok('bateu na URL da instancia certa', recebidos[0]?.url === '/message/sendText/lojaA', recebidos[0]?.url);
  ok('mandou a apikey decifrada', recebidos[0]?.apikey === 'apikey-secreta');
  ok('numero foi normalizado antes de sair', recebidos[0]?.corpo?.number === '5573988887777');

  // instancia caida: nao pode estourar excecao pra quem chamou
  wa.salvarCredencial(A, { base_url: `http://127.0.0.1:${porta}/erro`, instancia: 'lojaA', token: 'apikey-secreta' });
  const falhou = await wa.enviarTexto(A, '73988887777', 'teste');
  ok('provedor com erro devolve ok:false, sem lancar', falhou.ok === false);
  ok('e explica o motivo', /desconectada|HTTP/.test(falhou.erro || ''), falhou.erro);

  // provedor inacessivel (porta fechada) — o caso real de instancia derrubada
  wa.salvarCredencial(A, { base_url: 'http://127.0.0.1:1', instancia: 'lojaA', token: 'x' });
  const morto = await wa.enviarTexto(A, '73988887777', 'teste');
  ok('provedor fora do ar nao derruba o processo', morto.ok === false && !!morto.erro);

  // gravar a mensagem enviada e' o que faz o historico existir
  conv.registrarEnviada(A, { conversaId: r1.conversaId, externalId: 'WAMID_ENVIADO_1', texto: 'oi Maria', usuarioId: u1 });
  const todas = conv.mensagensDa(A, r1.conversaId);
  ok('enviada entra no historico da conversa', todas.some((m) => m.direcao === 'enviada' && m.texto === 'oi Maria'));
  ok('primeira_resposta_em foi carimbada (o KPI de tempo)',
     !!db.prepare('SELECT primeira_resposta_em FROM conversas WHERE id = ?').get(r1.conversaId).primeira_resposta_em);

  // nota interna: a cliente nunca ve
  conv.registrarNota(A, { conversaId: r1.conversaId, texto: 'disse que volta dia 20', usuarioId: u1 });
  const comNota = conv.mensagensDa(A, r1.conversaId);
  ok('nota interna fica na conversa', comNota.some((m) => m.direcao === 'nota'));
  ok('e nao se confunde com o que foi enviado',
     comNota.filter((m) => m.direcao === 'enviada').length === 1);

  fake.close();

  console.log(falhas === 0
    ? '\n✅ CANAL OK — dedup, telefone, prospect fora da regua, isolamento e envio real provados'
    : `\n❌ ${falhas} FALHA(S)`);
  process.exit(falhas ? 1 : 0);
})();
