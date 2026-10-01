# Dashboards and who can open them

## In plain language

The demo reports what it does to Azure Monitor. These pages show that data. None of
them are public: you need Azure access to the demo's resource group to open them.
They never show what anyone typed or what the AI answered.

| Dashboard | Question it answers | How to open | Role needed |
|---|---|---|---|
| **IDs and observability links** panel (in the app, under each answer) | "Where is *this* answer in Azure Monitor?" | Open the panel under an answer in the demo | Anyone can see the IDs. The links need the roles below |
| **Answer review** workbook | "What happened in one answer, or in one whole chat?" | `azd env get-value AZURE_ANSWER_REVIEW_WORKBOOK_URL`, or the link in the panel | Reader (or Monitoring Reader) on the resource group |
| **Demo overview** workbook ("Governed AI Bank Assistant — telemetry") | "Is the demo healthy? What did the AI cost? Are the rules blocking what they should?" | `azd env get-value AZURE_TELEMETRY_WORKBOOK_URL` | Reader (or Monitoring Reader) on the resource group |
| **Portal dashboard** ("Governed AI Bank Assistant") | "What does the demo look like at a glance?" | `azd env get-value AZURE_TELEMETRY_DASHBOARD_URL` | Reader on the resource group |
| **Application Insights** (Transaction search, Live Metrics, Failures) | "Show me every step of one trace", "Is anything failing right now?" | Link on the dashboard, or the panel | Reader (or Monitoring Reader) on the resource group |
| **Foundry project `bank-manager` → Tracing** | "Show me the agent run as Foundry sees it" | Link on the dashboard | Azure AI User on the Foundry project, plus portal network access (see [observability](../telemetry/observability.md#foundry-portal-tracing)) |

Details of every chart and what "good" looks like are in
[observability](../telemetry/observability.md). Every event and attribute is listed in
[events](../telemetry/events.md).

## Review one answer

1. Ask a question in the demo. Under the answer, open **IDs and observability links**.
2. Select **This answer in Logs**, or copy the **Trace ID** and paste it into the
   **Answer review** workbook.

## Review one whole chat

1. Open **IDs and observability links** under any answer in the chat.
2. Copy the **Conversation ID**, and paste it into the **Answer review** workbook. Or copy
   the "whole chat" query and paste it into **Application Insights Logs**.

The summary row counts questions and Approve / Reject clicks, and lists every trace ID,
model, and policy decision in the chat.

## Practice mode

`#/demo?mode=practice` answers from saved examples and does not call the AI model. Use it
to rehearse, or as a backup when the model is slow. Practice answers are marked
"Practice (not live)" and get no observability links. Their requests are still recorded,
labeled `demo.mode=practice`, so the dashboards can leave them out.

## When the data stops

The Log Analytics workspace has a 1 GB daily cap to control cost. If the cap is reached,
new data stops until the next day (UTC). The demo keeps working. Charts show a gap.
