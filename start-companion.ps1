[CmdletBinding()]
param(
  [string]$ConfigPath,
  [switch]$ValidateOnly
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
Import-Module Microsoft.PowerShell.Utility -ErrorAction Stop

function Get-RequiredConfigString {
  param(
    [hashtable]$Config,
    [string]$Name
  )

  if (-not $Config.ContainsKey($Name)) {
    throw "Missing '$Name' in $ConfigPath."
  }

  $value = [string]$Config[$Name]
  if ([string]::IsNullOrWhiteSpace($value)) {
    throw "'$Name' must be a non-empty string in $ConfigPath."
  }

  return $value
}

function Test-CompanionHost {
  try {
    $response = Invoke-WebRequest -UseBasicParsing -Uri 'http://127.0.0.1:3080/companion/manifest.webmanifest' -TimeoutSec 2
    $content = if ($response.Content -is [byte[]]) {
      [System.Text.Encoding]::UTF8.GetString($response.Content)
    }
    else {
      [string]$response.Content
    }
    $manifest = Microsoft.PowerShell.Utility\ConvertFrom-Json -InputObject $content
    return $response.StatusCode -eq 200 -and $manifest.name -eq 'DSH Companion'
  }
  catch {
    return $false
  }
}

function Test-LoopbackPort {
  $client = [System.Net.Sockets.TcpClient]::new()
  try {
    $client.Connect('127.0.0.1', 3080)
    return $client.Connected
  }
  catch {
    return $false
  }
  finally {
    $client.Dispose()
  }
}

$projectRoot = $PSScriptRoot
if ([string]::IsNullOrWhiteSpace($ConfigPath)) {
  $ConfigPath = Join-Path $projectRoot 'companion.local.psd1'
}
if (-not [System.IO.Path]::IsPathRooted($ConfigPath)) {
  $ConfigPath = Join-Path $projectRoot $ConfigPath
}
$ConfigPath = [System.IO.Path]::GetFullPath($ConfigPath)

if (-not (Test-Path -LiteralPath $ConfigPath -PathType Leaf)) {
  throw "Missing local configuration: $ConfigPath. Copy companion.local.example.psd1 to companion.local.psd1 and update its values."
}

$config = Microsoft.PowerShell.Utility\Import-PowerShellDataFile -LiteralPath $ConfigPath
$configuredHome = Get-RequiredConfigString -Config $config -Name 'DshHome'
$publicOrigin = Get-RequiredConfigString -Config $config -Name 'PublicOrigin'

if ([System.IO.Path]::IsPathRooted($configuredHome)) {
  $dshHome = [System.IO.Path]::GetFullPath($configuredHome)
}
else {
  $dshHome = [System.IO.Path]::GetFullPath((Join-Path $projectRoot $configuredHome))
}

try {
  $originUri = [System.Uri]::new($publicOrigin, [System.UriKind]::Absolute)
}
catch {
  throw "PublicOrigin must be an absolute HTTPS origin: $publicOrigin"
}

if ($originUri.Scheme -cne 'https' -or $originUri.GetLeftPart([System.UriPartial]::Authority) -cne $publicOrigin) {
  throw "PublicOrigin must be one canonical HTTPS origin without a path, query, fragment, or trailing slash: $publicOrigin"
}

$pnpm = Get-Command pnpm -ErrorAction Stop
$env:DSH_HOME = $dshHome
$env:DSH_COMPANION_PUBLIC_ORIGIN = $publicOrigin

Write-Host "DSH_HOME: $dshHome"
Write-Host "Public origin: $publicOrigin"

$previousLocation = Get-Location
try {
  Set-Location -LiteralPath $projectRoot

  if ($ValidateOnly) {
    & $pnpm.Source run verify:harness
    if ($LASTEXITCODE -ne 0) {
      throw "Harness verification failed with exit code $LASTEXITCODE."
    }
    Write-Host 'DSH Companion local configuration is valid.'
    return
  }

  if (Test-CompanionHost) {
    Write-Host 'DSH Companion is already running: http://127.0.0.1:3080/companion/'
    return
  }

  $startMutex = [System.Threading.Mutex]::new($false, 'Local\DSHCompanionHost3080')
  $ownsMutex = $false
  try {
    try {
      $ownsMutex = $startMutex.WaitOne(0)
    }
    catch [System.Threading.AbandonedMutexException] {
      $ownsMutex = $true
    }
    if (-not $ownsMutex) {
      Write-Host 'Another DSH Companion startup is already in progress.'
      return
    }

    if (Test-CompanionHost) {
      Write-Host 'DSH Companion is already running: http://127.0.0.1:3080/companion/'
      return
    }
    if (Test-LoopbackPort) {
      throw 'Port 3080 is not serving DSH Companion. Stop the plain Harness or other service using that port, then run this launcher again. Pairing records in DSH_HOME are preserved.'
    }

    Write-Host 'Starting DSH Companion...'
    & $pnpm.Source host
    if ($LASTEXITCODE -ne 0) {
      throw "DSH Companion exited with code $LASTEXITCODE."
    }
  }
  finally {
    if ($ownsMutex) {
      $startMutex.ReleaseMutex()
    }
    $startMutex.Dispose()
  }
}
finally {
  Set-Location -LiteralPath $previousLocation
}
