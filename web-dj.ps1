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
    [int]$Port = 57035,
    [ValidateRange(1, 65535)]
    [int]$McpPort = 8010,
    [ValidateSet('native', 'broker')]
    [string]$ExecutionMode = 'native',
    [Parameter(ValueFromRemainingArguments = $true)]
    [string[]]$DshArgs
)

$ErrorActionPreference = 'Stop'
$dshRoot = $PSScriptRoot
if ([string]::IsNullOrWhiteSpace($DeploymentFile)) { $DeploymentFile = Join-Path $dshRoot 'dsh-deployment.json' }
$deploymentOverrides = @{}
foreach ($mapping in @(@('DjRoot','djRoot'), @('PythonExe','pythonExe'), @('WorkspaceRoot','workspaceRoot'), @('CacheRoot','hfHome'), @('ProxyUrl','proxyUrl'), @('Port','webPort'), @('McpPort','djPort'), @('ExecutionMode','executionMode'))) {
    if ($PSBoundParameters.ContainsKey($mapping[0])) { $deploymentOverrides[$mapping[1]] = $PSBoundParameters[$mapping[0]] }
}
if ($PSBoundParameters.ContainsKey('EnableObservability')) { $deploymentOverrides['observability'] = [bool]$EnableObservability }
$manifestScript = Join-Path $dshRoot 'scripts/deployment-manifest.mjs'
$manifestArgs = @($manifestScript, $DeploymentFile)
if (-not $CheckOnly) { $manifestArgs += '--write' }
$previousDeploymentOverrides = $env:DSH_DEPLOYMENT_OVERRIDES
try {
    $env:DSH_DEPLOYMENT_OVERRIDES = ConvertTo-Json -InputObject $deploymentOverrides -Compress
    $manifestJson = & node @manifestArgs
    if ($LASTEXITCODE -ne 0) { throw 'Cannot resolve the DSH/DJ deployment manifest.' }
} finally { $env:DSH_DEPLOYMENT_OVERRIDES = $previousDeploymentOverrides }
$deployment = $manifestJson | ConvertFrom-Json
if ($CheckOnly) { $manifestJson; exit 0 }
$djRoot = $deployment.config.djRoot
$pythonExe = $deployment.config.pythonExe
$WorkspaceRoot = $deployment.config.workspaceRoot
$Port = $deployment.config.webPort
$McpPort = $deployment.config.djPort
$ExecutionMode = $deployment.config.executionMode
$proxyUrl = $deployment.config.proxyUrl
$dshBin = Join-Path $dshRoot 'node_modules/@deepseek-ai/dsh/lib/bin.js'
$patchFile = Join-Path $dshRoot '.dsh/deployment/dj.patch.yml'
$runtimeProbe = Join-Path $dshRoot 'scripts/test-dj-runtime.ps1'
$pythonDirectory = Split-Path -Parent $pythonExe
$hfScripts = if ((Split-Path -Leaf $pythonDirectory) -eq 'Scripts') { $pythonDirectory } else { Join-Path $pythonDirectory 'Scripts' }
$hfHome = $deployment.config.hfHome
$mcpTempDir = Join-Path $djRoot '.mcp-tmp'
[Environment]::SetEnvironmentVariable('DSH_DJ_BASE_URL', "http://127.0.0.1:$McpPort", 'Process')
[Environment]::SetEnvironmentVariable('DSH_DEPLOYMENT_ID', $deployment.deploymentId, 'Process')
[Environment]::SetEnvironmentVariable('DSH_DJ_EXPECTED_BUILD', ($deployment.dj.build | ConvertTo-Json -Compress), 'Process')
$mcpEnvFile = Join-Path $dshRoot 'dj-plan-flow.env'
$authEnvFile = Join-Path $dshRoot 'dsh-auth.env'
$langfuseEnvFile = Join-Path $dshRoot 'loongsuite-langfuse.env'
$operatorPluginSource = Join-Path $dshRoot 'packages\dsh-dj-operator-library'
$planPluginSource = Join-Path $dshRoot 'packages\dsh-dj-plan-explorer'
$authPluginSource = Join-Path $dshRoot 'packages\dsh-user-auth'
$datasetPluginSource = Join-Path $dshRoot 'packages\dsh-dj-datasets'
$webFetchPluginSource = Join-Path $dshRoot 'node_modules\@deepseek-ai\dsh-web-fetch-http'
$internalTokenPath = Join-Path $dshRoot '.dsh\dj-internal-token'
$dshProfileRoot = Join-Path ([Environment]::GetFolderPath('UserProfile')) '.dsh\profiles\web'
$dshCredentialsFile = Join-Path ([Environment]::GetFolderPath('UserProfile')) '.dsh\.credentials.yaml'
$noProxy = '127.0.0.1,localhost,::1'
$operatorPluginLink = Join-Path $dshProfileRoot 'node_modules\@dsh-dj\operator-library'
$planPluginLink = Join-Path $dshProfileRoot 'node_modules\@dsh-dj\plan-explorer'
$authPluginLink = Join-Path $dshProfileRoot 'node_modules\@dsh-dj\user-auth'
$datasetPluginLink = Join-Path $dshProfileRoot 'node_modules\@dsh-dj\datasets'
$webFetchPluginLink = Join-Path $dshProfileRoot 'node_modules\@deepseek-ai\dsh-web-fetch-http'

function Read-DotEnv {
    param([string]$Path)

    $values = @{}
    if (-not (Test-Path -LiteralPath $Path -PathType Leaf)) {
        return $values
    }

    foreach ($line in Get-Content -LiteralPath $Path) {
        $trimmed = $line.Trim()
        if (-not $trimmed -or $trimmed.StartsWith('#')) {
            continue
        }

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
    param(
        [string]$Path,
        [string]$Name
    )

    if ($Name -notin @('HS_API_KEY', 'BL_API_KEY')) {
        throw "Unsupported DSH credential reference: $Name"
    }
    if (-not (Test-Path -LiteralPath $Path -PathType Leaf)) {
        throw "Cannot find the DSH credential store: $Path"
    }

    $pattern = '^\s*' + [regex]::Escape($Name) + '\s*:\s*(?<value>.+?)\s*$'
    foreach ($line in Get-Content -LiteralPath $Path) {
        $match = [regex]::Match($line, $pattern)
        if (-not $match.Success) {
            continue
        }
        $value = $match.Groups['value'].Value.Trim()
        if ($value.Length -ge 2 -and (
            ($value.StartsWith('"') -and $value.EndsWith('"')) -or
            ($value.StartsWith("'") -and $value.EndsWith("'"))
        )) {
            $value = $value.Substring(1, $value.Length - 2)
        }
        if (-not [string]::IsNullOrWhiteSpace($value)) {
            return $value
        }
    }
    throw "Credential $Name is missing or empty in $Path"
}

if (-not (Test-Path -LiteralPath $dshBin)) {
    throw "Cannot find dsh: $dshBin"
}
if (-not (Test-Path -LiteralPath $pythonExe)) {
    throw "Cannot find the Data-Juicer Python environment: $pythonExe"
}
if (-not (Test-Path -LiteralPath $runtimeProbe -PathType Leaf)) {
    throw "Cannot find the Data-Juicer runtime probe: $runtimeProbe"
}
$runtimeProbeOutput = @(& $runtimeProbe -PythonExe $pythonExe -DjRoot $djRoot -Profile planning 2>&1)
if ($LASTEXITCODE -ne 0) {
    throw "The Data-Juicer Python environment is unhealthy.`n$($runtimeProbeOutput -join [Environment]::NewLine)"
}
$runtimeProbeOutput | ForEach-Object { Write-Host $_ }
if (-not (Test-Path -LiteralPath $operatorPluginSource -PathType Container)) {
    throw "Cannot find the DSH operator library plugin: $operatorPluginSource"
}
if (-not (Test-Path -LiteralPath $planPluginSource -PathType Container)) {
    throw "Cannot find the DSH plan explorer plugin: $planPluginSource"
}
if (-not (Test-Path -LiteralPath $authPluginSource -PathType Container)) {
    throw "Cannot find the DSH user auth plugin: $authPluginSource"
}
if (-not (Test-Path -LiteralPath $datasetPluginSource -PathType Container)) {
    throw "Cannot find the DSH result center plugin: $datasetPluginSource"
}
if (-not (Test-Path -LiteralPath $webFetchPluginSource -PathType Container)) {
    throw "Cannot find the DSH HTTP web-fetch provider: $webFetchPluginSource. Run pnpm install in $dshRoot."
}
$operatorPluginParent = Split-Path -Parent $operatorPluginLink
New-Item -ItemType Directory -Force -Path $operatorPluginParent | Out-Null
if (Test-Path -LiteralPath $operatorPluginLink) {
    $existingPluginLink = Get-Item -LiteralPath $operatorPluginLink -Force
    $resolvedPluginTarget = @($existingPluginLink.Target | ForEach-Object { [System.IO.Path]::GetFullPath([string]$_) })
    if ($existingPluginLink.LinkType -ne 'Junction' -or $resolvedPluginTarget -notcontains [System.IO.Path]::GetFullPath($operatorPluginSource)) {
        throw "The DSH profile already contains a different @dsh-dj/operator-library entry: $operatorPluginLink"
    }
} else {
    New-Item -ItemType Junction -Path $operatorPluginLink -Target $operatorPluginSource | Out-Null
}
if (Test-Path -LiteralPath $planPluginLink) {
    $existingPlanLink = Get-Item -LiteralPath $planPluginLink -Force
    $resolvedPlanTarget = @($existingPlanLink.Target | ForEach-Object { [System.IO.Path]::GetFullPath([string]$_) })
    if ($existingPlanLink.LinkType -ne 'Junction' -or $resolvedPlanTarget -notcontains [System.IO.Path]::GetFullPath($planPluginSource)) {
        throw "The DSH profile already contains a different @dsh-dj/plan-explorer entry: $planPluginLink"
    }
} else {
    New-Item -ItemType Junction -Path $planPluginLink -Target $planPluginSource | Out-Null
}
if (Test-Path -LiteralPath $authPluginLink) {
    $existingAuthLink = Get-Item -LiteralPath $authPluginLink -Force
    $resolvedAuthTarget = @($existingAuthLink.Target | ForEach-Object { [System.IO.Path]::GetFullPath([string]$_) })
    if ($existingAuthLink.LinkType -ne 'Junction' -or $resolvedAuthTarget -notcontains [System.IO.Path]::GetFullPath($authPluginSource)) {
        throw "The DSH profile already contains a different @dsh-dj/user-auth entry: $authPluginLink"
    }
} else {
    New-Item -ItemType Junction -Path $authPluginLink -Target $authPluginSource | Out-Null
}
if (Test-Path -LiteralPath $datasetPluginLink) {
    $existingDatasetLink = Get-Item -LiteralPath $datasetPluginLink -Force
    $resolvedDatasetTarget = @($existingDatasetLink.Target | ForEach-Object { [System.IO.Path]::GetFullPath([string]$_) })
    if ($existingDatasetLink.LinkType -ne 'Junction' -or $resolvedDatasetTarget -notcontains [System.IO.Path]::GetFullPath($datasetPluginSource)) {
        throw "The DSH profile already contains a different @dsh-dj/datasets entry: $datasetPluginLink"
    }
} else {
    New-Item -ItemType Junction -Path $datasetPluginLink -Target $datasetPluginSource | Out-Null
}
if (Test-Path -LiteralPath $webFetchPluginLink) {
    $existingWebFetchLink = Get-Item -LiteralPath $webFetchPluginLink -Force
    $resolvedWebFetchTarget = @($existingWebFetchLink.Target | ForEach-Object { [System.IO.Path]::GetFullPath([string]$_) })
    if ($existingWebFetchLink.LinkType -ne 'Junction' -or $resolvedWebFetchTarget -notcontains [System.IO.Path]::GetFullPath($webFetchPluginSource)) {
        throw "The DSH profile already contains a different @deepseek-ai/dsh-web-fetch-http entry: $webFetchPluginLink"
    }
} else {
    New-Item -ItemType Junction -Path $webFetchPluginLink -Target $webFetchPluginSource | Out-Null
}
New-Item -ItemType Directory -Force -Path $mcpTempDir | Out-Null
New-Item -ItemType Directory -Force -Path (Split-Path -Parent $internalTokenPath) | Out-Null
if (-not (Test-Path -LiteralPath $internalTokenPath -PathType Leaf)) {
    $tokenBytes = New-Object byte[] 32
    $tokenGenerator = [System.Security.Cryptography.RandomNumberGenerator]::Create()
    try {
        $tokenGenerator.GetBytes($tokenBytes)
    } finally {
        $tokenGenerator.Dispose()
    }
    [System.IO.File]::WriteAllText($internalTokenPath, [Convert]::ToBase64String($tokenBytes))
}
$internalToken = [System.IO.File]::ReadAllText($internalTokenPath).Trim()
if ($internalToken.Length -lt 32) {
    throw "The DSH/Data-Juicer internal token is invalid: $internalTokenPath"
}
[Environment]::SetEnvironmentVariable('DSH_DJ_INTERNAL_TOKEN', $internalToken, 'Process')
$authEnvironment = Read-DotEnv -Path $authEnvFile
if (-not $authEnvironment.ContainsKey('DSH_REGISTRATION_INVITE_HASH')) {
    throw "Missing DSH_REGISTRATION_INVITE_HASH in $authEnvFile. Generate it with the user-auth helper before starting DSH Web."
}
foreach ($name in @('DSH_REGISTRATION_INVITE_HASH', 'DSH_AUTH_DATABASE_PATH', 'DSH_AUTH_SECURE_COOKIE')) {
    if ($authEnvironment.ContainsKey($name) -and -not [string]::IsNullOrWhiteSpace($authEnvironment[$name])) {
        [Environment]::SetEnvironmentVariable($name, $authEnvironment[$name], 'Process')
    }
}
$mcpEnvironment = Read-DotEnv -Path $mcpEnvFile
$apiKeyCredential = $mcpEnvironment['DJ_PLAN_FLOW_OPENAI_API_KEY_CREDENTIAL']
if (-not [string]::IsNullOrWhiteSpace($apiKeyCredential)) {
    $mcpEnvironment['OPENAI_API_KEY'] = Read-DshCredential -Path $dshCredentialsFile -Name $apiKeyCredential
}
$langfuseEnvironment = @{}
if ($deployment.config.observability) { $langfuseEnvironment = Read-DotEnv -Path $langfuseEnvFile }
$langfuseEndpoint = $null
$langfuseOtlpHeaders = $null
if ($deployment.config.observability) {
$requiredLangfuseNames = @('LANGFUSE_OTLP_ENDPOINT', 'LANGFUSE_PUBLIC_KEY', 'LANGFUSE_SECRET_KEY')
foreach ($name in $requiredLangfuseNames) {
    if (-not $langfuseEnvironment.ContainsKey($name) -or [string]::IsNullOrWhiteSpace($langfuseEnvironment[$name])) {
        throw "Missing $name in $langfuseEnvFile."
    }
}
$langfuseEndpoint = $langfuseEnvironment['LANGFUSE_OTLP_ENDPOINT'].Trim().TrimEnd('/')
$langfuseEndpointUri = $null
if (-not [Uri]::TryCreate($langfuseEndpoint, [UriKind]::Absolute, [ref]$langfuseEndpointUri) -or
    $langfuseEndpointUri.Scheme -ne 'https' -or
    $langfuseEndpointUri.Host -notin @('cloud.langfuse.com', 'us.cloud.langfuse.com', 'jp.cloud.langfuse.com', 'hipaa.cloud.langfuse.com')) {
    throw "LANGFUSE_OTLP_ENDPOINT must be an HTTPS Langfuse Cloud OTLP endpoint."
}
$langfuseCredential = "$($langfuseEnvironment['LANGFUSE_PUBLIC_KEY']):$($langfuseEnvironment['LANGFUSE_SECRET_KEY'])"
$langfuseAuthorization = [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes($langfuseCredential))
$langfuseOtlpHeaders = "Authorization=Basic%20$langfuseAuthorization,x-langfuse-ingestion-version=4"
}
# One cache configuration inherited by DSH, MCP, validation and native workers.
# HF_HOME follows the resolved deployment; other cache variables retain process/env overrides.
$cacheEnvironmentNames = @('CACHE_HOME', 'XDG_CACHE_HOME', 'DATA_JUICER_CACHE_HOME', 'DATA_JUICER_ASSETS_CACHE',
    'DATA_JUICER_MODELS_CACHE', 'DATA_JUICER_EXTERNAL_MODELS_HOME', 'HF_HOME', 'HF_HUB_CACHE',
    'HUGGINGFACE_HUB_CACHE', 'TRANSFORMERS_CACHE', 'TORCH_HOME', 'MODELSCOPE_CACHE', 'DSH_USER_DATA_ROOT',
    'DSH_PRELOADED_MODEL_ROOT', 'DSH_MODEL_ARTIFACT_CACHE', 'DSH_MODEL_NETWORK_POLICY')
foreach ($cacheName in $cacheEnvironmentNames) {
    $cacheValue = [Environment]::GetEnvironmentVariable($cacheName, 'Process')
    if ([string]::IsNullOrWhiteSpace($cacheValue) -and $mcpEnvironment.ContainsKey($cacheName)) {
        $cacheValue = $mcpEnvironment[$cacheName]
    }
    if ($cacheName -eq 'HF_HOME') { $cacheValue = $hfHome }
    if ([string]::IsNullOrWhiteSpace($cacheValue) -and $cacheName -eq 'DSH_USER_DATA_ROOT') { $cacheValue = Join-Path $dshRoot '.dsh\users' }
    if (-not [string]::IsNullOrWhiteSpace($cacheValue)) { [Environment]::SetEnvironmentVariable($cacheName, $cacheValue, 'Process') }
}
if ($mcpEnvironment.Count -eq 0) {
    Write-Warning "No plan-flow environment file found at $mcpEnvFile. API VLM plans will fail validation until it is configured."
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

    $listener = Get-NetTCPConnection `
        -LocalAddress '127.0.0.1' `
        -LocalPort $TargetPort `
        -State Listen `
        -ErrorAction SilentlyContinue |
        Select-Object -First 1
    if ($null -eq $listener) {
        return $null
    }

    return Get-CimInstance Win32_Process `
        -Filter "ProcessId=$($listener.OwningProcess)" `
        -ErrorAction SilentlyContinue
}

function Test-IsExpectedDshWebProcess {
    param(
        [AllowNull()]
        $Process,
        [int]$TargetPort
    )

    if ($null -eq $Process -or [string]::IsNullOrWhiteSpace($Process.CommandLine)) {
        return $false
    }

    $commandLine = [string]$Process.CommandLine
    return (
        $Process.Name -eq 'node.exe' -and
        $commandLine.IndexOf($dshBin, [System.StringComparison]::OrdinalIgnoreCase) -ge 0 -and
        $commandLine.IndexOf($patchFile, [System.StringComparison]::OrdinalIgnoreCase) -ge 0 -and
        $commandLine -match '(?:^|\s)web(?:\s|$)' -and
        $commandLine -match "--port\s+$TargetPort(?:\s|$)"
    )
}

function Get-OtherDshWebProcesses {
    param([int]$ExceptPort)

    return @(
        Get-CimInstance Win32_Process -Filter "Name='node.exe'" -ErrorAction SilentlyContinue |
        Where-Object {
            $commandLine = [string]$_.CommandLine
            $commandLine.IndexOf($dshBin, [System.StringComparison]::OrdinalIgnoreCase) -ge 0 -and
            $commandLine.IndexOf($patchFile, [System.StringComparison]::OrdinalIgnoreCase) -ge 0 -and
            $commandLine -match '(?:^|\s)web(?:\s|$)' -and
            $commandLine -notmatch "--port\s+$ExceptPort(?:\s|$)"
        }
    )
}

function ConvertTo-ProcessArgument {
    param([AllowEmptyString()][string]$Argument)
    $escaped = [regex]::Replace($Argument, '(\\*)"', '$1$1\"')
    $escaped = [regex]::Replace($escaped, '(\\+)$', '$1$1')
    return '"' + $escaped + '"'
}

function Start-ProcessWithEnvironment {
    param(
        [Parameter(Mandatory = $true)]
        [string]$FilePath,
        [Parameter(Mandatory = $true)]
        [string[]]$ArgumentList,
        [Parameter(Mandatory = $true)]
        [string]$WorkingDirectory,
        [Parameter(Mandatory = $true)]
        [hashtable]$Environment
    )

    # Windows PowerShell 5.1 has no Start-Process -Environment parameter.
    # Temporarily update this launcher's process environment so the child
    # inherits a snapshot, then restore it before DSH is started.
    $previous = @{}
    try {
        foreach ($entry in $Environment.GetEnumerator()) {
            $name = [string]$entry.Key
            $previous[$name] = [Environment]::GetEnvironmentVariable($name, 'Process')
            [Environment]::SetEnvironmentVariable($name, [string]$entry.Value, 'Process')
        }

        $diagnosticRoot = Join-Path $WorkspaceRoot '.dsh/diagnostics/runtime'
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
        @{ at = [DateTime]::UtcNow.ToString('o'); event = 'process_started'; pid = $child.Id; executable = $FilePath; launch_id = $launchKey } | ConvertTo-Json -Compress | Add-Content -LiteralPath (Join-Path $diagnosticRoot 'lifecycle.jsonl')
        return $child
    } finally {
        foreach ($entry in $previous.GetEnumerator()) {
            [Environment]::SetEnvironmentVariable([string]$entry.Key, $entry.Value, 'Process')
        }
    }
}

function Assert-DjService {
    $health = Invoke-RestMethod -Uri "http://127.0.0.1:$McpPort/internal/health" -Headers @{ 'x-dsh-internal-token' = $internalToken } -TimeoutSec 10
    if (-not $health.ok -or $health.protocol.name -ne 'dsh-dj-internal-http' -or $health.protocol.version -ne 1 -or $health.execution_mode -ne $ExecutionMode) {
        throw 'The listening DJ service is unhealthy or incompatible with this deployment.'
    }
    foreach ($property in $deployment.dj.build.PSObject.Properties) {
        if ($health.build.($property.Name) -ne $property.Value) { throw "Running DJ build differs at $($property.Name); restart DJ before launching DSH." }
    }
    Write-Host 'DJ planning, account control and deployment handshake passed; execution prerequisites remain plan-specific.'
}

if (-not (Test-TcpPort -TargetPort $McpPort)) {
    Write-Host "Starting Data-Juicer gateway at http://127.0.0.1:$McpPort/internal/operator-tools (MCP also available at /mcp)"
    $mcpArgs = @('-m', 'data_juicer.tools.mcp_server', 'plan-flow', '--transport', 'streamable-http', '--port', $McpPort)
    $mcpProcessEnvironment = @{
        TEMP = $mcpTempDir
        TMP = $mcpTempDir
        TMPDIR = $mcpTempDir
        PYTHONPATH = $djRoot
        PYTHONUTF8 = '1'
        PYTHONIOENCODING = 'utf-8'
        DJ_PLAN_FLOW_CONFIG_FILE = $mcpEnvFile
        DJ_PLAN_FLOW_EXECUTION_MODE = $ExecutionMode
        DSH_DJ_INTERNAL_TOKEN = $internalToken
    }
    $allowedMcpEnvironmentNames = @(
        'OPENAI_API_KEY',
        'DASHSCOPE_API_KEY',
        'SK',
        'OPENAI_BASE_URL',
        'OPENAI_API_URL',
        'DASHSCOPE_BASE_URL',
        'DJ_VLM_MODEL',
        'DASHSCOPE_DEFAULT_MODEL',
        'OPENAI_DEFAULT_MODEL'
    )
    foreach ($name in $allowedMcpEnvironmentNames) {
        if ($mcpEnvironment.ContainsKey($name) -and -not [string]::IsNullOrWhiteSpace($mcpEnvironment[$name])) {
            $mcpProcessEnvironment[$name] = $mcpEnvironment[$name]
        }
    }
    $mcpProcess = Start-ProcessWithEnvironment `
        -FilePath $pythonExe `
        -ArgumentList $mcpArgs `
        -WorkingDirectory $djRoot `
        -Environment $mcpProcessEnvironment

    for ($attempt = 0; $attempt -lt 40 -and -not $mcpProcess.HasExited; $attempt++) {
        Start-Sleep -Milliseconds 250
        if (Test-TcpPort -TargetPort $McpPort) {
            break
        }
    }

    if (-not (Test-TcpPort -TargetPort $McpPort)) {
        if (-not $mcpProcess.HasExited) {
            Stop-Process -Id $mcpProcess.Id -Force
        }
        throw "Data-Juicer MCP did not become ready on port $McpPort."
    }
} else {
    Write-Warning "Using the MCP process already listening on port $McpPort. The current $mcpEnvFile was not reloaded; restart that MCP process after changing credentials or server code."
}

Assert-DjService

$otherDshProcesses = Get-OtherDshWebProcesses -ExceptPort $Port
if ($otherDshProcesses.Count -gt 0) {
    $descriptions = @(
        $otherDshProcesses | ForEach-Object {
            $otherPort = if ([string]$_.CommandLine -match '--port\s+(\d+)') { $matches[1] } else { 'unknown' }
            "PID $($_.ProcessId) on port $otherPort"
        }
    )
    Write-Warning (
        "Other DSH Web processes are still running: $($descriptions -join ', '). " +
        "They are not stopped automatically; close them after confirming they are no longer needed."
    )
}

$url = "http://127.0.0.1:$Port/"
$listeningProcess = Get-ListeningProcess -TargetPort $Port
if ($null -ne $listeningProcess) {
    if (-not (Test-IsExpectedDshWebProcess -Process $listeningProcess -TargetPort $Port)) {
        throw "Port $Port is already owned by PID $($listeningProcess.ProcessId), which is not the expected DSH Web process."
    }

    $runningDeployment = Invoke-RestMethod -Uri "${url}auth/deployment" -TimeoutSec 5
    if ($runningDeployment.deploymentId -ne $deployment.deploymentId) { throw 'Running DSH deployment differs; restart DSH to load the new plugins, skills and configuration.' }
    Write-Host "Using existing DSH DJ at $url (PID $($listeningProcess.ProcessId))"
    if (-not $NoOpen) { Start-Process $url }
    exit 0
}

$dshArgumentList = @($dshBin, 'web', '--patch', $patchFile, '--host', '127.0.0.1', '--port', [string]$Port, '--no-open')
if ($null -ne $DshArgs) {
    $dshArgumentList += @($DshArgs | Where-Object { -not [string]::IsNullOrWhiteSpace($_) })
}

Write-Host "Starting DSH DJ at $url"
$process = $null
try {
    $dshProcessEnvironment = @{
        HTTP_PROXY = $proxyUrl
        HTTPS_PROXY = $proxyUrl
        ALL_PROXY = $proxyUrl
        NO_PROXY = $noProxy
        NODE_USE_ENV_PROXY = '1'
        PATH = "$hfScripts;$env:PATH"
    }
    if ($deployment.config.observability) {
        $dshProcessEnvironment['OTEL_EXPORTER_OTLP_ENDPOINT'] = $langfuseEndpoint
        $dshProcessEnvironment['OTEL_EXPORTER_OTLP_HEADERS'] = $langfuseOtlpHeaders
    }
    $process = Start-ProcessWithEnvironment `
        -FilePath 'node.exe' `
        -ArgumentList $dshArgumentList `
        -WorkingDirectory $WorkspaceRoot `
        -Environment $dshProcessEnvironment

    for ($attempt = 0; $attempt -lt 40 -and -not $process.HasExited; $attempt++) {
        Start-Sleep -Milliseconds 250
        try {
            $response = Invoke-WebRequest -Uri $url -UseBasicParsing -TimeoutSec 1
            if ($response.StatusCode -eq 200) {
                $runningDeployment = Invoke-RestMethod -Uri "${url}auth/deployment" -TimeoutSec 5
                if ($runningDeployment.deploymentId -ne $deployment.deploymentId) { throw 'DSH has not loaded the requested deployment.' }
                if (-not $NoOpen) { Start-Process $url }
                $mcpRestarts = 0
                $mcpExitRecorded = $false
                while (-not $process.HasExited) {
                    Start-Sleep -Milliseconds 1000
                    $process.Refresh()
                    if ($null -ne $mcpProcess -and $mcpProcess.HasExited -and -not $mcpExitRecorded) {
                        @{ at = [DateTime]::UtcNow.ToString('o'); event = 'process_exited'; service = 'dj'; pid = $mcpProcess.Id; exit_code = $mcpProcess.ExitCode; restart_attempt = $mcpRestarts } | ConvertTo-Json -Compress | Add-Content -LiteralPath (Join-Path $WorkspaceRoot '.dsh/diagnostics/runtime/lifecycle.jsonl')
                        if ($mcpRestarts -lt 3 -and -not (Test-TcpPort -TargetPort $McpPort)) {
                            $mcpRestarts++
                            $mcpProcess = Start-ProcessWithEnvironment -FilePath $pythonExe -ArgumentList $mcpArgs -WorkingDirectory $djRoot -Environment $mcpProcessEnvironment
                        } else {
                            $mcpExitRecorded = $true
                            Write-Warning 'DJ recovery stopped after three attempts or because its port is occupied. Inspect runtime logs and rerun web-dj.ps1; existing dispatch IDs are preserved.'
                        }
                    }
                }
                $process.Refresh()
                @{ at = [DateTime]::UtcNow.ToString('o'); event = 'process_exited'; pid = $process.Id; exit_code = $process.ExitCode; recovery = 'Rerun web-dj.ps1; durable dispatch resumes with original request IDs' } | ConvertTo-Json -Compress | Add-Content -LiteralPath (Join-Path $WorkspaceRoot '.dsh/diagnostics/runtime/lifecycle.jsonl')
                exit $process.ExitCode
            }
        } catch {
            # The server is still booting.
        }
    }

    if ($process.HasExited) {
        exit $process.ExitCode
    }

    throw "DSH did not become ready at $url within 10 seconds."
} finally {
    if ($null -ne $process) {
        $runningProcess = Get-Process -Id $process.Id -ErrorAction SilentlyContinue
        if ($null -ne $runningProcess) {
            Write-Host "Stopping DSH DJ process PID $($process.Id)"
            Stop-Process -Id $process.Id -Force -ErrorAction SilentlyContinue
        }
    }
}
