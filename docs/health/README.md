# Health

## In plain language

The Health page tests the parts the demo depends on and explains the result in
plain words. It never asks the AI a question, so checking health is free.

## Endpoints

| Path | Purpose | Status codes |
|---|---|---|
| `/#/health` | Human page; polls every 60 s; pauses while the tab is hidden | — |
| `GET /api/health` | Machine-readable snapshot (cached 60 s, concurrent calls coalesced) | 200 ready, 503 not ready |
| `GET /api/health/live` | Liveness/readiness probe for Container Apps (no dependencies) | 200 |

## Components and probes

| Component | Critical? | Probe | Healthy means |
|---|---|---|---|
| ACS policy engine | Yes | **Expected-denial probe:** evaluates `read_account A-2001` as Riley | Denied with exactly `account_access_denied`. Any other result is `misconfigured`. |
| Model deployment: GPT-4.1 (default) | Yes | **No-inference probe:** `chat.completions` with `messages: []` | HTTP 400 validation error → `available` (proves DNS, private network, Entra auth, deployment exist) |
| Model deployment: GPT-4.1 mini | No | Same | Same |
| Application Insights | No | Configuration only | `configured` when a connection string is present |

In `FAKE_AI=1` mode, the model probe reports `configured` and makes no call.

## Status meanings

| Status | Meaning |
|---|---|
| `healthy` | Exercised and behaved exactly as expected (including expected denials) |
| `available` | Answered an authenticated no-inference probe |
| `configured` | Settings present; not actively probed |
| `degraded` | Reachable but throttling (429) or unexpected response |
| `unreachable` | No response (network/DNS) |
| `misconfigured` | Answered with 401/403 (identity) or 404 (deployment) |

Overall: `ready` when every critical component is healthy/available/configured
and nothing is degraded; `degraded` when critical parts are fine but something
optional is not; `not_ready` otherwise (HTTP 503).

## Safety

Responses contain only component names, statuses, and short fixed explanations.
No endpoints, principal IDs, tokens, or raw downstream errors are returned.
The page uses a page-level error boundary and renders missing fields as “—”.

Probe cost: zero tokens.
