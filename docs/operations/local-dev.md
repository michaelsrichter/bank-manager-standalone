# Local development

## In plain language

You can run the whole app on your computer. By default it uses a pretend AI
(`FAKE_AI=1`) so it is free and gives the same answers every time.

## One-time setup

The devcontainer / Codespaces has everything preinstalled. Otherwise you need
Python 3.12, Node 24, Rust (to build the ACS wheel), and GNU Make.

```bash
make install     # venv, ACS wheel from pinned source, OPA binary, npm ci
```

## Run

```bash
make dev         # backend on :8000 + Vite frontend on :5173 (FAKE_AI=1)
```

In VS Code, run the **Run All** task (split terminals: 🟧 backend, 🟦 frontend)
or press F5 for **Debug All**.

Open <http://localhost:5173>. The Vite dev server proxies `/api` to the backend.

## Against real Azure models (no emulators)

Foundry only accepts private-network traffic by default. For a short local
session:

```bash
azd env set AZURE_ALLOWED_IPS "$(curl -s https://api.ipify.org)"
azd provision
export FAKE_AI=0 AZURE_AI_ENDPOINT="$(azd env get-value AZURE_AI_ENDPOINT)"
make dev-backend
# afterwards: azd env set AZURE_ALLOWED_IPS "" && azd provision
```

Your `az login` identity already has the same data-plane roles as the app
(granted by `infra/modules/data-plane-roles.bicep`).

## Test and lint

```bash
make test        # pytest (≥ 70%) + vitest (≥ 60%) with FAKE_AI=1
make lint        # guidance, ruff, eslint, prettier, tsc, bicep, opa test
```
