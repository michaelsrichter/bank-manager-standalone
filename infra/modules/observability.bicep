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
      replace(
        loadTextContent('../dashboards/demo-overview.workbook.json'),
        '__WORKSPACE_ID__',
        logAnalytics.id
      ),
      '__FOUNDRY_ID__',
      foundry.id
    )
  }
}

// ---------------------------------------------------------- Answer review
// Review one answer (trace ID) or one chat (conversation ID). The app's
// "IDs and observability links" panel links here (eps-demo-telemetry-links).
resource answerReview 'Microsoft.Insights/workbooks@2023-06-01' = {
  name: guid(resourceGroup().id, 'bank-manager-answer-review-workbook')
  location: location
  tags: tags
  kind: 'shared'
  properties: {
    displayName: 'Governed AI Bank Assistant — answer review (${environmentName})'
    category: 'workbook'
    sourceId: appInsights.id
    version: 'Notebook/1.0'
    serializedData: replace(
      loadTextContent('../dashboards/answer-review.workbook.json'),
      '__APP_INSIGHTS_ID__',
      appInsights.id
    )
  }
}

// ---------------------------------------------------------------- Dashboard
var workbookBlade = '${environment().portal}/#@${tenant().tenantId}/resource${workbook.id}/workbook'
var answerReviewBlade = '${environment().portal}/#@${tenant().tenantId}/resource${answerReview.id}/workbook'
var foundryPortal = 'https://ai.azure.com/resource/overview?wsid=${project.id}'

func logInputs(title string, kql string, control string, chart string, workspaceId string) array => [
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

func gridTile(x int, y int, w int, h int, title string, kql string, workspaceId string) object => {
  position: { x: x, y: y, colSpan: w, rowSpan: h }
  metadata: {
    type: 'Extension/Microsoft_OperationsManagementSuite_Workspace/PartType/LogsDashboardPart'
    inputs: logInputs(title, kql, 'AnalyticsGrid', '', workspaceId)
    settings: {}
  }
}

// Chart tiles need an explicit Dimensions input (x axis, y columns, split, aggregation);
// without it the portal shows "Error retrieving data".
func chartTile(x int, y int, w int, h int, title string, kql string, chart string, yColumn string, yType string, splitColumn string, aggregation string, workspaceId string) object => {
  position: { x: x, y: y, colSpan: w, rowSpan: h }
  metadata: {
    type: 'Extension/Microsoft_OperationsManagementSuite_Workspace/PartType/LogsDashboardPart'
    inputs: concat(logInputs(title, kql, 'FrameControlChart', chart, workspaceId), [
      {
        name: 'Dimensions'
        value: {
          xAxis: { name: 'TimeGenerated', type: 'datetime' }
          yAxis: [{ name: yColumn, type: yType }]
          splitBy: empty(splitColumn) ? [] : [{ name: splitColumn, type: 'string' }]
          aggregation: aggregation
        }
        isOptional: true
      }
      { name: 'LegendOptions', value: { isEnabled: true, position: 'Bottom' }, isOptional: true }
    ])
    settings: {}
  }
}

func metricTile(x int, y int, w int, title string, resourceId string, metrics array, split string) object => {
  position: { x: x, y: y, colSpan: w, rowSpan: 4 }
  metadata: {
    type: 'Extension/HubsExtension/PartType/MonitorChartPart'
    inputs: [
      { name: 'options', isOptional: true }
      { name: 'sharedTimeRange', isOptional: true }
    ]
    settings: {
      content: {
        options: {
          chart: union({
            title: title
            titleKind: 2
            metrics: map(metrics, m => {
              resourceMetadata: { id: resourceId }
              name: m.name
              aggregationType: m.aggregation
              namespace: 'microsoft.cognitiveservices/accounts'
              metricVisualization: { displayName: m.label }
            })
            visualization: {
              chartType: 2
              legendVisualization: { isVisible: true, position: 2, hideSubtitle: false }
              axisVisualization: {
                x: { isVisible: true, axisType: 2 }
                y: { isVisible: true, axisType: 1 }
              }
            }
          }, empty(split) ? {} : { grouping: { dimension: split, sort: 2, top: 10 } })
        }
      }
    }
  }
}

var markdown = join(
  [
    '### Governed AI Bank Assistant — observability'
    '**For demo purposes only.** OpenTelemetry from the app, agent harness, ACS policy engine, Azure AI Foundry, and Container Apps.'
    ''
    '- [Open the detailed workbook](${workbookBlade})'
    '- [Review one answer or one chat](${answerReviewBlade})'
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
          chartTile(6, 0, 6, 4, 'Comparisons per 5 min, by governed outcome', 'AppEvents | where Name == "policy_decision" and tostring(Properties.lane) == "governed" | summarize Comparisons = count() by bin(TimeGenerated, 5m), Outcome = tostring(Properties.status)', 'StackedColumn', 'Comparisons', 'long', 'Outcome', 'Sum', logAnalytics.id)
          chartTile(12, 0, 6, 4, 'Estimated model cost (USD, per 15 min)', 'AppEvents | where Name == "ai_call" and tostring(Properties.status) == "ok" | summarize CostUSD = sum(todouble(Properties.estimated_cost_usd)) by bin(TimeGenerated, 15m), Deployment = tostring(Properties.deployment)', 'StackedColumn', 'CostUSD', 'real', 'Deployment', 'Sum', logAnalytics.id)
          gridTile(0, 4, 6, 4, 'Same tool call, two lanes: results', 'let d = AppEvents | where Name == "policy_decision" | extend Lane = tostring(Properties.lane), Ran = tostring(Properties.tool_executed) =~ "true"; d | summarize [\'No rules\'] = countif(Lane == "baseline"), Governed = countif(Lane == "governed") by Outcome = tostring(Properties.status) | order by Governed desc | union (d | summarize [\'No rules\'] = countif(Lane == "baseline" and Ran), Governed = countif(Lane == "governed" and Ran) | extend Outcome = "= tool actually ran") | project Outcome, [\'No rules\'], Governed', logAnalytics.id)
          gridTile(6, 4, 6, 4, 'Governed lane: which rule decided', 'AppEvents | where Name == "policy_decision" and tostring(Properties.lane) == "governed" | extend Rule = iff(tostring(Properties.reason) == "default", "(allowed, no rule needed)", tostring(Properties.reason)) | summarize Count = count() by Rule, Outcome = tostring(Properties.status) | order by Count desc | take 12', logAnalytics.id)
          gridTile(12, 4, 6, 4, 'Model calls and cost', 'AppEvents | where Name == "ai_call" and tostring(Properties.status) == "ok" | summarize Calls = count(), [\'Cost $\'] = round(sum(todouble(Properties.estimated_cost_usd)), 4) by Model = tostring(Properties.deployment)', logAnalytics.id)
          chartTile(0, 8, 6, 4, 'App-measured model latency p95 (ms, per 5 min)', 'AppDependencies | where Name startswith "chat " | summarize P95ms = percentile(DurationMs, 95) by bin(TimeGenerated, 5m), Deployment = tostring(Properties["gen_ai.request.model"])', 'Line', 'P95ms', 'real', 'Deployment', 'Max', logAnalytics.id)
          metricTile(6, 8, 6, 'Foundry: request latency (ms, server side)', foundry.id, [
            { name: 'Latency', aggregation: 4, label: 'Avg latency' }
            { name: 'Latency', aggregation: 3, label: 'Max latency' }
          ], '')
          metricTile(12, 8, 6, 'Foundry: model requests by deployment', foundry.id, [
            { name: 'ModelRequests', aggregation: 1, label: 'Model requests' }
          ], 'ModelDeploymentName')
          metricTile(0, 12, 6, 'Foundry: input / output tokens', foundry.id, [
            { name: 'InputTokens', aggregation: 1, label: 'Input tokens' }
            { name: 'OutputTokens', aggregation: 1, label: 'Output tokens' }
          ], 'ModelDeploymentName')
          gridTile(6, 12, 12, 4, 'Requests by route (health probes excluded)', 'AppRequests | where Name != "GET /api/health/live" | extend Route = iff(Name startswith "GET /" and not(Name startswith "GET /api"), "GET (pages and assets)", Name) | summarize Requests = count(), Failed = countif(Success == false), P95ms = round(percentile(DurationMs, 95), 0) by Route, Code = ResultCode | order by Requests desc', logAnalytics.id)
          gridTile(0, 16, 18, 5, 'Latest agent runs (GenAI spans) — look up a Trace ID in the Answer review workbook', 'AppDependencies | where Name == "invoke_agent bank-manager" | extend P = Properties | project TimeGenerated, Version = AppVersion, Mode = tostring(P["demo.mode"]), Tool = coalesce(tostring(P["demo.selected_tool"]), tostring(P["bank_manager.selected_tool"])), Baseline = coalesce(tostring(P["demo.baseline.status"]), tostring(P["bank_manager.baseline.status"])), Governed = coalesce(tostring(P["demo.governed.status"]), tostring(P["bank_manager.governed.status"])), Decision = tostring(P["demo.authz.outcome"]), Rule = coalesce(tostring(P["demo.governed.reason"]), tostring(P["bank_manager.governed.reason"])), Model = tostring(P["gen_ai.request.model"]), DurationMs = round(DurationMs, 0), TraceId = OperationId, Conversation = tostring(P["gen_ai.conversation.id"]) | extend Rule = iff(Rule == "default", "(allowed, no rule needed)", Rule) | top 50 by TimeGenerated desc', logAnalytics.id)
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
output answerReviewWorkbookId string = answerReview.id
output answerReviewWorkbookUrl string = answerReviewBlade
output dashboardUrl string = '${environment().portal}/#@${tenant().tenantId}/dashboard/arm${dashboard.id}'
output foundryProjectName string = project.name
