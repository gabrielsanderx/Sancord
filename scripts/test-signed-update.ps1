param([ValidateSet('Prepare','Start','Install','Status')][string]$Action = 'Status')
# Ensaio offline com pacotes reais assinados. Executar Start/Install manualmente.
# Nao consulta/publica releases e nunca usa os executaveis ou perfis de producao.
$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest
$projectDir = Split-Path $PSScriptRoot -Parent
$qaDir = Join-Path $projectDir 'qa-candidate-0.2.0/install-qa'
$statePath = Join-Path $qaDir 'session.json'
$oldDir = Join-Path $projectDir 'qa-updater/github-signed'
$newDir = Join-Path $projectDir 'qa-candidate-0.2.0/github-signed'
$verifier = Join-Path $projectDir 'target/release/sancord-release.exe'
$target = Join-Path $qaDir 'installed/Sancord.exe'
$profile = Join-Path $qaDir 'profile'
$packageDir = Join-Path $profile 'updates/offline-signed'
$endpoint = 'http://127.0.0.1:3110'
$title = 'Sancord - QA update 0.1.0 para 0.2.0'

function Write-JsonFile($Path, $Value) {
    [IO.File]::WriteAllText($Path, ($Value | ConvertTo-Json -Depth 8), [Text.UTF8Encoding]::new($false))
}
function File-Hash($Path) { (Get-FileHash -LiteralPath $Path -Algorithm SHA256).Hash.ToLowerInvariant() }
function Assert-LocalDirectory($Path) {
    # Recusa links/juncoes tambem nos ancestrais dos caminhos fixos deste ensaio.
    $item = Get-Item -LiteralPath $Path -Force
    while ($null -ne $item) {
        if ($item.Attributes -band [IO.FileAttributes]::ReparsePoint) { throw 'Ensaio recusa links e juncoes.' }
        $item = $item.Parent
    }
}
function Assert-SignedPackage($Directory, $Version) {
    Assert-LocalDirectory $Directory
    & $verifier verify $Directory | Out-Host
    if ($LASTEXITCODE -ne 0) { throw "Pacote $Version recusado pela verificacao criptografica." }
    $manifest = Get-Content -LiteralPath (Join-Path $Directory 'sancord-update.json') -Raw | ConvertFrom-Json
    if ($manifest.version -ne $Version -or $manifest.repository -ne 'gabrielsanderx/Sancord') {
        throw 'Versao/repositorio inesperados no pacote.'
    }
    return $manifest
}
function Assert-QaBackend {
    # Windows PowerShell 5.1 emite o array JSON como um unico objeto no pipeline.
    # Atribuir diretamente evita criar um array aninhado com @(...).
    $records = Get-Content -LiteralPath (Join-Path $projectDir 'qa-voice-local-3110/processes.json') -Raw | ConvertFrom-Json
    $serverPath = [IO.Path]::GetFullPath((Join-Path $projectDir 'target-review-phase6/debug/sancord.exe'))
    $expected = @($records | Where-Object { [IO.Path]::GetFullPath($_.path) -eq $serverPath })
    $listener = @(Get-NetTCPConnection -State Listen -LocalAddress '127.0.0.1' -LocalPort 3110 -ErrorAction SilentlyContinue)
    if ($expected.Count -ne 1 -or $listener.Count -ne 1 -or $listener[0].OwningProcess -ne $expected[0].id) {
        throw 'Backend de QA 3110 indisponivel ou diferente do processo registrado. Nenhum servidor sera iniciado.'
    }
    if (-not (Invoke-RestMethod "$endpoint/api/health").ok) { throw 'Backend de QA nao esta saudavel.' }
}
function Start-IsolatedClient($Executable, [string[]]$Arguments = @()) {
    $info = [Diagnostics.ProcessStartInfo]::new()
    $info.FileName = $Executable
    $info.WorkingDirectory = Split-Path $Executable -Parent
    $info.UseShellExecute = $false
    $info.CreateNoWindow = $true
    # Caminhos do job sao fixos e nao contem aspas. Funciona no Windows PowerShell 5.1.
    $info.Arguments = ($Arguments | ForEach-Object {
        if ($_.Contains('"')) { throw 'Argumento inesperado.' }
        '"' + $_ + '"'
    }) -join ' '
    $variables = @{
        SANCORD_SERVER_URL = $endpoint
        SANCORD_DISABLE_LOCAL_HOST = '1'
        SANCORD_REGISTER_PROTOCOL = '0'
        SANCORD_DISABLE_UPDATES = '1'
        SANCORD_DESKTOP_DATA_DIR = $profile
        SANCORD_WINDOW_TITLE = $title
    }
    foreach ($key in $variables.Keys) { $info.EnvironmentVariables[$key] = $variables[$key] }
    $null = $info.EnvironmentVariables.Remove('SANCORD_LAUNCHER_EXE')
    $null = $info.EnvironmentVariables.Remove('SANCORD_HOST_EXE')
    $null = $info.EnvironmentVariables.Remove('SANCORD_HOST_DIR')
    return [Diagnostics.Process]::Start($info)
}

Assert-LocalDirectory $projectDir
if (-not (Test-Path -LiteralPath $verifier -PathType Leaf)) { throw 'Ferramenta local de verificacao ausente.' }
# Captura apenas o manifesto; mensagens da ferramenta vao ao console, nao ao retorno.
$oldManifest = Assert-SignedPackage $oldDir '0.1.0'
$newManifest = Assert-SignedPackage $newDir '0.2.0'

if ($Action -eq 'Prepare') {
    if (Test-Path -LiteralPath $qaDir) { throw 'Ensaio ja existe. Use Status; nao sera sobrescrito.' }
    New-Item -ItemType Directory -Path (Join-Path $qaDir 'installed') | Out-Null
    New-Item -ItemType Directory -Path $packageDir | Out-Null
    Copy-Item -LiteralPath (Join-Path $oldDir 'Sancord.exe') -Destination $target
    foreach ($file in @('Sancord.exe','sancord-update.json','sancord-update.sig')) {
        Copy-Item -LiteralPath (Join-Path $newDir $file) -Destination (Join-Path $packageDir $file)
    }
    $null = Assert-SignedPackage $packageDir '0.2.0'
    if ((File-Hash $target) -ne $oldManifest.sha256) { throw 'Copia inicial divergente.' }
    $production = @('Sancord.exe','SancordServer.exe','dist/Sancord.exe') | ForEach-Object {
        @{ path = (Join-Path $projectDir $_); sha256 = (File-Hash (Join-Path $projectDir $_)) }
    }
    Write-JsonFile $statePath @{
        schema = 1; phase = 'prepared'; target = $target; profile = $profile
        old_hash = $oldManifest.sha256; new_hash = $newManifest.sha256
        production = @($production); prepared_at = [DateTime]::UtcNow.ToString('o')
    }
    Write-Host 'Ensaio preparado. Nenhum processo iniciado; nenhum banco/perfil principal alterado.'
    return
}

Assert-LocalDirectory $qaDir
$state = Get-Content -LiteralPath $statePath -Raw | ConvertFrom-Json
if ($state.schema -ne 1 -or $state.target -ne $target -or $state.profile -ne $profile -or
    $state.old_hash -ne $oldManifest.sha256 -or $state.new_hash -ne $newManifest.sha256) {
    throw 'Registro de QA inconsistente.'
}
Assert-LocalDirectory (Split-Path $target -Parent)
Assert-LocalDirectory $packageDir
foreach ($file in $state.production) {
    if ((File-Hash $file.path) -ne $file.sha256) { throw "Arquivo anterior mudou desde a preparacao: $($file.path)" }
}

if ($Action -eq 'Start') {
    if ($state.phase -ne 'prepared') { throw 'Sessao ja iniciada. Use Status; nao sera aberta outra instancia.' }
    $existing = @(Get-Process -Name SancordDesktop -ErrorAction SilentlyContinue | Where-Object { $_.MainWindowTitle -eq $title })
    if ($existing.Count) { throw 'Ja existe uma janela deste ensaio. Nao sera aberta outra.' }
    Assert-QaBackend
    if ((File-Hash $target) -ne $oldManifest.sha256) { throw 'Cliente inicial divergente.' }
    $launcher = Start-IsolatedClient $target
    $core = $null
    for ($attempt = 0; $attempt -lt 40; $attempt++) {
        $children = @(Get-CimInstance Win32_Process -Filter "ParentProcessId = $($launcher.Id) AND Name = 'SancordDesktop.exe'")
        if ($children.Count -eq 1 -and $children[0].ExecutablePath) { $core = Get-Process -Id $children[0].ProcessId; break }
        Start-Sleep -Milliseconds 200
    }
    if ($null -eq $core) { throw 'Nao foi possivel registrar o cliente. Nao execute Install; confira a janela e relate o erro.' }
    $state | Add-Member -NotePropertyName core -NotePropertyValue @{
        id = $core.Id; path = $core.Path; started = $core.StartTime.ToUniversalTime().Ticks.ToString()
    }
    $state.phase = 'started'
    Write-JsonFile $statePath $state
    $credentials = Get-Content -LiteralPath (Join-Path $projectDir 'qa-voice-local-3110/credentials.json') -Raw | ConvertFrom-Json
    Write-Host 'Cliente 0.1.0 aberto SOMENTE no perfil de QA. Entre com VozQA_A.'
    Write-Host "Senha exclusiva de QA: $($credentials.password)"
    Write-Host 'Depois de confirmar o login, execute este script com -Action Install.'
    return
}

if ($Action -eq 'Install') {
    if ($state.phase -ne 'started') { throw 'Install exige a sessao inicial registrada e ainda aberta.' }
    Assert-QaBackend
    $core = Get-Process -Id $state.core.id -ErrorAction Stop
    if ($core.Path -ne $state.core.path -or $core.StartTime.ToUniversalTime().Ticks.ToString() -ne $state.core.started) {
        throw 'O cliente registrado nao e o mesmo processo. Instalacao recusada.'
    }
    if ((File-Hash $target) -ne $oldManifest.sha256) { throw 'Cliente inicial divergente.' }
    $null = Assert-SignedPackage $packageDir '0.2.0'
    $helper = Join-Path $packageDir 'SancordUpdateHelper.exe'
    Copy-Item -LiteralPath $target -Destination $helper
    if ((File-Hash $helper) -ne $oldManifest.sha256) { throw 'Helper divergente do cliente assinado.' }
    $jobPath = Join-Path $packageDir 'install.json'
    Write-JsonFile $jobPath @{
        parent_pid = [int]$state.core.id; target = $target
        package = (Join-Path $packageDir 'Sancord.exe')
        manifest = [IO.File]::ReadAllText((Join-Path $packageDir 'sancord-update.json'))
        signature = [IO.File]::ReadAllText((Join-Path $packageDir 'sancord-update.sig')).Trim()
        current_version = '0.1.0'; endpoint = $endpoint
    }
    $state | Add-Member -NotePropertyName install_started_at -NotePropertyValue ([DateTime]::UtcNow.ToString('o'))
    $state.phase = 'install_requested'
    Write-JsonFile $statePath $state
    $null = Start-IsolatedClient $helper @('--sancord-apply-update', $jobPath)
    Write-Host 'Feche agora SOMENTE a janela Sancord - QA update 0.1.0 para 0.2.0 (em ate 60 segundos).'
    Write-Host 'O helper real aguardara o encerramento, verificara a assinatura e reabrira a versao 0.2.0.'
    Write-Host 'Depois execute -Action Status. Nenhum processo sera encerrado a forca.'
    return
}

$hash = File-Hash $target
$backups = @(Get-ChildItem -LiteralPath (Split-Path $target -Parent) -Filter 'Sancord-before-0.1.0-*.exe')
$validBackups = @($backups | Where-Object { (File-Hash $_.FullName) -eq $oldManifest.sha256 })
$windows = @(Get-Process -Name SancordDesktop -ErrorAction SilentlyContinue | Where-Object { $_.MainWindowTitle -eq $title })
Write-Host "Sessao: $($state.phase)"
Write-Host "Cliente no destino: $(if ($hash -eq $newManifest.sha256) {'0.2.0 verificada'} elseif ($hash -eq $oldManifest.sha256) {'0.1.0 verificada'} else {'HASH INESPERADO'})"
Write-Host "Backups 0.1.0 integros: $($validBackups.Count); janelas deste QA: $($windows.Count)"
if ($state.phase -eq 'install_requested' -and $hash -eq $newManifest.sha256 -and $validBackups.Count -eq 1 -and $windows.Count -eq 1 -and
    $windows[0].StartTime.ToUniversalTime() -gt ([DateTime]::Parse($state.install_started_at).ToUniversalTime())) {
    Write-Host 'Troca, backup e nova janela detectados. Confirme visualmente versao 0.2.0 e login preservado.'
} else {
    Write-Host 'Ensaio de instalacao/reinicio ainda nao comprovado. Nenhuma acao executada no modo Status.'
}
Write-Host 'Hashes dos executaveis anteriores preservados. O teste publico de deteccao/download continua separado.'
