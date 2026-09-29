from __future__ import annotations

import json
import re
import time
from collections.abc import Callable
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Literal, Protocol
from urllib.parse import urlparse

from pydantic import BaseModel, ConfigDict

from .. import tracing
from ..config import IntentRoleConfig, ModelOption


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
    """The model could not produce a usable tool selection."""


class ContentFilteredError(IntentRoutingError):
    """Azure AI content filtering blocked the prompt or completion."""


class ModelRateLimitedError(IntentRoutingError):
    """The model deployment is throttling requests."""


@dataclass(frozen=True)
class Usage:
    input_tokens: int = 0
    cached_input_tokens: int = 0
    output_tokens: int = 0
    reasoning_tokens: int = 0

    def public(self) -> dict[str, int]:
        return {
            "inputTokens": self.input_tokens,
            "cachedInputTokens": self.cached_input_tokens,
            "outputTokens": self.output_tokens,
            "reasoningTokens": self.reasoning_tokens,
        }


@dataclass(frozen=True)
class RoutingResult:
    action: dict[str, Any] | None
    requested_deployment: str
    response_model: str | None
    usage: Usage | None
    duration_ms: int
    fake: bool = False


class IntentRouter(Protocol):
    def route(self, prompt: str, option: ModelOption) -> RoutingResult: ...


def action_from_intent(intent: BankIntent) -> dict[str, Any] | None:
    if intent.intent == "unsupported":
        return None
    args: dict[str, Any] = {"account_id": normalize_account_id(intent.account_id)}
    if intent.intent in {"prepare_transfer", "create_transfer"}:
        if intent.amount is not None and intent.amount < 0:
            raise IntentRoutingError("The model returned a negative transfer amount.")
        args["amount"] = float(intent.amount) if intent.amount is not None else 0.0
        destination = normalize_account_id(intent.destination_account_id)
        if destination:
            args["destination_account_id"] = destination
    return {"tool_name": intent.intent, "args": args}


def normalize_account_id(value: str | None) -> str:
    if value is None:
        return ""
    normalized = value.strip().upper()
    if not re.fullmatch(r"A-\d{1,8}", normalized):
        raise IntentRoutingError("The model returned an invalid account ID.")
    return normalized


def usage_from_completion(raw_usage: Any) -> Usage | None:
    if raw_usage is None:
        return None
    prompt_details = getattr(raw_usage, "prompt_tokens_details", None)
    completion_details = getattr(raw_usage, "completion_tokens_details", None)
    return Usage(
        input_tokens=int(getattr(raw_usage, "prompt_tokens", 0) or 0),
        cached_input_tokens=int(getattr(prompt_details, "cached_tokens", 0) or 0),
        output_tokens=int(getattr(raw_usage, "completion_tokens", 0) or 0),
        reasoning_tokens=int(getattr(completion_details, "reasoning_tokens", 0) or 0),
    )


class OpenAIIntentRouter:
    """Routes a prompt to one bank tool with Azure OpenAI structured outputs."""

    def __init__(
        self,
        client: Any,
        config: IntentRoleConfig,
        *,
        clock: Callable[[], float] = time.perf_counter,
    ) -> None:
        self._client = client
        self._config = config
        self._clock = clock

    def route(self, prompt: str, option: ModelOption) -> RoutingResult:
        started = self._clock()
        with tracing.chat_span(
            deployment=option.deployment,
            temperature=self._config.temperature,
            max_tokens=self._config.max_output_tokens,
            server_address=urlparse(str(getattr(self._client, "base_url", ""))).hostname,
            fake=False,
        ) as span:
            try:
                completion = self._client.beta.chat.completions.parse(
                    model=option.deployment,
                    messages=[
                        {"role": "system", "content": self._config.system_prompt},
                        {
                            "role": "user",
                            "content": self._config.user_template.replace("{prompt}", prompt),
                        },
                    ],
                    response_format=BankIntent,
                    temperature=self._config.temperature,
                    max_tokens=self._config.max_output_tokens,
                )
            except Exception as error:
                raise classify_model_error(error) from error

            choice = completion.choices[0]
            finish_reason = getattr(choice, "finish_reason", None)
            usage = usage_from_completion(getattr(completion, "usage", None)) or Usage()
            response_model = getattr(completion, "model", None)
            message = choice.message
            parsed = None if finish_reason == "content_filter" else message.parsed
            action = action_from_intent(parsed) if parsed is not None else None
            tracing.record_chat_result(
                span,
                deployment=option.deployment,
                response_model=response_model,
                response_id=getattr(completion, "id", None),
                finish_reason=finish_reason,
                input_tokens=usage.input_tokens,
                cached_input_tokens=usage.cached_input_tokens,
                output_tokens=usage.output_tokens,
                reasoning_tokens=usage.reasoning_tokens,
                tool_name=action["tool_name"] if action else None,
                fake=False,
            )
            if finish_reason == "content_filter":
                raise ContentFilteredError("Azure AI content filtering blocked the response.")
            if getattr(message, "refusal", None):
                raise IntentRoutingError("The model refused to route this request.")
            if parsed is None:
                raise IntentRoutingError("The model returned no structured intent.")
        return RoutingResult(
            action=action,
            requested_deployment=option.deployment,
            response_model=response_model,
            usage=usage_from_completion(getattr(completion, "usage", None)),
            duration_ms=int((self._clock() - started) * 1000),
        )


def classify_model_error(error: Exception) -> IntentRoutingError:
    status = getattr(error, "status_code", None)
    code = str(getattr(error, "code", "") or "")
    body = getattr(error, "body", None)
    if isinstance(body, dict):
        code = code or str(body.get("code", "") or "")
        inner = body.get("innererror")
        if isinstance(inner, dict):
            code = str(inner.get("code", code) or code)
    lowered = code.lower()
    if status == 400 and ("content_filter" in lowered or "responsibleaipolicyviolation" in lowered):
        return ContentFilteredError("Azure AI content filtering blocked the request.")
    if status == 429:
        return ModelRateLimitedError("The model deployment is busy. Try again shortly.")
    return IntentRoutingError(
        "The model request failed. Verify identity, network access, and the deployment."
    )


_AMOUNT = re.compile(r"\$?\s?(\d[\d,]*(?:\.\d+)?)\s*(k)?\b", re.IGNORECASE)
_ACCOUNT = re.compile(r"\bA-\d{1,8}\b", re.IGNORECASE)


class FakeIntentRouter:
    """Deterministic FAKE_AI=1 router: recorded fixtures first, then simple rules."""

    def __init__(self, fixtures: dict[str, dict[str, Any]] | None = None) -> None:
        self._fixtures = {key.strip().lower(): value for key, value in (fixtures or {}).items()}

    @classmethod
    def from_file(cls, path: Path) -> FakeIntentRouter:
        if not path.exists():
            return cls()
        return cls(json.loads(path.read_text(encoding="utf-8")))

    def route(self, prompt: str, option: ModelOption) -> RoutingResult:
        recorded = self._fixtures.get(prompt.strip().lower())
        intent = BankIntent(**recorded) if recorded is not None else self._rule_intent(prompt)
        with tracing.chat_span(
            deployment=option.deployment,
            temperature=0.0,
            max_tokens=0,
            server_address=None,
            fake=True,
        ) as span:
            action = action_from_intent(intent)
            tracing.record_chat_result(
                span,
                deployment=option.deployment,
                response_model=f"fake:{option.model}",
                response_id=None,
                finish_reason="stop",
                input_tokens=0,
                cached_input_tokens=0,
                output_tokens=0,
                reasoning_tokens=0,
                tool_name=action["tool_name"] if action else None,
                fake=True,
            )
        return RoutingResult(
            action=action,
            requested_deployment=option.deployment,
            response_model=f"fake:{option.model}",
            usage=Usage(),
            duration_ms=0,
            fake=True,
        )

    @staticmethod
    def _rule_intent(prompt: str) -> BankIntent:
        text = prompt.lower()
        accounts = [match.upper() for match in _ACCOUNT.findall(prompt)]
        amount = _amount(prompt)
        if "freeze" in text:
            intent = "freeze_account"
        elif "prepare" in text or "draft" in text:
            intent = "prepare_transfer"
        elif any(word in text for word in ("transfer", "send", "move", "pay")):
            intent = "create_transfer"
        elif "transaction" in text or "history" in text:
            intent = "read_transaction_history"
        elif accounts and any(word in text for word in ("show", "view", "balance", "account")):
            intent = "read_account"
        else:
            intent = "unsupported"
        if intent != "unsupported" and not accounts:
            intent = "unsupported"
        return BankIntent(
            intent=intent,
            account_id=accounts[0] if accounts and intent != "unsupported" else None,
            destination_account_id=accounts[1] if len(accounts) > 1 else None,
            amount=amount if intent in {"prepare_transfer", "create_transfer"} else None,
        )


def _amount(prompt: str) -> float | None:
    without_accounts = _ACCOUNT.sub(" ", prompt)
    match = _AMOUNT.search(without_accounts)
    if not match:
        return None
    value = float(match.group(1).replace(",", ""))
    return value * 1000 if match.group(2) else value
