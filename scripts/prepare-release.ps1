param([Parameter(Mandatory)][ValidatePattern('^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$')][string]$Version)
$ErrorActionPreference = 'Stop'
Set-Location (Split-Path $PSScriptRoot -Parent)
$manifest = Get-Content Cargo.toml -Raw
$match = [regex]::Match($manifest, '(?m)^version = "([^"]+)"')
if (-not $match.Success) { throw 'Versão atual não encontrada.' }
if ([version]$Version -le [version]$match.Groups[1].Value) { throw 'Use uma versão maior que a atual.' }
$updated = ([regex]'(?m)^version = "[^"]+"').Replace($manifest, "version = `"$Version`"", 1)
[IO.File]::WriteAllText((Join-Path $PWD 'Cargo.toml'), $updated, [Text.UTF8Encoding]::new($false))
cargo metadata --offline --format-version 1 --filter-platform x86_64-pc-windows-msvc | Out-Null
if ($LASTEXITCODE -ne 0) { throw 'Revise Cargo.toml/Cargo.lock: não foi possível atualizar o lockfile.' }
Write-Host "Versão $Version preparada. Adicione a seção ## $Version ao CHANGELOG.md, revise, teste e faça commit."
Write-Host "Depois, para publicar: git tag v$Version; git push origin main; git push origin v$Version"
