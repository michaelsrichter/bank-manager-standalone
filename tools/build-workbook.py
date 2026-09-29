#!/usr/bin/env python3
"""Generate infra/workbooks/bank-manager-telemetry.workbook.json.

Run after editing a query: python tools/build-workbook.py
The Bicep template loads the JSON with loadTextContent and substitutes the
Log Analytics workspace ID for __WORKSPACE_ID__.
"""

from __future__ import annotations

import json
from pathlib import Path

OUT = Path(__file__).resolve().parents[1] / "infra" / "workbooks" / "bank-manager-telemetry.workbook.json"
WORKSPACE = "microsoft.operationalinsights/workspaces"

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
        "tileSettings": {
            "titleContent": {"columnMatch": "Metric"},
            "leftContent": {
                "columnMatch": "Value",
                "formatter": 12,
                "formatOptions": {"palette": "auto"},
                "numberFormat": {"unit": 17, "options": {"maximumSignificantDigits": 4}},
            },
            "showBorder": True,
        }
    },
)

text("ai", "## 1. AI model calls (Azure AI Foundry)")
query(
    "calls-by-model",
    "Model calls by deployment",
    """
AppDependencies
| where Name startswith "chat "
| summarize Calls = count() by bin(TimeGenerated, 15m), Deployment = tostring(Properties["gen_ai.request.model"])
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
            Output = sum(toint(Properties.output_tokens)), Reasoning = sum(toint(Properties.reasoning_tokens)) by bin(TimeGenerated, 15m), Deployment
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
)
query(
    "cost",
    "Estimated cost (USD) by deployment",
    """
AppEvents
| where Name == "ai_call"
| summarize CostUSD = sum(todouble(Properties.estimated_cost_usd)) by bin(TimeGenerated, 1h), Deployment = tostring(Properties.deployment)
""",
    "barchart",
    "50",
)
query(
    "foundry-http",
    "HTTP calls to Foundry (httpx instrumentation, private endpoint)",
    """
AppDependencies
| where Target endswith ".openai.azure.com" or Target endswith ".cognitiveservices.azure.com" or Target endswith ".services.ai.azure.com"
| summarize Calls = count(), Failures = countif(Success == false), P95ms = percentile(DurationMs, 95) by Name, ResultCode
| order by Calls desc
""",
    "table",
    "50",
)
query(
    "foundry-metrics",
    "Foundry platform metrics (Azure Monitor)",
    """
AzureMetrics
| where ResourceProvider == "MICROSOFT.COGNITIVESERVICES"
| where MetricName in ("ProcessedPromptTokens", "GeneratedTokens", "AzureOpenAIRequests", "ModelRequests", "TokenTransaction")
| summarize Total = sum(Total) by bin(TimeGenerated, 15m), MetricName
""",
    "timechart",
    "50",
)
query(
    "foundry-logs",
    "Foundry diagnostic logs (RequestResponse / usage / audit)",
    """
AzureDiagnostics
| where ResourceProvider == "MICROSOFT.COGNITIVESERVICES"
| summarize Requests = count(), AvgDurationMs = avg(DurationMs) by Category, OperationName, ResultSignature
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
    {"chartSettings": {"xAxis": "Lane", "yAxis": ["Count"], "group": "Status", "createOtherGroup": 0}},
)
query(
    "reasons",
    "Governed decisions by rule",
    """
AppEvents
| where Name == "policy_decision" and tostring(Properties.lane) == "governed"
| summarize Count = count() by Rule = tostring(Properties.reason), Status = tostring(Properties.status), Tool = tostring(Properties.tool)
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
| summarize Value = sum(Sum), Samples = sum(ItemCount) by Name
| order by Name asc
""",
    "table",
    "50",
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
| project TimeGenerated, TraceId = OperationId, DurationMs,
          Model = tostring(Properties["gen_ai.request.model"]),
          Tool = tostring(Properties["bank_manager.selected_tool"]),
          Baseline = tostring(Properties["bank_manager.baseline.status"]),
          Governed = tostring(Properties["bank_manager.governed.status"]),
          Rule = tostring(Properties["bank_manager.governed.reason"]),
          Error = tostring(Properties["error.type"])
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
| summarize AvgMs = avg(DurationMs), P95Ms = percentile(DurationMs, 95) by SpanType
| order by SpanType asc
""",
    "barchart",
    "50",
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
    "Requests by route",
    """
AppRequests
| summarize Requests = count(), Failed = countif(Success == false), P50ms = percentile(DurationMs, 50), P95ms = percentile(DurationMs, 95) by Name, ResultCode
| order by Requests desc
""",
    "table",
    "50",
)
query(
    "requests-time",
    "Requests over time by result code",
    """
AppRequests
| summarize Requests = count() by bin(TimeGenerated, 15m), ResultCode
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
