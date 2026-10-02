using 'main.bicep'

// AZURE_ENV_NAME / AZURE_LOCATION are set by azd. AZURE_BUDGET_EMAIL and
// AZURE_PRINCIPAL_ID are derived by infra/hooks/preprovision.* when unset.
param environmentName = readEnvironmentVariable('AZURE_ENV_NAME')
param location = readEnvironmentVariable('AZURE_LOCATION')
param budgetContactEmail = readEnvironmentVariable('AZURE_BUDGET_EMAIL')
param principalId = readEnvironmentVariable('AZURE_PRINCIPAL_ID', '')
param principalType = readEnvironmentVariable('AZURE_PRINCIPAL_TYPE', 'User')
param grantDeveloperAccess = toLower(readEnvironmentVariable('AZURE_GRANT_DEVELOPER_ACCESS', 'true')) == 'true'
param monthlyBudgetUsd = int(readEnvironmentVariable('AZURE_MONTHLY_BUDGET_USD', '50'))
// Set once by infra/hooks/preprovision.*; Azure cannot change a budget's start date.
param budgetStartDate = readEnvironmentVariable('AZURE_BUDGET_START_DATE', '')
// Comma-separated, e.g. "203.0.113.10". Temporary operator access only; see docs/security/threat-model.md.
param allowedIpRules = empty(readEnvironmentVariable('AZURE_ALLOWED_IPS', ''))
  ? []
  : split(readEnvironmentVariable('AZURE_ALLOWED_IPS', ''), ',')
param webImageName = readEnvironmentVariable('SERVICE_WEB_IMAGE_NAME', '')
// Custom domain: set AZURE_CUSTOM_DOMAIN (docs/operations/custom-domain.md). The preprovision
// hook sets AZURE_CUSTOM_DOMAIN_CERT_READY once the managed certificate has been issued.
param customDomainName = readEnvironmentVariable('AZURE_CUSTOM_DOMAIN', '')
param customDomainCertificateReady = toLower(readEnvironmentVariable('AZURE_CUSTOM_DOMAIN_CERT_READY', 'false')) == 'true'
// Presenter key hash for starting evaluation runs (docs/evaluations/README.md). Empty disables starting runs.
param evaluationsPresenterKeySha256 = readEnvironmentVariable('EVALUATIONS_PRESENTER_KEY_SHA256', '')
// Foundry Evaluations on/off (docs/adr/0014-foundry-public-endpoint-for-evaluations.md).
param evaluationsEnabled = toLower(readEnvironmentVariable('EVALUATIONS_ENABLED', 'true')) != 'false'
// Keep one replica warm on weekdays, 8 AM–8 PM US Eastern (docs/adr/0015-weekday-warm-hours.md).
param warmHoursEnabled = toLower(readEnvironmentVariable('WARM_HOURS_ENABLED', 'true')) != 'false'
