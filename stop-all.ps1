param(
  [switch]$Silent
)

if (-not $Silent) {
  Write-Host "=== Stopping all mini-XDR processes ===" -ForegroundColor Cyan
}

function Stop-ByPattern($pattern) {
  $procs = Get-CimInstance Win32_Process -Filter "Name='node.exe'" -ErrorAction SilentlyContinue |
    Where-Object { $_.CommandLine -match $pattern }
  foreach ($p in $procs) {
    Stop-Process -Id $p.ProcessId -Force -ErrorAction SilentlyContinue
    if (-not $Silent) { Write-Host "  Stopped $pattern (PID $($p.ProcessId))" -ForegroundColor Yellow }
  }
}

Stop-ByPattern "ingestion-api"
Stop-ByPattern "rules-consumer"
Stop-ByPattern "broadcast-server"
Stop-ByPattern "next"

$uvicorn = Get-CimInstance Win32_Process -Filter "Name='python.exe'" -ErrorAction SilentlyContinue |
  Where-Object { $_.CommandLine -match "uvicorn" }
foreach ($p in $uvicorn) {
  Stop-Process -Id $p.ProcessId -Force -ErrorAction SilentlyContinue
  if (-not $Silent) { Write-Host "  Stopped ML scorer (PID $($p.ProcessId))" -ForegroundColor Yellow }
}

if (-not $Silent) {
  $choice = Read-Host "Stop Docker containers (Redis + Mongo)? (y/N)"
  if ($choice -eq "y") {
    docker compose down 2>&1 | Out-Null
    Write-Host "  Docker containers stopped" -ForegroundColor Green
  }
  Write-Host "=== All stopped ===" -ForegroundColor Cyan
}
