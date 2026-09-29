# Governed AI Bank Assistant (demo)

> **For demo purposes only.** All people, accounts, and numbers are fictional.
> Not an official Microsoft product.

An AI model turns a plain-English bank request into one tool call. The **same**
tool call then runs twice, side by side:

- **No rules** — runs immediately (unsafe on purpose, to show what can go wrong).
- **Governed by policy** — the [Agent Control Specification](https://github.com/microsoft/agent-governance-toolkit)
  runtime checks the request, the tool call, and the result, and can allow,
  block, pause for human approval, or redact private data.

Built on Azure AI Foundry (GPT-4.1 / GPT-4.1 mini), Azure Container Apps,
FastAPI, and React. Forked from
[tmathew1000/bank-manager-standalone](https://github.com/tmathew1000/bank-manager-standalone)
and rebuilt to the EPS AI demo standards in [AGENTS.md](AGENTS.md).

## Quick start

```bash
make install   # Python venv, ACS wheel (pinned source, needs Rust), OPA, npm ci
make dev       # backend :8000 + frontend :5173 with FAKE_AI=1 (no Azure needed)
make test      # backend ≥ 70% and frontend ≥ 60% coverage gates, FAKE_AI=1
make lint      # guidance, ruff, eslint, prettier, tsc, bicep, opa test
make deploy    # azd up — provisions Azure and deploys the container
```

In VS Code, run the **Run All** task or press **F5** (Debug All). The
[devcontainer](.devcontainer/devcontainer.json) has every tool preinstalled.

## Documentation

Everything lives in **[docs/](docs/README.md)** (also served in the app under
*Docs*): architecture, security, cost, operations, telemetry, health, API,
code tour, and ADRs.

## Authors

Built by Mike Richter and Thomas Mathew at Microsoft.

## License

[MIT](LICENSE). See [SECURITY.md](SECURITY.md) to report a vulnerability and
[CONTRIBUTING.md](CONTRIBUTING.md) to contribute.
