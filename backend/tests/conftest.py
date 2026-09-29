from __future__ import annotations

import os
from pathlib import Path

import pytest

os.environ.setdefault("FAKE_AI", "1")

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
