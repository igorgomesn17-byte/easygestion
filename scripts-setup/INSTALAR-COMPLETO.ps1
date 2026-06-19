# ============================================================
# Instalador Completo do EASYGESTION
# Execute: .\INSTALAR-COMPLETO.ps1
# ============================================================

$ErrorActionPreference = "SilentlyContinue"

Write-Host ""
Write-Host "╔════════════════════════════════════════════╗" -ForegroundColor Cyan
Write-Host "║   EASYGESTION - Instalador Completo        ║" -ForegroundColor Cyan
Write-Host "║   Sistema de Gestão para Loja             ║" -ForegroundColor Cyan
Write-Host "╚════════════════════════════════════════════╝" -ForegroundColor Cyan
Write-Host ""

# 1. Verificar se Node.js está instalado
Write-Host "1️⃣  Verificando Node.js..." -ForegroundColor Yellow
$nodeCheck = node --version 2>$null
if ($LASTEXITCODE -ne 0) {
    Write-Host "❌ Node.js não encontrado***REMOVED***" -ForegroundColor Red
    Write-Host ""
    Write-Host "Instale Node.js em: https://nodejs.org (versão 18+)" -ForegroundColor Cyan
    Write-Host ""
    Write-Host "Depois execute este script novamente." -ForegroundColor Yellow
    Read-Host "Pressione ENTER para sair"
    exit 1
}

Write-Host "✅ Node.js $nodeCheck instalado" -ForegroundColor Green

# 2. Verificar NPM
Write-Host ""
Write-Host "2️⃣  Verificando NPM..." -ForegroundColor Yellow
$npmCheck = npm --version 2>$null
if ($LASTEXITCODE -ne 0) {
    Write-Host "❌ NPM não está funcionando***REMOVED***" -ForegroundColor Red
    Read-Host "Pressione ENTER para sair"
    exit 1
}

Write-Host "✅ NPM $npmCheck ok" -ForegroundColor Green

# 3. Instalar dependências
Write-Host ""
Write-Host "3️⃣  Instalando dependências..." -ForegroundColor Yellow
Write-Host "    (isso pode levar 2-3 minutos)" -ForegroundColor Gray
Write-Host ""

npm install

if ($LASTEXITCODE -ne 0) {
    Write-Host ""
    Write-Host "❌ Erro na instalação***REMOVED***" -ForegroundColor Red
    Read-Host "Pressione ENTER para sair"
    exit 1
}

Write-Host ""
Write-Host "✅ Instalação concluída***REMOVED***" -ForegroundColor Green
Write-Host ""
Write-Host "═══════════════════════════════════════════════════════════" -ForegroundColor Cyan
Write-Host ""
Write-Host "🚀 PRÓXIMOS PASSOS:" -ForegroundColor Green
Write-Host ""
Write-Host "1. Abra um terminal NOVO nesta pasta" -ForegroundColor White
Write-Host "2. Execute:" -ForegroundColor White
Write-Host ""
Write-Host "   npm start" -ForegroundColor Yellow
Write-Host ""
Write-Host "3. O sistema vai iniciar em: http://localhost:3000" -ForegroundColor White
Write-Host ""
Write-Host "═══════════════════════════════════════════════════════════" -ForegroundColor Cyan
Write-Host ""

Read-Host "Pressione ENTER para fechar"
