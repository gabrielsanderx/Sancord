param([string]$OutputDir = 'dist')
$ErrorActionPreference = 'Stop'
Set-Location (Split-Path $PSScriptRoot -Parent)
& "$PSScriptRoot/build-desktop.ps1" -OutputDir $OutputDir
cargo build --locked --release --bin sancord-release
if ($LASTEXITCODE -ne 0) { throw 'Falha ao compilar ferramenta de assinatura.' }
$metadata = cargo metadata --locked --no-deps --format-version 1 | ConvertFrom-Json
$version = ($metadata.packages | Where-Object name -eq 'sancord').version
$changelog = Get-Content -LiteralPath CHANGELOG.md -Raw
$pattern = '(?ms)^## ' + [regex]::Escape($version) + '\r?\n(.*?)(?=^## |\z)'
$match = [regex]::Match($changelog, $pattern)
if (-not $match.Success -or [string]::IsNullOrWhiteSpace($match.Groups[1].Value)) { throw 'Adicione as notas desta versão em CHANGELOG.md.' }
$notesPath = Join-Path (Resolve-Path -LiteralPath $OutputDir).Path 'release-notes.md'
[IO.File]::WriteAllText($notesPath, $match.Groups[1].Value.Trim(), [Text.UTF8Encoding]::new($false))
Copy-Item -LiteralPath target/release/sancord-release.exe -Destination (Join-Path $OutputDir 'release-tools.exe')
# O ZIP contém apenas o cliente. Banco e backend do anfitrião nunca são atualizados pelo cliente.
Compress-Archive -LiteralPath (Join-Path $OutputDir 'Sanvo.exe') -DestinationPath (Join-Path $OutputDir "Sanvo-$version-windows-x64.zip") -Force
# LEGACY COMPATIBILITY: pacote ZIP de transição
Compress-Archive -LiteralPath (Join-Path $OutputDir 'Sancord.exe') -DestinationPath (Join-Path $OutputDir "Sancord-$version-windows-x64.zip") -Force
Write-Host "Pacote Windows Sanvo $version gerado. Nada foi publicado."
