# Build journal

## 2026-09-29 — fork and bring to EPS demo standards

- Forked `tmathew1000/bank-manager-standalone` (Streamlit + ACS) to
  `michaelsrichter/bank-manager-standalone` and imported the `eps-demo-*` skills,
  agents, prompt, and scaffolding from `mcaps-us/eps-demos-template`.
  Org-specific governance files (`.github/acl`, `.github/compliance`,
  `.github/policies`, the JIT issue template) were intentionally **not** copied:
  they only work inside the Microsoft EMU org and list internal aliases.
- Replaced Streamlit with FastAPI + React ([ADR 0008](adr/0008-fastapi-react-replace-streamlit.md)),
  kept the ACS manifest and Rego policy unchanged
  ([ADR 0010](adr/0010-acs-policy-engine.md)).
- Moved model names, prompts, and prices into `config/models.json`; Bicep reads
  the same file with `loadJsonContent` to create deployments.
- Added `FAKE_AI=1` with recorded fixtures (`backend/tests/fixtures/ai/`).
- Replaced realistic synthetic names/SSNs with obvious placeholders
  (`000-xx-xxxx` SSNs) per `eps-demo-compliance`.
- New infra: VNet-integrated Container Apps, Foundry with private endpoint and
  keys disabled, App Insights with Entra-only ingestion, budget, 5xx alert.
- Dead end: the first provision failed because the private endpoint started
  before the Foundry account finished provisioning (`state Accepted`). Fixed with
  an explicit `dependsOn` on the model deployments.
- Diagrams are Mermaid sources rendered to SVG with mermaid-cli and committed,
  so neither GitHub nor the served docs need a runtime renderer.

Known gaps are tracked in the compliance table in [README.md](README.md).
