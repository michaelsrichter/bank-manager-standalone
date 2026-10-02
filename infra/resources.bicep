// Resource-group-scoped resources for the governed bank-manager demo.
// See docs/architecture/azure-services.md for why each service is used.
targetScope = 'resourceGroup'

param location string
param tags object
param monthlyBudgetUsd int
param budgetContactEmail string
param principalId string
@allowed(['User', 'ServicePrincipal'])
param principalType string
param grantDeveloperAccess bool
param allowedIpRules array
param webImageName string

@description('Optional custom hostname, e.g. bankmanager.example.com. Needs the CNAME and asuid TXT DNS records first; see docs/operations/custom-domain.md.')
param customDomainName string = ''

@description('True once the free managed certificate for customDomainName has been issued (set by infra/hooks/preprovision.*).')
param customDomainCertificateReady bool = false

@description('Budget start (first of month). Passed from main.bicep, which keeps it stable across deploys.')
param budgetStartDate string

@description('SHA-256 (hex) of the presenter key that may start Foundry evaluation runs. Empty disables starting runs from the site. The key itself is never stored.')
param evaluationsPresenterKeySha256 string = ''

@description('Turn on Foundry Evaluations. Foundry grades runs from its own service, which needs the Foundry account to accept public (Entra-only) traffic. Set false to keep the account private-endpoint only; see docs/adr/0014-foundry-public-endpoint-for-evaluations.md.')
param evaluationsEnabled bool = true

// Single source of truth for models: the same file the backend reads.
var modelCatalog = loadJsonContent('../config/models.json')
var modelOptions = modelCatalog.roles.intent.options

var token = uniqueString(subscription().id, resourceGroup().id)
var placeholderImage = 'mcr.microsoft.com/k8se/quickstart:latest'
var image = empty(webImageName) ? placeholderImage : webImageName
var foundryName = 'ais-bank-${token}'
// The Foundry project used for tracing and evaluations (created in modules/observability.bicep).
var foundryProjectName = 'bank-manager'

// ------------------------------------------------------------------ Budget
resource budget 'Microsoft.Consumption/budgets@2023-05-01' = {
  name: 'budget-${resourceGroup().name}'
  properties: {
    category: 'Cost'
    amount: monthlyBudgetUsd
    timeGrain: 'Monthly'
    timePeriod: { startDate: budgetStartDate }
    notifications: {
      actual_80pct: {
        enabled: true
        operator: 'GreaterThan'
        threshold: 80
        thresholdType: 'Actual'
        contactEmails: [budgetContactEmail]
      }
      forecasted_100pct: {
        enabled: true
        operator: 'GreaterThan'
        threshold: 100
        thresholdType: 'Forecasted'
        contactEmails: [budgetContactEmail]
      }
    }
  }
}

// ------------------------------------------------------------ Observability
// Workbook names are deterministic GUIDs (see modules/observability.bicep), so the
// container app can link to them without a module dependency cycle.
var overviewWorkbookId = resourceId('Microsoft.Insights/workbooks', guid(resourceGroup().id, 'bank-manager-telemetry-workbook'))
var answerReviewWorkbookId = resourceId('Microsoft.Insights/workbooks', guid(resourceGroup().id, 'bank-manager-answer-review-workbook'))

resource logAnalytics 'Microsoft.OperationalInsights/workspaces@2023-09-01' = {
  name: 'log-${token}'
  location: location
  tags: tags
  properties: {
    sku: { name: 'PerGB2018' }
    retentionInDays: 30
    workspaceCapping: { dailyQuotaGb: 1 }
  }
}

resource appInsights 'Microsoft.Insights/components@2020-02-02' = {
  name: 'appi-${token}'
  location: location
  kind: 'web'
  tags: tags
  properties: {
    Application_Type: 'web'
    WorkspaceResourceId: logAnalytics.id
    // Entra-only ingestion: the app's managed identity needs Monitoring Metrics Publisher.
    DisableLocalAuth: true
    RetentionInDays: 30
  }
}

// ------------------------------------------------------------------ Network
resource vnet 'Microsoft.Network/virtualNetworks@2024-05-01' = {
  name: 'vnet-${token}'
  location: location
  tags: tags
  properties: {
    addressSpace: { addressPrefixes: ['10.40.0.0/16'] }
    subnets: [
      {
        name: 'snet-aca'
        properties: {
          addressPrefix: '10.40.0.0/23'
          delegations: [
            {
              name: 'aca'
              properties: { serviceName: 'Microsoft.App/environments' }
            }
          ]
        }
      }
      {
        name: 'snet-pe'
        properties: {
          addressPrefix: '10.40.2.0/27'
          privateEndpointNetworkPolicies: 'Disabled'
        }
      }
    ]
  }
}

// ------------------------------------------------------------ AI Foundry
resource foundry 'Microsoft.CognitiveServices/accounts@2025-06-01' = {
  name: foundryName
  location: location
  tags: tags
  kind: 'AIServices'
  sku: { name: 'S0' }
  identity: { type: 'SystemAssigned' }
  properties: {
    customSubDomainName: foundryName
    // Foundry projects enable the Foundry portal tracing view (connected to App Insights below).
    allowProjectManagement: true
    // No API keys: Microsoft Entra ID only.
    disableLocalAuth: true
    // Foundry's cloud evaluation service reaches the account over its public endpoint
    // unless the account uses network injection, which cannot be added to an existing
    // account. With evaluations on, the endpoint accepts public traffic, still Entra-only.
    // The app itself keeps using the private endpoint. See ADR 0014.
    publicNetworkAccess: (evaluationsEnabled || !empty(allowedIpRules)) ? 'Enabled' : 'Disabled'
    networkAcls: {
      defaultAction: evaluationsEnabled ? 'Allow' : 'Deny'
      bypass: 'AzureServices'
      ipRules: [for ip in allowedIpRules: { value: trim(ip) }]
    }
  }
}

@batchSize(1)
resource deployments 'Microsoft.CognitiveServices/accounts/deployments@2025-06-01' = [
  for option in modelOptions: {
    parent: foundry
    name: option.deployment
    sku: {
      name: option.sku
      capacity: option.capacityThousandsTpm
    }
    properties: {
      model: {
        format: option.format
        name: option.model
        version: option.version
      }
      // Platform default content filters stay on (eps-demo-ai-models).
      raiPolicyName: 'Microsoft.DefaultV2'
      versionUpgradeOption: 'OnceNewDefaultVersionAvailable'
    }
  }
]

var privateDnsZones = [
  'privatelink.cognitiveservices.azure.com'
  'privatelink.openai.azure.com'
  'privatelink.services.ai.azure.com'
]

resource dnsZones 'Microsoft.Network/privateDnsZones@2024-06-01' = [
  for zone in privateDnsZones: {
    name: zone
    location: 'global'
    tags: tags
  }
]

resource dnsLinks 'Microsoft.Network/privateDnsZones/virtualNetworkLinks@2024-06-01' = [
  for (zone, i) in privateDnsZones: {
    parent: dnsZones[i]
    name: 'link-${token}'
    location: 'global'
    tags: tags
    properties: {
      registrationEnabled: false
      virtualNetwork: { id: vnet.id }
    }
  }
]

resource foundryPrivateEndpoint 'Microsoft.Network/privateEndpoints@2024-05-01' = {
  name: 'pe-${foundryName}'
  location: location
  tags: tags
  properties: {
    subnet: { id: vnet.properties.subnets[1].id }
    privateLinkServiceConnections: [
      {
        name: 'foundry'
        properties: {
          privateLinkServiceId: foundry.id
          groupIds: ['account']
        }
      }
    ]
  }
  // The account must finish provisioning before a private endpoint can attach.
  dependsOn: [deployments]
}

resource foundryDnsGroup 'Microsoft.Network/privateEndpoints/privateDnsZoneGroups@2024-05-01' = {
  parent: foundryPrivateEndpoint
  name: 'default'
  properties: {
    privateDnsZoneConfigs: [
      for (zone, i) in privateDnsZones: {
        name: replace(zone, '.', '-')
        properties: { privateDnsZoneId: dnsZones[i].id }
      }
    ]
  }
}

// --------------------------------------------------------- Identity + ACR
resource appIdentity 'Microsoft.ManagedIdentity/userAssignedIdentities@2023-01-31' = {
  name: 'id-web-${token}'
  location: location
  tags: tags
}

resource registry 'Microsoft.ContainerRegistry/registries@2025-04-01' = {
  name: 'crbank${token}'
  location: location
  tags: tags
  sku: { name: 'Basic' }
  properties: {
    adminUserEnabled: false
    anonymousPullEnabled: false
    publicNetworkAccess: 'Enabled'
  }
}

var acrPullRole = subscriptionResourceId(
  'Microsoft.Authorization/roleDefinitions',
  '7f951dda-4ed3-4680-a7ca-43fe172d538d'
)

resource acrPull 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  name: guid(registry.id, appIdentity.id, acrPullRole)
  scope: registry
  properties: {
    principalId: appIdentity.properties.principalId
    principalType: 'ServicePrincipal'
    roleDefinitionId: acrPullRole
  }
}

module appRoles 'modules/data-plane-roles.bicep' = {
  name: 'app-data-plane-roles'
  params: {
    principalId: appIdentity.properties.principalId
    principalType: 'ServicePrincipal'
    foundryAccountName: foundry.name
    appInsightsName: appInsights.name
  }
}

module developerRoles 'modules/data-plane-roles.bicep' = if (grantDeveloperAccess && !empty(principalId)) {
  name: 'developer-data-plane-roles'
  params: {
    principalId: principalId
    principalType: principalType
    foundryAccountName: foundry.name
    appInsightsName: appInsights.name
  }
}

// --------------------------------------------------------- Container Apps
resource containerEnv 'Microsoft.App/managedEnvironments@2025-01-01' = {
  name: 'cae-${token}'
  location: location
  tags: tags
  properties: {
    appLogsConfiguration: { destination: 'azure-monitor' }
    vnetConfiguration: {
      infrastructureSubnetId: vnet.properties.subnets[0].id
      internal: false
    }
    workloadProfiles: [
      {
        name: 'Consumption'
        workloadProfileType: 'Consumption'
      }
    ]
    zoneRedundant: false
  }
}

// Free Azure-managed TLS certificate for the custom domain (auto-renewed).
var managedCertificateName = take('mc-${replace(customDomainName, '.', '-')}', 60)
var managedCertificateId = '${containerEnv.id}/managedCertificates/${managedCertificateName}'

resource managedCertificate 'Microsoft.App/managedEnvironments/managedCertificates@2025-01-01' = if (!empty(customDomainName)) {
  parent: containerEnv
  name: managedCertificateName
  location: location
  tags: tags
  properties: {
    subjectName: customDomainName
    // Proves control of the name through the CNAME that points at the app.
    domainControlValidation: 'CNAME'
  }
  // The hostname must already be on the app (phase 1) before issuance.
  dependsOn: [web]
}

resource containerEnvDiagnostics 'Microsoft.Insights/diagnosticSettings@2021-05-01-preview' = {
  name: 'to-log-analytics'
  scope: containerEnv
  properties: {
    workspaceId: logAnalytics.id
    // ContainerAppHTTPLogs is deliberately NOT exported: it records client IPs and
    // user agents (eps-demo-compliance: no PII). App Insights masks client IPs.
    logs: [
      { category: 'ContainerAppConsoleLogs', enabled: true }
      { category: 'ContainerAppSystemLogs', enabled: true }
    ]
    metrics: [{ category: 'AllMetrics', enabled: true }]
  }
}

resource web 'Microsoft.App/containerApps@2025-01-01' = {
  name: 'ca-bank-${token}'
  location: location
  tags: union(tags, { 'azd-service-name': 'web' })
  identity: {
    type: 'UserAssigned'
    userAssignedIdentities: { '${appIdentity.id}': {} }
  }
  properties: {
    environmentId: containerEnv.id
    workloadProfileName: 'Consumption'
    configuration: {
      activeRevisionsMode: 'Single'
      ingress: {
        external: true
        targetPort: 8000
        transport: 'auto'
        allowInsecure: false
        // Custom domain (docs/operations/custom-domain.md). Two phases, because the
        // free managed certificate can only be issued once the hostname is on the app:
        // 1) hostname added with bindingType Disabled + certificate requested;
        // 2) once the certificate is issued, bound with SNI.
        customDomains: empty(customDomainName)
          ? []
          : [
              customDomainCertificateReady
                ? {
                    name: customDomainName
                    bindingType: 'SniEnabled'
                    certificateId: managedCertificateId
                  }
                : {
                    name: customDomainName
                    bindingType: 'Disabled'
                  }
            ]
      }
      registries: [
        {
          server: registry.properties.loginServer
          identity: appIdentity.id
        }
      ]
    }
    template: {
      containers: [
        {
          name: 'web'
          image: image
          resources: {
            cpu: json('0.5')
            memory: '1Gi'
          }
          env: [
            { name: 'AZURE_CLIENT_ID', value: appIdentity.properties.clientId }
            { name: 'AZURE_AI_ENDPOINT', value: 'https://${foundryName}.openai.azure.com/' }
            { name: 'APPLICATIONINSIGHTS_CONNECTION_STRING', value: appInsights.properties.ConnectionString }
            { name: 'OTEL_SERVICE_NAME', value: 'bank-manager-web' }
            {
              name: 'OTEL_RESOURCE_ATTRIBUTES'
              value: 'service.namespace=bank-manager-demo,deployment.environment=${tags['azd-env-name']},gen_ai.agent.name=bank-manager'
            }
            // Never export prompt/response content in GenAI telemetry.
            { name: 'OTEL_INSTRUMENTATION_GENAI_CAPTURE_MESSAGE_CONTENT', value: 'false' }
            { name: 'DEPLOYMENT_ENVIRONMENT', value: 'demo' }
            // Public resource IDs (not secrets) for the "IDs and observability links" panel.
            { name: 'PORTAL_ORIGIN', value: environment().portal }
            { name: 'PORTAL_TENANT_ID', value: tenant().tenantId }
            { name: 'APPINSIGHTS_RESOURCE_ID', value: appInsights.id }
            { name: 'ANSWER_REVIEW_WORKBOOK_ID', value: answerReviewWorkbookId }
            { name: 'OVERVIEW_WORKBOOK_ID', value: overviewWorkbookId }
            // Foundry Evaluations (docs/evaluations/README.md). Public endpoint and resource ID, not secrets.
            { name: 'EVALUATIONS_ENABLED', value: evaluationsEnabled ? '1' : '0' }
            { name: 'FOUNDRY_PROJECT_ENDPOINT', value: 'https://${foundryName}.services.ai.azure.com/api/projects/${foundryProjectName}' }
            { name: 'FOUNDRY_PROJECT_RESOURCE_ID', value: '${foundry.id}/projects/${foundryProjectName}' }
            { name: 'EVALUATIONS_PRESENTER_KEY_SHA256', value: evaluationsPresenterKeySha256 }
          ]
          probes: [
            {
              type: 'Liveness'
              httpGet: { path: '/api/health/live', port: 8000 }
              initialDelaySeconds: 10
              periodSeconds: 30
            }
            {
              type: 'Readiness'
              httpGet: { path: '/api/health/live', port: 8000 }
              initialDelaySeconds: 3
              periodSeconds: 10
            }
          ]
        }
      ]
      scale: {
        // Scale to zero when idle (eps-demo-cost-security).
        minReplicas: 0
        maxReplicas: 2
        rules: [
          {
            name: 'http'
            http: { metadata: { concurrentRequests: '20' } }
          }
        ]
      }
    }
  }
  dependsOn: [
    acrPull
    appRoles
    foundryDnsGroup
    dnsLinks
  ]
}

// ------------------------------------------------------ Service-health alerts
// Separate from the budget (eps-demo-cost-security). Alerts only on sustained
// 5xx responses, never on expected 4xx/429 security responses.
resource actionGroup 'Microsoft.Insights/actionGroups@2023-01-01' = {
  name: 'ag-bank-${token}'
  location: 'global'
  tags: tags
  properties: {
    groupShortName: 'bankdemo'
    enabled: true
    emailReceivers: [
      {
        name: 'owner'
        emailAddress: budgetContactEmail
        useCommonAlertSchema: true
      }
    ]
  }
}

resource serverErrorsAlert 'Microsoft.Insights/metricAlerts@2018-03-01' = {
  name: 'alert-5xx-${token}'
  location: 'global'
  tags: tags
  properties: {
    description: 'More than 5 HTTP 5xx responses in 15 minutes from the web app.'
    severity: 2
    enabled: true
    scopes: [web.id]
    evaluationFrequency: 'PT5M'
    windowSize: 'PT15M'
    autoMitigate: true
    criteria: {
      'odata.type': 'Microsoft.Azure.Monitor.SingleResourceMultipleMetricCriteria'
      allOf: [
        {
          criterionType: 'StaticThresholdCriterion'
          name: 'sustained-5xx'
          metricNamespace: 'Microsoft.App/containerApps'
          metricName: 'Requests'
          dimensions: [
            {
              name: 'statusCodeCategory'
              operator: 'Include'
              values: ['5xx']
            }
          ]
          operator: 'GreaterThan'
          threshold: 5
          timeAggregation: 'Total'
        }
      ]
    }
    actions: [{ actionGroupId: actionGroup.id }]
  }
}

// The workspace has a daily cap (above). When it is reached, ingestion stops
// until the next UTC day, so tell the owner (eps-demo-observability).
resource dailyCapAlert 'Microsoft.Insights/scheduledQueryRules@2023-12-01' = {
  name: 'alert-log-cap-${token}'
  location: location
  tags: tags
  properties: {
    displayName: 'Log Analytics daily cap reached (${logAnalytics.name})'
    description: 'Telemetry ingestion stopped because the 1 GB daily cap was reached. Data resumes at the next UTC day.'
    severity: 3
    enabled: true
    scopes: [logAnalytics.id]
    evaluationFrequency: 'PT1H'
    windowSize: 'PT1H'
    autoMitigate: false
    criteria: {
      allOf: [
        {
          query: '_LogOperation | where Category =~ "Ingestion" | where Detail has "OverQuota"'
          timeAggregation: 'Count'
          operator: 'GreaterThan'
          threshold: 0
          failingPeriods: { numberOfEvaluationPeriods: 1, minFailingPeriodsToAlert: 1 }
        }
      ]
    }
    actions: { actionGroups: [actionGroup.id] }
  }
}

module observability 'modules/observability.bicep' = {
  name: 'observability'
  params: {
    location: location
    tags: tags
    logAnalyticsName: logAnalytics.name
    appInsightsName: appInsights.name
    foundryAccountName: foundry.name
    registryName: registry.name
    containerAppName: web.name
    environmentName: tags['azd-env-name']
    projectName: foundryProjectName
  }
  dependsOn: [deployments, foundryDnsGroup]
}

module evaluationRoles 'modules/evaluations-roles.bicep' = if (evaluationsEnabled) {
  name: 'evaluations-roles'
  params: {
    foundryAccountName: foundry.name
    projectName: observability.outputs.foundryProjectName
    appPrincipalId: appIdentity.properties.principalId
    developerPrincipalId: grantDeveloperAccess ? principalId : ''
    developerPrincipalType: principalType
  }
}

output foundryProjectEndpoint string = 'https://${foundryName}.services.ai.azure.com/api/projects/${foundryProjectName}'
output foundryProjectId string = '${foundry.id}/projects/${foundryProjectName}'
output containerRegistryLoginServer string = registry.properties.loginServer
output containerAppName string = web.name
output foundryEndpoint string = 'https://${foundryName}.openai.azure.com/'
output foundryAccountName string = foundry.name
output webUrl string = 'https://${web.properties.configuration.ingress.fqdn}'
output containerEnvironmentName string = containerEnv.name
output customDomainVerificationId string = web.properties.customDomainVerificationId
output customDomainUrl string = empty(customDomainName) ? '' : 'https://${customDomainName}'
output appInsightsConnectionString string = appInsights.properties.ConnectionString
output logAnalyticsWorkspaceId string = logAnalytics.id
output workbookUrl string = observability.outputs.workbookUrl
output answerReviewWorkbookId string = observability.outputs.answerReviewWorkbookId
output answerReviewWorkbookUrl string = observability.outputs.answerReviewWorkbookUrl
output appInsightsResourceId string = appInsights.id
output dashboardUrl string = observability.outputs.dashboardUrl
