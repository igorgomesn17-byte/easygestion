# Push do código para GitHub
# Usage: .\scripts\push-github.ps1

cd "c:\Users\Igor Gomes\OneDrive\Documentos\Igor MP\EASYGESTION"

Write-Host @"
╔════════════════════════════════════════════════════════════════╗
║                   📤 PUSH PARA GITHUB                         ║
╚════════════════════════════════════════════════════════════════╝
"@ -ForegroundColor Cyan

# Verificar se está tudo commitado
$status = git status --porcelain
if ($status) {
  Write-Host "`n⚠️  Existem arquivos não commitados:" -ForegroundColor Yellow
  Write-Host $status
  Write-Host "`nFaz commit primeiro***REMOVED***" -ForegroundColor Yellow
  exit 1
}

# Fazer push
Write-Host "`n📤 Fazendo push pro GitHub...`n" -ForegroundColor Cyan
git push -u origin master

if ($?) {
  Write-Host "`n✅ Push realizado com sucesso***REMOVED***" -ForegroundColor Green
  Write-Host "`nRepositório: https://github.com/igorgomesn17/easygestion" -ForegroundColor Green
  Write-Host "Próximo passo: Deploy no Render***REMOVED***" -ForegroundColor Green
} else {
  Write-Host "`n❌ Erro ao fazer push***REMOVED***" -ForegroundColor Red
  Write-Host "Verifique sua conexão e credenciais do GitHub" -ForegroundColor Red
  exit 1
}
