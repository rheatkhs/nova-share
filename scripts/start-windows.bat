@echo off
title NovaShare - Windows Backup Sender
echo ================================================================
echo   NovaShare - Starting Windows Sender + Web Dashboard UI...
echo ================================================================
start "" "http://localhost:7650"
if exist "%~dp0..\dist\novashare-windows.exe" (
  "%~dp0..\dist\novashare-windows.exe" --sender --ui-port 7650
) else (
  bun run "%~dp0..\src\index.ts" --sender --ui-port 7650
)
pause
