#!/usr/bin/env bash
# azd preprovision hook — derives values that must never be hardcoded per
# architect (eps-demo-architecture: grant the signed-in developer the same
# RBAC as the app identity; eps-demo-cost-security: budget alerts need a real
# contact). Run automatically by `azd up` / `azd provision`.
set -euo pipefail

if ! az account show >/dev/null 2>&1; then
  echo "Not logged into Azure CLI. Run 'az login' first." >&2
  exit 1
fi

if [ -z "${AZURE_PRINCIPAL_ID:-}" ]; then
  principal_id="$(az ad signed-in-user show --query id -o tsv)"
  azd env set AZURE_PRINCIPAL_ID "$principal_id"
fi

if [ -z "${AZURE_BUDGET_EMAIL:-}" ]; then
  budget_email="$(az account show --query user.name -o tsv)"
  azd env set AZURE_BUDGET_EMAIL "$budget_email"
fi

# Custom domain, phase 2 (docs/operations/custom-domain.md): once the free managed
# certificate has been issued, bind the hostname with SNI on this provision.
domain="${AZURE_CUSTOM_DOMAIN:-}"
ready="false"
if [ -n "$domain" ] && [ -n "${RESOURCE_GROUP_NAME:-}" ] && [ -n "${AZURE_CONTAINER_ENVIRONMENT_NAME:-}" ]; then
  count="$(az containerapp env certificate list \
    -g "$RESOURCE_GROUP_NAME" -n "$AZURE_CONTAINER_ENVIRONMENT_NAME" \
    --managed-certificates-only \
    --query "length([?properties.subjectName=='$domain' && properties.provisioningState=='Succeeded'])" \
    -o tsv 2>/dev/null || echo 0)"
  if [ "${count:-0}" -gt 0 ]; then ready="true"; fi
fi
if [ "${AZURE_CUSTOM_DOMAIN_CERT_READY:-}" != "$ready" ]; then
  azd env set AZURE_CUSTOM_DOMAIN_CERT_READY "$ready"
fi
if [ -n "$domain" ]; then
  echo "Custom domain $domain: $([ "$ready" = true ] && echo 'binding with the issued certificate' || echo 'adding hostname and requesting a certificate')"
fi
