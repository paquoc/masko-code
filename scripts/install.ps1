# Masko Code installer for Windows
# Usage: irm https://raw.githubusercontent.com/paquoc/masko-code/main/scripts/install.ps1 | iex

$ErrorActionPreference = "Stop"
$repo = "paquoc/masko-code"

Write-Host ""
Write-Host "  Masko Code Installer" -ForegroundColor Cyan
Write-Host "  --------------------" -ForegroundColor DarkGray
Write-Host ""

# Get latest release info
Write-Host "  Fetching latest release..." -ForegroundColor Gray
$release = Invoke-RestMethod "https://api.github.com/repos/$repo/releases/latest"
$version = $release.tag_name
Write-Host "  Found $version" -ForegroundColor Green

# Find the NSIS setup exe
$asset = $release.assets | Where-Object { $_.name -match "x64-setup\.exe$" } | Select-Object -First 1
if (-not $asset) {
    Write-Host "  ERROR: No Windows installer found in release $version" -ForegroundColor Red
    return
}

$url = $asset.browser_download_url
$fileName = $asset.name
$tempDir = Join-Path $env:TEMP "masko-install"
$tempFile = Join-Path $tempDir $fileName

# Download
New-Item -ItemType Directory -Force -Path $tempDir | Out-Null
Write-Host "  Downloading $fileName..." -ForegroundColor Gray
Invoke-WebRequest -Uri $url -OutFile $tempFile -UseBasicParsing

$size = [math]::Round((Get-Item $tempFile).Length / 1MB, 1)
Write-Host "  Downloaded ${size}MB" -ForegroundColor Green

# Run installer
Write-Host "  Running installer..." -ForegroundColor Gray
Start-Process -FilePath $tempFile -Wait

# Cleanup
Remove-Item -Path $tempDir -Recurse -Force -ErrorAction SilentlyContinue

Write-Host ""
Write-Host "  Masko Code $version installed!" -ForegroundColor Green
Write-Host ""
