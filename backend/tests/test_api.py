from __future__ import annotations

import asyncio
import json
import logging
from dataclasses import replace
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from bank_manager.ai.router import FakeIntentRouter, IntentRoutingError, ModelRateLimitedError
from bank_manager.config import Settings
from bank_manager.health import (
    HealthService,
    ModelDeploymentProbe,
    PolicyEngineProbe,
    ProbeResult,
    StaticProbe,
)
from bank_manager.main import AppDependencies, create_app
from bank_manager.rate_limit import SlidingWindowLimiter
from bank_manager.telemetry import LoggingEventSink, MemoryEventSink, safe_properties

SESSION = "0b8f4c7e-2a1d-4c3e-9f5a-6d7e8f9a0b1c"


def make_deps(tmp_path: Path | None = None, **overrides):
    settings = Settings.from_env({"FAKE_AI": "1"})
    if tmp_path is not None:
        settings = replace(settings, static_dir=tmp_path)
    deps = AppDependencies.from_settings(settings)
    deps.sink = MemoryEventSink()
    for key, value in overrides.items():
        setattr(deps, key, value)
    return deps


@pytest.fixture()
def deps(tmp_path):
    (tmp_path / "index.html").write_text("<html>app</html>")
    (tmp_path / "assets").mkdir()
    (tmp_path / "assets" / "app.js").write_text("console.log(1)")
    return make_deps(tmp_path)


@pytest.fixture()
def client(deps):
    return TestClient(create_app(deps))


def stream(client, prompt, **body):
    response = client.post(
        "/api/compare",
        json={"prompt": prompt, **body},
        headers={"X-Demo-Session": SESSION},
    )
    assert response.status_code == 200
    assert response.headers["content-type"].startswith("application/x-ndjson")
    return [json.loads(line) for line in response.text.splitlines()]


def lanes(events):
    return {e["result"]["lane"]: e["result"] for e in events if e["type"] == "lane.result"}


def test_config_lists_models_personas_and_scenarios(client):
    body = client.get("/api/config").json()
    assert body["defaultModel"] == "gpt-4.1"
    assert [m["key"] for m in body["models"]] == ["gpt-4.1", "gpt-4.1-mini"]
    assert body["personas"][0]["id"] == "M-101"
    assert body["fakeAi"] is True
    assert len(body["scenarios"]) == 7


def test_compare_streams_ordered_events_with_both_lanes(client, deps):
    events = stream(client, "Show account A-2001")
    seqs = [event["seq"] for event in events]
    assert seqs == sorted(seqs) == list(range(1, len(events) + 1))
    assert events[0]["type"] == "run.started"
    assert events[-1]["type"] == "run.completed"
    result = lanes(events)
    assert result["baseline"]["toolExecuted"] is True
    assert result["governed"]["reason"] == "account_access_denied"
    usage = next(e for e in events if e["type"] == "model.usage")
    assert usage["responseModel"] == "fake:gpt-4.1"
    assert usage["cost"]["confidence"] == "fake"
    names = [name for name, _ in deps.sink.events]
    assert names.count("policy_decision") == 2
    assert "ai_call" in names and "model_selection" in names


def test_telemetry_never_contains_prompt_or_tool_text(client, deps):
    stream(client, "Show account A-1001")
    serialized = json.dumps(deps.sink.events)
    assert "Show account" not in serialized
    assert "000-11-1001" not in serialized
    assert "Alex Placeholder" not in serialized


def test_compare_supports_model_choice_and_policy_state(client):
    events = stream(
        client,
        "Freeze account A-1001",
        modelKey="gpt-4.1-mini",
        policyState={"adminMode": True},
    )
    assert events[0]["model"]["deployment"] == "gpt-4.1-mini"
    assert lanes(events)["governed"]["status"] == "approval"


def test_compare_rejects_invalid_requests(client):
    assert client.post("/api/compare", json={"prompt": ""}).status_code == 400
    assert client.post("/api/compare", json={"prompt": "x" * 501}).status_code == 400
    assert client.post("/api/compare", json={"prompt": "x", "modelKey": "gpt-9"}).status_code == 400
    assert client.post("/api/compare", json={"prompt": "x", "personaId": "M-9"}).status_code == 400
    assert client.post("/api/compare", json={"prompt": "x", "extra": 1}).status_code == 400
    assert (
        client.post(
            "/api/compare", content=b"not json", headers={"content-type": "application/json"}
        ).status_code
        == 400
    )


def test_compare_rejects_oversized_bodies(client):
    response = client.post("/api/compare", content=b"{" + b" " * 9000 + b"}")
    assert response.status_code == 413


def test_compare_streams_designed_error_when_model_fails(tmp_path):
    class Failing:
        def __init__(self, error):
            self.error = error

        def route(self, prompt, option):
            raise self.error

    for error, code in (
        (ModelRateLimitedError("busy"), "model_busy"),
        (IntentRoutingError("bad"), "model_failed"),
    ):
        client = TestClient(create_app(make_deps(tmp_path, router=Failing(error))))
        events = stream(client, "Show account A-1001")
        assert events[-1]["type"] == "error"
        assert events[-1]["code"] == code
        assert not lanes(events)


def test_compare_converts_unexpected_failures_to_terminal_error(tmp_path):
    class Exploding:
        def route(self, prompt, option):
            return FakeIntentRouter().route(prompt, option)

    deps = make_deps(tmp_path, router=Exploding())
    deps.control = None
    events = stream(TestClient(create_app(deps)), "Show account A-1001")
    assert events[-1]["code"] == "internal_error"
    assert events[-1]["seq"] == events[-2]["seq"] + 1


def test_rate_limit_returns_429_with_retry_after(tmp_path):
    deps = make_deps(tmp_path, limiter=SlidingWindowLimiter(per_ip=100, per_session=2))
    client = TestClient(create_app(deps))
    for _ in range(2):
        stream(client, "Show account A-1001")
    response = client.post(
        "/api/compare", json={"prompt": "Show account A-1001"}, headers={"X-Demo-Session": SESSION}
    )
    assert response.status_code == 429
    assert int(response.headers["retry-after"]) >= 1
    assert ("rate_limited", {"scope": "session", "route": "compare"}) in deps.sink.events


def test_approval_approve_and_reject(client, deps):
    action = {
        "tool_name": "prepare_transfer",
        "args": {"account_id": "A-1001", "amount": 12000.0, "destination_account_id": "A-2001"},
    }
    approved = client.post(
        "/api/approval", json={"action": action, "personaId": "M-101", "decision": "approve"}
    ).json()
    assert approved["result"]["toolExecuted"] is True
    rejected = client.post(
        "/api/approval", json={"action": action, "personaId": "M-101", "decision": "reject"}
    ).json()
    assert rejected["result"]["reason"] == "operator_rejected"
    decisions = [
        props["decision"] for name, props in deps.sink.events if name == "approval_decision"
    ]
    assert decisions == ["approve", "reject"]


def test_approval_cannot_bypass_account_assignment(client):
    action = {"tool_name": "read_account", "args": {"account_id": "A-2001"}}
    body = client.post(
        "/api/approval", json={"action": action, "personaId": "M-101", "decision": "approve"}
    ).json()
    assert body["result"]["status"] == "deny"
    assert body["result"]["toolExecuted"] is False


def test_approval_rejects_forged_tools_and_personas(client):
    forged = {"tool_name": "enable_admin_mode", "args": {}}
    assert (
        client.post(
            "/api/approval", json={"action": forged, "personaId": "M-101", "decision": "approve"}
        ).status_code
        == 400
    )
    action = {"tool_name": "read_account", "args": {"account_id": "A-1001"}}
    assert (
        client.post(
            "/api/approval", json={"action": action, "personaId": "ADMIN", "decision": "approve"}
        ).status_code
        == 400
    )
    assert client.post("/api/approval", json={"decision": "approve"}).status_code == 400


def test_health_reports_ready_with_expected_denial_and_live_endpoint(client):
    body = client.get("/api/health")
    assert body.status_code == 200
    components = {c["name"]: c for c in body.json()["components"]}
    assert components["ACS policy engine"]["status"] == "healthy"
    assert client.get("/api/health/live").json() == {"status": "ok"}


def test_page_view_only_accepts_known_pages(client, deps):
    assert client.post("/api/telemetry/page-view", json={"page": "demo"}).status_code == 204
    assert client.post("/api/telemetry/page-view", json={"page": "/secret?q=x"}).status_code == 204
    assert [p for n, p in deps.sink.events if n == "page_view"] == [{"page": "demo"}]


def test_spa_serves_assets_index_and_security_headers(client):
    index = client.get("/demo")
    assert index.text == "<html>app</html>"
    assert "frame-ancestors 'none'" in index.headers["content-security-policy"]
    assert index.headers["strict-transport-security"] == "max-age=31536000"
    asset = client.get("/assets/app.js")
    assert "immutable" in asset.headers["cache-control"]
    assert client.get("/api/unknown").status_code == 404
    assert client.get("/../../etc/passwd").text == "<html>app</html>"


def test_spa_reports_missing_build(tmp_path):
    client = TestClient(create_app(make_deps(tmp_path / "empty")))
    assert client.get("/").status_code == 404


def test_post_without_content_length_is_rejected(client):
    def body():
        yield b"{}"

    response = client.post("/api/telemetry/page-view", content=body())
    assert response.status_code == 411


# ---------------------------------------------------------------- health unit


class FakeModelClient:
    def __init__(self, error=None):
        self.error = error
        self.chat = self
        self.completions = self

    def create(self, **kwargs):
        assert kwargs["messages"] == []
        if self.error:
            raise self.error
        return object()


class HttpError(Exception):
    def __init__(self, status_code=None):
        super().__init__("x")
        self.status_code = status_code


@pytest.mark.parametrize(
    ("error", "status"),
    [
        (HttpError(400), "available"),
        (HttpError(429), "degraded"),
        (HttpError(401), "misconfigured"),
        (HttpError(403), "misconfigured"),
        (HttpError(404), "misconfigured"),
        (HttpError(None), "unreachable"),
        (HttpError(503), "degraded"),
        (None, "available"),
    ],
)
def test_model_probe_classifies_without_inference(intent_config, error, status):
    probe = ModelDeploymentProbe(FakeModelClient(error), intent_config.default_option)
    assert asyncio.run(probe.run()).status == status


def test_policy_probe_flags_missing_denial():
    class Permissive:
        async def evaluate_intervention_point(self, *_):
            raise RuntimeError("broken")

    assert asyncio.run(PolicyEngineProbe(lambda: Permissive()).run()).status == "misconfigured"


def test_health_service_caches_and_coalesces():
    calls = []

    class Counting:
        name = "counting"
        critical = True

        async def run(self):
            calls.append(1)
            await asyncio.sleep(0)
            return ProbeResult(self.name, "healthy", "ok", True)

    now = [0.0]
    service = HealthService([Counting()], ttl_seconds=60, clock=lambda: now[0])

    async def burst():
        return await asyncio.gather(*(service.snapshot() for _ in range(5)))

    results = asyncio.run(burst())
    assert len(calls) == 1
    assert all(result["status"] == "ready" for result in results)
    now[0] = 61
    asyncio.run(service.snapshot())
    assert len(calls) == 2


def test_health_service_reports_not_ready_and_degraded():
    class Broken:
        name = "broken"
        critical = True

        async def run(self):
            raise RuntimeError("x")

    not_ready = asyncio.run(HealthService([Broken()], ttl_seconds=1).snapshot())
    assert not_ready["status"] == "not_ready" and not_ready["ready"] is False
    degraded = asyncio.run(
        HealthService(
            [StaticProbe("a", "healthy", "", critical=True), StaticProbe("b", "unreachable", "")],
            ttl_seconds=1,
        ).snapshot()
    )
    assert degraded["status"] == "degraded" and degraded["ready"] is True


def test_health_endpoint_returns_503_when_not_ready(tmp_path):
    deps = make_deps(tmp_path)
    deps.health = HealthService(
        [StaticProbe("x", "misconfigured", "", critical=True)], ttl_seconds=1
    )
    assert TestClient(create_app(deps)).get("/api/health").status_code == 503


# ------------------------------------------------------------- telemetry unit


def test_safe_properties_drops_unknown_and_complex_values():
    assert safe_properties("page_view", {"page": "demo", "prompt": "secret", "x": {}}) == {
        "page": "demo"
    }
    with pytest.raises(ValueError):
        safe_properties("undocumented", {})


def test_logging_sink_emits_custom_event(caplog):
    with caplog.at_level(logging.INFO, logger="bank_manager.events"):
        LoggingEventSink().emit("page_view", page="home", prompt="leak")
    record = caplog.records[-1]
    assert record.getMessage() == "page_view"
    assert getattr(record, "microsoft.custom_event.name") == "page_view"
    assert not hasattr(record, "prompt")


# ------------------------------------------------------------ rate limit unit


def test_sliding_window_expires_and_evicts():
    now = [0.0]
    limiter = SlidingWindowLimiter(per_ip=1, per_session=5, max_keys=2, clock=lambda: now[0])
    assert limiter.check("1.1.1.1", None).allowed
    denied = limiter.check("1.1.1.1", None)
    assert not denied.allowed and denied.scope == "ip"
    now[0] = 61
    assert limiter.check("1.1.1.1", None).allowed
    assert limiter.check("2.2.2.2", None).allowed
    now[0] = 200
    assert limiter.check("3.3.3.3", None).allowed


def test_openapi_documents_request_bodies(client):
    schema = client.app.openapi()
    assert "CompareRequest" in schema["components"]["schemas"]
    body = schema["paths"]["/api/compare"]["post"]["requestBody"]
    assert body["content"]["application/json"]["schema"]["$ref"].endswith("CompareRequest")
