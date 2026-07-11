@echo off
cd /d "%~dp0.."
echo Iniciando servidor + worker...
start "AutoWin PHP Server" cmd /k "%~dp0start-server.bat"
timeout /t 1 /nobreak >nul
start "AutoWin Bot Worker" cmd /k "%~dp0start-worker.bat"
echo.
echo  Servidor: http://127.0.0.1:8000  (ou 8001 se 8000 estiver ocupada)
echo  Worker: janela separada
echo.
pause
