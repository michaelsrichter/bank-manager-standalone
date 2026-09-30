# Documentation

The **`docs/` folder is the single source of truth** for this demo, per
[`eps-demo-docs`](../.github/skills/eps-demo-docs/SKILL.md). The root
[README](../README.md) is only a short on-ramp. Every page here is also served
inside the running app at `/#/docs/...` (converted to static HTML at build time).

## Start here (plain language)

This demo shows an AI assistant for a pretend bank. The AI turns a request like
“show account A-2001” into a tool call. The same tool call then runs twice:
once with **no rules**, and once through a **policy engine** that checks every
step. Comparing the two lanes shows why AI agents that can take real actions
need rules enforced by software, not just good prompts.

## Map

| Area | Contents |
|---|---|
| [architecture/overview.md](architecture/overview.md) | What the app does, why it matters, who it is for |
| [architecture/diagram.md](architecture/diagram.md) | Architecture layers, identity map, ACS flow, request sequence |
| [architecture/azure-services.md](architecture/azure-services.md) | Every Azure service used and why |
| [architecture/data-flow.md](architecture/data-flow.md) | How a request moves through the system |
| [security/threat-model.md](security/threat-model.md) | Threats, mitigations, and known gaps |
| [security/auth.md](security/auth.md) | User identity and workload identity choices |
| [security/secrets.md](security/secrets.md) | Managed Identity story; there are no secrets |
| [security/content-filtering.md](security/content-filtering.md) | Azure AI content filters |
| [security/rate-limiting.md](security/rate-limiting.md) | Abuse and cost controls |
| [security/privacy.md](security/privacy.md) | What is stored, where, and for how long; synthetic data |
| [api/README.md](api/README.md) | HTTP API and streaming event contract |
| [cost/cost-to-run.md](cost/cost-to-run.md) | Monthly cost today |
| [cost/cost-at-scale.md](cost/cost-at-scale.md) | Cost at 10x and 100x usage |
| [operations/deploy.md](operations/deploy.md) | Deploy with `azd up` |
| [operations/rollback.md](operations/rollback.md) | Undo a bad release |
| [operations/troubleshooting.md](operations/troubleshooting.md) | Common problems and fixes |
| [operations/local-dev.md](operations/local-dev.md) | Run locally, with or without a real model |
| [telemetry/observability.md](telemetry/observability.md) | OpenTelemetry pipeline, Azure workbook, and dashboard |
| [telemetry/events.md](telemetry/events.md) | Every telemetry event the app sends |
| [health/README.md](health/README.md) | Health page, probe states, caching |
| [governance-tour.md](governance-tour.md) | **Agent Governance Toolkit / ACS code tour**: the three checks, human approval, redaction, tests |
| [code-tour.md](code-tour.md) | Important request paths with source excerpts |
| [build-journal.md](build-journal.md) | Decisions, dead ends, and known gaps |
| [adr/](adr/0001-use-bicep.md) | Architecture Decision Records |

## Standards compliance at a glance

Honest status against [AGENTS.md](../AGENTS.md) and the `eps-demo-*` skills.
✅ met · ⚠️ met with a documented gap · ❌ not met.

| Standard | Status | Notes |
|---|---|---|
| Hosted in Azure | ✅ | Azure Container Apps, eastus2 — [ADR 0007](adr/0007-container-apps-single-container.md) |
| Bicep IaC, one-command deploy | ✅ | [`infra/`](../infra/main.bicep) via `azd up` |
| Managed Identity, no keys | ✅ | Foundry and App Insights have local auth **disabled**; ACR admin disabled — [secrets](security/secrets.md) |
| Private Link to Azure dependencies | ⚠️ | Foundry is private-endpoint only. ACR and Azure Monitor ingestion stay public (MI-authenticated) — [ADR 0011](adr/0011-private-link-scope.md) |
| Config-driven models | ✅ | [`config/models.json`](../config/models.json) drives the app **and** the Bicep deployments |
| Content filters on | ✅ | `Microsoft.DefaultV2` on every deployment — [content filtering](security/content-filtering.md) |
| Model + cost visible in UI | ✅ | Requested deployment, actual response model, 4 token categories, estimated cost, trace ID |
| Alias + GUID, no PII | ✅ | [auth](security/auth.md), [privacy](security/privacy.md) |
| “Demo only” indicator, no partner names | ✅ | Header badge above the fold + footer |
| Standard footer | ⚠️ | Privacy, Terms, How built, GitHub, Microsoft products, colophon. Author LinkedIn links omitted at the owner’s request; authors credited by name (Mike Richter and Thomas Mathew, Microsoft) |
| GDPR cookie acknowledgement | ✅ | Necessary-only by default; analytics opt-in |
| `/docs` single source of truth, served in app | ✅ | Built to static HTML; diagrams pre-rendered SVG; code tours use build-time source extraction with drift checks, build-time syntax highlighting, collapsible blocks, and copy buttons |
| Rate limiting + request bounds | ✅ | Per-IP and per-session; body/prompt caps — [rate limiting](security/rate-limiting.md) |
| Streaming progress, safe tool visibility | ✅ | Ordered NDJSON with sequence numbers; no chain-of-thought |
| CI coverage gates (BE ≥ 70% / FE ≥ 60%) | ✅ | `.github/workflows/ci.yml`, `FAKE_AI=1` |
| Budget alerts in Bicep | ✅ | USD 50/month, 80% actual + 100% forecast |
| Actionable service alerts | ✅ | Sustained 5xx only (> 5 in 15 min) |
| OpenTelemetry end to end + dashboards | ✅ | Browser traceparent → FastAPI → GenAI agent spans → ACS metrics → Foundry diagnostics; Azure Workbook + portal dashboard — [observability](telemetry/observability.md) |
| Health page + endpoint | ✅ | Expected-denial and no-inference probes — [health](health/README.md) |
| VS Code Run All / Debug All, devcontainer | ✅ | `.vscode/`, `.devcontainer/` |
| Uniform CLI `dev` / `test` / `lint` / `deploy` | ✅ | [`Makefile`](../Makefile) |
| Microsoft Agent Framework for orchestration | ⚠️ | Not used: one structured-output call, no agent loop — [ADR 0009](adr/0009-direct-structured-output-no-agent-framework.md) |
| PR preview deploy + CD on merge | ⚠️ | `deploy.yml` is ready but inert until OIDC variables are set — [deploy](operations/deploy.md) |
| Custom domain | ⚠️ | Not configured; default `*.azurecontainerapps.io` hostname |
| Durable server-side history | ➖ | Not needed: history stays in browser storage only |

## Architecture Decision Records

| ADR | Title | Status |
|---|---|---|
| [0001](adr/0001-use-bicep.md) | Use Bicep for IaC | accepted |
| [0002](adr/0002-azd-as-deploy-standard.md) | Azure Developer CLI (azd) as the deploy standard | accepted |
| [0003](adr/0003-private-link-opt-in-by-default.md) | Private Link opt-in by default, documented gap otherwise | accepted (template) |
| [0004](adr/0004-stack-agnostic-template.md) | Template stays stack-agnostic | superseded by 0007/0008 for this repo |
| [0005](adr/0005-public-repo-by-default.md) | Demo repos are public by default | accepted |
| [0006](adr/0006-long-lived-demo-readiness.md) | Long-lived demos require an operational readiness baseline | accepted |
| [0007](adr/0007-container-apps-single-container.md) | Azure Container Apps, one container for API + SPA | accepted |
| [0008](adr/0008-fastapi-react-replace-streamlit.md) | FastAPI + React replace Streamlit | accepted |
| [0009](adr/0009-direct-structured-output-no-agent-framework.md) | Direct structured output instead of Agent Framework | accepted |
| [0010](adr/0010-acs-policy-engine.md) | Agent Control Specification (ACS) + OPA as the policy engine | accepted |
| [0011](adr/0011-private-link-scope.md) | Private Link for Foundry; ACR and Monitor public with MI | accepted |
