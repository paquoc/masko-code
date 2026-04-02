@echo off
setlocal enabledelayedexpansion

if "%~1"=="" (
    REM Auto-increment minor version from package.json
    for /f "tokens=2 delims=:" %%a in ('findstr /C:"\"version\"" "%~dp0..\package.json"') do (
        set "raw=%%a"
    )
    REM Strip quotes, spaces, comma -> e.g. 1.11.0
    set "raw=!raw: =!"
    set "raw=!raw:"=!"
    set "raw=!raw:,=!"
    for /f "tokens=1-3 delims=." %%x in ("!raw!") do (
        set "major=%%x"
        set /a "minor=%%y+1"
        set "patch=%%z"
    )
    set "VER=!major!.!minor!.!patch!"
) else (
    set "VER=%~1"
)

echo Bumping version to %VER%...
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0bump-version.ps1" -Ver "%VER%"