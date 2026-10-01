# Cost to run

## In plain language

Running this demo costs about **USD 15–20 per month** when a few people use it.
Most of that is fixed networking and the container registry. The AI part costs
about **one-tenth of a cent per request**.

## Monthly estimate (eastus2, list prices, light use ≈ 1,000 requests)

| Item | Basis | Est. USD/month |
|---|---|---|
| Private endpoint (Foundry) | ~$0.01/hour | 7.30 |
| Private DNS zones × 3 | $0.50/zone | 1.50 |
| Container Registry, Basic | ~$0.167/day | 5.00 |
| ACR Tasks builds | ~15 min/build × a few builds | < 0.50 |
| Container Apps (Consumption, scale to zero) | Within monthly free grant (180K vCPU-s, 360K GiB-s, 2M requests) | 0–2 |
| Azure OpenAI tokens | ~350 input + ~30 output tokens/request × 1,000 (GPT-4.1) | ~0.95 |
| Log Analytics / App Insights | < 1 GB/month; 1 GB/day cap | 0–3 |
| Metric alert, action group, VNet, identity | | < 0.50 |
| Foundry Evaluations | About $0.04 per run, only when a presenter starts one (at most 10 a day) | 0–1 |
| **Total** | | **≈ 15–20** |

Per-request model cost (from [`config/models.json`](../../config/models.json)):

- GPT-4.1: 350 × $2.00/1M + 30 × $8.00/1M ≈ **$0.00094**
- GPT-4.1 mini: 350 × $0.40/1M + 30 × $1.60/1M ≈ **$0.00019**

The UI shows the estimated cost of every request, computed from real token
counts and these prices. Cached input tokens are billed at the cached rate;
reasoning tokens are part of output and are not counted twice.

Health checks never run inference, so they cost nothing.

One [evaluation run](../evaluations/README.md#cost) costs about **$0.04**: 17
answers on GPT-4.1 (≈ $0.016) and 36 judge calls on GPT-4.1 mini (≈ $0.022).
Nothing is charged between runs; the demo does not use continuous evaluation.

## Guardrails

- Budget: USD 50/month (`AZURE_MONTHLY_BUDGET_USD`), email at 80% actual and
  100% forecast.
- Hard caps: 30K TPM per deployment, max 2 replicas, rate limits, 200 max output tokens.
- Scale to zero when idle (first request after idle takes a few seconds).

## Pricing references

- [Azure OpenAI pricing](https://azure.microsoft.com/pricing/details/cognitive-services/openai-service/)
- [Container Apps pricing](https://azure.microsoft.com/pricing/details/container-apps/)
- [Container Registry pricing](https://azure.microsoft.com/pricing/details/container-registry/)
- [Private Link pricing](https://azure.microsoft.com/pricing/details/private-link/)
- [Azure DNS pricing](https://azure.microsoft.com/pricing/details/dns/)
- [Azure Monitor pricing](https://azure.microsoft.com/pricing/details/monitor/)

Prices change; check the links above before quoting numbers.
