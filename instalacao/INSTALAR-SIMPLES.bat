@echo off
setlocal enabledelayedexpansion

cd /d "%~dp0"

echo.
echo ========================================================
echo   EASYGESTION - Instalador Simples
echo ========================================================
echo.

REM Verificar se eh admin
net session >nul 2>&1
if %errorlevel% neq 0 (
    echo Pedindo permissao de Administrador...
    powershell -Command "Start-Process cmd.exe -ArgumentList '/c cd /d \"%~dp0\" && \"%~0\"' -Verb RunAs"
    exit /b
)

REM Verificar Node.js
echo Verificando Node.js...
where node >nul 2>nul
if %ERRORLEVEL% NEQ 0 (
    echo.
    echo ERRO: Node.js nao encontrado***REMOVED***
    echo.
    echo Instale de: https://nodejs.org
    echo.
    pause
    exit /b 1
)

echo OK - Node.js encontrado
echo.

REM Criar pasta de instalacao
set INSTALL_PATH=C:\Program Files\EASYGESTION
echo Criando pasta: %INSTALL_PATH%
if not exist "%INSTALL_PATH%" mkdir "%INSTALL_PATH%"

REM Copiar arquivos
echo Copiando arquivos...
copy /Y "package.json" "%INSTALL_PATH%\" >nul 2>&1
copy /Y "package-lock.json" "%INSTALL_PATH%\" >nul 2>&1
copy /Y "server.js" "%INSTALL_PATH%\" >nul 2>&1
copy /Y "license.js" "%INSTALL_PATH%\" >nul 2>&1
copy /Y ".env.example" "%INSTALL_PATH%\" >nul 2>&1

if exist "public" xcopy /E /Y /I /Q "public" "%INSTALL_PATH%\public\" >nul 2>&1
if exist "routes" xcopy /E /Y /I /Q "routes" "%INSTALL_PATH%\routes\" >nul 2>&1
if exist "middleware" xcopy /E /Y /I /Q "middleware" "%INSTALL_PATH%\middleware\" >nul 2>&1
if exist "lib" xcopy /E /Y /I /Q "lib" "%INSTALL_PATH%\lib\" >nul 2>&1

echo OK - Arquivos copiados
echo.

REM Instalar NPM
echo Instalando dependencias...
cd /d "%INSTALL_PATH%"
call npm install --production >nul 2>&1

if %ERRORLEVEL% NEQ 0 (
    echo ERRO na instalacao
    pause
    exit /b 1
)

echo OK - Dependencias instaladas
echo.

REM Criar atalho na Desktop com icone
echo Criando atalho na Desktop...

set DESKTOP_PATH=%USERPROFILE%\Desktop
set ICON_PATH=%INSTALL_PATH%\public\img\logo-ds.png

powershell -NoProfile -Command ^
  "$WshShell = New-Object -ComObject WScript.Shell; " ^
  "$shortcut = $WshShell.CreateShortCut('%DESKTOP_PATH%\EASYGESTION.lnk'); " ^
  "$shortcut.TargetPath = 'cmd.exe'; " ^
  "$shortcut.Arguments = '/k cd /d \"%INSTALL_PATH%\" ^&^& title EASYGESTION ^&^& npm start'; " ^
  "$shortcut.WorkingDirectory = '%INSTALL_PATH%'; " ^
  "$shortcut.IconLocation = '%ICON_PATH%,0'; " ^
  "$shortcut.Description = 'EASYGESTION - Sistema de Gestao'; " ^
  "$shortcut.Save()"

echo OK - Atalho criado com icone

echo.
echo ========================================================
echo.
echo INSTALACAO CONCLUIDA***REMOVED***
echo.
echo Sistema instalado em: %INSTALL_PATH%
echo Atalho criado na Desktop
echo.
echo Clique DUPLO no atalho EASYGESTION para abrir o sistema
echo.
echo ========================================================
echo.

pause
