@echo off
title Zeno
cd /d "%~dp0"
echo.
echo   ZENO - reason before action
echo   ---------------------------
echo.

if not exist "node_modules\.bin\electron.cmd" (
  echo   First run - installing. This takes a few minutes...
  call npm install
  if errorlevel 1 ( echo. & echo   Install failed. & pause & exit /b 1 )
)

if not exist "packages\daemon\dist\src\main.js" (
  echo   Building...
  call npm run build --silent
  if errorlevel 1 ( echo. & echo   Build failed. & pause & exit /b 1 )
)

echo   Opening Zeno...
call node_modules\.bin\electron.cmd packages\desktop
