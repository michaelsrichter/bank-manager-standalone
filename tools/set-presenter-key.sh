#!/usr/bin/env bash
# Creates a new presenter key for starting Foundry evaluation runs from the site
# (docs/evaluations/README.md). Prints the key once and stores only its SHA-256
# hash in the azd environment. Run `azd provision` afterwards to apply it.
set -euo pipefail

key="bank-$(openssl rand -base64 18 | tr '+/' 'AB' | tr -d '=\n')"
hash="$(printf '%s' "$key" | openssl dgst -sha256 -r | cut -d' ' -f1)"

azd env set EVALUATIONS_PRESENTER_KEY_SHA256 "$hash" >/dev/null
echo "New presenter key (shown once; it is not stored anywhere):"
echo "  $key"
echo "Saved its SHA-256 hash in the azd environment. Run 'azd provision' to apply it."
