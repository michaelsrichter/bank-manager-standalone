// Shared data-plane role module (eps-demo-architecture). Invoked once for the
// app's managed identity and once for the developer principal so the two grants
// can never drift.
targetScope = 'resourceGroup'

param principalId string

@allowed(['User', 'ServicePrincipal'])
param principalType string

param foundryAccountName string
param appInsightsName string

// Cognitive Services OpenAI User: call model deployments, no management rights.
var openAiUserRole = subscriptionResourceId(
  'Microsoft.Authorization/roleDefinitions',
  '5e0bd9bd-7b93-4f28-af87-19fc36ad61bd'
)
// Monitoring Metrics Publisher: write-only Entra-authenticated telemetry ingestion.
var metricsPublisherRole = subscriptionResourceId(
  'Microsoft.Authorization/roleDefinitions',
  '3913510d-42f4-4e42-8a64-420c390055eb'
)

resource foundry 'Microsoft.CognitiveServices/accounts@2025-06-01' existing = {
  name: foundryAccountName
}

resource appInsights 'Microsoft.Insights/components@2020-02-02' existing = {
  name: appInsightsName
}

resource openAiUser 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  name: guid(foundry.id, principalId, openAiUserRole)
  scope: foundry
  properties: {
    principalId: principalId
    principalType: principalType
    roleDefinitionId: openAiUserRole
  }
}

resource metricsPublisher 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  name: guid(appInsights.id, principalId, metricsPublisherRole)
  scope: appInsights
  properties: {
    principalId: principalId
    principalType: principalType
    roleDefinitionId: metricsPublisherRole
  }
}
