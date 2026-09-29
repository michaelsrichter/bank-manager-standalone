$ErrorActionPreference = "Stop"

$root = Resolve-Path (Join-Path $PSScriptRoot "..\..")
$assert = Join-Path $root ".eval-venv\Scripts\assert-ai.exe"
$appPython = Join-Path $root ".venv\Scripts\python.exe"
$backend = Join-Path $root "backend"
$config = Join-Path $PSScriptRoot "eval_config.yaml"
$artifacts = Join-Path $PSScriptRoot "artifacts"

if (-not (Test-Path $assert)) {
    throw "ASSERT is not installed. Run .\install-evaluation.ps1 first."
}
if (-not (Test-Path $appPython)) {
    throw "The application environment is missing. Run make install (or create .venv) first."
}

if (-not $env:AZURE_AI_ENDPOINT -and $env:FAKE_AI -ne "1") {
    throw "Set AZURE_AI_ENDPOINT (azd env get-value AZURE_AI_ENDPOINT) or FAKE_AI=1 for the adapter."
}
if (-not $env:AZURE_API_BASE) {
    throw "Set AZURE_API_BASE to the Azure OpenAI endpoint used by ASSERT."
}
if (-not $env:AZURE_API_VERSION) {
    $env:AZURE_API_VERSION = "2025-03-01-preview"
}
if (-not $env:AZURE_TENANT_ID) {
    throw "Set AZURE_TENANT_ID to the Microsoft Foundry project tenant."
}
$env:ASSERT_AZURE_USE_AAD = "1"
$env:ASSERT_ALLOW_PRIVATE_ENDPOINTS = "1"

function Invoke-AssertCommand {
    param([string[]]$Arguments)

    & $assert @Arguments
    if ($LASTEXITCODE -ne 0) {
        throw "ASSERT command failed with exit code $LASTEXITCODE."
    }
}

Push-Location $root
$adapterProcess = $null
try {
    $adapterProcess = Start-Process `
        -FilePath $appPython `
        -ArgumentList @("-m", "bank_manager.evaluation_server", "--port", "8765") `
        -WorkingDirectory $backend `
        -PassThru `
        -NoNewWindow

    $ready = $false
    for ($attempt = 0; $attempt -lt 30; $attempt++) {
        try {
            $response = Invoke-WebRequest `
                -Uri "http://127.0.0.1:8765/health" `
                -UseBasicParsing `
                -TimeoutSec 2
            if ($response.StatusCode -eq 200) {
                $ready = $true
                break
            }
        }
        catch {
            Start-Sleep -Seconds 1
        }
    }
    if (-not $ready) {
        throw "The local evaluation adapter did not become ready."
    }

    Invoke-AssertCommand @(
        "run",
        "--config", $config,
        "--override", "artifacts_root=$artifacts"
    )
    Invoke-AssertCommand @(
        "run",
        "--config", $config,
        "--override", "artifacts_root=$artifacts",
        "--override", "run=acs-governed",
        "--override",
        "inference.target.endpoint=http://127.0.0.1:8765/governed"
    )
    Invoke-AssertCommand @(
        "results", "compare",
        "bank-manager-policy-comparison",
        "baseline",
        "acs-governed",
        "--results-dir", (Join-Path $artifacts "results")
    )
}
finally {
    if ($null -ne $adapterProcess -and -not $adapterProcess.HasExited) {
        Stop-Process -Id $adapterProcess.Id
    }
    Pop-Location
}
