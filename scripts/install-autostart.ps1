param(
    [ValidateSet('Install', 'Uninstall', 'Status')]
    [string]$Action = 'Status'
)
$ErrorActionPreference = 'Stop'
$projectDir = Split-Path $PSScriptRoot -Parent
$startScript = Join-Path $PSScriptRoot 'start-host.ps1'
$runKeyPath = 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Run'
$valueName = 'SancordHost'
$commandValue = "powershell.exe -NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File `"$startScript`""

switch ($Action) {
    'Install' {
        if (-not (Test-Path $startScript)) {
            throw "Script de inicializacao nao encontrado: $startScript"
        }
        Set-ItemProperty -Path $runKeyPath -Name $valueName -Value $commandValue
        Write-Host "Autostart do Sancord instalado em $runKeyPath ($valueName)."
    }
    'Uninstall' {
        if (Get-ItemProperty -Path $runKeyPath -Name $valueName -ErrorAction SilentlyContinue) {
            Remove-ItemProperty -Path $runKeyPath -Name $valueName
            Write-Host "Autostart do Sancord removido de $runKeyPath."
        } else {
            Write-Host "Autostart do Sancord nao estava instalado."
        }
    }
    'Status' {
        $prop = Get-ItemProperty -Path $runKeyPath -Name $valueName -ErrorAction SilentlyContinue
        $installed = $null -ne $prop
        $port3000 = $null -ne (Get-NetTCPConnection -LocalPort 3000 -State Listen -ErrorAction SilentlyContinue)
        $tunnel = $null -ne (Get-CimInstance Win32_Process -Filter "Name='cloudflared.exe'" -ErrorAction SilentlyContinue | Where-Object {
            $_.ExecutablePath -eq (Join-Path $projectDir 'cloudflared.exe')
        })
        [PSCustomObject]@{
            AutostartInstalled = $installed
            Command            = if ($installed) { $prop.$valueName } else { $null }
            BackendPort3000    = $port3000
            CloudflaredRunning = $tunnel
        }
    }
}
