param([switch]$Tracked)
$ErrorActionPreference = 'Stop'
Set-Location (Split-Path $PSScriptRoot -Parent)
$files = if ($Tracked) { @(git ls-files) } else { @(git diff --cached --name-only --diff-filter=ACMR) }
if ($LASTEXITCODE -ne 0) { throw 'Não foi possível ler o índice Git.' }
$bad = @()
foreach ($file in $files) {
    if ($file -match '^(data(?:/|-)|logs/|qa-|target|dist/|\.secrets/|update-keys/)' -or
        $file -match '(?i)(?:^|/)\.env(?:\.|$)|\.(?:key|pem|pfx|p12|secret|db|sqlite|exe|dll|pdb|zip)$') {
        $bad += $file; continue
    }
    $text = if ($Tracked) { git show "HEAD:$file" } else { git show ":$file" }
    if ($LASTEXITCODE -ne 0) { throw "Não foi possível examinar $file" }
    if (($text -join "`n") -match '(?:-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----|gh[pousr]_[A-Za-z0-9]{30,}|github_pat_[A-Za-z0-9_]{30,}|AKIA[0-9A-Z]{16})') { $bad += $file }
}
if ($bad.Count) { throw ('Arquivos com dados proibidos ou possíveis segredos: ' + ($bad -join ', ')) }
Write-Host "Auditoria concluída: $($files.Count) arquivos; nenhum segredo conhecido detectado. Revise o diff antes do push."
