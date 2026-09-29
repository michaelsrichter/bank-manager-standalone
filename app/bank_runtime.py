from __future__ import annotations

import asyncio
from enum import Enum
from typing import Any, Mapping, Protocol

from agent_control_specification import AgentControl

from bank_chat import (
    evaluate_action,
    evaluate_input,
    execute_tool,
    run_action,
)


class ExecutionMode(str, Enum):
    BASELINE = "baseline"
    GOVERNED = "governed"


class IntentRouter(Protocol):
    def route(self, prompt: str) -> dict[str, Any] | None: ...


async def route_request(
    router: IntentRouter,
    prompt: str,
) -> dict[str, Any] | None:
    return await asyncio.to_thread(router.route, prompt)


async def run_request(
    *,
    prompt: str,
    snapshot: Mapping[str, Any],
    mode: ExecutionMode,
    router: IntentRouter,
    control: AgentControl | None = None,
    action: Mapping[str, Any] | None = None,
    action_is_resolved: bool = False,
) -> dict[str, Any]:
    if mode is ExecutionMode.GOVERNED:
        if control is None:
            raise ValueError("ACS governed mode requires an AgentControl instance.")
        input_outcome = await evaluate_input(control, prompt, snapshot)
        if input_outcome["status"] == "deny":
            return _evidence(
                input_outcome,
                mode=mode,
                action=None,
                tool_executed=False,
                intervention_point="input",
            )

    selected_action = (
        action if action_is_resolved else await route_request(router, prompt)
    )
    if selected_action is None:
        return _evidence(
            {
                "status": "info",
                "reason": "intent_not_recognized",
                "message": "",
            },
            mode=mode,
            action=None,
            tool_executed=False,
            intervention_point=None,
        )

    return await run_selected_action(
        action=selected_action,
        snapshot=snapshot,
        mode=mode,
        control=control,
    )


async def run_selected_action(
    *,
    action: Mapping[str, Any],
    snapshot: Mapping[str, Any],
    mode: ExecutionMode,
    control: AgentControl | None = None,
) -> dict[str, Any]:
    if mode is ExecutionMode.BASELINE:
        value = execute_tool(str(action["tool_name"]), action["args"])
        return _evidence(
            {
                "status": "allow",
                "reason": "baseline_no_policy",
                "message": "Executed without ACS policy enforcement.",
                "value": value,
            },
            mode=mode,
            action=action,
            tool_executed=True,
            intervention_point=None,
        )

    if control is None:
        raise ValueError("ACS governed mode requires an AgentControl instance.")

    pre_outcome = await evaluate_action(control, action, snapshot)
    if pre_outcome["status"] in {"deny", "approval"}:
        return _evidence(
            pre_outcome,
            mode=mode,
            action=action,
            tool_executed=False,
            intervention_point="pre_tool_call",
        )

    run_outcome = await run_action(control, action, snapshot)
    return _evidence(
        run_outcome,
        mode=mode,
        action=action,
        tool_executed=run_outcome["status"] != "deny",
        intervention_point="post_tool_call",
    )


async def approve_selected_action(
    *,
    action: Mapping[str, Any],
    snapshot: Mapping[str, Any],
    control: AgentControl,
) -> dict[str, Any]:
    outcome = await run_action(control, action, snapshot, approved=True)
    return _evidence(
        outcome,
        mode=ExecutionMode.GOVERNED,
        action=action,
        tool_executed=outcome["status"] != "deny",
        intervention_point="post_tool_call",
    )


def reject_selected_action(
    *,
    action: Mapping[str, Any],
) -> dict[str, Any]:
    return _evidence(
        {
            "status": "deny",
            "reason": "operator_rejected",
            "message": "The operator rejected the approval request.",
        },
        mode=ExecutionMode.GOVERNED,
        action=action,
        tool_executed=False,
        intervention_point="pre_tool_call",
    )


def _evidence(
    outcome: Mapping[str, Any],
    *,
    mode: ExecutionMode,
    action: Mapping[str, Any] | None,
    tool_executed: bool,
    intervention_point: str | None,
) -> dict[str, Any]:
    return {
        **outcome,
        "mode": mode.value,
        "action": dict(action) if action is not None else None,
        "policy_decision": (
            outcome["status"] if mode is ExecutionMode.GOVERNED else "not_evaluated"
        ),
        "intervention_point": intervention_point,
        "tool_executed": tool_executed,
    }
