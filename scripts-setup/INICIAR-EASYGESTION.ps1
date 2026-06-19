# EasyGestão — Script de inicialização
Write-Host "========================================" -ForegroundColor Green
Write-Host "  EasyGestão — Sistema de Gestão" -ForegroundColor Green
Write-Host "========================================" -ForegroundColor Green
Write-Host ""

$projectPath = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location $projectPath

Write-Host "Iniciando servidor em $projectPath..." -ForegroundColor Cyan
Write-Host ""

# Inicia npm start em background
$npmProcess = Start-Process npm -ArgumentList "start" -PassThru -NoNewWindow

# Aguarda o servidor ficar pronto (2 segundos)
Start-Sleep -Seconds 3

# Abre o Chrome automaticamente
$chromePath = "C:\Program Files\Google\Chrome\Application\chrome.exe"
if (Test-Path $chromePath) {
  Write-Host "Abrindo Chrome..." -ForegroundColor Cyan
  & $chromePath "http://localhost:3001"
} else {
  Write-Host "Chrome não encontrado. Abra manualmente: http://localhost:3001" -ForegroundColor Yellow
}

# Aguarda o processo do npm
$npmProcess | Wait-Process
