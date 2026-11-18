$ErrorActionPreference = 'Stop'
$projectDir = Split-Path $PSScriptRoot -Parent
$allowedServers = @(
    (Join-Path $projectDir 'SancordServer.exe'),
    (Join-Path $projectDir 'dist/SancordServer.exe'),
    (Join-Path $projectDir 'target/debug/sancord.exe'),
    (Join-Path $projectDir 'target/release/sancord.exe')
) | ForEach-Object { [IO.Path]::GetFullPath($_) }
Get-NetTCPConnection -LocalPort 3000 -State Listen -ErrorAction SilentlyContinue |
    Select-Object -ExpandProperty OwningProcess -Unique | ForEach-Object {
        $backendProcess = Get-CimInstance Win32_Process -Filter "ProcessId=$_"
        if ($backendProcess.ExecutablePath -in $allowedServers) {
            Stop-Process -Id $backendProcess.ProcessId
            Write-Host 'Backend local encerrado.'
        } else {
            Write-Warning 'A porta 3000 pertence a outro programa; processo preservado.'
        }
    }
$tunnelLog = Join-Path $projectDir 'data/tunnel.log'
Get-CimInstance Win32_Process -Filter "Name='cloudflared.exe'" | Where-Object {
    $_.ExecutablePath -eq (Join-Path $projectDir 'cloudflared.exe') -and
    $_.CommandLine -and $_.CommandLine.Contains($tunnelLog.Replace('/', '\'))
} | ForEach-Object { Stop-Process -Id $_.ProcessId; Write-Host 'Túnel local encerrado.' }
