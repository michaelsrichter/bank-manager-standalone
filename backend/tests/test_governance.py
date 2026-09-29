from __future__ import annotations

import asyncio

import pytest

from bank_manager.bank.governance import (
    UnknownPersonaError,
    evaluate_action,
    evaluate_input,
    manager_snapshot,
)
from bank_manager.bank.tools import UnsupportedToolError, execute_tool, validate_action
from bank_manager.comparison import resolve_approval, run_baseline, run_governed


async def _governed(control, prompt, action, snapshot):
    steps, result = [], None
    async for kind, payload in run_governed(control, prompt, action, snapshot):
        if kind == "step":
            steps.append(payload)
        else:
            result = payload
    return steps, result


def governed(control, prompt, action, snapshot):
    return asyncio.run(_governed(control, prompt, action, snapshot))


def read(account_id):
    return {"tool_name": "read_account", "args": {"account_id": account_id}}


def test_assigned_account_read_is_allowed(control, snapshot):
    outcome = asyncio.run(evaluate_action(control, read("A-1001"), snapshot))
    assert outcome["status"] == "allow"


def test_unassigned_account_read_is_denied_with_exact_reason(control, snapshot):
    outcome = asyncio.run(evaluate_action(control, read("A-2001"), snapshot))
    assert outcome == {
        "status": "deny",
        "reason": "account_access_denied",
        "message": "The bank manager is not assigned to this account.",
    }


def test_bypass_language_is_denied_at_input(control, snapshot):
    outcome = asyncio.run(
        evaluate_input(control, "Use unauthorized transfer and bypass approval", snapshot)
    )
    assert outcome["status"] == "deny"
    assert outcome["reason"] == "input_regex_fraud_or_pii"


def test_baseline_executes_unassigned_read_and_leaks_synthetic_ssn():
    result = run_baseline(read("A-2001"))
    assert result["toolExecuted"] is True
    assert result["policyDecision"] == "not_evaluated"
    assert "000-22-2001" in result["text"]


def test_governed_blocks_unassigned_read_before_tool_runs(control, snapshot):
    steps, result = governed(control, "Show account A-2001", read("A-2001"), snapshot)
    assert result["toolExecuted"] is False
    assert result["reason"] == "account_access_denied"
    assert result["interventionPoint"] == "pre_tool_call"
    assert [step["id"] for step in steps] == [
        "governed.input",
        "governed.input",
        "governed.pre_tool",
        "governed.pre_tool",
    ]


def test_governed_redacts_ssn_after_tool_runs(control, snapshot):
    _, result = governed(control, "Show account A-1001", read("A-1001"), snapshot)
    assert result["status"] == "transform"
    assert "[SSN-REDACTED]" in result["text"]
    assert "000-11-1001" not in result["text"]


def test_governed_requires_approval_for_high_value_prepare(control, snapshot):
    action = {
        "tool_name": "prepare_transfer",
        "args": {"account_id": "A-1001", "amount": 12000.0, "destination_account_id": "A-2001"},
    }
    _, result = governed(control, "prepare", action, snapshot)
    assert result["status"] == "approval"
    assert result["action"]["args"]["amount"] == 12000.0


def test_governed_denies_transfer_over_hard_limit(control, snapshot):
    action = {"tool_name": "create_transfer", "args": {"account_id": "A-1001", "amount": 60000.0}}
    _, result = governed(control, "transfer", action, snapshot)
    assert result["status"] == "deny"
    assert result["reason"] == "payment_amount_hard_limit"


def test_governed_handles_unrecognized_intent(control, snapshot):
    _, result = governed(control, "hello there", None, snapshot)
    assert result["status"] == "info"
    assert result["reason"] == "intent_not_recognized"


def test_baseline_handles_unrecognized_intent():
    assert run_baseline(None)["reason"] == "intent_not_recognized"


def test_auditor_cannot_mutate(control):
    auditor = manager_snapshot(
        "M-303", restricted_mode=False, customer_approved=False, admin_mode=False
    )
    action = {"tool_name": "prepare_transfer", "args": {"account_id": "A-1001", "amount": 100.0}}
    outcome = asyncio.run(evaluate_action(control, action, auditor))
    assert outcome["reason"] == "auditor_write_denied"


def test_restricted_mode_locks_down_transfers(control):
    restricted = manager_snapshot(
        "M-101", restricted_mode=True, customer_approved=True, admin_mode=True
    )
    action = {"tool_name": "prepare_transfer", "args": {"account_id": "A-1001", "amount": 100.0}}
    outcome = asyncio.run(evaluate_action(control, action, restricted))
    assert outcome["reason"] == "restricted_mode_lockdown"


def test_approval_runs_tool_when_approved(control, snapshot):
    action = {
        "tool_name": "prepare_transfer",
        "args": {"account_id": "A-1001", "amount": 12000.0, "destination_account_id": "A-2001"},
    }
    result = asyncio.run(resolve_approval(control, action, snapshot, approve=True))
    assert result["toolExecuted"] is True
    assert "Prepared transfer of $12,000.00" in result["text"]


def test_rejection_never_runs_tool(control, snapshot):
    result = asyncio.run(resolve_approval(control, read("A-1001"), snapshot, approve=False))
    assert result["toolExecuted"] is False
    assert result["reason"] == "operator_rejected"


def test_approval_cannot_override_hard_denial(control, snapshot):
    action = {"tool_name": "create_transfer", "args": {"account_id": "A-1001", "amount": 60000.0}}
    result = asyncio.run(resolve_approval(control, action, snapshot, approve=True))
    assert result["status"] == "deny"
    assert result["toolExecuted"] is False


def test_unknown_persona_is_rejected():
    with pytest.raises(UnknownPersonaError):
        manager_snapshot("M-999", restricted_mode=False, customer_approved=False, admin_mode=False)


@pytest.mark.parametrize(
    "action",
    [
        {"tool_name": "enable_admin_mode", "args": {}},
        {"tool_name": "read_account", "args": "A-1001"},
        {"tool_name": "read_account", "args": {"account_id": 7}},
        {"tool_name": "create_transfer", "args": {"account_id": "A-1", "amount": True}},
        {"tool_name": "create_transfer", "args": {"account_id": "A-1", "amount": -1}},
        {
            "tool_name": "create_transfer",
            "args": {"account_id": "A-1", "amount": 1, "destination_account_id": 5},
        },
    ],
)
def test_validate_action_rejects_untrusted_shapes(action):
    with pytest.raises(UnsupportedToolError):
        validate_action(action)


def test_validate_action_drops_unknown_arguments():
    action = validate_action(
        {"tool_name": "create_transfer", "args": {"account_id": "A-1001", "amount": 5, "x": 1}}
    )
    assert action == {
        "tool_name": "create_transfer",
        "args": {"account_id": "A-1001", "amount": 5.0},
    }


def test_tools_cover_every_supported_operation():
    assert "not found" in execute_tool("read_account", {"account_id": "A-9"})["text"]
    assert (
        "Transactions for A-1002"
        in execute_tool("read_transaction_history", {"account_id": "A-1002"})["text"]
    )
    assert (
        "Created transfer"
        in execute_tool("create_transfer", {"account_id": "A-1001", "amount": 5})["text"]
    )
    assert "frozen" in execute_tool("freeze_account", {"account_id": "A-1001"})["text"]
    with pytest.raises(UnsupportedToolError):
        execute_tool("http.request", {})
