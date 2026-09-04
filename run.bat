@echo off
cd /d "%~dp0"
set ELECTRON_MIRROR=https://npmmirror.com/mirrors/electron/
if not exist "node_modules\" (
  echo Installing PlotBetter dependencies...
  call npm install
  if errorlevel 1 (
    echo Install failed. Make sure Node.js is installed: https://nodejs.org/
    pause
    exit /b 1
  )
)
echo Starting PlotBetter...
call npm start
