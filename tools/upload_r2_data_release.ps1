param(
    [Parameter(Mandatory = $true)] [string] $ReleaseDirectory,
    [Parameter(Mandatory = $true)] [string] $AssetBaseUrl,
    [Parameter(Mandatory = $true)] [string] $AppOrigin
)

$ErrorActionPreference = 'Stop'

function Require-EnvironmentValue([string] $Name) {
    $value = [Environment]::GetEnvironmentVariable($Name, 'Process')
    if ([string]::IsNullOrWhiteSpace($value)) { throw "Required environment variable is not set: $Name" }
    return $value
}

$release = (Resolve-Path -LiteralPath $ReleaseDirectory).Path
$manifestPath = Join-Path $release 'release-manifest.json'
if (-not (Test-Path -LiteralPath $manifestPath -PathType Leaf)) { throw "Release manifest not found: $manifestPath" }
$accountId = Require-EnvironmentValue 'CLOUDFLARE_ACCOUNT_ID'
$bucket = Require-EnvironmentValue 'CLOUDFLARE_R2_BUCKET'
$accessKey = Require-EnvironmentValue 'CLOUDFLARE_R2_ACCESS_KEY_ID'
$secretKey = Require-EnvironmentValue 'CLOUDFLARE_R2_SECRET_ACCESS_KEY'
if (-not (Get-Command aws -ErrorAction SilentlyContinue)) { throw 'AWS CLI v2 is required for the R2 S3-compatible upload.' }

$manifest = Get-Content -LiteralPath $manifestPath -Raw | ConvertFrom-Json
$releaseId = Split-Path -Leaf $release
if ($manifest.format -ne 'diveatlas-browser-data-release' -or $manifest.schemaVersion -ne 1 -or $manifest.release -ne $releaseId) {
    throw 'R2 release manifest format, schema, or ID does not match the staged directory.'
}
$assetUri = [Uri] $AssetBaseUrl
$appUri = [Uri] $AppOrigin
if ($assetUri.Scheme -ne 'https' -or $assetUri.Query -or $assetUri.Fragment -or
    -not $assetUri.AbsolutePath.EndsWith("/releases/$releaseId/", [StringComparison]::OrdinalIgnoreCase)) {
    throw "AssetBaseUrl must be the final HTTPS release path ending in /releases/$releaseId/."
}
if ($appUri.Scheme -ne 'https' -or $appUri.AbsolutePath -ne '/' -or $appUri.Query -or $appUri.Fragment) {
    throw 'AppOrigin must be an HTTPS origin without a path, query, or fragment.'
}

$oldEnvironment = @{}
foreach ($name in @('AWS_ACCESS_KEY_ID', 'AWS_SECRET_ACCESS_KEY', 'AWS_DEFAULT_REGION', 'AWS_EC2_METADATA_DISABLED')) {
    $oldEnvironment[$name] = [Environment]::GetEnvironmentVariable($name, 'Process')
}
try {
    $endpoint = "https://$accountId.r2.cloudflarestorage.com"
    $prefix = "releases/$releaseId"
    $env:AWS_ACCESS_KEY_ID = $accessKey
    $env:AWS_SECRET_ACCESS_KEY = $secretKey
    $env:AWS_DEFAULT_REGION = 'auto'
    $env:AWS_EC2_METADATA_DISABLED = 'true'

    $existing = & aws s3api list-objects-v2 --endpoint-url $endpoint --bucket $bucket --prefix "$prefix/" --max-keys 1 --output json | ConvertFrom-Json
    if ($LASTEXITCODE -ne 0) { throw 'Could not inspect the target R2 prefix; no files were uploaded.' }
    if ($existing.Contents -and $existing.Contents.Count -gt 0) { throw "Refusing to overwrite immutable R2 prefix $prefix." }

    $verifyCode = 'import json,sys; from pathlib import Path; from tools.stage_data_release import verify_release; m=verify_release(Path(sys.argv[1])); print(json.dumps({"release":m["release"],"fileCount":m["fileCount"],"totalBytes":m["totalBytes"],"inventorySha256":m["inventorySha256"]}))'
    $local = & python -c $verifyCode $release | ConvertFrom-Json
    if ($LASTEXITCODE -ne 0 -or $local.release -ne $releaseId) { throw 'Local R2 release integrity validation failed; no files were uploaded.' }

    & aws s3 sync $release "s3://$bucket/$prefix/" --endpoint-url $endpoint --cache-control 'public, max-age=31536000, immutable' --no-progress
    if ($LASTEXITCODE -ne 0) { throw 'R2 sync failed. Inspect this release prefix before retrying.' }

    $remoteLines = & aws s3 ls "s3://$bucket/$prefix/" --endpoint-url $endpoint --recursive
    if ($LASTEXITCODE -ne 0) { throw 'Could not list uploaded R2 objects.' }
    $remoteObjects = @($remoteLines | Where-Object { $_ -match '^\d{4}-\d{2}-\d{2}\s+\d{2}:\d{2}:\d{2}\s+\d+\s+' })
    if ($remoteObjects.Count -ne ([int]$manifest.fileCount + 1)) {
        throw "Uploaded object count mismatch: expected $([int]$manifest.fileCount + 1), found $($remoteObjects.Count). Do not switch the site configuration."
    }

    $smoke = & python tools/verify_r2_data_release.py --asset-base-url $AssetBaseUrl --app-origin $AppOrigin | ConvertFrom-Json
    if ($LASTEXITCODE -ne 0 -or $smoke.release -ne $releaseId -or $smoke.cors -ne 'passed') {
        throw 'Public R2 data release verification failed. Do not switch the site configuration.'
    }
    [PSCustomObject]@{
        Release = $releaseId
        R2Prefix = $prefix
        UploadedObjectCount = $remoteObjects.Count
        StagedBytes = $manifest.totalBytes
        InventorySha256 = $manifest.inventorySha256
        PublicHttpChecksPassed = $true
        ProductionConfigSwitched = $false
    }
} finally {
    foreach ($name in $oldEnvironment.Keys) { [Environment]::SetEnvironmentVariable($name, $oldEnvironment[$name], 'Process') }
    $accessKey = $null
    $secretKey = $null
}
