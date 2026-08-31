param(
    [int]$Limit = 5
)

$ErrorActionPreference = 'Stop'
$prototypeRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$modelRoot = 'D:\dsh-worker\prototype-models\buffalo-bisenet-cpu'
$buffaloZip = Join-Path $modelRoot 'buffalo_l.zip'
$buffaloDir = Join-Path $modelRoot 'insightface\models\buffalo_l'
$bisenetDir = Join-Path $modelRoot 'bisenet'
$bisenetCheckpoint = Join-Path $bisenetDir '79999_iter.pth'
$inputRoot = 'D:\data\face\images'
$outputRoot = 'D:\data\face\outputs-prototype\buffalo-bisenet-cpu'
$imageName = 'dsh-prototype-buffalo-bisenet-cpu:local'

New-Item -ItemType Directory -Force -Path $modelRoot, $bisenetDir, $outputRoot | Out-Null

if (-not (Test-Path -LiteralPath $buffaloZip)) {
    Invoke-WebRequest -Uri 'https://github.com/deepinsight/insightface/releases/download/v0.7/buffalo_l.zip' -OutFile $buffaloZip
}
if (-not (Test-Path -LiteralPath $buffaloDir)) {
    New-Item -ItemType Directory -Force -Path $buffaloDir | Out-Null
    Expand-Archive -LiteralPath $buffaloZip -DestinationPath $buffaloDir -Force
    $nested = Join-Path $buffaloDir 'buffalo_l'
    if (Test-Path -LiteralPath $nested) {
        Get-ChildItem -LiteralPath $nested | Move-Item -Destination $buffaloDir
        Remove-Item -LiteralPath $nested
    }
}
if (-not (Test-Path -LiteralPath $bisenetCheckpoint)) {
    docker run --rm --network bridge --mount "type=bind,src=$bisenetDir,dst=/models" python:3.12-slim `
        sh -lc "pip install --no-cache-dir gdown==5.2.0 && gdown --id 154JgKpzCPW82qINcVieuPH3fZ2e0P812 -O /models/79999_iter.pth"
    if ($LASTEXITCODE -ne 0) { throw "BiSeNet checkpoint download failed with exit code $LASTEXITCODE" }
}

foreach ($path in @($buffaloZip, $bisenetCheckpoint)) {
    $stream = [System.IO.File]::OpenRead($path)
    try {
        $sha = [System.Security.Cryptography.SHA256]::Create()
        try {
            $digest = [System.BitConverter]::ToString($sha.ComputeHash($stream)).Replace('-', '').ToLowerInvariant()
        } finally {
            $sha.Dispose()
        }
    } finally {
        $stream.Dispose()
    }
    Write-Output "sha256=$digest path=$path"
}

docker build --pull=false -t $imageName $prototypeRoot
if ($LASTEXITCODE -ne 0) { throw "Prototype image build failed with exit code $LASTEXITCODE" }

docker run --rm --network none --read-only --cap-drop ALL --security-opt no-new-privileges:true `
    --cpus 2 --memory 8g --memory-swap 8g --pids-limit 256 `
    --tmpfs /tmp:rw,noexec,nosuid,size=1g `
    --mount "type=bind,src=$inputRoot,dst=/input,readonly" `
    --mount "type=bind,src=$modelRoot,dst=/models,readonly" `
    --mount "type=bind,src=$outputRoot,dst=/output" `
    $imageName --limit $Limit --det-thresh 0.10
if ($LASTEXITCODE -ne 0) { throw "Prototype run failed with exit code $LASTEXITCODE" }

Write-Output "Prototype outputs: $outputRoot"
