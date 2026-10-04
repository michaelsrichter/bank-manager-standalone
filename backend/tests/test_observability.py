"""Observability contract tests (eps-demo-observability, eps-demo-telemetry-links)."""

from __future__ import annotations

import asyncio
import json
from pathlib import Path

import pytest
from conftest import SPAN_EXPORTER
from fastapi.testclient import TestClient
from opentelemetry.instrumentation.fastapi import FastAPIInstrumentor
from test_api import SESSION, make_deps

from bank_manager import request_context
from bank_manager.config import REPO_ROOT, ObservabilityLinks, read_service_version
from bank_manager.health import HealthService, StaticProbe
from bank_manager.main import create_app, emit_health
from bank_manager.telemetry import MemoryEventSink, telemetry_resource
from bank_manager.tracing import authz_outcome

CONVERSATION = "3f2c7b1e-9a4d-4c8e-b5f0-2d6e8a1c4b7f"
SUB = "00000000-0000-0000-0000-000000000002"
APPI = f"/subscriptions/{SUB}/resourceGroups/rg-demo/providers/microsoft.insights/components/appi"
WORKBOOK = f"/subscriptions/{SUB}/resourceGroups/rg-demo/providers/microsoft.insights/workbooks/w1"


def compare(client: TestClient, prompt: str, **headers: str):
    response = client.post(
        "/api/compare",
        json={"prompt": prompt},
        headers={"X-Demo-Session": SESSION, **headers},
    )
    assert response.status_code == 200
    return [json.loads(line) for line in response.text.splitlines()]


def instrumented_client(tmp_path: Path, **deps) -> TestClient:
    app = create_app(make_deps(tmp_path, **deps))
    FastAPIInstrumentor.instrument_app(app)
    return TestClient(app)


def test_returned_trace_id_is_the_server_trace_and_every_span_has_the_conversation(tmp_path):
    SPAN_EXPORTER.clear()
    events = compare(
        instrumented_client(tmp_path),
        "Show account A-2001",
        **{"X-Conversation-Id": CONVERSATION},
    )
    started = events[0]
    assert started["conversationId"] == CONVERSATION
    assert started["practice"] is False
    spans = SPAN_EXPORTER.get_finished_spans()
    trace_ids = {format(span.context.trace_id, "032x") for span in spans}
    assert trace_ids == {started["traceId"]}
    server = next(span for span in spans if span.name == "POST /api/compare")
    agent = next(span for span in spans if span.name == "invoke_agent bank-manager")
    for span in (server, agent):
        assert span.attributes["gen_ai.conversation.id"] == CONVERSATION
        assert span.attributes["demo.journey"] == "ask"
        assert span.attributes["demo.mode"] == "live"
    our_spans = [s for s in spans if s.name.startswith(("chat ", "acs.", "execute_tool"))]
    assert our_spans and all(
        s.attributes.get("gen_ai.conversation.id") == CONVERSATION for s in our_spans
    )
    assert agent.attributes["demo.authz.outcome"] == "denied_expected"
    pre = next(s for s in spans if s.name == "acs.evaluate pre_tool_call")
    assert pre.attributes["demo.authz.outcome"] == "denied_expected"


def test_unsafe_conversation_ids_and_modes_are_ignored(tmp_path):
    SPAN_EXPORTER.clear()
    events = compare(
        TestClient(create_app(make_deps(tmp_path))),
        "Show account A-1001",
        **{"X-Conversation-Id": 'x" | take 1', "X-Demo-Mode": "admin"},
    )
    assert events[0]["conversationId"] is None
    assert events[0]["practice"] is False
    for span in SPAN_EXPORTER.get_finished_spans():
        assert "gen_ai.conversation.id" not in span.attributes


def test_practice_mode_skips_the_model_but_still_runs_real_policy(tmp_path):
    class LiveRouterMustNotRun:
        def route(self, prompt, option):
            raise AssertionError("Practice must not call the live model router.")

    SPAN_EXPORTER.clear()
    deps = make_deps(tmp_path, router=LiveRouterMustNotRun())
    events = compare(
        TestClient(create_app(deps)),
        "Show account A-2001",
        **{"X-Demo-Mode": "practice", "X-Conversation-Id": CONVERSATION},
    )
    assert events[0]["practice"] is True
    usage = next(e for e in events if e["type"] == "model.usage")
    assert usage["responseModel"] == "practice:gpt-4.1"
    assert usage["cost"]["confidence"] == "fake"
    governed = next(
        e["result"]
        for e in events
        if e["type"] == "lane.result" and e["result"]["lane"] == "governed"
    )
    assert governed["reason"] == "account_access_denied"
    assert all(
        span.attributes.get("demo.mode") == "practice"
        for span in SPAN_EXPORTER.get_finished_spans()
    )
    assert all(
        props.get("demo.mode") == "practice"
        for name, props in deps.sink.events
        if name == "ai_call"
    )


def test_approval_returns_conversation_id(tmp_path):
    client = TestClient(create_app(make_deps(tmp_path)))
    action = {"tool_name": "read_account", "args": {"account_id": "A-1001"}}
    body = client.post(
        "/api/approval",
        json={"action": action, "personaId": "M-101", "decision": "reject"},
        headers={"X-Conversation-Id": CONVERSATION},
    ).json()
    assert body["conversationId"] == CONVERSATION
    assert len(body["traceId"]) == 32


def test_config_exposes_observability_links_only_when_valid(tmp_path):
    env = {
        "PORTAL_TENANT_ID": "00000000-0000-0000-0000-000000000001",
        "APPINSIGHTS_RESOURCE_ID": APPI,
        "ANSWER_REVIEW_WORKBOOK_ID": WORKBOOK,
        "OVERVIEW_WORKBOOK_ID": "not-a-resource-id",
    }
    links = ObservabilityLinks.from_env(env)
    assert links is not None and links.public() == {
        "portalOrigin": "https://portal.azure.com",
        "tenantId": env["PORTAL_TENANT_ID"],
        "appInsightsResourceId": APPI,
        "answerReviewWorkbookId": WORKBOOK,
        "overviewWorkbookId": None,
    }
    assert ObservabilityLinks.from_env({**env, "PORTAL_ORIGIN": "http://evil.example"}) is None
    assert ObservabilityLinks.from_env({**env, "APPINSIGHTS_RESOURCE_ID": "https://evil"}) is None
    assert ObservabilityLinks.from_env({}) is None

    deps = make_deps(tmp_path)
    assert TestClient(create_app(deps)).get("/api/config").json()["observability"] is None
    from dataclasses import replace

    deps.settings = replace(deps.settings, observability=links, service_version="abc1234")
    body = TestClient(create_app(deps)).get("/api/config").json()
    assert body["observability"]["answerReviewWorkbookId"] == WORKBOOK
    assert body["serviceVersion"] == "abc1234"


def test_health_refresh_emits_one_event_per_component():
    sink = MemoryEventSink()
    service = HealthService(
        [
            StaticProbe("ACS policy engine", "healthy", "", critical=True),
            StaticProbe("x", "degraded", ""),
        ],
        ttl_seconds=60,
        on_refresh=lambda snapshot: emit_health(sink, snapshot),
    )
    asyncio.run(service.snapshot())
    asyncio.run(service.snapshot())  # cached: no second burst of events
    assert sink.events == [
        ("health_check", {"component": "ACS policy engine", "status": "healthy", "critical": True}),
        ("health_check", {"component": "x", "status": "degraded", "critical": False}),
    ]


@pytest.mark.parametrize(
    ("lane", "status", "reason", "expected"),
    [
        ("baseline", "allow", "baseline_no_policy", "not_checked"),
        ("governed", "allow", "default", "allowed"),
        ("governed", "transform", "redact_ssn_in_tool_result", "allowed"),
        ("governed", "approval", "high_value_transfer_requires_approval", "approval_required"),
        ("governed", "deny", "account_access_denied", "denied_expected"),
        ("governed", "deny", "runtime_error:policy_invocation_failed", "denied_unexpected"),
    ],
)
def test_authz_outcome_separates_expected_and_unexpected_denials(lane, status, reason, expected):
    assert authz_outcome(lane, status, reason) == expected


def test_service_version_and_resource_attributes(tmp_path):
    info = tmp_path / "build-info.json"
    info.write_text(json.dumps({"sha": "02c5aaab8e12e2b25a4e39eda628781ff52a2470"}))
    assert read_service_version(info) == "02c5aaa"
    info.write_text(json.dumps({"sha": "unknown"}))
    assert read_service_version(info) == "unknown"
    assert read_service_version(tmp_path / "missing.json") == "unknown"
    attributes = telemetry_resource("02c5aaa", "demo").attributes
    assert attributes["service.version"] == "02c5aaa"
    assert attributes["deployment.environment.name"] == "demo"


def test_request_context_helpers():
    assert request_context.clean_conversation_id(CONVERSATION) == CONVERSATION
    assert request_context.clean_conversation_id("conv_0a1b2c3d4e5f") == "conv_0a1b2c3d4e5f"
    for bad in ["", "short", "a b c d e f g h", "conv_'1'", None]:
        assert request_context.clean_conversation_id(bad) is None
    assert request_context.clean_mode("PRACTICE") == "practice"
    assert request_context.clean_mode("anything") == "live"


@pytest.mark.parametrize("path", sorted((REPO_ROOT / "infra" / "dashboards").glob("*.json")))
def test_workbook_files_are_valid_json_with_items(path):
    workbook = json.loads(path.read_text(encoding="utf-8"))
    assert workbook["version"] == "Notebook/1.0"
    assert workbook["items"]


def test_azure_monitor_keeps_every_span(monkeypatch):
    """The distro's default rate-limited sampler (5 spans/s) dropped lane and policy spans."""
    import azure.monitor.opentelemetry as distro
    import opentelemetry.instrumentation.httpx as httpx_instrumentation

    from bank_manager.telemetry import configure_telemetry

    calls: list[dict] = []
    monkeypatch.setattr(distro, "configure_azure_monitor", lambda **kw: calls.append(kw))

    class FakeInstrumentor:
        is_instrumented_by_opentelemetry = True

    monkeypatch.setattr(httpx_instrumentation, "HTTPXClientInstrumentor", FakeInstrumentor)
    configure_telemetry(False, None)
    assert calls == []
    configure_telemetry(True, "00000000-0000-0000-0000-000000000000", service_version="abc")
    assert calls[0]["sampling_ratio"] == 1.0
    assert calls[0]["resource"].attributes["service.version"] == "abc"
