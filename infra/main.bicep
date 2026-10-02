// Subscription-scoped azd entrypoint (eps-demo-architecture): `azd up` builds a
// brand-new environment from scratch, including the resource group.
targetScope = 'subscription'

@minLength(1)
@maxLength(64)
@description('azd environment name — also used to derive resource names.')
param environmentName string

@description('Azure region for all resources. Must offer the Global Standard models in config/models.json.')
param location string

@description('Monthly budget (USD) for the resource group; drives cost alerts (eps-demo-cost-security).')
param monthlyBudgetUsd int = 50

@description('Budget start date (yyyy-MM-dd, first of a month). Set once by infra/hooks/preprovision.*; Azure cannot change it later. Empty means the first of this month.')
param budgetStartDate string = ''

@description('Fallback budget start date. utcNow() is only allowed as a parameter default.')
param budgetStartDefault string = utcNow('yyyy-MM-01')

@description('Email for budget and service-health alerts (set by infra/hooks/preprovision.*, defaults to the deployer).')
param budgetContactEmail string

@description('Partner short name, or "none". Flows into resource tags only, never the public UI (eps-demo-compliance).')
param partnerName string = 'none'

@description('Object ID of the developer who deploys; receives the same data-plane roles as the app identity.')
param principalId string = ''

@allowed(['User', 'ServicePrincipal'])
param principalType string = 'User'

@description('Grant the developer principal the same data-plane roles as the app (disable for hardened/CI environments).')
param grantDeveloperAccess bool = true

@description('Temporary operator IPv4 addresses/CIDRs allowed to reach Foundry over the public endpoint. Empty = private only.')
param allowedIpRules array = []

@description('Container image for the web service. azd sets SERVICE_WEB_IMAGE_NAME after the first deploy.')
param webImageName string = ''

@description('Optional custom hostname (e.g. bankmanager.example.com). See docs/operations/custom-domain.md.')
param customDomainName string = ''

@description('Set by infra/hooks/preprovision.* once the managed certificate is issued.')
param customDomainCertificateReady bool = false

@description('SHA-256 (hex) of the presenter key that may start Foundry evaluation runs from the site. Set by tools/set-presenter-key.ps1; the key itself is never stored.')
param evaluationsPresenterKeySha256 string = ''

@description('Turn on Foundry Evaluations. Needs the Foundry account to accept public (Entra-only) traffic; see docs/adr/0014-foundry-public-endpoint-for-evaluations.md.')
param evaluationsEnabled bool = true

@description('Keep one replica running on weekdays, 8 AM to 8 PM US Eastern, so visitors do not wait for a cold start. About USD 3/month. Outside those hours the app still scales to zero. See docs/adr/0015-weekday-warm-hours.md.')
param warmHoursEnabled bool = true

var ownerAlias = split(budgetContactEmail, '@')[0]

var tags = {
  'azd-env-name': environmentName
  demo: 'true'
  owner: ownerAlias
  partner: partnerName
  'cost-center': 'eps-ai-demos'
}

resource rg 'Microsoft.Resources/resourceGroups@2024-11-01' = {
  name: 'rg-${environmentName}'
  location: location
  tags: tags
}

module resources 'resources.bicep' = {
  name: 'resources'
  scope: rg
  params: {
    location: location
    tags: tags
    monthlyBudgetUsd: monthlyBudgetUsd
    budgetStartDate: empty(budgetStartDate) ? budgetStartDefault : budgetStartDate
    budgetContactEmail: budgetContactEmail
    principalId: principalId
    principalType: principalType
    grantDeveloperAccess: grantDeveloperAccess
    allowedIpRules: allowedIpRules
    webImageName: webImageName
    customDomainName: customDomainName
    customDomainCertificateReady: customDomainCertificateReady
    evaluationsPresenterKeySha256: evaluationsPresenterKeySha256
    evaluationsEnabled: evaluationsEnabled
    warmHoursEnabled: warmHoursEnabled
  }
}

output RESOURCE_GROUP_NAME string = rg.name
output AZURE_LOCATION string = location
output AZURE_CONTAINER_REGISTRY_ENDPOINT string = resources.outputs.containerRegistryLoginServer
output AZURE_CONTAINER_APP_NAME string = resources.outputs.containerAppName
output AZURE_AI_ENDPOINT string = resources.outputs.foundryEndpoint
output AZURE_AI_ACCOUNT_NAME string = resources.outputs.foundryAccountName
output SERVICE_WEB_URL string = resources.outputs.webUrl
output AZURE_CONTAINER_ENVIRONMENT_NAME string = resources.outputs.containerEnvironmentName
output AZURE_CUSTOM_DOMAIN_VERIFICATION_ID string = resources.outputs.customDomainVerificationId
output CUSTOM_DOMAIN_URL string = resources.outputs.customDomainUrl
output APPLICATIONINSIGHTS_CONNECTION_STRING string = resources.outputs.appInsightsConnectionString
output LOG_ANALYTICS_WORKSPACE_ID string = resources.outputs.logAnalyticsWorkspaceId
output AZURE_TELEMETRY_WORKBOOK_URL string = resources.outputs.workbookUrl
output AZURE_ANSWER_REVIEW_WORKBOOK_ID string = resources.outputs.answerReviewWorkbookId
output AZURE_ANSWER_REVIEW_WORKBOOK_URL string = resources.outputs.answerReviewWorkbookUrl
output APPLICATIONINSIGHTS_RESOURCE_ID string = resources.outputs.appInsightsResourceId
output AZURE_TENANT_ID string = tenant().tenantId
output FOUNDRY_PROJECT_ENDPOINT string = resources.outputs.foundryProjectEndpoint
output FOUNDRY_PROJECT_RESOURCE_ID string = resources.outputs.foundryProjectId
output AZURE_TELEMETRY_DASHBOARD_URL string = resources.outputs.dashboardUrl
