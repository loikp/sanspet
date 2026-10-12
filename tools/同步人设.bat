@echo off
chcp 936 >nul
cd /d "%~dp0"
echo.
echo 正在把人设文件同步进 App...
echo.
node sync-prompt.js
echo.
pause
