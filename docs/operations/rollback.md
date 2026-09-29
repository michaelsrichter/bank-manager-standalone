# Rollback

## In plain language

If a new version breaks, switch back to the last version that worked. It takes
about a minute.

## Option 1 — redeploy a known-good commit (preferred)

```bash
git checkout <good-commit>
azd deploy web
git checkout main
```

The colophon in the footer shows which commit is live.

## Option 2 — reactivate the previous image

Container Apps runs in single-revision mode. Point it back at the previous
image digest in the registry:

```bash
az acr repository show-manifests -n <registry> --repository bank-manager-governance/web-bankgov --orderby time_desc -o table
az containerapp update -g rg-bankgov -n <container-app> --image <registry>.azurecr.io/<repo>@sha256:<digest>
```

## Option 3 — roll back infrastructure

Infrastructure is declarative. Check out the previous `infra/` and run
`azd provision`. Model changes in `config/models.json` roll back the same way.

## Tear down

```bash
azd down --purge   # deletes the resource group and purges the Foundry account
```
