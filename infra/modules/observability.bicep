// Observability wiring (eps-demo-production-readiness): every component sends
// telemetry to the same Log Analytics workspace / Application Insights, plus an
// Azure Workbook and a shared portal dashboard built on those signals.
targetScope = 'resourceGroup'

param location string
param tags object
param logAnalyticsName string
param appInsightsName string
param foundryAccountName string
param registryName string
param containerAppName string
param environmentName string

resource logAnalytics 'Microsoft.OperationalInsights/workspaces@2023-09-01' existing = {
  name: logAnalyticsName
}

resource appInsights 'Microsoft.Insights/components@2020-02-02' existing = {
  name: appInsightsName
}

resource foundry 'Microsoft.CognitiveServices/accounts@2025-06-01' existing = {
  name: foundryAccountName
}

resource registry 'Microsoft.ContainerRegistry/registries@2025-04-01' existing = {
  name: registryName
}

resource web 'Microsoft.App/containerApps@2025-01-01' existing = {
  name: containerAppName
}

// ---------------------------------------------------- Foundry → Azure Monitor
// Audit, RequestResponse, AzureOpenAIRequestUsage, and Trace logs plus all
// platform metrics (tokens, latency, throttling) land in Log Analytics.
resource foundryDiagnostics 'Microsoft.Insights/diagnosticSettings@2021-05-01-preview' = {
  name: 'to-log-analytics'
  scope: foundry
  properties: {
    workspaceId: logAnalytics.id
    logs: [{ categoryGroup: 'allLogs', enabled: true }]
    metrics: [{ category: 'AllMetrics', enabled: true }]
  }
}

// A Foundry project connected to Application Insights lights up the Foundry
// portal "Tracing" view for the agent's OpenTelemetry GenAI spans.
resource project 'Microsoft.CognitiveServices/accounts/projects@2025-06-01' = {
  parent: foundry
  name: 'bank-manager'
  location: location
  tags: tags
  identity: { type: 'SystemAssigned' }
  properties: {
    displayName: 'Governed AI Bank Assistant'
    description: 'Tracing and monitoring for the governed bank-manager demo agent.'
  }
}

resource tracingConnection 'Microsoft.CognitiveServices/accounts/projects/connections@2025-06-01' = {
  parent: project
  name: 'appinsights-tracing'
  properties: {
    category: 'AppInsights'
    target: appInsights.id
    authType: 'ApiKey'
    isSharedToAll: true
    // The connection string is an identifier; App Insights local auth is disabled,
    // so ingestion still requires an Entra token.
    credentials: { key: appInsights.properties.ConnectionString }
    metadata: {
      ApiType: 'Azure'
      ResourceId: appInsights.id
    }
  }
}

// -------------------------------------------------- Registry → Azure Monitor
resource registryDiagnostics 'Microsoft.Insights/diagnosticSettings@2021-05-01-preview' = {
  name: 'to-log-analytics'
  scope: registry
  properties: {
    workspaceId: logAnalytics.id
    logs: [{ categoryGroup: 'allLogs', enabled: true }]
    metrics: [{ category: 'AllMetrics', enabled: true }]
  }
}

// ---------------------------------------------------------------- Workbook
resource workbook 'Microsoft.Insights/workbooks@2023-06-01' = {
  name: guid(resourceGroup().id, 'bank-manager-telemetry-workbook')
  location: location
  tags: tags
  kind: 'shared'
  properties: {
    displayName: 'Governed AI Bank Assistant — telemetry (${environmentName})'
    category: 'workbook'
    sourceId: logAnalytics.id
    version: 'Notebook/1.0'
    serializedData: replace(
      loadTextContent('../workbooks/bank-manager-telemetry.workbook.json'),
      '__WORKSPACE_ID__',
      logAnalytics.id
    )
  }
}

// ---------------------------------------------------------------- Dashboard
var workbookBlade = '${environment().portal}/#@${tenant().tenantId}/resource${workbook.id}/workbook'
var foundryPortal = 'https://ai.azure.com/resource/overview?wsid=${project.id}'

func logTile(x int, y int, w int, h int, title string, kql string, control string, chart string, workspaceId string) object => {
  position: { x: x, y: y, colSpan: w, rowSpan: h }
  metadata: {
    type: 'Extension/Microsoft_OperationsManagementSuite_Workspace/PartType/LogsDashboardPart'
    inputs: [
      { name: 'resourceTypeMode', isOptional: true }
      { name: 'ComponentId', isOptional: true }
      { name: 'Scope', value: { resourceIds: [workspaceId] }, isOptional: true }
      { name: 'PartId', value: guid(title), isOptional: true }
      { name: 'Version', value: '2.0', isOptional: true }
      { name: 'TimeRange', value: 'P1D', isOptional: true }
      { name: 'DashboardId', isOptional: true }
      { name: 'DraftRequestParameters', isOptional: true }
      { name: 'Query', value: kql, isOptional: true }
      { name: 'ControlType', value: control, isOptional: true }
      { name: 'SpecificChart', value: chart, isOptional: true }
      { name: 'PartTitle', value: title, isOptional: true }
      { name: 'PartSubTitle', value: 'Log Analytics', isOptional: true }
      { name: 'IsQueryContainTimeRange', value: false, isOptional: true }
    ]
    settings: {}
  }
}

var markdown = join(
  [
    '### Governed AI Bank Assistant — observability'
    '**For demo purposes only.** OpenTelemetry from the app, agent harness, ACS policy engine, Azure AI Foundry, and Container Apps.'
    ''
    '- [Open the detailed workbook](${workbookBlade})'
    '- [Application Insights (traces, live metrics)](${environment().portal}/#@${tenant().tenantId}/resource${appInsights.id}/overview)'
    '- [Foundry project tracing](${foundryPortal})'
    '- [Live demo](https://${web.properties.configuration.ingress.fqdn}/)'
  ],
  '\n'
)

resource dashboard 'Microsoft.Portal/dashboards@2022-12-01-preview' = {
  name: 'dash-bank-manager-${uniqueString(resourceGroup().id)}'
  location: location
  tags: union(tags, { 'hidden-title': 'Governed AI Bank Assistant (${environmentName})' })
  properties: {
    lenses: [
      {
        order: 0
        parts: [
          {
            position: { x: 0, y: 0, colSpan: 6, rowSpan: 4 }
            metadata: {
              type: 'Extension/HubsExtension/PartType/MarkdownPart'
              inputs: []
              settings: {
                content: {
                  settings: {
                    content: markdown
                    title: 'Start here'
                    subtitle: 'Links and scope'
                  }
                }
              }
            }
          }
          logTile(6, 0, 6, 4, 'Comparisons and model calls', 'AppEvents | where Name in ("model_selection", "ai_call") | summarize Count = count() by bin(TimeGenerated, 15m), Name', 'FrameControlChart', 'Line', logAnalytics.id)
          logTile(12, 0, 6, 4, 'Governed vs unsafe lane results', 'AppEvents | where Name == "policy_decision" | summarize Count = count() by Lane = tostring(Properties.lane), Status = tostring(Properties.status)', 'AnalyticsGrid', '', logAnalytics.id)
          logTile(0, 4, 6, 4, 'Tokens by deployment', 'AppEvents | where Name == "ai_call" | summarize Input = sum(toint(Properties.input_tokens)), Output = sum(toint(Properties.output_tokens)) by Deployment = tostring(Properties.deployment)', 'AnalyticsGrid', '', logAnalytics.id)
          logTile(6, 4, 6, 4, 'Model latency p95 (ms)', 'AppDependencies | where Name startswith "chat " | summarize P95 = percentile(DurationMs, 95) by bin(TimeGenerated, 15m), Deployment = tostring(Properties["gen_ai.request.model"])', 'FrameControlChart', 'Line', logAnalytics.id)
          logTile(12, 4, 6, 4, 'Top governed rules', 'AppEvents | where Name == "policy_decision" and tostring(Properties.lane) == "governed" | summarize Count = count() by Rule = tostring(Properties.reason) | top 10 by Count', 'AnalyticsGrid', '', logAnalytics.id)
          logTile(0, 8, 6, 4, 'Estimated model cost (USD)', 'AppEvents | where Name == "ai_call" | summarize CostUSD = sum(todouble(Properties.estimated_cost_usd)) by bin(TimeGenerated, 1h)', 'FrameControlChart', 'StackedColumn', logAnalytics.id)
          logTile(6, 8, 6, 4, 'Requests by route and status', 'AppRequests | summarize Requests = count(), P95ms = percentile(DurationMs, 95) by Name, ResultCode | order by Requests desc', 'AnalyticsGrid', '', logAnalytics.id)
          logTile(12, 8, 6, 4, 'Foundry platform metrics', 'AzureMetrics | where ResourceProvider == "MICROSOFT.COGNITIVESERVICES" | summarize Total = sum(Total) by MetricName', 'AnalyticsGrid', '', logAnalytics.id)
        ]
      }
    ]
    metadata: {
      model: {
        timeRange: {
          value: { relative: { duration: 24, timeUnit: 1 } }
          type: 'MsPortalFx.Composition.Configuration.ValueTypes.TimeRange'
        }
      }
    }
  }
}

output workbookId string = workbook.id
output workbookUrl string = workbookBlade
output dashboardUrl string = '${environment().portal}/#@${tenant().tenantId}/dashboard/arm${dashboard.id}'
output foundryProjectName string = project.name
