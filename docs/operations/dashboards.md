# Dashboards and who can open them

## In plain language

The demo reports what it does to Azure Monitor. These pages show that data. None of
them are public: you need Azure access to the demo's resource group to open them.
They never show what anyone typed or what the AI answered.

## Words used on this page

- **Azure Monitor**: Azure's service for collecting and viewing logs, metrics, and
  traces. **Application Insights** and **Log Analytics** are the parts of it this demo uses.
- **Trace ID**: a 32-character ID shared by every step of one answer, for example
  `4bf92f3577b34da6a3ce929d0e0e4736`. Application Insights calls it the operation ID.
- **Conversation ID**: an ID shared by every answer in one chat. The browser makes a new
  random one when you start a **New chat**.
- **Workbook**: an Azure Monitor page of charts and tables, saved as a file in this repo.
- **Query** (KQL, Kusto Query Language): the text you paste into **Logs** to search the data.
- **Role**: a permission in Azure, such as Reader, that someone gives you on a resource group.

| Dashboard | Question it answers | How to open | Role needed |
|---|---|---|---|
| **IDs and observability links** panel (in the app, under each answer) | "Where is *this* answer in Azure Monitor?" | Open the panel under an answer in the demo | Anyone can see the IDs. The links need the roles below |
| **Answer review** workbook | "What happened in one answer, or in one whole chat?" | `azd env get-value AZURE_ANSWER_REVIEW_WORKBOOK_URL`, or the link in the panel | Reader (or Monitoring Reader) on the resource group |
| **Demo overview** workbook ("Governed AI Bank Assistant — telemetry") | "Is the demo healthy? What did the AI cost? Are the rules blocking what they should?" | `azd env get-value AZURE_TELEMETRY_WORKBOOK_URL` | Reader (or Monitoring Reader) on the resource group |
| **Portal dashboard** ("Governed AI Bank Assistant") | "What does the demo look like at a glance?" | `azd env get-value AZURE_TELEMETRY_DASHBOARD_URL` | Reader on the resource group |
| **Application Insights** (Transaction search, Live Metrics, Failures) | "Show me every step of one trace", "Is anything failing right now?" | Link on the dashboard, or the panel | Reader (or Monitoring Reader) on the resource group |
| **Foundry project `bank-manager` → Tracing** | "Show me the agent run as Foundry sees it" | Link on the dashboard | Azure AI User on the Foundry project, plus portal network access (see [observability](../telemetry/observability.md#foundry-portal-tracing)) |
| **Evaluations** page (in the app) and **Foundry project → Build → Evaluations** | "Does the assistant still give the right answers and decisions?" | [/#/evaluations](/#/evaluations), or **Open in Foundry** on that page | Anyone can read results in the app. The Foundry portal needs Foundry User on the project. Starting a run needs the presenter key ([evaluations](../evaluations/README.md)) |

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
