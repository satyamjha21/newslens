# ─────────────────────────────────────────────
#  NewsLens — Quick Start (Windows PowerShell)
#  Run: .\start.ps1
# ─────────────────────────────────────────────

$BackendDir = Join-Path $PSScriptRoot "backend"
$FrontendDir = Join-Path $PSScriptRoot "frontend"

Write-Host ""
Write-Host "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━" -ForegroundColor Cyan
Write-Host "  NewsLens Intelligence — Quick Start" -ForegroundColor Cyan
Write-Host "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━" -ForegroundColor Cyan

# 1. Copy .env if missing
$EnvFile = Join-Path $BackendDir ".env"
$EnvExample = Join-Path $BackendDir ".env.example"
if (-not (Test-Path $EnvFile)) {
    Copy-Item $EnvExample $EnvFile
    Write-Host "✅ Created backend/.env — add your GEMINI_API_KEY!" -ForegroundColor Green
}

# 2. Create venv if missing
$VenvDir = Join-Path $BackendDir ".venv"
if (-not (Test-Path $VenvDir)) {
    Write-Host "📦 Creating virtual environment..." -ForegroundColor Yellow
    python -m venv $VenvDir
}

# 3. Install dependencies
Write-Host "📦 Installing dependencies..." -ForegroundColor Yellow
& "$VenvDir\Scripts\pip.exe" install -r "$BackendDir\requirements.txt" -q

# 4. Start backend
Write-Host ""
Write-Host "🚀 Starting backend at http://127.0.0.1:8000 ..." -ForegroundColor Green
Set-Location $BackendDir

Start-Process -NoNewWindow -FilePath "$VenvDir\Scripts\uvicorn.exe" `
    -ArgumentList "main:app", "--reload", "--host", "127.0.0.1", "--port", "8000"

Start-Sleep -Seconds 2

Write-Host "✅ Backend running!" -ForegroundColor Green
Write-Host "📰 Dashboard: http://127.0.0.1:8000/app/" -ForegroundColor Cyan
Write-Host "📖 API Docs:  http://127.0.0.1:8000/docs" -ForegroundColor Cyan
Write-Host ""

Start-Process "http://127.0.0.1:8000/app/"

Write-Host "Press any key to stop the server..."
$null = $Host.UI.RawUI.ReadKey("NoEcho,IncludeKeyDown")
