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
