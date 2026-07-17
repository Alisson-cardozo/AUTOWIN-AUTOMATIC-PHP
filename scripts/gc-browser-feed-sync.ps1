# Mantém Chrome no GamblingCounting e sincroniza history.json com a VPS.
# Uso: powershell -ExecutionPolicy Bypass -File scripts\gc-browser-feed-sync.ps1
$ErrorActionPreference = "Stop"
$Root = Split-Path -Parent $PSScriptRoot
Set-Location $Root

$env:GC_ONCE = "0"
$env:GC_HEADLESS = "0"

Write-Host "[gc-sync] iniciando browser feed..."
$feed = Start-Process -FilePath "node" -ArgumentList "scripts/_tmp_gc_browser_feed.cjs" -PassThru -WindowStyle Normal

Write-Host "[gc-sync] feed pid=$($feed.Id) — sincronizando a cada 5s"
try {
  while (-not $feed.HasExited) {
    Start-Sleep -Seconds 5
    if (Test-Path "storage\megaroulette-ws\history.json") {
      try {
        python scripts\_tmp_push_gc_history.py | Out-Host
      } catch {
        Write-Host "[gc-sync] push fail: $_"
      }
    }
  }
} finally {
  if (-not $feed.HasExited) { Stop-Process -Id $feed.Id -Force -ErrorAction SilentlyContinue }
}
