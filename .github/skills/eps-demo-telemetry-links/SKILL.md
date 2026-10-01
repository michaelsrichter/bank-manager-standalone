---
name: eps-demo-telemetry-links
description: Show trace IDs, conversation IDs, and other review IDs in an EPS demo's UI, with copy buttons and deep links into Azure Monitor (Application Insights Logs, the Answer review workbook, and dashboards). Use whenever a demo shows AI answers, agent runs, or other traced work, so a presenter can open any answer, or a whole chat, in the observability tools.
---

# EPS Demo — Telemetry Links in the App

A good demo lets the presenter say, "Here is the answer. Now let's see exactly
what happened," and open that answer in Azure Monitor in one or two clicks.
This skill covers that path: which IDs the app shows, how they connect to the
telemetry, and how the app builds safe links and queries.

`eps-demo-observability` covers **capturing** telemetry and building
dashboards. This skill covers **finding one answer or one chat again** from the
app. Follow both.

## Words used in this skill

- **Trace ID**: The W3C trace ID of one request, such as one question and its
  answer. It is 32 hexadecimal characters, for example
  `4bf92f3577b34da6a3ce929d0e0e4736`. Every step of the answer shares it.
- **Operation ID**: What Application Insights calls the trace ID. It is stored
  in the `operation_Id` column (`OperationId` in workspace tables). The trace ID
  and the operation ID are the same value.
- **Conversation ID**: One ID for a whole chat. Every question in the same chat
  shares it. It is stored as the OpenTelemetry attribute
  `gen_ai.conversation.id`.
- **Span attribute**: A name and value attached to one step of a trace. Azure
  Monitor stores span attributes in `customDimensions` (`Properties` in
  workspace tables), keyed by the attribute name.
- **KQL (Kusto Query Language)**: The query language for Azure Monitor Logs.
- **Deep link**: A link that opens a specific page and context, such as Logs
  with a query already filled in.
- **Practice**: Prepared answers that never call the live services. Practice
  answers are not recorded, so they have no real trace ID.

## What the demo shows

Under every live answer, add a closed-by-default disclosure named
**IDs and observability links**. Closed by default keeps the public view simple
(`eps-demo-ux`). Presenters open it.

| Item | Required? | Why |
|---|---|---|
| Trace ID | Required | Finds this one answer, step by step |
| Conversation ID | Required for chats | Finds every question in the same chat |
| Agent name and version | Recommended | Ties the answer to the exact deployed agent |
| Model that answered | Recommended | Shows what Model Router actually picked |
| Answered at (UTC) | Recommended | Keeps searches to a small time window |
| Request or run ID | When the app has one | Joins records that the trace does not cover |
| Identity and key ID prefixes | When the demo is about access | First 8 characters only, never the full value |

Each item has a **Copy** button. Below the IDs, show:

1. **This answer in Logs**: opens Application Insights Logs with the query for
   this answer already filled in.
2. **Answer review workbook**: opens the review workbook. The presenter pastes
   the trace ID or conversation ID, or selects a row.
3. **Application Insights Logs**: opens Logs for the right resource, for when a
   presenter wants to paste a query by hand.
4. **Query: every step of this answer** and **Query: the whole chat as one
   row**: the KQL text, each with a **Copy** button. Copying a query always
   works, even when a link format changes.

Reopening a saved chat shows the same IDs and links again. Practice answers
show their IDs, but say plainly that they are not recorded and show no links.

The reference component in [`reference/ReviewIds.tsx`](reference/ReviewIds.tsx)
implements this panel.

## Make the IDs real (telemetry contract)

A link is only useful if the ID in the app matches the stored telemetry.

- **Return the server's trace ID.** The API reads the trace ID from the current
  span (for example `Activity.Current.TraceId` in .NET or
  `trace.get_current_span().get_span_context().trace_id` in Python). It returns
  that value with the answer. Never make up an ID in the browser for a live
  answer.
- **One question, one trace.** The browser sends a `traceparent` header
  (`eps-demo-observability`). The API continues it, and the agent continues the
  API's trace. Then the browser, API, agent, model, and tool steps share one
  trace ID.
- **Stamp the conversation ID on every step.** Set `gen_ai.conversation.id` on
  the API's root span, on the agent call, and on log records. The simplest way
  is a small span processor that copies the current request's conversation ID
  onto every span the request starts. If only one or two spans carry it, a
  "whole chat" query can find the answers but not their steps.
- **Validate the conversation ID on the server.** Accept only the app's own
  format, such as a GUID. Foundry's own conversation IDs look like
  `conv_0a1b...`; Foundry server-side traces already record them as
  `gen_ai.conversation.id`.
- **Keep IDs out of metrics.** Trace and conversation IDs belong on spans and
  logs only. As metric dimensions they create a new time series for every chat,
  which costs money and slows dashboards.
- **No personal data.** The conversation ID is a random value, never a user
  alias or email address. Telemetry still never holds questions, answers, or
  file text (`eps-demo-observability`).

## Build the links (Azure default)

Azure Monitor is the default destination (`eps-demo-observability`). Build
every link from configuration, never from hand-typed IDs.

### Configuration

`infra/main.bicep` outputs the values the links need:

| Output | Use |
|---|---|
| `AZURE_TENANT_ID` | Opens the portal in the right directory |
| `APPLICATIONINSIGHTS_RESOURCE_ID` | Scope for Logs links and queries |
| `ANSWER_REVIEW_WORKBOOK_ID` | Opens the Answer review workbook |

Pass them to the frontend build through `azd` environment values (for example
as `VITE_*` variables for a Vite app). Also make the portal origin a setting
(`https://portal.azure.com` by default) so a sovereign cloud works.

These values are resource identifiers, not secrets. Opening them still needs
Azure access. Record in `docs/security/` that the public site shows them and
who can open them. If the repository or event policy says to hide them, show
the links only in presenter mode and keep the IDs and queries visible.

### Link formats

| Link | Format | Status |
|---|---|---|
| Application Insights Logs | `{portal}/#@{tenant}/resource{appInsightsId}/logs` | Standard resource page |
| Answer review workbook | `{portal}/#@{tenant}/resource{workbookId}/workbook` | Standard resource page |
| This answer in Logs | `{portal}/#@{tenant}/blade/Microsoft_OperationsManagementSuite_Workspace/Logs.ReactView/resourceId/{encoded id}/source/LogsBlade.AnalyticsShareLinkToQuery/q/{base64(gzip(KQL))}/timespan/{start}/{end}` | The format of the portal's **Share → Copy link to query**. It is not a documented API. Open one generated link per demo before you rely on it, and keep **Copy query** as the fallback |

Workbook links cannot carry parameter values today, so the workbook takes the
ID by paste or by selecting a row in **Recent answers**.

[`reference/observability-links.ts`](reference/observability-links.ts) builds
all three links and both queries.

### Time windows

Search one hour before and after the answer (or the whole chat). This keeps
queries fast and cheap and covers clock differences between the browser and
the servers. When the time is unknown, use the last day.

## Queries

These queries run in **Logs on the Application Insights resource**, which uses
the classic table names. In workspace tables, the names change: `requests`
becomes `AppRequests`, `operation_Id` becomes `OperationId`,
`customDimensions` becomes `Properties`, `timestamp` becomes `TimeGenerated`,
and `duration` becomes `DurationMs`.

Every step of one answer:

```kusto
let traceId = "<trace ID>";
union requests, dependencies, traces, exceptions
| where operation_Id == traceId
| extend Step = coalesce(name, message, type), Seconds = round(duration / 1000, 2)
| project timestamp, Kind = itemType, Service = cloud_RoleName, Step, Seconds,
    Succeeded = success, Code = resultCode, SpanId = id, ParentId = operation_ParentId
| order by timestamp asc
```

The whole chat as one row:

```kusto
let conversationId = "<conversation ID>";
let answers = requests
    | where tostring(customDimensions["gen_ai.conversation.id"]) == conversationId
    | distinct operation_Id;
union requests, dependencies
| where operation_Id in (answers)
| summarize Questions = dcount(operation_Id), Started = min(timestamp), Ended = max(timestamp),
    Agents = make_set_if(tostring(customDimensions["gen_ai.agent.name"]), isnotempty(tostring(customDimensions["gen_ai.agent.name"]))),
    Models = make_set_if(tostring(customDimensions["gen_ai.response.model"]), isnotempty(tostring(customDimensions["gen_ai.response.model"]))),
    InputTokens = sum(tolong(customDimensions["gen_ai.usage.input_tokens"])),
    OutputTokens = sum(tolong(customDimensions["gen_ai.usage.output_tokens"])),
    FailedSteps = countif(success == false), TraceIds = make_set(operation_Id, 100)
```

Insert IDs only after they pass the checks in "Security." Never build KQL from
free text.

## Answer review workbook

The template deploys a second free workbook,
[`infra/dashboards/answer-review.workbook.json`](../../../infra/dashboards/answer-review.workbook.json),
next to the overview workbook. It has a time range and two text parameters,
**Trace ID** and **Conversation ID**.

- **Recent answers**: every answer with a conversation ID. Selecting a row
  fills in the trace ID.
- **One answer**: seconds per step, problems (failed steps and exceptions), and
  every step in order. Hidden until a trace ID is set.
- **One conversation**: the whole chat as one row, and every answer in it.
  Selecting an answer fills in the trace ID. Hidden until a conversation ID is
  set.

Extend it in Git like the overview workbook. Add the demo's own `demo.*` and
`gen_ai.*` attributes as columns when they help the story.

## Other observability tools

Azure Monitor keeps its copy of the data (`eps-demo-observability`). When an
ADR adds a second destination, build its links the same way: from
configuration, with the same ID checks and copy buttons. Examples:

- **Kibana**: a dashboard link with the ID in the search bar
  (`_a=(query:(language:kuery,query:'trace_id : "<id>"'))`), or Discover in
  ES|QL mode with `WHERE trace.id == "<id>"`.
- **Grafana**: an Explore link with a trace query for the ID.

Label each link with the tool it opens.

## Security

- **Strict ID checks before any query or URL.** A trace ID matches
  `^[0-9a-f]{32}$` and is not all zeros. A conversation ID matches
  `^[A-Za-z0-9][A-Za-z0-9_-]{7,127}$` (a GUID or a Foundry `conv_...` ID).
  Both patterns rule out quotes, backslashes, spaces, and line breaks, so an ID
  cannot change a KQL query or a URL path.
- **Fixed destinations.** Links go only to the configured portal origin and
  resource IDs. Check that resource IDs look like Azure resource IDs. Open links
  in a new tab with `rel="noreferrer"`.
- **Nothing private in the panel.** No keys, tokens, connection strings, full
  principal IDs, prompts, or answers. Prefixes of identity or key IDs are
  enough to match them in the portal.
- **Readers need roles.** Presenters need **Monitoring Reader** (or
  **Log Analytics Reader**) and **Workbook Reader**. Grant them to a group.
- **Copy safely.** The copy button writes only the shown text. Never send copied
  values to telemetry.

## Testing

- **Unit:** ID checks reject quotes, spaces, Practice IDs, and all-zero trace
  IDs. Queries contain the ID only inside its string. Links use only the
  configured origin and resources. The Logs link's query segment decodes back
  to the exact KQL. See
  [`reference/observability-links.test.ts`](reference/observability-links.test.ts).
- **Component:** the panel lists the IDs, each **Copy** button copies the right
  value, a blocked clipboard shows "Copy blocked," and Practice answers show no
  links.
- **Telemetry contract:** with an in-memory OTel exporter, one test request
  produces spans whose trace ID equals the trace ID returned to the browser,
  and the root span and the agent call carry `gen_ai.conversation.id`.

## Release verification

Before handoff, prove these with the live demo, not with guesses:

1. Ask one live question. Open **IDs and observability links**.
2. Choose **This answer in Logs**. The query runs and lists the answer's steps,
   from the API request to the model and tool calls. If the link does not open
   the query, record it, and use **Copy query** in Logs instead.
3. Open the **Answer review workbook**. Select the answer in **Recent answers**.
   **Where the time went** and **Every step** show data.
4. Ask a second question in the same chat. Paste the conversation ID into the
   workbook. **Whole chat, one row** shows two questions.
5. Switch to Practice. The panel shows that the answer is not recorded and
   offers no links.

## Documentation

- `docs/telemetry/`: the IDs, where they are stored, and the attribute names.
- `docs/operations/`: "Review one answer or one chat" steps, the workbook, and
  the roles needed.
- `docs/security/`: what the panel shows publicly and why it is safe.
- `docs/code-tour.md`: where the trace ID is returned and where the
  conversation ID is stamped.

## Anti-patterns to refuse

- Showing a made-up or browser-generated ID for a live answer.
- Building KQL or URLs from unchecked text, or from free text typed by a visitor.
- Conversation IDs on only one span, so a whole chat cannot be followed.
- Trace or conversation IDs as metric dimensions.
- Hardcoded subscription, resource group, or resource names in the frontend.
- Links that only work in one person's browser, with no copyable query as a
  fallback.
- Putting keys, tokens, prompts, answers, or full principal IDs in the panel.

## Reference files

| File | What it is |
|---|---|
| [`reference/observability-links.ts`](reference/observability-links.ts) | ID checks, KQL builders, and portal links |
| [`reference/ReviewIds.tsx`](reference/ReviewIds.tsx) | The "IDs and observability links" panel (React) |
| [`reference/CopyButton.tsx`](reference/CopyButton.tsx) | Copy button with a fallback and a spoken status |
| [`reference/observability-links.test.ts`](reference/observability-links.test.ts) | Unit tests to copy |

The reference code is TypeScript and React because that is the template's
default frontend (`eps-demo-architecture`). For another stack, keep the same
checks, queries, and link formats.
