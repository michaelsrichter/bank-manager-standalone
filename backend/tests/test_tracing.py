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
    for name in ("chat gpt-4.1", "acs.evaluate input", "acs.evaluate pre_tool_call"):
        assert spans[name].parent.span_id == agent.context.span_id, name
        assert spans[name].context.trace_id == agent.context.trace_id
    assert agent.attributes["gen_ai.operation.name"] == "invoke_agent"
    assert agent.attributes["bank_manager.governed.reason"] == "account_access_denied"
    chat = spans["chat gpt-4.1"]
    assert chat.attributes["gen_ai.operation.name"] == "chat"
    assert chat.attributes["gen_ai.request.model"] == "gpt-4.1"
    assert chat.attributes["gen_ai.response.model"] == "fake:gpt-4.1"
    assert chat.attributes["bank_manager.selected_tool"] == "read_account"
    baseline_tool = spans["execute_tool read_account"]
    assert baseline_tool.attributes["bank_manager.lane"] == "baseline"


def test_acs_decisions_are_recorded_on_policy_spans(tmp_path):
    spans = run("Show account A-2001", tmp_path)
    pre_tool = spans["acs.evaluate pre_tool_call"]
    events = [event for event in pre_tool.events if event.name == "acs.decision"]
    assert events and events[0].attributes["acs.reason_code"] == "account_access_denied"
    assert pre_tool.attributes["bank_manager.status"] == "deny"


def test_governed_tool_span_records_redaction(tmp_path):
    spans = run("Show account A-1001", tmp_path)
    tool_spans = [
        s for s in SPAN_EXPORTER.get_finished_spans() if s.name.startswith("execute_tool")
    ]
    governed = next(s for s in tool_spans if s.attributes["bank_manager.lane"] == "governed")
    assert governed.attributes["bank_manager.status"] == "transform"
    assert spans["invoke_agent bank-manager"].attributes["bank_manager.baseline.status"] == "allow"


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
        "bank_manager.policy.decisions",
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
