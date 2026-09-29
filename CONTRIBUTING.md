# Contributing

This repo is an **EPS AI partner-facing "vibe-coded" demo** generated from the
EPS demos template. Before contributing, read [AGENTS.md](AGENTS.md) and the skills under
[.github/skills/](.github/skills/) — they are the authoritative standards.
Full documentation lives in
[docs/](docs/README.md).

## Working on this demo

Read [docs/operations/local-dev.md](docs/operations/local-dev.md) first. Run the
**EPS Demo Release Reviewer** agent (`.github/agents/`) before handing off a release.

## Uniform CLI

Every EPS demo exposes the same four verbs:

```bash
make dev      # run the full stack locally
make test     # run all tests with coverage (sets FAKE_AI=1)
make lint     # lint + format check
make deploy   # azd up — deploy via Bicep
```

In VS Code, the **Run All** task (`.vscode/tasks.json`) starts the stack, and
**Debug All** (`.vscode/launch.json`) attaches debuggers to the backend and
frontend.

## Prerequisites

- [Azure CLI](https://learn.microsoft.com/cli/azure/) + [azd](https://aka.ms/azd), signed in (`az login`)
- [GitHub CLI](https://cli.github.com/), signed in (`gh auth login`)
- Python 3.12, Node.js 24, Rust (builds the ACS wheel), GNU Make — or just use
  the devcontainer / Codespaces

There are **no local emulators** — local dev uses `FAKE_AI=1` or the real
dev Azure resources via `az login`. There are no secrets at all.

## Workflow

1. Branch from `main`.
2. Make surgical changes — no drive-by refactors.
3. `make lint && make test` must pass locally. `make lint` also validates skill
   front matter, custom-agent discovery, `/new-demo` coverage, and local
   Markdown links.
4. Coverage gates: **backend ≥ 70%**, **frontend ≥ 60%**. CI enforces them.
   Policy changes need a positive and a negative test (`opa test` + pytest).
5. CI runs with `FAKE_AI=1` so no real AI calls are made in pipelines.
6. Open a PR. CODEOWNERS review is required.

## Design rules (per `eps-demo-testing-solid`)

- Dependency-inject every external dependency (HTTP, storage, AI client,
  clock, randomness). No `new SomeClient()` inside business logic.
- Every AI call must be routable through the `FAKE_AI=1` fake.
- No hardcoded model names — model selection is config-driven
  (`config/models.json`).
- No secrets in source. Managed Identity first, Key Vault second.

## Commits & branches

- Small, focused commits with clear messages.
- Cite the skill you are complying with when it clarifies intent
  (e.g., "per `eps-demo-architecture`, ...").

## Architecture Decision Records

Material decisions — including deviations from a skill's default — are
captured as ADRs under `docs/adr/`. Add one when you knowingly diverge; see
[docs/adr/](docs/adr/) for the format and the template's own founding
decisions.
