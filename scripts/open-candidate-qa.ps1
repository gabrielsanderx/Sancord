# Copiado junto dos executaveis da candidata. Usa o backend isolado da homologacao.
$ErrorActionPreference = 'Stop'
$health = Invoke-RestMethod 'http://127.0.0.1:3110/api/health'
if (-not $health.ok) { throw 'Inicie primeiro o ambiente de homologacao na porta 3110.' }
$previous = @{}
$variables = @{
    SANCORD_SERVER_URL = 'http://127.0.0.1:3110'
    SANCORD_DISABLE_LOCAL_HOST = '1'
    SANCORD_REGISTER_PROTOCOL = '0'
    SANCORD_DISABLE_UPDATES = '1'
    SANCORD_DESKTOP_DATA_DIR = (Join-Path $env:LOCALAPPDATA 'SancordCandidateQA20261118')
    SANCORD_WINDOW_TITLE = 'Sancord - Candidata QA'
}
try {
    foreach ($name in $variables.Keys) {
        $previous[$name] = [Environment]::GetEnvironmentVariable($name, 'Process')
        [Environment]::SetEnvironmentVariable($name, $variables[$name], 'Process')
    }
    $exe = Join-Path $PSScriptRoot 'Sancord.exe'
    if (-not (Test-Path -LiteralPath $exe)) { throw 'Execute a copia deste script dentro do pacote candidato.' }
    & $exe
    if ($LASTEXITCODE -ne 0) { throw 'Nao foi possivel abrir a candidata.' }
} finally {
    foreach ($name in $previous.Keys) { [Environment]::SetEnvironmentVariable($name, $previous[$name], 'Process') }
}
