"""Foundry Evaluations (eps-demo-evaluations): suite, scoring, service, and API contract."""

from __future__ import annotations

import asyncio
import hashlib
import json
from dataclasses import replace
from pathlib import Path
from typing import Any

import httpx
import pytest
from fastapi.testclient import TestClient

from bank_manager.ai.router import ContentFilteredError, FakeIntentRouter
from bank_manager.config import REPO_ROOT, FoundryProject, Settings
from bank_manager.evaluations import (
    AnswerUsage,
    EvaluationService,
    EvaluationSuite,
    EvaluationUnavailable,
    FoundryError,
    FoundryEvalsHttpTransport,
    PresenterGate,
    PresenterKeyError,
    RunConflict,
    RunLimit,
    RunNotFound,
    error_category,
    generate_answers,
    grader_result,
    load_dataset,
    output_item,
    run_summary,
    run_usage,
    score_item,
)
from bank_manager.main import AppDependencies, create_app
from bank_manager.telemetry import MemoryEventSink

SUB = "5220f650-c4a2-4634-bac8-1a2d76b89d94"
PROJECT_ID = (
    f"/subscriptions/{SUB}/resourceGroups/rg-demo/providers/Microsoft.CognitiveServices"
    "/accounts/ais-demo/projects/bank-manager"
)
PROJECT_ENV = {
    "EVALUATIONS_ENABLED": "1",
    "FOUNDRY_PROJECT_ENDPOINT": "https://ais-demo.services.ai.azure.com/api/projects/bank-manager",
    "FOUNDRY_PROJECT_RESOURCE_ID": PROJECT_ID,
}
EVAL_ID = "eval_" + "a" * 32
RUN_ID = "evalrun_" + "b" * 32
KEY = "correct horse battery staple"
KEY_HASH = hashlib.sha256(KEY.encode()).hexdigest()
NOW = 1_790_000_000.0


@pytest.fixture(scope="module")
def suite(intent_config) -> EvaluationSuite:
    return EvaluationSuite.load(REPO_ROOT / "config" / "evaluations.json", REPO_ROOT, intent_config)


@pytest.fixture()
def project() -> FoundryProject:
    found = FoundryProject.from_env(PROJECT_ENV)
    assert found is not None
    return found


# ------------------------------------------------------------------ settings


def test_project_settings_are_validated_and_build_portal_links(project):
    assert project.evaluations_api == (
        "https://ais-demo.services.ai.azure.com/api/projects/bank-manager/openai/v1/"
    )
    # Same subscription encoding as Foundry's own report_url values.
    assert project.portal_evaluations_url == (
        "https://ai.azure.com/nextgen/r/UiD2UMSiRjS6yBotdridlA,rg-demo,,ais-demo,bank-manager"
        "/build/evaluations"
    )
    assert FoundryProject.from_env({**PROJECT_ENV, "EVALUATIONS_ENABLED": "0"}) is None
    for key, value in {
        "FOUNDRY_PROJECT_ENDPOINT": "https://evil.example.com/api/projects/bank-manager",
        "FOUNDRY_PROJECT_RESOURCE_ID": PROJECT_ID.replace("bank-manager", "other"),
    }.items():
        assert FoundryProject.from_env({**PROJECT_ENV, key: value}) is None, key
    settings = Settings.from_env({"EVALUATIONS_PRESENTER_KEY_SHA256": KEY_HASH.upper()})
    assert settings.presenter_key_sha256 == KEY_HASH
    assert (
        Settings.from_env({"EVALUATIONS_PRESENTER_KEY_SHA256": "secret"}).presenter_key_sha256
        is None
    )


# --------------------------------------------------------------------- suite


def test_suite_config_builds_a_fixed_foundry_definition(suite):
    assert suite.suite_name == "bank-governance-web-v1"
    assert len(suite.rows) == 18
    assert suite.judge_input_usd_per_million == 0.4
    body = suite.definition()
    assert body["metadata"]["source"] == "bank-manager-web"
    assert body["data_source_config"]["item_schema"]["required"] == ["id", "query"]
    criteria = {criterion["name"]: criterion for criterion in body["testing_criteria"]}
    assert set(criteria) == {grader.name for grader in suite.graders}
    assert criteria["safe_and_appropriate"]["model"] == "gpt-4.1-mini"
    assert criteria["intent_resolution"]["initialization_parameters"] == {
        "deployment_name": "gpt-4.1-mini"
    }
    assert "{judgeModel}" not in json.dumps(body)
    # Every {{item.x}} a grader reads is a field the app sends.
    for name in json.dumps(body).split("{{item.")[1:]:
        assert name.split("}}")[0] in suite.item_fields
    public = suite.public()
    assert [grader["required"] for grader in public["graders"]] == [True, True, True, True, False]


def test_dataset_validation_rejects_bad_rows(tmp_path):
    good = json.loads(
        (REPO_ROOT / "evals" / "dataset" / "governance.jsonl").read_text().splitlines()[0]
    )
    for change in ({"persona": "M-999"}, {"expected_outcome": "maybe"}, {"id": "Bad Id"}):
        path = tmp_path / "rows.jsonl"
        path.write_text(json.dumps({**good, **change}) + "\n")
        with pytest.raises(ValueError):
            load_dataset(path)
    path = tmp_path / "dupes.jsonl"
    path.write_text((json.dumps(good) + "\n") * 2 + "\n")
    with pytest.raises(ValueError, match="unique"):
        load_dataset(path)


def test_every_dataset_row_matches_the_real_policy_in_fake_mode(suite, control, intent_config):
    """The deterministic graders must pass for every row when the tool choice is right.

    If a policy rule changes, this test fails before a live run shows a surprise.
    """
    items, usage = asyncio.run(
        generate_answers(
            suite.rows,
            router=FakeIntentRouter(),
            control=control,
            option=intent_config.default_option,
        )
    )
    assert usage.calls == len(suite.rows)
    for item in items:
        assert item["selected_tool"] == item["expected_tool"], item["id"]
        assert item["governed_outcome"] == item["expected_outcome"], item["id"]
        assert item["expected_masked_text"] in item["governed_reply"], item["id"]
        assert "000-" not in item["governed_reply"], item["id"]
        assert set(item) == set(suite.item_fields)


def test_content_filter_block_counts_as_a_denial(suite, control, intent_config):
    class Filtered:
        def route(self, prompt, option):
            raise ContentFilteredError("blocked")

    items, usage = asyncio.run(
        generate_answers(
            suite.rows[:1], router=Filtered(), control=control, option=intent_config.default_option
        )
    )
    assert items[0]["selected_tool"] == "blocked_by_content_filter"
    assert items[0]["governed_outcome"] == "denied"
    assert items[0]["governed_reason"] == "azure_content_filter"
    assert items[0]["no_rules_result"] == "no tool ran"
    assert usage.calls == 0


# ------------------------------------------------------------------- scoring


def result(name: str, passed: bool | None = True, **extra: Any) -> dict[str, Any]:
    return {"name": name, "status": "completed", "passed": passed, "score": 1, **extra}


def test_grader_errors_reported_as_completed_are_not_grades(suite):
    errored = grader_result(
        suite,
        result(
            "private_data_hidden",
            False,
            sample={"error": {"message": "401 PermissionDenied principal 1234 lacks access"}},
        ),
    )
    assert errored["status"] == "error"
    assert errored["passed"] is None
    assert errored["errorCategory"] == "access_denied"
    assert "1234" not in json.dumps(errored)
    judged = grader_result(
        suite,
        result(
            "safe_and_appropriate",
            sample={
                "output": [
                    {
                        "content": json.dumps(
                            {"steps": [{"conclusion": "Masked."}, {"conclusion": "Fits."}]}
                        )
                    }
                ]
            },
        ),
    )
    assert judged["reason"] == "Masked. Fits."
    assert judged["label"] == "Judge: safe and appropriate"


def test_a_question_passes_only_when_every_required_grader_passed(suite):
    required = [grader.name for grader in suite.graders if grader.required]
    graded = [result(name) for name in required]
    assert score_item(suite, graded) == "passed"
    # The informational built-in grader cannot fail a correct refusal.
    assert score_item(suite, [*graded, result("intent_resolution", False)]) == "passed"
    assert score_item(suite, [*graded[:-1], result(required[-1], False)]) == "failed"
    missing = [*graded[:-1], result(required[-1], None, status="error")]
    assert score_item(suite, missing) == "not_scored"
    assert score_item(suite, graded[:-1]) == "not_scored"


@pytest.mark.parametrize(
    ("message", "category"),
    [
        ("Error code: 401 - PermissionDenied", "access_denied"),
        (
            "UnauthorizedUserAction: The action cannot be finished with reason Forbidden",
            "network_blocked",
        ),
        ("Public access is disabled. Please configure private endpoint.", "network_blocked"),
        ("429 Too Many Requests", "rate_limited"),
        ("", "unknown"),
        ("something odd", "grader_error"),
    ],
)
def test_error_categories(message, category):
    assert error_category(message)[0] == category


def test_usage_counts_the_judge_model_once(suite):
    usage = run_usage(
        suite,
        {
            "per_model_usage": [
                {
                    "model_name": "gpt-4.1-mini-2025-04-14",
                    "invocation_count": 36,
                    "prompt_tokens": 1_000_000,
                    "completion_tokens": 100_000,
                },
                {
                    "model_name": "azure_ai_evaluation",
                    "invocation_count": 18,
                    "prompt_tokens": 999,
                    "completion_tokens": 99,
                },
            ],
            "metadata": {"answer_cost_usd": "0.016", "answer_input_tokens": "x"},
        },
    )
    assert usage["judgeCalls"] == 36
    assert usage["judgeCostUsd"] == pytest.approx(0.4 + 0.16)
    assert usage["answerCostUsd"] == pytest.approx(0.016)
    assert usage["answerInputTokens"] is None


def test_output_items_keep_only_known_fields_in_grader_order(suite):
    item = output_item(
        suite,
        {
            "datasource_item": {
                "id": "row",
                "query": "q",
                "secret": "x",
                "governed_reply": "r" * 900,
            },
            "results": [
                result("intent_resolution", False),
                *[result(grader.name) for grader in suite.graders if grader.required],
            ],
        },
    )
    assert "secret" not in item
    assert len(item["governed_reply"]) == 600
    assert [entry["name"] for entry in item["results"]] == [g.name for g in suite.graders]
    assert item["verdict"] == "passed"


# ------------------------------------------------------------------- service


class FakeFoundry:
    """In-memory stand-in for the Foundry project's /openai/v1/evals API."""

    def __init__(self, *, evals=None, runs=None, items=None) -> None:
        self.calls: list[tuple[str, str, Any]] = []
        self.evals = (
            evals
            if evals is not None
            else [
                {
                    "id": EVAL_ID,
                    "name": "bank-governance-web-v1",
                    "metadata": {"source": "bank-manager-web"},
                },
                {"id": "eval_" + "c" * 32, "name": "someone-else", "metadata": {"source": "other"}},
            ]
        )
        self.runs = runs if runs is not None else []
        self.items = items if items is not None else []

    def send(self, method, path, body=None):
        self.calls.append((method, path, body))
        if method == "GET" and path.startswith("evals?"):
            return {"data": self.evals}
        if method == "POST" and path == "evals":
            created = {**body, "id": "eval_" + "d" * 32}
            self.evals.append(created)
            return created
        if method == "GET" and path.endswith("/runs?limit=20&order=desc"):
            return {"data": self.runs}
        if method == "GET" and "/runs?limit=50" in path:
            return {"data": self.runs}
        if method == "POST" and path.endswith("/runs"):
            return {"id": RUN_ID, "status": "queued", "created_at": NOW, "error": {}, **body}
        if method == "GET" and "/output_items" in path:
            if "after=" in path:
                return {"data": self.items[1:], "has_more": False}
            return {"data": self.items[:1], "has_more": len(self.items) > 1, "last_id": "1"}
        if method == "GET" and "/runs/" in path:
            return {
                "id": RUN_ID,
                "status": "completed",
                "created_at": NOW - 150,
                "modified_at": NOW,
                "report_url": "https://evil.example.com/x",
            }
        if method == "GET" and path.startswith("evals/"):
            return next(e for e in self.evals if e["id"] == path.split("/")[1])
        raise AssertionError(path)


def service(suite, project, foundry, *, clock=lambda: NOW, presenter=None, example=None):
    async def answers():
        return ([{"id": "row", "query": "q"}], AnswerUsage("gpt-4.1", 1, 100, 10, 0.001))

    return EvaluationService(
        suite,
        project=project,
        transport=foundry,
        answers=answers,
        presenter=presenter or PresenterGate(KEY_HASH),
        app_version="abc1234",
        recorded_example=example,
        clock=clock,
    )


def test_overview_lists_only_this_suite_and_caches(suite, project):
    foundry = FakeFoundry(
        runs=[
            {
                "id": RUN_ID,
                "status": "in_progress",
                "created_at": NOW - 30,
                "metadata": {"trigger": "web"},
                "report_url": "https://ai.azure.com/nextgen/r/x/build/evaluations/1",
                "per_testing_criteria_results": [
                    {"testing_criteria": "policy_decision", "passed": 3}
                ],
            },
            {"id": "not-a-run"},
        ]
    )
    svc = service(suite, project, foundry)
    overview = asyncio.run(svc.overview())
    assert overview["available"] and overview["canStart"]
    [run] = overview["runs"]
    assert run["active"] and run["startedFromSite"]
    assert run["portalUrl"].startswith("https://ai.azure.com/")
    assert run["perGrader"][0]["label"] == "Policy made the right call"
    listed = [path for _, path, _ in foundry.calls if path.endswith("/runs?limit=20&order=desc")]
    assert listed == [f"evals/{EVAL_ID}/runs?limit=20&order=desc"]
    calls = len(foundry.calls)
    asyncio.run(svc.overview())
    assert len(foundry.calls) == calls


def test_overview_without_foundry_shows_the_recorded_example(suite, tmp_path):
    example = tmp_path / "example.json"
    example.write_text(json.dumps({"run": {"name": "recorded"}}))
    svc = EvaluationService(
        suite,
        project=None,
        transport=None,
        answers=None,  # type: ignore[arg-type]
        presenter=PresenterGate(None),
        recorded_example=example,
    )
    overview = asyncio.run(svc.overview())
    assert not overview["available"] and not overview["canStart"]
    assert overview["example"] == {"run": {"name": "recorded"}}
    with pytest.raises(EvaluationUnavailable):
        asyncio.run(svc.start())
    with pytest.raises(EvaluationUnavailable):
        asyncio.run(svc.run_detail(EVAL_ID, RUN_ID))
    example.write_text("not json")
    assert svc.recorded_example() is None


def test_run_detail_validates_ids_pages_items_and_drops_unsafe_links(suite, project):
    required = [result(g.name) for g in suite.graders if g.required]
    foundry = FakeFoundry(
        items=[
            {"datasource_item": {"id": "one"}, "results": required},
            {
                "datasource_item": {"id": "two"},
                "results": [*required[:-1], result(required[-1]["name"], False)],
            },
        ]
    )
    svc = service(suite, project, foundry)
    with pytest.raises(ValueError):
        asyncio.run(svc.run_detail("eval_x", RUN_ID))
    detail = asyncio.run(svc.run_detail(EVAL_ID, RUN_ID))
    assert detail["score"] == {"total": 2, "passed": 1, "failed": 1, "notScored": 0}
    assert detail["run"]["durationSeconds"] == 150
    assert detail["run"]["portalUrl"] == project.portal_evaluations_url
    with pytest.raises(RunNotFound):
        asyncio.run(svc.run_detail("eval_" + "c" * 32, RUN_ID))


def test_start_creates_the_suite_once_and_sends_answers(suite, project):
    foundry = FakeFoundry(evals=[])
    clock = [NOW]
    svc = service(suite, project, foundry, clock=lambda: clock[0])
    summary = asyncio.run(svc.start())
    assert summary["runId"] == RUN_ID and summary["startedFromSite"]
    assert summary["errorCategory"] is None
    created = [body for method, path, body in foundry.calls if (method, path) == ("POST", "evals")]
    assert created == [suite.definition()]
    run_body = foundry.calls[-1][2]
    assert run_body["name"].startswith("web-")
    assert run_body["metadata"]["answer_cost_usd"] == "0.001000"
    assert run_body["data_source"]["source"]["content"] == [{"item": {"id": "row", "query": "q"}}]
    # Foundry's list can lag behind a new run: the run this server started still blocks.
    with pytest.raises(RunConflict):
        asyncio.run(svc.start())
    foundry.runs = [{"id": RUN_ID, "status": "failed", "created_at": NOW}]
    asyncio.run(svc.start())
    foundry.runs = []
    clock[0] = NOW + 7200
    asyncio.run(svc.start())
    assert len([c for c in foundry.calls if c[:2] == ("POST", "evals")]) == 1


@pytest.mark.parametrize(
    ("runs", "error"),
    [
        ([{"id": RUN_ID, "status": "running", "created_at": NOW - 60}], RunConflict),
        (
            [{"id": f"r{i}", "status": "completed", "created_at": NOW - 600} for i in range(3)],
            RunLimit,
        ),
        (
            [{"id": f"r{i}", "status": "failed", "created_at": NOW - 7200} for i in range(10)],
            RunLimit,
        ),
    ],
)
def test_start_respects_one_run_at_a_time_and_limits(suite, project, runs, error):
    with pytest.raises(error):
        asyncio.run(service(suite, project, FakeFoundry(runs=runs)).start())


def test_a_stuck_old_run_does_not_block_new_runs(suite, project):
    runs = [{"id": RUN_ID, "status": "running", "created_at": NOW - 3 * 3600}]
    assert asyncio.run(service(suite, project, FakeFoundry(runs=runs)).start())["runId"] == RUN_ID


def test_run_errors_use_the_code_as_well_as_the_message(suite, project):
    summary = run_summary(
        suite,
        project,
        {"id": EVAL_ID},
        {
            "id": RUN_ID,
            "status": "failed",
            "error": {
                "code": "UnauthorizedUserAction",
                "message": "The action cannot be finished with reason Forbidden",
            },
        },
    )
    assert summary["errorCategory"] == "network_blocked"
    assert "Forbidden" not in summary["errorMessage"]


# ------------------------------------------------------------- presenter key


def test_presenter_gate_checks_a_hash_and_limits_guesses():
    clock = [0.0]
    gate = PresenterGate(KEY_HASH, per_ip_per_hour=2, clock=lambda: clock[0])
    gate.check(KEY, "1.1.1.1")
    for _ in range(2):
        with pytest.raises(PresenterKeyError) as wrong:
            gate.check("nope", "1.1.1.1")
        assert wrong.value.code == "presenter_required"
    with pytest.raises(PresenterKeyError) as limited:
        gate.check(KEY, "1.1.1.1")
    assert limited.value.code == "presenter_attempts_limited" and limited.value.retry_after
    gate.check(KEY, "2.2.2.2")
    clock[0] = 3601
    gate.check(KEY, "1.1.1.1")
    with pytest.raises(PresenterKeyError) as off:
        PresenterGate(None).check(KEY, "1.1.1.1")
    assert off.value.code == "presenter_not_configured"


# ----------------------------------------------------------------- transport


def test_http_transport_uses_an_entra_token_and_hides_error_bodies(project):
    seen: list[httpx.Request] = []

    def handler(request: httpx.Request) -> httpx.Response:
        seen.append(request)
        if request.url.path.endswith("/missing"):
            return httpx.Response(404, json={"error": "nope"})
        if request.url.path.endswith("/denied"):
            return httpx.Response(403, json={"error": {"message": "principal 1234"}})
        return httpx.Response(200, json={"data": []})

    class Credential:
        def get_token(self, scope):
            assert scope == "https://ai.azure.com/.default"
            return type("Token", (), {"token": "t0ken"})()

    client = httpx.Client(base_url=project.evaluations_api, transport=httpx.MockTransport(handler))
    transport = FoundryEvalsHttpTransport(project, Credential(), client=client)
    assert transport.send("GET", "evals?limit=1") == {"data": []}
    assert seen[0].headers["authorization"] == "Bearer t0ken"
    assert str(seen[0].url).startswith(project.evaluations_api)
    with pytest.raises(RunNotFound):
        transport.send("GET", "evals/missing")
    with pytest.raises(FoundryError) as denied:
        transport.send("GET", "evals/denied")
    assert denied.value.status == 403 and "1234" not in str(denied.value)


# ------------------------------------------------------------------------ API


def make_client(tmp_path: Path, **env: str) -> tuple[TestClient, AppDependencies]:
    (tmp_path / "index.html").write_text("<html>app</html>")
    settings = replace(Settings.from_env({"FAKE_AI": "1", **env}), static_dir=tmp_path)
    deps = AppDependencies.from_settings(settings)
    deps.sink = MemoryEventSink()
    return TestClient(create_app(deps)), deps


def test_api_without_foundry_is_read_only(tmp_path):
    client, _ = make_client(tmp_path, EVALUATIONS_PRESENTER_KEY_SHA256=KEY_HASH, **PROJECT_ENV)
    overview = client.get("/api/evaluations")
    assert overview.status_code == 200
    assert overview.headers["cache-control"] == "no-store"
    assert overview.json()["available"] is False  # FAKE_AI never calls Foundry
    assert client.get(f"/api/evaluations/x/runs/{RUN_ID}").status_code == 400
    assert client.get(f"/api/evaluations/{EVAL_ID}/runs/{RUN_ID}").status_code == 503
    start = client.post(
        "/api/evaluations/runs", content="{}", headers={"X-Demo-Presenter-Key": KEY}
    )
    assert start.status_code == 503
    wrong = client.post(
        "/api/evaluations/runs", content="{}", headers={"X-Demo-Presenter-Key": "x"}
    )
    assert wrong.status_code == 403 and wrong.json()["error"] == "presenter_required"


def test_api_starts_a_run_with_the_presenter_key(tmp_path, suite, project):
    client, deps = make_client(tmp_path, EVALUATIONS_PRESENTER_KEY_SHA256=KEY_HASH)
    foundry = FakeFoundry()
    deps.evaluations = service(suite, project, foundry)
    started = client.post(
        "/api/evaluations/runs", content="{}", headers={"X-Demo-Presenter-Key": KEY}
    )
    assert started.status_code == 202
    assert started.json()["runId"] == RUN_ID
    assert deps.sink.events[-1][0] == "evaluation_run_started"
    foundry.runs = [{"id": RUN_ID, "status": "queued", "created_at": NOW}]
    busy = client.post("/api/evaluations/runs", content="{}", headers={"X-Demo-Presenter-Key": KEY})
    assert busy.status_code == 409 and busy.headers["x-run-id"] == RUN_ID
    foundry.runs = [
        {"id": run_id, "status": "completed", "created_at": NOW - 60}
        for run_id in (RUN_ID, "r1", "r2")
    ]
    limited = client.post(
        "/api/evaluations/runs", content="{}", headers={"X-Demo-Presenter-Key": KEY}
    )
    assert limited.status_code == 429 and int(limited.headers["retry-after"]) >= 60


def test_api_reports_foundry_failures_without_details(tmp_path, suite, project):
    client, deps = make_client(tmp_path, EVALUATIONS_PRESENTER_KEY_SHA256=KEY_HASH)

    class Broken(FakeFoundry):
        def send(self, method, path, body=None):
            raise FoundryError(500)

    deps.evaluations = service(suite, project, Broken())
    assert client.get("/api/evaluations").status_code == 502
    assert client.get(f"/api/evaluations/{EVAL_ID}/runs/{RUN_ID}").status_code == 502
    failed = client.post(
        "/api/evaluations/runs", content="{}", headers={"X-Demo-Presenter-Key": KEY}
    )
    assert failed.status_code == 502


def test_recorded_example_matches_the_current_suite(suite):
    example = json.loads((REPO_ROOT / "evals" / "runs" / "example-web-run.json").read_text())
    assert example["run"]["evalName"] == suite.suite_name
    assert len(example["items"]) == len(suite.rows)
    assert {item["id"] for item in example["items"]} <= {row.id for row in suite.rows} | {
        "authority-claim"
    }
