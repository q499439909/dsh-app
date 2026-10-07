param(
    [string]$DataJuicerRoot,
    [string]$WorkspaceRoot,
    [string]$CacheRoot,
    [switch]$EnableObservability,
    [switch]$SkipDshInstall,
    [switch]$SkipDshBuild,
    [switch]$SkipDataJuicerInstall,
    [switch]$CheckOnly
)

$ErrorActionPreference = 'Stop'
$sourceRoot = $PSScriptRoot
$integrationRoot = Join-Path $sourceRoot 'integrations\data-juicer'
$lockFile = Join-Path $integrationRoot 'data-juicer.lock.json'
$deploymentFile = Join-Path $integrationRoot 'dsh-deployment.local.json'
$lock = Get-Content -Raw -LiteralPath $lockFile | ConvertFrom-Json

if ([string]::IsNullOrWhiteSpace($DataJuicerRoot)) {
    $DataJuicerRoot = Join-Path $sourceRoot '.local\data-juicer'
}
if ([string]::IsNullOrWhiteSpace($WorkspaceRoot)) {
    $WorkspaceRoot = Join-Path $sourceRoot '.local\workspace'
}
if ([string]::IsNullOrWhiteSpace($CacheRoot)) {
    $CacheRoot = Join-Path $sourceRoot '.local\cache\huggingface'
}
$DataJuicerRoot = [System.IO.Path]::GetFullPath($DataJuicerRoot)
$WorkspaceRoot = [System.IO.Path]::GetFullPath($WorkspaceRoot)
$CacheRoot = [System.IO.Path]::GetFullPath($CacheRoot)
$pythonExe = Join-Path $DataJuicerRoot '.venv\Scripts\python.exe'

function Resolve-CommandPath {
    param([Parameter(Mandatory = $true)][string]$Name)
    $command = Get-Command $Name -ErrorAction SilentlyContinue | Select-Object -First 1
    if ($null -eq $command) { throw "Required command is not available on PATH: $Name" }
    return $command.Source
}

function Invoke-Checked {
    param(
        [Parameter(Mandatory = $true)][string]$FilePath,
        [Parameter(Mandatory = $true)][string[]]$CommandArgs,
        [Parameter(Mandatory = $true)][string]$Failure
    )
    Push-Location $sourceRoot
    try {
        & $FilePath @CommandArgs
        if ($LASTEXITCODE -ne 0) { throw $Failure }
    } finally {
        Pop-Location
    }
}

$git = Resolve-CommandPath 'git.exe'
Resolve-CommandPath 'node.exe' | Out-Null
$pnpm = Resolve-CommandPath 'pnpm.cmd'
$uv = Resolve-CommandPath 'uv.exe'

if ($CheckOnly) {
    if (-not (Test-Path -LiteralPath $deploymentFile -PathType Leaf)) {
        throw "Setup is incomplete; missing: $deploymentFile"
    }
    $installedDeployment = Get-Content -Raw -LiteralPath $deploymentFile | ConvertFrom-Json
    foreach ($required in @(
        [string]$installedDeployment.pythonExe,
        (Join-Path $sourceRoot 'apps\web\dist\index.html')
    )) {
        if (-not (Test-Path -LiteralPath $required -PathType Leaf)) {
            throw "Setup is incomplete; missing: $required"
        }
    }
    & (Join-Path $integrationRoot 'web-dj.ps1') -DeploymentFile $deploymentFile -CheckOnly
    exit $LASTEXITCODE
}

if (-not (Test-Path -LiteralPath (Join-Path $DataJuicerRoot '.git'))) {
    if (Test-Path -LiteralPath $DataJuicerRoot) {
        $existing = @(Get-ChildItem -LiteralPath $DataJuicerRoot -Force -ErrorAction SilentlyContinue)
        if ($existing.Count -gt 0) { throw "Data-Juicer target exists but is not a Git checkout: $DataJuicerRoot" }
    } else {
        New-Item -ItemType Directory -Force -Path (Split-Path -Parent $DataJuicerRoot) | Out-Null
    }
    Invoke-Checked -FilePath $git -CommandArgs @('clone', '--filter=blob:none', '--no-checkout', $lock.repository, $DataJuicerRoot) `
        -Failure 'Could not clone the pinned Data-Juicer repository.'
}

& $git -C $DataJuicerRoot cat-file -e "$($lock.commit)^{commit}" 2>$null
if ($LASTEXITCODE -ne 0) {
    Invoke-Checked -FilePath $git -CommandArgs @('-C', $DataJuicerRoot, 'fetch', '--depth', '1', 'origin', $lock.commit) `
        -Failure 'Could not fetch the pinned Data-Juicer commit.'
}
$currentCommitOutput = @(& $git -C $DataJuicerRoot rev-parse HEAD 2>$null)
$currentCommit = if ($LASTEXITCODE -eq 0) { ($currentCommitOutput -join '').Trim() } else { '' }
if ($currentCommit -ne $lock.commit) {
    $trackedChanges = @(& $git -C $DataJuicerRoot status --porcelain --untracked-files=no)
    if ($trackedChanges.Count -gt 0) {
        throw "Data-Juicer has tracked local changes and cannot switch to the pinned commit: $DataJuicerRoot"
    }
    Invoke-Checked -FilePath $git -CommandArgs @('-C', $DataJuicerRoot, 'checkout', '--detach', $lock.commit) `
        -Failure 'Could not check out the pinned Data-Juicer commit.'
}

if (-not $SkipDshInstall) {
    Invoke-Checked -FilePath $pnpm -CommandArgs @('install', '--frozen-lockfile') -Failure 'DSH dependency installation failed.'
}
if (-not $SkipDshBuild) {
    Invoke-Checked -FilePath $pnpm -CommandArgs @('run', 'build') -Failure 'DSH source build failed.'
}
if (-not $SkipDataJuicerInstall) {
    $syncArgs = @('sync', '--project', $DataJuicerRoot, '--python', [string]$lock.python, '--frozen')
    foreach ($extra in $lock.extras) { $syncArgs += @('--extra', [string]$extra) }
    Invoke-Checked -FilePath $uv -CommandArgs $syncArgs -Failure 'Data-Juicer Python environment installation failed.'
}
if (-not (Test-Path -LiteralPath $pythonExe -PathType Leaf)) {
    throw "Data-Juicer Python environment is missing: $pythonExe"
}

New-Item -ItemType Directory -Force -Path $WorkspaceRoot, $CacheRoot | Out-Null
$deployment = [ordered]@{
    schemaVersion = 1
    djRoot = $DataJuicerRoot.Replace('\', '/')
    pythonExe = $pythonExe.Replace('\', '/')
    workspaceRoot = $WorkspaceRoot.Replace('\', '/')
    hfHome = $CacheRoot.Replace('\', '/')
    webPort = 57535
    djPort = 8010
    executionMode = 'native'
    proxyUrl = $null
    observability = [bool]$EnableObservability
    publicOrigin = $null
}
$deployment | ConvertTo-Json | Set-Content -LiteralPath $deploymentFile -Encoding utf8

foreach ($name in @('dj-plan-flow.env', 'loongsuite-langfuse.env')) {
    $target = Join-Path $integrationRoot $name
    if (-not (Test-Path -LiteralPath $target)) {
        Copy-Item -LiteralPath "$target.example" -Destination $target
    }
}

$operatorBundle = Join-Path $integrationRoot 'bundles\operator-library'
$resultsBundle = Join-Path $integrationRoot 'bundles\results-center'
Invoke-Checked -FilePath $pnpm -CommandArgs @(
    'dsh', 'plugin', '--profile', 'web', 'add', $operatorBundle, $resultsBundle
) -Failure 'Could not install the source-owned DSH bundles into the web profile.'

& (Join-Path $integrationRoot 'web-dj.ps1') -DeploymentFile $deploymentFile -CheckOnly
if ($LASTEXITCODE -ne 0) { throw 'Deployment validation failed.' }
Write-Host ''
Write-Host 'Setup complete. Start the source deployment with:'
Write-Host "  & '$sourceRoot\start.ps1'"
