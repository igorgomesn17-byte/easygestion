@echo off
chcp 65001 >nul
setlocal enabledelayedexpansion

echo.
echo ╔════════════════════════════════════════════════════════════╗
echo ║   EASYGESTION - Sistema de Gestão                          ║
echo ╚════════════════════════════════════════════════════════════╝
echo.

REM Verificar Node.js
where node >nul 2>nul
if %ERRORLEVEL% NEQ 0 (
    echo ❌ ERRO: Node.js não está instalado***REMOVED***
    echo.
    echo Baixe em: https://nodejs.org (versão 18+)
    echo.
    pause
    exit /b 1
)

REM Verificar se node_modules existe
if not exist "node_modules" (
    echo 📦 Instalando pela primeira vez (leva 2-3 minutos)...
    echo.
    call npm install
    if %ERRORLEVEL% NEQ 0 (
        echo ❌ Erro na instalação
        pause
        exit /b 1
    )
    echo.
    echo ✅ Instalação concluída***REMOVED***
    echo.
)

REM Iniciar servidor em background
echo 🚀 Iniciando EASYGESTION...
echo.

REM Matar processo anterior (se existir)
taskkill /F /IM node.exe >nul 2>nul

REM Iniciar servidor
start "EASYGESTION Server" cmd /k npm start

REM Esperar servidor iniciar
timeout /t 3 /nobreak >nul

REM Abrir navegador
echo 🌐 Abrindo navegador...
start http://localhost:3000

echo.
echo ✅ Sistema rodando em: http://localhost:3000
echo.
echo ℹ️  Janela será fechada em 5 segundos...
echo.

timeout /t 5 /nobreak

exit /b 0
