# azd preprovision hook — derives values that must never be hardcoded per
# architect (eps-demo-architecture: grant the signed-in developer the same
# RBAC as the app identity; eps-demo-cost-security: budget alerts need a real
# contact). Run automatically by `azd up` / `azd provision`.
$ErrorActionPreference = "Stop"

az account show | Out-Null
if ($LASTEXITCODE -ne 0) {
    Write-Error "Not logged into Azure CLI. Run 'az login' first."
    exit 1
}

if (-not $env:AZURE_PRINCIPAL_ID) {
    $principalId = az ad signed-in-user show --query id -o tsv
    azd env set AZURE_PRINCIPAL_ID $principalId
}

if (-not $env:AZURE_BUDGET_EMAIL) {
    $budgetEmail = az account show --query user.name -o tsv
    azd env set AZURE_BUDGET_EMAIL $budgetEmail
}

# Azure cannot change a budget's start date, so pick it once and keep it. Reuse the
# existing budget's date when there is one, otherwise the first day of this month (UTC).
if (-not $env:AZURE_BUDGET_START_DATE) {
    $start = $null
    if ($env:RESOURCE_GROUP_NAME) {
        $start = az consumption budget show -g $env:RESOURCE_GROUP_NAME `
            --budget-name "budget-$($env:RESOURCE_GROUP_NAME)" --query timePeriod.startDate -o tsv 2>$null
    }
    $start = if ($start) { $start.Substring(0, 10) } else { (Get-Date).ToUniversalTime().ToString("yyyy-MM-01") }
    azd env set AZURE_BUDGET_START_DATE $start
}

# Custom domain, phase 2 (docs/operations/custom-domain.md): once the free managed
# certificate has been issued, bind the hostname with SNI on this provision.
$domain = $env:AZURE_CUSTOM_DOMAIN
$ready = "false"
if ($domain -and $env:RESOURCE_GROUP_NAME -and $env:AZURE_CONTAINER_ENVIRONMENT_NAME) {
    $count = az containerapp env certificate list `
        -g $env:RESOURCE_GROUP_NAME -n $env:AZURE_CONTAINER_ENVIRONMENT_NAME `
        --managed-certificates-only `
        --query "length([?properties.subjectName=='$domain' && properties.provisioningState=='Succeeded'])" `
        -o tsv 2>$null
    if ($count -and [int]$count -gt 0) { $ready = "true" }
}
if ($env:AZURE_CUSTOM_DOMAIN_CERT_READY -ne $ready) {
    azd env set AZURE_CUSTOM_DOMAIN_CERT_READY $ready
}
if ($domain) {
    $phase = if ($ready -eq "true") { "binding with the issued certificate" } else { "adding hostname and requesting a certificate" }
    Write-Host "Custom domain ${domain}: $phase"
}
