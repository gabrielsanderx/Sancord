param(
    [switch]$NoTunnel
)
$ErrorActionPreference = 'Stop'
$projectDir = Split-Path $PSScriptRoot -Parent
$serverExe = Join-Path $projectDir 'SancordServer.exe'
$cloudflaredExe = Join-Path $projectDir 'cloudflared.exe'
$dataDir = Join-Path $projectDir 'data'
$tunnelLog = Join-Path $dataDir 'tunnel.log'

if (-not (Test-Path $dataDir)) {
    New-Item -ItemType Directory -Path $dataDir -Force | Out-Null
}

$listening = Get-NetTCPConnection -LocalPort 3000 -State Listen -ErrorAction SilentlyContinue
if (-not $listening) {
    if (-not (Test-Path $serverExe)) {
        throw "SancordServer.exe nao encontrado em $serverExe"
    }
    Start-Process -FilePath $serverExe -WorkingDirectory $projectDir -WindowStyle Hidden | Out-Null
    Write-Host "SancordServer.exe iniciado em segundo plano (porta 3000)."
} else {
    Write-Host "Backend ja esta escutando na porta 3000."
}

if (-not $NoTunnel -and (Test-Path $cloudflaredExe)) {
    $runningTunnel = Get-CimInstance Win32_Process -Filter "Name='cloudflared.exe'" -ErrorAction SilentlyContinue | Where-Object {
        $_.ExecutablePath -eq $cloudflaredExe
    }
    if (-not $runningTunnel) {
        Start-Process -FilePath $cloudflaredExe -ArgumentList @('tunnel', '--url', 'http://localhost:3000', '--logfile', $tunnelLog) -WorkingDirectory $projectDir -WindowStyle Hidden | Out-Null
        Write-Host "Tunel cloudflared.exe iniciado em segundo plano."
    } else {
        Write-Host "Tunel cloudflared.exe ja esta em execucao."
    }
}
