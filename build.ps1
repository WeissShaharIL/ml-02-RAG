$ErrorActionPreference = "Stop"

Write-Host "Building frontend-chat..." -ForegroundColor Cyan
Set-Location frontend-chat
npm install
if ($LASTEXITCODE -ne 0) { Write-Host "frontend-chat npm install failed" -ForegroundColor Red; exit 1 }
npm run build
if ($LASTEXITCODE -ne 0) { Write-Host "frontend-chat build failed" -ForegroundColor Red; exit 1 }
Set-Location ..

Write-Host "Building frontend-dash..." -ForegroundColor Cyan
Set-Location frontend-dash
npm install
if ($LASTEXITCODE -ne 0) { Write-Host "frontend-dash npm install failed" -ForegroundColor Red; exit 1 }
npm run build
if ($LASTEXITCODE -ne 0) { Write-Host "frontend-dash build failed" -ForegroundColor Red; exit 1 }
Set-Location ..

Write-Host "Starting Docker..." -ForegroundColor Cyan
docker compose up --build