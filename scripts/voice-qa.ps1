param([switch]$PrepareOnly, [switch]$Stop, [ValidateRange(3106,3199)][int]$Port = 3106)
$ErrorActionPreference = 'Stop'
$projectDir = Split-Path $PSScriptRoot -Parent
Set-Location $projectDir
$qaDir = Join-Path $projectDir "qa-voice-local-$Port"
$recordPath = Join-Path $qaDir 'processes.json'
$serverExe = Join-Path $projectDir 'target-review-phase6/debug/sancord.exe'
$clientExe = Join-Path $projectDir 'target-review-phase6/debug/SancordApp.exe'
if ($Stop) {
    if (Test-Path -LiteralPath $recordPath) {
        foreach ($record in (Get-Content -LiteralPath $recordPath -Raw | ConvertFrom-Json)) {
            $process = Get-Process -Id $record.id -ErrorAction SilentlyContinue
            if ($process -and $process.Path -eq $record.path -and
                $process.StartTime.ToUniversalTime().Ticks.ToString() -eq $record.started) {
                Stop-Process -Id $process.Id
            }
        }
    }
    Write-Host 'Somente os processos desta sessão de QA foram encerrados. Dados preservados.'
    return
}
if (Test-Path -LiteralPath $recordPath) {
    $active = @(Get-Content -LiteralPath $recordPath -Raw | ConvertFrom-Json | Where-Object {
        $p = Get-Process -Id $_.id -ErrorAction SilentlyContinue
        $p -and $p.Path -eq $_.path -and $p.StartTime.ToUniversalTime().Ticks.ToString() -eq $_.started
    })
    if ($active.Count) { throw 'Uma sessão já está aberta. Encerre-a com scripts/voice-qa.ps1 -Stop antes de recompilar.' }
}
if (Get-NetTCPConnection -State Listen -LocalPort $Port -ErrorAction SilentlyContinue) { throw "Porta $Port ocupada. Escolha outra com -Port; nenhum processo foi interrompido." }
& "$PSScriptRoot/prepare-windows.ps1"
cargo build --locked --bin sancord --bin SancordApp --target-dir target-review-phase6
if ($LASTEXITCODE -ne 0) { throw 'Não foi possível compilar o ambiente de voz.' }
New-Item -ItemType Directory -Force -Path $qaDir | Out-Null
$credentialsPath = Join-Path $qaDir 'credentials.json'
if (-not (Test-Path -LiteralPath $credentialsPath)) {
    $credentials = @{ base = "http://127.0.0.1:$Port"; password = ('qa-' + [guid]::NewGuid().ToString('N')); users = @('VozQA_A','VozQA_B') }
    [IO.File]::WriteAllText($credentialsPath, ($credentials | ConvertTo-Json), [Text.UTF8Encoding]::new($false))
}
if ($PrepareOnly) { Write-Host 'Executáveis e perfis de QA preparados. Nenhuma janela ou microfone foi aberto.'; return }
$records = @()
function Start-QaProcess([string]$Exe, [hashtable]$Variables) {
    $start = [Diagnostics.ProcessStartInfo]::new()
    $start.FileName = $Exe
    $start.WorkingDirectory = $projectDir
    $start.UseShellExecute = $false
    $start.CreateNoWindow = $true
    foreach ($key in $Variables.Keys) { $start.EnvironmentVariables[$key] = [string]$Variables[$key] }
    $process = [Diagnostics.Process]::Start($start)
    return @{ id = $process.Id; path = $Exe; started = $process.StartTime.ToUniversalTime().Ticks.ToString() }
}
try {
    $records += Start-QaProcess $serverExe @{ SANCORD_BIND="127.0.0.1:$Port"; SANCORD_DATA_DIR=(Join-Path $qaDir 'data'); SANCORD_LOG_DIR=(Join-Path $qaDir 'logs'); SANCORD_DISCOVERY='0' }
    $records | ConvertTo-Json | Set-Content -LiteralPath $recordPath -Encoding utf8
    $ready = $false
    for ($attempt=0; $attempt -lt 30; $attempt++) {
        try { $health = Invoke-RestMethod "http://127.0.0.1:$Port/api/health"; if ($health.ok) { $ready=$true; break } } catch { Start-Sleep -Milliseconds 200 }
    }
    if (-not $ready) { throw 'O backend isolado não iniciou. Consulte os logs da pasta de QA.' }
    node "$PSScriptRoot/seed-voice-qa.mjs" $credentialsPath
    if ($LASTEXITCODE -ne 0) { throw 'Falha ao preparar contas e servidor de QA.' }
    foreach ($name in @('A','B')) {
        $records += Start-QaProcess $clientExe @{ SANCORD_SERVER_URL="http://127.0.0.1:$Port"; SANCORD_DISABLE_LOCAL_HOST='1'; SANCORD_REGISTER_PROTOCOL='0'; SANCORD_DISABLE_UPDATES='1'; SANCORD_DESKTOP_DATA_DIR=(Join-Path $qaDir "profile-$name"); SANCORD_WINDOW_TITLE="Sancord - Voz QA $name" }
        $records | ConvertTo-Json | Set-Content -LiteralPath $recordPath -Encoding utf8
    }
    $credentials = Get-Content -LiteralPath $credentialsPath -Raw | ConvertFrom-Json
    Write-Host 'Janelas A e B abertas; entre com VozQA_A e VozQA_B, respectivamente.'
    Write-Host "Senha exclusiva deste QA: $($credentials.password)"
    Write-Host 'Abra o servidor Voz QA local e o mesmo canal de voz nas duas janelas.'
    Write-Host 'A captura do microfone só começa quando você entrar na voz ou testar o microfone.'
} catch {
    Write-Warning 'A preparação não terminou. Use scripts/voice-qa.ps1 -Stop para encerrar somente esta sessão.'
    throw
}
