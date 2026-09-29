# Code tour

A request-oriented walk through the code. Each stop explains the behavior in
plain language, the trust boundary, a short current excerpt, and the tests that
prove it.

## 1. The browser sends a request

**What happens:** the demo page streams one comparison and renders each event as
it arrives. **Boundary:** everything from the browser is untrusted.

[`frontend/src/lib/api.ts`](../frontend/src/lib/api.ts) — ordered delivery, dedupe, stall detection:

```ts
const deliver = (line: string) => {
  if (!line.trim()) return;
  const event = JSON.parse(line) as StreamEvent;
  if (event.seq <= lastSeq) return;
  lastSeq = event.seq;
  onEvent(event);
};
```

Tests: `frontend/src/lib/lib.test.ts` (“delivers ordered events…”, “aborts with a stall error…”).

## 2. The API bounds and validates it

**What happens:** size, rate, and schema checks run before any work.
**Boundary:** persona permissions are loaded server-side, never trusted from the body.

[`backend/bank_manager/main.py`](../backend/bank_manager/main.py):

```python
if request.method == "POST":
    length = request.headers.get("content-length")
    if length is None:
        return problem(411, "length_required", "Content-Length is required.")
    if not length.isdigit() or int(length) > settings.max_request_bytes:
        return problem(413, "payload_too_large", "The request body is too large.")
```

[`backend/bank_manager/bank/governance.py`](../backend/bank_manager/bank/governance.py):

```python
persona = PERSONAS.get(persona_id)
if persona is None:
    raise UnknownPersonaError(f"Unknown persona: {persona_id!r}")
```

Tests: `test_compare_rejects_invalid_requests`, `test_compare_rejects_oversized_bodies`,
`test_rate_limit_returns_429_with_retry_after`.

## 3. The model picks one tool (and nothing more)

**What happens:** Azure OpenAI returns a structured `BankIntent`. The model never
decides authorization. **Boundary:** model output is validated before use.

[`backend/bank_manager/ai/router.py`](../backend/bank_manager/ai/router.py):

```python
def normalize_account_id(value: str | None) -> str:
    if value is None:
        return ""
    normalized = value.strip().upper()
    if not re.fullmatch(r"A-\d{1,8}", normalized):
        raise IntentRoutingError("The model returned an invalid account ID.")
    return normalized
```

The model, deployment, prompt files, temperature, and prices all come from
[`config/models.json`](../config/models.json). Tests: `test_rejects_model_invented_account_identifier`,
`test_openai_router_uses_config_prompts_and_reports_response_model`.

## 4. Two lanes run the same tool call

**What happens:** the baseline runs the tool directly; the governed lane goes
through three ACS checks and streams each step.

[`backend/bank_manager/comparison.py`](../backend/bank_manager/comparison.py):

```python
yield "step", {"id": "governed.pre_tool", "state": "started"}
pre_outcome = await evaluate_action(control, action, snapshot)
yield "step", {"id": "governed.pre_tool", "state": "completed", "status": pre_outcome["status"]}
if pre_outcome["status"] in {"deny", "approval"}:
```

Tests: `test_governed_blocks_unassigned_read_before_tool_runs`,
`test_governed_redacts_ssn_after_tool_runs`, `test_governed_denies_transfer_over_hard_limit`.

## 5. The policy decides

**What happens:** Rego rules return allow, deny, escalate, or transform.

[`backend/governance/policy/bank_manager.rego`](../backend/governance/policy/bank_manager.rego):

```rego
} else := deny("account_access_denied", "The bank manager is not assigned to this account.") if {
	account_scoped_tool
	not account_is_assigned
} else := deny("role_not_authorized", "The current role is not authorized to use bank-manager tools.") if {
```

Tests: `opa test backend/governance/policy` and the Python governance tests.

## 6. Only safe fields leave the server

**What happens:** results are projected to an allow-list and truncated;
telemetry drops anything not documented.

[`backend/bank_manager/telemetry.py`](../backend/bank_manager/telemetry.py):

```python
return {
    key: value
    for key, value in properties.items()
    if key in allowed and isinstance(value, (str, int, float, bool))
}
```

Tests: `test_telemetry_never_contains_prompt_or_tool_text`, `test_safe_properties_drops_unknown_and_complex_values`.

## 7. Approvals cannot bypass policy

**What happens:** Approve re-validates the action and re-runs ACS with an
approval resolver. Denials stay denials.

Tests: `test_approval_cannot_override_hard_denial`, `test_approval_cannot_bypass_account_assignment`,
`test_approval_rejects_forged_tools_and_personas`.

## 8. Health proves the denial, without paying for inference

[`backend/bank_manager/health.py`](../backend/bank_manager/health.py):

```python
self._client.chat.completions.create(
    model=self._option.deployment, messages=[], max_tokens=1
)
```

A 400 validation error proves network, identity, and deployment — no tokens
billed. Tests: `test_model_probe_classifies_without_inference`,
`test_health_service_caches_and_coalesces`.
