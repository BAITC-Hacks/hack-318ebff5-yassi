@echo off
chcp 65001 >nul
cd /d "%~dp0"
where node >nul 2>&1
if errorlevel 1 (
  echo Node.js 24 немесе жаңарақ нұсқасын орнатыңыз: https://nodejs.org/
  pause
  exit /b 1
)
echo NAQTY: http://localhost:3000
echo Браузерде осы сілтемені ашыңыз. Тоқтату үшін Ctrl+C басыңыз.
node server.mjs
pause
