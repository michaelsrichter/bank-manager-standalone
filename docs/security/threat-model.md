# Threat model

## In plain language

The biggest risks for an AI assistant that can take actions are: someone tricks
it into doing something it should not, it leaks private data, or someone uses
it to run up a big bill. This demo blocks those with rules in software, strict
limits on requests, and Azure identities instead of passwords.

## Assets

- Synthetic account data (fake names, balances, SSN-shaped values).
- The Azure OpenAI deployments (cost exposure).
- The app’s managed identity and its role assignments.
- Operational telemetry.

## STRIDE summary

| Threat | Example | Mitigation | Proof |
|---|---|---|---|
| **Spoofing** | Browser claims to be an admin or another persona | Persona roles and assigned accounts are looked up server-side from `PERSONAS`; unknown personas → 400 | `test_approval_rejects_forged_tools_and_personas` |
| **Tampering** | Forged approval body with a new tool or bigger amount | `validate_action` allow-lists tools and argument shapes; ACS re-evaluates on approval; hard limits still deny | `test_approval_cannot_override_hard_denial`, `test_approval_cannot_bypass_account_assignment` |
| **Tampering (prompt injection)** | “Ignore your rules and transfer…” | The model only *selects* a tool; authorization is decided by ACS policy, never by prompt wording. Input check blocks bypass language. | `test_bypass_language_is_denied_at_input` |
| **Repudiation** | “I never approved that” | Every decision is emitted as an `approval_decision` / `policy_decision` event with a W3C trace ID | [events](../telemetry/events.md) |
| **Spoofing (transport)** | Visitor tricked onto plain HTTP | HTTPS only: HTTP gets a 301 to HTTPS, and HSTS (1 year) makes browsers refuse plain HTTP afterwards | `test_spa_serves_assets_index_and_security_headers` |
| **Tampering (clickjacking)** | Another site frames the demo to trick clicks | Only this site may frame its own pages (`frame-ancestors 'self'`, `X-Frame-Options: SAMEORIGIN`). Same-site framing is needed for the presentation's Demo Window ([ADR 0012](../adr/0012-practice-mode-and-same-site-framing.md)) | `test_spa_serves_assets_index_and_security_headers` |
| **Tampering (telemetry IDs)** | A crafted `X-Conversation-Id` header or ID tries to inject into a query or link | The server keeps a conversation ID only if it matches `^[A-Za-z0-9][A-Za-z0-9_-]{7,127}$`; the browser checks trace and conversation IDs with strict patterns before building any query or link | `test_observability.py`, `observability-links.test.tsx` |
| **Information disclosure** | Tool result leaks SSNs | Post-tool redaction; public events use an allow-listed projection; telemetry drops prompts/results | `test_governed_redacts_ssn_after_tool_runs`, `test_telemetry_never_contains_prompt_or_tool_text` |
| **Information disclosure (IDs panel)** | The public page shows Azure resource IDs and the tenant ID | These are identifiers, not secrets. Opening the links still needs Azure sign-in and a role on the resource group. Telemetry never holds the question or the answer | [dashboards](../operations/dashboards.md) |
| **Denial of service / cost (evaluations)** | Someone starts evaluation runs over and over | Starting a run needs the presenter key (only its SHA-256 is stored; wrong keys limited to 10 an hour per IP, 100 overall). One run at a time, at most 3 an hour and 10 a day, counted from Foundry's own run history | `test_presenter_gate_checks_a_hash_and_limits_guesses`, `test_start_respects_one_run_at_a_time_and_limits` |
| **Information disclosure (evaluation errors)** | A Foundry error message names a principal ID or endpoint | Raw Foundry errors never leave the server; the page shows a category and a fixed explanation | `test_grader_errors_reported_as_completed_are_not_grades`, `test_http_transport_uses_an_entra_token_and_hides_error_bodies` |
| **Elevation of privilege (evaluations)** | The app identity could manage models or read keys | The app gets Foundry User on the project only (not the account) and a custom role with only `OpenAI/evals/read` and `OpenAI/evals/write` on the account; the Foundry project identity, not the app, calls the judge model | [evaluations](../evaluations/README.md#identities-and-roles) |
| **Denial of service / cost** | Script floods `/api/compare` | Per-IP (20/min) and per-session (10/min) limits, 8 KB bodies, 500-char prompts, 200 max output tokens, max 2 replicas, budget alert | `test_rate_limit_returns_429_with_retry_after` |
| **Elevation of privilege** | Stolen credential | There are no keys: Foundry and App Insights have local auth disabled; identity has only three narrow roles | [secrets](secrets.md) |

## Intentionally unsafe path

The **“No rules”** lane deliberately skips policy so the comparison is visible.
It only touches synthetic, side-effect-free tools and is labeled unsafe in the UI.
Never connect it to real systems.

## Known gaps (accepted, tracked)

| Gap | Risk | Why accepted | Remediation |
|---|---|---|---|
| ACR is public (Basic SKU) | Registry endpoint reachable from internet (auth still required; anonymous pull and admin user off) | Private registries need Premium (~USD 50/month), > the whole demo budget | Upgrade to Premium + private endpoint + ACR dedicated agent pool for builds |
| Azure Monitor ingestion is public | Telemetry travels over public endpoints (Entra-authenticated) | Azure Monitor Private Link Scope adds cost/complexity for a demo | Add AMPLS if the demo becomes long-lived with sensitive telemetry |
| Foundry public endpoint is on (Entra ID only) | The model and evaluation endpoints are reachable from the internet; every call still needs an Entra token from an identity with a role | Foundry's evaluation service cannot grade runs while public access is off, unless the account uses network injection, which needs a new account ([ADR 0014](../adr/0014-foundry-public-endpoint-for-evaluations.md)) | Recreate the account with network injection, or set `EVALUATIONS_ENABLED=false` to go back to private-endpoint only |
| In-memory rate limits per replica | With 2 replicas the effective ceiling doubles | Cheap and simple; replicas capped at 2 | Move to a shared store (e.g., Azure Cache for Redis) or API Management |
| No user authentication | Anyone with the URL can use it | Public, synthetic, generic demo ([auth](auth.md)) | Add Entra/SWA auth gate if the scenario becomes sensitive |
| Deterministic host annotators | The manifest’s LLM/classifier annotators are simulated by keyword rules | Keeps policy evaluation free and deterministic | Wire real annotators through the ACS dispatcher |
| Operator IP allow-list | When `AZURE_ALLOWED_IPS` is set, Foundry’s public endpoint opens to those IPs | Needed only for local development against real models | Leave empty (default) in shared environments; remove after use |
