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
| `policy_decision` | Each lane result (2 per request) | `lane`, `status`, `reason`, `tool`, `intervention_point`, `tool_executed`, `authz_outcome` | Yes |
| `approval_decision` | Approve / Reject clicked | `decision`, `status`, `reason`, `tool` | Yes |
| `rate_limited` | A 429 is returned | `scope` (ip/session), `route` | Yes |
| `client_timing` | A streamed comparison finishes, **only after analytics opt-in** | `first_event_ms`, `total_ms`, `event_count`, `outcome`, `model_key` | Yes |
| `health_check` | The health check refreshes (at most once a minute) | `component`, `status`, `critical` | Yes |

Every event also carries the request context below, when there is one.

## Request context on every span and event

| Attribute | Example | Meaning |
|---|---|---|
| `gen_ai.conversation.id` | `3f2c7b1e-…` | The chat. The browser makes a random ID for each chat and sends it in the `X-Conversation-Id` header. It is not tied to a person, and **New chat** makes a new one. |
| `demo.mode` | `live` or `practice` | Practice uses saved answers, not the AI model (`#/demo?mode=practice`). |
| `demo.journey` | `ask`, `approve`, `health` | Which part of the demo the request belongs to. |
| `service.version` | `b54b0a4` | The Git commit, the same as the site footer. Stored as `application_Version` (`AppVersion` in Log Analytics). |
| `deployment.environment.name` | `demo` or `local` | Keeps local runs off the demo dashboards. |

Span attributes added by the agent harness use the `demo.*` prefix (older data used
`bank_manager.*`): `demo.lane`, `demo.status`, `demo.reason`, `demo.selected_tool`,
`demo.tool_executed`, `demo.cost.estimated_usd`, `demo.boundary` (`bank-accounts`), and
`demo.authz.outcome`.

`demo.authz.outcome` (and the `authz_outcome` event property) says what the policy did:

| Value | Meaning |
|---|---|
| `allowed` | The rules let the tool call run, maybe with private data hidden. |
| `approval_required` | A person must click Approve first. |
| `denied_expected` | A rule blocked something it is meant to block. This is the demo working. |
| `denied_unexpected` | Something broke, for example the policy engine failed (`runtime_error*`). Look into it. |
| `not_checked` | The no-rules lane, shown only for comparison. |

IDs stay off metrics, so metrics stay small and cheap. Metrics are named
`demo.ai.estimated_cost`, `demo.policy.decisions`, and `demo.tool.executions`.

Also collected via OpenTelemetry (details in [observability.md](observability.md)): HTTP
request spans, GenAI agent spans (`invoke_agent`, `chat`, `acs.evaluate`, `execute_tool`),
httpx dependency spans to Foundry, GenAI and ACS metrics, Python logs, and exceptions.
Request bodies are not captured. Each answer has a closed-by-default **IDs and
observability links** panel with its trace ID and conversation ID, so the run can be
found in Application Insights. See
[observability.md](observability.md#review-one-answer-or-one-chat).

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
