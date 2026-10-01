# Agent Guidance for this Repository

This repository is an EPS AI partner-facing "vibe-coded" demo generated from
the EPS demos template. Agents working here (GitHub Copilot in VS Code, Copilot
CLI, Copilot cloud agent, Codex, Cursor) must follow the standards below.

## Authoritative source

The full standards live in `.github/skills/`. Each subfolder is a
self-contained skill with a `SKILL.md`. **Load the relevant skill before
acting**, especially `eps-demo-standards` first.

| Concern | Skill |
|---|---|
| Master / routing | `.github/skills/eps-demo-standards/SKILL.md` |
| Azure & Bicep | `.github/skills/eps-demo-architecture/SKILL.md` |
| UX & a11y | `.github/skills/eps-demo-ux/SKILL.md` |
| Identity & auth | `.github/skills/eps-demo-identity/SKILL.md` |
| Testing & SOLID | `.github/skills/eps-demo-testing-solid/SKILL.md` |
| Documentation | `.github/skills/eps-demo-docs/SKILL.md` |
| Plain-language writing (all docs and UI text) | `.github/skills/eps-demo-plain-language/SKILL.md` |
| Developer experience | `.github/skills/eps-demo-devx/SKILL.md` |
| AI & models | `.github/skills/eps-demo-ai-models/SKILL.md` |
| Cost & security | `.github/skills/eps-demo-cost-security/SKILL.md` |
| Long-lived release readiness | `.github/skills/eps-demo-production-readiness/SKILL.md` |
| Telemetry (OpenTelemetry) & Azure Monitor dashboards | `.github/skills/eps-demo-observability/SKILL.md` |
| Review IDs in the app & links into Azure Monitor | `.github/skills/eps-demo-telemetry-links/SKILL.md` |
| Compliance | `.github/skills/eps-demo-compliance/SKILL.md` |
| Repo hygiene | `.github/skills/eps-demo-repo-hygiene/SKILL.md` |
| Presentations: talk decks, scripts, two-screen presenter mode (**opt-in only**) | `.github/skills/eps-demo-presentation/SKILL.md` |
| Foundry Evaluations: graded test suites and the Evaluations page (**opt-in only**) | `.github/skills/eps-demo-evaluations/SKILL.md` |

**Opt-in skills** are used only when the user asks for them. Today those are
`eps-demo-presentation` and `eps-demo-evaluations`. **This repo has opted in to
both**: it has a presentation experience (`frontend/src/presentation/`,
`docs/presentation/`) and Foundry Evaluations (`/#/evaluations`,
`backend/bank_manager/evaluations.py`, `evals/dataset/`, `docs/evaluations/`), so
keep them working and apply those skills to changes and reviews of them.

## Repository agents

Use the user-invocable agents under `.github/agents/` when their workflow fits:

- `eps-demo-builder.agent.md` — interviews, builds, deploys, and verifies a demo
  end to end.
- `eps-demo-release-reviewer.agent.md` — read-only readiness audit with an
  evidence-backed release verdict.

## This repository

This repo is a **scaffolded demo** generated from the EPS template, not the
template itself. Treat requests as normal feature work against the rules below.

- **What it is:** a governed AI bank assistant. One Azure OpenAI call picks a
  bank tool; the same call runs through an ungoverned baseline and through the
  Agent Control Specification (ACS) policy engine. See
  [docs/architecture/overview.md](docs/architecture/overview.md).
- **Stack:** FastAPI backend (`backend/bank_manager/`), React + TypeScript +
  Vite frontend (`frontend/`), ACS manifest and Rego policy
  (`backend/governance/`), Bicep (`infra/`), one container on Azure Container
  Apps ([ADR 0007](docs/adr/0007-container-apps-single-container.md)).
- **Models and prompts:** only in `config/models.json` and `config/prompts/`.
  Bicep reads the same JSON to create deployments.
- **Deterministic mode:** `FAKE_AI=1` uses `FakeIntentRouter` + fixtures in
  `backend/tests/fixtures/ai/`.
- **Policy changes:** edit `backend/governance/policy/*.rego`, add an `opa test`
  case and a pytest case (positive **and** negative).
- **Repo-specific ADRs:** 0007–0012 under `docs/adr/`. The compliance table in
  `docs/README.md` must stay honest.
- **Observability:** every answer shows its trace ID and conversation ID with
  links into Azure Monitor (`eps-demo-telemetry-links`). Workbooks live in
  `infra/dashboards/`, generated or edited in Git, never only in the portal.
- **Practice mode** (`#/demo?mode=practice`) skips the AI model and still runs the
  real policy engine. It is always labeled **Practice** and never presented as live.

## Hard rules (no exceptions without explicit human approval)

1. Always hosted in **Azure**. Bicep for IaC.
2. **Managed Identity** always; **no** keys, connection strings, SAS, or passwords in source.
3. **Private Link** to all Azure dependencies. If you knowingly ship without it to move fast, it is a **documented, tracked gap** (see below) — not silent scope creep.
4. **No hardcoded models** — model selection is config-driven.
5. **Content filters on** by default.
6. **No PII collected** — use the alias + GUID local profile pattern for state.
7. **No partner/customer names** on the public site; demo-only indicator visible.
8. **`/docs` is the single source of truth** for documentation.
9. **Coverage gates** in CI: BE ≥ 70%, FE ≥ 60%. `FAKE_AI=1` is mandatory in CI.
10. **VS Code Run-All** task starts the whole stack in split-terminal panels with titles/colors/icons.
11. **Uniform CLI verbs:** `dev`, `test`, `lint`, `deploy` — same in every repo.
12. **No local emulators** — local dev hits a shared dev Azure subscription/resources.
13. **Safe agent visibility** — show progress and tool lifecycle; use only safe
    provider reasoning summaries or application status, never hidden
    chain-of-thought.
14. **Workload identity is explicit** — agents with different downstream data
    rights use different identities/credentials and both positive and negative
    authorization tests.
15. **Long-lived demos are operable** — apply
    `eps-demo-production-readiness` when the demo is globally shared or runs for
    weeks/months.
16. **Plain language everywhere** — public UI is written for high-school
    students and people whose first language is not English. All docs,
    including technical `/docs`, follow `eps-demo-plain-language`.

## Public-site language

- Write for high-school students and people who do not speak English as their
  first language. Use short, literal sentences and familiar examples.
- Explain what the visitor can do and what happened before naming the
  technology. Use an everyday example for abstract controls, such as: "A note
  inside a delivery box cannot give permission to send private company files."
- Keep service names, IDs, acronyms, raw errors, traces, and detailed cost math
  in clearly labeled optional details. Show useful progress, never hidden
  reasoning.
- Keep technical precision and advanced material in `/docs`. These public-UI
  rules do not require removing important details from engineering docs.

## Documentation language (all docs)

- Before writing or editing any documentation or explanatory text, load
  `.github/skills/eps-demo-plain-language/SKILL.md`. It applies everywhere:
  `/docs`, READMEs, UI help text, tooltips, labels, tutorials, setup steps,
  demo scripts, explanatory code comments, and error messages.
- Use short sentences and common words. Define each technical term and acronym
  the first time it appears. Explain why a choice was made. Add a concrete
  example when a definition alone could confuse.
- Assume the reader is smart, not familiar. Simplify the explanation, not the
  technical accuracy.

## Definition of done

A demo is not complete merely because it builds locally. Before handoff:

1. lint, build, tests, coverage, Bicep, and secret checks pass;
2. the intended Azure environment and custom domain are current;
3. the critical live journey and at least one expected denial are verified;
4. health reports ready without scheduled model inference;
5. model/tool/evidence/trace behavior is visible where applicable, and a live
   answer's trace ID and conversation ID open in Azure Monitor from the app
   (`eps-demo-telemetry-links`);
6. narrative and technical docs are served and linked when repository access is
   not guaranteed;
7. temporary deployment resources and packages are removed; and
8. the release commit is pushed and the working tree is clean.

The production-readiness skill owns the detailed version of this contract.

## Ship with an honest gap list, not silent shortcuts

Speed matters more than gold-plating for these demos, so a rule can be
knowingly deferred — but never silently. When you defer one of the hard
rules above (most often Private Link, rate limiting, or CI coverage gates):

- Record it in `docs/README.md`'s standards-compliance table (✅ / ⚠️ / ❌ + link).
- Explain the accepted risk and remediation path in the relevant `docs/security/`
  or `docs/operations/` file.
- Never defer **Managed Identity** (no keys/passwords) or **no PII/no partner
  names** — those two have no "documented gap" escape hatch.

## How to behave

- **Investigate before changing.** Read this file plus the relevant `SKILL.md`(s) before editing.
- **Surface a compliance gap list** before refactoring an existing repo.
- **Ask the human** which gaps to fix in the current pass; do not silently rewrite.
- **Cite the skill** by name in your plan / PR description (e.g., "per `eps-demo-architecture`, switching X to Bicep").
- **Refuse anti-patterns** listed in the skills, even when asked. Propose the compliant alternative.

## Repository-specific overrides

If this specific repo needs to deviate from a standard, capture it as an ADR under `docs/adr/` and link it from the relevant section here. Without an ADR, the skill rule wins.

## Quick commands

```bash
make dev      # run the full stack locally
make test     # run all tests with coverage
make lint     # lint + format check
make deploy   # deploy via Bicep / azd
```
