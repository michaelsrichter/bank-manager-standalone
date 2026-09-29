# Authentication and identity

## In plain language

Visitors do not sign in. The demo uses only made-up data, so there is nothing to
protect with a login. The *app itself* does have an identity in Azure, and that
identity is the only thing allowed to call the AI model.

## End-user identity: none (alias + GUID for fairness)

Per [`eps-demo-identity`](../../.github/skills/eps-demo-identity/SKILL.md), this is a
public, generic demo with no partner IP, so the lightest option applies:

- On first visit the browser creates a random alias (e.g., “Calm Otter 4821”)
  and a random GUID v4, stored in `localStorage` (`bm.profile.v1`).
- Only the GUID leaves the browser, in the `X-Demo-Session` header, and only as
  a **rate-limit bucket key**. It is a lookup handle, **not authentication**.
- The server never stores the GUID. “Reset profile” creates a new one.
- The personas (Riley, Sam, Jordan) are fictional roles chosen from a list.
  Their permissions are defined on the server.

## Workload identity

| Identity | Used by | Roles | Scope |
|---|---|---|---|
| `id-web-<token>` (user-assigned MI) | Container App | `AcrPull` | Container registry |
| | | `Cognitive Services OpenAI User` | Foundry account |
| | | `Monitoring Metrics Publisher` | Application Insights |
| Developer (`AZURE_PRINCIPAL_ID`) | Local development | Same two data-plane roles (not `AcrPull`) | Same scopes |

The developer grant uses the **same Bicep module**
([`infra/modules/data-plane-roles.bicep`](../../infra/modules/data-plane-roles.bicep))
as the app identity so they cannot drift. Disable it with
`azd env set AZURE_GRANT_DEVELOPER_ACCESS false`.

In the container, `DefaultAzureCredential(managed_identity_client_id=AZURE_CLIENT_ID)`
obtains tokens. Locally, the same code uses your `az login` session.

There is a single agent boundary (one model call, one tool set), so one workload
identity is sufficient. If a future agent gets different data rights, give it
its own identity.
