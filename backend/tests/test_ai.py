from __future__ import annotations

import json
from types import SimpleNamespace

import pytest

from bank_manager.ai.cost import estimate_cost
from bank_manager.ai.router import (
    BankIntent,
    ContentFilteredError,
    FakeIntentRouter,
    IntentRoutingError,
    ModelRateLimitedError,
    OpenAIIntentRouter,
    Usage,
    action_from_intent,
    classify_model_error,
    usage_from_completion,
)
from bank_manager.config import REPO_ROOT, ConfigError, Settings, load_intent_config


def intent(**values):
    base = {
        "intent": "read_account",
        "account_id": None,
        "destination_account_id": None,
        "amount": None,
    }
    return BankIntent(**{**base, **values})


def test_normalizes_account_lookup():
    assert action_from_intent(intent(account_id="a-1001")) == {
        "tool_name": "read_account",
        "args": {"account_id": "A-1001"},
    }


def test_parses_transfer_amount_and_accounts():
    action = action_from_intent(
        intent(
            intent="prepare_transfer",
            account_id="A-1001",
            destination_account_id="A-2001",
            amount=12000,
        )
    )
    assert action == {
        "tool_name": "prepare_transfer",
        "args": {"account_id": "A-1001", "amount": 12000.0, "destination_account_id": "A-2001"},
    }


def test_rejects_model_invented_account_identifier():
    with pytest.raises(IntentRoutingError):
        action_from_intent(intent(account_id="Olivia"))


def test_rejects_negative_amount():
    with pytest.raises(IntentRoutingError):
        action_from_intent(intent(intent="create_transfer", account_id="A-1", amount=-5))


def test_unsupported_intent_returns_none():
    assert action_from_intent(intent(intent="unsupported")) is None


def test_fake_router_uses_recorded_fixtures(fixtures_path, intent_config):
    router = FakeIntentRouter.from_file(fixtures_path)
    result = router.route("Transfer $60,000 from A-1001 to A-2001", intent_config.default_option)
    assert result.fake is True
    assert result.action["args"]["amount"] == 60000.0
    assert result.response_model == "fake:gpt-4.1"


@pytest.mark.parametrize(
    ("prompt", "tool", "amount"),
    [
        ("please freeze A-1002", "freeze_account", None),
        ("draft a payment of 2k from A-1001 to A-1002", "prepare_transfer", 2000.0),
        ("send $50 from A-1001", "create_transfer", 50.0),
        ("history of A-2002", "read_transaction_history", None),
        ("what is the balance of A-1002", "read_account", None),
        ("tell me a joke", None, None),
        ("freeze everything", None, None),
    ],
)
def test_fake_router_rules_are_deterministic(intent_config, prompt, tool, amount):
    result = FakeIntentRouter().route(prompt, intent_config.default_option)
    if tool is None:
        assert result.action is None
    else:
        assert result.action["tool_name"] == tool
        assert result.action["args"].get("amount") == amount


def test_fake_router_missing_fixture_file_is_empty(tmp_path, intent_config):
    router = FakeIntentRouter.from_file(tmp_path / "missing.json")
    assert router.route("hello", intent_config.default_option).action is None


class FakeCompletions:
    def __init__(self, response=None, error=None):
        self.response = response
        self.error = error
        self.calls = []

    def parse(self, **kwargs):
        self.calls.append(kwargs)
        if self.error:
            raise self.error
        return self.response


def fake_client(completions):
    return SimpleNamespace(beta=SimpleNamespace(chat=SimpleNamespace(completions=completions)))


def completion(parsed, *, finish_reason="stop", refusal=None):
    usage = SimpleNamespace(
        prompt_tokens=300,
        completion_tokens=40,
        prompt_tokens_details=SimpleNamespace(cached_tokens=100),
        completion_tokens_details=SimpleNamespace(reasoning_tokens=0),
    )
    message = SimpleNamespace(parsed=parsed, refusal=refusal)
    return SimpleNamespace(
        model="gpt-4.1-2025-04-14",
        usage=usage,
        choices=[SimpleNamespace(message=message, finish_reason=finish_reason)],
    )


def test_openai_router_uses_config_prompts_and_reports_response_model(intent_config):
    completions = FakeCompletions(completion(intent(account_id="A-1001")))
    ticks = iter([1.0, 1.25])
    router = OpenAIIntentRouter(fake_client(completions), intent_config, clock=lambda: next(ticks))
    option = intent_config.option("gpt-4.1-mini")
    result = router.route("Show account A-1001", option)
    call = completions.calls[0]
    assert call["model"] == "gpt-4.1-mini"
    assert call["messages"][0]["content"] == intent_config.system_prompt
    assert "Show account A-1001" in call["messages"][1]["content"]
    assert result.response_model == "gpt-4.1-2025-04-14"
    assert result.usage == Usage(300, 100, 40, 0)
    assert result.duration_ms == 250


@pytest.mark.parametrize(
    ("response", "error_type"),
    [
        (completion(None, finish_reason="content_filter"), ContentFilteredError),
        (completion(None, refusal="no"), IntentRoutingError),
        (completion(None), IntentRoutingError),
    ],
)
def test_openai_router_rejects_unusable_responses(intent_config, response, error_type):
    router = OpenAIIntentRouter(fake_client(FakeCompletions(response)), intent_config)
    with pytest.raises(error_type):
        router.route("x", intent_config.default_option)


class ApiError(Exception):
    def __init__(self, status_code, code=None, body=None):
        super().__init__("api error")
        self.status_code = status_code
        self.code = code
        self.body = body


def test_openai_router_classifies_transport_errors(intent_config):
    router = OpenAIIntentRouter(fake_client(FakeCompletions(error=ApiError(429))), intent_config)
    with pytest.raises(ModelRateLimitedError):
        router.route("x", intent_config.default_option)


@pytest.mark.parametrize(
    ("error", "expected"),
    [
        (ApiError(400, code="content_filter"), ContentFilteredError),
        (
            ApiError(
                400, body={"code": "x", "innererror": {"code": "ResponsibleAIPolicyViolation"}}
            ),
            ContentFilteredError,
        ),
        (ApiError(429), ModelRateLimitedError),
        (ApiError(500), IntentRoutingError),
        (RuntimeError("boom"), IntentRoutingError),
    ],
)
def test_classify_model_error(error, expected):
    assert type(classify_model_error(error)) is expected


def test_usage_from_completion_handles_missing_usage():
    assert usage_from_completion(None) is None


def test_cost_bills_cached_input_at_cached_rate_and_never_double_counts_reasoning(intent_config):
    pricing = intent_config.option("gpt-4.1").pricing
    cost = estimate_cost(Usage(1_000_000, 400_000, 100_000, 50_000), pricing)
    assert cost["inputUsd"] == pytest.approx(1.2)
    assert cost["cachedInputUsd"] == pytest.approx(0.2)
    assert cost["outputUsd"] == pytest.approx(0.8)
    assert cost["totalUsd"] == pytest.approx(2.2)
    assert cost["confidence"] == "estimate"


def test_cost_marks_fake_and_unavailable(intent_config):
    pricing = intent_config.default_option.pricing
    assert estimate_cost(Usage(), pricing, fake=True)["confidence"] == "fake"
    assert estimate_cost(None, pricing)["confidence"] == "unavailable"


def test_config_rejects_unknown_default_duplicates_and_bad_documents(tmp_path):
    source = json.loads((REPO_ROOT / "config" / "models.json").read_text(encoding="utf-8"))
    (tmp_path / "config" / "prompts").mkdir(parents=True)
    for name in ("intent-router.system.md", "intent-router.user.md"):
        (tmp_path / "config" / "prompts" / name).write_text("{prompt}")
    source["roles"]["intent"]["defaultOption"] = "missing"
    path = tmp_path / "config" / "models.json"
    path.write_text(json.dumps(source))
    with pytest.raises(ConfigError):
        load_intent_config(path)
    source["roles"]["intent"]["defaultOption"] = "gpt-4.1"
    source["roles"]["intent"]["options"].append(source["roles"]["intent"]["options"][0])
    path.write_text(json.dumps(source))
    with pytest.raises(ConfigError):
        load_intent_config(path)
    path.write_text("{}")
    with pytest.raises(ConfigError):
        load_intent_config(path)


def test_config_is_the_only_source_of_model_names(intent_config):
    assert [option.key for option in intent_config.options] == ["gpt-4.1", "gpt-4.1-mini"]
    with pytest.raises(ConfigError):
        intent_config.option("gpt-5")


def test_settings_from_env_parses_flags():
    settings = Settings.from_env({"FAKE_AI": "true", "AZURE_AI_ENDPOINT": " https://x/ "})
    assert settings.fake_ai is True
    assert settings.foundry_endpoint == "https://x/"
    assert Settings.from_env({}).fake_ai is False
