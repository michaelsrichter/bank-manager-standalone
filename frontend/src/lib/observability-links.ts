// Review IDs, KQL, and Azure portal links for one answer or one chat.
// Adapted from .github/skills/eps-demo-telemetry-links/reference.
//
// Every ID is checked against a strict pattern before it reaches a query or a
// URL. The patterns allow only letters, digits, "_" and "-", so an ID can never
// break out of a KQL string or a URL path.
import type { ObservabilityConfig } from "./types";

const traceIdPattern = /^[0-9a-f]{32}$/;
/** GUIDs from the app and Foundry conversation IDs such as "conv_0a1b...". */
const conversationIdPattern = /^[A-Za-z0-9][A-Za-z0-9_-]{7,127}$/;
const resourceIdPattern =
  /^\/subscriptions\/[0-9a-f-]{36}\/resourceGroups\/[\w().-]{1,90}\/providers\/[\w.]+\/[\w./-]+$/i;

/** Minutes before and after an answer to search. Keeps queries small and fast. */
export const REVIEW_WINDOW_MINUTES = 60;

/** A W3C trace ID: 32 lowercase hex characters, not all zeros. Practice IDs fail this check. */
export function isTraceId(value: string | null | undefined): value is string {
  return typeof value === "string" && traceIdPattern.test(value) && !/^0+$/.test(value);
}

export function isConversationId(value: string | null | undefined): value is string {
  return typeof value === "string" && conversationIdPattern.test(value);
}

function requireTraceId(value: string): string {
  if (!isTraceId(value)) throw new Error("Not a recorded trace ID.");
  return value;
}

function requireConversationId(value: string): string {
  if (!isConversationId(value)) throw new Error("Not a recorded conversation ID.");
  return value;
}

export interface TimeWindow {
  from: string;
  to: string;
}

/** A window around one or more moments, wide enough to cover clock differences. */
export function windowAround(
  times: (string | undefined)[],
  minutes = REVIEW_WINDOW_MINUTES,
): TimeWindow | null {
  const millis = times
    .map((time) => (time ? Date.parse(time) : Number.NaN))
    .filter(Number.isFinite);
  if (!millis.length) return null;
  const pad = minutes * 60_000;
  return {
    from: new Date(Math.min(...millis) - pad).toISOString(),
    to: new Date(Math.max(...millis) + pad).toISOString(),
  };
}

/**
 * Every step of one answer, grouped by lane: shared steps (request, model call),
 * then the no-rules lane, then the governed lane. Paste into Logs on Application Insights.
 */
export function answerStepsKql(traceId: string): string {
  return [
    `let traceId = "${requireTraceId(traceId)}";`,
    "union requests, dependencies, traces, exceptions, customEvents",
    "| where operation_Id == traceId",
    '| extend lane = coalesce(tostring(customDimensions["demo.lane"]), tostring(customDimensions["lane"]))',
    '| extend Lane = case(lane == "baseline", "No rules", lane == "governed", "Governed", "Shared")',
    '| extend Order = case(Lane == "Shared", 0, Lane == "No rules", 1, 2)',
    "| extend Step = coalesce(name, message, type), Seconds = round(duration / 1000, 2)",
    '| extend Decision = tostring(customDimensions["demo.authz.outcome"]), Rule = tostring(customDimensions["demo.reason"])',
    "| order by Order asc, timestamp asc",
    "| project Lane, timestamp, Kind = itemType, Step, Decision, Rule, Seconds, Succeeded = success, Code = resultCode, SpanId = id, ParentId = operation_ParentId",
  ].join("\n");
}

/**
 * One row per lane for one answer: did the tool run, what decided it, and which checks ran.
 * Prefers the lane span; falls back to the policy_decision event (logs are never sampled),
 * so answers recorded before lane spans, or with dropped spans, still show both lanes.
 */
export function bothLanesKql(traceId: string): string {
  return [
    // tour:begin slide-lanes-kql
    `let traceId = "${requireTraceId(traceId)}";`,
    "let spans = dependencies",
    '    | where operation_Id == traceId and name startswith "lane "',
    "    | extend d = customDimensions",
    '    | project lane = tostring(d["demo.lane"]), Tool = tostring(d["gen_ai.tool.name"]),',
    '        Ran = tostring(d["demo.tool_executed"]), Result = tostring(d["demo.status"]),',
    '        Rule = tostring(d["demo.reason"]), Checks = tostring(d["demo.policy_checks"]),',
    '        Decision = tostring(d["demo.authz.outcome"]), Source = "1 lane span";',
    // tour:end slide-lanes-kql
    "let events = customEvents",
    '    | where operation_Id == traceId and name == "policy_decision"',
    "    | extend d = customDimensions",
    '    | project lane = tostring(d["lane"]), Tool = tostring(d["tool"]),',
    '        Ran = tostring(d["tool_executed"]), Result = tostring(d["status"]),',
    '        Rule = tostring(d["reason"]), Checks = replace_string(strcat("ended at ", tostring(d["intervention_point"])), "ended at none", "none"),',
    '        Decision = tostring(d["authz_outcome"]), Source = "2 policy_decision event";',
    "union spans, events",
    "| summarize arg_min(Source, *) by lane",
    "| order by lane asc",
    '| project Lane = iff(lane == "baseline", "No rules (unsafe on purpose)", "Governed by policy"),',
    '    Tool, ["Tool ran"] = Ran, Result, Rule, ["Policy checks"] = Checks, Decision, Source',
  ].join("\n");
}

/** Every recent answer as one row, with the two lanes side by side. Needs no ID. */
export function recentLanesKql(): string {
  return [
    "let checks = dependencies",
    '    | where name == "lane governed"',
    '    | project operation_Id, Checks = tostring(customDimensions["demo.policy_checks"]);',
    "customEvents",
    '| where name == "policy_decision"',
    "| extend d = customDimensions",
    '| extend Lane = tostring(d["lane"]), Ran = iff(tostring(d["tool_executed"]) =~ "true", "tool ran", "tool did not run")',
    '| extend Summary = strcat(tostring(d["status"]), " · ", Ran, " · ", tostring(d["reason"]))',
    '| summarize Asked = min(timestamp), Tool = take_any(tostring(d["tool"])),',
    '    ["No rules"] = take_anyif(Summary, Lane == "baseline"), Governed = take_anyif(Summary, Lane == "governed")',
    "    by TraceId = operation_Id",
    "| join kind=leftouter checks on $left.TraceId == $right.operation_Id",
    '| project Asked, TraceId, Tool, ["No rules"], Governed, ["Policy checks"] = Checks',
    "| order by Asked desc",
    "| take 25",
  ].join("\n");
}

/** The whole chat as one row: questions, time span, models, tokens, decisions, and every trace ID. */
export function conversationKql(conversationId: string): string {
  return [
    `let conversationId = "${requireConversationId(conversationId)}";`,
    "let traces = requests",
    '    | where tostring(customDimensions["gen_ai.conversation.id"]) == conversationId',
    "    | distinct operation_Id;",
    "union requests, dependencies",
    "| where operation_Id in (traces)",
    "| summarize Questions = dcountif(operation_Id, itemType == 'request' and name has 'compare'),",
    "    Approvals = dcountif(operation_Id, itemType == 'request' and name has 'approval'),",
    "    Started = min(timestamp), Ended = max(timestamp),",
    '    Agents = make_set_if(tostring(customDimensions["gen_ai.agent.name"]), isnotempty(tostring(customDimensions["gen_ai.agent.name"]))),',
    '    Models = make_set_if(tostring(customDimensions["gen_ai.response.model"]), isnotempty(tostring(customDimensions["gen_ai.response.model"]))),',
    '    InputTokens = sum(tolong(customDimensions["gen_ai.usage.input_tokens"])),',
    '    OutputTokens = sum(tolong(customDimensions["gen_ai.usage.output_tokens"])),',
    '    Decisions = make_set_if(tostring(customDimensions["demo.authz.outcome"]), isnotempty(tostring(customDimensions["demo.authz.outcome"]))),',
    '    ["No-rules tool runs"] = countif(name == "lane baseline" and tostring(customDimensions["demo.tool_executed"]) =~ "true"),',
    '    ["Governed tool runs"] = countif(name == "lane governed" and tostring(customDimensions["demo.tool_executed"]) =~ "true"),',
    '    ["Governed blocks"] = countif(name == "lane governed" and tostring(customDimensions["demo.status"]) == "deny"),',
    "    FailedSteps = countif(success == false), TraceIds = make_set(operation_Id, 100)",
  ].join("\n");
}

function resourcePath(resourceId: string): string {
  if (!resourceIdPattern.test(resourceId)) throw new Error("Not an Azure resource ID.");
  return resourceId;
}

function portalBase(config: ObservabilityConfig): string {
  const origin = new URL(config.portalOrigin);
  if (origin.protocol !== "https:") throw new Error("The portal origin must use HTTPS.");
  if (!/^[0-9a-f-]{36}$/i.test(config.tenantId)) throw new Error("Not a tenant ID.");
  return `${origin.origin}/#@${config.tenantId}`;
}

/** Opens Logs for the Application Insights resource. Paste a copied query there. */
export function appInsightsLogsUrl(config: ObservabilityConfig): string {
  return `${portalBase(config)}/resource${resourcePath(config.appInsightsResourceId)}/logs`;
}

/** Opens the Answer review workbook. Paste the trace or conversation ID into its parameters. */
export function answerReviewWorkbookUrl(config: ObservabilityConfig): string | null {
  if (!config.answerReviewWorkbookId) return null;
  return `${portalBase(config)}/resource${resourcePath(config.answerReviewWorkbookId)}/workbook`;
}

/** Opens the Demo overview workbook (the health of the whole demo). */
export function overviewWorkbookUrl(config: ObservabilityConfig): string | null {
  if (!config.overviewWorkbookId) return null;
  return `${portalBase(config)}/resource${resourcePath(config.overviewWorkbookId)}/workbook`;
}

async function gzipBase64(text: string): Promise<string> {
  const stream = new Response(text).body!.pipeThrough(new CompressionStream("gzip"));
  const bytes = new Uint8Array(await new Response(stream).arrayBuffer());
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

/**
 * A link that opens Logs with the query already filled in, in the same format
 * as the portal's Share > Copy link to query. That format is not a documented
 * API, so the "Copy query" button stays as the fallback.
 */
export async function logsQueryUrl(
  config: ObservabilityConfig,
  kql: string,
  window: TimeWindow | null,
): Promise<string> {
  const resourceId = resourcePath(config.appInsightsResourceId);
  const timespan = window ? `${window.from}/${window.to}` : "P1D";
  return (
    `${portalBase(config)}/blade/Microsoft_OperationsManagementSuite_Workspace/Logs.ReactView` +
    `/resourceId/${encodeURIComponent(resourceId)}/source/LogsBlade.AnalyticsShareLinkToQuery` +
    `/q/${encodeURIComponent(await gzipBase64(kql))}/timespan/${encodeURIComponent(timespan)}`
  );
}
