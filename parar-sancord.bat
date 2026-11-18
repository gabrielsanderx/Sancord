@echo off
chcp 65001 >nul
cd /d "%~dp0"
echo Encerrando backend e tunel deste projeto...
powershell -NoProfile -File "%~dp0scripts\stop-host.ps1"
pause
