from __future__ import annotations

from collections.abc import Mapping
from typing import Any

from .data import ACCOUNTS, TRANSACTIONS

SUPPORTED_TOOLS = frozenset(
    {
        "read_account",
        "read_transaction_history",
        "prepare_transfer",
        "create_transfer",
        "freeze_account",
    }
)

MAX_TRANSFER_AMOUNT = 10_000_000.0


class UnsupportedToolError(ValueError):
    pass


# tour:begin tools-validate
def validate_action(action: Mapping[str, Any]) -> dict[str, Any]:
    """Validate a tool call that crossed the browser boundary."""
    tool_name = action.get("tool_name")
    args = action.get("args")
    if tool_name not in SUPPORTED_TOOLS or not isinstance(args, Mapping):
        raise UnsupportedToolError("Unsupported tool call.")
    account_id = args.get("account_id", "")
    if not isinstance(account_id, str) or len(account_id) > 16:
        raise UnsupportedToolError("Invalid account ID.")
    clean: dict[str, Any] = {"account_id": account_id}
    if tool_name in {"prepare_transfer", "create_transfer"}:
        amount = args.get("amount", 0.0)
        if isinstance(amount, bool) or not isinstance(amount, (int, float)):
            raise UnsupportedToolError("Invalid amount.")
        if amount < 0 or amount > MAX_TRANSFER_AMOUNT:
            raise UnsupportedToolError("Invalid amount.")
        clean["amount"] = float(amount)
        destination = args.get("destination_account_id")
        if destination is not None:
            if not isinstance(destination, str) or len(destination) > 16:
                raise UnsupportedToolError("Invalid destination account ID.")
            clean["destination_account_id"] = destination
    return {"tool_name": tool_name, "args": clean}


# tour:end tools-validate


def execute_tool(tool_name: str, args: Mapping[str, Any]) -> dict[str, Any]:
    """Side-effect-free synthetic bank tools."""
    if tool_name not in SUPPORTED_TOOLS:
        raise UnsupportedToolError(f"Unsupported tool: {tool_name}")
    account_id = str(args.get("account_id", ""))
    account = ACCOUNTS.get(account_id)
    if account is None:
        return {"text": f"Account {account_id or '(none)'} was not found."}

    destination = args.get("destination_account_id", "external account")
    if tool_name == "read_account":
        return {
            "text": (
                f"{account_id} | {account['customer']} | {account['type']} | "
                f"balance ${account['balance']:,.2f} | status {account['status']} | "
                f"SSN {account['ssn']}"
            )
        }
    if tool_name == "read_transaction_history":
        history = "\n".join(TRANSACTIONS.get(account_id, ("No recent transactions.",)))
        return {"text": f"Transactions for {account_id}:\n{history}"}
    if tool_name == "prepare_transfer":
        return {
            "text": (
                f"Prepared transfer of ${float(args['amount']):,.2f} from {account_id} "
                f"to {destination}."
            )
        }
    if tool_name == "create_transfer":
        return {
            "text": (
                f"Created transfer of ${float(args['amount']):,.2f} from {account_id} "
                f"to {destination}."
            )
        }
    return {"text": f"Account {account_id} is frozen pending investigation."}
