@echo off
cd /d "%~dp0.."
set PHP=C:\Users\Aliss\.config\herd\bin\php84\php.exe
if not exist "%PHP%" set PHP=php

echo.
echo  AutoWin - bot worker
echo  (deixe esta janela aberta; Ctrl+C para parar)
echo.

"%PHP%" bot\worker.php
pause
