from __future__ import annotations

import json
from types import SimpleNamespace

from conftest import METRIC_READER, SPAN_EXPORTER
from fastapi.testclient import TestClient
from test_api import SESSION, make_deps

from bank_manager.ai.router import OpenAIIntentRouter
from bank_manager.main import create_app
from bank_manager.tracing import SpanEventTelemetrySink


def run(prompt: str, tmp_path, **deps):
    SPAN_EXPORTER.clear()
    client = TestClient(create_app(make_deps(tmp_path, **deps)))
    response = client.post(
        "/api/compare", json={"prompt": prompt}, headers={"X-Demo-Session": SESSION}
    )
    assert response.status_code == 200
    response.text  # drain the stream
    return {span.name: span for span in SPAN_EXPORTER.get_finished_spans()}


def test_agent_harness_emits_genai_spans_with_correct_parents(tmp_path):
    spans = run("Show account A-2001", tmp_path)
    agent = spans["invoke_agent bank-manager"]
    for name in ("chat gpt-4.1", "lane baseline", "lane governed"):
        assert spans[name].parent.span_id == agent.context.span_id, name
        assert spans[name].context.trace_id == agent.context.trace_id
    governed = spans["lane governed"]
    for name in ("acs.evaluate input", "acs.evaluate pre_tool_call"):
        assert spans[name].parent.span_id == governed.context.span_id, name
        assert spans[name].attributes["demo.lane"] == "governed"
    assert agent.attributes["gen_ai.operation.name"] == "invoke_agent"
    assert agent.attributes["demo.governed.reason"] == "account_access_denied"
    chat = spans["chat gpt-4.1"]
    assert chat.attributes["gen_ai.operation.name"] == "chat"
    assert chat.attributes["gen_ai.request.model"] == "gpt-4.1"
    assert chat.attributes["gen_ai.response.model"] == "fake:gpt-4.1"
    assert chat.attributes["demo.selected_tool"] == "read_account"
    baseline_tool = spans["execute_tool read_account"]
    assert baseline_tool.attributes["demo.lane"] == "baseline"
    assert baseline_tool.parent.span_id == spans["lane baseline"].context.span_id


def test_each_lane_span_records_its_own_result(tmp_path):
    spans = run("Show account A-2001", tmp_path)
    baseline = spans["lane baseline"].attributes
    assert baseline["demo.lane.label"] == "No rules (unsafe on purpose)"
    assert baseline["gen_ai.tool.name"] == "read_account"
    assert baseline["demo.tool_executed"] is True
    assert baseline["demo.authz.outcome"] == "not_checked"
    assert baseline["demo.policy_checks"] == "none"
    governed = spans["lane governed"].attributes
    assert governed["demo.lane.label"] == "Governed by policy"
    assert governed["demo.status"] == "deny"
    assert governed["demo.reason"] == "account_access_denied"
    assert governed["demo.authz.outcome"] == "denied_expected"
    assert governed["demo.tool_executed"] is False
    assert governed["demo.stopped_at"] == "pre_tool_call"
    assert governed["demo.policy_checks"] == "input → pre_tool_call"
    assert "execute_tool read_account" in spans  # only the baseline ran the tool
    tool_lanes = [
        s.attributes["demo.lane"]
        for s in SPAN_EXPORTER.get_finished_spans()
        if s.name.startswith("execute_tool")
    ]
    assert tool_lanes == ["baseline"]


def test_allowed_governed_lane_lists_every_policy_check(tmp_path):
    spans = run("Show account A-1001", tmp_path)
    governed = spans["lane governed"].attributes
    assert governed["demo.status"] == "transform"
    assert governed["demo.tool_executed"] is True
    assert governed["demo.policy_checks"] == "input → pre_tool_call → post_tool_call"


def test_approval_click_is_its_own_governed_lane_span(tmp_path):
    SPAN_EXPORTER.clear()
    client = TestClient(create_app(make_deps(tmp_path)))
    action = {
        "tool_name": "prepare_transfer",
        "args": {"account_id": "A-1001", "destination_account_id": "A-2001", "amount": 12000},
    }
    for decision, checks, ran in (
        ("approve", "pre_tool_call → post_tool_call", True),
        ("reject", "pre_tool_call", False),
    ):
        SPAN_EXPORTER.clear()
        client.post(
            "/api/approval",
            json={"action": action, "personaId": "M-101", "decision": decision},
            headers={"X-Demo-Session": SESSION},
        )
        lane = next(s for s in SPAN_EXPORTER.get_finished_spans() if s.name == "lane governed")
        assert lane.attributes["demo.approval"] is True
        assert lane.attributes["demo.policy_checks"] == checks
        assert lane.attributes["demo.tool_executed"] is ran


def test_acs_decisions_are_recorded_on_policy_spans(tmp_path):
    spans = run("Show account A-2001", tmp_path)
    pre_tool = spans["acs.evaluate pre_tool_call"]
    events = [event for event in pre_tool.events if event.name == "acs.decision"]
    assert events and events[0].attributes["acs.reason_code"] == "account_access_denied"
    assert events[0].attributes["demo.lane"] == "governed"
    assert pre_tool.attributes["demo.status"] == "deny"


def test_governed_tool_span_records_redaction(tmp_path):
    spans = run("Show account A-1001", tmp_path)
    tool_spans = [
        s for s in SPAN_EXPORTER.get_finished_spans() if s.name.startswith("execute_tool")
    ]
    governed = next(s for s in tool_spans if s.attributes["demo.lane"] == "governed")
    assert governed.attributes["demo.status"] == "transform"
    assert spans["invoke_agent bank-manager"].attributes["demo.baseline.status"] == "allow"


def test_spans_never_contain_prompt_or_tool_output(tmp_path):
    run("Show account A-1001", tmp_path)
    dump = json.dumps(
        [
            {"attrs": dict(span.attributes), "events": [dict(e.attributes) for e in span.events]}
            for span in SPAN_EXPORTER.get_finished_spans()
        ],
        default=str,
    )
    assert "Show account" not in dump
    assert "000-11-1001" not in dump
    assert "Alex Placeholder" not in dump


def test_metrics_include_genai_policy_and_acs_instruments(tmp_path):
    run("Show account A-2001", tmp_path)
    names = {
        metric.name
        for resource in METRIC_READER.get_metrics_data().resource_metrics
        for scope in resource.scope_metrics
        for metric in scope.metrics
    }
    assert {
        "gen_ai.client.token.usage",
        "gen_ai.client.operation.duration",
        "demo.policy.decisions",
        "acs_intervention_deny_total",
        "acs_intervention_duration_ms",
    } <= names


def test_failed_model_call_marks_spans_as_errors(tmp_path, intent_config):
    class Boom(Exception):
        status_code = 500

    completions = SimpleNamespace(parse=lambda **_: (_ for _ in ()).throw(Boom()))
    client = SimpleNamespace(
        base_url="https://example.openai.azure.com/",
        beta=SimpleNamespace(chat=SimpleNamespace(completions=completions)),
    )
    spans = run("Show account A-1001", tmp_path, router=OpenAIIntentRouter(client, intent_config))
    chat = spans["chat gpt-4.1"]
    assert chat.status.status_code.name == "ERROR"
    assert chat.attributes["server.address"] == "example.openai.azure.com"
    assert spans["invoke_agent bank-manager"].attributes["error.type"] == "model_failed"


def test_span_sink_ignores_non_recording_context():
    SpanEventTelemetrySink().emit(SimpleNamespace())  # no active span: must not raise
    SpanEventTelemetrySink().force_flush()
    SpanEventTelemetrySink().shutdown()


def test_client_timing_is_validated_and_allow_listed(tmp_path):
    deps = make_deps(tmp_path)
    client = TestClient(create_app(deps))
    ok = {
        "firstEventMs": 120,
        "totalMs": 900,
        "eventCount": 12,
        "outcome": "done",
        "modelKey": "gpt-4.1",
    }
    assert client.post("/api/telemetry/client-timing", json=ok).status_code == 204
    assert (
        client.post("/api/telemetry/client-timing", json={**ok, "totalMs": -1}).status_code == 400
    )
    assert (
        client.post("/api/telemetry/client-timing", json={**ok, "modelKey": "nope"}).status_code
        == 204
    )
    timings = [props for name, props in deps.sink.events if name == "client_timing"]
    assert timings == [
        {
            "first_event_ms": 120,
            "total_ms": 900,
            "outcome": "done",
            "model_key": "gpt-4.1",
            "event_count": 12,
        }
    ]
