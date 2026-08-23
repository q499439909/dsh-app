param(
    [int]$Port = 0,
    [int]$McpPort = 8010,
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
New-Item -ItemType Directory -Force -Path $mcpTempDir | Out-Null
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

if ($Port -gt 0) {
    $port = $Port
} else {
    $probe = [System.Net.Sockets.TcpListener]::new([System.Net.IPAddress]::Loopback, 0)
    $probe.Start()
    $port = ([System.Net.IPEndPoint]$probe.LocalEndpoint).Port
    $probe.Stop()
}

$url = "http://127.0.0.1:$port/"
$dshArgumentList = @($dshBin, 'web', '--patch', $patchFile, '--host', '127.0.0.1', '--port', [string]$port, '--no-open')
if ($null -ne $DshArgs) {
    $dshArgumentList += @($DshArgs | Where-Object { -not [string]::IsNullOrWhiteSpace($_) })
}

Write-Host "Starting DSH DJ at $url"
$process = Start-Process -FilePath 'node.exe' -ArgumentList $dshArgumentList -WorkingDirectory $dshRoot -WindowStyle Hidden -PassThru

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

Stop-Process -Id $process.Id -Force
throw "DSH did not become ready at $url within 10 seconds."
