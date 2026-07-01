param(
  [switch]$NoDashboard,
  [switch]$NoScorer
)

Write-Host "=== Starting mini-XDR stack ===" -ForegroundColor Cyan

# 0. Kill any leftover processes from previous runs
Write-Host "[0/5] Cleaning up leftover processes..." -ForegroundColor Yellow
& "$PSScriptRoot\stop-all.ps1" -Silent
Start-Sleep -Seconds 2

# 1. Infrastructure
Write-Host "[1/5] Starting Redis + Mongo with Docker..." -ForegroundColor Yellow
docker compose up -d 2>&1 | Out-Null

Write-Host "      Waiting for Redis..." -NoNewline
do { Start-Sleep -Seconds 1; $ok = $false; try { $t = New-Object System.Net.Sockets.TcpClient; $t.ConnectAsync('127.0.0.1',6379).Wait(2000); if ($t.Connected) { $t.Close(); $ok = $true } } catch {} } while (-not $ok)
Write-Host " up" -ForegroundColor Green

Write-Host "      Waiting for Mongo..." -NoNewline
do { Start-Sleep -Seconds 1; $ok = $false; try { $t = New-Object System.Net.Sockets.TcpClient; $t.ConnectAsync('127.0.0.1',27017).Wait(2000); if ($t.Connected) { $t.Close(); $ok = $true } } catch {} } while (-not $ok)
Write-Host " up" -ForegroundColor Green

# 2. Ingestion API
Write-Host "[2/5] Starting ingestion API on port 4000..." -ForegroundColor Yellow
$ingJob = Start-Process -NoNewWindow -FilePath "node" -ArgumentList "ingestion-api.js" -PassThru
Start-Sleep -Seconds 2
Write-Host "      PID $($ingJob.Id)" -ForegroundColor Green

# 3. Rules consumer
Write-Host "[3/5] Starting rules consumer..." -ForegroundColor Yellow
$rulesJob = Start-Process -NoNewWindow -FilePath "node" -ArgumentList "rules-consumer.js" -PassThru
Start-Sleep -Seconds 1
Write-Host "      PID $($rulesJob.Id)" -ForegroundColor Green

# 4. ML scorer (optional)
$scorerJob = $null
if (-not $NoScorer) {
  Write-Host "[4/5] Starting ML scorer on port 8000..." -ForegroundColor Yellow
  $scorerJob = Start-Process -NoNewWindow -FilePath "D:\projects\networkids\ml-scorer\.venv\Scripts\python.exe" `
    -ArgumentList "-m", "uvicorn", "main:app", "--port", "8000" `
    -WorkingDirectory "D:\projects\networkids\ml-scorer" -PassThru
  Start-Sleep -Seconds 3
  Write-Host "      PID $($scorerJob.Id)" -ForegroundColor Green
}

# 5. Broadcast server
Write-Host "[5/5] Starting broadcast server on port 5000..." -ForegroundColor Yellow
$bcastJob = Start-Process -NoNewWindow -FilePath "node" -ArgumentList "broadcast-server.js" -PassThru
Start-Sleep -Seconds 2
Write-Host "      PID $($bcastJob.Id)" -ForegroundColor Green

# Dashboard (optional)
$dashJob = $null
if (-not $NoDashboard) {
  Write-Host "[+] Starting dashboard on port 3000..." -ForegroundColor Yellow
  $dashJob = Start-Process -NoNewWindow -FilePath "cmd.exe" -ArgumentList "/c npx next dev" -WorkingDirectory "D:\projects\networkids\dashboard" -PassThru
  Start-Sleep -Seconds 5
  Write-Host "      PID $($dashJob.Id)" -ForegroundColor Green
}

Write-Host ""
Write-Host "=== All services started ===" -ForegroundColor Cyan
Write-Host "  Ingestion API : http://localhost:4000" -ForegroundColor White
Write-Host "  Broadcast     : http://localhost:5000" -ForegroundColor White
if ($scorerJob) { Write-Host "  ML Scorer     : http://localhost:8000" -ForegroundColor White }
if ($dashJob)   { Write-Host "  Dashboard     : http://localhost:3000" -ForegroundColor White }
Write-Host ""
Write-Host "To stop everything, run:  .\stop-all.ps1" -ForegroundColor Yellow
Write-Host "To send test events:      node send-test-events.js" -ForegroundColor Yellow
