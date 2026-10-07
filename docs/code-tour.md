# Code tour

A request-oriented walk through the code. Each stop explains the behavior in
plain language, names the trust boundary, shows the current source, and points
to the tests that prove it. Excerpts are extracted from the real files at build
time, and the build fails if they drift.

For a deeper look at the Agent Governance Toolkit and ACS policy engine, see the
**[governance code tour](governance-tour.md)**.

## 1. The browser streams a request

**What happens:** the demo page sends one comparison and shows each event as it
arrives. **Boundary:** everything from the browser is untrusted. Events are
applied in order; repeated or late events are ignored, and 45 seconds of
silence counts as a stall.

<!-- tour:snippet id="api-deliver" file="frontend/src/lib/api.ts" lang="typescript" -->
<details open>
<summary><a href="https://github.com/michaelsrichter/bank-manager-standalone/blob/main/frontend/src/lib/api.ts#L218-L224"><code>frontend/src/lib/api.ts</code></a> · lines 218–224</summary>

```typescript
const deliver = (line: string) => {
  if (!line.trim()) return;
  const event = JSON.parse(line) as StreamEvent;
  if (event.seq <= lastSeq) return;
  lastSeq = event.seq;
  onEvent(event);
};
```

</details>
<!-- tour:end -->

Tests: `frontend/src/lib/lib.test.ts` ("delivers ordered events…", "aborts with a stall error…").

## 2. The API bounds every request

**What happens:** size checks run before any work, and security headers are
added to every response. **Boundary:** persona permissions are loaded
server-side and never trusted from the request body (see the
[governance tour, stop 4](governance-tour.md)).

<!-- tour:snippet id="main-guard" file="backend/bank_manager/main.py" lang="python" -->
<details open>
<summary><a href="https://github.com/michaelsrichter/bank-manager-standalone/blob/main/backend/bank_manager/main.py#L288-L304"><code>backend/bank_manager/main.py</code></a> · lines 288–304</summary>

```python
@app.middleware("http")
async def guard_requests(request: Request, call_next: Any) -> Response:
    request_context.begin_request(
        request.url.path,
        request.headers.get(request_context.CONVERSATION_HEADER),
        request.headers.get(request_context.MODE_HEADER),
    )
    if request.method == "POST":
        length = request.headers.get("content-length")
        if length is None:
            return problem(411, "length_required", "Content-Length is required.")
        if not length.isdigit() or int(length) > settings.max_request_bytes:
            return problem(413, "payload_too_large", "The request body is too large.")
    response: Response = await call_next(request)
    for header, value in SECURITY_HEADERS.items():
        response.headers.setdefault(header, value)
    return response
```

</details>
<!-- tour:end -->

Tests: `test_compare_rejects_invalid_requests`, `test_compare_rejects_oversized_bodies`,
`test_rate_limit_returns_429_with_retry_after`.

## 3. The model picks one tool, and nothing more

**What happens:** Azure OpenAI returns a structured choice of tool and
arguments. The model never decides authorization. **Boundary:** model output is
validated before use; an invented account ID fails.

<!-- tour:snippet id="router-normalize" file="backend/bank_manager/ai/router.py" lang="python" -->
<details open>
<summary><a href="https://github.com/michaelsrichter/bank-manager-standalone/blob/main/backend/bank_manager/ai/router.py#L91-L97"><code>backend/bank_manager/ai/router.py</code></a> · lines 91–97</summary>

```python
def normalize_account_id(value: str | None) -> str:
    if value is None:
        return ""
    normalized = value.strip().upper()
    if not re.fullmatch(r"A-\d{1,8}", normalized):
        raise IntentRoutingError("The model returned an invalid account ID.")
    return normalized
```

</details>
<!-- tour:end -->

The model, deployment, prompt files, temperature, and prices all come from
[`config/models.json`](../config/models.json). Tests: `test_rejects_model_invented_account_identifier`,
`test_openai_router_uses_config_prompts_and_reports_response_model`.

## 4. The policy decides

**What happens:** Rego rules return allow, deny, escalate, or transform. Here is
the rule that blocks a manager from reading someone else's account:

<!-- tour:snippet id="rego-account-access" file="backend/governance/policy/bank_manager.rego" lang="rego" -->
<details open>
<summary><a href="https://github.com/michaelsrichter/bank-manager-standalone/blob/main/backend/governance/policy/bank_manager.rego#L52-L60"><code>backend/governance/policy/bank_manager.rego</code></a> · lines 52–60</summary>

```rego
} else := deny("account_access_denied", "The bank manager is not assigned to this account.") if {
	account_scoped_tool
	not account_is_assigned
} else := deny("role_not_authorized", "The current role is not authorized to use bank-manager tools.") if {
	account_scoped_tool
	not recognized_manager_role
} else := deny("auditor_write_denied", "Auditors have read-only access and cannot perform account mutations.") if {
	account_mutation_tool
	manager_role == "auditor"
```

</details>
<!-- tour:end -->

The full walkthrough of all three checks, human approval, and redaction is in
the [governance code tour](governance-tour.md).

## 5. Only safe fields leave the server

**What happens:** telemetry drops any property that isn't on a documented
allow-list, so prompts, results, and account data can't leak into logs.

<!-- tour:snippet id="telemetry-allowlist" file="backend/bank_manager/telemetry.py" lang="python" -->
<details open>
<summary><a href="https://github.com/michaelsrichter/bank-manager-standalone/blob/main/backend/bank_manager/telemetry.py#L62-L70"><code>backend/bank_manager/telemetry.py</code></a> · lines 62–70</summary>

```python
def safe_properties(name: str, properties: dict[str, Any]) -> dict[str, Any]:
    allowed = EVENTS.get(name)
    if allowed is None:
        raise ValueError(f"Undocumented telemetry event: {name}")
    return {
        key: value
        for key, value in properties.items()
        if key in allowed and isinstance(value, (str, int, float, bool))
    }
```

</details>
<!-- tour:end -->

Tests: `test_telemetry_never_contains_prompt_or_tool_text`,
`test_spans_never_contain_prompt_or_tool_output`.

## 6. Health checks the model without paying for it

**What happens:** the health probe sends an intentionally empty chat request.
Foundry rejects it with HTTP 400 before running the model, which proves the
network, identity, and deployment all work, at a cost of zero tokens.

<!-- tour:snippet id="health-model-probe" file="backend/bank_manager/health.py" lang="python" -->
<details open>
<summary><a href="https://github.com/michaelsrichter/bank-manager-standalone/blob/main/backend/bank_manager/health.py#L102-L109"><code>backend/bank_manager/health.py</code></a> · lines 102–109</summary>

```python
def _probe(self) -> ProbeResult:
    try:
        self._client.chat.completions.create(
            model=self._option.deployment, messages=[], max_tokens=1
        )
    except Exception as error:
        return self._classify(error)
    return ProbeResult(self.name, "available", "Deployment answered.", self.critical)
```

</details>
<!-- tour:end -->

Tests: `test_model_probe_classifies_without_inference`, `test_health_service_caches_and_coalesces`.

## 7. Every step of a chat carries the same IDs

**What happens:** the browser sends a random chat ID in the `X-Conversation-Id`
header (and `X-Demo-Mode: practice` in practice mode). The server keeps the ID only if
it matches a strict pattern, then stamps it as `gen_ai.conversation.id` on the request
span and, through a span processor, on every span that request starts. The first stream
event (`run.started`) returns the trace ID and conversation ID, which the
**IDs and observability links** panel under each answer shows.

<!-- tour:snippet id="conversation-stamp" file="backend/bank_manager/request_context.py" lang="python" -->
<details open>
<summary><a href="https://github.com/michaelsrichter/bank-manager-standalone/blob/main/backend/bank_manager/request_context.py#L67-L82"><code>backend/bank_manager/request_context.py</code></a> · lines 67–82</summary>

```python
def begin_request(path: str, conversation: str | None, demo_mode: str | None) -> None:
    """Remember this request's IDs, and stamp them on the request span already running."""
    _conversation_id.set(clean_conversation_id(conversation))
    _mode.set(clean_mode(demo_mode))
    _journey.set(JOURNEYS.get(path))
    stamp(trace.get_current_span())


def stamp(span: trace.Span) -> None:
    if not span.is_recording():
        return
    if (conversation := _conversation_id.get()) is not None:
        span.set_attribute(CONVERSATION_ATTRIBUTE, conversation)
    if (journey := _journey.get()) is not None:
        span.set_attribute(JOURNEY_ATTRIBUTE, journey)
        span.set_attribute(MODE_ATTRIBUTE, _mode.get())
```

</details>
<!-- tour:end -->

Tests: `test_returned_trace_id_is_the_server_trace_and_every_span_has_the_conversation`,
`test_unsafe_conversation_ids_and_modes_are_ignored`, and the frontend
`observability-links.test.tsx`.

## 8. Evaluations are graded in Foundry

**What happens:** a presenter starts a run on the [Evaluations](evaluations/README.md)
page. The API checks the presenter key and the run limits, sends all 18 test
questions through the real pipeline, and asks Microsoft Foundry to grade the
answers. The browser never gets a Foundry token.

<!-- tour:snippet id="main-evaluations" file="backend/bank_manager/main.py" lang="python" -->
<details open>
<summary><a href="https://github.com/michaelsrichter/bank-manager-standalone/blob/main/backend/bank_manager/main.py#L493-L554"><code>backend/bank_manager/main.py</code></a> · lines 493–554</summary>

```python
@app.get("/api/evaluations")
async def evaluations_overview() -> JSONResponse:
    try:
        overview = await deps.evaluations.overview()
    except FoundryError:
        return problem(
            502, "foundry_unavailable", "Microsoft Foundry did not answer. Try again."
        )
    return JSONResponse(overview, headers={"Cache-Control": "no-store"})

@app.get("/api/evaluations/{eval_id}/runs/{run_id}")
async def evaluation_run(eval_id: str, run_id: str) -> JSONResponse:
    try:
        detail = await deps.evaluations.run_detail(eval_id, run_id)
    except ValueError:
        return problem(
            400, "invalid_request", "A Foundry evaluation ID and run ID are required."
        )
    except RunNotFound as error:
        return problem(404, "run_not_found", str(error))
    except EvaluationUnavailable as error:
        return problem(503, "evaluations_unavailable", str(error))
    except FoundryError:
        return problem(
            502, "foundry_unavailable", "Microsoft Foundry did not answer. Try again."
        )
    return JSONResponse(detail, headers={"Cache-Control": "no-store"})

@app.post("/api/evaluations/runs", status_code=202)
async def start_evaluation(request: Request) -> JSONResponse:
    # Each run calls the AI model and a judge model, so it needs the presenter key.
    try:
        deps.evaluations.presenter.check(
            request.headers.get("x-demo-presenter-key"), client_ip(request)
        )
    except PresenterKeyError as error:
        headers = {"Retry-After": str(error.retry_after)} if error.retry_after else {}
        status = 429 if error.retry_after else 403
        return problem(status, error.code, str(error), **headers)
    try:
        summary = await deps.evaluations.start()
    except RunConflict as error:
        response = problem(409, "run_in_progress", str(error))
        response.headers["X-Run-Id"] = error.run_id
        return response
    except RunLimit as error:
        return problem(
            429, "run_limit_reached", str(error), **{"Retry-After": str(error.retry_after)}
        )
    except EvaluationUnavailable as error:
        return problem(503, "evaluations_unavailable", str(error))
    except FoundryError:
        return problem(
            502, "foundry_unavailable", "Microsoft Foundry did not confirm the new run."
        )
    deps.sink.emit(
        "evaluation_run_started",
        suite=deps.evaluations.suite.suite_name,
        items=len(deps.evaluations.suite.rows),
        status=summary["status"],
    )
    return JSONResponse(summary, status_code=202, headers={"Cache-Control": "no-store"})
```

</details>
<!-- tour:end -->

Foundry can report a run as completed even when a grader could not run. So each
question is scored here, from every **required** grader result:

<!-- tour:snippet id="evaluation-score" file="backend/bank_manager/evaluations.py" lang="python" -->
<details open>
<summary><a href="https://github.com/michaelsrichter/bank-manager-standalone/blob/main/backend/bank_manager/evaluations.py#L558-L567"><code>backend/bank_manager/evaluations.py</code></a> · lines 558–567</summary>

```python
def score_item(suite: EvaluationSuite, results: Sequence[Mapping[str, Any]]) -> str:
    """passed: every required grader ran and passed. failed: any required grader failed.
    not_scored: no required grader failed, but at least one did not produce a grade."""
    by_name = {result["name"]: result for result in results}
    required = [grader.name for grader in suite.graders if grader.required]
    if any(by_name.get(name, {}).get("passed") is False for name in required):
        return "failed"
    if all(by_name.get(name, {}).get("passed") is True for name in required):
        return "passed"
    return "not_scored"
```

</details>
<!-- tour:end -->

Tests: `test_a_question_passes_only_when_every_required_grader_passed`,
`test_grader_errors_reported_as_completed_are_not_grades`,
`test_every_dataset_row_matches_the_real_policy_in_fake_mode`.
