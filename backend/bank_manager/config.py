from __future__ import annotations

import base64
import json
import os
import re
from collections.abc import Mapping
from dataclasses import dataclass
from pathlib import Path
from typing import Any

REPO_ROOT = Path(__file__).resolve().parents[2]


class ConfigError(ValueError):
    pass


@dataclass(frozen=True)
class Pricing:
    currency: str
    input_per_1m: float
    cached_input_per_1m: float
    output_per_1m: float
    source: str


@dataclass(frozen=True)
class ModelOption:
    key: str
    label: str
    deployment: str
    model: str
    pricing: Pricing

    def public(self) -> dict[str, Any]:
        return {
            "key": self.key,
            "label": self.label,
            "deployment": self.deployment,
            "model": self.model,
            "pricing": {
                "currency": self.pricing.currency,
                "inputPer1MTokens": self.pricing.input_per_1m,
                "cachedInputPer1MTokens": self.pricing.cached_input_per_1m,
                "outputPer1MTokens": self.pricing.output_per_1m,
                "source": self.pricing.source,
            },
        }


@dataclass(frozen=True)
class IntentRoleConfig:
    options: tuple[ModelOption, ...]
    default_key: str
    api_version: str
    token_scope: str
    temperature: float
    max_output_tokens: int
    request_timeout_seconds: float
    system_prompt: str
    user_template: str

    def option(self, key: str | None) -> ModelOption:
        wanted = key or self.default_key
        for option in self.options:
            if option.key == wanted:
                return option
        raise ConfigError(f"Unknown model option: {wanted!r}")

    @property
    def default_option(self) -> ModelOption:
        return self.option(self.default_key)


def load_intent_config(
    models_path: Path,
    *,
    root: Path | None = None,
) -> IntentRoleConfig:
    base = root or models_path.resolve().parents[1]
    try:
        document = json.loads(models_path.read_text(encoding="utf-8"))
        role = document["roles"]["intent"]
        options = tuple(_model_option(item) for item in role["options"])
        prompt = role["prompt"]
        config = IntentRoleConfig(
            options=options,
            default_key=str(role["defaultOption"]),
            api_version=str(role["apiVersion"]),
            token_scope=str(role["tokenScope"]),
            temperature=float(role["temperature"]),
            max_output_tokens=int(role["maxOutputTokens"]),
            request_timeout_seconds=float(role["requestTimeoutSeconds"]),
            system_prompt=(base / prompt["system"]).read_text(encoding="utf-8").strip(),
            user_template=(base / prompt["userTemplate"]).read_text(encoding="utf-8").strip(),
        )
    except (KeyError, TypeError, OSError, json.JSONDecodeError) as error:
        raise ConfigError(f"Invalid model configuration: {error}") from error

    if not options:
        raise ConfigError("At least one intent model option is required.")
    if len({option.key for option in options}) != len(options):
        raise ConfigError("Model option keys must be unique.")
    if "{prompt}" not in config.user_template:
        raise ConfigError("The user prompt template must contain {prompt}.")
    config.option(config.default_key)
    return config


def _model_option(item: Mapping[str, Any]) -> ModelOption:
    pricing = item["pricing"]
    return ModelOption(
        key=str(item["key"]),
        label=str(item["label"]),
        deployment=str(item["deployment"]),
        model=str(item["model"]),
        pricing=Pricing(
            currency=str(pricing["currency"]),
            input_per_1m=float(pricing["inputPer1MTokens"]),
            cached_input_per_1m=float(pricing["cachedInputPer1MTokens"]),
            output_per_1m=float(pricing["outputPer1MTokens"]),
            source=str(pricing["source"]),
        ),
    )


def _flag(value: str | None) -> bool:
    return (value or "").strip().lower() in {"1", "true", "yes", "on"}


@dataclass(frozen=True)
class Settings:
    fake_ai: bool
    foundry_endpoint: str | None
    azure_client_id: str | None
    models_path: Path
    static_dir: Path
    appinsights_configured: bool
    repo_url: str
    per_ip_requests_per_minute: int
    per_session_requests_per_minute: int
    max_request_bytes: int
    max_prompt_chars: int
    health_cache_seconds: float
    service_version: str = "unknown"
    environment: str = "local"
    observability: ObservabilityLinks | None = None
    foundry_project: FoundryProject | None = None
    presenter_key_sha256: str | None = None
    evaluations_config_path: Path = REPO_ROOT / "config" / "evaluations.json"

    @classmethod
    def from_env(cls, env: Mapping[str, str] | None = None) -> Settings:
        values = os.environ if env is None else env
        return cls(
            fake_ai=_flag(values.get("FAKE_AI")),
            foundry_endpoint=(values.get("AZURE_AI_ENDPOINT") or "").strip() or None,
            azure_client_id=(values.get("AZURE_CLIENT_ID") or "").strip() or None,
            models_path=Path(
                values.get("MODELS_CONFIG_PATH") or REPO_ROOT / "config" / "models.json"
            ),
            static_dir=Path(values.get("STATIC_DIR") or REPO_ROOT / "frontend" / "dist"),
            appinsights_configured=bool(values.get("APPLICATIONINSIGHTS_CONNECTION_STRING")),
            repo_url=values.get(
                "REPO_URL", "https://github.com/michaelsrichter/bank-manager-standalone"
            ),
            per_ip_requests_per_minute=int(values.get("RATE_LIMIT_PER_IP_PER_MINUTE", "20")),
            per_session_requests_per_minute=int(
                values.get("RATE_LIMIT_PER_SESSION_PER_MINUTE", "10")
            ),
            max_request_bytes=int(values.get("MAX_REQUEST_BYTES", "8192")),
            max_prompt_chars=int(values.get("MAX_PROMPT_CHARS", "500")),
            health_cache_seconds=float(values.get("HEALTH_CACHE_SECONDS", "60")),
            service_version=read_service_version(
                Path(values.get("BUILD_INFO_PATH") or DEFAULT_BUILD_INFO)
            ),
            environment=(values.get("DEPLOYMENT_ENVIRONMENT") or "local").strip()[:32],
            observability=ObservabilityLinks.from_env(values),
            foundry_project=FoundryProject.from_env(values),
            presenter_key_sha256=_sha256_hex(values.get("EVALUATIONS_PRESENTER_KEY_SHA256")),
            evaluations_config_path=Path(
                values.get("EVALUATIONS_CONFIG_PATH") or REPO_ROOT / "config" / "evaluations.json"
            ),
        )


DEFAULT_BUILD_INFO = REPO_ROOT / "frontend" / "src" / "generated" / "build-info.json"
_SHA = re.compile(r"^[0-9a-f]{7,40}$")


def read_service_version(path: Path) -> str:
    """The Git commit this build came from (written by frontend/scripts/build-info.mjs)."""
    try:
        sha = str(json.loads(path.read_text(encoding="utf-8")).get("sha", ""))
    except (OSError, ValueError, AttributeError):
        return "unknown"
    return sha[:7] if _SHA.fullmatch(sha) else "unknown"


_TENANT = re.compile(r"^[0-9a-f-]{36}$", re.IGNORECASE)
_RESOURCE = re.compile(
    r"^/subscriptions/[0-9a-f-]{36}/resourceGroups/[\w().-]{1,90}/providers/[\w.]+/[\w./-]+$",
    re.IGNORECASE,
)


@dataclass(frozen=True)
class ObservabilityLinks:
    """Where the app's "IDs and observability links" point (eps-demo-telemetry-links).

    These are resource identifiers from the deployment, not secrets. Opening them
    still needs Azure access (Monitoring Reader and Workbook Reader). They are read
    at runtime so one container image works in every environment.
    """

    portal_origin: str
    tenant_id: str
    app_insights_resource_id: str
    answer_review_workbook_id: str | None
    overview_workbook_id: str | None

    @classmethod
    def from_env(cls, values: Mapping[str, str]) -> ObservabilityLinks | None:
        tenant = (values.get("PORTAL_TENANT_ID") or "").strip()
        app_insights = (values.get("APPINSIGHTS_RESOURCE_ID") or "").strip()
        origin = (values.get("PORTAL_ORIGIN") or "https://portal.azure.com").strip()
        if not _TENANT.fullmatch(tenant) or not _RESOURCE.fullmatch(app_insights):
            return None
        if not origin.startswith("https://"):
            return None

        def optional(name: str) -> str | None:
            value = (values.get(name) or "").strip()
            return value if _RESOURCE.fullmatch(value) else None

        return cls(
            portal_origin=origin.rstrip("/"),
            tenant_id=tenant,
            app_insights_resource_id=app_insights,
            answer_review_workbook_id=optional("ANSWER_REVIEW_WORKBOOK_ID"),
            overview_workbook_id=optional("OVERVIEW_WORKBOOK_ID"),
        )

    def public(self) -> dict[str, str | None]:
        return {
            "portalOrigin": self.portal_origin,
            "tenantId": self.tenant_id,
            "appInsightsResourceId": self.app_insights_resource_id,
            "answerReviewWorkbookId": self.answer_review_workbook_id,
            "overviewWorkbookId": self.overview_workbook_id,
        }


_SHA256_HEX = re.compile(r"^[0-9a-f]{64}$")
_PROJECT_ENDPOINT = re.compile(
    r"^https://(?P<account>[a-z0-9][a-z0-9-]{1,62})\.services\.ai\.azure\.com"
    r"/api/projects/(?P<project>[A-Za-z0-9][A-Za-z0-9_-]{0,63})/?$"
)
_PROJECT_RESOURCE = re.compile(
    r"^/subscriptions/(?P<sub>[0-9a-f-]{36})/resourceGroups/(?P<rg>[\w().-]{1,90})"
    r"/providers/Microsoft\.CognitiveServices/accounts/(?P<account>[A-Za-z0-9-]{2,64})"
    r"/projects/(?P<project>[A-Za-z0-9_-]{1,64})$",
    re.IGNORECASE,
)


def _sha256_hex(value: str | None) -> str | None:
    """A presenter-key hash (64 lowercase hex characters). The key itself is never configured."""
    cleaned = (value or "").strip().lower()
    return cleaned if _SHA256_HEX.fullmatch(cleaned) else None


@dataclass(frozen=True)
class FoundryProject:
    """The Foundry project that stores evaluation runs (eps-demo-evaluations).

    Only set when EVALUATIONS_ENABLED=1 and both values are well formed. The
    endpoint must be a Foundry project endpoint, so a bad setting can never send
    the app's token to another host.
    """

    endpoint: str
    resource_id: str
    subscription_id: str
    resource_group: str
    account: str
    project: str

    @classmethod
    def from_env(cls, values: Mapping[str, str]) -> FoundryProject | None:
        if not _flag(values.get("EVALUATIONS_ENABLED")):
            return None
        endpoint = (values.get("FOUNDRY_PROJECT_ENDPOINT") or "").strip()
        resource_id = (values.get("FOUNDRY_PROJECT_RESOURCE_ID") or "").strip()
        endpoint_match = _PROJECT_ENDPOINT.fullmatch(endpoint)
        resource_match = _PROJECT_RESOURCE.fullmatch(resource_id)
        if not endpoint_match or not resource_match:
            return None
        if (
            endpoint_match["account"].lower() != resource_match["account"].lower()
            or endpoint_match["project"] != resource_match["project"]
        ):
            return None
        return cls(
            endpoint=endpoint.rstrip("/") + "/",
            resource_id=resource_id,
            subscription_id=resource_match["sub"],
            resource_group=resource_match["rg"],
            account=resource_match["account"],
            project=resource_match["project"],
        )

    @property
    def evaluations_api(self) -> str:
        return self.endpoint + "openai/v1/"

    @property
    def portal_evaluations_url(self) -> str:
        """The project's Build > Evaluations page in the Foundry portal.

        The portal encodes the subscription GUID as unpadded base64url of its 16 bytes,
        the same format Foundry uses in each run's report_url.
        """
        raw = bytes.fromhex(self.subscription_id.replace("-", ""))
        subscription = base64.urlsafe_b64encode(raw).decode("ascii").rstrip("=")
        return (
            f"https://ai.azure.com/nextgen/r/{subscription},{self.resource_group},,"
            f"{self.account},{self.project}/build/evaluations"
        )
