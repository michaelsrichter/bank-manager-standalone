from __future__ import annotations

import asyncio
import os
import unittest
from unittest.mock import patch

from azure.identity import AzureCliCredential, ManagedIdentityCredential

from bank_chat import (
    build_control,
    evaluate_action,
    manager_snapshot,
)
from bank_runtime import ExecutionMode, run_request
from foundry_intent import (
    BankIntent,
    IntentRoutingError,
    action_from_intent,
    azure_credential,
)


class FixedRouter:
    def __init__(self, action):
        self.action = action

    def route(self, _prompt: str):
        return self.action


class BankChatTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        cls.control = build_control()
        cls.snapshot = manager_snapshot(
            "Maya Chen",
            restricted_mode=False,
            customer_approved=False,
            admin_mode=False,
        )

    def test_parses_account_lookup(self) -> None:
        self.assertEqual(
            action_from_intent(
                BankIntent(
                    intent="read_account",
                    account_id="a-1001",
                    destination_account_id=None,
                    amount=None,
                )
            ),
            {"tool_name": "read_account", "args": {"account_id": "A-1001"}},
        )

    def test_parses_transfer_amount_and_accounts(self) -> None:
        self.assertEqual(
            action_from_intent(
                BankIntent(
                    intent="prepare_transfer",
                    account_id="A-1001",
                    destination_account_id="A-2001",
                    amount=12000,
                )
            ),
            {
                "tool_name": "prepare_transfer",
                "args": {
                    "account_id": "A-1001",
                    "amount": 12000.0,
                    "destination_account_id": "A-2001",
                },
            },
        )

    def test_rejects_model_invented_account_identifier(self) -> None:
        with self.assertRaises(IntentRoutingError):
            action_from_intent(
                BankIntent(
                    intent="read_account",
                    account_id="Olivia",
                    destination_account_id=None,
                    amount=None,
                )
            )

    def test_returns_none_for_unsupported_intent(self) -> None:
        self.assertIsNone(
            action_from_intent(
                BankIntent(
                    intent="unsupported",
                    account_id=None,
                    destination_account_id=None,
                    amount=None,
                )
            )
        )

    def test_uses_managed_identity_when_azure_hosted(self) -> None:
        with patch.dict(os.environ, {"AZURE_HOSTED": "1"}, clear=False):
            credential = azure_credential()
        self.assertIsInstance(credential, ManagedIdentityCredential)
        credential.close()

    def test_uses_azure_cli_credential_for_local_development(self) -> None:
        with patch.dict(os.environ, {}, clear=True):
            credential = azure_credential("00000000-0000-0000-0000-000000000000")
        self.assertIsInstance(credential, AzureCliCredential)
        credential.close()

    def test_assigned_account_is_allowed(self) -> None:
        outcome = asyncio.run(
            evaluate_action(
                self.control,
                {"tool_name": "read_account", "args": {"account_id": "A-1001"}},
                self.snapshot,
            )
        )
        self.assertEqual(outcome["status"], "allow")

    def test_unassigned_account_is_denied(self) -> None:
        outcome = asyncio.run(
            evaluate_action(
                self.control,
                {"tool_name": "read_account", "args": {"account_id": "A-2001"}},
                self.snapshot,
            )
        )
        self.assertEqual(outcome["status"], "deny")
        self.assertEqual(outcome["reason"], "account_access_denied")

    def test_baseline_executes_unassigned_account_read(self) -> None:
        outcome = asyncio.run(
            run_request(
                prompt="Show account A-2001",
                snapshot=self.snapshot,
                mode=ExecutionMode.BASELINE,
                router=FixedRouter(
                    {
                        "tool_name": "read_account",
                        "args": {"account_id": "A-2001"},
                    }
                ),
            )
        )
        self.assertTrue(outcome["tool_executed"])
        self.assertEqual(outcome["policy_decision"], "not_evaluated")
        self.assertIn("345-67-8901", outcome["value"]["text"])

    def test_governed_mode_blocks_unassigned_account_read(self) -> None:
        outcome = asyncio.run(
            run_request(
                prompt="Show account A-2001",
                snapshot=self.snapshot,
                mode=ExecutionMode.GOVERNED,
                router=FixedRouter(
                    {
                        "tool_name": "read_account",
                        "args": {"account_id": "A-2001"},
                    }
                ),
                control=self.control,
            )
        )
        self.assertFalse(outcome["tool_executed"])
        self.assertEqual(outcome["reason"], "account_access_denied")

    def test_governed_mode_redacts_ssn(self) -> None:
        outcome = asyncio.run(
            run_request(
                prompt="Show account A-1001",
                snapshot=self.snapshot,
                mode=ExecutionMode.GOVERNED,
                router=FixedRouter(
                    {
                        "tool_name": "read_account",
                        "args": {"account_id": "A-1001"},
                    }
                ),
                control=self.control,
            )
        )
        self.assertTrue(outcome["tool_executed"])
        self.assertIn("[SSN-REDACTED]", outcome["value"]["text"])
        self.assertNotIn("123-45-6789", outcome["value"]["text"])


if __name__ == "__main__":
    unittest.main()
