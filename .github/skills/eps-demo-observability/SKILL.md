---
name: eps-demo-observability
description: OpenTelemetry capture and Azure Monitor dashboards for EPS AI vibe demos. Use when instrumenting the browser, API, agent code, or Foundry; wiring diagnostic settings for Azure services; or building Azure portal workbooks and dashboards.
---

# EPS Demo — Observability and Dashboards

This skill explains how a demo collects telemetry from **every part of the
stack** and shows it on dashboards in the **Azure portal**. It covers the "how."
`eps-demo-production-readiness` covers the rules for what telemetry may contain
and when alerts should fire. Follow both.

## Words used in this skill

- **Telemetry**: Facts an app records about itself while it runs, such as "this
  request took 420 ms and returned 200."
- **OpenTelemetry (OTel)**: An open standard and set of libraries for telemetry.
  With OTel, the same code can send data to different tools.
- **Trace**: The full story of one request as it moves through the system.
  **Span**: One step in that story, such as "call the model" or "search the
  index." Spans nest inside each other.
- **Metric**: A number measured over time, such as requests per minute.
  **Log**: A single recorded event with details.
- **W3C Trace Context**: A standard HTTP header (`traceparent`) that carries the
  trace ID from one service to the next, so every step joins the same trace.
- **Azure Monitor**: Azure's service for collecting and viewing telemetry.
  **Application Insights** (App Insights) is the part of Azure Monitor for app
  traces. A **Log Analytics workspace** is the database that stores the data.
- **Azure Monitor OpenTelemetry Distro**: Microsoft's packaged version of OTel.
  One call sets up traces, metrics, and logs and sends them to App Insights.
- **Diagnostic setting**: A setting on an Azure resource that sends the
  resource's own logs and metrics to a Log Analytics workspace. Without it,
  most platform logs are not kept.
- **KQL (Kusto Query Language)**: The query language for Log Analytics.
- **Azure Workbook**: An interactive report in the Azure portal, built from KQL
  queries, charts, and text. It is stored as JSON, so you can keep it in Git and
  deploy it with Bicep.

## Default destination

**Azure Monitor is the default and required destination.** Each demo
environment uses one workspace-based App Insights resource and one Log Analytics
workspace. The template's `infra/resources.bicep` already creates both.

Why one place: a single trace ID can then be followed from the browser to the
model call, and every dashboard queries the same data.

A second destination, such as Elastic, Datadog, or Grafana Cloud, is allowed
only with an ADR (Architecture Decision Record). The ADR must say why the
second destination is needed. Azure Monitor still receives the same data. Fan
out through an OpenTelemetry Collector or a second exporter that uses the same
allowlist of safe fields. Do not build a separate, richer pipeline for the
second destination.

## What to capture, and from where

Capture every layer below. The right-hand column says how.

| Source | What it shows | How to capture |
|---|---|---|
| Browser | Page loads, key actions, client errors, the trace ID shown to the user | A small allowlisted event API or the OTel web SDK; see "Browser telemetry" |
| API / backend | Incoming requests, outgoing calls, exceptions, custom demo metrics | Azure Monitor OpenTelemetry Distro |
| Agent code (Microsoft Agent Framework, Semantic Kernel, Foundry SDK, LangChain, and similar) | Agent runs, model calls, tool calls, tokens, timing | The framework's built-in OTel instrumentation, exported by the Distro |
| Foundry prompt agents, hosted agents, and workflows | Server-side agent runs and tool steps inside Foundry | Connect the App Insights resource to the Foundry project |
| Foundry / Azure OpenAI resource | Request counts, token usage, throttling, content-filter blocks | Platform metrics plus a diagnostic setting |
| Other Azure services (Container Apps, Functions, App Service, Static Web Apps, Storage, Cosmos DB, AI Search, Key Vault, API Management, SignalR, Service Bus) | Platform errors, latency, throttling, auth failures | A diagnostic setting on every resource that supports one |
| Subscription activity | Deployments, role changes, deletes | Activity log diagnostic setting to the same workspace (optional for one-off demos) |

### Backend and agent code

Use the Azure Monitor OpenTelemetry Distro for your language. Pass a Microsoft
Entra credential so ingestion uses managed identity, not a key.

- **Python**: `azure-monitor-opentelemetry`, then
  `configure_azure_monitor(connection_string=..., credential=DefaultAzureCredential())`.
- **.NET**: `Azure.Monitor.OpenTelemetry.AspNetCore`, then
  `builder.Services.AddOpenTelemetry().UseAzureMonitor(o => o.Credential = new DefaultAzureCredential())`.
- **Node.js**: `@azure/monitor-opentelemetry`, then `useAzureMonitor(...)` with
  `azureMonitorExporterOptions.credential`.

Configure the Distro once, at process start, before you create any AI or HTTP
clients. Otherwise the first spans are lost.

Set these resource attributes on every process, so dashboards can split the
data by service and release:

| Attribute | Example | Why |
|---|---|---|
| `service.name` (or `OTEL_SERVICE_NAME`) | `demo-api`, `demo-agent-research` | Appears as the "cloud role" in App Insights |
| `service.version` | the Git commit SHA | Ties every trace to the build stamp in the footer |
| `deployment.environment.name` | `dev`, `demo`, `local` | Keeps dev and local traffic out of release dashboards |

Turn on your agent framework's OTel instrumentation. It emits spans that follow
the [OpenTelemetry GenAI semantic conventions](https://opentelemetry.io/docs/specs/semconv/gen-ai/),
such as `invoke_agent`, `chat`, and `execute_tool`. Those spans carry
attributes such as `gen_ai.request.model`, `gen_ai.usage.input_tokens`,
`gen_ai.usage.output_tokens`, `gen_ai.agent.name`, and `gen_ai.tool.name`.
Dashboards depend on these names, so do not rename them.

### Foundry agents

- Connect the demo's App Insights resource to the Foundry project. Do this in
  Bicep when the API supports it, or in a documented post-provision step.
  Foundry then records **server-side traces** for prompt agents, hosted agents,
  and workflows without code changes.
- Prefer Microsoft Entra authentication for that connection (the project's
  managed identity). Grant that identity **Monitoring Metrics Publisher** on the
  App Insights resource. If this feature is still in preview, record that in the
  standards table.
- Hosted-agent containers also configure the Distro and continue the incoming
  `traceparent`. Then the API span, the Foundry run, and the tool spans share one
  trace.
- Add client-side spans around the agent call for your own logic, such as
  authorization checks and evidence shaping.

### Message content stays off

GenAI instrumentation can record prompts, answers, and tool arguments. That
content can contain personal data, and it is not allowed in demo telemetry (see
`eps-demo-production-readiness` and `eps-demo-compliance`).

- Leave `OTEL_INSTRUMENTATION_GENAI_CAPTURE_MESSAGE_CONTENT` and
  `AZURE_TRACING_GEN_AI_CONTENT_RECORDING_ENABLED` unset or `false` in every
  deployed environment. Also turn off any framework flag for "sensitive data."
- Set these values explicitly in Bicep app settings, so a library default
  cannot change the behavior.
- A test checks that no span attribute holds prompt or answer text (see
  "Testing").

### Azure platform logs (diagnostic settings)

Every Azure resource that supports diagnostic settings gets one in Bicep. It
points at the demo's Log Analytics workspace.

- Use `logAnalyticsDestinationType: 'Dedicated'` where the resource supports it.
  Resource-specific tables are cheaper and easier to query than the shared
  `AzureDiagnostics` table.
- Send the `allLogs` category group and `AllMetrics` for AI, search, data, and
  compute resources. Use the smaller `audit` group for resources that are noisy
  but less important to the demo story.
- Put the diagnostic setting in the same module as the resource, so a new
  resource cannot ship without one.

Example:

```bicep
resource searchDiagnostics 'Microsoft.Insights/diagnosticSettings@2021-05-01-preview' = {
  name: 'to-log-analytics'
  scope: search
  properties: {
    workspaceId: logAnalyticsWorkspaceId
    logAnalyticsDestinationType: 'Dedicated'
    logs: [ { categoryGroup: 'allLogs', enabled: true } ]
    metrics: [ { category: 'AllMetrics', enabled: true } ]
  }
}
```

### Browser telemetry

The App Insights JavaScript SDK cannot use Microsoft Entra authentication. When
App Insights turns off local (key-based) authentication, which is the goal, the
browser cannot send data straight to it.

- **Preferred:** the browser sends a small, allowlisted event (name, route,
  duration, error type, trace ID) to the demo API. The API rate-limits the
  endpoint, checks the fields, and records the event through the Distro.
- The browser sends a `traceparent` header on every API call. This links the
  user's click to the backend trace.
- **Allowed with a documented gap:** a separate browser-only App Insights
  resource with local authentication. Record the reason in the standards table.
- Session replay tools such as Microsoft Clarity are separate. They follow the
  consent rules in `eps-demo-compliance`.

### Identity and access

- App Insights sets `DisableLocalAuth: true` once every writer uses managed
  identity. Each workload identity gets **Monitoring Metrics Publisher** on the
  App Insights resource. That role can write telemetry but cannot read it.
- The connection string is configuration, not a secret. Still pass it as a
  Bicep output or app setting. Never hardcode it.
- Readers get **Monitoring Reader** and **Log Analytics Reader**, plus
  **Workbook Reader** for shared workbooks. Grant these to a group, not to
  individual people, where possible.
- Never reuse a retrieval or data credential for telemetry.

## Custom demo attributes

Add a few custom attributes so dashboards can tell the demo's story. Use the
`demo.` prefix. Keep an allowlist in code, and document every attribute in
`docs/telemetry/events.md`.

| Attribute | Example values | Used for |
|---|---|---|
| `demo.journey` | `ask`, `upload`, `reset` | Grouping by user journey |
| `demo.agent` | `research`, `writer` | Per-agent charts when `gen_ai.agent.name` is missing |
| `demo.mode` | `live`, `practice`, `replay` | Keeping Practice and replay out of live numbers |
| `demo.boundary` | `hr-docs`, `finance-files` | Which data boundary an authorization check protected |
| `demo.authz.outcome` | `allowed`, `denied_expected`, `denied_unexpected` | Proving expected denials happen, and spotting surprises |
| `demo.cost.estimated_usd` | `0.0031` | Cost per call, from the prices in `config/models.json` |

Never put a user alias, full principal ID, prompt, answer, search term, file
name, or raw error text in an attribute.

## Dashboards in the Azure portal

Dashboards live in the Azure portal, next to the resources they describe. They
are code: keep them in Git and deploy them with Bicep.

### Which dashboard tool to use

| Tool | Use it for | Notes |
|---|---|---|
| **Azure Workbook** (default) | The main, detailed demo dashboard: tabs, parameters, KQL tables and charts, text | Free. Deployed with `Microsoft.Insights/workbooks`. Opens from App Insights → Workbooks or Azure Monitor → Workbooks |
| Azure Monitor dashboards with Grafana | Grafana-style views, or an imported community dashboard for a supported service | No extra cost. Managed as Azure resources, so Bicep can deploy them |
| Azure portal dashboard (`Microsoft.Portal/dashboards`) | A one-page "at a glance" view that pins a few workbook or metric tiles | Optional |
| Foundry portal **Traces** and agent monitoring views | Stepping through one agent run | Built in. Link to it; do not rebuild it |

Azure Managed Grafana is a paid service. Use it only with an ADR.

### Starter workbook

The template ships a starter workbook in
[`infra/dashboards/`](../../../infra/dashboards/demo-overview.workbook.json) and
deploys it from `infra/resources.bicep`. It already reads the App Insights
tables and the `gen_ai.*` and `demo.*` attributes described above. Extend it. Do
not replace it with a dashboard built only by clicking in the portal.

- The workbook JSON in `infra/dashboards/` is the **one canonical source**. If
  you change the workbook in the portal, export the JSON back into Git in the
  same change. Portal-only edits are lost on the next deploy.
- Bicep loads the JSON with `loadTextContent(...)` and replaces placeholders,
  such as the App Insights resource ID.

### Required sections

A detailed demo dashboard has these sections. Mark a section "not used yet"
instead of deleting it.

1. **Overview**: requests, server errors (5xx), and p50/p95 response time by
   service, split by release (`service.version`).
2. **AI models**: model calls by model and deployment, input and output tokens,
   estimated cost, response time, throttling (429), and content-filter blocks.
3. **Agents and tools**: runs per agent, calls per tool, tool success rate, and
   the slowest tools.
4. **Security boundaries**: expected denials compared with unexpected denials,
   by boundary, and rate-limit responses. A missing expected denial is a
   problem, not a success.
5. **Azure services**: errors, throttling, and latency from each resource's
   diagnostic logs (AI Search, Storage, Cosmos DB, Key Vault, compute).
6. **Health**: results of `/health` probes over time.
7. **Recent failures**: the latest failed operations with their trace IDs, and
   how to open the end-to-end transaction view.

The template also deploys an **Answer review** workbook
([`infra/dashboards/answer-review.workbook.json`](../../../infra/dashboards/answer-review.workbook.json)).
It reviews one answer by trace ID, or one whole chat by conversation ID. The
demo links to it from each answer; see `eps-demo-telemetry-links`.

### Make every tile readable

Dashboards follow the plain-language rules (`eps-demo-plain-language`). A
presenter or a partner should understand each tile without help.

- The title says what the tile shows in everyday words: "Model calls per hour,"
  not `dependencies | summarize`.
- A one-sentence note near each chart says what "good" looks like.
- Every axis and column shows its unit (ms, tokens, USD).
- Colors mean the same thing on every tile. For example, red always means
  "failed."
- The whole workbook has a time-range parameter. Filter by environment when
  more than one environment shares a workspace.
- Mark estimated cost as an estimate, and say where the prices come from.

### Link dashboards from the docs

`docs/operations/` lists every dashboard, what question it answers, and the role
needed to open it. It links to the workbook and to the Foundry traces view. Do
not publish or embed dashboards on the public site.

## Cost controls

Telemetry costs money. Keep it proportional to the demo.

- Keep workspace retention at 30 days unless an ADR says otherwise.
- Set a workspace daily cap (`workspaceCapping.dailyQuotaGb`) for long-lived
  demos. When the cap is reached, ingestion stops until the next day, so add an
  alert for it and document it.
- Use sampling for high-volume request spans if needed. Never sample away
  errors, authorization denials, or model-call spans.
- Prefer `Dedicated` diagnostic tables, and choose category groups on purpose.

## Local development

- Local runs send telemetry to the **shared dev** App Insights resource, not to
  a local emulator. Set `deployment.environment.name=local` so this data stays
  off release dashboards.
- For quick debugging, you may also send spans to a local OTLP viewer, such as
  the Foundry Toolkit for VS Code or the Aspire dashboard. This is only an extra
  view. It does not replace Azure Monitor.

## Testing

- Unit tests use an in-memory OTel exporter. They check that key spans exist,
  that `gen_ai.*` and `demo.*` attributes have the expected values, and that no
  attribute contains prompt or answer text.
- CI runs with `FAKE_AI=1` and does not export telemetry.
- `bicep build` loads the workbook JSON through `loadTextContent`, so a missing
  file fails the build. Also keep a check that the workbook file parses as JSON.

## Release verification

Before handoff, prove each item with a real query, not a guess:

1. Run the critical journey once. Copy its trace ID from the UI's
   **IDs and observability links** panel (`eps-demo-telemetry-links`), and use
   its links to open the answer in Logs and in the Answer review workbook.
2. Find that trace in App Insights **Transaction search**. One timeline shows
   the API request, the agent run, the model calls, and the tool calls.
3. Open the Foundry **Traces** view and find the same run.
4. Run one expected denial, and confirm it appears as `denied_expected`.
5. List diagnostic settings for every resource
   (`az monitor diagnostic-settings list --resource <id>`). Each resource has
   one that points at the demo workspace.
6. Open the workbook. Every section shows data or a clear "not used yet" note.
7. Search recent spans for prompt or answer text. There must be none.

## Anti-patterns to refuse

- Sending telemetry only to a third-party tool, with no Azure Monitor copy.
- Ingestion keys in code or app settings when managed identity can be used.
- Turning on GenAI message-content capture "just for the demo."
- Azure resources with no diagnostic setting.
- Dashboards built only by clicking in the portal, with no JSON in Git.
- Tiles titled with raw KQL, unlabeled axes, or unexplained acronyms.
- One dashboard that mixes dev, local, Practice, and live traffic with no
  filters.
- Renaming standard `gen_ai.*` attributes, or putting user identifiers in
  custom attributes.
- Paid Azure Managed Grafana without an ADR.
