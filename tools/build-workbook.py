#!/usr/bin/env python3
"""Generate infra/workbooks/bank-manager-telemetry.workbook.json.

Run after editing a query: python tools/build-workbook.py
The Bicep template loads the JSON with loadTextContent and substitutes the
Log Analytics workspace ID for __WORKSPACE_ID__.
"""

from __future__ import annotations

import json
from pathlib import Path

OUT = (
    Path(__file__).resolve().parents[1]
    / "infra"
    / "dashboards"
    / "demo-overview.workbook.json"
)
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

text("ai", "## 1. AI model calls (Azure AI Foundry)")
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
    "Model call latency (ms) — from GenAI `chat` spans",
    """
AppDependencies
| where Name startswith "chat "
| summarize Calls = count(), Failures = countif(Success == false), P50 = percentile(DurationMs, 50), P95 = percentile(DurationMs, 95), Max = max(DurationMs)
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
| summarize CostUSD = sum(todouble(Properties.estimated_cost_usd)) by bin(TimeGenerated, 15m), Deployment = tostring(Properties.deployment)
""",
    "barchart",
    "50",
)
query(
    "foundry-http",
    "HTTP calls to Foundry (httpx, private endpoint) — 400s are the health check's intentional no-inference probe",
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
query(
    "foundry-logs",
    "Foundry diagnostic logs (RequestResponse / usage / audit) — 400s are the health probe",
    """
AzureDiagnostics
| where ResourceProvider == "MICROSOFT.COGNITIVESERVICES"
| summarize Requests = count(), AvgDurationMs = round(avg(DurationMs), 0) by Category, OperationName, ResultSignature
| order by Requests desc
""",
    "table",
)

text("gov", "## 2. Governance (Agent Control Specification)")
query(
    "decisions",
    "Lane results: unsafe baseline vs. governed",
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
    "Tool calls the unsafe lane ran but policy stopped",
    """
AppEvents
| where Name == "policy_decision"
| extend Lane = tostring(Properties.lane), Tool = tostring(Properties.tool), Executed = tostring(Properties.tool_executed) =~ "true"
| summarize BaselineRan = countif(Lane == "baseline" and Executed), GovernedRan = countif(Lane == "governed" and Executed) by Tool
| extend PreventedByPolicy = BaselineRan - GovernedRan
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
| extend Value = iff(Name endswith "_ms", round(Total / Samples, 1), Total), Meaning = iff(Name endswith "_ms", "average ms per policy evaluation", "decisions")
| project Name, Value, Meaning, Samples
| order by Name asc
""",
    "table",
    "50",
    {"size": 1},
)
query(
    "acs-latency",
    "Policy evaluation latency by intervention point (ms)",
    """
AppDependencies
| where Name startswith "acs.evaluate" or Name startswith "execute_tool"
| summarize Count = count(), P50 = percentile(DurationMs, 50), P95 = percentile(DurationMs, 95) by Name
| order by Name asc
""",
    "table",
    "50",
)
query(
    "approvals",
    "Human approval decisions",
    """
AppEvents
| where Name == "approval_decision"
| summarize Count = count() by Decision = tostring(Properties.decision), Outcome = tostring(Properties.status), Tool = tostring(Properties.tool)
""",
    "table",
    "50",
    {"size": 1},
)

text(
    "traces",
    "## 3. Agent runs (OpenTelemetry GenAI traces)\nEach row is one `invoke_agent bank-manager` span. "
    "Open *Application Insights → Transaction search* with the operation ID (also shown as **Trace ID** in the app) to see the full span tree.",
)
query(
    "agent-runs",
    "Recent agent runs",
    """
AppDependencies
| where Name == "invoke_agent bank-manager"
| project TimeGenerated,
          Tool = tostring(Properties["bank_manager.selected_tool"]),
          Baseline = tostring(Properties["bank_manager.baseline.status"]),
          Governed = tostring(Properties["bank_manager.governed.status"]),
          Rule = tostring(Properties["bank_manager.governed.reason"]),
          Model = tostring(Properties["gen_ai.request.model"]),
          DurationMs = round(DurationMs, 0),
          Error = tostring(Properties["error.type"]),
          TraceId = OperationId
| extend Rule = iff(Rule == "default", "(allowed, no rule needed)", Rule)
| top 50 by TimeGenerated desc
""",
)
query(
    "span-breakdown",
    "Where time goes inside a run (avg ms per span type)",
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
    "Tools selected by the model",
    """
AppDependencies
| where Name startswith "chat "
| summarize Count = count() by Tool = tostring(Properties["bank_manager.selected_tool"])
""",
    "piechart",
    "50",
)

text("app", "## 4. Application and platform health")
query(
    "requests",
    "Requests by route (health probes excluded)",
    """
AppRequests
| where Name != "GET /api/health/live"
| extend Name = iff(Name startswith "GET /" and not(Name startswith "GET /api"), "GET (pages and assets)", Name)
| summarize Requests = count(), Failed = countif(Success == false), P50ms = percentile(DurationMs, 50), P95ms = percentile(DurationMs, 95) by Name, ResultCode
| order by Requests desc
""",
    "table",
    "50",
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
    "client-timing",
    "Browser-measured streaming latency (opt-in analytics)",
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
    "Page views (opt-in analytics)",
    """
AppEvents
| where Name == "page_view"
| summarize Views = count() by Page = tostring(Properties.page)
""",
    "piechart",
    "50",
)
query(
    "exceptions",
    "Exceptions",
    """
AppExceptions
| summarize Count = count(), Last = max(TimeGenerated) by ExceptionType, OuterMessage = substring(OuterMessage, 0, 120)
| order by Count desc
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
