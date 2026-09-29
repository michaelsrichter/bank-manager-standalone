# Rate limiting and abuse controls

## In plain language

To stop anyone from running up a big AI bill, each visitor can only send a few
requests per minute, and every request has a size limit.

## Limits

| Control | Value | Where |
|---|---|---|
| Requests per IP per minute (`/api/compare`, `/api/approval`) | 20 | `RATE_LIMIT_PER_IP_PER_MINUTE` |
| Requests per browser session per minute | 10 | `RATE_LIMIT_PER_SESSION_PER_MINUTE` (keyed by `X-Demo-Session` GUID) |
| Request body size | 8 KB; `Content-Length` required | `MAX_REQUEST_BYTES` |
| Prompt length | 500 characters | `MAX_PROMPT_CHARS` |
| Model output | 200 tokens, temperature 0 | `config/models.json` |
| Model timeout / retries | 20 s / 1 retry | `config/models.json` |
| Streamed text per lane | 1,000 characters | `comparison.MAX_TEXT_CHARS` |
| Browser stall timeout | 45 s | `frontend/src/lib/api.ts` |
| Stored browser history | 10 chats × 20 turns | `frontend/src/demo/state.ts` |
| Replicas | 0–2 | `infra/resources.bicep` |
| Foundry capacity | 30K tokens/minute per deployment | `config/models.json` |
| Budget | USD 50/month with alerts | `infra/resources.bicep` |

Exceeding a limit returns **HTTP 429** with `Retry-After`; the UI shows a
designed “slow down” state. Each 429 emits a `rate_limited` event.

## Known limitation

Limits are held in memory per replica (sliding 60-second window, capped at 10,000
keys). With the maximum of two replicas, the effective ceiling can be up to 2×.
The Foundry TPM quota and budget alert are the hard backstops. See the
[threat model](threat-model.md) for the remediation path.
