[CmdletBinding()]
param(
    [ValidateSet('Start', 'Status', 'Logs', 'Stop', 'Private', 'Local', 'OpenInvites', 'CloseInvites', 'Invitation')]
    [string]$Action = 'Start',
    [switch]$NoBrowser
)
$ErrorActionPreference = 'Stop'
Set-Location (Split-Path $PSScriptRoot -Parent)
$configFile = Join-Path (Get-Location) '.env.desktop'

function Invoke-Docker {
    param([string[]]$Arguments)
    & docker @Arguments
    if ($LASTEXITCODE -ne 0) { throw "Docker command failed (exit $LASTEXITCODE)." }
}
function Invoke-Compose {
    param([string[]]$Arguments)
    Invoke-Docker -Arguments (@('compose', '--env-file', $configFile, '-f', 'compose.desktop.yaml') + $Arguments)
}
function Read-Config {
    $values = @{}
    if (Test-Path $configFile) {
        foreach ($line in Get-Content $configFile) {
            if ($line -match '^([A-Z_]+)=(.*)$') { $values[$Matches[1]] = $Matches[2] }
        }
    }
    return $values
}
function Save-Config {
    param([hashtable]$Values)
    $lines = foreach ($key in ($Values.Keys | Sort-Object)) { "$key=$($Values[$key])" }
    [IO.File]::WriteAllLines($configFile, [string[]]$lines, [Text.UTF8Encoding]::new($false))
    # Secrets stay in the user's checkout, never in Git or container images.
    if ($env:OS -eq 'Windows_NT') {
        $identity = [Security.Principal.WindowsIdentity]::GetCurrent().Name
        & icacls $configFile /inheritance:r /grant:r "${identity}:(F)" | Out-Null
        if ($LASTEXITCODE -ne 0) { throw 'Could not restrict access to .env.desktop.' }
    }
}
function Restart-App {
    $settings = Read-Config
    if ($settings.RELAY_PUBLIC_URL.StartsWith('https://')) {
        Invoke-Compose -Arguments @('--profile', 'private', 'up', '-d', '--force-recreate', 'relay', 'tailscale')
    } else {
        Invoke-Compose -Arguments @('up', '-d', '--force-recreate', 'relay')
    }
}

if (-not (Get-Command docker -ErrorAction SilentlyContinue)) {
    throw 'Install and start Docker Desktop with the WSL 2 backend and Linux containers first. See README.md.'
}
$engine = Invoke-Docker -Arguments @('info', '--format', '{{.OSType}}')
if ($engine.Trim() -ne 'linux') { throw 'Switch Docker Desktop to Linux containers.' }

if ($Action -eq 'Start') {
    Invoke-Docker -Arguments @('volume', 'create', 'syncfly_data') | Out-Null
    $mountpoint = Invoke-Docker -Arguments @('volume', 'inspect', 'syncfly_data', '--format', '{{.Mountpoint}}')
    $settings = Read-Config
    if (-not $settings.ContainsKey('RELAY_INVITE_CODE')) {
        $bytes = New-Object byte[] 32
        $rng = [Security.Cryptography.RandomNumberGenerator]::Create()
        try { $rng.GetBytes($bytes) } finally { $rng.Dispose() }
        $settings.RELAY_INVITE_CODE = [Convert]::ToBase64String($bytes).TrimEnd('=').Replace('+', '-').Replace('/', '_')
        $settings.RELAY_PUBLIC_URL = 'http://localhost:4310'
        $settings.RELAY_ALLOW_SIGNUP = 'false'
        $settings.RELAY_MAX_ACTIVE_TASKS = '1'
    }
    $settings.RELAY_HOST_DATA_DIR = $mountpoint.Trim()
    Save-Config -Values $settings
    Invoke-Compose -Arguments @('config', '--quiet')
    Invoke-Compose -Arguments @('--parallel', '1', 'build')
    Invoke-Compose -Arguments @('up', '-d', '--wait', '--wait-timeout', '180')
    if ($settings.RELAY_PUBLIC_URL.StartsWith('https://')) {
        Invoke-Compose -Arguments @('--profile', 'private', 'up', '-d', 'tailscale')
    }
    Write-Host "Syncfly is ready at $($settings.RELAY_PUBLIC_URL)"
    if (-not $NoBrowser) {
        $setupUrl = "$($settings.RELAY_PUBLIC_URL)/#setup=$([Uri]::EscapeDataString($settings.RELAY_INVITE_CODE))"
        Start-Process $setupUrl
    }
    Write-Host 'Your browser opens with the setup code filled in. Create your account there.'
    Write-Host 'If you already have an account on this PC, sign in instead.'
    exit 0
}
if (-not (Test-Path $configFile)) { throw 'Run this script with -Action Start first.' }

switch ($Action) {
    'Status' { Invoke-Compose -Arguments @('--profile', 'private', 'ps') }
    'Logs' { Invoke-Compose -Arguments @('logs', '--tail', '100', 'relay') }
    'Stop' { Invoke-Compose -Arguments @('--profile', 'private', 'stop') }
    'Invitation' { Write-Host "Private signup code: $((Read-Config).RELAY_INVITE_CODE)" }
    'OpenInvites' {
        $settings = Read-Config; $settings.RELAY_ALLOW_SIGNUP = 'true'
        Save-Config -Values $settings; Restart-App
        Write-Host 'Registration is open to people with your invitation code. Close it after onboarding.'
    }
    'CloseInvites' {
        $settings = Read-Config; $settings.RELAY_ALLOW_SIGNUP = 'false'
        Save-Config -Values $settings; Restart-App
        Write-Host 'New registrations are disabled. Existing users can still sign in.'
    }
    'Local' {
        Invoke-Compose -Arguments @('--profile', 'private', 'stop', 'tailscale')
        $settings = Read-Config; $settings.RELAY_PUBLIC_URL = 'http://localhost:4310'
        Save-Config -Values $settings; Restart-App
        Write-Host 'Private remote access is stopped. Open http://localhost:4310 on this PC.'
    }
    'Private' {
        Invoke-Compose -Arguments @('--profile', 'private', 'up', '-d', 'tailscale')
        $status = $null
        for ($attempt = 0; $attempt -lt 15; $attempt++) {
            $raw = & docker compose --env-file $configFile -f compose.desktop.yaml exec -T tailscale tailscale status --json 2>$null
            try { $status = ($raw -join "`n") | ConvertFrom-Json } catch { $status = $null }
            if ($status -and ($status.AuthURL -or $status.BackendState -eq 'Running')) { break }
            Start-Sleep -Seconds 1
        }
        if ($status.AuthURL) {
            Write-Host 'Sign in to your Tailscale account using this device link:'
            Write-Host $status.AuthURL
            Write-Host 'After connecting the device, rerun -Action Private.'
            exit 0
        }
        if (-not $status -or $status.BackendState -ne 'Running') {
            throw 'Tailscale is not connected yet. Wait a moment and rerun -Action Private.'
        }
        $dnsName = $status.Self.DNSName.TrimEnd('.')
        if ($dnsName -notmatch '^[a-z0-9.-]+\.ts\.net$') { throw 'Tailscale has not assigned a private HTTPS hostname yet.' }
        # Serve is tailnet-only. Do not enable Funnel (public internet exposure).
        Invoke-Compose -Arguments @('exec', '-T', 'tailscale', 'tailscale', 'serve', '--bg', 'http://127.0.0.1:4310')
        $settings = Read-Config; $settings.RELAY_PUBLIC_URL = "https://$dnsName"
        Save-Config -Values $settings; Restart-App
        Write-Host "Private Syncfly URL: https://$dnsName"
        Write-Host 'Install Tailscale on this PC and each tester device, and sign in to your invited network.'
        Write-Host 'If Serve asks you to enable HTTPS, follow its link and rerun this action.'
    }
}
