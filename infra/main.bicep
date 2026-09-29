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
    budgetContactEmail: budgetContactEmail
    principalId: principalId
    principalType: principalType
    grantDeveloperAccess: grantDeveloperAccess
    allowedIpRules: allowedIpRules
    webImageName: webImageName
  }
}

output RESOURCE_GROUP_NAME string = rg.name
output AZURE_LOCATION string = location
output AZURE_CONTAINER_REGISTRY_ENDPOINT string = resources.outputs.containerRegistryLoginServer
output AZURE_CONTAINER_APP_NAME string = resources.outputs.containerAppName
output AZURE_AI_ENDPOINT string = resources.outputs.foundryEndpoint
output AZURE_AI_ACCOUNT_NAME string = resources.outputs.foundryAccountName
output SERVICE_WEB_URL string = resources.outputs.webUrl
output APPLICATIONINSIGHTS_CONNECTION_STRING string = resources.outputs.appInsightsConnectionString
output LOG_ANALYTICS_WORKSPACE_ID string = resources.outputs.logAnalyticsWorkspaceId
output AZURE_TELEMETRY_WORKBOOK_URL string = resources.outputs.workbookUrl
output AZURE_TELEMETRY_DASHBOARD_URL string = resources.outputs.dashboardUrl
