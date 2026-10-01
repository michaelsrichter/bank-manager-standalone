from __future__ import annotations

import os
from pathlib import Path

import pytest

os.environ.setdefault("FAKE_AI", "1")

from opentelemetry import metrics, trace  # noqa: E402
from opentelemetry.sdk.metrics import MeterProvider  # noqa: E402
from opentelemetry.sdk.metrics.export import InMemoryMetricReader  # noqa: E402
from opentelemetry.sdk.trace import TracerProvider  # noqa: E402
from opentelemetry.sdk.trace.export import SimpleSpanProcessor  # noqa: E402
from opentelemetry.sdk.trace.export.in_memory_span_exporter import (  # noqa: E402
    InMemorySpanExporter,
)

from bank_manager.request_context import ConversationSpanProcessor  # noqa: E402

SPAN_EXPORTER = InMemorySpanExporter()
METRIC_READER = InMemoryMetricReader()
_provider = TracerProvider()
_provider.add_span_processor(ConversationSpanProcessor())
_provider.add_span_processor(SimpleSpanProcessor(SPAN_EXPORTER))
trace.set_tracer_provider(_provider)
metrics.set_meter_provider(MeterProvider(metric_readers=[METRIC_READER]))

from bank_manager.bank.governance import build_control, manager_snapshot  # noqa: E402
from bank_manager.config import REPO_ROOT, load_intent_config  # noqa: E402


@pytest.fixture(scope="session")
def control():
    return build_control()


@pytest.fixture(scope="session")
def intent_config():
    return load_intent_config(REPO_ROOT / "config" / "models.json")


@pytest.fixture()
def snapshot():
    return manager_snapshot(
        "M-101", restricted_mode=False, customer_approved=False, admin_mode=False
    )


@pytest.fixture(scope="session")
def fixtures_path() -> Path:
    return Path(__file__).parent / "fixtures" / "ai" / "intents.json"
