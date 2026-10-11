@echo off
chcp 65001 >nul
setlocal

rem ============================================================
rem  verniy 博客本地发布器 —— 双击本文件即可启动
rem  启动后浏览器会自动打开 http://127.0.0.1:3721
rem  关掉这个黑窗口就等于停止服务
rem ============================================================

set "BUNDLED_NODE=%USERPROFILE%\.dsh\dsh-runtimes\dsh-primary-runtime\dependencies\node\bin\node.exe"
set "SERVER=%~dp0server.js"

echo.
echo   ============================================================
echo     verniy 博客本地发布器
echo   ============================================================
echo.

rem 优先用系统里的 node，其次用 DSH 自带的 node
where node >nul 2>nul
if %errorlevel%==0 (
  set "NODE=node"
) else (
  if exist "%BUNDLED_NODE%" (
    set "NODE=%BUNDLED_NODE%"
  ) else (
    echo   [错误] 找不到 Node.js。
    echo.
    echo   请任选一种方式：
    echo     1^) 安装 Node.js：https://nodejs.org
    echo     2^) 或用命令提示符运行： winget install OpenJS.NodeJS.LTS
    echo.
    pause
    exit /b 1
  )
)

echo   正在启动，稍后浏览器会自动打开…
echo   （如果没有自动打开，请手动访问 http://127.0.0.1:3721）
echo.
start "" http://127.0.0.1:3721
"%NODE%" "%SERVER%"

echo.
echo   服务已停止。
pause
