"""Agent Control Specification (ACS) enforcement around the bank tools."""

from __future__ import annotations

import json
from collections.abc import Mapping
from pathlib import Path
from typing import Any

from agent_control_specification import (
    AgentControl,
    AgentControlBlocked,
    ApprovalResolution,
    EnforcementMode,
    InterventionPoint,
    OtelMetricsTelemetrySink,
)

from ..tracing import SpanEventTelemetrySink
from .data import PERSONAS
from .tools import execute_tool

MANIFEST = Path(__file__).resolve().parents[2] / "governance" / "manifest.yaml"


class UnknownPersonaError(ValueError):
    pass


class HostAnnotators:
    """Deterministic stand-ins for the manifest's LLM/classifier annotators."""

    def dispatch(
        self,
        annotator_name: str,
        _config: Mapping[str, Any],
        preliminary_policy_input: Mapping[str, Any],
    ) -> Any:
        target = preliminary_policy_input["policy_target"]["value"]
        text = json.dumps(target, sort_keys=True).lower()
        if annotator_name == "input_security":
            return {"flagged": "social-engineer" in text or "jailbreak" in text}
        if annotator_name == "tool_adherence":
            return {"flagged": "override_limits" in text}
        if annotator_name == "fraud_classifier":
            return {"label": "fraud" if "mule" in text else "clear"}
        return {}


def build_control(manifest: Path = MANIFEST) -> AgentControl:
    return AgentControl.from_path(
        str(manifest),
        annotator_dispatcher=HostAnnotators(),
        # acs_intervention_* OTel metrics + decision events on the active span.
        telemetry_sink=[OtelMetricsTelemetrySink(), SpanEventTelemetrySink()],
    )


def manager_snapshot(
    persona_id: str,
    *,
    restricted_mode: bool,
    customer_approved: bool,
    admin_mode: bool,
) -> dict[str, Any]:
    """Build the policy snapshot server-side so the browser cannot forge roles."""
    persona = PERSONAS.get(persona_id)
    if persona is None:
        raise UnknownPersonaError(f"Unknown persona: {persona_id!r}")
    return {
        "manager_id": persona["manager_id"],
        "manager_role": persona["manager_role"],
        "assigned_account_ids": list(persona["assigned_account_ids"]),
        "mode": "restricted" if restricted_mode else "normal",
        "transfer_approved": customer_approved,
        "customer_ack_token": "chat-confirmed" if customer_approved else "",
        "admin_mode_active": admin_mode,
    }


async def evaluate_input(
    control: AgentControl,
    prompt: str,
    snapshot: Mapping[str, Any],
) -> dict[str, Any]:
    result = await control.evaluate_intervention_point(
        InterventionPoint.INPUT,
        {**snapshot, "input": {"text": prompt}},
    )
    try:
        await control.enforce(InterventionPoint.INPUT, result, EnforcementMode.ENFORCE)
    except AgentControlBlocked:
        return outcome("deny", result.verdict.reason, result.verdict.message)
    return outcome("allow", result.verdict.reason, result.verdict.message)


async def evaluate_action(
    control: AgentControl,
    action: Mapping[str, Any],
    snapshot: Mapping[str, Any],
) -> dict[str, Any]:
    result = await control.evaluate_intervention_point(
        InterventionPoint.PRE_TOOL_CALL,
        {
            **snapshot,
            "tool_call": {"name": action["tool_name"], "args": action["args"]},
        },
    )
    if result.verdict.approval is not None:
        return outcome("approval", result.verdict.reason, result.verdict.message)
    try:
        await control.enforce(InterventionPoint.PRE_TOOL_CALL, result, EnforcementMode.ENFORCE)
    except AgentControlBlocked:
        return outcome("deny", result.verdict.reason, result.verdict.message)
    return outcome("allow", result.verdict.reason, result.verdict.message)


async def run_action(
    control: AgentControl,
    action: Mapping[str, Any],
    snapshot: Mapping[str, Any],
    *,
    approved: bool = False,
) -> dict[str, Any]:
    async def approval_resolver(_point: Any, result: Any) -> ApprovalResolution:
        if approved:
            return ApprovalResolution.allow(result.action_identity)
        return ApprovalResolution.deny("The operator rejected the approval request.")

    try:
        result = await control.run_tool(
            action["tool_name"],
            action["args"],
            lambda args: execute_tool(action["tool_name"], args),
            snapshot=snapshot,
            approval_resolver=approval_resolver,
        )
    except AgentControlBlocked as blocked:
        return outcome("deny", blocked.result.verdict.reason, blocked.result.verdict.message)

    post_result = result.post_tool_call_result
    transformed = (
        post_result.transformed_policy_target_applied
        or post_result.transformed_policy_target is not None
    )
    return outcome(
        "transform" if transformed else "allow",
        post_result.verdict.reason or result.pre_tool_call_result.verdict.reason,
        post_result.verdict.message or result.pre_tool_call_result.verdict.message,
        value=result.value,
    )


def outcome(
    status: str,
    reason: str | None,
    message: str | None,
    **extra: Any,
) -> dict[str, Any]:
    return {"status": status, "reason": reason or "default", "message": message or "", **extra}
