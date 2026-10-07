param(
    [string]$DeploymentFile,
    [string]$DjRoot,
    [string]$PythonExe,
    [string]$WorkspaceRoot,
    [string]$CacheRoot,
    [string]$ProxyUrl,
    [switch]$EnableObservability,
    [switch]$CheckOnly,
    [switch]$NoOpen,
    [ValidateRange(1, 65535)]
    [int]$Port = 57535,
    [ValidateRange(1, 65535)]
    [int]$McpPort = 8010,
    [ValidateSet('native', 'broker')]
    [string]$ExecutionMode = 'native',
    [Parameter(ValueFromRemainingArguments = $true)]
    [string[]]$DshArgs
)

$ErrorActionPreference = 'Stop'
$integrationRoot = $PSScriptRoot
$sourceRoot = [System.IO.Path]::GetFullPath((Join-Path $integrationRoot '..\..'))
if ([string]::IsNullOrWhiteSpace($DeploymentFile)) {
    $DeploymentFile = Join-Path $integrationRoot 'dsh-deployment.local.json'
}

$deploymentOverrides = @{}
foreach ($mapping in @(
    @('DjRoot', 'djRoot'),
    @('PythonExe', 'pythonExe'),
    @('WorkspaceRoot', 'workspaceRoot'),
    @('CacheRoot', 'hfHome'),
    @('ProxyUrl', 'proxyUrl'),
    @('Port', 'webPort'),
    @('McpPort', 'djPort'),
    @('ExecutionMode', 'executionMode')
)) {
    if ($PSBoundParameters.ContainsKey($mapping[0])) {
        $deploymentOverrides[$mapping[1]] = $PSBoundParameters[$mapping[0]]
    }
}
if ($PSBoundParameters.ContainsKey('EnableObservability')) {
    $deploymentOverrides['observability'] = [bool]$EnableObservability
}

$manifestScript = Join-Path $integrationRoot 'scripts\deployment-manifest.mjs'
$manifestArgs = @($manifestScript, $DeploymentFile)
if (-not $CheckOnly) { $manifestArgs += '--write' }
$previousDeploymentOverrides = $env:DSH_DEPLOYMENT_OVERRIDES
try {
    $env:DSH_DEPLOYMENT_OVERRIDES = ConvertTo-Json -InputObject $deploymentOverrides -Compress
    $manifestJson = & node @manifestArgs
    if ($LASTEXITCODE -ne 0) { throw 'Cannot resolve the DSH/Data-Juicer deployment manifest.' }
} finally {
    $env:DSH_DEPLOYMENT_OVERRIDES = $previousDeploymentOverrides
}
$deployment = $manifestJson | ConvertFrom-Json
if ($CheckOnly) {
    $manifestJson
    exit 0
}

$djRoot = $deployment.config.djRoot
$pythonExe = $deployment.config.pythonExe
$WorkspaceRoot = $deployment.config.workspaceRoot
$Port = $deployment.config.webPort
$McpPort = $deployment.config.djPort
$ExecutionMode = $deployment.config.executionMode
$proxyUrl = $deployment.config.proxyUrl
$hfHome = $deployment.config.hfHome

$dshSourceBin = Join-Path $sourceRoot 'apps\cli\src\bin.ts'
$pnpmCommand = Get-Command 'pnpm.cmd' -ErrorAction SilentlyContinue | Select-Object -First 1
if ($null -eq $pnpmCommand) { throw 'Required command is not available on PATH: pnpm.cmd' }
$pnpmExe = $pnpmCommand.Source
$webAsset = Join-Path $sourceRoot 'apps\web\dist\index.html'
$patchFile = Join-Path $integrationRoot '.runtime\deployment\dj.patch.yml'
$runtimeProbe = Join-Path $integrationRoot 'scripts\test-dj-runtime.ps1'
$mcpEnvFile = Join-Path $integrationRoot 'dj-plan-flow.env'
$langfuseEnvFile = Join-Path $integrationRoot 'loongsuite-langfuse.env'
$internalTokenPath = Join-Path $integrationRoot '.runtime\dj-internal-token'
$operatorBundleSource = Join-Path $integrationRoot 'bundles\operator-library'
$resultsBundleSource = Join-Path $integrationRoot 'bundles\results-center'
$dshProfileRoot = Join-Path ([Environment]::GetFolderPath('UserProfile')) '.dsh\profiles\web'
$operatorBundleLink = Join-Path $dshProfileRoot 'node_modules\@local\operator-library'
$resultsBundleLink = Join-Path $dshProfileRoot 'node_modules\@local\results-center'
$dshCredentialsFile = Join-Path ([Environment]::GetFolderPath('UserProfile')) '.dsh\.credentials.yaml'
$pythonDirectory = Split-Path -Parent $pythonExe
$hfScripts = if ((Split-Path -Leaf $pythonDirectory) -eq 'Scripts') { $pythonDirectory } else { Join-Path $pythonDirectory 'Scripts' }
$mcpTempDir = Join-Path $djRoot '.mcp-tmp'
$diagnosticRoot = Join-Path $WorkspaceRoot '.dsh\diagnostics\runtime'

function Read-DotEnv {
    param([string]$Path)
    $values = @{}
    if (-not (Test-Path -LiteralPath $Path -PathType Leaf)) { return $values }
    foreach ($line in Get-Content -LiteralPath $Path) {
        $trimmed = $line.Trim()
        if (-not $trimmed -or $trimmed.StartsWith('#')) { continue }
        $match = [regex]::Match($trimmed, '^(?<name>[A-Za-z_][A-Za-z0-9_]*)=(?<value>.*)$')
        if (-not $match.Success) {
            Write-Warning "Ignoring invalid line in $Path"
            continue
        }
        $value = $match.Groups['value'].Value.Trim()
        if ($value.Length -ge 2 -and (
            ($value.StartsWith('"') -and $value.EndsWith('"')) -or
            ($value.StartsWith("'") -and $value.EndsWith("'"))
        )) {
            $value = $value.Substring(1, $value.Length - 2)
        }
        $values[$match.Groups['name'].Value] = $value
    }
    return $values
}

function Read-DshCredential {
    param([string]$Path, [string]$Name)
    if ($Name -notin @('HS_API_KEY', 'BL_API_KEY')) {
        throw "Unsupported DSH credential reference: $Name"
    }
    if (-not (Test-Path -LiteralPath $Path -PathType Leaf)) {
        throw "Cannot find the DSH credential store: $Path"
    }
    $pattern = '^\s*' + [regex]::Escape($Name) + '\s*:\s*(?<value>.+?)\s*$'
    foreach ($line in Get-Content -LiteralPath $Path) {
        $match = [regex]::Match($line, $pattern)
        if (-not $match.Success) { continue }
        $value = $match.Groups['value'].Value.Trim().Trim('"').Trim("'")
        if (-not [string]::IsNullOrWhiteSpace($value)) { return $value }
    }
    throw "Credential $Name is missing or empty in $Path"
}

function Assert-JunctionTarget {
    param([string]$Link, [string]$Expected, [string]$Name)
    if (-not (Test-Path -LiteralPath $Link)) {
        throw "$Name is not installed in the DSH web profile: $Link"
    }
    $item = Get-Item -LiteralPath $Link -Force
    $expectedFull = [System.IO.Path]::GetFullPath($Expected)
    $targets = @($item.Target | ForEach-Object { [System.IO.Path]::GetFullPath([string]$_) })
    if ($item.LinkType -ne 'Junction' -or $targets -notcontains $expectedFull) {
        throw "$Name still points outside the source integration. Expected: $expectedFull"
    }
}

function Test-TcpPort {
    param([int]$TargetPort)
    $client = [System.Net.Sockets.TcpClient]::new()
    try {
        $client.Connect('127.0.0.1', $TargetPort)
        return $true
    } catch {
        return $false
    } finally {
        $client.Dispose()
    }
}

function Get-ListeningProcess {
    param([int]$TargetPort)
    $listener = Get-NetTCPConnection -LocalAddress '127.0.0.1' -LocalPort $TargetPort -State Listen -ErrorAction SilentlyContinue | Select-Object -First 1
    if ($null -eq $listener) { return $null }
    return Get-CimInstance Win32_Process -Filter "ProcessId=$($listener.OwningProcess)" -ErrorAction SilentlyContinue
}

function ConvertTo-ProcessArgument {
    param([AllowEmptyString()][string]$Argument)
    $escaped = [regex]::Replace($Argument, '(\\*)"', '$1$1\"')
    $escaped = [regex]::Replace($escaped, '(\\+)$', '$1$1')
    return '"' + $escaped + '"'
}

function Start-ProcessWithEnvironment {
    param(
        [Parameter(Mandatory = $true)][string]$FilePath,
        [Parameter(Mandatory = $true)][string[]]$ArgumentList,
        [Parameter(Mandatory = $true)][string]$WorkingDirectory,
        [Parameter(Mandatory = $true)][hashtable]$Environment,
        [Parameter(Mandatory = $true)][string]$Service
    )
    $previous = @{}
    try {
        foreach ($entry in $Environment.GetEnumerator()) {
            $name = [string]$entry.Key
            $previous[$name] = [Environment]::GetEnvironmentVariable($name, 'Process')
            [Environment]::SetEnvironmentVariable($name, [string]$entry.Value, 'Process')
        }
        New-Item -ItemType Directory -Path $diagnosticRoot -Force | Out-Null
        $launchKey = [guid]::NewGuid().ToString('N')
        $child = Start-Process `
            -FilePath $FilePath `
            -ArgumentList (($ArgumentList | ForEach-Object { ConvertTo-ProcessArgument $_ }) -join ' ') `
            -WorkingDirectory $WorkingDirectory `
            -WindowStyle Hidden `
            -RedirectStandardOutput (Join-Path $diagnosticRoot "$launchKey.stdout.log") `
            -RedirectStandardError (Join-Path $diagnosticRoot "$launchKey.stderr.log") `
            -PassThru
        @{
            at = [DateTime]::UtcNow.ToString('o')
            event = 'process_started'
            service = $Service
            pid = $child.Id
            executable = $FilePath
            launch_id = $launchKey
        } | ConvertTo-Json -Compress | Add-Content -LiteralPath (Join-Path $diagnosticRoot 'lifecycle.jsonl')
        return $child
    } finally {
        foreach ($entry in $previous.GetEnumerator()) {
            [Environment]::SetEnvironmentVariable([string]$entry.Key, $entry.Value, 'Process')
        }
    }
}

function Test-IsExpectedDshWebProcess {
    param([AllowNull()]$Process, [int]$TargetPort)
    if ($null -eq $Process -or [string]::IsNullOrWhiteSpace($Process.CommandLine)) { return $false }
    $commandLine = ([string]$Process.CommandLine).Replace('/', '\')
    while ($commandLine.Contains('\\')) { $commandLine = $commandLine.Replace('\\', '\') }
    $portPattern = '(?:^|\s)"?--port"?\s+"?{0}"?(?:\s|$)' -f $TargetPort
    return (
        $Process.Name -eq 'node.exe' -and
        $commandLine.IndexOf('apps\cli\src\bin.ts', [System.StringComparison]::OrdinalIgnoreCase) -ge 0 -and
        $commandLine.IndexOf($patchFile, [System.StringComparison]::OrdinalIgnoreCase) -ge 0 -and
        $commandLine -match $portPattern
    )
}

foreach ($requiredPath in @($dshSourceBin, $webAsset, $pythonExe, $runtimeProbe, $operatorBundleSource, $resultsBundleSource)) {
    if (-not (Test-Path -LiteralPath $requiredPath)) { throw "Required source deployment path is missing: $requiredPath" }
}
Assert-JunctionTarget -Link $operatorBundleLink -Expected $operatorBundleSource -Name '@local/operator-library'
Assert-JunctionTarget -Link $resultsBundleLink -Expected $resultsBundleSource -Name '@local/results-center'

$runtimeProbeOutput = @(& $runtimeProbe -PythonExe $pythonExe -DjRoot $djRoot -Profile planning 2>&1)
if ($LASTEXITCODE -ne 0) {
    throw "The Data-Juicer Python environment is unhealthy.`n$($runtimeProbeOutput -join [Environment]::NewLine)"
}
$runtimeProbeOutput | ForEach-Object { Write-Host $_ }

New-Item -ItemType Directory -Force -Path $mcpTempDir | Out-Null
New-Item -ItemType Directory -Force -Path (Split-Path -Parent $internalTokenPath) | Out-Null
if (-not (Test-Path -LiteralPath $internalTokenPath -PathType Leaf)) {
    $tokenBytes = New-Object byte[] 32
    $generator = [System.Security.Cryptography.RandomNumberGenerator]::Create()
    try { $generator.GetBytes($tokenBytes) } finally { $generator.Dispose() }
    [System.IO.File]::WriteAllText($internalTokenPath, [Convert]::ToBase64String($tokenBytes))
}
$internalToken = [System.IO.File]::ReadAllText($internalTokenPath).Trim()
if ($internalToken.Length -lt 32) { throw "Invalid DSH/Data-Juicer internal token: $internalTokenPath" }

$mcpEnvironment = Read-DotEnv -Path $mcpEnvFile
$apiKeyCredential = $mcpEnvironment['DJ_PLAN_FLOW_OPENAI_API_KEY_CREDENTIAL']
if (-not [string]::IsNullOrWhiteSpace($apiKeyCredential)) {
    $mcpEnvironment['OPENAI_API_KEY'] = Read-DshCredential -Path $dshCredentialsFile -Name $apiKeyCredential
}

$langfuseEnvironment = @{}
if ($deployment.config.observability) {
    $langfuseEnvironment = Read-DotEnv -Path $langfuseEnvFile
    foreach ($name in @('LANGFUSE_OTLP_ENDPOINT', 'LANGFUSE_PUBLIC_KEY', 'LANGFUSE_SECRET_KEY')) {
        if (-not $langfuseEnvironment.ContainsKey($name) -or [string]::IsNullOrWhiteSpace($langfuseEnvironment[$name])) {
            throw "Missing $name in $langfuseEnvFile"
        }
    }
    $langfuseEndpoint = $langfuseEnvironment['LANGFUSE_OTLP_ENDPOINT'].Trim().TrimEnd('/')
    $langfuseEndpointUri = $null
    if (-not [Uri]::TryCreate($langfuseEndpoint, [UriKind]::Absolute, [ref]$langfuseEndpointUri) -or
        $langfuseEndpointUri.Scheme -ne 'https' -or
        $langfuseEndpointUri.Host -notin @('cloud.langfuse.com', 'us.cloud.langfuse.com', 'jp.cloud.langfuse.com', 'hipaa.cloud.langfuse.com')) {
        throw 'LANGFUSE_OTLP_ENDPOINT must be an HTTPS Langfuse Cloud OTLP endpoint.'
    }
    $langfuseCredential = "$($langfuseEnvironment['LANGFUSE_PUBLIC_KEY']):$($langfuseEnvironment['LANGFUSE_SECRET_KEY'])"
    $langfuseAuthorization = [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes($langfuseCredential))
    $langfuseOtlpHeaders = "Authorization=Basic%20$langfuseAuthorization,x-langfuse-ingestion-version=4"
}

[Environment]::SetEnvironmentVariable('DSH_DJ_BASE_URL', "http://127.0.0.1:$McpPort", 'Process')
[Environment]::SetEnvironmentVariable('DSH_DEPLOYMENT_ID', $deployment.deploymentId, 'Process')
[Environment]::SetEnvironmentVariable('DSH_DJ_EXPECTED_BUILD', ($deployment.dj.build | ConvertTo-Json -Compress), 'Process')
[Environment]::SetEnvironmentVariable('DSH_DJ_INTERNAL_TOKEN', $internalToken, 'Process')

foreach ($cacheName in @(
    'CACHE_HOME', 'XDG_CACHE_HOME', 'DATA_JUICER_CACHE_HOME', 'DATA_JUICER_ASSETS_CACHE',
    'DATA_JUICER_MODELS_CACHE', 'DATA_JUICER_EXTERNAL_MODELS_HOME', 'HF_HOME', 'HF_HUB_CACHE',
    'HUGGINGFACE_HUB_CACHE', 'TRANSFORMERS_CACHE', 'TORCH_HOME', 'MODELSCOPE_CACHE',
    'DSH_USER_DATA_ROOT', 'DSH_PRELOADED_MODEL_ROOT', 'DSH_MODEL_ARTIFACT_CACHE', 'DSH_MODEL_NETWORK_POLICY'
)) {
    $cacheValue = [Environment]::GetEnvironmentVariable($cacheName, 'Process')
    if ([string]::IsNullOrWhiteSpace($cacheValue) -and $mcpEnvironment.ContainsKey($cacheName)) {
        $cacheValue = $mcpEnvironment[$cacheName]
    }
    if ($cacheName -eq 'HF_HOME') { $cacheValue = $hfHome }
    if ([string]::IsNullOrWhiteSpace($cacheValue) -and $cacheName -eq 'DSH_USER_DATA_ROOT') {
        $cacheValue = Join-Path $WorkspaceRoot '.dsh\users'
    }
    if (-not [string]::IsNullOrWhiteSpace($cacheValue)) {
        [Environment]::SetEnvironmentVariable($cacheName, $cacheValue, 'Process')
    }
}

function Assert-DjService {
    $health = Invoke-RestMethod -Uri "http://127.0.0.1:$McpPort/internal/health" -Headers @{ 'x-dsh-internal-token' = $internalToken } -TimeoutSec 10
    if (-not $health.ok -or $health.protocol.name -ne 'dsh-dj-internal-http' -or $health.protocol.version -ne 1 -or $health.execution_mode -ne $ExecutionMode) {
        throw 'The listening Data-Juicer service is unhealthy or incompatible with this deployment.'
    }
    foreach ($property in $deployment.dj.build.PSObject.Properties) {
        if ($health.build.($property.Name) -ne $property.Value) {
            throw "Running Data-Juicer build differs at $($property.Name); restart it before launching DSH."
        }
    }
    Write-Host 'Data-Juicer health and deployment handshake passed.'
}

$mcpProcess = $null
$mcpArgs = @('-m', 'data_juicer.tools.mcp_server', 'plan-flow', '--transport', 'streamable-http', '--port', [string]$McpPort)
$mcpProcessEnvironment = @{
    TEMP = $mcpTempDir
    TMP = $mcpTempDir
    TMPDIR = $mcpTempDir
    PYTHONPATH = $djRoot
    PYTHONUTF8 = '1'
    PYTHONIOENCODING = 'utf-8'
    DJ_PLAN_FLOW_CONFIG_FILE = $mcpEnvFile
    DJ_PLAN_FLOW_EXECUTION_MODE = $ExecutionMode
    DJ_PLAN_FLOW_SINGLE_USER = 'local'
    DSH_DJ_INTERNAL_TOKEN = $internalToken
}
foreach ($name in @('OPENAI_API_KEY', 'DASHSCOPE_API_KEY', 'SK', 'OPENAI_BASE_URL', 'OPENAI_API_URL', 'DASHSCOPE_BASE_URL', 'DJ_VLM_MODEL', 'DASHSCOPE_DEFAULT_MODEL', 'OPENAI_DEFAULT_MODEL')) {
    if ($mcpEnvironment.ContainsKey($name) -and -not [string]::IsNullOrWhiteSpace($mcpEnvironment[$name])) {
        $mcpProcessEnvironment[$name] = $mcpEnvironment[$name]
    }
}

if (-not (Test-TcpPort -TargetPort $McpPort)) {
    Write-Host "Starting Data-Juicer MCP at http://127.0.0.1:$McpPort/mcp"
    $mcpProcess = Start-ProcessWithEnvironment -FilePath $pythonExe -ArgumentList $mcpArgs -WorkingDirectory $djRoot -Environment $mcpProcessEnvironment -Service 'dj'
    for ($attempt = 0; $attempt -lt 60 -and -not (Test-TcpPort -TargetPort $McpPort); $attempt++) {
        Start-Sleep -Milliseconds 250
    }
    if (-not (Test-TcpPort -TargetPort $McpPort)) {
        if (-not $mcpProcess.HasExited) { Stop-Process -Id $mcpProcess.Id -Force -ErrorAction SilentlyContinue }
        throw "Data-Juicer MCP did not become ready on port $McpPort"
    }
} else {
    Write-Host "Reusing Data-Juicer MCP already listening on port $McpPort"
}
Assert-DjService

$url = "http://127.0.0.1:$Port/"
$listeningProcess = Get-ListeningProcess -TargetPort $Port
if ($null -ne $listeningProcess) {
    if (-not (Test-IsExpectedDshWebProcess -Process $listeningProcess -TargetPort $Port)) {
        throw "Port $Port is owned by PID $($listeningProcess.ProcessId), not the expected source DSH Web process."
    }
    Write-Host "Using existing source DSH Web at $url (PID $($listeningProcess.ProcessId))"
    exit 0
}

$dshArgumentList = @('dsh', 'web', '--patch', $patchFile, '--host', '127.0.0.1', '--port', [string]$Port)
if ($NoOpen) { $dshArgumentList += '--no-open' }
if ($null -ne $DshArgs) {
    $dshArgumentList += @($DshArgs | Where-Object { -not [string]::IsNullOrWhiteSpace($_) })
}

$dshProcessEnvironment = @{
    NO_PROXY = '127.0.0.1,localhost,::1'
    PATH = "$hfScripts;$env:PATH"
}
if (-not [string]::IsNullOrWhiteSpace([string]$proxyUrl)) {
    $dshProcessEnvironment['HTTP_PROXY'] = $proxyUrl
    $dshProcessEnvironment['HTTPS_PROXY'] = $proxyUrl
    $dshProcessEnvironment['ALL_PROXY'] = $proxyUrl
    $dshProcessEnvironment['NODE_USE_ENV_PROXY'] = '1'
}
if ($deployment.config.observability) {
    $dshProcessEnvironment['OTEL_EXPORTER_OTLP_ENDPOINT'] = $langfuseEndpoint
    $dshProcessEnvironment['OTEL_EXPORTER_OTLP_HEADERS'] = $langfuseOtlpHeaders
}

Write-Host "Starting DSH Web from source at $url"
$process = Start-ProcessWithEnvironment -FilePath $pnpmExe -ArgumentList $dshArgumentList -WorkingDirectory $sourceRoot -Environment $dshProcessEnvironment -Service 'dsh-source'
try {
    for ($attempt = 0; $attempt -lt 80 -and -not $process.HasExited; $attempt++) {
        Start-Sleep -Milliseconds 250
        if (Test-TcpPort -TargetPort $Port) { break }
    }
    if (-not (Test-TcpPort -TargetPort $Port)) {
        if ($process.HasExited) { exit $process.ExitCode }
        throw "Source DSH Web did not become ready at $url within 20 seconds."
    }
    Write-Host "Source DSH Web is ready at $url (PID $($process.Id))"

    $mcpRestarts = 0
    while (-not $process.HasExited) {
        Start-Sleep -Milliseconds 1000
        $process.Refresh()
        if ($null -ne $mcpProcess) {
            $mcpProcess.Refresh()
            if ($mcpProcess.HasExited -and -not (Test-TcpPort -TargetPort $McpPort) -and $mcpRestarts -lt 3) {
                $mcpRestarts++
                Write-Warning "Data-Juicer MCP exited; restart attempt $mcpRestarts of 3"
                $mcpProcess = Start-ProcessWithEnvironment -FilePath $pythonExe -ArgumentList $mcpArgs -WorkingDirectory $djRoot -Environment $mcpProcessEnvironment -Service 'dj-recovery'
            }
        }
    }
    $process.Refresh()
    exit $process.ExitCode
} finally {
    $runningProcess = Get-Process -Id $process.Id -ErrorAction SilentlyContinue
    if ($null -ne $runningProcess) {
        Write-Host "Stopping source DSH Web process PID $($process.Id)"
        Stop-Process -Id $process.Id -Force -ErrorAction SilentlyContinue
    }
}
