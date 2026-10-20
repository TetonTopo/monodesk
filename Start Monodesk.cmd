@echo off
cd /d "%~dp0"
where node >nul 2>nul || (
  echo Monodesk needs Node.js. Install the LTS version from https://nodejs.org, then run this again.
  pause
  exit /b 1
)
if not exist node_modules call npm install
rem An update that changed Electron leaves .needs-install. Wait for the old Monodesk to close, then install.
if exist .needs-install (
  echo Finishing the Monodesk update...
  timeout /t 3 /nobreak >nul
  call npm install
  del .needs-install
)
rem Electron downloads its program the first time, about 100 MB.
if not exist "node_modules\electron\dist\electron.exe" (
  echo Downloading Electron, about 100 MB. This only happens once.
  call node node_modules\electron\install.js
)
rem Electron runs on its own, so this window closes and Monodesk keeps running.
start "" "%~dp0node_modules\electron\dist\electron.exe" "%~dp0."
