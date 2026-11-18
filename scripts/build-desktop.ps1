$ErrorActionPreference = 'Stop'
Set-Location (Split-Path $PSScriptRoot -Parent)
$previousApp = $env:SANCORD_APP_EXE
try {
    & "$PSScriptRoot/prepare-windows.ps1"
    cargo build --locked --release --bin sancord --bin SancordApp
    if ($LASTEXITCODE -ne 0) { throw 'Falha ao compilar servidor e aplicativo.' }
    $env:SANCORD_APP_EXE = (Resolve-Path 'target/release/SancordApp.exe').Path
    cargo build --locked --release --features bundle --bin SancordBundle
    if ($LASTEXITCODE -ne 0) { throw 'Falha ao empacotar o aplicativo.' }
    New-Item -ItemType Directory -Force -Path dist | Out-Null
    Copy-Item -LiteralPath 'target/release/SancordBundle.exe' -Destination 'dist/Sancord.exe'
    Copy-Item -LiteralPath 'target/release/sancord.exe' -Destination 'dist/SancordServer.exe'
    Write-Host 'Pronto: dist/Sancord.exe (cliente) e dist/SancordServer.exe (backend do anfitrião).'
} finally {
    $env:SANCORD_APP_EXE = $previousApp
}
