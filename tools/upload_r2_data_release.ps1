param(
    [Parameter(Mandatory = $true)] [string] $ReleaseDirectory,
    [Parameter(Mandatory = $true)] [string] $AssetBaseUrl,
    [Parameter(Mandatory = $true)] [string] $AppOrigin,
    [switch] $AppendExisting
)

$ErrorActionPreference = 'Stop'

function Require-EnvironmentValue([string] $Name) {
    $value = [Environment]::GetEnvironmentVariable($Name, 'Process')
    if ([string]::IsNullOrWhiteSpace($value)) { throw "Required environment variable is not set: $Name" }
    return $value
}

function Get-InventorySha256($Files) {
    $inventory = [System.Text.StringBuilder]::new()
    foreach ($file in $Files) {
        [void] $inventory.Append($file.path).Append([char]0).Append($file.bytes).Append([char]0)
        [void] $inventory.Append($file.sha256).Append("`n")
    }
    $bytes = [System.Text.Encoding]::UTF8.GetBytes($inventory.ToString())
    $digest = [System.Security.Cryptography.SHA256]::HashData($bytes)
    return [Convert]::ToHexString($digest).ToLowerInvariant()
}

$appendableStartupDataPaths = @(
    'data/bathymetry_manifest.js',
    'data/coral_occurrence_manifest.js',
    'data/reef_raster_manifest.js',
    'data/reef_vector_manifest.js',
    'data/terrain_manifest.js',
    'data/temperature/metadata.json',
    'data/dive-sites-v3.js',
    'data/dive-site-search-locations-v4.json.gz',
    'data/dive-site-summaries-v3.json.gz'
)

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

    $existing = & aws s3api list-objects-v2 --endpoint-url $endpoint --bucket $bucket --prefix "$prefix/" --output json | ConvertFrom-Json
    if ($LASTEXITCODE -ne 0) { throw 'Could not inspect the target R2 prefix; no files were uploaded.' }
    $prefixExists = @($existing.Contents).Count -gt 0
    if ($prefixExists -and -not $AppendExisting) { throw "R2 prefix $prefix already exists. Use -AppendExisting only for a verified additive update." }
    if (-not $prefixExists -and $AppendExisting) { throw "Cannot append: R2 prefix $prefix does not exist." }

    $verifyCode = 'import json,sys; from pathlib import Path; from tools.stage_data_release import verify_release; m=verify_release(Path(sys.argv[1])); print(json.dumps({"release":m["release"],"fileCount":m["fileCount"],"totalBytes":m["totalBytes"],"inventorySha256":m["inventorySha256"]}))'
    $local = & python -c $verifyCode $release | ConvertFrom-Json
    if ($LASTEXITCODE -ne 0 -or $local.release -ne $releaseId) { throw 'Local R2 release integrity validation failed; no files were uploaded.' }

    if ($AppendExisting) {
        $extensionPaths = @($manifest.files | ForEach-Object { $_.path } | Sort-Object)
        if ($extensionPaths.Count -eq 0 -or @($extensionPaths | Where-Object {
            $_ -notin $appendableStartupDataPaths -and
            $_ -notlike 'data/temperature/query/v2/*' -and
            $_ -notlike 'data/water_clarity/query/v2/*'
        }).Count -gt 0) {
            throw 'Append mode accepts only designated startup data objects or versioned environmental query assets.'
        }

        $remoteManifestPath = Join-Path $env:TEMP ("diveatlas-r2-manifest-$([Guid]::NewGuid().ToString('N')).json")
        try {
            & aws s3 cp "s3://$bucket/$prefix/release-manifest.json" $remoteManifestPath --endpoint-url $endpoint --no-progress
            if ($LASTEXITCODE -ne 0) { throw 'Could not download the existing release inventory; no objects were changed.' }
            $existingManifest = Get-Content -LiteralPath $remoteManifestPath -Raw | ConvertFrom-Json
            if ($existingManifest.format -ne 'diveatlas-browser-data-release' -or $existingManifest.schemaVersion -ne 1 -or
                $existingManifest.release -ne $releaseId -or -not ($existingManifest.files -is [array])) {
                throw 'Existing R2 release inventory has an unsupported format or release ID.'
            }
            $oldFiles = @($existingManifest.files)
            if ($oldFiles.Count -ne [int]$existingManifest.fileCount -or
                (($oldFiles | Measure-Object -Property bytes -Sum).Sum) -ne [long]$existingManifest.totalBytes -or
                (Get-InventorySha256 $oldFiles) -ne $existingManifest.inventorySha256) {
                throw 'Existing R2 release inventory failed its count, size, or checksum validation.'
            }
            $oldPaths = @{}
            $expectedRemote = [System.Collections.Generic.HashSet[string]]::new([StringComparer]::Ordinal)
            $requiredRemote = [System.Collections.Generic.HashSet[string]]::new([StringComparer]::Ordinal)
            foreach ($file in $oldFiles) {
                $oldPaths[$file.path] = $true
                [void] $expectedRemote.Add("$prefix/$($file.path)")
                [void] $requiredRemote.Add("$prefix/$($file.path)")
            }
            foreach ($file in $manifest.files) {
                if ($oldPaths.ContainsKey($file.path)) { throw "Refusing to overwrite an object already listed in the release: $($file.path)" }
                [void] $expectedRemote.Add("$prefix/$($file.path)")
            }
            [void] $expectedRemote.Add("$prefix/release-manifest.json")
            [void] $requiredRemote.Add("$prefix/release-manifest.json")
            $actualRemote = [System.Collections.Generic.HashSet[string]]::new([StringComparer]::Ordinal)
            foreach ($item in $existing.Contents) { [void] $actualRemote.Add($item.Key) }
            # The active release contains tens of thousands of objects. Hash-set
            # membership keeps this integrity check linear instead of comparing
            # every listed key against the entire inventory repeatedly.
            $missingOld = [System.Collections.Generic.List[string]]::new()
            foreach ($key in $requiredRemote) {
                if (-not $actualRemote.Contains($key)) { [void] $missingOld.Add($key) }
            }
            $unexpected = [System.Collections.Generic.List[string]]::new()
            foreach ($key in $actualRemote) {
                if (-not $expectedRemote.Contains($key)) { [void] $unexpected.Add($key) }
            }
            if ($missingOld.Count -gt 0 -or $unexpected.Count -gt 0) {
                throw 'R2 prefix has missing inventoried objects or unrelated unlisted objects; refusing to append.'
            }

            # The v2 query set has more than 90,000 small files. Use the AWS
            # transfer manager for bounded-concurrency uploads instead of one
            # process and connection per chunk. Versioned paths were already
            # checked for collisions, and the inventory remains the final write.
            $environmentalQueryFiles = @($manifest.files | Where-Object {
                $_.path -like 'data/temperature/query/v2/*' -or
                $_.path -like 'data/water_clarity/query/v2/*'
            })
            if ($environmentalQueryFiles.Count -gt 0) {
                & aws s3 sync $release "s3://$bucket/$prefix/" --endpoint-url $endpoint `
                    --exclude '*' --include 'data/temperature/query/v2/*' --include 'data/water_clarity/query/v2/*' `
                    --cache-control 'public, max-age=31536000, immutable' --no-progress
                if ($LASTEXITCODE -ne 0) { throw 'Environmental query asset batch upload failed. The release manifest was not changed.' }
            }

            foreach ($file in $manifest.files) {
                if ($file.path -like 'data/temperature/query/v2/*' -or $file.path -like 'data/water_clarity/query/v2/*') {
                    continue
                }
                $source = Join-Path $release ($file.path -replace '/', [IO.Path]::DirectorySeparatorChar)
                $target = "s3://$bucket/$prefix/$($file.path)"
                if ($actualRemote.Contains("$prefix/$($file.path)")) {
                    $existingObjectPath = Join-Path $env:TEMP ("diveatlas-r2-object-$([Guid]::NewGuid().ToString('N'))")
                    try {
                        & aws s3 cp $target $existingObjectPath --endpoint-url $endpoint --no-progress
                        if ($LASTEXITCODE -ne 0) { throw "Could not verify previously appended object $($file.path)." }
                        $existingHash = (Get-FileHash -LiteralPath $existingObjectPath -Algorithm SHA256).Hash.ToLowerInvariant()
                        if ((Get-Item -LiteralPath $existingObjectPath).Length -ne [long]$file.bytes -or $existingHash -ne $file.sha256) {
                            throw "Existing object differs from the staged manifest; refusing to overwrite $($file.path)."
                        }
                    } finally {
                        Remove-Item -LiteralPath $existingObjectPath -Force -ErrorAction SilentlyContinue
                    }
                    continue
                }
                $contentType = if ($file.path.EndsWith('.gz', [StringComparison]::OrdinalIgnoreCase)) {
                    'application/gzip'
                } elseif ($file.path.EndsWith('.json', [StringComparison]::OrdinalIgnoreCase)) {
                    'application/json'
                } else {
                    'application/javascript'
                }
                & aws s3 cp $source $target --endpoint-url $endpoint --cache-control 'public, max-age=31536000, immutable' --content-type $contentType --no-progress
                if ($LASTEXITCODE -ne 0) { throw "Could not append $($file.path). The release inventory was not changed." }
            }

            $mergedFiles = @($oldFiles) + @($manifest.files)
            $merged = [ordered]@{}
            foreach ($property in $existingManifest.PSObject.Properties) { $merged[$property.Name] = $property.Value }
            $merged['updatedAt'] = [DateTime]::UtcNow.ToString('yyyy-MM-ddTHH:mm:ssZ')
            $merged['fileCount'] = $mergedFiles.Count
            $merged['totalBytes'] = [long](($mergedFiles | Measure-Object -Property bytes -Sum).Sum)
            $merged['inventorySha256'] = Get-InventorySha256 $mergedFiles
            $merged['files'] = $mergedFiles
            $updatedManifestPath = Join-Path $env:TEMP ("diveatlas-r2-manifest-updated-$([Guid]::NewGuid().ToString('N')).json")
            try {
                $merged | ConvertTo-Json -Depth 30 | Set-Content -LiteralPath $updatedManifestPath -Encoding utf8
                & aws s3 cp $updatedManifestPath "s3://$bucket/$prefix/release-manifest.json" --endpoint-url $endpoint --cache-control 'no-store, max-age=0, must-revalidate' --content-type 'application/json' --no-progress
                if ($LASTEXITCODE -ne 0) { throw 'Manifest objects were uploaded, but the release inventory update failed. Retry append mode to finish the inventory update.' }
            } finally {
                Remove-Item -LiteralPath $updatedManifestPath -Force -ErrorAction SilentlyContinue
            }
            $manifest = [PSCustomObject]$merged
        } finally {
            Remove-Item -LiteralPath $remoteManifestPath -Force -ErrorAction SilentlyContinue
        }
    } else {
        & aws s3 sync $release "s3://$bucket/$prefix/" --endpoint-url $endpoint --cache-control 'public, max-age=31536000, immutable' --no-progress
        if ($LASTEXITCODE -ne 0) { throw 'R2 sync failed. Inspect this release prefix before retrying.' }
    }

    $remoteLines = & aws s3 ls "s3://$bucket/$prefix/" --endpoint-url $endpoint --recursive
    if ($LASTEXITCODE -ne 0) { throw 'Could not list uploaded R2 objects.' }
    $remoteObjects = @($remoteLines | Where-Object { $_ -match '^\d{4}-\d{2}-\d{2}\s+\d{2}:\d{2}:\d{2}\s+\d+\s+' })
    if ($remoteObjects.Count -ne ([int]$manifest.fileCount + 1)) {
        throw "Uploaded object count mismatch: expected $([int]$manifest.fileCount + 1), found $($remoteObjects.Count). Do not switch the site configuration."
    }
    $remoteSizes = @{}
    foreach ($line in $remoteObjects) {
        if ($line -match '^\d{4}-\d{2}-\d{2}\s+\d{2}:\d{2}:\d{2}\s+(?<size>\d+)\s+(?<key>.+)$') {
            $remoteSizes[$Matches.key] = [long]$Matches.size
        }
    }
    foreach ($file in $manifest.files) {
        $key = "$prefix/$($file.path)"
        if (-not $remoteSizes.ContainsKey($key) -or $remoteSizes[$key] -ne [long]$file.bytes) {
            throw "Uploaded object is missing or has a different size than its verified local manifest: $($file.path). Do not switch the site configuration."
        }
    }

    $smoke = & python tools/verify_r2_data_release.py --asset-base-url $AssetBaseUrl --app-origin $AppOrigin | ConvertFrom-Json
    if ($LASTEXITCODE -ne 0 -or $smoke.release -ne $releaseId -or $smoke.cors -ne 'passed') {
        throw 'Public R2 data release verification failed. Do not switch the site configuration.'
    }
    [PSCustomObject]@{
        Release = $releaseId
        R2Prefix = $prefix
        AppendMode = [bool]$AppendExisting
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
