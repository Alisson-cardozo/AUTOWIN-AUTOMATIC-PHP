@echo off
cd /d "%~dp0.."
echo AutoWin - Bac Bo WebSocket feed (resultados Evolution)
echo Deixe esta janela aberta. Ctrl+C para parar.
echo.
node bot\bacbo-ws-feed.cjs
pause
