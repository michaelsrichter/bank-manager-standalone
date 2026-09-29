# Troubleshooting

| Symptom | Likely cause | Fix |
|---|---|---|
| Provision fails: `SubscriptionNotRegisteredForFeature ... AllowBringYourOwnPublicIpAddress` | New subscription has not enabled the feature VNet-integrated Container Apps needs | `az feature register --namespace Microsoft.Network --name AllowBringYourOwnPublicIpAddress`, `az provider register -n Microsoft.Network`, delete the failed environment, wait for deletion to finish, re-run `azd provision`. |
| First page load takes 5–15 s | Scale-to-zero cold start | Expected. Set `minReplicas: 1` in `infra/resources.bicep` for events (adds cost). |
| Health shows model `misconfigured` — “Identity is not authorized” | Role assignment still propagating (up to ~5 min) or missing | Wait, then check `Cognitive Services OpenAI User` on the Foundry account for `id-web-*`. |
| Health shows model `unreachable` | Private DNS not resolving from Container Apps | Confirm the private endpoint is `Approved` and the three `privatelink.*` zones are linked to the VNet. |
| Health shows model `misconfigured` — “Deployment not found” | `config/models.json` changed without re-provisioning | Run `azd provision`. |
| Local run: model calls fail with 403 | Foundry public access is disabled | Use `FAKE_AI=1`, or `azd env set AZURE_ALLOWED_IPS <your-ip>` + `azd provision` (remove afterwards). |
| Local run: `runtime_error:policy_invocation_failed` | OPA binary not found | Set `ACS_OPA_PATH` to an OPA 1.x binary (`make install` downloads one on Linux/macOS). |
| `pip install` cannot find `agent-control-specification` | Not on PyPI | `make install` builds it from the pinned Agent Governance Toolkit commit (needs Rust). |
| `azd deploy` build fails in ACR | Transient GitHub/rustup download failure | Re-run `azd deploy web`. |
| Telemetry missing in App Insights | Local auth is disabled; identity lacks `Monitoring Metrics Publisher` | Check the role; allow ~5 min ingestion delay. |
| 429 in the UI | Rate limit reached | Wait for the `Retry-After` seconds. |
| Dashboard or workbook looks unchanged after a deploy | The Azure portal caches both | Reopen the page or click **Refresh**. |
| Foundry panels show HTTP 400 calls | The health check's intentional no-inference probe | Expected. See [observability](../telemetry/observability.md#reading-the-charts). |
| Dashboards are mostly empty | No traffic yet | `make traffic` (about USD 0.15 per hour). |
| Colophon shows an older commit | Deployed before committing | Commit, push, then `azd deploy web`. |

## Getting access to the shared dev resources

Ask the owner (see [CODEOWNERS](../../CODEOWNERS)) to add you to the
subscription, then run `azd env refresh -e bankgov` and `azd provision` with
`AZURE_PRINCIPAL_ID` set to your object ID so the developer role module grants you
the same data-plane roles as the app.
