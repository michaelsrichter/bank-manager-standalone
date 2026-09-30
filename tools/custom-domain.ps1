<#
.SYNOPSIS
  Bind a custom domain with a free Azure-managed certificate (docs/operations/custom-domain.md).

.DESCRIPTION
  1. Checks public DNS for the CNAME and asuid TXT records.
  2. Phase 1: azd provision adds the hostname and requests the managed certificate.
  3. Waits for the certificate to be issued.
  4. Phase 2: azd provision binds the hostname with SNI.
  5. Verifies https://<domain>/api/health over the custom domain.

.EXAMPLE
  ./tools/custom-domain.ps1 -Domain bankmanager.eps-demos.site
#>
[CmdletBinding()]
param(
    [Parameter(Mandatory)][string]$Domain,
    [int]$CertificateTimeoutMinutes = 30
)
$ErrorActionPreference = 'Stop'

function Get-AzdValue([string]$Name) {
    (azd env get-value $Name 2>$null | Select-Object -First 1)
}

function Resolve-Public([string]$Name, [string]$Type) {
    $answer = (Invoke-RestMethod "https://dns.google/resolve?name=$Name&type=$Type" -TimeoutSec 15).Answer
    @($answer | Where-Object { $_.type -eq @{ CNAME = 5; TXT = 16 }[$Type] } | ForEach-Object { $_.data.Trim('"').TrimEnd('.') })
}

$appHost = ([Uri](Get-AzdValue 'SERVICE_WEB_URL')).Host
$verificationId = Get-AzdValue 'AZURE_CUSTOM_DOMAIN_VERIFICATION_ID'
$resourceGroup = Get-AzdValue 'RESOURCE_GROUP_NAME'
$environment = Get-AzdValue 'AZURE_CONTAINER_ENVIRONMENT_NAME'
if (-not $appHost -or -not $verificationId -or -not $environment) {
    throw 'Run azd provision once first so the app hostname and verification ID are known.'
}

Write-Host "Checking public DNS for $Domain ..."
$cname = Resolve-Public $Domain 'CNAME'
$txt = Resolve-Public "asuid.$Domain" 'TXT'
$ok = $true
if ($cname -notcontains $appHost) {
    Write-Warning "CNAME  $Domain  should point to  $appHost  (found: $($cname -join ', '))"
    $ok = $false
}
if ($txt -notcontains $verificationId) {
    Write-Warning "TXT    asuid.$Domain  should be  $verificationId  (found: $($txt -join ', '))"
    $ok = $false
}
if (-not $ok) { throw 'DNS is not ready yet. Add the records above, wait a few minutes, and re-run.' }
Write-Host 'DNS records found.'

azd env set AZURE_CUSTOM_DOMAIN $Domain | Out-Null

Write-Host 'Phase 1: adding the hostname and requesting the managed certificate ...'
azd provision --no-prompt
if ($LASTEXITCODE -ne 0) { throw 'Phase 1 provision failed.' }

Write-Host 'Waiting for the certificate to be issued (usually 5-20 minutes) ...'
$deadline = (Get-Date).AddMinutes($CertificateTimeoutMinutes)
do {
    $state = az containerapp env certificate list -g $resourceGroup -n $environment `
        --managed-certificates-only `
        --query "[?properties.subjectName=='$Domain'].properties.provisioningState | [0]" -o tsv 2>$null
    Write-Host "  certificate state: $state"
    if ($state -eq 'Succeeded') { break }
    if ($state -eq 'Failed') { throw 'Certificate issuance failed. Check that the CNAME points straight at the app (no proxy) and there is no blocking CAA record.' }
    Start-Sleep -Seconds 30
} while ((Get-Date) -lt $deadline)
if ($state -ne 'Succeeded') { throw "Certificate not issued after $CertificateTimeoutMinutes minutes. Re-run later; it is safe to repeat." }

Write-Host 'Phase 2: binding the hostname with the certificate ...'
azd provision --no-prompt
if ($LASTEXITCODE -ne 0) { throw 'Phase 2 provision failed.' }

Write-Host "Verifying https://$Domain ..."
for ($i = 0; $i -lt 10; $i++) {
    try {
        $health = Invoke-RestMethod "https://$Domain/api/health" -TimeoutSec 90
        Write-Host "https://$Domain is live (health: $($health.status))."
        exit 0
    } catch {
        Start-Sleep -Seconds 15
    }
}
throw "https://$Domain did not respond yet. DNS or the binding may still be propagating; try again in a few minutes."
