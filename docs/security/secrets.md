# Secrets

## In plain language

This demo has **no passwords or API keys** anywhere — not in code, not in
settings, not in a vault. Every Azure service checks the app’s Azure identity
instead.

## How each dependency authenticates

| Dependency | Method | Key-based auth |
|---|---|---|
| Microsoft Foundry / Azure OpenAI | Entra token for `https://cognitiveservices.azure.com/.default` via `DefaultAzureCredential` | **Disabled** (`disableLocalAuth: true`) |
| Application Insights | Entra token via `configure_azure_monitor(credential=...)` | **Disabled** (`DisableLocalAuth: true`) |
| Container Registry | Managed identity pull (`AcrPull`) | Admin user disabled; anonymous pull disabled |
| Container Apps → Log Analytics | `azure-monitor` destination + diagnostic settings | No shared key passed |
| GitHub Actions → Azure | OIDC federated credential (when enabled) | No client secret |

The Application Insights connection string is set as an environment variable.
It is an identifier, not a credential: with local auth disabled, ingestion
without an Entra token is rejected.

## Key Vault

Not deployed, because there is nothing secret to store. If a partner service
that cannot use Entra ID is added, store its least-privilege credential in Key
Vault (RBAC mode), grant `Key Vault Secrets User` on that one secret only, and
document the trust boundary here.

## Guardrails

- `gitleaks` runs in CI and in the pre-commit hook.
- `.env` files are ignored; `.env.example` holds only non-secret settings.
- GitHub secret scanning and push protection are enabled on the repository.
