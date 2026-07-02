@echo off
chcp 65001 > nul
title EasyGestão — Sistema de Gestão

echo.
echo ========================================
echo   EasyGestão — Iniciando...
echo ========================================
echo.

cd /d "%~dp0"
npm start

pause
