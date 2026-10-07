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
& (Join-Path $PSScriptRoot 'integrations\data-juicer\web-dj.ps1') @PSBoundParameters
exit $LASTEXITCODE
