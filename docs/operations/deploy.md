# Deploy

## In plain language

One command builds the app and everything it needs in Azure. Run it again any
time to update the app.

## Prerequisites

- Azure CLI (`az login`) and Azure Developer CLI (`azd auth login`) signed in to
  the **same tenant and subscription** you will deploy to.
- Owner (or Contributor + User Access Administrator) on the subscription —
  the templates create role assignments.
- Global Standard quota for the models in [`config/models.json`](../../config/models.json)
  in your region (default `eastus2`).
- Node.js 24 (only for the `prepackage` hook that stamps the colophon).
- No local Docker needed: the image is built remotely by ACR Tasks.

## First deploy

```bash
azd env new <env-name> --subscription <subscription-id> --location eastus2
azd up            # or: make deploy
```

`azd up` runs, in order:

1. `infra/hooks/preprovision.*` — sets `AZURE_PRINCIPAL_ID` (you) and
   `AZURE_BUDGET_EMAIL` (your sign-in) if missing.
2. **Provision** — `infra/main.bicep` creates the resource group and all
   resources. The Container App starts with a placeholder image.
3. **Package** — the `predeploy` / `prepackage` hook writes
   `frontend/src/generated/build-info.json` (commit SHA, date, message) for the
   footer colophon. Commit and push **before** deploying so the colophon
   matches the pushed release.
4. **Deploy** — ACR Tasks builds the multi-stage `Dockerfile` (compiles the ACS
   Rust wheel from a pinned commit, downloads OPA with a SHA-256 check, builds the
   React app) and the Container App is updated to the new image. The first build
   takes ~10–15 minutes; later builds are similar because the Rust stage is
   rebuilt each time.

The output includes `SERVICE_WEB_URL`. Verify with:

```bash
curl -s "$SERVICE_WEB_URL/api/health" | jq .status   # expect "ready"
```

## Useful settings (`azd env set NAME value`)

| Name | Default | Purpose |
|---|---|---|
| `AZURE_MONTHLY_BUDGET_USD` | `50` | Budget alert amount |
| `AZURE_BUDGET_EMAIL` | your sign-in | Budget + 5xx alert recipient |
| `AZURE_GRANT_DEVELOPER_ACCESS` | `true` | Give you the same data-plane roles as the app |
| `AZURE_ALLOWED_IPS` | empty | Temporary operator IPs for Foundry’s public endpoint (local dev only) |

## Current deployment

| Item | Value |
|---|---|
| Subscription | MCAPS-Hybrid-REQ-119059-2025-mrichter |
| Region | eastus2 |
| azd environment | `bankgov` → resource group `rg-bankgov` |
| URL | <https://ca-bank-6pdxl7iobaep4.salmonsea-6cb97f40.eastus2.azurecontainerapps.io/> |

One-time subscription prerequisite discovered during the first deploy: VNet-integrated
Container Apps environments needed the `Microsoft.Network/AllowBringYourOwnPublicIpAddress`  
feature (`az feature register --namespace Microsoft.Network --name AllowBringYourOwnPublicIpAddress`,
then `az provider register -n Microsoft.Network`). See [troubleshooting](troubleshooting.md).

## CI/CD (GitHub Actions)

- [`ci.yml`](../../.github/workflows/ci.yml) runs on every PR and push:
  guidance lint, Bicep build, gitleaks, OPA policy tests, backend lint + tests
  (≥ 70% coverage), frontend lint + tests (≥ 60%) + build, all with `FAKE_AI=1`.
- [`deploy.yml`](../../.github/workflows/deploy.yml) runs `azd up` on merge to
  `main` using OIDC (no client secret). It is **inert** until you run
  `azd pipeline config` (or set `AZURE_CLIENT_ID`, `AZURE_TENANT_ID`,
  `AZURE_SUBSCRIPTION_ID`, `AZURE_ENV_NAME`, `AZURE_LOCATION` repository
  variables). The PR-preview job is also gated on those variables. This is a
  tracked gap in [docs/README.md](../README.md).
