param([switch]$PrepareOnly, [switch]$Stop, [ValidateRange(3106,3199)][int]$Port = 3110)
$ErrorActionPreference = 'Stop'
Set-Location (Split-Path $PSScriptRoot -Parent)
if ($Stop) { & "$PSScriptRoot/voice-qa.ps1" -Stop -Port $Port; return }
cargo check --locked --all-targets --target-dir target-review-phase6
if ($LASTEXITCODE -ne 0) { throw 'Falha na compilacao.' }
cargo test --locked --all-targets --target-dir target-review-phase6
if ($LASTEXITCODE -ne 0) { throw 'Falha nos testes Rust.' }
node --test tests/frontend-*.test.cjs
if ($LASTEXITCODE -ne 0) { throw 'Falha nos testes da interface.' }
Get-ChildItem static -Recurse -Filter '*.js' | ForEach-Object {
    node --check $_.FullName
    if ($LASTEXITCODE -ne 0) { throw "JavaScript invalido: $($_.Name)" }
}
if ($PrepareOnly) {
    & "$PSScriptRoot/voice-qa.ps1" -PrepareOnly -Port $Port
    Write-Host 'Homologacao preparada. Nenhum dado de producao foi aberto; nenhuma release foi criada.'
} else {
    & "$PSScriptRoot/voice-qa.ps1" -Port $Port
    Write-Host 'Confira Aparencia, Voz e video, Perfil, Convites e Integracoes no tema Claro e Escuro.'
}
