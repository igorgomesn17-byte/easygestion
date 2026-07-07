@echo off
REM Deploy Manual - EasyGestão para AWS EC2
REM Este script conecta ao servidor e faz o deploy

setlocal enabledelayedexpansion

set SERVER_IP=54.232.77.5
set SERVER_USER=ubuntu
set KEY_PATH=%USERPROFILE%\.ssh\easygestion-key.pem
set APP_DIR=/opt/easygestion

echo.
echo ============================================
echo   DEPLOY MANUAL - EasyGestao
echo ============================================
echo.
echo IP: %SERVER_IP%
echo Usuario: %SERVER_USER%
echo Chave: %KEY_PATH%
echo.

REM Verificar se a chave existe
if not exist "%KEY_PATH%" (
    echo [ERRO] Chave nao encontrada: %KEY_PATH%
    echo.
    echo A chave deve estar em %%USERPROFILE%%\.ssh\easygestion-key.pem
    pause
    exit /b 1
)

echo [*] Conectando ao servidor...
echo.

REM SSH + executar comandos
ssh -i "%KEY_PATH%" -o StrictHostKeyChecking=no "%SERVER_USER%@%SERVER_IP%" << EOFSCRIPT

echo "[*] Atualizando codigo do GitHub..."
cd %APP_DIR%
git fetch origin
git reset --hard origin/main

if !errorlevel! neq 0 (
    echo "[ERRO] Falha ao atualizar o codigo"
    exit /b 1
)

echo "[*] Instalando dependencias..."
npm install --production

if !errorlevel! neq 0 (
    echo "[ERRO] Falha ao instalar dependencias"
    exit /b 1
)

echo "[*] Reiniciando aplicacao..."
pm2 restart easygestion
pm2 save

echo "[*] Aguardando 5 segundos..."
sleep 5

echo "[*] Testando aplicacao..."
curl -s http://localhost:3001/health | grep -q "ok"
if !errorlevel! equ 0 (
    echo "[OK] Aplicacao respondendo!"
) else (
    echo "[AVISO] Verificar logs: pm2 logs easygestion"
)

echo.
echo "======================================"
echo "  [OK] DEPLOY CONCLUIDO!"
echo "======================================"
echo.
echo Ultimas linhas dos logs:
pm2 logs easygestion --lines 10

EOFSCRIPT

pause
