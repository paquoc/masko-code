@echo off
if "%~1"=="" (
    echo Usage: bump-version.bat ^<version^>
    echo Example: bump-version.bat 1.8.0
    exit /b 1
)
echo Bumping version to %~1...
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0bump-version.ps1" -Ver "%~1"
