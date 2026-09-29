from __future__ import annotations

import os
import re
from typing import Literal

from azure.ai.projects import AIProjectClient
from azure.core.credentials import TokenCredential
from azure.identity import AzureCliCredential, ManagedIdentityCredential
from pydantic import BaseModel, ConfigDict

DEFAULT_MODEL_DEPLOYMENT = "gpt-4.1"

SYSTEM_PROMPT = """You route requests for a governed bank-manager application.
Select exactly one supported intent and extract only values stated by the user.

Supported intents:
- read_account: view an account or balance
- read_transaction_history: view transactions or account history
- prepare_transfer: prepare or draft a transfer without executing it
- create_transfer: execute, send, or move money
- freeze_account: freeze an account
- unsupported: any other request

Account IDs must be copied verbatim from explicit A-<digits> values in the
request. Never infer an account ID from a customer name. For transfers, the
first account is account_id and the second is destination_account_id. Return
null for values that were not supplied. Do not decide whether an operation is
authorized; the policy engine makes that decision."""


class BankIntent(BaseModel):
    model_config = ConfigDict(extra="forbid")

    intent: Literal[
        "read_account",
        "read_transaction_history",
        "prepare_transfer",
        "create_transfer",
        "freeze_account",
        "unsupported",
    ]
    account_id: str | None
    destination_account_id: str | None
    amount: float | None


class IntentRoutingError(RuntimeError):
    pass


def azure_credential(tenant_id: str | None = None) -> TokenCredential:
    if os.environ.get("AZURE_HOSTED") == "1":
        client_id = os.environ.get("AZURE_CLIENT_ID")
        if client_id:
            return ManagedIdentityCredential(client_id=client_id)
        return ManagedIdentityCredential()
    return AzureCliCredential(tenant_id=tenant_id)


def action_from_intent(intent: BankIntent) -> dict[str, object] | None:
    if intent.intent == "unsupported":
        return None

    account_id = _normalize_account_id(intent.account_id)
    args: dict[str, object] = {"account_id": account_id}

    if intent.intent in {"prepare_transfer", "create_transfer"}:
        if intent.amount is not None and intent.amount < 0:
            raise IntentRoutingError("The model returned a negative transfer amount.")
        args["amount"] = intent.amount if intent.amount is not None else 0.0
        destination = _normalize_account_id(intent.destination_account_id)
        if destination:
            args["destination_account_id"] = destination

    return {"tool_name": intent.intent, "args": args}


class FoundryIntentRouter:
    def __init__(
        self,
        *,
        project_endpoint: str | None = None,
        model_deployment: str | None = None,
        tenant_id: str | None = None,
    ) -> None:
        self.project_endpoint = project_endpoint or os.environ.get(
            "FOUNDRY_PROJECT_ENDPOINT"
        )
        if not self.project_endpoint:
            raise ValueError(
                "FOUNDRY_PROJECT_ENDPOINT must identify a Microsoft Foundry project."
            )
        self.model_deployment = (
            model_deployment
            or os.environ.get("FOUNDRY_MODEL_NAME")
            or DEFAULT_MODEL_DEPLOYMENT
        )
        self.tenant_id = tenant_id or os.environ.get("AZURE_TENANT_ID")
        self._credential = azure_credential(self.tenant_id)
        self._project_client = AIProjectClient(
            endpoint=self.project_endpoint,
            credential=self._credential,
        )
        self._openai_client = self._project_client.get_openai_client()

    def route(self, prompt: str) -> dict[str, object] | None:
        try:
            completion = self._openai_client.beta.chat.completions.parse(
                model=self.model_deployment,
                messages=[
                    {"role": "system", "content": SYSTEM_PROMPT},
                    {"role": "user", "content": prompt},
                ],
                response_format=BankIntent,
                temperature=0,
            )
        except Exception as error:
            raise IntentRoutingError(
                "The Foundry model request failed. Verify Azure authentication, "
                "project access, and the model deployment name."
            ) from error

        message = completion.choices[0].message
        if message.refusal:
            raise IntentRoutingError(f"The Foundry model refused the request: {message.refusal}")
        if message.parsed is None:
            raise IntentRoutingError("The Foundry model returned no structured intent.")
        return action_from_intent(message.parsed)

    def close(self) -> None:
        self._openai_client.close()
        self._project_client.close()
        self._credential.close()


def _normalize_account_id(value: str | None) -> str:
    if value is None:
        return ""
    normalized = value.strip().upper()
    if not re.fullmatch(r"A-\d+", normalized):
        raise IntentRoutingError(
            f"The model returned an invalid account ID: {value!r}."
        )
    return normalized
