@echo off
chcp 936 >nul
cd /d "%~dp0"
echo.
echo ==========================================
echo   SansPet 分段规则测试
echo ==========================================
echo.
where node >nul 2>nul
if errorlevel 1 (
  echo [错误] 没找到 Node.js，请先安装： https://nodejs.org
  echo.
  pause
  exit /b
)
node split-test.js
echo.
pause
