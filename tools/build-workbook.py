#!/usr/bin/env python3
"""Generate infra/dashboards/demo-overview.workbook.json (eps-demo-observability).

Run after editing a query: python tools/build-workbook.py
The Bicep template loads the JSON with loadTextContent and substitutes the
Log Analytics workspace ID for __WORKSPACE_ID__.
"""

from __future__ import annotations

import json
from pathlib import Path

OUT = Path(__file__).resolve().parents[1] / "infra" / "dashboards" / "demo-overview.workbook.json"
WORKSPACE = "microsoft.operationalinsights/workspaces"


def foundry_metric(
    name: str,
    title: str,
    metrics: list[tuple[str, str, int]],
    width: str = "50",
    split: str | None = "ModelDeploymentName",
) -> None:
    """Native Azure Monitor metrics chart read straight from the Foundry account."""
    items.append(
        {
            "type": 10,
            "content": {
                "chartId": f"foundry-{name}",
                "version": "MetricsItem/2.0",
                "size": 0,
                "chartType": 2,
                "resourceType": "microsoft.cognitiveservices/accounts",
                "metricScope": 0,
                "resourceIds": ["__FOUNDRY_ID__"],
                "timeContextFromParameter": "TimeRange",
                "timeContext": {"durationMs": 86400000},
                "metrics": [
                    {
                        "namespace": "microsoft.cognitiveservices/accounts",
                        # Workbooks encode " - " inside a metric category as two spaces.
                        "metric": f"microsoft.cognitiveservices/accounts-{category.replace(' - ', '  ')}-{metric}",
                        "aggregation": aggregation,
                        **({"splitBy": split} if split else {}),
                    }
                    for category, metric, aggregation in metrics
                ],
                "title": title,
                "gridSettings": {"rowLimit": 10000},
            },
            "customWidth": width,
            "name": f"foundry-{name}",
        }
    )


items: list[dict] = []


def text(name: str, markdown: str) -> None:
    items.append({"type": 1, "content": {"json": markdown}, "name": name})


def query(
    name: str,
    title: str,
    kql: str,
    visualization: str = "table",
    width: str | None = None,
    extra: dict | None = None,
) -> None:
    content = {
        "version": "KqlItem/1.0",
        "query": kql.strip(),
        "size": 0,
        "title": title,
        "noDataMessage": "No data in this time range yet.",
        "timeContextFromParameter": "TimeRange",
        "queryType": 0,
        "resourceType": WORKSPACE,
        "visualization": visualization,
        **(extra or {}),
    }
    item = {"type": 3, "content": content, "name": name}
    if width:
        item["customWidth"] = width
    items.append(item)


items.append(
    {
        "type": 9,
        "content": {
            "version": "KqlParameterItem/1.0",
            "parameters": [
                {
                    "id": "b1f6d3a2-0000-4000-8000-000000000001",
                    "version": "KqlParameterItem/1.0",
                    "name": "TimeRange",
                    "label": "Time range",
                    "type": 4,
                    "isRequired": True,
                    "value": {"durationMs": 86400000},
                    "typeSettings": {
                        "selectableValues": [
                            {"durationMs": 3600000},
                            {"durationMs": 14400000},
                            {"durationMs": 86400000},
                            {"durationMs": 259200000},
                            {"durationMs": 604800000},
                            {"durationMs": 2592000000},
                        ]
                    },
                }
            ],
            "style": "pills",
            "queryType": 0,
            "resourceType": WORKSPACE,
        },
        "name": "parameters",
    }
)

text(
    "intro",
    """# Governed AI Bank Assistant — telemetry
**For demo purposes only.** Every chart comes from OpenTelemetry sent to Azure Monitor with
managed identity: the FastAPI app, the agent harness (`invoke_agent` → `chat` → `acs.evaluate` →
`execute_tool` spans), the ACS policy engine (`acs_intervention_*` metrics), Azure AI Foundry
(diagnostic logs + platform metrics), and Container Apps. No prompts, answers, or account data
are recorded. Event definitions: `docs/telemetry/events.md`.""",
)

query(
    "kpis",
    "At a glance",
    """
let r = AppRequests;
let e = AppEvents;
union
 (r | where Name == "POST /api/compare" | summarize Value = todouble(count()) | extend Metric = "Comparisons", Order = 1),
 (e | where Name == "ai_call" and tostring(Properties.status) == "ok" | summarize Value = todouble(count()) | extend Metric = "Model calls", Order = 2),
 (e | where Name == "ai_call" | summarize Value = round(sum(todouble(Properties.estimated_cost_usd)), 4) | extend Metric = "Est. model cost (USD)", Order = 3),
 (e | where Name == "ai_call" | summarize Value = todouble(sum(toint(Properties.input_tokens)) + sum(toint(Properties.output_tokens))) | extend Metric = "Tokens", Order = 4),
 (e | where Name == "policy_decision" and tostring(Properties.lane) == "governed" and tostring(Properties.status) == "deny" | summarize Value = todouble(count()) | extend Metric = "Governed blocks", Order = 5),
 (e | where Name == "policy_decision" and tostring(Properties.lane) == "baseline" and tostring(Properties.tool_executed) =~ "true" | summarize Value = todouble(count()) | extend Metric = "Unsafe baseline runs", Order = 6),
 (e | where Name == "approval_decision" | summarize Value = todouble(count()) | extend Metric = "Human decisions", Order = 7),
 (r | summarize Value = todouble(countif(toint(ResultCode) >= 500)) | extend Metric = "Server errors (5xx)", Order = 8),
 (e | where Name == "rate_limited" | summarize Value = todouble(count()) | extend Metric = "Rate-limited", Order = 9)
| order by Order asc
| project Metric, Value
""",
    "tiles",
    extra={
        "size": 4,
        "tileSettings": {
            "titleContent": {"columnMatch": "Metric"},
            "leftContent": {
                "columnMatch": "Value",
                "formatter": 12,
                "formatOptions": {"palette": "auto"},
                "numberFormat": {"unit": 17, "options": {"maximumSignificantDigits": 4}},
            },
            "showBorder": True,
        },
    },
)


# Attribute names changed from bank_manager.* to demo.* (eps-demo-observability).
# Older rows still carry the old names, so read both.
def prop(new: str, old: str | None = None) -> str:
    if old is None:
        return f'tostring(Properties["{new}"])'
    return f'coalesce(tostring(Properties["{new}"]), tostring(Properties["{old}"]))'


# ---------------------------------------------------------------- 1. Overview
text(
    "overview",
    "## 1. Overview\nRequests, server errors, and response time for each release (`service.version`, "
    "the same short Git commit as the site footer). **Good looks like:** no server errors (5xx) and "
    "a p95 under 10,000 ms for a comparison.",
)
query(
    "release",
    "Requests by release and service (health probes excluded; times in ms)",
    """
AppRequests
| where Name != "GET /api/health/live"
| summarize Requests = count(), ServerErrors = countif(toint(ResultCode) >= 500), P50ms = round(percentile(DurationMs, 50), 0),
            P95ms = round(percentile(DurationMs, 95), 0), FirstSeen = min(TimeGenerated), LastSeen = max(TimeGenerated)
    by Release = AppVersion, Service = AppRoleName
| order by LastSeen desc
""",
    "table",
    "50",
    {"size": 1},
)
query(
    "requests-time",
    "Requests over time by result code (health probes excluded)",
    """
AppRequests
| where Name != "GET /api/health/live"
| summarize Requests = count() by bin(TimeGenerated, 5m), ResultCode
""",
    "timechart",
    "50",
)
query(
    "requests",
    "Requests by route (health probes excluded; times in ms)",
    """
AppRequests
| where Name != "GET /api/health/live"
| extend Name = iff(Name startswith "GET /" and not(Name startswith "GET /api"), "GET (pages and assets)", Name)
| summarize Requests = count(), Failed = countif(Success == false), P50ms = round(percentile(DurationMs, 50), 0), P95ms = round(percentile(DurationMs, 95), 0) by Name, ResultCode
| order by Requests desc
""",
    "table",
    "50",
)
query(
    "client-timing",
    "Browser-measured streaming time in ms (only from visitors who allowed analytics)",
    """
AppEvents
| where Name == "client_timing"
| summarize Runs = count(), FirstEventP50 = percentile(toint(Properties.first_event_ms), 50), TotalP50 = percentile(toint(Properties.total_ms), 50),
            TotalP95 = percentile(toint(Properties.total_ms), 95) by Model = tostring(Properties.model_key), Outcome = tostring(Properties.outcome)
""",
    "table",
    "50",
    {"size": 1},
)
query(
    "pages",
    "Page views (only from visitors who allowed analytics)",
    """
AppEvents
| where Name == "page_view"
| summarize Views = count() by Page = tostring(Properties.page)
""",
    "piechart",
    "50",
)
query(
    "modes",
    "Questions by mode: live (real AI model) or practice (no AI model)",
    """
AppRequests
| where Name == "POST /api/compare"
| extend Mode = tostring(Properties["demo.mode"])
| summarize Questions = count() by bin(TimeGenerated, 15m), Mode = iff(isempty(Mode), "live", Mode)
""",
    "barchart",
    "50",
)

# ---------------------------------------------------------------- 2. AI models
text(
    "ai",
    "## 2. AI models\nModel calls, tokens, estimated cost, response time, throttling (HTTP 429), and "
    "content-filter blocks. **Good looks like:** throttling and content-filter blocks near zero, and model "
    "p95 under 5,000 ms. Cost is an **estimate** from the list prices in `backend/bank_manager/ai/cost.py`.",
)
foundry_metric(
    "requests",
    "Foundry: model requests by deployment (platform metric)",
    [("Models - HTTP Requests", "ModelRequests", 1)],
)
foundry_metric(
    "tokens",
    "Foundry: input and output tokens by deployment (platform metric)",
    [("Models - Usage", "InputTokens", 1), ("Models - Usage", "OutputTokens", 1)],
)
foundry_metric(
    "latency",
    "Foundry: request latency (ms, server side, platform metric)",
    [
        ("Cognitive Services - HTTP Requests", "Latency", 4),
        ("Cognitive Services - HTTP Requests", "Latency", 3),
    ],
    split=None,
)
foundry_metric(
    "aoai-usage",
    "Foundry: processed prompt and generated tokens (Azure OpenAI usage metric)",
    [
        ("Azure OpenAI - Usage", "ProcessedPromptTokens", 1),
        ("Azure OpenAI - Usage", "GeneratedTokens", 1),
    ],
)
query(
    "model-problems",
    "Throttling (429) and content-filter blocks (0 is good)",
    """
AppEvents
| where Name == "ai_call"
| summarize Calls = count(), Throttled429 = countif(tostring(Properties.status) == "model_busy"),
            ContentFilterBlocks = countif(tostring(Properties.status) == "content_filtered"),
            OtherFailures = countif(tostring(Properties.status) == "model_failed")
    by Deployment = tostring(Properties.deployment)
""",
    "table",
    "50",
    {"size": 1},
)
query(
    "calls-by-model",
    "Model calls by deployment",
    """
AppDependencies
| where Name startswith "chat "
| summarize Calls = count() by bin(TimeGenerated, 5m), Deployment = tostring(Properties["gen_ai.request.model"])
""",
    "timechart",
    "50",
)
query(
    "tokens",
    "Tokens by deployment and type",
    """
AppEvents
| where Name == "ai_call" and tostring(Properties.status) == "ok"
| extend Deployment = tostring(Properties.deployment)
| summarize Input = sum(toint(Properties.input_tokens)), CachedInput = sum(toint(Properties.cached_input_tokens)),
            Output = sum(toint(Properties.output_tokens)), Reasoning = sum(toint(Properties.reasoning_tokens)) by bin(TimeGenerated, 5m), Deployment
""",
    "timechart",
    "50",
)
query(
    "model-latency",
    "Model call time in ms, from GenAI `chat` spans",
    """
AppDependencies
| where Name startswith "chat "
| summarize Calls = count(), Failures = countif(Success == false), P50ms = round(percentile(DurationMs, 50), 0), P95ms = round(percentile(DurationMs, 95), 0), MaxMs = round(max(DurationMs), 0)
    by Deployment = tostring(Properties["gen_ai.request.model"]), ResponseModel = tostring(Properties["gen_ai.response.model"])
""",
    "table",
    "50",
    {"size": 1},
)
query(
    "cost",
    "Estimated cost (USD) by deployment",
    """
AppEvents
| where Name == "ai_call"
| summarize EstimatedUSD = sum(todouble(Properties.estimated_cost_usd)) by bin(TimeGenerated, 15m), Deployment = tostring(Properties.deployment)
""",
    "barchart",
    "50",
)
query(
    "foundry-http",
    "HTTP calls to Foundry (private endpoint). 400s are the health check's planned no-cost probe",
    """
AppDependencies
| where Target endswith ".openai.azure.com" or Target endswith ".cognitiveservices.azure.com" or Target endswith ".services.ai.azure.com"
| extend Purpose = iff(OperationName == "GET /api/health", "Health probe (expected 400, no tokens)", "Agent model call")
| summarize Calls = count(), UnexpectedFailures = countif(Success == false and Purpose == "Agent model call"), P95ms = round(percentile(DurationMs, 95), 0)
    by Purpose, Deployment = extract(@"deployments/([^/]+)/", 1, Name), ResultCode
| order by Purpose asc, Calls desc
""",
    "table",
    "50",
    {"size": 1},
)

# ------------------------------------------------------- 3. Agents and tools
text(
    "traces",
    "## 3. Agents and tools\nEach agent run is one `invoke_agent bank-manager` span with `chat` (model), "
    "`acs.evaluate` (policy), and `execute_tool` child spans. Paste a **TraceId** into the *Answer review* "
    "workbook, or into Application Insights **Transaction search**, to see every step. "
    "**Good looks like:** tool success near 100% and policy checks under 50 ms.",
)
query(
    "agent-runs",
    "Recent agent runs (newest first)",
    f"""
AppDependencies
| where Name == "invoke_agent bank-manager"
| project TimeGenerated,
          Release = AppVersion,
          Mode = {prop("demo.mode")},
          Tool = {prop("demo.selected_tool", "bank_manager.selected_tool")},
          Baseline = {prop("demo.baseline.status", "bank_manager.baseline.status")},
          Governed = {prop("demo.governed.status", "bank_manager.governed.status")},
          Decision = {prop("demo.authz.outcome")},
          Rule = {prop("demo.governed.reason", "bank_manager.governed.reason")},
          Model = tostring(Properties["gen_ai.request.model"]),
          DurationMs = round(DurationMs, 0),
          Error = tostring(Properties["error.type"]),
          TraceId = OperationId,
          Conversation = tostring(Properties["gen_ai.conversation.id"])
| extend Rule = iff(Rule == "default", "(allowed, no rule needed)", Rule)
| top 50 by TimeGenerated desc
""",
)
query(
    "runs-per-agent",
    "Runs per agent",
    """
AppDependencies
| where Name startswith "invoke_agent"
| summarize Runs = count(), Failed = countif(Success == false), P95ms = round(percentile(DurationMs, 95), 0) by Agent = tostring(Properties["gen_ai.agent.name"])
""",
    "table",
    "50",
    {"size": 1},
)
query(
    "tool-success",
    "Tool calls: success rate and slowest tools (ms)",
    """
AppDependencies
| where Name startswith "execute_tool"
| extend Tool = tostring(Properties["gen_ai.tool.name"]), Lane = tostring(Properties["demo.lane"])
| summarize Calls = count(), SuccessPct = round(100.0 * countif(Success == true) / count(), 1), P95ms = round(percentile(DurationMs, 95), 1) by Tool, Lane
| order by P95ms desc
""",
    "table",
    "50",
    {"size": 1},
)
query(
    "span-breakdown",
    "Where time goes inside a run (ms per span type)",
    """
AppDependencies
| where Name startswith "invoke_agent" or Name startswith "chat " or Name startswith "acs.evaluate" or Name startswith "execute_tool"
| extend SpanType = case(Name startswith "invoke_agent", "1 invoke_agent (total)", Name startswith "chat ", "2 chat (model)", Name startswith "acs.evaluate", "3 acs.evaluate (policy)", "4 execute_tool")
| summarize Spans = count(), AvgMs = round(avg(DurationMs), 0), P95Ms = round(percentile(DurationMs, 95), 0) by SpanType
| order by SpanType asc
""",
    "table",
    "50",
    {
        "size": 1,
        "gridSettings": {
            "formatters": [
                {"columnMatch": "AvgMs", "formatter": 4, "formatOptions": {"palette": "blue"}},
                {"columnMatch": "P95Ms", "formatter": 4, "formatOptions": {"palette": "orange"}},
            ]
        },
    },
)
query(
    "tools",
    "Tools the AI model picked",
    f"""
AppDependencies
| where Name startswith "chat "
| summarize Count = count() by Tool = {prop("demo.selected_tool", "bank_manager.selected_tool")}
""",
    "piechart",
    "50",
)
query(
    "acs-latency",
    "Policy check time by checkpoint (ms)",
    """
AppDependencies
| where Name startswith "acs.evaluate" or Name startswith "execute_tool"
| summarize Count = count(), P50ms = round(percentile(DurationMs, 50), 1), P95ms = round(percentile(DurationMs, 95), 1) by Name
| order by Name asc
""",
    "table",
    "50",
)

# --------------------------------------------------- 4. Security boundaries
text(
    "gov",
    "## 4. Security boundaries (Agent Control Specification)\nThe governed lane must block what it should "
    "block. `denied_expected` means a rule stopped something it is meant to stop. `denied_unexpected` means "
    "something broke (for example, the policy engine failed) and needs a look. **Good looks like:** "
    "`denied_unexpected` is 0, and `denied_expected` is above 0 whenever someone tried a risky request. "
    "A missing expected denial is a problem, not a success.",
)
query(
    "authz",
    "Policy decisions: expected vs. unexpected denials, by boundary",
    """
AppEvents
| where Name == "policy_decision" and tostring(Properties.lane) == "governed"
| extend Outcome = tostring(Properties.authz_outcome)
| extend Outcome = iff(isempty(Outcome), case(tostring(Properties.status) == "deny", iff(tostring(Properties.reason) startswith "runtime_error", "denied_unexpected", "denied_expected"), tostring(Properties.status) == "approval", "approval_required", "allowed"), Outcome)
| summarize Count = count() by bin(TimeGenerated, 15m), Outcome
""",
    "barchart",
    "50",
    {
        "chartSettings": {
            "seriesLabelSettings": [
                {"seriesName": "denied_unexpected", "color": "redBright"},
                {"seriesName": "denied_expected", "color": "orange"},
                {"seriesName": "approval_required", "color": "yellow"},
                {"seriesName": "allowed", "color": "green"},
            ]
        }
    },
)
query(
    "decisions",
    "Lane results: no-rules lane vs. governed lane",
    """
AppEvents
| where Name == "policy_decision"
| summarize Count = count() by Lane = tostring(Properties.lane), Status = tostring(Properties.status)
""",
    "barchart",
    "50",
    {
        "chartSettings": {
            "xAxis": "Lane",
            "yAxis": ["Count"],
            "group": "Status",
            "createOtherGroup": 0,
        }
    },
)
query(
    "reasons",
    "Governed decisions by rule",
    """
AppEvents
| where Name == "policy_decision" and tostring(Properties.lane) == "governed"
| extend Rule = iff(tostring(Properties.reason) == "default", "(allowed, no rule needed)", tostring(Properties.reason))
| summarize Count = count() by Rule, Status = tostring(Properties.status), Tool = tostring(Properties.tool)
| order by Count desc
""",
    "table",
    "50",
)
query(
    "prevented",
    "Tool calls the no-rules lane ran but policy stopped",
    """
AppEvents
| where Name == "policy_decision"
| extend Lane = tostring(Properties.lane), Tool = tostring(Properties.tool), Executed = tostring(Properties.tool_executed) =~ "true"
| summarize NoRulesRan = countif(Lane == "baseline" and Executed), GovernedRan = countif(Lane == "governed" and Executed) by Tool
| extend PreventedByPolicy = NoRulesRan - GovernedRan
| where Tool != "unsupported"
| order by PreventedByPolicy desc
""",
    "table",
    "50",
)
query(
    "acs-metrics",
    "ACS runtime metrics (acs_intervention_*)",
    """
AppMetrics
| where Name startswith "acs_intervention"
| summarize Total = sum(Sum), Samples = sum(ItemCount) by Name
| extend Value = iff(Name endswith "_ms", round(Total / Samples, 1), Total), Meaning = iff(Name endswith "_ms", "average ms per policy check", "decisions")
| project Name, Value, Meaning, Samples
| order by Name asc
""",
    "table",
    "50",
    {"size": 1},
)
query(
    "approvals",
    "Human Approve / Reject decisions",
    """
AppEvents
| where Name == "approval_decision"
| summarize Count = count() by Decision = tostring(Properties.decision), Outcome = tostring(Properties.status), Tool = tostring(Properties.tool)
""",
    "table",
    "50",
    {"size": 1},
)
query(
    "rate-limits",
    "Rate-limit responses from the app (HTTP 429 to visitors)",
    """
AppEvents
| where Name == "rate_limited"
| summarize Count = count() by bin(TimeGenerated, 15m), Scope = tostring(Properties.scope)
""",
    "barchart",
    "50",
)

# ------------------------------------------------------- 5. Azure services
text(
    "azure",
    "## 5. Azure services\nErrors, throttling, and latency from each resource's own diagnostic logs: "
    "Azure AI Foundry, Container Registry, and Container Apps. This demo uses no AI Search, Storage, "
    "Cosmos DB, or Key Vault (not used). **Good looks like:** no 429 or 5xx rows, and no restart loops.",
)
query(
    "foundry-logs",
    "Foundry diagnostic logs (400s are the health probe)",
    """
AzureDiagnostics
| where ResourceProvider == "MICROSOFT.COGNITIVESERVICES"
| summarize Requests = count(), AvgDurationMs = round(avg(DurationMs), 0) by Category, OperationName, ResultSignature
| order by Requests desc
""",
    "table",
    "50",
)
query(
    "registry",
    "Container Registry: image pulls and pushes",
    """
ContainerRegistryRepositoryEvents
| summarize Count = count(), Failed = countif(toint(ResultDescription) >= 400), Last = max(TimeGenerated) by OperationName, Repository
| order by Last desc
""",
    "table",
    "50",
)
query(
    "replicas",
    "Container Apps system events (scale, restarts)",
    """
ContainerAppSystemLogs
| summarize Count = count(), Last = max(TimeGenerated) by Reason, Type
| order by Count desc
""",
    "table",
    "50",
)
query(
    "console",
    "Container console warnings and errors",
    """
ContainerAppConsoleLogs
| where Log has_any ("ERROR", "Traceback", "WARNING", "Exception")
| project TimeGenerated, RevisionName, Log = substring(Log, 0, 300)
| top 50 by TimeGenerated desc
""",
    "table",
    "50",
)

# ---------------------------------------------------------------- 6. Health
text(
    "health",
    "## 6. Health\nResults of the app's health checks (`health_check` events), the same checks the public "
    "*Health* page shows. **Good looks like:** every critical part is `healthy`.",
)
query(
    "health-time",
    "Health check results over time",
    """
AppEvents
| where Name == "health_check"
| summarize Checks = count() by bin(TimeGenerated, 15m), Result = strcat(tostring(Properties.component), ": ", tostring(Properties.status))
""",
    "barchart",
    "50",
)
query(
    "health-latest",
    "Latest result per part",
    """
AppEvents
| where Name == "health_check"
| summarize arg_max(TimeGenerated, *) by Component = tostring(Properties.component)
| project Component, Status = tostring(Properties.status), Critical = tostring(Properties.critical), Checked = TimeGenerated
""",
    "table",
    "50",
    {"size": 1},
)

# ------------------------------------------------------- 7. Recent failures
text(
    "failures",
    "## 7. Recent failures\nThe latest failed operations with their trace IDs. Paste a **TraceId** into the "
    "*Answer review* workbook, or open Application Insights > **Transaction search** and search for it to "
    "see the end-to-end timeline. **Good looks like:** this list is empty.",
)
query(
    "failed-ops",
    "Failed requests and steps (newest first)",
    """
union (AppRequests | where Success == false and Name != "GET /api/health/live"), (AppDependencies | where Success == false and OperationName != "GET /api/health")
| project TimeGenerated, Kind = Type, Name, Code = ResultCode, DurationMs = round(DurationMs, 0), Release = AppVersion, TraceId = OperationId
| top 50 by TimeGenerated desc
""",
)
query(
    "exceptions",
    "Exceptions",
    """
AppExceptions
| summarize Count = count(), Last = max(TimeGenerated), TraceId = take_any(OperationId) by ExceptionType, OuterMessage = substring(OuterMessage, 0, 120)
| order by Count desc
""",
)

workbook = {
    "version": "Notebook/1.0",
    "items": items,
    "fallbackResourceIds": ["__WORKSPACE_ID__"],
    "$schema": "https://github.com/Microsoft/Application-Insights-Workbooks/blob/master/schema/workbook.json",
}

OUT.parent.mkdir(parents=True, exist_ok=True)
OUT.write_text(json.dumps(workbook, indent=2) + "\n", encoding="utf-8", newline="\n")
print(f"Wrote {OUT.relative_to(OUT.parents[2])} with {len(items)} items")
