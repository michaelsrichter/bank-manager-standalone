# Telemetry events

## In plain language

The app records *that* something happened (for example, “a request was
blocked by rule `account_access_denied`”), never *what you typed* or *what the
account said*.

All events go to **Azure Application Insights** (`customEvents` table) through
OpenTelemetry, authenticated with the app’s managed identity. Retention: 30 days.
Only the properties listed below can be sent — the allow-list lives in
[`backend/bank_manager/telemetry.py`](../../backend/bank_manager/telemetry.py) and
any other key is dropped (`test_safe_properties_drops_unknown_and_complex_values`).

| Event | Trigger | Properties | Anonymous? |
|---|---|---|---|
| `page_view` | Page opened, **only after analytics opt-in** | `page` (one of home, demo, health, docs, privacy, terms) | Yes |
| `model_selection` | Each comparison request | `model_key`, `deployment` | Yes |
| `ai_call` | Each model routing call (success or failure) | `deployment`, `response_model`, `status`, `duration_ms`, `input_tokens`, `cached_input_tokens`, `output_tokens`, `reasoning_tokens`, `estimated_cost_usd`, `fake_ai` | Yes |
| `policy_decision` | Each lane result (2 per request) | `lane`, `status`, `reason`, `tool`, `intervention_point`, `tool_executed` | Yes |
| `approval_decision` | Approve / Reject clicked | `decision`, `status`, `reason`, `tool` | Yes |
| `rate_limited` | A 429 is returned | `scope` (ip/session), `route` | Yes |
| `client_timing` | A streamed comparison finishes, **only after analytics opt-in** | `first_event_ms`, `total_ms`, `event_count`, `outcome`, `model_key` | Yes |

Also collected via OpenTelemetry (details in [observability.md](observability.md)): HTTP
request spans, GenAI agent spans (`invoke_agent`, `chat`, `acs.evaluate`, `execute_tool`),
httpx dependency spans to Foundry, GenAI and ACS metrics, Python logs, and exceptions.
Request bodies are not captured. The W3C trace ID is shown in the UI evidence panel so a
run can be found in Application Insights.

## Never recorded

Prompt text, model output, tool results, account data, the browser GUID,
IP addresses in custom events, tokens, or credentials.

## Example query

```kusto
customEvents
| where name == "policy_decision"
| extend lane = tostring(customDimensions.lane), reason = tostring(customDimensions.reason)
| summarize count() by lane, reason
```
