# Creates a new presenter key for starting Foundry evaluation runs from the site
# (docs/evaluations/README.md). Prints the key once and stores only its SHA-256
# hash in the azd environment. Run `azd provision` afterwards to apply it.
$ErrorActionPreference = "Stop"

$bytes = New-Object byte[] 18
[Security.Cryptography.RandomNumberGenerator]::Fill($bytes)
$key = "bank-" + [Convert]::ToBase64String($bytes).Replace("+", "A").Replace("/", "B").Replace("=", "")
$hash = -join ([Security.Cryptography.SHA256]::HashData([Text.Encoding]::UTF8.GetBytes($key)) |
    ForEach-Object { $_.ToString("x2") })

azd env set EVALUATIONS_PRESENTER_KEY_SHA256 $hash | Out-Null
Write-Host "New presenter key (shown once; it is not stored anywhere):"
Write-Host "  $key"
Write-Host "Saved its SHA-256 hash in the azd environment. Run 'azd provision' to apply it."
