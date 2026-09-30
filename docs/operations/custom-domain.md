# Custom domain

## In plain language

The app already has an Azure address that's hard to remember. A custom domain
gives it a friendly name, like `bankmanager.eps-demos.site`. You add two small
records at your domain registrar: one points the name at the app, and one proves
you own it. Azure then gives the name a free HTTPS certificate and renews it for you.

## Current settings

**Status: live since 2026-09-30** at <https://bankmanager.eps-demos.site>. The certificate is Azure-managed, issued by DigiCert (GeoTrust TLS RSA CA G1), valid to 2027-03-30, and renews automatically. HTTP redirects to HTTPS, and the app sends HSTS.

| Item | Value |
|---|---|
| Custom domain | `bankmanager.eps-demos.site` |
| App hostname (CNAME target) | `ca-bank-6pdxl7iobaep4.salmonsea-6cb97f40.eastus2.azurecontainerapps.io` |
| Domain verification ID (TXT value) | `9FAA2164A9745A4898E12E4B938019C0037BEA06CD4FC9727F2C0831472C4140` |
| DNS host for `eps-demos.site` | Namecheap BasicDNS (`dns1/dns2.registrar-servers.com`) |

Both values also come from the azd environment:
`azd env get-value SERVICE_WEB_URL` and `azd env get-value AZURE_CUSTOM_DOMAIN_VERIFICATION_ID`.
The verification ID is the same for every hostname on this app.

## Step 1: add two DNS records (Namecheap)

Namecheap → **Domain List** → `eps-demos.site` → **Manage** → **Advanced DNS** →
**Host Records** → **Add New Record**:

| Type | Host | Value | TTL |
|---|---|---|---|
| CNAME Record | `bankmanager` | `ca-bank-6pdxl7iobaep4.salmonsea-6cb97f40.eastus2.azurecontainerapps.io.` | Automatic |
| TXT Record | `asuid.bankmanager` | `9FAA2164A9745A4898E12E4B938019C0037BEA06CD4FC9727F2C0831472C4140` | Automatic |

Notes:

- Namecheap adds `.eps-demos.site` to the **Host** for you. Type only
  `bankmanager` and `asuid.bankmanager`.
- Namecheap accepts the CNAME value with or without the trailing dot.
- Don't add an A record for `bankmanager`. A name can have a CNAME or an A record, not both.
- Check propagation (usually a few minutes):
  `nslookup -type=CNAME bankmanager.eps-demos.site 8.8.8.8` and
  `nslookup -type=TXT asuid.bankmanager.eps-demos.site 8.8.8.8`.

## Step 2: bind it in Azure

```powershell
./tools/custom-domain.ps1 -Domain bankmanager.eps-demos.site
```

The script checks public DNS first, then runs two `azd provision` phases:

1. **Phase 1** adds the hostname to the Container App (`bindingType: Disabled`)
   and requests a free managed certificate. Azure validates it through the CNAME.
2. It waits for the certificate, which usually takes 5–20 minutes.
3. **Phase 2** binds the hostname with SNI, then checks
   `https://bankmanager.eps-demos.site/api/health`.

Two phases are needed because Azure can only issue the certificate after the
hostname is on the app. The preprovision hook detects the issued certificate
and sets `AZURE_CUSTOM_DOMAIN_CERT_READY=true` automatically, so every later
`azd up` keeps the binding. It's all in Bicep
(`infra/resources.bicep`: `customDomains` and `managedCertificate`), not a
one-off portal change.

Manual equivalent: `azd env set AZURE_CUSTOM_DOMAIN bankmanager.eps-demos.site`,
then `azd provision`, wait for the certificate, and run `azd provision` again.

## What changes, what doesn't

- The default `*.azurecontainerapps.io` address keeps working.
- HTTPS only. HTTP redirects to HTTPS (`allowInsecure: false`).
- The app serves its API and pages from one origin, so no CORS changes are needed.
- The certificate renews automatically while the CNAME stays in place.

## Remove it

`azd env set AZURE_CUSTOM_DOMAIN ""`, run `azd provision`, then delete both DNS records.

## Troubleshooting

| Symptom | Fix |
|---|---|
| Phase 1 fails with "TXT record ... not found" or "hostname verification" | The `asuid.bankmanager` TXT record isn't visible yet. Wait and re-run. |
| Certificate stays `Pending` or goes `Failed` | The CNAME must point straight at the app hostname, with no Namecheap URL redirect and no proxy. There must be no CAA record that blocks DigiCert (`eps-demos.site` has none today). |
| Browser shows a certificate warning | Phase 2 hasn't run yet. Re-run the script; it's safe to repeat. |
