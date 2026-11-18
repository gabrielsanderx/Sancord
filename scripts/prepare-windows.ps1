$ErrorActionPreference = 'Stop'
Set-Location (Split-Path $PSScriptRoot -Parent)
# O loader vem da mesma dependência que o Cargo verifica pelo checksum do lockfile.
$metadataText = cargo metadata --locked --format-version 1 --filter-platform x86_64-pc-windows-msvc
if ($LASTEXITCODE -ne 0) { throw 'Não foi possível resolver as dependências.' }
$metadata = $metadataText | ConvertFrom-Json
$package = $metadata.packages | Where-Object name -eq 'webview2-com-sys' | Select-Object -First 1
if (-not $package) { throw 'SDK WebView2 não encontrado no Cargo metadata.' }
$loader = Join-Path (Split-Path $package.manifest_path -Parent) 'x64/WebView2Loader.dll'
Copy-Item -LiteralPath $loader -Destination 'WebView2Loader.dll'
