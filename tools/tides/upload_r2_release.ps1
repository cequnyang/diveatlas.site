param(
    [Parameter(Mandatory = $true)] [string] $ReleaseDirectory,
    [Parameter(Mandatory = $true)] [string] $AssetBaseUrl,
    [Parameter(Mandatory = $true)] [string] $AppOrigin
)

$ErrorActionPreference = 'Stop'

function Require-EnvironmentValue([string] $Name) {
    $value = [Environment]::GetEnvironmentVariable($Name, 'Process')
    if ([string]::IsNullOrWhiteSpace($value)) {
        throw "Required environment variable is not set: $Name"
    }
    return $value
}

$release = (Resolve-Path -LiteralPath $ReleaseDirectory).Path
$manifestPath = Join-Path $release 'release-manifest.json'
if (-not (Test-Path -LiteralPath $manifestPath -PathType Leaf)) {
    throw "Release manifest not found in $release"
}

$accountId = Require-EnvironmentValue 'CLOUDFLARE_ACCOUNT_ID'
$bucket = Require-EnvironmentValue 'CLOUDFLARE_R2_BUCKET'
$accessKey = Require-EnvironmentValue 'CLOUDFLARE_R2_ACCESS_KEY_ID'
$secretKey = Require-EnvironmentValue 'CLOUDFLARE_R2_SECRET_ACCESS_KEY'
$previousAwsEnvironment = @{}
foreach ($name in @('AWS_ACCESS_KEY_ID', 'AWS_SECRET_ACCESS_KEY', 'AWS_DEFAULT_REGION', 'AWS_EC2_METADATA_DISABLED')) {
    $previousAwsEnvironment[$name] = [Environment]::GetEnvironmentVariable($name, 'Process')
}
if (-not (Get-Command aws -ErrorAction SilentlyContinue)) {
    throw 'AWS CLI v2 is required for the R2 S3-compatible upload.'
}

$manifest = Get-Content -LiteralPath $manifestPath -Raw | ConvertFrom-Json
$releaseId = Split-Path -Leaf $release
if ($manifest.format -ne 'diveatlas-tide-static-release' -or $manifest.schemaVersion -ne 1 -or $manifest.release -ne $releaseId) {
    throw 'Release manifest format, schema version, or release id does not match the staged directory.'
}

$assetUri = [Uri] $AssetBaseUrl
$appUri = [Uri] $AppOrigin
if ($assetUri.Scheme -ne 'https' -or $assetUri.Query -or $assetUri.Fragment -or -not $assetUri.AbsolutePath.EndsWith('/tides/')) {
    throw 'AssetBaseUrl must be the final HTTPS release path ending in /<release>/tides/.'
}
if ($appUri.Scheme -ne 'https' -or $appUri.AbsolutePath -ne '/' -or $appUri.Query -or $appUri.Fragment) {
    throw 'AppOrigin must be an HTTPS origin without a path, query, or fragment.'
}

$expectedUrlSuffix = "/tides/$releaseId/tides/"
if (-not $assetUri.AbsolutePath.EndsWith($expectedUrlSuffix, [StringComparison]::OrdinalIgnoreCase)) {
    throw "AssetBaseUrl must point to the immutable release id '$releaseId'."
}

try {
    $endpoint = "https://$accountId.r2.cloudflarestorage.com"
    $prefix = "tides/$releaseId"
    $env:AWS_ACCESS_KEY_ID = $accessKey
    $env:AWS_SECRET_ACCESS_KEY = $secretKey
    $env:AWS_DEFAULT_REGION = 'auto'
    $env:AWS_EC2_METADATA_DISABLED = 'true'

# R2 bucket CORS is configured separately in Cloudflare. Refuse to upload into
# an occupied immutable prefix; a failed attempt can be retried only after its
# partial objects are reviewed and removed by the operator.
$existing = & aws s3api list-objects-v2 --endpoint-url $endpoint --bucket $bucket --prefix "$prefix/" --max-keys 1 --output json | ConvertFrom-Json
if ($LASTEXITCODE -ne 0) { throw 'Could not inspect the target R2 prefix; no files were uploaded.' }
if ($existing.Contents -and $existing.Contents.Count -gt 0) {
    throw "Refusing to overwrite non-empty immutable R2 release prefix $prefix."
}

$python = Get-Command python -ErrorAction SilentlyContinue
if (-not $python) { throw 'Python is required to validate the local staged release and perform HTTP smoke checks.' }
$verifyCode = 'import json,sys; from pathlib import Path; from tools.tides.stage_static_release import verify_release; m=verify_release(Path(sys.argv[1])); print(json.dumps({"release":m["release"],"fileCount":m["fileCount"],"totalBytes":m["totalBytes"],"inventorySha256":m["inventorySha256"]}))'
$localSummary = & python -c $verifyCode $release | ConvertFrom-Json
if ($LASTEXITCODE -ne 0 -or $localSummary.release -ne $releaseId) {
    throw 'Local staged release integrity validation failed; no files were uploaded.'
}

$sourceUrl = (Get-Item -LiteralPath $release).FullName
$targetUrl = "s3://$bucket/$prefix/"
& aws s3 sync $sourceUrl $targetUrl --endpoint-url $endpoint --cache-control 'public, max-age=31536000, immutable' --exclude '_headers-example.txt' --no-progress
if ($LASTEXITCODE -ne 0) { throw 'R2 sync failed. Inspect the versioned prefix before retrying.' }

$remoteLines = & aws s3 ls $targetUrl --endpoint-url $endpoint --recursive
if ($LASTEXITCODE -ne 0) { throw 'Could not list uploaded R2 objects after sync.' }
$remoteObjects = @($remoteLines | Where-Object { $_ -match '^\d{4}-\d{2}-\d{2}\s+\d{2}:\d{2}:\d{2}\s+\d+\s+' })
$expectedCount = [int] $manifest.fileCount + 1
if ($remoteObjects.Count -ne $expectedCount) {
    throw "Uploaded object count mismatch: expected $expectedCount, found $($remoteObjects.Count). Do not switch production config."
}

$smoke = & python tools/tides/verify_http_release.py --asset-base-url $AssetBaseUrl --app-origin $AppOrigin | ConvertFrom-Json
if ($LASTEXITCODE -ne 0 -or -not $smoke.allChecksPassed -or $smoke.release -ne $releaseId) {
    throw 'Public HTTP release validation failed. Do not switch production config.'
}

    [PSCustomObject]@{
        Release = $releaseId
        R2Prefix = $prefix
        UploadedObjectCount = $remoteObjects.Count
        StagedBytes = $manifest.totalBytes
        InventorySha256 = $manifest.inventorySha256
        HttpSmokePassed = $true
        ProductionConfigSwitched = $false
    }
} finally {
    foreach ($name in $previousAwsEnvironment.Keys) {
        [Environment]::SetEnvironmentVariable($name, $previousAwsEnvironment[$name], 'Process')
    }
    $accessKey = $null
    $secretKey = $null
}
