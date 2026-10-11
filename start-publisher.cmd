@echo off
chcp 65001 >nul
setlocal enableextensions

rem ============================================================
rem  verniy blog local publisher - double click to start
rem  opens http://127.0.0.1:3721 in your browser
rem  close this window to stop the server
rem ============================================================

set "SERVER=%~dp0tools\publisher\server.js"
if not exist "%SERVER%" (
  echo.
  echo [ERROR] server.js not found next to this file:
  echo   %SERVER%
  echo.
  pause
  exit /b 1
)

set "NODE="

rem 1) prefer node from PATH
for %%I in (node.exe) do if not defined NODE set "NODE=%%~$PATH:I"

rem 2) fall back to a local Node bundled with DSH
if not defined NODE if exist "%USERPROFILE%\.dsh\dsh-runtimes\dsh-primary-runtime\dependencies\node\bin\node.exe" set "NODE=%USERPROFILE%\.dsh\dsh-runtimes\dsh-primary-runtime\dependencies\node\bin\node.exe"

rem 3) fall back to the usual install locations
if not defined NODE if exist "%ProgramFiles%\nodejs\node.exe" set "NODE=%ProgramFiles%\nodejs\node.exe"
if not defined NODE if exist "%ProgramFiles(x86)%\nodejs\node.exe" set "NODE=%ProgramFiles(x86)%\nodejs\node.exe"
if not defined NODE if exist "%LOCALAPPDATA%\Programs\nodejs\node.exe" set "NODE=%LOCALAPPDATA%\Programs\nodejs\node.exe"

if not defined NODE (
  echo.
  echo [ERROR] Node.js not found.
  echo.
  echo   Install it with one of these:
  echo     1^) winget install OpenJS.NodeJS.LTS
  echo     2^) download from https://nodejs.org
  echo.
  pause
  exit /b 1
)

echo.
echo   ============================================================
echo     verniy blog local publisher
echo   ============================================================
echo.
echo   Node : %NODE%
echo   Open : http://127.0.0.1:3721
echo.
echo   Starting... keep this window open while writing.
echo.
start "" http://127.0.0.1:3721
"%NODE%" "%SERVER%"

echo.
echo   Server stopped.
pause
