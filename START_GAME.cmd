@echo off
setlocal
cd /d "%~dp0"

set "NODE_EXE="
for /d %%D in ("%LOCALAPPDATA%\OpenAI\Codex\runtimes\cua_node\*") do (
  if exist "%%~fD\bin\node.exe" set "NODE_EXE=%%~fD\bin\node.exe"
)
if not defined NODE_EXE (
  for /f "delims=" %%N in ('where node 2^>nul') do if not defined NODE_EXE set "NODE_EXE=%%N"
)

if not defined NODE_EXE (
  echo Node.js is required to run Quickscope King.
  echo Install Node.js 18 or newer, then run this file again.
  pause
  exit /b 1
)

if not exist "node_modules\express" (
  echo Installing game server packages...
  call npm install
  if errorlevel 1 (
    echo Package installation failed.
    pause
    exit /b 1
  )
)

echo Starting Quickscope King...
start "" http://localhost:3000
"%NODE_EXE%" server.js

echo.
echo The game server stopped. The error above explains why.
pause
