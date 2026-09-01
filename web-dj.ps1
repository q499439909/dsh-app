param(
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
$dshRoot = 'D:\dsh-app'
$djRoot = 'D:\dj\data-juicer-1.5.4'
$dshBin = Join-Path $dshRoot 'node_modules\@deepseek-ai\dsh\lib\bin.js'
$patchFile = Join-Path $dshRoot 'dj-dsh.patch.yml'
$pythonExe = 'D:\dj\.envs\dsh-dj\python.exe'
$mcpTempDir = Join-Path $djRoot '.mcp-tmp'
$mcpEnvFile = Join-Path $dshRoot 'dj-plan-flow.env'
$authEnvFile = Join-Path $dshRoot 'dsh-auth.env'
$operatorPluginSource = Join-Path $dshRoot 'packages\dsh-dj-operator-library'
$planPluginSource = Join-Path $dshRoot 'packages\dsh-dj-plan-explorer'
$authPluginSource = Join-Path $dshRoot 'packages\dsh-user-auth'
$datasetPluginSource = Join-Path $dshRoot 'packages\dsh-dj-datasets'
$internalTokenPath = Join-Path $dshRoot '.dsh\dj-internal-token'
$dshProfileRoot = Join-Path ([Environment]::GetFolderPath('UserProfile')) '.dsh\profiles\web'
$operatorPluginLink = Join-Path $dshProfileRoot 'node_modules\@dsh-dj\operator-library'
$planPluginLink = Join-Path $dshProfileRoot 'node_modules\@dsh-dj\plan-explorer'
$authPluginLink = Join-Path $dshProfileRoot 'node_modules\@dsh-dj\user-auth'
$datasetPluginLink = Join-Path $dshProfileRoot 'node_modules\@dsh-dj\datasets'

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

if (-not (Test-Path -LiteralPath $dshBin)) {
    throw "Cannot find dsh: $dshBin"
}
if (-not (Test-Path -LiteralPath $pythonExe)) {
    throw "Cannot find the Data-Juicer Python environment: $pythonExe"
}
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

        return Start-Process `
            -FilePath $FilePath `
            -ArgumentList $ArgumentList `
            -WorkingDirectory $WorkingDirectory `
            -WindowStyle Hidden `
            -PassThru
    } finally {
        foreach ($entry in $previous.GetEnumerator()) {
            [Environment]::SetEnvironmentVariable([string]$entry.Key, $entry.Value, 'Process')
        }
    }
}

if (-not (Test-TcpPort -TargetPort $McpPort)) {
    Write-Host "Starting Data-Juicer plan-flow MCP at http://127.0.0.1:$McpPort/mcp"
    $mcpArgs = @('-m', 'data_juicer.tools.mcp_server', 'plan-flow', '--transport', 'streamable-http', '--port', $McpPort)
    $mcpProcessEnvironment = @{
        TEMP = $mcpTempDir
        TMP = $mcpTempDir
        TMPDIR = $mcpTempDir
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

    Write-Host "Using existing DSH DJ at $url (PID $($listeningProcess.ProcessId))"
    Start-Process $url
    exit 0
}

$dshArgumentList = @($dshBin, 'web', '--patch', $patchFile, '--host', '127.0.0.1', '--port', [string]$Port, '--no-open')
if ($null -ne $DshArgs) {
    $dshArgumentList += @($DshArgs | Where-Object { -not [string]::IsNullOrWhiteSpace($_) })
}

Write-Host "Starting DSH DJ at $url"
$process = $null
try {
    $process = Start-Process `
        -FilePath 'node.exe' `
        -ArgumentList $dshArgumentList `
        -WorkingDirectory $dshRoot `
        -WindowStyle Hidden `
        -PassThru

    for ($attempt = 0; $attempt -lt 40 -and -not $process.HasExited; $attempt++) {
        Start-Sleep -Milliseconds 250
        try {
            $response = Invoke-WebRequest -Uri $url -UseBasicParsing -TimeoutSec 1
            if ($response.StatusCode -eq 200) {
                Start-Process $url
                Wait-Process -Id $process.Id
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
