# API

The backend exposes a small JSON/NDJSON API. The machine-readable contract is
[`openapi.json`](openapi.json) (generated from FastAPI with `make openapi`).

| Method | Path | Purpose |
|---|---|---|
| GET | `/api/config` | Models, personas, scenarios, limits |
| POST | `/api/compare` | Stream one comparison as NDJSON |
| POST | `/api/approval` | Approve or reject a paused governed action |
| GET | `/api/health` | Health snapshot (200 / 503) |
| GET | `/api/health/live` | Liveness |
| POST | `/api/telemetry/page-view` | Anonymous page view (opt-in only) |

All POSTs require `Content-Length` ≤ 8 KB and reject unknown fields. Send the
browser GUID in `X-Demo-Session` for per-session rate limiting.

## `POST /api/compare`

```json
{
  "prompt": "Show account A-2001",
  "personaId": "M-101",
  "modelKey": "gpt-4.1",
  "policyState": { "restrictedMode": false, "customerApproved": false, "adminMode": false }
}
```

Response: `application/x-ndjson`, one event per line, `seq` strictly increasing.

| `type` | Fields |
|---|---|
| `run.started` | `traceId`, `model {key,label,deployment}` |
| `step` | `id` (`route`, `baseline`, `governed.input`, `governed.pre_tool`, `governed.tool`), `state` (`started`/`completed`/`failed`), optional `status` |
| `model.usage` | `requestedDeployment`, `responseModel`, `usage {inputTokens, cachedInputTokens, outputTokens, reasoningTokens}`, `cost {currency,totalUsd,confidence,…}`, `durationMs`, `fakeAi` |
| `tool.selected` | `action {tool_name, args}` or `null` |
| `lane.result` | `result {lane, status, reason, message, text, toolExecuted, interventionPoint, policyDecision, action}` |
| `run.completed` | `traceId` |
| `error` | `code` (`content_filtered`, `model_busy`, `model_failed`, `internal_error`), `message`, `traceId` — always terminal |

`status` values: `allow`, `transform` (allowed with redaction), `deny`,
`approval` (escalated to a human), `info` (no tool matched).

## `POST /api/approval`

```json
{
  "action": { "tool_name": "prepare_transfer", "args": { "account_id": "A-1001", "amount": 12000 } },
  "personaId": "M-101",
  "policyState": { "restrictedMode": false, "customerApproved": false, "adminMode": false },
  "decision": "approve"
}
```

Returns `{ "result": <lane result>, "traceId": "…" }`. The action is re-validated
and re-evaluated by ACS; approval cannot override a hard denial.
