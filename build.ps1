# ============================================================
# HybridSlicer — Full Build & Run Script
# Usage:  .\build.ps1
# ============================================================

$ErrorActionPreference = "Stop"

$Root     = Split-Path -Parent $MyInvocation.MyCommand.Path
$Web      = "$Root\web"
$WorkDir  = "$Root\src\HybridSlicer.Api\bin\Debug\net8.0"
$LogDir   = "$Root\logs"
$LogFile  = "$LogDir\server.log"

# ── Detect local network IP ──────────────────────────────────────────────────
$LocalIP = (
    Get-NetIPAddress -AddressFamily IPv4 |
    Where-Object { $_.IPAddress -notmatch '^127\.' -and
                   $_.IPAddress -notmatch '^169\.' -and
                   $_.PrefixOrigin -ne 'WellKnown' } |
    Select-Object -First 1
).IPAddress

if (-not $LocalIP) { $LocalIP = "localhost" }

Write-Host ""
Write-Host "================================================" -ForegroundColor Cyan
Write-Host "  HybridSlicer Build Script" -ForegroundColor Cyan
Write-Host "  Network IP : $LocalIP" -ForegroundColor Yellow
Write-Host "================================================" -ForegroundColor Cyan
Write-Host ""

# ── Step 1: Stop any running server ─────────────────────────────────────────
Write-Host "[1/4] Stopping existing server on port 5000..." -ForegroundColor DarkGray
$conn = Get-NetTCPConnection -LocalPort 5000 -State Listen -ErrorAction SilentlyContinue
if ($conn) {
    Stop-Process -Id $conn[0].OwningProcess -Force -ErrorAction SilentlyContinue
    Start-Sleep -Milliseconds 600
    Write-Host "      Stopped (PID $($conn[0].OwningProcess))." -ForegroundColor DarkGray
} else {
    Write-Host "      Nothing running." -ForegroundColor DarkGray
}

# ── Step 2: Build frontend ───────────────────────────────────────────────────
Write-Host ""
Write-Host "[2/4] Building frontend (npm run build)..." -ForegroundColor Cyan
Push-Location $Web
try {
    npm run build
    if ($LASTEXITCODE -ne 0) { throw "npm build failed (exit $LASTEXITCODE)" }
} finally {
    Pop-Location
}
Write-Host "      Frontend OK." -ForegroundColor Green

# ── Step 3: Build backend ────────────────────────────────────────────────────
Write-Host ""
Write-Host "[3/4] Building backend (dotnet build)..." -ForegroundColor Cyan
Push-Location $Root
try {
    dotnet build --no-restore -v q
    if ($LASTEXITCODE -ne 0) { throw "dotnet build failed (exit $LASTEXITCODE)" }
} finally {
    Pop-Location
}
Write-Host "      Backend OK." -ForegroundColor Green

# ── Step 4: Start server ─────────────────────────────────────────────────────
Write-Host ""
Write-Host "[4/4] Starting server (bound to all interfaces)..." -ForegroundColor Cyan

# Bind to * so the app is reachable at both localhost AND the network IP
$Urls = "http://*:5000"

if (-not (Test-Path $LogDir)) { New-Item -ItemType Directory -Path $LogDir | Out-Null }

Start-Process dotnet `
    -ArgumentList "HybridSlicer.Api.dll --urls `"$Urls`"" `
    -WorkingDirectory $WorkDir `
    -WindowStyle Hidden `
    -RedirectStandardOutput $LogFile `
    -RedirectStandardError  "$LogDir\server-err.log"

# Wait for port to open (up to 15 s)
$started = $false
for ($i = 0; $i -lt 15; $i++) {
    Start-Sleep -Seconds 1
    $c = Get-NetTCPConnection -LocalPort 5000 -State Listen -ErrorAction SilentlyContinue
    if ($c) { $started = $true; break }
    Write-Host "      Waiting... ($($i+1)s)" -ForegroundColor DarkGray
}

Write-Host ""
if ($started) {
    Write-Host "================================================" -ForegroundColor Green
    Write-Host "  Server is running!" -ForegroundColor Green
    Write-Host ""
    Write-Host "  Local   : http://localhost:5000"   -ForegroundColor White
    Write-Host "  Network : http://${LocalIP}:5000"  -ForegroundColor Yellow
    Write-Host "  API docs: http://localhost:5000/swagger" -ForegroundColor DarkGray
    Write-Host ""
    Write-Host "  Logs    : $LogFile" -ForegroundColor DarkGray
    Write-Host "================================================" -ForegroundColor Green
} else {
    Write-Host "================================================" -ForegroundColor Red
    Write-Host "  Server did NOT start within 15 seconds." -ForegroundColor Red
    Write-Host "  Check logs: $LogFile" -ForegroundColor Red
    Write-Host "================================================" -ForegroundColor Red
    if (Test-Path "$LogDir\server-err.log") {
        Write-Host ""
        Write-Host "--- server-err.log ---" -ForegroundColor Red
        Get-Content "$LogDir\server-err.log" | Select-Object -Last 20
    }
    exit 1
}
