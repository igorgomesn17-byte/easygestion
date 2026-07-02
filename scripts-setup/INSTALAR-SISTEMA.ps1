# INSTALLER DO EASYGESTION
# Execute como Administrador: Run as Administrator
# Clique direito > Run with PowerShell

# Require admin
if (-NOT ([Security.Principal.WindowsPrincipal] [Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole] "Administrator")) {
    Write-Host "Este instalador precisa rodar como Administrador***REMOVED***" -ForegroundColor Red
    Write-Host "Clique direito no arquivo > Run with PowerShell (As Administrator)" -ForegroundColor Yellow
    Read-Host "Pressione ENTER para sair"
    exit 1
}

$ErrorActionPreference = "SilentlyContinue"

Write-Host ""
Write-Host "╔════════════════════════════════════════════════════════╗" -ForegroundColor Green
Write-Host "║   EASYGESTION - Instalador Profissional                ║" -ForegroundColor Green
Write-Host "╚════════════════════════════════════════════════════════╝" -ForegroundColor Green
Write-Host ""

# Caminho de instalacao
$installPath = "C:\Program Files\EASYGESTION"
$sourceDir = $PSScriptRoot

Write-Host "1️⃣ Verificando Node.js..." -ForegroundColor Cyan
$nodeCheck = node --version 2>$null
if ($LASTEXITCODE -ne 0) {
    Write-Host "   Node.js nao encontrado. Baixando..." -ForegroundColor Yellow
    # Aqui voce poderia baixar Node.js, mas eh complicado
    # Por enquanto, avisar o usuario
    Write-Host ""
    Write-Host "   ERRO: Node.js nao esta instalado***REMOVED***" -ForegroundColor Red
    Write-Host "   Instale de: https://nodejs.org (versao 18+)" -ForegroundColor Yellow
    Write-Host "   Reinicie o PC apos instalar" -ForegroundColor Yellow
    Write-Host ""
    Read-Host "   Pressione ENTER apos instalar Node.js"

    # Verificar novamente
    $nodeCheck = node --version 2>$null
    if ($LASTEXITCODE -ne 0) {
        Write-Host "   Node.js ainda nao encontrado. Abortando." -ForegroundColor Red
        exit 1
    }
}
Write-Host "   ✓ Node.js $nodeCheck" -ForegroundColor Green

# Criar pasta de instalacao
Write-Host ""
Write-Host "2️⃣ Instalando arquivos..." -ForegroundColor Cyan
if (***REMOVED***(Test-Path $installPath)) {
    New-Item -ItemType Directory -Path $installPath -Force | Out-Null
}

# Copiar arquivos
Write-Host "   Copiando arquivos..." -ForegroundColor Gray
Copy-Item "$sourceDir\package.json" $installPath -Force
Copy-Item "$sourceDir\package-lock.json" $installPath -Force
Copy-Item "$sourceDir\server.js" $installPath -Force
Copy-Item "$sourceDir\license.js" $installPath -Force
Copy-Item "$sourceDir\.env.example" $installPath -Force

# Copiar pastas
Copy-Item "$sourceDir\public" $installPath -Recurse -Force
Copy-Item "$sourceDir\routes" $installPath -Recurse -Force
Copy-Item "$sourceDir\middleware" $installPath -Recurse -Force
Copy-Item "$sourceDir\lib" $installPath -Recurse -Force

Write-Host "   ✓ Arquivos copiados" -ForegroundColor Green

# Instalar NPM packages
Write-Host ""
Write-Host "3️⃣ Instalando dependencias..." -ForegroundColor Cyan
Write-Host "   (pode levar 3-5 minutos)" -ForegroundColor Gray
cd $installPath
npm install --production 2>&1 | Out-Null

if ($LASTEXITCODE -ne 0) {
    Write-Host "   ✗ Erro na instalacao" -ForegroundColor Red
    Read-Host "   Pressione ENTER"
    exit 1
}
Write-Host "   ✓ Dependencias instaladas" -ForegroundColor Green

# Criar atalho na Desktop
Write-Host ""
Write-Host "4️⃣ Criando atalho..." -ForegroundColor Cyan
$desktopPath = "$([System.Environment]::GetFolderPath('Desktop'))"
$shortcutPath = "$desktopPath\EASYGESTION.lnk"

$WshShell = New-Object -ComObject WScript.Shell
$shortcut = $WshShell.CreateShortCut($shortcutPath)
$shortcut.TargetPath = "cmd.exe"
$shortcut.Arguments = "/k cd /d `"$installPath`" && npm start"
$shortcut.WorkingDirectory = $installPath
$shortcut.Description = "EASYGESTION - Sistema de Gestao"
$shortcut.IconLocation = "$installPath\public\img\logo-ds.png"
$shortcut.Save()

Write-Host "   ✓ Atalho criado na Desktop" -ForegroundColor Green

# Criar menu iniciar
Write-Host ""
Write-Host "5️⃣ Criando menu iniciar..." -ForegroundColor Cyan
$startMenuPath = "$([System.Environment]::GetFolderPath('StartMenu'))\Programs\EASYGESTION"
if (***REMOVED***(Test-Path $startMenuPath)) {
    New-Item -ItemType Directory -Path $startMenuPath -Force | Out-Null
}

$startMenuShortcut = "$startMenuPath\EASYGESTION.lnk"
$shortcut2 = $WshShell.CreateShortCut($startMenuShortcut)
$shortcut2.TargetPath = "cmd.exe"
$shortcut2.Arguments = "/k cd /d `"$installPath`" && npm start"
$shortcut2.WorkingDirectory = $installPath
$shortcut2.Description = "EASYGESTION - Sistema de Gestao"
$shortcut2.IconLocation = "$installPath\public\img\logo-ds.png"
$shortcut2.Save()

Write-Host "   ✓ Entrada no menu iniciar criada" -ForegroundColor Green

# Resumo
Write-Host ""
Write-Host "════════════════════════════════════════════════════════" -ForegroundColor Green
Write-Host ""
Write-Host "✅ INSTALACAO CONCLUIDA***REMOVED***" -ForegroundColor Green
Write-Host ""
Write-Host "Sistema instalado em: C:\Program Files\EASYGESTION" -ForegroundColor Cyan
Write-Host "Atalho criado em: Desktop" -ForegroundColor Cyan
Write-Host ""
Write-Host "════════════════════════════════════════════════════════" -ForegroundColor Green
Write-Host ""
Write-Host "COMO USAR:" -ForegroundColor Yellow
Write-Host ""
Write-Host "  1. Clique no atalho 'EASYGESTION' da Desktop" -ForegroundColor White
Write-Host "  2. Navegador abre em http://localhost:3000" -ForegroundColor White
Write-Host "  3. Cola o codigo que receber" -ForegroundColor White
Write-Host "  4. Clica em Ativar" -ForegroundColor White
Write-Host "  5. PRONTO***REMOVED*** 30 dias de acesso" -ForegroundColor White
Write-Host ""
Write-Host "════════════════════════════════════════════════════════" -ForegroundColor Green
Write-Host ""

Read-Host "Pressione ENTER para concluir"
