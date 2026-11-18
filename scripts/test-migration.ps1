$ErrorActionPreference = 'Stop'
Set-Location (Split-Path $PSScriptRoot -Parent)
$qaMigrationDir = Join-Path (Get-Location) ('qa-migration-' + [guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $qaMigrationDir | Out-Null
New-Item -ItemType File -Path (Join-Path $qaMigrationDir '.migration-qa') | Out-Null
@'
import pathlib,sqlite3,sys
source=pathlib.Path('data/sancord.db').resolve()
destination=pathlib.Path(sys.argv[1])/'sancord.db'
with sqlite3.connect(source.as_uri()+'?mode=ro',uri=True) as original:
    with sqlite3.connect(destination) as copy: original.backup(copy)
print('Snapshot consistente criado; banco original aberto somente para leitura.')
'@ | python - $qaMigrationDir
if ($LASTEXITCODE -ne 0) { throw 'Falha ao copiar o banco. Nenhuma migracao executada.' }
cargo run --locked --bin sancord-release --target-dir target-review-phase6 -- check-migration $qaMigrationDir
if ($LASTEXITCODE -ne 0) { throw 'Falha na verificacao da copia.' }
Write-Host 'Resultado preservado na pasta de QA ignorada pelo Git. Nao compartilhar a copia: ela contem dados reais.'
