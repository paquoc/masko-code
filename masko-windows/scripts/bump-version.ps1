param([Parameter(Mandatory)][string]$Ver)

$root = Split-Path $PSScriptRoot

$files = @(
    @{ Path = "$root\package.json";                                   Pattern = '"version": "[^"]+"';      Replace = "`"version`": `"$Ver`"" },
    @{ Path = "$root\src-tauri\tauri.conf.json";                      Pattern = '"version": "[^"]+"';      Replace = "`"version`": `"$Ver`"" },
    @{ Path = "$root\src\components\dashboard\SettingsPanel.tsx";      Pattern = 'v\d+\.\d+\.\d+';         Replace = "v$Ver" }
)

foreach ($f in $files) {
    $content = Get-Content $f.Path -Raw
    $content = $content -replace $f.Pattern, $f.Replace
    Set-Content $f.Path -Value $content -NoNewline
    $name = $f.Path.Replace($root, '').TrimStart('\')
    Write-Host "  [OK] $name"
}

Write-Host "`nDone! Version bumped to $Ver"
