# Diagrams

Diagrams are written in Mermaid (`diagrams/*.mmd`) and **pre-rendered to SVG**
so GitHub and the in-app docs show them without a runtime renderer. Re-render
after editing a source file (`make diagrams` does the same):

```bash
cd docs/architecture/diagrams
for d in architecture identity acs-flow request-flow; do
  npx -y @mermaid-js/mermaid-cli@11 -i "$d.mmd" -o "$d.svg" \
    -p puppeteer.json -C render.css -b white
done
```

## 1. Architecture: four layers

In plain language: your browser talks to **one** web app in Azure. Inside that
app, the AI model only *suggests* an action, and the **ACS policy engine**
decides whether it may run. The app reaches the AI model over a **private**
network connection using its own Azure identity, not a password. Everything
reports to one monitoring workspace.

![Four layers stacked top to bottom: 1 Visitor (browser); 2 Azure Container Apps with API, agent harness, ACS policy engine, and bank tools; 3 Private AI access with a private endpoint and Microsoft Foundry; 4 Operations with Application Insights, Log Analytics, workbook, and guardrails](diagrams/architecture.svg)

| Layer | Trust boundary | What protects it |
|---|---|---|
| ① → ② | Public internet → app | HTTPS only; size, schema, and rate limits; persona roles looked up on the server |
| Inside ② | Model suggestion → tool | Tool name and arguments validated, then judged by ACS before running |
| ② → ③ | App → AI model | Private endpoint; Entra ID token from the managed identity; Foundry keys and public access off |
| ② → ① | Tool result → browser | ACS redaction, then an allow-list of fields and a length cap |

## 2. Identity and access: who can do what

Every arrow is one Azure role assignment. The app has exactly three
permissions, each on exactly one resource. There are no keys or passwords. A
developer can optionally get the same two data permissions for local testing
(dotted lines); both grants come from the same Bicep module, so they can't drift apart.

![Identity map: the app's managed identity has AcrPull on the container registry, Cognitive Services OpenAI User on Microsoft Foundry, and Monitoring Metrics Publisher on Application Insights; the developer optionally has the same two data roles](diagrams/identity.svg)

## 3. How ACS decides (governance flow)

The three ACS checks, human approval, and where a request can be blocked. The
[governance code tour](../governance-tour.md) walks through the code behind each box.

![Request flows through the model's single tool choice, a server-built snapshot, then ACS checks input, pre_tool_call (with optional human approval), and post_tool_call; any deny goes to Blocked](diagrams/acs-flow.svg)

## 4. One request, step by step

![Sequence diagram of one comparison request: model routing, baseline lane, three ACS checks, optional approval](diagrams/request-flow.svg)
