# Data flow

## In plain language

Your request goes to the web app. The app asks the AI which tool fits. Then
the app runs that tool twice — once with no checks, and once through three
policy checks — and streams each step back so you can watch it happen. Nothing
you type is saved on the server.

## Step by step

1. **Browser → `POST /api/compare`** with `prompt` (≤ 500 characters), persona ID,
   model key, and three policy toggles. The body must be ≤ 8 KB. The random
   browser GUID travels in the `X-Demo-Session` header for rate limiting only.
2. **Validation.** Unknown fields, personas, or models are rejected (400).
   The persona’s role and assigned accounts are looked up **on the server**, so
   the browser cannot grant itself access.
3. **Model routing.** The backend calls the selected Azure OpenAI deployment
   with the system prompt from
   [`config/prompts/intent-router.system.md`](../../config/prompts/intent-router.system.md)
   and a structured-output schema (`BankIntent`). The model returns one intent
   and arguments. Account IDs must match `A-<digits>` or the call fails.
4. **Baseline lane.** The tool runs immediately with no checks
   (intentionally unsafe, synthetic data only).
5. **Governed lane.** ACS evaluates three intervention points:
   - `input` — blocks manipulation language and PII-shaped input;
   - `pre_tool_call` — assignment, role, restricted mode, limits, approvals;
   - `post_tool_call` — redacts SSN- and card-shaped values.
6. **Streaming.** Each step is sent as one NDJSON line with an increasing `seq`.
   The browser ignores duplicates and treats 45 s of silence as a stall.
7. **Approval (optional).** If ACS returns `escalate`, the browser shows
   Approve/Reject. `POST /api/approval` re-validates the action and re-runs ACS.
   Hard denials (for example, over $50,000) still deny after approval.
8. **Telemetry.** Only allow-listed operational fields (event name, status,
   reason code, tool name, token counts, duration, model) go to Application
   Insights. See [events](../telemetry/events.md).

## Data at rest

| Data | Where | Retention |
|---|---|---|
| Alias, GUID, settings, up to 10 chats × 20 turns | Browser `localStorage` | Until Reset demo / Reset profile |
| Operational telemetry (no prompts or results) | Application Insights / Log Analytics | 30 days |
| Container logs (no prompts or results) | Log Analytics | 30 days |
| Prompts and tool results | Nowhere on the server | Not stored |
