# Cost at scale

## In plain language

Fixed costs stay about the same as usage grows. Only the AI tokens, compute
time, and logs grow — and the cheaper “mini” model cuts AI cost by about 80%.

| Usage | Requests/month | AI (GPT-4.1) | AI (GPT-4.1 mini) | Container Apps | Logs | Fixed | Total (GPT-4.1) |
|---|---|---|---|---|---|---|---|
| Today | 1,000 | ~$1 | ~$0.20 | ~$3 (weekday warm hours) | ~$0 | ~$14 | **~$18–23** |
| 10× | 10,000 | ~$9 | ~$2 | ~$3–6 | ~$1–3 | ~$14 | **~$28–33** |
| 100× | 100,000 | ~$94 | ~$19 | ~$10–25 | ~$5–10 | ~$14 | **~$125–145** |

Assumptions: ~350 input and ~30 output tokens per request; ~1 second of 0.5 vCPU
/ 1 GiB per request; fixed = private endpoint + DNS + ACR Basic.

## What to change as usage grows

- **10×:** nothing required. Consider making GPT-4.1 mini the default in
  `config/models.json`.
- **100×:** raise `AZURE_MONTHLY_BUDGET_USD`, raise deployment capacity in
  `config/models.json`, move rate limiting to a shared store (API Management or
  Redis), and consider `minReplicas: 1` to remove cold starts at all hours
  (about $10–11/month at 0.5 vCPU / 1 GiB; today one replica is warm only on
  weekdays, 8 AM–8 PM ET — see [ADR 0015](../adr/0015-weekday-warm-hours.md)).
- Per-session rate limits (10/minute) cap how fast any one visitor can add cost.
