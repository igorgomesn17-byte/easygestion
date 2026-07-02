@echo off
setlocal enabledelayedexpansion

REM Executar PowerShell como Admin
cd /d "%~dp0"
powershell -NoProfile -ExecutionPolicy Bypass -Command "& {Start-Process PowerShell -ArgumentList '-NoProfile -ExecutionPolicy Bypass -File \"%~dp0INSTALAR-SISTEMA.ps1\"' -Verb RunAs}"

pause
