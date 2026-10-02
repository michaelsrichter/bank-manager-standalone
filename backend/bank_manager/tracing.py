"""OpenTelemetry instrumentation for the agent harness (eps-demo-production-readiness).

Spans follow the OpenTelemetry GenAI semantic conventions so Azure Monitor and
the Microsoft Foundry tracing view can render them:

- ``invoke_agent bank-manager``: one comparison run (root of the agent work)
- ``chat <deployment>``: the model call that picks a tool (``gen_ai.*`` usage)
- ``acs.evaluate <intervention point>``: each ACS policy check
- ``execute_tool <tool>``: every tool execution, per lane

Prompt text, model output, tool arguments/results, and account data are never
recorded as span attributes, events, or metrics. Everything here uses the
OpenTelemetry API only, so it is a no-op until an SDK is configured.
"""

from __future__ import annotations

import time
from collections.abc import Iterator, Mapping
from contextlib import contextmanager
from typing import Any

from agent_control_specification import TelemetryEvent
from opentelemetry import metrics, trace
from opentelemetry.trace import Span, SpanKind, Status, StatusCode

from . import __version__

AGENT_NAME = "bank-manager"
PROVIDER = "azure.ai.openai"

tracer = trace.get_tracer("bank_manager", __version__)
meter = metrics.get_meter("bank_manager", __version__)

token_usage = meter.create_histogram(
    "gen_ai.client.token.usage",
    unit="{token}",
    description="Tokens used per model call, by token type.",
)
operation_duration = meter.create_histogram(
    "gen_ai.client.operation.duration",
    unit="s",
    description="Duration of model calls.",
)
estimated_cost = meter.create_counter(
    "demo.ai.estimated_cost",
    unit="USD",
    description="Estimated model cost from public list prices in config/models.json.",
)
policy_decisions = meter.create_counter(
    "demo.policy.decisions",
    unit="{decision}",
    description="Lane results by lane, status, and reason code.",
)
tool_executions = meter.create_counter(
    "demo.tool.executions",
    unit="{call}",
    description="Tool executions by lane and tool name.",
)


@contextmanager
def chat_span(
    *,
    deployment: str,
    temperature: float,
    max_tokens: int,
    server_address: str | None,
    fake: bool,
) -> Iterator[Span]:
    attributes: dict[str, Any] = {
        "gen_ai.operation.name": "chat",
        "gen_ai.provider.name": "fake" if fake else PROVIDER,
        "gen_ai.system": "fake" if fake else "az.ai.openai",
        "gen_ai.request.model": deployment,
        "gen_ai.request.temperature": temperature,
        "gen_ai.request.max_tokens": max_tokens,
        "gen_ai.output.type": "json",
        "gen_ai.agent.name": AGENT_NAME,
        "demo.fake_ai": fake,
    }
    if server_address:
        attributes["server.address"] = server_address
    started = time.perf_counter()
    with tracer.start_as_current_span(
        f"chat {deployment}", kind=SpanKind.CLIENT, attributes=attributes
    ) as span:
        try:
            yield span
        except Exception as error:
            span.set_attribute("error.type", type(error).__name__)
            span.set_status(Status(StatusCode.ERROR, type(error).__name__))
            _record_duration(deployment, fake, started, error=type(error).__name__)
            raise
        _record_duration(deployment, fake, started)


def _record_duration(deployment: str, fake: bool, started: float, error: str | None = None) -> None:
    attributes = {
        "gen_ai.operation.name": "chat",
        "gen_ai.provider.name": "fake" if fake else PROVIDER,
        "gen_ai.request.model": deployment,
    }
    if error:
        attributes["error.type"] = error
    operation_duration.record(time.perf_counter() - started, attributes)


def record_chat_result(
    span: Span,
    *,
    deployment: str,
    response_model: str | None,
    response_id: str | None,
    finish_reason: str | None,
    input_tokens: int,
    cached_input_tokens: int,
    output_tokens: int,
    reasoning_tokens: int,
    tool_name: str | None,
    fake: bool,
) -> None:
    if response_model:
        span.set_attribute("gen_ai.response.model", response_model)
    if response_id:
        span.set_attribute("gen_ai.response.id", response_id)
    if finish_reason:
        span.set_attribute("gen_ai.response.finish_reasons", [finish_reason])
    span.set_attribute("gen_ai.usage.input_tokens", input_tokens)
    span.set_attribute("gen_ai.usage.output_tokens", output_tokens)
    span.set_attribute("gen_ai.usage.cached_input_tokens", cached_input_tokens)
    span.set_attribute("gen_ai.usage.reasoning_tokens", reasoning_tokens)
    span.set_attribute("demo.selected_tool", tool_name or "unsupported")
    base = {
        "gen_ai.operation.name": "chat",
        "gen_ai.provider.name": "fake" if fake else PROVIDER,
        "gen_ai.request.model": deployment,
        "gen_ai.response.model": response_model or "unavailable",
    }
    token_usage.record(input_tokens, {**base, "gen_ai.token.type": "input"})
    token_usage.record(output_tokens, {**base, "gen_ai.token.type": "output"})


def record_cost(deployment: str, total_usd: float | None) -> None:
    if total_usd:
        estimated_cost.add(total_usd, {"gen_ai.request.model": deployment})


def start_agent_span(model_key: str, deployment: str) -> Span:
    """Root span for one comparison. The streaming caller activates it per step and ends it."""
    return tracer.start_span(
        f"invoke_agent {AGENT_NAME}",
        kind=SpanKind.INTERNAL,
        attributes={
            "gen_ai.operation.name": "invoke_agent",
            "gen_ai.agent.name": AGENT_NAME,
            "gen_ai.agent.id": AGENT_NAME,
            "gen_ai.request.model": deployment,
            "demo.model_key": model_key,
        },
    )


@contextmanager
def policy_span(intervention_point: str) -> Iterator[Span]:
    with tracer.start_as_current_span(
        f"acs.evaluate {intervention_point}",
        kind=SpanKind.INTERNAL,
        attributes={
            "acs.intervention_point": intervention_point,
            "gen_ai.agent.name": AGENT_NAME,
        },
    ) as span:
        yield span


@contextmanager
def tool_span(tool_name: str, lane: str, *, approved: bool = False) -> Iterator[Span]:
    with tracer.start_as_current_span(
        f"execute_tool {tool_name}",
        kind=SpanKind.INTERNAL,
        attributes={
            "gen_ai.operation.name": "execute_tool",
            "gen_ai.tool.name": tool_name,
            "gen_ai.tool.type": "function",
            "gen_ai.agent.name": AGENT_NAME,
            "demo.lane": lane,
            "demo.approved": approved,
        },
    ) as span:
        yield span


def authz_outcome(lane: str, status: str, reason: str) -> str:
    """Plain outcome of a policy check, so dashboards can tell good denials from bad ones.

    - ``allowed``: the tool may run (redaction still counts as allowed).
    - ``approval_required``: paused until a person decides.
    - ``denied_expected``: a written rule said no. This is the policy working.
    - ``denied_unexpected``: the policy engine itself failed (fail closed). Investigate.
    - ``not_checked``: the unsafe baseline lane, which has no policy on purpose.
    """
    if lane == "baseline":
        return "not_checked"
    if status in {"allow", "transform", "info"}:
        return "allowed"
    if status == "approval":
        return "approval_required"
    if reason.startswith("runtime_error"):
        return "denied_unexpected"
    return "denied_expected"


def record_outcome(span: Span, result: Mapping[str, Any], lane: str = "governed") -> None:
    status = str(result.get("status", ""))
    reason = str(result.get("reason", ""))
    span.set_attribute("demo.status", status)
    span.set_attribute("demo.reason", reason)
    span.set_attribute("demo.authz.outcome", authz_outcome(lane, status, reason))
    span.set_attribute("demo.boundary", "bank-accounts")
    if "toolExecuted" in result:
        span.set_attribute("demo.tool_executed", bool(result["toolExecuted"]))


def record_lane(result: Mapping[str, Any]) -> None:
    action = result.get("action") or {}
    tool = str(action.get("tool_name", "unsupported"))
    attributes = {
        "demo.lane": str(result["lane"]),
        "demo.status": str(result["status"]),
        "demo.reason": str(result["reason"]),
        "demo.authz.outcome": authz_outcome(
            str(result["lane"]), str(result["status"]), str(result["reason"])
        ),
        "gen_ai.tool.name": tool,
    }
    policy_decisions.add(1, attributes)
    if result.get("toolExecuted"):
        tool_executions.add(1, {"demo.lane": str(result["lane"]), "gen_ai.tool.name": tool})


# tour:begin tracing-acs-sink
class SpanEventTelemetrySink:
    """ACS TelemetrySink that records each redaction-safe decision on the active span."""

    def emit(self, event: TelemetryEvent) -> None:
        span = trace.get_current_span()
        if not span.is_recording():
            return
        decision = getattr(event.decision, "value", event.decision)
        point = getattr(event.intervention_point, "value", event.intervention_point)
        attributes: dict[str, Any] = {
            "acs.event_type": getattr(event.event_type, "value", str(event.event_type)),
            "acs.intervention_point": str(point),
            "acs.decision": str(decision or "none"),
            "acs.reason_code": event.reason_code or "none",
        }
        if event.policy_id:
            attributes["acs.policy_id"] = event.policy_id
        if event.duration_ms is not None:
            attributes["acs.duration_ms"] = float(event.duration_ms)
        if event.error_class:
            attributes["acs.error_class"] = event.error_class
        span.add_event("acs.decision", attributes)
        span.set_attribute("acs.decision", str(decision or "none"))
        span.set_attribute("acs.reason_code", event.reason_code or "none")

    # tour:end tracing-acs-sink

    def force_flush(self) -> None:
        return None

    def shutdown(self) -> None:
        return None
