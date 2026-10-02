# ADR 0014: Foundry public endpoint (Entra ID only) for evaluations

- Status: accepted
- Date: 2026-10-01
- Supersedes in part: [ADR 0011](0011-private-link-scope.md) (the Foundry account
  no longer has public network access disabled while evaluations are on)
- Context: [Foundry Evaluations](../evaluations/README.md) grade runs inside
  Microsoft's evaluation service. We tested every network setting on the
  deployed demo, starting runs as the app's managed identity:

  | Foundry account network | Result |
  |---|---|
  | Public access disabled (private endpoint only) | Every run failed at once: `UnauthorizedUserAction: The action cannot be finished with reason Forbidden` |
  | Public access enabled, default **Deny**, trusted Azure services allowed (`bypass: AzureServices`) | Same failure |
  | Public access enabled, default **Allow**, Entra ID only | Runs completed |

  The error looks like a missing role, but the same identity and roles worked as
  soon as the network allowed public traffic. Microsoft's supported way to keep
  evaluations private is **network injection** (a delegated subnet and a
  capability host). It cannot be added to an existing Foundry account; the
  account would have to be recreated.
- Decision: While evaluations are on (`evaluationsEnabled`, default true), the
  Foundry account accepts public traffic with **Microsoft Entra ID only**
  (`disableLocalAuth: true`, so no API keys exist). The web app still reaches the
  account through its private endpoint. Setting `EVALUATIONS_ENABLED=false` in the
  azd environment returns the account to private-endpoint only and turns the
  feature off. This is the same posture as the ELK Burgers demo's Foundry account.
- Consequences:
  - Good: live evaluations work, with no keys and least-privilege roles.
  - Bad: the model endpoint is reachable from the internet. Every call still
    needs an Entra ID token from an identity that holds a role on the account.
    Tracked as a known gap in `docs/security/threat-model.md`.
  - Follow-up: for a long-lived or sensitive deployment, recreate the Foundry
    account with network injection (Microsoft's evaluation-only template, 15a)
    and switch the public endpoint off again.
