"""Content-safe telemetry (eps-demo-compliance, eps-demo-production-readiness).

Only allow-listed operational properties are ever emitted. Prompt text, tool
results, account data, and credentials are dropped before they reach a sink.
Every event name and property is documented in docs/telemetry/events.md.
"""

from __future__ import annotations

import logging
from typing import Any, Protocol

from opentelemetry.sdk.resources import Resource

from . import request_context

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
        {
            "lane",
            "status",
            "reason",
            "tool",
            "intervention_point",
            "tool_executed",
            "authz_outcome",
        }
    ),
    "approval_decision": frozenset({"decision", "status", "reason", "tool"}),
    "rate_limited": frozenset({"scope", "route"}),
    "client_timing": frozenset(
        {"first_event_ms", "total_ms", "outcome", "model_key", "event_count"}
    ),
    "health_check": frozenset({"component", "status", "critical"}),
    "evaluation_run_started": frozenset({"suite", "items", "status"}),
}

LOGGER_NAME = "bank_manager.events"


class EventSink(Protocol):
    def emit(self, name: str, **properties: Any) -> None: ...


# tour:begin telemetry-allowlist
def safe_properties(name: str, properties: dict[str, Any]) -> dict[str, Any]:
    allowed = EVENTS.get(name)
    if allowed is None:
        raise ValueError(f"Undocumented telemetry event: {name}")
    return {
        key: value
        for key, value in properties.items()
        if key in allowed and isinstance(value, (str, int, float, bool))
    }


# tour:end telemetry-allowlist


class LoggingEventSink:
    """Emits App Insights customEvents through the OpenTelemetry log bridge."""

    def __init__(self, logger: logging.Logger | None = None) -> None:
        self._logger = logger or logging.getLogger(LOGGER_NAME)

    def emit(self, name: str, **properties: Any) -> None:
        attributes = {**safe_properties(name, properties), **request_context.log_context()}
        self._logger.info(
            name,
            extra={"microsoft.custom_event.name": name, **attributes},
        )


class MemoryEventSink:
    """Test double that records the safe projection of each event."""

    def __init__(self) -> None:
        self.events: list[tuple[str, dict[str, Any]]] = []

    def emit(self, name: str, **properties: Any) -> None:
        self.events.append(
            (name, {**safe_properties(name, properties), **request_context.log_context()})
        )


def telemetry_resource(service_version: str, environment: str) -> Resource:
    """Resource attributes on every span, metric, and log (eps-demo-observability).

    ``service.version`` is the Git commit, so each trace ties to the footer's build
    stamp. ``deployment.environment.name`` keeps local runs off release dashboards.
    ``OTEL_SERVICE_NAME`` and ``OTEL_RESOURCE_ATTRIBUTES`` are merged in by the SDK.
    """
    return Resource.create(
        {"service.version": service_version, "deployment.environment.name": environment}
    )


def configure_telemetry(
    connection_configured: bool,
    azure_client_id: str | None,
    *,
    service_version: str = "unknown",
    environment: str = "local",
) -> None:
    """Export traces, metrics, and logs to Azure Monitor with Entra (managed identity) auth.

    Instrumented automatically: FastAPI requests, httpx (the OpenAI SDK's HTTP
    calls to Microsoft Foundry), Azure SDK calls, and Python logging. The agent
    harness adds GenAI spans and metrics in ``bank_manager.tracing``; ACS adds
    ``acs_intervention_*`` metrics. Message content is never captured.
    """
    logging.getLogger(LOGGER_NAME).setLevel(logging.INFO)
    if not connection_configured:
        return
    from azure.identity import DefaultAzureCredential
    from azure.monitor.opentelemetry import configure_azure_monitor
    from opentelemetry.instrumentation.httpx import HTTPXClientInstrumentor

    configure_azure_monitor(
        credential=DefaultAzureCredential(managed_identity_client_id=azure_client_id),
        logger_name="bank_manager",
        enable_live_metrics=True,
        resource=telemetry_resource(service_version, environment),
        span_processors=[request_context.ConversationSpanProcessor()],
    )
    instrumentor = HTTPXClientInstrumentor()
    if not instrumentor.is_instrumented_by_opentelemetry:
        instrumentor.instrument()
