# Azure services

All resources are created by [`infra/`](../../infra/main.bicep) in one resource
group and tagged `demo=true`, `owner`, `partner=none`, `cost-center=eps-ai-demos`.

| Service | Why | Security posture | Docs · Pricing |
|---|---|---|---|
| Azure Container Apps (Consumption, workload-profiles environment) | Runs one container with the API, policy engine, OPA binary, and static SPA. Scales to zero. | VNet-integrated; user-assigned managed identity; HTTPS only | [Docs](https://learn.microsoft.com/azure/container-apps/) · [Pricing](https://azure.microsoft.com/pricing/details/container-apps/) |
| Azure AI Foundry (AIServices account) with `gpt-4.1` and `gpt-4.1-mini` Global Standard deployments | Turns plain language into one structured tool call | `disableLocalAuth: true` (Entra ID only), private endpoint for the app, `Microsoft.DefaultV2` content filters. The public endpoint accepts Entra-only traffic so Foundry's evaluation service can grade runs ([ADR 0014](../adr/0014-foundry-public-endpoint-for-evaluations.md)) | [Docs](https://learn.microsoft.com/azure/ai-foundry/) · [Pricing](https://azure.microsoft.com/pricing/details/cognitive-services/openai-service/) |
| Private endpoint + private DNS zones (`cognitiveservices`, `openai`, `services.ai`) | Keeps model traffic off the public internet | Linked only to the demo VNet | [Docs](https://learn.microsoft.com/azure/private-link/) · [Pricing](https://azure.microsoft.com/pricing/details/private-link/) |
| Virtual network | Hosts the Container Apps subnet and private endpoint subnet | No public IPs of its own | [Docs](https://learn.microsoft.com/azure/virtual-network/) |
| Azure Container Registry (Basic) | Stores the image built by ACR Tasks | Admin user and anonymous pull disabled; pull via managed identity (`AcrPull`) | [Docs](https://learn.microsoft.com/azure/container-registry/) · [Pricing](https://azure.microsoft.com/pricing/details/container-registry/) |
| User-assigned managed identity | The app’s only credential | Roles: `AcrPull`, `Cognitive Services OpenAI User`, `Monitoring Metrics Publisher` | [Docs](https://learn.microsoft.com/entra/identity/managed-identities-azure-resources/) |
| Application Insights (workspace-based) | Operational telemetry and traces | **Local auth disabled** (Entra-only ingestion) | [Docs](https://learn.microsoft.com/azure/azure-monitor/app/app-insights-overview) · [Pricing](https://azure.microsoft.com/pricing/details/monitor/) |
| Log Analytics workspace | Stores logs for 30 days, 1 GB/day cap | Diagnostic settings from Container Apps | [Docs](https://learn.microsoft.com/azure/azure-monitor/logs/log-analytics-overview) |
| Budget (`Microsoft.Consumption/budgets`) | USD 50/month cost guardrail | Emails at 80% actual and 100% forecast | [Docs](https://learn.microsoft.com/azure/cost-management-billing/costs/tutorial-acm-create-budgets) |
| Metric alert + action group | Sustained 5xx alert (> 5 in 15 minutes) | Separate from budget alerts | [Docs](https://learn.microsoft.com/azure/azure-monitor/alerts/alerts-metric-overview) |
| Azure Workbook + portal dashboard | Detailed telemetry views over Log Analytics ([observability](../telemetry/observability.md)) | Read access follows Azure RBAC | [Workbooks](https://learn.microsoft.com/azure/azure-monitor/visualize/workbooks-overview) · [Dashboards](https://learn.microsoft.com/azure/azure-portal/azure-portal-dashboards) |
| Diagnostic settings (Foundry, Container Apps, ACR) | Platform logs and metrics into the same workspace | HTTP logs with client IPs excluded | [Docs](https://learn.microsoft.com/azure/azure-monitor/essentials/diagnostic-settings) |
| Foundry project `bank-manager` + App Insights connection | Enables the Foundry portal Tracing view for the agent’s GenAI spans, and stores [evaluation](../evaluations/README.md) runs | Project inherits account network rules; its managed identity runs the graders and calls the judge model | [Docs](https://learn.microsoft.com/azure/ai-foundry/how-to/develop/trace-application) |

Not used, and why:

- **Key Vault** — there is no secret to store. Every dependency uses Microsoft
  Entra ID. See [secrets](../security/secrets.md).
- **Storage / Cosmos DB** — no server-side state; history stays in the browser.
- **Static Web Apps + Functions** — see [ADR 0007](../adr/0007-container-apps-single-container.md).

Open-source components: [Agent Governance Toolkit / Agent Control Specification](https://github.com/microsoft/agent-governance-toolkit)
(built from a pinned commit) and [Open Policy Agent](https://www.openpolicyagent.org/)
(pinned version and SHA-256 checked in the Dockerfile).
