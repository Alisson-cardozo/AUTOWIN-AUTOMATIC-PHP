@echo off
cd /d "%~dp0.."
set PHP=C:\Users\Aliss\.config\herd\bin\php84\php.exe
if not exist "%PHP%" set PHP=php

set PORT=8000

REM Se a porta 8000 estiver presa (comum no Windows), usa 8001
netstat -ano | findstr ":8000" | findstr "LISTENING" >nul 2>&1
if %ERRORLEVEL%==0 (
  echo Porta 8000 ocupada - usando 8001
  set PORT=8001
)

echo.
echo ============================================
echo  AutoWin - servidor PHP
echo  Abra no navegador: http://127.0.0.1:%PORT%
echo.
echo  Deixe ESTA janela aberta.
echo  A mensagem "started" e normal - o site ja esta no ar.
echo  Ctrl+C para parar.
echo ============================================
echo.

REM 127.0.0.1  = evita bug do Windows com localhost so em IPv6
REM router-dev.php = OBRIGATORIO para /login e /api/*
"%PHP%" -S 127.0.0.1:%PORT% -t public public\router-dev.php
pause
