$ErrorActionPreference = 'Stop'
$repo = Split-Path $PSScriptRoot -Parent
$fixture = Join-Path ([IO.Path]::GetTempPath()) ('syncfly launcher ' + [Guid]::NewGuid())
New-Item -ItemType Directory -Path (Join-Path $fixture 'scripts') -Force | Out-Null
Copy-Item (Join-Path $repo 'scripts/windows.ps1') (Join-Path $fixture 'scripts/windows.ps1')
$global:dockerCalls = [Collections.Generic.List[string]]::new()
function global:docker {
    $line = $args -join ' '
    $global:dockerCalls.Add($line)
    $global:LASTEXITCODE = 0
    if ($line.StartsWith('info ')) { 'linux' }
    elseif ($line.StartsWith('volume inspect ')) { '/var/lib/docker/volumes/syncfly_data/_data' }
}
try {
    & (Join-Path $fixture 'scripts/windows.ps1') -Action Start -NoBrowser
    $config = Get-Content (Join-Path $fixture '.env.desktop') -Raw
    if ($config -notmatch 'RELAY_INVITE_CODE=[A-Za-z0-9_-]{43}') { throw 'Missing generated invitation.' }
    if ($config -notmatch 'RELAY_ALLOW_SIGNUP=false') { throw 'Registration should default to closed.' }
    if ($config -notmatch 'RELAY_HOST_DATA_DIR=/var/lib/docker/volumes/syncfly_data/_data') { throw 'Incorrect runner mount.' }
    & (Join-Path $fixture 'scripts/windows.ps1') -Action Start -NoBrowser
    if ((Get-Content (Join-Path $fixture '.env.desktop') -Raw) -ne $config) { throw 'Restart changed configuration.' }
    if (-not ($global:dockerCalls | Where-Object { $_ -match 'up -d --wait' })) { throw 'Did not wait for backend readiness.' }
    Write-Host 'Windows launcher setup and restart passed.'
} finally {
    Set-Location $repo
    Remove-Item $fixture -Recurse -Force
    Remove-Item function:global:docker
}
