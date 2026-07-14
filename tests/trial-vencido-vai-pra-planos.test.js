// ============================================================
// O FLUXO DO FIM DO TRIAL, como foi desenhado:
//
//   14 dias no Growth completo → trial vence → o sistema TRAVA → o cliente é levado
//   à tela de planos → ele ESCOLHE e PAGA → destrava.
//
// Três coisas tinham que ser verdade ao mesmo tempo, e nenhuma era:
//
//   1. Ele CONSEGUE ENTRAR. Antes, o cobranca-scheduler marcava tenants.status =
//      'bloqueado' quando a data vencia — o mesmo estado de "banido pelo admin". O
//      cliente levava "Sua conta foi bloqueada pelo administrador" na cara do login e
//      nem via a tela de planos. (Corrigido em lib/stripe.js: trial não é inadimplência.)
//
//   2. O SISTEMA FICA BLOQUEADO. Antes, o validarTenantAtivo testava
//      `req.path.startsWith('/api')` — mas o middleware é montado com
//      app.use('/api', ...), então req.path é RELATIVO ('/produtos', não
//      '/api/produtos'). O teste era SEMPRE FALSO: o trial vencido usava o sistema
//      inteiro de graça. (Corrigido usando req.baseUrl + req.path.)
//
//   3. Ele CONSEGUE PAGAR. Barrar tudo o prenderia numa tela de planos que não carrega
//      e num botão que não funciona. As rotas de saída (/me, /assinaturas/*) passam.
//
//   node tests/trial-vencido-vai-pra-planos.test.js   (precisa do servidor no ar)
// ============================================================
const BASE = process.env.BASE_URL || 'http://localhost:3005';

let falhas = 0;
const ok = (desc, cond, extra = '') => {
  if (cond) console.log(`  ✅ ${desc}`);
  else { console.log(`  ❌ ${desc}${extra ? ' → ' + extra : ''}`); falhas++; }
};

async function rodar() {
  console.log('\n🎟️  FLUXO DO FIM DO TRIAL\n');

  const login = await fetch(BASE + '/api/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'trial@x.com', senha: 'TrialTeste#2026' }),
    redirect: 'manual',
  });
  const corpoLogin = await login.json().catch(() => null);
  ok('CONSEGUE ENTRAR (não leva "conta bloqueada pelo administrador")',
    login.status === 200, `status ${login.status} ${JSON.stringify(corpoLogin)}`);

  const sc = login.headers.get('set-cookie');
  if (!sc) { console.log('\n❌ sem cookie de sessão — não dá pra continuar\n'); process.exit(1); }
  const cookie = sc.split(';')[0];

  // O sistema em si fica travado.
  const prod = await fetch(BASE + '/api/produtos', { headers: { Cookie: cookie } });
  const corpoProd = await prod.json().catch(() => null);
  ok('o SISTEMA fica bloqueado (não usa produtos/PDV/estoque)',
    prod.status === 403, `status ${prod.status}`);
  ok('e é mandado pra tela de PLANOS',
    corpoProd?.redirecionar === '/planos.html' && corpoProd?.trial_expirado === true,
    JSON.stringify(corpoProd));
  if (corpoProd?.erro) console.log(`     mensagem: "${corpoProd.erro}"`);

  // ...mas ele PRECISA conseguir escolher e pagar, senão fica preso.
  console.log('');
  const planos = await fetch(BASE + '/api/assinaturas/planos', { headers: { Cookie: cookie } });
  ok('MAS consegue VER os planos (não fica preso)', planos.status === 200, `status ${planos.status}`);

  const me = await fetch(BASE + '/api/me', { headers: { Cookie: cookie } });
  ok('e /api/me responde (a tela de planos consegue montar)', me.status === 200, `status ${me.status}`);

  const checkout = await fetch(BASE + '/api/assinaturas/checkout', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Cookie: cookie },
    body: JSON.stringify({ plano: 'starter', ciclo: 'mensal' }),
  });
  // 403 seria o guard barrando. Qualquer outro status significa que passou do guard
  // (500 é esperado num ambiente de teste sem Price ID real do Stripe).
  ok('e o botão de PAGAR não é barrado pelo bloqueio',
    checkout.status !== 403, `status ${checkout.status}`);

  console.log(falhas === 0 ? '\n✅ O FLUXO DESENHADO FUNCIONA\n' : `\n❌ ${falhas} falha(s)\n`);
  process.exit(falhas === 0 ? 0 : 1);
}

rodar().catch((e) => { console.error('\n❌ ERRO:', e.message, '\n'); process.exit(1); });
