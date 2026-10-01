// Reference: review IDs, KQL, and Azure portal links for one answer or one chat.
//
// Every ID is checked against a strict pattern before it reaches a query or a
// URL. The patterns allow only letters, digits, "_" and "-", so an ID can never
// break out of a KQL string or a URL path.

/** Values from the deployment (Bicep outputs passed to the frontend build). None of them are secrets. */
export type ObservabilityConfig = {
  /** https://portal.azure.com, or the portal of a sovereign cloud. */
  portalOrigin: string
  tenantId: string
  /** Application Insights resource ID. Its Logs page uses the classic table names (requests, dependencies, ...). */
  appInsightsResourceId: string
  /** The "Answer review" workbook resource ID from infra/dashboards/answer-review.workbook.json. */
  answerReviewWorkbookId?: string
  /** Minutes before and after an answer to search. Keeps queries small and fast. */
  windowMinutes?: number
}

const traceIdPattern = /^[0-9a-f]{32}$/
/** GUIDs from the app and Foundry conversation IDs such as "conv_0a1b...". */
const conversationIdPattern = /^[A-Za-z0-9][A-Za-z0-9_-]{7,127}$/
const resourceIdPattern = /^\/subscriptions\/[0-9a-f-]{36}\/resourceGroups\/[\w().-]{1,90}\/providers\/[\w.]+\/[\w./-]+$/i

/** A W3C trace ID: 32 lowercase hex characters, not all zeros. Practice IDs fail this check. */
export function isTraceId(value: string | null | undefined): value is string {
  return typeof value === 'string' && traceIdPattern.test(value) && !/^0+$/.test(value)
}

export function isConversationId(value: string | null | undefined): value is string {
  return typeof value === 'string' && conversationIdPattern.test(value)
}

function requireTraceId(value: string) {
  if (!isTraceId(value)) throw new Error('Not a recorded trace ID.')
  return value
}

function requireConversationId(value: string) {
  if (!isConversationId(value)) throw new Error('Not a recorded conversation ID.')
  return value
}

export type TimeWindow = { from: string; to: string }

/** A window around one or more moments, wide enough to cover clock differences between browser and server. */
export function windowAround(times: (string | undefined)[], minutes = 60): TimeWindow | null {
  const millis = times.map((time) => (time ? Date.parse(time) : Number.NaN)).filter(Number.isFinite)
  if (!millis.length) return null
  const pad = minutes * 60_000
  return {
    from: new Date(Math.min(...millis) - pad).toISOString(),
    to: new Date(Math.max(...millis) + pad).toISOString(),
  }
}

/** Every step of one answer, in order. Paste into Logs on the Application Insights resource. */
export function answerStepsKql(traceId: string) {
  return [
    `let traceId = "${requireTraceId(traceId)}";`,
    'union requests, dependencies, traces, exceptions',
    '| where operation_Id == traceId',
    '| extend Step = coalesce(name, message, type), Seconds = round(duration / 1000, 2)',
    '| project timestamp, Kind = itemType, Service = cloud_RoleName, Step, Seconds, Succeeded = success, Code = resultCode, SpanId = id, ParentId = operation_ParentId',
    '| order by timestamp asc',
  ].join('\n')
}

/** The whole chat as one row: questions, time span, agents, models, tokens, failures, and every trace ID. */
export function conversationKql(conversationId: string) {
  return [
    `let conversationId = "${requireConversationId(conversationId)}";`,
    'let answers = requests',
    '    | where tostring(customDimensions["gen_ai.conversation.id"]) == conversationId',
    '    | distinct operation_Id;',
    'union requests, dependencies',
    '| where operation_Id in (answers)',
    '| summarize Questions = dcount(operation_Id), Started = min(timestamp), Ended = max(timestamp),',
    '    Agents = make_set_if(tostring(customDimensions["gen_ai.agent.name"]), isnotempty(tostring(customDimensions["gen_ai.agent.name"]))),',
    '    Models = make_set_if(tostring(customDimensions["gen_ai.response.model"]), isnotempty(tostring(customDimensions["gen_ai.response.model"]))),',
    '    InputTokens = sum(tolong(customDimensions["gen_ai.usage.input_tokens"])),',
    '    OutputTokens = sum(tolong(customDimensions["gen_ai.usage.output_tokens"])),',
    '    FailedSteps = countif(success == false), TraceIds = make_set(operation_Id, 100)',
  ].join('\n')
}

function resourcePath(resourceId: string) {
  if (!resourceIdPattern.test(resourceId)) throw new Error('Not an Azure resource ID.')
  return resourceId
}

function portalBase(config: ObservabilityConfig) {
  const origin = new URL(config.portalOrigin)
  if (origin.protocol !== 'https:') throw new Error('The portal origin must use HTTPS.')
  if (!/^[0-9a-f-]{36}$/i.test(config.tenantId)) throw new Error('Not a tenant ID.')
  return `${origin.origin}/#@${config.tenantId}`
}

/** Opens Logs for the Application Insights resource. Paste a copied query there. */
export function appInsightsLogsUrl(config: ObservabilityConfig) {
  return `${portalBase(config)}/resource${resourcePath(config.appInsightsResourceId)}/logs`
}

/** Opens the Answer review workbook. Paste the trace or conversation ID into its parameters. */
export function answerReviewWorkbookUrl(config: ObservabilityConfig) {
  if (!config.answerReviewWorkbookId) return null
  return `${portalBase(config)}/resource${resourcePath(config.answerReviewWorkbookId)}/workbook`
}

async function gzipBase64(text: string) {
  const stream = new Response(text).body!.pipeThrough(new CompressionStream('gzip'))
  const bytes = new Uint8Array(await new Response(stream).arrayBuffer())
  let binary = ''
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return btoa(binary)
}

/**
 * A link that opens Logs with the query already filled in, in the same format
 * as the portal's Share > Copy link to query. That format is not a documented
 * API: open one generated link per demo before relying on it, and keep the
 * "Copy query" button as the fallback.
 */
export async function logsQueryUrl(config: ObservabilityConfig, kql: string, window: TimeWindow | null) {
  const resourceId = resourcePath(config.appInsightsResourceId)
  const timespan = window ? `${window.from}/${window.to}` : 'P1D'
  return `${portalBase(config)}/blade/Microsoft_OperationsManagementSuite_Workspace/Logs.ReactView`
    + `/resourceId/${encodeURIComponent(resourceId)}/source/LogsBlade.AnalyticsShareLinkToQuery`
    + `/q/${encodeURIComponent(await gzipBase64(kql))}/timespan/${encodeURIComponent(timespan)}`
}
