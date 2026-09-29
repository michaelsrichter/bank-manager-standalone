from __future__ import annotations

import json
from pathlib import Path
from typing import Any, Mapping

from agent_control_specification import (
    AgentControl,
    AgentControlBlocked,
    ApprovalResolution,
    EnforcementMode,
    InterventionPoint,
)

MANIFEST = Path(__file__).resolve().parents[1] / "manifest.yaml"

MANAGERS = {
    "Maya Chen": {
        "manager_id": "M-101",
        "manager_role": "bank_manager",
        "assigned_account_ids": ["A-1001", "A-1002"],
    },
    "Noah Williams": {
        "manager_id": "M-202",
        "manager_role": "senior_manager",
        "assigned_account_ids": ["A-2001", "A-2002"],
    },
    "Priya Shah": {
        "manager_id": "M-303",
        "manager_role": "auditor",
        "assigned_account_ids": ["A-1001", "A-2001"],
    },
}

ACCOUNTS = {
    "A-1001": {
        "customer": "Olivia Martin",
        "type": "Checking",
        "balance": 18420.55,
        "status": "Active",
        "ssn": "123-45-6789",
    },
    "A-1002": {
        "customer": "Ethan Brown",
        "type": "Savings",
        "balance": 73110.20,
        "status": "Active",
        "ssn": "234-56-7890",
    },
    "A-2001": {
        "customer": "Sophia Davis",
        "type": "Business",
        "balance": 246800.00,
        "status": "Review",
        "ssn": "345-67-8901",
    },
    "A-2002": {
        "customer": "Liam Wilson",
        "type": "Checking",
        "balance": 9200.75,
        "status": "Active",
        "ssn": "456-78-9012",
    },
}

TRANSACTIONS = {
    "A-1001": [
        "2026-09-26 Grocery Market -$84.19",
        "2026-09-25 Payroll +$3,850.00",
        "2026-09-23 Electric Utility -$142.38",
    ],
    "A-1002": [
        "2026-09-24 Interest +$183.24",
        "2026-09-20 Transfer In +$5,000.00",
    ],
    "A-2001": [
        "2026-09-27 Vendor Payment -$12,400.00",
        "2026-09-25 Client Deposit +$28,900.00",
    ],
    "A-2002": [
        "2026-09-26 Card Purchase -$63.11",
        "2026-09-24 Payroll +$2,900.00",
    ],
}

HELP_TEXT = (
    "Try `show account A-1001`, `transactions for A-1001`, "
    "`prepare transfer $12,000 from A-1001 to A-2001`, or "
    "`freeze account A-1001`."
)


class HostAnnotators:
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


def build_control() -> AgentControl:
    return AgentControl.from_path(str(MANIFEST), annotator_dispatcher=HostAnnotators())


def manager_snapshot(
    manager_name: str,
    *,
    restricted_mode: bool,
    customer_approved: bool,
    admin_mode: bool,
) -> dict[str, Any]:
    manager = MANAGERS[manager_name]
    return {
        **manager,
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
        return _outcome("deny", result.verdict.reason, result.verdict.message)
    return _outcome("allow", result.verdict.reason, result.verdict.message)


async def evaluate_action(
    control: AgentControl,
    action: Mapping[str, Any],
    snapshot: Mapping[str, Any],
) -> dict[str, Any]:
    result = await control.evaluate_intervention_point(
        InterventionPoint.PRE_TOOL_CALL,
        {
            **snapshot,
            "tool_call": {
                "name": action["tool_name"],
                "args": action["args"],
            },
        },
    )
    if result.verdict.approval is not None:
        return _outcome(
            "approval",
            result.verdict.reason,
            result.verdict.message,
            action=dict(action),
        )
    try:
        await control.enforce(InterventionPoint.PRE_TOOL_CALL, result, EnforcementMode.ENFORCE)
    except AgentControlBlocked:
        return _outcome("deny", result.verdict.reason, result.verdict.message)
    return _outcome("allow", result.verdict.reason, result.verdict.message)


async def run_action(
    control: AgentControl,
    action: Mapping[str, Any],
    snapshot: Mapping[str, Any],
    *,
    approved: bool = False,
) -> dict[str, Any]:
    async def approval_resolver(_point, result) -> ApprovalResolution:
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
        return _outcome(
            "deny",
            blocked.result.verdict.reason,
            blocked.result.verdict.message,
        )

    post_result = result.post_tool_call_result
    transformed = (
        post_result.transformed_policy_target_applied
        or post_result.transformed_policy_target is not None
    )
    return _outcome(
        "transform" if transformed else "allow",
        post_result.verdict.reason or result.pre_tool_call_result.verdict.reason,
        post_result.verdict.message or result.pre_tool_call_result.verdict.message,
        value=result.value,
    )


def execute_tool(tool_name: str, args: Mapping[str, Any]) -> dict[str, Any]:
    account_id = str(args.get("account_id", ""))
    account = ACCOUNTS.get(account_id)
    if tool_name in {
        "read_account",
        "read_transaction_history",
        "prepare_transfer",
        "create_transfer",
        "freeze_account",
    } and account is None:
        return {"text": f"Account {account_id} was not found."}

    if tool_name == "read_account":
        return {
            "text": (
                f"{account_id} | {account['customer']} | {account['type']} | "
                f"balance ${account['balance']:,.2f} | status {account['status']} | "
                f"SSN {account['ssn']}"
            )
        }
    if tool_name == "read_transaction_history":
        history = "\n".join(TRANSACTIONS.get(account_id, ["No recent transactions."]))
        return {"text": f"Transactions for {account_id}:\n{history}"}
    if tool_name == "prepare_transfer":
        return {
            "text": (
                f"Prepared transfer of ${args['amount']:,.2f} from {account_id} "
                f"to {args.get('destination_account_id', 'external account')}."
            )
        }
    if tool_name == "create_transfer":
        return {
            "text": (
                f"Created transfer of ${args['amount']:,.2f} from {account_id} "
                f"to {args.get('destination_account_id', 'external account')}."
            )
        }
    if tool_name == "freeze_account":
        return {"text": f"Account {account_id} is frozen pending investigation."}
    raise ValueError(f"Unsupported tool: {tool_name}")


def _outcome(
    status: str,
    reason: str | None,
    message: str | None,
    **extra: Any,
) -> dict[str, Any]:
    return {
        "status": status,
        "reason": reason or "default",
        "message": message or "",
        **extra,
    }
