"""Content-safe telemetry (eps-demo-compliance, eps-demo-production-readiness).

Only allow-listed operational properties are ever emitted. Prompt text, tool
results, account data, and credentials are dropped before they reach a sink.
Every event name and property is documented in docs/telemetry/events.md.
"""

from __future__ import annotations

import logging
from typing import Any, Protocol

EVENTS: dict[str, frozenset[str]] = {
    "page_view": frozenset({"page"}),
    "model_selection": frozenset({"model_key", "deployment"}),
    "ai_call": frozenset(
        {
            "deployment",
            "response_model",
            "status",
            "duration_ms",
            "input_tokens",
            "cached_input_tokens",
            "output_tokens",
            "reasoning_tokens",
            "estimated_cost_usd",
            "fake_ai",
        }
    ),
    "policy_decision": frozenset(
        {"lane", "status", "reason", "tool", "intervention_point", "tool_executed"}
    ),
    "approval_decision": frozenset({"decision", "status", "reason", "tool"}),
    "rate_limited": frozenset({"scope", "route"}),
}

LOGGER_NAME = "bank_manager.events"


class EventSink(Protocol):
    def emit(self, name: str, **properties: Any) -> None: ...


def safe_properties(name: str, properties: dict[str, Any]) -> dict[str, Any]:
    allowed = EVENTS.get(name)
    if allowed is None:
        raise ValueError(f"Undocumented telemetry event: {name}")
    return {
        key: value
        for key, value in properties.items()
        if key in allowed and isinstance(value, (str, int, float, bool))
    }


class LoggingEventSink:
    """Emits App Insights customEvents through the OpenTelemetry log bridge."""

    def __init__(self, logger: logging.Logger | None = None) -> None:
        self._logger = logger or logging.getLogger(LOGGER_NAME)

    def emit(self, name: str, **properties: Any) -> None:
        attributes = safe_properties(name, properties)
        self._logger.info(
            name,
            extra={"microsoft.custom_event.name": name, **attributes},
        )


class MemoryEventSink:
    """Test double that records the safe projection of each event."""

    def __init__(self) -> None:
        self.events: list[tuple[str, dict[str, Any]]] = []

    def emit(self, name: str, **properties: Any) -> None:
        self.events.append((name, safe_properties(name, properties)))


def configure_telemetry(connection_configured: bool, azure_client_id: str | None) -> None:
    """Send logs/traces to Application Insights with Entra (managed identity) auth."""
    logging.getLogger(LOGGER_NAME).setLevel(logging.INFO)
    if not connection_configured:
        return
    from azure.identity import DefaultAzureCredential
    from azure.monitor.opentelemetry import configure_azure_monitor

    configure_azure_monitor(
        credential=DefaultAzureCredential(managed_identity_client_id=azure_client_id),
        logger_name="bank_manager",
        enable_live_metrics=False,
    )
