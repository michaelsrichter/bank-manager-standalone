# ADR 0011: Private Link for Foundry; ACR and Azure Monitor public with managed identity

- Status: accepted
- Date: 2026-09-29
- Context: Standards require Private Link to every Azure dependency; the
  template’s ADR 0003 allows documented gaps. Cost is the first WAF priority.
  A private Azure Container Registry requires the Premium SKU (~USD 50/month —
  equal to the whole budget) and a dedicated agent pool for ACR Tasks builds.
  Azure Monitor Private Link Scope adds DNS complexity for telemetry that
  contains no sensitive data.
- Decision: The Foundry account (the only dependency that handles prompts) has
  public network access **disabled** and is reached through a private endpoint
  from the VNet-integrated Container Apps environment. ACR (Basic) and Azure
  Monitor ingestion stay on public endpoints, authenticated with managed identity
  only (ACR admin user and anonymous pull disabled; App Insights local auth
  disabled). Operators can temporarily allow their IP to Foundry with
  `AZURE_ALLOWED_IPS` (default empty).
- Consequences:
  - Good: prompts and model traffic never cross the public internet.
  - Good: stays within a USD 15–20/month run cost.
  - Bad: registry and telemetry endpoints are internet-reachable (auth still
    required) — tracked in `docs/security/threat-model.md`.
