@echo off
chcp 65001 >nul
cd /d "%~dp0"
if not exist "Sancord.exe" (
    echo Sancord.exe nao encontrado. Compile com scripts\build-desktop.ps1 e copie os executaveis de dist para esta pasta.
    pause
    exit /b 1
)
:: O cliente inicia o backend adjacente quando presente. Nunca abre um site.
start "" "%~dp0Sancord.exe"
