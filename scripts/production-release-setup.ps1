# Local Windows operator setup only; no database query, migration or cloud resource creation.
$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest
$repository = Split-Path $PSScriptRoot -Parent
Set-Location $repository
$releaseDirectory = Join-Path $env:LOCALAPPDATA ('QuEMat\phase2-release-' + (Get-Date -Format 'yyyyMMdd-HHmmss'))
if (Test-Path $releaseDirectory) { throw 'Choose a new private release directory.' }
New-Item -ItemType Directory -Path $releaseDirectory | Out-Null
$identity = [Security.Principal.WindowsIdentity]::GetCurrent().Name
icacls $releaseDirectory /inheritance:r /grant:r "${identity}:(OI)(CI)F" | Out-Null
if ($LASTEXITCODE -ne 0) { throw 'Could not restrict the private backup directory. Stop.' }
Write-Host 'Use the verified PRODUCTION Neon project wandering-truth-11355959.'
Write-Host 'Select branch production, database neondb, role neondb_owner, DIRECT connection.'
Write-Host 'The expected host is ep-round-rain-a1orsgna.ap-southeast-1.aws.neon.tech.'
$pgBin = Read-Host 'Full path to the free PostgreSQL 18 bin folder (contains pg_dump.exe and pg_restore.exe)'
if (-not (Test-Path (Join-Path $pgBin 'pg_dump.exe'))) { throw 'pg_dump.exe not found. Install/extract the free PostgreSQL 18 client tools first.' }
if (-not (Test-Path (Join-Path $pgBin 'pg_restore.exe'))) { throw 'pg_restore.exe not found.' }
$secureUrl = Read-Host 'Paste the current PRODUCTION direct connection URL (hidden)' -AsSecureString
$pointer = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secureUrl)
try {
  $directUrl = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($pointer)
  if ($directUrl.Contains("`n") -or $directUrl.Contains("`r")) { throw 'Paste a single connection URL.' }
  $configFile = Join-Path $releaseDirectory '.env.production-release'
  [IO.File]::WriteAllLines($configFile, @(
    'RELEASE_PURPOSE=quemat-phase2-production'
    "DATABASE_URL_UNPOOLED=$directUrl"
    "POSTGRES_BIN=$pgBin"
  ), [Text.UTF8Encoding]::new($false))
} finally {
  [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($pointer)
  Remove-Variable directUrl -ErrorAction SilentlyContinue
  $secureUrl.Dispose()
}
node --import tsx scripts/production-release.ts $configFile preflight | Out-Host
if ($LASTEXITCODE -ne 0) { throw 'Production release preflight failed. No database was changed.' }
Write-Host 'Keep the new backup passphrase separately. Never paste credentials, archives or private logs into chat.'
Write-Output $configFile
