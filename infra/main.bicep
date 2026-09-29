targetScope = 'resourceGroup'

@description('Azure region for Container Apps and Azure Container Registry.')
param location string = 'eastus2'

@description('Azure region for the Container Apps environment and application.')
param containerAppsLocation string = location

@description('Short workload name used in resource names.')
@minLength(3)
@maxLength(20)
param workloadName string = 'bankmanager'

@description('Deploy the Container App after the Linux image has been built.')
param deployApp bool = false

@description('Immutable ACR image reference including its sha256 digest.')
param imageReference string = ''

@description('Existing Log Analytics workspace reused by Container Apps.')
param logAnalyticsWorkspaceName string

@description('Existing Application Insights component reused by the application.')
param applicationInsightsName string

@description('Microsoft Foundry project endpoint consumed by the application.')
param foundryProjectEndpoint string

@description('Microsoft Foundry model deployment name.')
param foundryModelName string = 'gpt-4.1'

@description('Tags applied to resources that support tags.')
param tags object = {
  workload: 'bank-manager'
  environment: 'demo'
  managedBy: 'bicep'
}

var token = uniqueString(subscription().id, resourceGroup().id)
var compactWorkloadName = replace(toLower(workloadName), '-', '')
var containerRegistryName = take('cr${compactWorkloadName}${token}', 50)
var compactContainerAppsLocation = replace(toLower(containerAppsLocation), ' ', '')
var containerAppsEnvironmentName = take('cae-${workloadName}-${compactContainerAppsLocation}-${token}', 60)
var containerAppName = take('ca-${workloadName}-${token}', 32)
var runtimeIdentityName = take('id-${workloadName}-${token}', 128)
var acrPullRoleDefinitionId = subscriptionResourceId(
  'Microsoft.Authorization/roleDefinitions',
  '7f951dda-4ed3-4680-a7ca-43fe172d538d'
)

resource logAnalyticsWorkspace 'Microsoft.OperationalInsights/workspaces@2023-09-01' existing = {
  name: logAnalyticsWorkspaceName
}

resource applicationInsights 'Microsoft.Insights/components@2020-02-02' existing = {
  name: applicationInsightsName
}

resource runtimeIdentity 'Microsoft.ManagedIdentity/userAssignedIdentities@2023-01-31' = {
  name: runtimeIdentityName
  location: location
  tags: tags
}

resource containerRegistry 'Microsoft.ContainerRegistry/registries@2023-07-01' = {
  name: containerRegistryName
  location: location
  sku: {
    name: 'Basic'
  }
  tags: tags
  properties: {
    adminUserEnabled: false
    dataEndpointEnabled: false
    networkRuleBypassOptions: 'AzureServices'
    policies: {
      exportPolicy: {
        status: 'enabled'
      }
      quarantinePolicy: {
        status: 'disabled'
      }
      retentionPolicy: {
        days: 7
        status: 'disabled'
      }
      trustPolicy: {
        status: 'disabled'
        type: 'Notary'
      }
    }
    publicNetworkAccess: 'Enabled'
    zoneRedundancy: 'Disabled'
  }
}

resource acrPullRoleAssignment 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  name: guid(containerRegistry.id, runtimeIdentity.id, acrPullRoleDefinitionId)
  scope: containerRegistry
  properties: {
    principalId: runtimeIdentity.properties.principalId
    principalType: 'ServicePrincipal'
    roleDefinitionId: acrPullRoleDefinitionId
  }
}

resource containerAppsEnvironment 'Microsoft.App/managedEnvironments@2024-03-01' = {
  name: containerAppsEnvironmentName
  location: containerAppsLocation
  tags: tags
  properties: {
    appLogsConfiguration: {
      destination: 'log-analytics'
      logAnalyticsConfiguration: {
        customerId: logAnalyticsWorkspace.properties.customerId
        sharedKey: logAnalyticsWorkspace.listKeys().primarySharedKey
      }
    }
    zoneRedundant: false
  }
}

resource containerApp 'Microsoft.App/containerApps@2024-03-01' = if (deployApp) {
  name: containerAppName
  location: containerAppsLocation
  identity: {
    type: 'UserAssigned'
    userAssignedIdentities: {
      '${runtimeIdentity.id}': {}
    }
  }
  tags: tags
  properties: {
    environmentId: containerAppsEnvironment.id
    configuration: {
      activeRevisionsMode: 'Single'
      ingress: {
        allowInsecure: false
        external: true
        targetPort: 8501
        traffic: [
          {
            latestRevision: true
            weight: 100
          }
        ]
        transport: 'auto'
      }
      registries: [
        {
          identity: runtimeIdentity.id
          server: containerRegistry.properties.loginServer
        }
      ]
    }
    template: {
      containers: [
        {
          name: 'bank-manager'
          image: imageReference
          env: [
            {
              name: 'APPLICATIONINSIGHTS_CONNECTION_STRING'
              value: applicationInsights.properties.ConnectionString
            }
            {
              name: 'AZURE_CLIENT_ID'
              value: runtimeIdentity.properties.clientId
            }
            {
              name: 'AZURE_HOSTED'
              value: '1'
            }
            {
              name: 'FOUNDRY_MODEL_NAME'
              value: foundryModelName
            }
            {
              name: 'FOUNDRY_PROJECT_ENDPOINT'
              value: foundryProjectEndpoint
            }
          ]
          probes: [
            {
              type: 'Startup'
              httpGet: {
                path: '/_stcore/health'
                port: 8501
                scheme: 'HTTP'
              }
              failureThreshold: 30
              periodSeconds: 10
              timeoutSeconds: 5
            }
            {
              type: 'Readiness'
              httpGet: {
                path: '/_stcore/health'
                port: 8501
                scheme: 'HTTP'
              }
              failureThreshold: 3
              periodSeconds: 10
              successThreshold: 1
              timeoutSeconds: 5
            }
            {
              type: 'Liveness'
              httpGet: {
                path: '/_stcore/health'
                port: 8501
                scheme: 'HTTP'
              }
              failureThreshold: 3
              initialDelaySeconds: 30
              periodSeconds: 30
              timeoutSeconds: 5
            }
          ]
          resources: {
            cpu: json('0.5')
            memory: '1Gi'
          }
        }
      ]
      scale: {
        maxReplicas: 1
        minReplicas: 1
      }
    }
  }
  dependsOn: [
    acrPullRoleAssignment
  ]
}

output applicationInsightsName string = applicationInsights.name
output containerAppFqdn string = deployApp ? containerApp!.properties.configuration.ingress.fqdn : ''
output containerAppName string = containerAppName
output containerAppsEnvironmentName string = containerAppsEnvironment.name
output containerRegistryLoginServer string = containerRegistry.properties.loginServer
output containerRegistryName string = containerRegistry.name
output imageReference string = deployApp ? imageReference : ''
output runtimeIdentityClientId string = runtimeIdentity.properties.clientId
output runtimeIdentityName string = runtimeIdentity.name
output runtimeIdentityPrincipalId string = runtimeIdentity.properties.principalId
