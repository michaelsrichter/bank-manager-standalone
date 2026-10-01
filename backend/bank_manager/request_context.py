"""Per-request telemetry context (eps-demo-observability, eps-demo-telemetry-links).

The browser sends two headers with each API call:

- ``X-Conversation-Id``: one random ID for the whole chat (a GUID). It becomes the
  OpenTelemetry attribute ``gen_ai.conversation.id`` on **every** span the request
  starts, so a "whole chat" query can find every step, not just the first span.
- ``X-Demo-Mode``: ``live`` or ``practice``. Practice answers skip the AI model, so
  dashboards and review links leave them out.

Both values are checked against strict patterns before use, so they can never
change a KQL query or a URL. They are random IDs, never personal data, and they
never go on metrics (a new time series per chat would cost money).
"""

from __future__ import annotations

import re
from contextvars import ContextVar
from typing import Literal

from opentelemetry import trace
from opentelemetry.context import Context
from opentelemetry.sdk.trace import ReadableSpan, Span, SpanProcessor

DemoMode = Literal["live", "practice"]

CONVERSATION_HEADER = "x-conversation-id"
MODE_HEADER = "x-demo-mode"
CONVERSATION_ATTRIBUTE = "gen_ai.conversation.id"
MODE_ATTRIBUTE = "demo.mode"
JOURNEY_ATTRIBUTE = "demo.journey"

# The app's GUIDs, and Foundry conversation IDs such as "conv_0a1b...".
CONVERSATION_PATTERN = re.compile(r"^[A-Za-z0-9][A-Za-z0-9_-]{7,127}$")

JOURNEYS = {
    "/api/compare": "ask",
    "/api/approval": "approve",
    "/api/health": "health",
    "/api/evaluations/runs": "evaluate",
}

_conversation_id: ContextVar[str | None] = ContextVar("conversation_id", default=None)
_mode: ContextVar[DemoMode] = ContextVar("demo_mode", default="live")
_journey: ContextVar[str | None] = ContextVar("demo_journey", default=None)


def clean_conversation_id(value: str | None) -> str | None:
    value = (value or "").strip()
    return value if CONVERSATION_PATTERN.fullmatch(value) else None


def clean_mode(value: str | None) -> DemoMode:
    return "practice" if (value or "").strip().lower() == "practice" else "live"


def conversation_id() -> str | None:
    return _conversation_id.get()


def mode() -> DemoMode:
    return _mode.get()


# tour:begin conversation-stamp
def begin_request(path: str, conversation: str | None, demo_mode: str | None) -> None:
    """Remember this request's IDs, and stamp them on the request span already running."""
    _conversation_id.set(clean_conversation_id(conversation))
    _mode.set(clean_mode(demo_mode))
    _journey.set(JOURNEYS.get(path))
    stamp(trace.get_current_span())


def stamp(span: trace.Span) -> None:
    if not span.is_recording():
        return
    if (conversation := _conversation_id.get()) is not None:
        span.set_attribute(CONVERSATION_ATTRIBUTE, conversation)
    if (journey := _journey.get()) is not None:
        span.set_attribute(JOURNEY_ATTRIBUTE, journey)
        span.set_attribute(MODE_ATTRIBUTE, _mode.get())


# tour:end conversation-stamp


def log_context() -> dict[str, str]:
    """The same IDs for log-based events (App Insights customEvents)."""
    fields: dict[str, str] = {}
    if (conversation := _conversation_id.get()) is not None:
        fields[CONVERSATION_ATTRIBUTE] = conversation
    if _journey.get() is not None:
        fields[MODE_ATTRIBUTE] = _mode.get()
    return fields


class ConversationSpanProcessor(SpanProcessor):
    """Copies the current request's conversation ID and mode onto every new span."""

    def on_start(self, span: Span, parent_context: Context | None = None) -> None:
        stamp(span)

    def on_end(self, span: ReadableSpan) -> None:
        return None
