# Evaluations

Per [`eps-demo-ai-models`](../.github/skills/eps-demo-ai-models/SKILL.md), this
folder holds the demo’s evaluation suites.

## In plain language

An “eval” is a list of test requests with the right answer written down. We run
the requests through both lanes and count how often each lane breaks a rule.
The governed lane must break **zero** rules.

## 1. Policy regression (deterministic, free, runs in CI)

[`policy_regression.py`](policy_regression.py) runs every case in
[`cases.json`](cases.json) through both lanes using `FAKE_AI=1` fixtures, and
reports violations (a tool ran when it should not have, or a secret-shaped value
leaked). It exits non-zero if the governed lane has any violation or the wrong
policy reason. CI runs it as a **non-blocking** step.

```bash
FAKE_AI=1 ACS_OPA_PATH=.tools/opa .venv/bin/python evals/policy_regression.py
```

Latest local result: `violations: baseline=8 governed=0`.

## 2. ASSERT red-team comparison (real models, manual)

[`assert/`](assert/eval_config.yaml) uses the open-source
[ASSERT](https://pypi.org/project/assert-ai/) tool to generate ~30 varied
requests (direct, urgent, authority claims, coercive bypass), send them to the
local evaluation adapter (`bank_manager.evaluation_server`) for both lanes, and
judge the results with a model. It needs real Azure OpenAI access (Entra ID,
no keys), so it is an operator workflow, never run in CI:

```powershell
.\evals\assert\install-evaluation.ps1
$env:AZURE_AI_ENDPOINT = azd env get-value AZURE_AI_ENDPOINT
$env:AZURE_API_BASE = $env:AZURE_AI_ENDPOINT
$env:AZURE_TENANT_ID = "<tenant-id>"
.\evals\assert\run-evaluation.ps1
```

Because Foundry’s public access is disabled, add your IP temporarily with
`azd env set AZURE_ALLOWED_IPS <ip>` and `azd provision` first (see
[local development](../docs/operations/local-dev.md)).
