@echo off
chcp 65001 >nul
title English Tales
cd /d "%~dp0"

where node >nul 2>nul
if errorlevel 1 (
  echo Node.js 22 이상이 필요합니다. https://nodejs.org 에서 설치한 뒤 다시 실행하세요.
  pause
  exit /b 1
)

if not exist node_modules (
  echo 처음 실행: 필요한 파일을 설치합니다...
  call npm install --no-audit --no-fund
)

rem 서버를 켜고 PC 브라우저를 자동으로 엽니다. 이 창을 닫으면 앱이 종료됩니다.
node --env-file-if-exists=.env server/index.js --open
pause
