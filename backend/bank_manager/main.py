from __future__ import annotations

import json
import logging
import re
import uuid
from collections.abc import AsyncIterator
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Literal

from agent_control_specification import AgentControl
from fastapi import FastAPI, Request
from fastapi.responses import FileResponse, JSONResponse, Response, StreamingResponse
from pydantic import BaseModel, ConfigDict, Field, ValidationError

from .ai.router import FakeIntentRouter, IntentRouter, OpenAIIntentRouter
from .bank.data import DEFAULT_PERSONA_ID, SCENARIOS, public_personas
from .bank.governance import UnknownPersonaError, build_control, manager_snapshot
from .bank.tools import UnsupportedToolError, validate_action
from .comparison import resolve_approval, stream_comparison
from .config import ConfigError, IntentRoleConfig, Settings, load_intent_config
from .health import HealthService, ModelDeploymentProbe, PolicyEngineProbe, Probe, StaticProbe
from .rate_limit import SlidingWindowLimiter
from .telemetry import EventSink, LoggingEventSink, configure_telemetry

LOGGER = logging.getLogger("bank_manager.api")
FIXTURES = Path(__file__).resolve().parents[1] / "tests" / "fixtures" / "ai" / "intents.json"
SESSION_PATTERN = re.compile(
    r"^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$"
)
PAGES = {"home", "demo", "health", "docs", "privacy", "terms"}

SECURITY_HEADERS = {
    "Content-Security-Policy": (
        "default-src 'self'; img-src 'self' data:; style-src 'self'; script-src 'self'; "
        "connect-src 'self'; font-src 'self'; frame-ancestors 'none'; base-uri 'none'; "
        "form-action 'self'"
    ),
    "X-Content-Type-Options": "nosniff",
    "Referrer-Policy": "strict-origin-when-cross-origin",
    "X-Frame-Options": "DENY",
    "Permissions-Policy": "camera=(), microphone=(), geolocation=()",
}


class PolicyState(BaseModel):
    model_config = ConfigDict(extra="forbid")

    restrictedMode: bool = False
    customerApproved: bool = False
    adminMode: bool = False


class CompareRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    prompt: str = Field(min_length=1, max_length=2000)
    personaId: str = Field(default=DEFAULT_PERSONA_ID, max_length=16)
    modelKey: str | None = Field(default=None, max_length=64)
    policyState: PolicyState = PolicyState()


class ToolAction(BaseModel):
    model_config = ConfigDict(extra="forbid")

    tool_name: str = Field(max_length=64)
    args: dict[str, Any]


class ApprovalRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    action: ToolAction
    personaId: str = Field(max_length=16)
    policyState: PolicyState = PolicyState()
    decision: Literal["approve", "reject"]


class PageViewRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    page: str = Field(max_length=32)


class ClientTimingRequest(BaseModel):
    """Browser-measured latency for one streamed comparison (analytics opt-in only)."""

    model_config = ConfigDict(extra="forbid")

    firstEventMs: int = Field(ge=0, le=600_000)
    totalMs: int = Field(ge=0, le=600_000)
    eventCount: int = Field(ge=0, le=1000)
    outcome: Literal["done", "error", "stalled", "rate_limited"]
    modelKey: str = Field(max_length=64)


@dataclass
class AppDependencies:
    settings: Settings
    intent_config: IntentRoleConfig
    router: IntentRouter
    control: AgentControl
    health: HealthService
    limiter: SlidingWindowLimiter
    sink: EventSink

    @classmethod
    def from_settings(cls, settings: Settings) -> AppDependencies:
        intent_config = load_intent_config(settings.models_path)
        control = build_control()
        probes: list[Probe] = [PolicyEngineProbe(lambda: control)]
        if settings.fake_ai:
            router: IntentRouter = FakeIntentRouter.from_file(FIXTURES)
            probes.append(
                StaticProbe(
                    "Model deployments",
                    "configured",
                    "FAKE_AI=1: deterministic fake router, no model calls.",
                )
            )
        else:
            from .ai.client import build_openai_client

            client = build_openai_client(settings, intent_config)
            router = OpenAIIntentRouter(client, intent_config)
            probes.extend(
                ModelDeploymentProbe(
                    client, option, critical=option.key == intent_config.default_key
                )
                for option in intent_config.options
            )
        probes.append(
            StaticProbe(
                "Application Insights",
                "configured" if settings.appinsights_configured else "degraded",
                "Telemetry exporter configured with managed identity."
                if settings.appinsights_configured
                else "No telemetry destination configured.",
            )
        )
        return cls(
            settings=settings,
            intent_config=intent_config,
            router=router,
            control=control,
            health=HealthService(probes, ttl_seconds=settings.health_cache_seconds),
            limiter=SlidingWindowLimiter(
                per_ip=settings.per_ip_requests_per_minute,
                per_session=settings.per_session_requests_per_minute,
            ),
            sink=LoggingEventSink(),
        )


def current_trace_id() -> str:
    try:
        from opentelemetry import trace

        context = trace.get_current_span().get_span_context()
        if context.is_valid:
            return format(context.trace_id, "032x")
    except ImportError:  # pragma: no cover - opentelemetry ships with azure-monitor
        pass
    return uuid.uuid4().hex


def client_ip(request: Request) -> str:
    forwarded = request.headers.get("x-forwarded-for", "")
    if forwarded:
        return forwarded.split(",")[0].strip()[:64]
    return request.client.host if request.client else "unknown"


def session_id(request: Request) -> str | None:
    value = request.headers.get("x-demo-session", "").strip().lower()
    return value if SESSION_PATTERN.fullmatch(value) else None


def request_body(model: type[BaseModel]) -> dict[str, Any]:
    schema = model.model_json_schema(ref_template="#/components/schemas/{model}")
    for name, definition in schema.pop("$defs", {}).items():
        REQUEST_SCHEMAS[name] = definition
    REQUEST_SCHEMAS[model.__name__] = schema
    ref = {"$ref": f"#/components/schemas/{model.__name__}"}
    return {"requestBody": {"required": True, "content": {"application/json": {"schema": ref}}}}


REQUEST_SCHEMAS: dict[str, Any] = {}


def problem(status: int, code: str, message: str, **headers: str) -> JSONResponse:
    return JSONResponse({"error": code, "message": message}, status_code=status, headers=headers)


def create_app(deps: AppDependencies | None = None) -> FastAPI:
    if deps is None:
        settings = Settings.from_env()
        configure_telemetry(settings.appinsights_configured, settings.azure_client_id)
        deps = AppDependencies.from_settings(settings)
    settings = deps.settings
    app = FastAPI(title="Bank Manager Governance Demo", docs_url=None, redoc_url=None)
    app.state.deps = deps

    @app.middleware("http")
    async def guard_requests(request: Request, call_next: Any) -> Response:
        if request.method == "POST":
            length = request.headers.get("content-length")
            if length is None:
                return problem(411, "length_required", "Content-Length is required.")
            if not length.isdigit() or int(length) > settings.max_request_bytes:
                return problem(413, "payload_too_large", "The request body is too large.")
        response: Response = await call_next(request)
        for header, value in SECURITY_HEADERS.items():
            response.headers.setdefault(header, value)
        return response

    def rate_limited(request: Request, route: str) -> JSONResponse | None:
        decision = deps.limiter.check(client_ip(request), session_id(request))
        if decision.allowed:
            return None
        deps.sink.emit("rate_limited", scope=decision.scope or "ip", route=route)
        return problem(
            429,
            "rate_limited",
            "Too many requests. Please wait a moment and try again.",
            **{"Retry-After": str(decision.retry_after_seconds)},
        )

    async def parse(request: Request, model: type[BaseModel]) -> BaseModel | JSONResponse:
        try:
            return model.model_validate(json.loads(await request.body()))
        except (ValidationError, json.JSONDecodeError, UnicodeDecodeError):
            return problem(400, "invalid_request", "The request body is not valid.")

    @app.get("/api/config")
    async def get_config() -> dict[str, Any]:
        return {
            "models": [option.public() for option in deps.intent_config.options],
            "defaultModel": deps.intent_config.default_key,
            "personas": public_personas(),
            "defaultPersona": DEFAULT_PERSONA_ID,
            "scenarios": list(SCENARIOS),
            "limits": {
                "maxPromptChars": settings.max_prompt_chars,
                "perSessionPerMinute": settings.per_session_requests_per_minute,
            },
            "fakeAi": settings.fake_ai,
            "repoUrl": settings.repo_url,
        }

    @app.post("/api/compare", openapi_extra=request_body(CompareRequest))
    async def compare(request: Request) -> Response:
        limited = rate_limited(request, "compare")
        if limited:
            return limited
        body = await parse(request, CompareRequest)
        if isinstance(body, JSONResponse):
            return body
        assert isinstance(body, CompareRequest)
        prompt = body.prompt.strip()
        if not prompt or len(prompt) > settings.max_prompt_chars:
            return problem(
                400,
                "invalid_prompt",
                f"Enter a request between 1 and {settings.max_prompt_chars} characters.",
            )
        try:
            option = deps.intent_config.option(body.modelKey)
            snapshot = manager_snapshot(
                body.personaId,
                restricted_mode=body.policyState.restrictedMode,
                customer_approved=body.policyState.customerApproved,
                admin_mode=body.policyState.adminMode,
            )
        except (ConfigError, UnknownPersonaError):
            return problem(400, "invalid_selection", "Unknown model or persona.")
        deps.sink.emit("model_selection", model_key=option.key, deployment=option.deployment)
        trace_id = current_trace_id()

        async def ndjson() -> AsyncIterator[bytes]:
            last_seq = 0
            try:
                async for event in stream_comparison(
                    prompt=prompt,
                    snapshot=snapshot,
                    option=option,
                    router=deps.router,
                    control=deps.control,
                    sink=deps.sink,
                    trace_id=trace_id,
                ):
                    last_seq = event["seq"]
                    yield (json.dumps(event) + "\n").encode("utf-8")
            except Exception:
                LOGGER.exception("Comparison stream failed (trace %s)", trace_id)
                failure = {
                    "seq": last_seq + 1,
                    "type": "error",
                    "code": "internal_error",
                    "message": "Something went wrong while running the comparison.",
                    "traceId": trace_id,
                }
                yield (json.dumps(failure) + "\n").encode("utf-8")

        return StreamingResponse(
            ndjson(),
            media_type="application/x-ndjson",
            headers={"Cache-Control": "no-store", "X-Accel-Buffering": "no"},
        )

    @app.post("/api/approval", openapi_extra=request_body(ApprovalRequest))
    async def approval(request: Request) -> Response:
        limited = rate_limited(request, "approval")
        if limited:
            return limited
        body = await parse(request, ApprovalRequest)
        if isinstance(body, JSONResponse):
            return body
        assert isinstance(body, ApprovalRequest)
        try:
            action = validate_action(body.action.model_dump())
            snapshot = manager_snapshot(
                body.personaId,
                restricted_mode=body.policyState.restrictedMode,
                customer_approved=body.policyState.customerApproved,
                admin_mode=body.policyState.adminMode,
            )
        except (UnsupportedToolError, UnknownPersonaError):
            return problem(400, "invalid_action", "The approval request is not valid.")
        result = await resolve_approval(
            deps.control, action, snapshot, approve=body.decision == "approve"
        )
        deps.sink.emit(
            "approval_decision",
            decision=body.decision,
            status=result["status"],
            reason=result["reason"],
            tool=action["tool_name"],
        )
        return JSONResponse(
            {"result": result, "traceId": current_trace_id()},
            headers={"Cache-Control": "no-store"},
        )

    @app.get("/api/health")
    async def health() -> JSONResponse:
        snapshot = await deps.health.snapshot()
        return JSONResponse(
            snapshot,
            status_code=200 if snapshot["ready"] else 503,
            headers={"Cache-Control": "no-store"},
        )

    @app.get("/api/health/live")
    async def live() -> dict[str, str]:
        return {"status": "ok"}

    @app.post(
        "/api/telemetry/page-view", status_code=204, openapi_extra=request_body(PageViewRequest)
    )
    async def page_view(request: Request) -> Response:
        body = await parse(request, PageViewRequest)
        if isinstance(body, JSONResponse):
            return body
        assert isinstance(body, PageViewRequest)
        if body.page in PAGES:
            deps.sink.emit("page_view", page=body.page)
        return Response(status_code=204)

    @app.post(
        "/api/telemetry/client-timing",
        status_code=204,
        openapi_extra=request_body(ClientTimingRequest),
    )
    async def client_timing(request: Request) -> Response:
        body = await parse(request, ClientTimingRequest)
        if isinstance(body, JSONResponse):
            return body
        assert isinstance(body, ClientTimingRequest)
        if body.modelKey in {option.key for option in deps.intent_config.options}:
            deps.sink.emit(
                "client_timing",
                first_event_ms=body.firstEventMs,
                total_ms=body.totalMs,
                outcome=body.outcome,
                model_key=body.modelKey,
                event_count=body.eventCount,
            )
        return Response(status_code=204)

    static_dir = settings.static_dir.resolve()

    @app.get("/{path:path}", include_in_schema=False)
    async def spa(path: str) -> Response:
        if path.startswith("api/"):
            return problem(404, "not_found", "Not found.")
        index = static_dir / "index.html"
        if not index.exists():
            return problem(404, "frontend_not_built", "Build the frontend first.")
        candidate = (static_dir / path).resolve()
        if path and candidate.is_file() and candidate.is_relative_to(static_dir):
            cache = (
                "public, max-age=31536000, immutable"
                if path.startswith("assets/")
                else "public, max-age=300"
            )
            return FileResponse(candidate, headers={"Cache-Control": cache})
        return FileResponse(index, headers={"Cache-Control": "no-cache"})

    original_openapi = app.openapi

    def openapi() -> dict[str, Any]:
        schema = original_openapi()
        schema.setdefault("components", {}).setdefault("schemas", {}).update(REQUEST_SCHEMAS)
        return schema

    app.openapi = openapi  # type: ignore[method-assign]
    return app


def app_factory() -> FastAPI:
    return create_app()
