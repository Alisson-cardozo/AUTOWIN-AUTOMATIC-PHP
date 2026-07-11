# Configura PHP (Herd) no PATH e corrige php.ini quebrado no Windows.
# Rode: powershell -ExecutionPolicy Bypass -File scripts\setup-dev-env.ps1

$ErrorActionPreference = "Stop"
$herdBin = "C:\Users\Aliss\.config\herd\bin"
$phpDir  = "C:\Users\Aliss\.config\herd\bin\php84"
$phpExe  = Join-Path $phpDir "php.exe"
$ini     = Join-Path $phpDir "php.ini"
$project = Split-Path (Split-Path $PSScriptRoot -Parent) -ErrorAction SilentlyContinue
if (-not $project) { $project = "C:\Users\Aliss\Desktop\autowin-php" }
# PSScriptRoot = ...\autowin-php\scripts
$project = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path

Write-Host "==> AutoWin PHP — setup do ambiente" -ForegroundColor Cyan

if (-not (Test-Path $phpExe)) {
  Write-Host "PHP do Herd nao encontrado em: $phpExe" -ForegroundColor Red
  Write-Host "Instale/repare o Laravel Herd ou o PHP 8.2+." -ForegroundColor Yellow
  exit 1
}

# 1) PATH do usuario: herd\bin + php84
$userPath = [Environment]::GetEnvironmentVariable("Path", "User")
if (-not $userPath) { $userPath = "" }
$parts = @($userPath -split ";" | Where-Object { $_ -and $_.Trim() -ne "" })
foreach ($p in @($herdBin, $phpDir)) {
  if ($parts -notcontains $p) {
    $parts += $p
    Write-Host "  + PATH: $p"
  }
}
[Environment]::SetEnvironmentVariable("Path", ($parts -join ";"), "User")
$env:Path = [Environment]::GetEnvironmentVariable("Path", "Machine") + ";" + ($parts -join ";")
Write-Host "PATH do usuario atualizado." -ForegroundColor Green

# 2) Corrigir php.ini (auto_prepend do Herd quebrado)
if (Test-Path $ini) {
  $bak = "$ini.bak-autowin"
  if (-not (Test-Path $bak)) {
    Copy-Item $ini $bak
    Write-Host "  Backup: $bak"
  }
  $lines = Get-Content $ini
  $changed = $false
  $out = foreach ($line in $lines) {
    if ($line -match '^\s*auto_prepend_file\s*=\s*.*dump-loader\.php') {
      $changed = $true
      "auto_prepend_file="
    }
    elseif ($line -match '^\s*extension\s*=\s*.*Program Files\\Herd.*') {
      $changed = $true
      ";$line"
    }
    else {
      $line
    }
  }
  if ($changed) {
    $out | Set-Content $ini -Encoding UTF8
    Write-Host "php.ini corrigido (dump-loader + extensoes Herd ausentes)." -ForegroundColor Green
  } else {
    Write-Host "php.ini ja ok." -ForegroundColor Green
  }
}

# 3) Testes
Write-Host ""
Write-Host "==> Versoes" -ForegroundColor Cyan
& $phpExe -v
Write-Host ""
$composerPhar = Join-Path $herdBin "composer.phar"
if (Test-Path $composerPhar) {
  & $phpExe $composerPhar -V
} else {
  Write-Host "composer.phar nao encontrado no Herd." -ForegroundColor Yellow
}
Write-Host "Node: $(node -v)"
Write-Host "NPM:  $(npm -v)"

Write-Host ""
Write-Host "==> Extensoes PHP" -ForegroundColor Cyan
& $phpExe -m | Select-String -Pattern "^(curl|pdo_mysql|mbstring|openssl|json|fileinfo|gd|tokenizer|xml)$"

# 4) Scripts de start do projeto
$startServer = @'
@echo off
cd /d "%~dp0.."
set PHP=C:\Users\Aliss\.config\herd\bin\php84\php.exe
echo Subindo servidor em http://localhost:8000
"%PHP%" -S localhost:8000 -t public public\router-dev.php
'@
$startWorker = @'
@echo off
cd /d "%~dp0.."
set PHP=C:\Users\Aliss\.config\herd\bin\php84\php.exe
echo Subindo bot worker...
"%PHP%" bot\worker.php
'@
$startAll = @'
@echo off
cd /d "%~dp0.."
start "AutoWin PHP Server" cmd /k "%~dp0start-server.bat"
timeout /t 1 /nobreak >nul
start "AutoWin Bot Worker" cmd /k "%~dp0start-worker.bat"
echo Servidor: http://localhost:8000
echo Worker: janela separada
'@

Set-Content -Path (Join-Path $project "scripts\start-server.bat") -Value $startServer -Encoding ASCII
Set-Content -Path (Join-Path $project "scripts\start-worker.bat") -Value $startWorker -Encoding ASCII
Set-Content -Path (Join-Path $project "scripts\start-all.bat") -Value $startAll -Encoding ASCII
Write-Host ""
Write-Host "Scripts criados:" -ForegroundColor Green
Write-Host "  scripts\start-server.bat"
Write-Host "  scripts\start-worker.bat"
Write-Host "  scripts\start-all.bat"

Write-Host ""
Write-Host "Pronto. Feche e abra o PowerShell para o PATH valer em todo terminal." -ForegroundColor Cyan
Write-Host "Depois:  php -v"
Write-Host "Ou:      scripts\start-all.bat"
