# Script para criar atalho com icon no Desktop
# Use se o instalador nao criar corretamente

$INSTALL_PATH = "C:\Program Files\EASYGESTION"
$DESKTOP_PATH = "$([System.Environment]::GetFolderPath('Desktop'))"
$ICON_PATH = "$INSTALL_PATH\public\img\logo-ds.png"

Write-Host "Criando atalho na Desktop..." -ForegroundColor Green

$WshShell = New-Object -ComObject WScript.Shell
$shortcut = $WshShell.CreateShortCut("$DESKTOP_PATH\EASYGESTION.lnk")
$shortcut.TargetPath = "cmd.exe"
$shortcut.Arguments = "/k cd /d `"$INSTALL_PATH`" && title EASYGESTION && npm start"
$shortcut.WorkingDirectory = $INSTALL_PATH
$shortcut.IconLocation = "$ICON_PATH,0"
$shortcut.Description = "EASYGESTION - Sistema de Gestao"
$shortcut.WindowStyle = 1
$shortcut.Save()

Write-Host "✓ Atalho criado com sucesso***REMOVED***" -ForegroundColor Green
Write-Host ""
Write-Host "Procure o icone 'EASYGESTION' na sua Desktop" -ForegroundColor Cyan
