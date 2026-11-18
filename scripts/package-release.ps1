$ErrorActionPreference = 'Stop'
Set-Location (Split-Path $PSScriptRoot -Parent)
& "$PSScriptRoot/build-desktop.ps1"
cargo build --locked --release --bin sancord-release
if ($LASTEXITCODE -ne 0) { throw 'Falha ao compilar ferramenta de assinatura.' }
$metadata = cargo metadata --locked --no-deps --format-version 1 | ConvertFrom-Json
$version = ($metadata.packages | Where-Object name -eq 'sancord').version
$changelog = Get-Content -LiteralPath CHANGELOG.md -Raw
$pattern = '(?ms)^## ' + [regex]::Escape($version) + '\r?\n(.*?)(?=^## |\z)'
$match = [regex]::Match($changelog, $pattern)
if (-not $match.Success -or [string]::IsNullOrWhiteSpace($match.Groups[1].Value)) { throw 'Adicione as notas desta versão em CHANGELOG.md.' }
[IO.File]::WriteAllText((Join-Path $PWD 'dist/release-notes.md'), $match.Groups[1].Value.Trim(), [Text.UTF8Encoding]::new($false))
Copy-Item target/release/sancord-release.exe dist/release-tools.exe
# O ZIP contém apenas o cliente. Banco e backend do anfitrião nunca são atualizados pelo cliente.
Compress-Archive -LiteralPath dist/Sancord.exe -DestinationPath "dist/Sancord-$version-windows-x64.zip" -Force
Write-Host "Pacote Windows $version gerado. Nada foi publicado."
