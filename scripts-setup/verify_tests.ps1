Write-Host "🔍 VERIFICAÇÃO RÁPIDA DO MVP — DRE-EXPRESS" -ForegroundColor Cyan
Write-Host "==========================================="
Write-Host ""

# Helper function para testes
function Test-Endpoint {
  param([string]$endpoint, [string]$description)
  try {
    $response = Invoke-WebRequest -Uri "http://localhost:3003$endpoint" -Method GET -TimeoutSec 5 -ErrorAction Stop
    Write-Host "✅ $description" -ForegroundColor Green
    return $true
  } catch {
    Write-Host "❌ $description" -ForegroundColor Red
    return $false
  }
}

# Testes HTTP
Write-Host "📋 Verificando endpoints..." -ForegroundColor Yellow
$tests = @(
  ("/login.html", "Login page"),
  ("/index.html", "Dashboard"),
  ("/pdv.html", "PDV"),
  ("/caixa.html", "Caixa"),
  ("/financeiro.html", "Financeiro"),
  ("/estoque.html", "Estoque"),
  ("/produtos.html", "Produtos"),
  ("/historico.html", "Histórico"),
  ("/trocas.html", "Trocas/Devoluções"),
  ("/clientes.html", "Clientes"),
  ("/vendedores.html", "Equipe"),
  ("/config.html", "Configurações"),
  ("/fluxo-caixa.html", "Fluxo de Caixa"),
  ("/fluxo.html", "DRE")
)

$passed = 0
foreach ($test in $tests) {
  if (Test-Endpoint $test[0] $test[1]) {
    $passed++
  }
}

Write-Host ""
Write-Host "RESULTADO: $passed/$($tests.Length) telas respondendo" -ForegroundColor Cyan
Write-Host ""

if ($passed -eq $tests.Length) {
  Write-Host "🎉 MVP PRONTO PARA LANÇAR***REMOVED***" -ForegroundColor Green
  Write-Host ""
  Write-Host "Próximas etapas:" -ForegroundColor Yellow
  Write-Host "1. Abrir navegador em http://localhost:3003"
  Write-Host "2. Fazer login"
  Write-Host "3. Seguir checklist em CHECKLIST_MVP.md"
  Write-Host "4. Testar fluxo completo: Venda → Caixa → Financeiro"
} else {
  Write-Host "⚠️  Algumas telas não estão respondendo. Verifique o servidor." -ForegroundColor Yellow
}
