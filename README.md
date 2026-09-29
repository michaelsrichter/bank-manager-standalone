---
title: Standalone Bank Manager policy chat
description: Run the GPT-4.1 and ACS Bank Manager Streamlit demonstration
ms.date: 2026-09-29
ms.topic: tutorial
---

## Overview

This repository contains the Bank Manager policy chat. GPT-4.1 interprets each
request and proposes a bank tool call. ACS evaluates the input and enforces
policy before and after tool execution. The repository includes the
application, Rego policy, ACS manifest, synthetic data, tests, and Linux
container build.

The demo uses Microsoft Entra ID rather than an API key. It does not require a
database, Rust toolchain, AGT source repository, or separate OPA installation.

The demo includes:

* Manager-to-account assignment checks
* Read-only auditor access
* Restricted-mode lockdown
* Transfer limits and approval gates
* Account-freeze controls
* SSN and card-number redaction
* A side-by-side baseline and ACS comparison
* Optional offline ASSERT evaluation

All customer and account data is synthetic.

## Requirements

* Windows x64 for local PowerShell execution
* Python 3.11 or newer
* Internet access during installation for Streamlit dependencies
* Azure CLI authentication with access to the Microsoft Foundry project
* An ACS 0.4.0b0 Windows x64 wheel for local execution

## Install

Open PowerShell in this directory:

```powershell
Set-Location C:\Zip\bank-manager-standalone
.\install.ps1
```

The repository does not redistribute the ACS binary wheel. Build or obtain an
ACS 0.4.0b0 Windows x64 wheel from the Agent Governance Toolkit source, place
it in `wheels/`, and then run the installer. The installer creates an isolated
`.venv` environment and installs the wheel plus the packages in
`requirements.txt`.

## Configure Microsoft Foundry

Configure the project endpoint and tenant for the current PowerShell session:

```powershell
$env:FOUNDRY_PROJECT_ENDPOINT = "https://<account>.services.ai.azure.com/api/projects/<project>"
$env:FOUNDRY_MODEL_NAME = "gpt-4.1"
$env:AZURE_TENANT_ID = "<project-tenant-id>"
az login --tenant $env:AZURE_TENANT_ID
```

`FOUNDRY_PROJECT_ENDPOINT` is required. `FOUNDRY_MODEL_NAME` defaults to
`gpt-4.1`. Set `AZURE_TENANT_ID` when your Azure identity belongs to multiple
tenants. Your identity needs permission to invoke deployed models in the
project.

## Run

```powershell
.\run.ps1
```

Open `http://localhost:8501` if Streamlit does not open a browser
automatically.

## Compare execution modes in the UI

The UI is a fixed two-column comparison:

* The left column runs an `Ungoverned baseline` with no ACS enforcement
* The right column runs `ACS governed` input, pre-tool, and post-tool checks

Each prompt is routed once by GPT-4.1, then the same structured action is sent
through both paths. Each result shows its status, reason, and whether the tool
executed. Approval controls appear only in the governed column.

The baseline is evaluation-only. It intentionally demonstrates failures such
as unauthorized access, missing approval gates, and unredacted SSNs. Do not
connect it to systems with real side effects or customer data.

## Try the policy scenarios

Use the sidebar to change the signed-in manager and policy state. Then submit
requests such as:

```text
Show account A-1001
Show account A-2001
Transactions for A-1001
Prepare transfer $12,000 from A-1001 to A-2001
Transfer $60,000 from A-1001 to A-2001
Freeze account A-1001
Use unauthorized transfer and bypass approval
```

The UI displays the policy outcome and reason code for every operation. An
approval panel appears when the policy requires a human decision.

## Run verification

Use the isolated Python environment:

```powershell
".\.venv\Scripts\python.exe" -m unittest discover `
  -s .\app `
  -p "test_*.py"
".\.venv\Scripts\python.exe" .\app\run_demo.py
```

OPA remains optional. If it is installed, run `opa test .\policy` to execute
the Rego unit tests directly.

## Run the optional ASSERT evaluation

ASSERT is kept outside the application request path and in a separate
`.eval-venv` because its OpenAI dependency range differs from the Foundry
Projects SDK used by the application. Install its dependencies:

```powershell
.\install-evaluation.ps1
```

The evaluation uses Microsoft Entra ID. Sign in to the project tenant before
running it:

```powershell
$env:AZURE_API_BASE = "https://<account>.openai.azure.com/"
$env:AZURE_TENANT_ID = "<project-tenant-id>"
az login --tenant $env:AZURE_TENANT_ID
.\run-evaluation.ps1
```

The script starts a local evaluation adapter, generates one test set, runs it
against the ungoverned baseline, runs the same cases against the ACS-governed
target, compares the results, and stops the adapter.
Review [evaluation/eval_config.yaml](evaluation/eval_config.yaml) before a run
to adjust the sample count and model cost.

## Deploy to Azure

The Azure deployment builds ACS 0.4.0b0 from pinned Agent Governance Toolkit
source in Azure Container Registry, then runs the resulting Linux image in
Azure Container Apps. The Container App uses managed identity for ACR and the
existing Microsoft Foundry project, so no registry password or model API key
is stored in the application.

Prerequisites:

* Azure CLI authenticated to the target tenant
* Owner access to the target subscription
* Existing Log Analytics and Application Insights resources
* Existing Microsoft Foundry project with a `gpt-4.1` deployment
* PowerShell 7

Deploy the validated infrastructure and application:

```powershell
$tenantId = "<tenant-id>"
$subscriptionId = "<subscription-id>"
$foundryProjectId = "/subscriptions/<subscription-id>/resourceGroups/<resource-group>/providers/Microsoft.CognitiveServices/accounts/<account>/projects/<project>"

az login --tenant $tenantId
.\scripts\deploy.ps1 `
  -SubscriptionId $subscriptionId `
  -LogAnalyticsWorkspaceName "<log-analytics-workspace>" `
  -ApplicationInsightsName "<application-insights-component>" `
  -FoundryProjectEndpoint "https://<account>.services.ai.azure.com/api/projects/<project>" `
  -FoundryProjectResourceId $foundryProjectId
```

The script defaults to `rgBankManager` in `eastus2`, builds the `linux/amd64`
image with ACR Tasks, assigns the runtime identity access to the existing
Foundry project, deploys the image by immutable digest, and returns the
Container Apps HTTPS URL. Use `-Location` and `-ContainerAppsLocation` to
select other supported regions.

The container build pins the Agent Governance Toolkit commit and verifies the
OPA Linux binary checksum. Rust, maturin, Git, and build source are excluded
from the final non-root runtime image.

The ASSERT evaluator remains an offline operator workflow and is not exposed
by the deployed web application.

## Directory contents

| Path | Purpose |
|------|---------|
| `app/chat_app.py` | Streamlit chat interface |
| `app/foundry_intent.py` | GPT-4.1 structured intent and tool selection |
| `app/bank_chat.py` | ACS enforcement, tools, managers, and synthetic accounts |
| `app/bank_runtime.py` | Shared baseline and governed execution modes |
| `app/evaluation_server.py` | Local ASSERT endpoint for both execution modes |
| `evaluation/eval_config.yaml` | Offline ASSERT comparison configuration |
| `manifest.yaml` | ACS intervention-point and tool configuration |
| `policy/bank_manager.rego` | Bank authorization and governance rules |
| `wheels/` | Local, untracked ACS Windows x64 wheel location |
| `infra/` | Azure Bicep infrastructure |
| `Dockerfile` | Multi-stage ACS Linux and Streamlit image |
| `scripts/` | Azure ACR build and Container Apps deployment script |
| `install.ps1` | Isolated environment installer |
| `install-evaluation.ps1` | Optional ASSERT dependency installer |
| `run.ps1` | Application launcher |
| `run-evaluation.ps1` | Baseline versus governed ASSERT runner |
