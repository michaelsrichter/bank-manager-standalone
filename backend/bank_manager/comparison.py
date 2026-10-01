"""Runs one routed tool call through the ungoverned and ACS-governed lanes.

Results are streamed as ordered NDJSON events with monotonically increasing
sequence numbers (eps-demo-ux / eps-demo-production-readiness). Only an
allow-listed projection of each result crosses the trust boundary.
"""

from __future__ import annotations

import asyncio
import itertools
from collections.abc import AsyncIterator, Mapping
from typing import Any

from agent_control_specification import AgentControl
from opentelemetry import trace
from opentelemetry.trace import Span, Status, StatusCode

from . import request_context, tracing
from .ai.cost import estimate_cost
from .ai.router import (
    ContentFilteredError,
    IntentRouter,
    IntentRoutingError,
    ModelRateLimitedError,
    RoutingResult,
)
from .bank.data import HELP_TEXT
from .bank.governance import evaluate_action, evaluate_input, outcome, run_action
from .bank.tools import execute_tool
from .config import ModelOption
from .telemetry import EventSink

MAX_TEXT_CHARS = 1000


def project_action(action: Mapping[str, Any] | None) -> dict[str, Any] | None:
    if action is None:
        return None
    args = action.get("args", {})
    safe_args = {
        key: args[key] for key in ("account_id", "destination_account_id", "amount") if key in args
    }
    return {"tool_name": str(action["tool_name"]), "args": safe_args}


def project_result(
    lane: str,
    result: Mapping[str, Any],
    *,
    action: Mapping[str, Any] | None,
    tool_executed: bool,
    intervention_point: str | None,
) -> dict[str, Any]:
    value = result.get("value")
    text = value.get("text") if isinstance(value, Mapping) else None
    if not isinstance(text, str):
        text = None
    return {
        "lane": lane,
        "status": str(result["status"]),
        "reason": str(result.get("reason") or "default"),
        "message": str(result.get("message") or "")[:MAX_TEXT_CHARS],
        "text": text[:MAX_TEXT_CHARS] if text else None,
        "toolExecuted": tool_executed,
        "interventionPoint": intervention_point,
        "policyDecision": str(result["status"]) if lane == "governed" else "not_evaluated",
        "action": project_action(action),
    }


# tour:begin comparison-baseline
def run_baseline(action: Mapping[str, Any] | None) -> dict[str, Any]:
    if action is None:
        return project_result(
            "baseline",
            outcome("info", "intent_not_recognized", HELP_TEXT),
            action=None,
            tool_executed=False,
            intervention_point=None,
        )
    with tracing.tool_span(str(action["tool_name"]), "baseline") as span:
        value = execute_tool(str(action["tool_name"]), action["args"])
        span.set_attribute("demo.status", "allow")
        span.set_attribute("demo.authz.outcome", "not_checked")
        span.set_attribute("demo.tool_executed", True)
    return project_result(
        "baseline",
        outcome(
            "allow",
            "baseline_no_policy",
            "Executed without any policy check. Intentionally unsafe.",
            value=value,
        ),
        action=action,
        tool_executed=True,
        intervention_point=None,
    )


# tour:end comparison-baseline


async def run_governed(
    control: AgentControl,
    prompt: str,
    action: Mapping[str, Any] | None,
    snapshot: Mapping[str, Any],
) -> AsyncIterator[tuple[str, dict[str, Any]]]:
    """Yield ('step', step) progress and one final ('result', result)."""
    yield "step", {"id": "governed.input", "state": "started"}
    with tracing.policy_span("input") as span:
        input_outcome = await evaluate_input(control, prompt, snapshot)
        tracing.record_outcome(span, input_outcome)
    yield "step", {"id": "governed.input", "state": "completed", "status": input_outcome["status"]}
    if input_outcome["status"] == "deny":
        yield (
            "result",
            project_result(
                "governed",
                input_outcome,
                action=None,
                tool_executed=False,
                intervention_point="input",
            ),
        )
        return
    if action is None:
        yield (
            "result",
            project_result(
                "governed",
                outcome("info", "intent_not_recognized", HELP_TEXT),
                action=None,
                tool_executed=False,
                intervention_point=None,
            ),
        )
        return

    # tour:begin comparison-pre-tool
    yield "step", {"id": "governed.pre_tool", "state": "started"}
    with tracing.policy_span("pre_tool_call") as span:
        pre_outcome = await evaluate_action(control, action, snapshot)
        tracing.record_outcome(span, pre_outcome)
    yield "step", {"id": "governed.pre_tool", "state": "completed", "status": pre_outcome["status"]}
    if pre_outcome["status"] in {"deny", "approval"}:
        yield (
            "result",
            project_result(
                "governed",
                pre_outcome,
                action=action,
                tool_executed=False,
                intervention_point="pre_tool_call",
            ),
        )
        return
    # tour:end comparison-pre-tool

    yield "step", {"id": "governed.tool", "state": "started"}
    with tracing.tool_span(str(action["tool_name"]), "governed") as span:
        run_outcome = await run_action(control, action, snapshot)
        tracing.record_outcome(span, run_outcome)
    yield "step", {"id": "governed.tool", "state": "completed", "status": run_outcome["status"]}
    yield (
        "result",
        project_result(
            "governed",
            run_outcome,
            action=action,
            tool_executed=run_outcome["status"] != "deny",
            intervention_point="post_tool_call",
        ),
    )


# tour:begin comparison-approval
async def resolve_approval(
    control: AgentControl,
    action: Mapping[str, Any],
    snapshot: Mapping[str, Any],
    *,
    approve: bool,
) -> dict[str, Any]:
    if not approve:
        return project_result(
            "governed",
            outcome("deny", "operator_rejected", "The operator rejected the approval request."),
            action=action,
            tool_executed=False,
            intervention_point="pre_tool_call",
        )
    with tracing.tool_span(str(action["tool_name"]), "governed", approved=True) as span:
        result = await run_action(control, action, snapshot, approved=True)
        tracing.record_outcome(span, result)
    return project_result(
        "governed",
        result,
        action=action,
        tool_executed=result["status"] != "deny",
        intervention_point="post_tool_call",
    )


# tour:end comparison-approval


ERROR_MESSAGES = {
    "content_filtered": "Azure AI content filtering blocked this request. Try rephrasing it.",
    "model_busy": "The model is busy right now. Wait a few seconds and try again.",
    "model_failed": "The model could not choose a bank tool for this request.",
}


async def stream_comparison(
    *,
    prompt: str,
    snapshot: Mapping[str, Any],
    option: ModelOption,
    router: IntentRouter,
    control: AgentControl,
    sink: EventSink,
    trace_id: str,
) -> AsyncIterator[dict[str, Any]]:
    """Wrap one comparison in an ``invoke_agent`` span.

    The span is activated only around each step (never across a ``yield``) so
    the OpenTelemetry context stays correct while the response streams.
    """
    span = tracing.start_agent_span(option.key, option.deployment)
    inner = _stream_comparison(
        prompt=prompt,
        snapshot=snapshot,
        option=option,
        router=router,
        control=control,
        sink=sink,
        trace_id=trace_id,
    )
    try:
        while True:
            with trace.use_span(span, end_on_exit=False):
                try:
                    event = await inner.__anext__()
                except StopAsyncIteration:
                    break
            _annotate_agent_span(span, event)
            yield event
    except Exception as error:
        span.record_exception(error)
        span.set_status(Status(StatusCode.ERROR, type(error).__name__))
        raise
    finally:
        await inner.aclose()
        span.end()


def _annotate_agent_span(span: Span, event: Mapping[str, Any]) -> None:
    if event["type"] == "tool.selected":
        action = event.get("action") or {}
        span.set_attribute("demo.selected_tool", action.get("tool_name", "unsupported"))
    elif event["type"] == "model.usage":
        total = (event.get("cost") or {}).get("totalUsd")
        if isinstance(total, (int, float)):
            span.set_attribute("demo.cost.estimated_usd", float(total))
        if event.get("responseModel"):
            span.set_attribute("gen_ai.response.model", str(event["responseModel"]))
    elif event["type"] == "lane.result":
        result = event["result"]
        span.set_attribute(f"demo.{result['lane']}.status", result["status"])
        span.set_attribute(f"demo.{result['lane']}.reason", result["reason"])
        if result["lane"] == "governed":
            span.set_attribute(
                "demo.authz.outcome",
                tracing.authz_outcome("governed", result["status"], result["reason"]),
            )
    elif event["type"] == "error":
        span.set_attribute("error.type", event["code"])
        span.set_status(Status(StatusCode.ERROR, event["code"]))


async def _stream_comparison(
    *,
    prompt: str,
    snapshot: Mapping[str, Any],
    option: ModelOption,
    router: IntentRouter,
    control: AgentControl,
    sink: EventSink,
    trace_id: str,
) -> AsyncIterator[dict[str, Any]]:
    sequence = itertools.count(1)

    def event(event_type: str, **data: Any) -> dict[str, Any]:
        return {"seq": next(sequence), "type": event_type, **data}

    yield event(
        "run.started",
        traceId=trace_id,
        conversationId=request_context.conversation_id(),
        practice=request_context.mode() == "practice",
        model={"key": option.key, "label": option.label, "deployment": option.deployment},
    )
    yield event("step", id="route", state="started")
    try:
        routing: RoutingResult = await asyncio.to_thread(router.route, prompt, option)
    except IntentRoutingError as error:
        code = (
            "content_filtered"
            if isinstance(error, ContentFilteredError)
            else "model_busy"
            if isinstance(error, ModelRateLimitedError)
            else "model_failed"
        )
        sink.emit("ai_call", deployment=option.deployment, status=code)
        yield event("step", id="route", state="failed")
        yield event("error", code=code, message=ERROR_MESSAGES[code], traceId=trace_id)
        return

    cost = estimate_cost(routing.usage, option.pricing, fake=routing.fake)
    tracing.record_cost(routing.requested_deployment, cost.get("totalUsd"))
    usage = routing.usage.public() if routing.usage else None
    sink.emit(
        "ai_call",
        deployment=routing.requested_deployment,
        response_model=routing.response_model or "unavailable",
        status="ok",
        duration_ms=routing.duration_ms,
        estimated_cost_usd=cost.get("totalUsd") or 0.0,
        fake_ai=routing.fake,
        **{
            "input_tokens": routing.usage.input_tokens if routing.usage else 0,
            "cached_input_tokens": routing.usage.cached_input_tokens if routing.usage else 0,
            "output_tokens": routing.usage.output_tokens if routing.usage else 0,
            "reasoning_tokens": routing.usage.reasoning_tokens if routing.usage else 0,
        },
    )
    yield event("step", id="route", state="completed")
    yield event(
        "model.usage",
        requestedDeployment=routing.requested_deployment,
        responseModel=routing.response_model,
        usage=usage,
        cost=cost,
        durationMs=routing.duration_ms,
        fakeAi=routing.fake,
    )
    yield event("tool.selected", action=project_action(routing.action))

    yield event("step", id="baseline", state="started")
    baseline = run_baseline(routing.action)
    _emit_decision(sink, baseline)
    yield event("step", id="baseline", state="completed", status=baseline["status"])
    yield event("lane.result", result=baseline)

    async for kind, payload in run_governed(control, prompt, routing.action, snapshot):
        if kind == "step":
            yield event("step", **payload)
        else:
            _emit_decision(sink, payload)
            yield event("lane.result", result=payload)
    yield event("run.completed", traceId=trace_id)


def _emit_decision(sink: EventSink, result: Mapping[str, Any]) -> None:
    tracing.record_lane(result)
    action = result.get("action") or {}
    sink.emit(
        "policy_decision",
        lane=result["lane"],
        status=result["status"],
        reason=result["reason"],
        tool=action.get("tool_name", "unsupported"),
        intervention_point=result.get("interventionPoint") or "none",
        tool_executed=result["toolExecuted"],
        authz_outcome=tracing.authz_outcome(result["lane"], result["status"], result["reason"]),
    )
