"""Foundry Evaluations for the governed bank assistant (eps-demo-evaluations).

What is graded: the whole governed system, not just the model. For every test
question the app runs the real pipeline once (the AI model picks a tool, then
the ACS policy checks it), and Microsoft Foundry grades the recorded answers
with deterministic checks and a judge model. Foundry stores every run, so the
web page and the Foundry portal show the same results.

Three identities take part (see infra/modules/evaluations-roles.bicep):
- this app's managed identity calls the project's evaluation API;
- the Foundry project's managed identity runs the graders and the judge model;
- the browser never gets a token. It only calls this app's /api/evaluations.

Never trust a run's "completed" status alone. A grader can fail to execute and
still be reported as completed, so each question is scored here from every
required grader result (see score_item).
"""

from __future__ import annotations

import asyncio
import hashlib
import hmac
import json
import logging
import re
import time
from collections import deque
from collections.abc import Awaitable, Callable, Mapping, Sequence
from dataclasses import dataclass
from datetime import UTC, datetime
from pathlib import Path
from typing import Any, Protocol

from agent_control_specification import AgentControl
from opentelemetry import trace

from .ai.cost import estimate_cost
from .ai.router import ContentFilteredError, IntentRouter, IntentRoutingError
from .bank.data import PERSONAS
from .bank.governance import manager_snapshot
from .comparison import run_baseline, run_governed
from .config import FoundryProject, IntentRoleConfig, ModelOption

LOGGER = logging.getLogger("bank_manager.evaluations")
tracer = trace.get_tracer("bank_manager.evaluations")

TOKEN_SCOPE = "https://ai.azure.com/.default"  # noqa: S105 - an OAuth scope, not a secret
EVAL_ID = re.compile(r"^eval_[0-9a-f]{32}$")
RUN_ID = re.compile(r"^evalrun_[0-9a-f]{32}$")
ROW_ID = re.compile(r"^[a-z0-9][a-z0-9-]{0,63}$")
ACTIVE_STATUSES = frozenset({"queued", "in_progress", "running"})
OUTCOMES = frozenset({"allowed", "approval_required", "denied", "no_action"})
TOOLS = frozenset(
    {
        "none",
        "read_account",
        "read_transaction_history",
        "prepare_transfer",
        "create_transfer",
        "freeze_account",
    }
)
MAX_TEXT = 600
CACHE_SECONDS = 15.0
ACTIVE_RUN_WINDOW_SECONDS = 2 * 3600
LIST_LAG_SECONDS = 120


class EvaluationError(Exception):
    """Base class. Messages are safe to show in the browser."""


class EvaluationUnavailable(EvaluationError):
    pass


class FoundryError(EvaluationError):
    def __init__(self, status: int) -> None:
        super().__init__("Microsoft Foundry did not answer as expected.")
        self.status = status


class RunNotFound(EvaluationError):
    pass


class RunConflict(EvaluationError):
    def __init__(self, run_id: str) -> None:
        super().__init__("An evaluation run is already in progress. Wait for it to finish.")
        self.run_id = run_id


class RunLimit(EvaluationError):
    def __init__(self, retry_after: int, message: str) -> None:
        super().__init__(message)
        self.retry_after = retry_after


class PresenterKeyError(EvaluationError):
    def __init__(self, code: str, message: str, retry_after: int | None = None) -> None:
        super().__init__(message)
        self.code = code
        self.retry_after = retry_after


# ---------------------------------------------------------------- suite config


@dataclass(frozen=True)
class Grader:
    name: str
    label: str
    description: str
    required: bool
    uses_judge_model: bool
    criterion: Mapping[str, Any]

    def public(self) -> dict[str, Any]:
        return {
            "name": self.name,
            "label": self.label,
            "description": self.description,
            "required": self.required,
            "usesJudgeModel": self.uses_judge_model,
            "type": str(self.criterion.get("type", "")),
        }


@dataclass(frozen=True)
class DatasetRow:
    id: str
    family: str
    query: str
    persona: str
    expected_tool: str
    expected_outcome: str
    expected_reason: str
    expected_masked_text: str
    expected_behavior: str
    restricted_mode: bool = False
    customer_approved: bool = False
    admin_mode: bool = False

    @property
    def settings_label(self) -> str:
        parts = [str(PERSONAS[self.persona]["label"])]
        if self.restricted_mode:
            parts.append("restricted mode on")
        if self.customer_approved:
            parts.append("customer approved")
        if self.admin_mode:
            parts.append("admin mode on")
        return "; ".join(parts)


@dataclass(frozen=True)
class EvaluationSuite:
    suite_name: str
    source: str
    system_label: str
    judge_model: str
    item_fields: tuple[str, ...]
    graders: tuple[Grader, ...]
    rows: tuple[DatasetRow, ...]
    max_runs_per_hour: int
    max_runs_per_day: int
    max_concurrent_answers: int
    judge_input_usd_per_million: float | None
    judge_output_usd_per_million: float | None

    @classmethod
    def load(cls, path: Path, repo_root: Path, intent_config: IntentRoleConfig) -> EvaluationSuite:
        raw = json.loads(path.read_text(encoding="utf-8"))
        judge = str(raw["judgeModel"])
        graders = tuple(
            Grader(
                name=str(item["name"]),
                label=str(item["label"]),
                description=str(item["description"]),
                required=bool(item["required"]),
                uses_judge_model=bool(item["usesJudgeModel"]),
                criterion=_with_judge(dict(item["criterion"]), judge),
            )
            for item in raw["graders"]
        )
        names = [grader.name for grader in graders]
        if len(set(names)) != len(names) or not any(g.required for g in graders):
            raise ValueError("Grader names must be unique and at least one must be required.")
        rows = tuple(load_dataset(repo_root / str(raw["dataset"])))
        pricing = next(
            (
                option.pricing
                for option in intent_config.options
                if judge in {option.deployment, option.key}
            ),
            None,
        )
        return cls(
            suite_name=str(raw["suiteName"]),
            source=str(raw["source"]),
            system_label=str(raw["systemLabel"]),
            judge_model=judge,
            item_fields=tuple(str(field) for field in raw["itemFields"]),
            graders=graders,
            rows=rows,
            max_runs_per_hour=int(raw["maxRunsPerHour"]),
            max_runs_per_day=int(raw["maxRunsPerDay"]),
            max_concurrent_answers=max(1, int(raw.get("maxConcurrentAnswers", 4))),
            judge_input_usd_per_million=pricing.input_per_1m if pricing else None,
            judge_output_usd_per_million=pricing.output_per_1m if pricing else None,
        )

    def grader(self, name: str) -> Grader | None:
        return next((grader for grader in self.graders if grader.name == name), None)

    def definition(self) -> dict[str, Any]:
        """Body for POST /evals. Foundry keeps it fixed, so changes need a new suite name."""
        return {
            "name": self.suite_name,
            "metadata": {"source": self.source, "system": self.system_label[:200]},
            "data_source_config": {
                "type": "custom",
                "include_sample_schema": False,
                "item_schema": {
                    "type": "object",
                    "properties": {field: {"type": "string"} for field in self.item_fields},
                    "required": ["id", "query"],
                },
            },
            "testing_criteria": [
                {"name": grader.name, **grader.criterion} for grader in self.graders
            ],
        }

    def public(self) -> dict[str, Any]:
        return {
            "name": self.suite_name,
            "system": self.system_label,
            "judgeModel": self.judge_model,
            "judgeInputUsdPerMillion": self.judge_input_usd_per_million,
            "judgeOutputUsdPerMillion": self.judge_output_usd_per_million,
            "items": len(self.rows),
            "graders": [grader.public() for grader in self.graders],
            "maxRunsPerHour": self.max_runs_per_hour,
            "maxRunsPerDay": self.max_runs_per_day,
        }


def _with_judge(criterion: dict[str, Any], judge: str) -> dict[str, Any]:
    return json.loads(json.dumps(criterion).replace("{judgeModel}", judge))


def load_dataset(path: Path) -> list[DatasetRow]:
    rows: list[DatasetRow] = []
    for number, line in enumerate(path.read_text(encoding="utf-8").splitlines(), start=1):
        if not line.strip():
            continue
        data = json.loads(line)
        row = DatasetRow(
            id=str(data["id"]),
            family=str(data["family"]),
            query=str(data["query"]),
            persona=str(data["persona"]),
            expected_tool=str(data["expected_tool"]),
            expected_outcome=str(data["expected_outcome"]),
            expected_reason=str(data["expected_reason"]),
            expected_masked_text=str(data.get("expected_masked_text", "")),
            expected_behavior=str(data["expected_behavior"]),
            restricted_mode=bool(data.get("restricted_mode", False)),
            customer_approved=bool(data.get("customer_approved", False)),
            admin_mode=bool(data.get("admin_mode", False)),
        )
        problems = []
        if not ROW_ID.fullmatch(row.id):
            problems.append("id")
        if row.persona not in PERSONAS:
            problems.append("persona")
        if row.expected_tool not in TOOLS:
            problems.append("expected_tool")
        if row.expected_outcome not in OUTCOMES:
            problems.append("expected_outcome")
        if problems:
            raise ValueError(f"{path.name} line {number}: bad {', '.join(problems)}")
        rows.append(row)
    if len({row.id for row in rows}) != len(rows):
        raise ValueError(f"{path.name}: row ids must be unique")
    return rows


# ------------------------------------------------------------ answer generation


def outcome_of(status: str) -> str:
    """The policy decision in plain words, as the dataset writes it."""
    return {
        "allow": "allowed",
        "transform": "allowed",
        "approval": "approval_required",
        "deny": "denied",
    }.get(status, "no_action")


@dataclass
class AnswerUsage:
    model: str = ""
    calls: int = 0
    input_tokens: int = 0
    output_tokens: int = 0
    cost_usd: float = 0.0


async def generate_answers(
    rows: Sequence[DatasetRow],
    *,
    router: IntentRouter,
    control: AgentControl,
    option: ModelOption,
    concurrency: int = 4,
) -> tuple[list[dict[str, str]], AnswerUsage]:
    """Run every question through the real pipeline: AI model, then both lanes."""
    gate = asyncio.Semaphore(concurrency)
    usage = AnswerUsage(model=option.deployment)

    async def answer(row: DatasetRow) -> dict[str, str]:
        async with gate:
            snapshot = manager_snapshot(
                row.persona,
                restricted_mode=row.restricted_mode,
                customer_approved=row.customer_approved,
                admin_mode=row.admin_mode,
            )
            model = option.deployment
            filtered = False
            try:
                routing = await asyncio.to_thread(router.route, row.query, option)
                action = routing.action
                selected = str(action["tool_name"]) if action else "none"
                model = routing.response_model or model
                usage.calls += 1
                if routing.usage:
                    usage.input_tokens += routing.usage.input_tokens
                    usage.output_tokens += routing.usage.output_tokens
                    usage.cost_usd += float(
                        estimate_cost(routing.usage, option.pricing, fake=routing.fake).get(
                            "totalUsd"
                        )
                        or 0.0
                    )
            except ContentFilteredError:
                # Azure AI content filtering stopped the request before the model answered.
                # That is a real safety layer, so the governed answer is a block.
                action = None
                selected = "blocked_by_content_filter"
                filtered = True
            except IntentRoutingError as error:
                action = None
                selected = f"model_error:{type(error).__name__}"
            baseline = run_baseline(action)
            governed: dict[str, Any] = {}
            if filtered:
                governed = {
                    "status": "deny",
                    "reason": "azure_content_filter",
                    "message": "Azure AI content filtering blocked this request.",
                }
            else:
                async for kind, payload in run_governed(control, row.query, action, snapshot):
                    if kind == "result":
                        governed = payload
            reply = governed.get("text") or governed.get("message") or ""
            return {
                "id": row.id,
                "family": row.family,
                "query": row.query,
                "persona": row.persona,
                "settings": row.settings_label,
                "expected_behavior": row.expected_behavior,
                "expected_tool": row.expected_tool,
                "selected_tool": selected,
                "expected_outcome": row.expected_outcome,
                "governed_outcome": outcome_of(str(governed.get("status", ""))),
                "governed_reason": str(governed.get("reason", "")),
                "expected_masked_text": row.expected_masked_text,
                "governed_reply": str(reply)[:MAX_TEXT],
                "no_rules_result": (
                    f"ran {baseline['action']['tool_name']}"
                    if baseline["toolExecuted"] and baseline.get("action")
                    else "no tool ran"
                ),
                "answer_model": str(model)[:80],
            }

    items = await asyncio.gather(*(answer(row) for row in rows))
    return list(items), usage


# -------------------------------------------------------------------- transport


class EvalsTransport(Protocol):
    def send(
        self, method: str, path: str, body: Mapping[str, Any] | None = None
    ) -> dict[str, Any]: ...


class FoundryEvalsHttpTransport:
    """Calls the Foundry project's evaluation API with a short-lived Entra ID token."""

    def __init__(
        self,
        project: FoundryProject,
        credential: Any,
        timeout: float = 30.0,
        client: Any | None = None,
    ) -> None:
        import httpx

        self._credential = credential
        self._client = client or httpx.Client(base_url=project.evaluations_api, timeout=timeout)

    def send(self, method: str, path: str, body: Mapping[str, Any] | None = None) -> dict[str, Any]:
        token = self._credential.get_token(TOKEN_SCOPE).token
        response = self._client.request(
            method,
            path,
            json=body,
            headers={"Authorization": f"Bearer {token}", "Accept": "application/json"},
        )
        if response.status_code == 404:
            raise RunNotFound("That evaluation run was not found.")
        if response.status_code >= 400:
            # The body can name identities or resources, so only the status is logged.
            LOGGER.warning("Foundry evaluations API returned HTTP %s", response.status_code)
            raise FoundryError(response.status_code)
        result: dict[str, Any] = response.json()
        return result


# ---------------------------------------------------------------- interpreting


def _clip(value: Any, limit: int = MAX_TEXT) -> str | None:
    if value is None:
        return None
    text = str(value).strip()
    return text[:limit] if text else None


def _number(value: Any) -> float | None:
    return float(value) if isinstance(value, int | float) and not isinstance(value, bool) else None


def _iso(seconds: Any) -> str | None:
    number = _number(seconds)
    if number is None:
        return None
    return datetime.fromtimestamp(number, UTC).isoformat().replace("+00:00", "Z")


def error_category(message: str | None) -> tuple[str, str]:
    """Turn a raw Foundry error into a category and a safe explanation.

    Raw messages can contain principal IDs and endpoints, so they never leave the server.
    """
    text = (message or "").lower()
    if any(
        word in text
        for word in (
            "permissiondenied",
            "401",
            "403",
            "lacks the required",
            "forbidden",
            "unauthorized",
        )
    ):
        return (
            "access_denied",
            "Foundry was not allowed to call a grader or the judge model. Check the roles for "
            "the app's and the Foundry project's managed identities (docs/evaluations/README.md).",
        )
    if "public access is disabled" in text or "virtual network" in text or "firewall" in text:
        return (
            "network_blocked",
            "A network rule stopped Foundry from reaching a resource it needs.",
        )
    if "429" in text or "rate limit" in text or "too many requests" in text:
        return ("rate_limited", "The judge model was busy. Try again in a few minutes.")
    if not text:
        return ("unknown", "No details were given.")
    return ("grader_error", "This grader could not run on this question.")


def _judge_reason(result: Mapping[str, Any]) -> str | None:
    """A label_model judge returns its steps as JSON in the sample output. Keep the conclusions."""
    sample = result.get("sample")
    if not isinstance(sample, Mapping):
        return None
    for message in sample.get("output") or []:
        if not isinstance(message, Mapping):
            continue
        try:
            parsed = json.loads(str(message.get("content", "")))
        except (TypeError, ValueError):
            continue
        if isinstance(parsed, Mapping) and isinstance(parsed.get("steps"), list):
            conclusions = [
                str(step.get("conclusion", "")).strip()
                for step in parsed["steps"]
                if isinstance(step, Mapping)
            ]
            text = " ".join(part for part in conclusions if part)
            return _clip(text, 500)
    return None


def grader_result(suite: EvaluationSuite, result: Mapping[str, Any]) -> dict[str, Any]:
    name = str(result.get("name", ""))
    grader = suite.grader(name)
    sample = result.get("sample") if isinstance(result.get("sample"), Mapping) else {}
    raw_error = sample.get("error") if isinstance(sample, Mapping) else None
    status = str(result.get("status", ""))
    passed = result.get("passed") if isinstance(result.get("passed"), bool) else None
    category = message = None
    # Foundry can report a grader that failed to run as "completed" with passed=false and a
    # nested sample.error. That is an error, not a failing grade.
    if raw_error or status not in {"completed", ""}:
        raw = raw_error.get("message") if isinstance(raw_error, Mapping) else raw_error
        category, message = error_category(str(raw or status))
        status = "error"
        passed = None
    return {
        "name": name[:80],
        "label": grader.label if grader else name[:80],
        "required": bool(grader and grader.required),
        "status": status or "completed",
        "passed": passed,
        "score": _number(result.get("score")),
        "threshold": _number(result.get("threshold")),
        "resultLabel": _clip(result.get("label"), 40),
        "reason": _clip(result.get("reason"), 500) or _judge_reason(result),
        "errorCategory": category,
        "errorMessage": message,
    }


# tour:begin evaluation-score
def score_item(suite: EvaluationSuite, results: Sequence[Mapping[str, Any]]) -> str:
    """passed: every required grader ran and passed. failed: any required grader failed.
    not_scored: no required grader failed, but at least one did not produce a grade."""
    by_name = {result["name"]: result for result in results}
    required = [grader.name for grader in suite.graders if grader.required]
    if any(by_name.get(name, {}).get("passed") is False for name in required):
        return "failed"
    if all(by_name.get(name, {}).get("passed") is True for name in required):
        return "passed"
    return "not_scored"


# tour:end evaluation-score


def portal_url(project: FoundryProject, run: Mapping[str, Any]) -> str:
    report = str(run.get("report_url") or "")
    if report.startswith("https://ai.azure.com/") and len(report) < 400 and " " not in report:
        return report
    return project.portal_evaluations_url


def run_summary(
    suite: EvaluationSuite,
    project: FoundryProject,
    evaluation: Mapping[str, Any],
    run: Mapping[str, Any],
) -> dict[str, Any]:
    metadata = run.get("metadata") if isinstance(run.get("metadata"), Mapping) else {}
    assert isinstance(metadata, Mapping)
    counts = run.get("result_counts") if isinstance(run.get("result_counts"), Mapping) else {}
    assert isinstance(counts, Mapping)
    per_grader = []
    for entry in run.get("per_testing_criteria_results") or []:
        if not isinstance(entry, Mapping):
            continue
        name = str(entry.get("testing_criteria", ""))[:80]
        grader = suite.grader(name)
        per_grader.append(
            {
                "name": name,
                "label": grader.label if grader else name,
                "required": bool(grader and grader.required),
                "passed": int(entry.get("passed") or 0),
                "failed": int(entry.get("failed") or 0),
                "errored": int(entry.get("errored") or 0),
            }
        )
    error = run.get("error") if isinstance(run.get("error"), Mapping) else None
    # Foundry returns an empty error object on healthy runs.
    if error and not (error.get("code") or error.get("message")):
        error = None
    category, message = (
        error_category(str(error.get("message") or error.get("code") or ""))
        if error
        else (None, None)
    )
    created = _number(run.get("created_at"))
    modified = _number(run.get("modified_at"))
    status = str(run.get("status", "unknown"))[:20]
    return {
        "evalId": str(evaluation.get("id", "")),
        "evalName": _clip(evaluation.get("name"), 80),
        "runId": str(run.get("id", "")),
        "name": _clip(run.get("name"), 80),
        "status": status,
        "active": status in ACTIVE_STATUSES,
        "createdAt": _iso(created),
        "durationSeconds": (
            round(modified - created, 1)
            if created and modified and status not in ACTIVE_STATUSES
            else None
        ),
        "startedFromSite": metadata.get("trigger") == "web",
        "appVersion": _clip(metadata.get("app_version"), 12),
        "answerModel": _clip(metadata.get("answer_model"), 80),
        "foundryCounts": {
            "total": int(counts.get("total") or 0),
            "passed": int(counts.get("passed") or 0),
            "failed": int(counts.get("failed") or 0),
            "errored": int(counts.get("errored") or 0),
        },
        "perGrader": per_grader,
        "portalUrl": portal_url(project, run),
        "errorCategory": category,
        "errorMessage": message,
    }


def run_usage(suite: EvaluationSuite, run: Mapping[str, Any]) -> dict[str, Any]:
    calls = prompt = completion = 0
    for entry in run.get("per_model_usage") or []:
        if not isinstance(entry, Mapping):
            continue
        # Foundry repeats built-in evaluator usage under "azure_ai_evaluation"; count models only.
        if not str(entry.get("model_name", "")).startswith(suite.judge_model):
            continue
        calls += int(entry.get("invocation_count") or 0)
        prompt += int(entry.get("prompt_tokens") or 0)
        completion += int(entry.get("completion_tokens") or 0)
    cost = None
    if suite.judge_input_usd_per_million is not None and suite.judge_output_usd_per_million:
        cost = round(
            (
                prompt * suite.judge_input_usd_per_million
                + completion * suite.judge_output_usd_per_million
            )
            / 1_000_000,
            6,
        )
    metadata = run.get("metadata") if isinstance(run.get("metadata"), Mapping) else {}
    assert isinstance(metadata, Mapping)

    def meta_number(key: str) -> float | None:
        try:
            return float(str(metadata.get(key)))
        except ValueError:
            return None

    return {
        "judgeModel": suite.judge_model,
        "judgeCalls": calls,
        "judgeInputTokens": prompt,
        "judgeOutputTokens": completion,
        "judgeCostUsd": cost,
        "answerModel": _clip(metadata.get("answer_model"), 80),
        "answerInputTokens": meta_number("answer_input_tokens"),
        "answerOutputTokens": meta_number("answer_output_tokens"),
        "answerCostUsd": meta_number("answer_cost_usd"),
    }


def output_item(suite: EvaluationSuite, element: Mapping[str, Any]) -> dict[str, Any]:
    data = element.get("datasource_item")
    data = data if isinstance(data, Mapping) else {}
    fields = {field: _clip(data.get(field)) for field in suite.item_fields}
    results = [
        grader_result(suite, result)
        for result in element.get("results") or []
        if isinstance(result, Mapping)
    ]
    order = {grader.name: index for index, grader in enumerate(suite.graders)}
    results.sort(key=lambda result: order.get(result["name"], len(order)))
    return {**fields, "verdict": score_item(suite, results), "results": results}


# ---------------------------------------------------------------------- service


class PresenterGate:
    """Starting a run costs money, so it needs the presenter key.

    Only the SHA-256 of the key is configured. Wrong guesses are limited per IP
    and overall, so the key cannot be guessed by brute force.
    """

    def __init__(
        self,
        key_sha256: str | None,
        *,
        per_ip_per_hour: int = 10,
        global_per_hour: int = 100,
        clock: Callable[[], float] = time.monotonic,
    ) -> None:
        self._hash = key_sha256
        self._per_ip = per_ip_per_hour
        self._global = global_per_hour
        self._clock = clock
        self._failures: dict[str, deque[float]] = {}
        self._all: deque[float] = deque()

    @property
    def configured(self) -> bool:
        return bool(self._hash)

    def check(self, key: str | None, ip: str) -> None:
        if not self._hash:
            raise PresenterKeyError(
                "presenter_not_configured",
                "Starting runs from the site is turned off for this deployment.",
            )
        now = self._clock()
        bucket = self._failures.setdefault(ip, deque())
        for queue in (bucket, self._all):
            while queue and now - queue[0] > 3600:
                queue.popleft()
        if len(bucket) >= self._per_ip or len(self._all) >= self._global:
            oldest = bucket[0] if len(bucket) >= self._per_ip else self._all[0]
            raise PresenterKeyError(
                "presenter_attempts_limited",
                "Too many wrong presenter keys. Try again later.",
                retry_after=max(60, int(3600 - (now - oldest))),
            )
        candidate = (key or "").strip()
        digest = hashlib.sha256(candidate.encode("utf-8")).hexdigest()
        if not candidate or len(candidate) > 256 or not hmac.compare_digest(digest, self._hash):
            bucket.append(now)
            self._all.append(now)
            if len(self._failures) > 5000:
                self._failures.clear()
            raise PresenterKeyError("presenter_required", "The presenter key is not correct.")


AnswerRunner = Callable[[], Awaitable[tuple[list[dict[str, str]], AnswerUsage]]]


class EvaluationService:
    def __init__(
        self,
        suite: EvaluationSuite,
        *,
        project: FoundryProject | None,
        transport: EvalsTransport | None,
        answers: AnswerRunner,
        presenter: PresenterGate,
        app_version: str = "unknown",
        recorded_example: Path | None = None,
        clock: Callable[[], float] = time.time,
    ) -> None:
        self.suite = suite
        self.project = project
        self._transport = transport
        self._answers = answers
        self.presenter = presenter
        self._app_version = app_version
        self._example = recorded_example
        self._clock = clock
        self._lock = asyncio.Lock()
        self._cache: tuple[float, dict[str, Any]] | None = None
        self._eval_id: str | None = None
        self._last_started: tuple[str, float] | None = None

    @property
    def live(self) -> bool:
        return self.project is not None and self._transport is not None

    async def _send(
        self, method: str, path: str, body: Mapping[str, Any] | None = None
    ) -> dict[str, Any]:
        assert self._transport is not None
        return await asyncio.to_thread(self._transport.send, method, path, body)

    def recorded_example(self) -> dict[str, Any] | None:
        if not self._example or not self._example.is_file():
            return None
        try:
            example: dict[str, Any] = json.loads(self._example.read_text(encoding="utf-8"))
        except ValueError:
            return None
        return example

    async def overview(self) -> dict[str, Any]:
        base = {
            "suite": self.suite.public(),
            "canStart": self.live and self.presenter.configured,
            "portalUrl": self.project.portal_evaluations_url if self.project else None,
            "project": f"{self.project.account}/{self.project.project}" if self.project else None,
        }
        if not self.live:
            return {
                **base,
                "available": False,
                "reason": "Live Foundry evaluations are turned off for this environment.",
                "runs": [],
                "example": self.recorded_example(),
                "refreshedAt": _iso(self._clock()),
            }
        now = self._clock()
        if self._cache and now - self._cache[0] < CACHE_SECONDS:
            return self._cache[1]
        with tracer.start_as_current_span("foundry.evaluation.list") as span:
            runs: list[dict[str, Any]] = []
            for evaluation in await self._suite_evals():
                listing = await self._send(
                    "GET", f"evals/{evaluation['id']}/runs?limit=20&order=desc"
                )
                for run in listing.get("data") or []:
                    if isinstance(run, Mapping) and RUN_ID.fullmatch(str(run.get("id", ""))):
                        assert self.project is not None
                        runs.append(run_summary(self.suite, self.project, evaluation, run))
            runs.sort(key=lambda run: run["createdAt"] or "", reverse=True)
            span.set_attribute("demo.evaluation.runs", len(runs))
        value = {
            **base,
            "available": True,
            "reason": None,
            "runs": runs[:20],
            "example": None,
            "refreshedAt": _iso(now),
        }
        self._cache = (now, value)
        return value

    async def _suite_evals(self) -> list[Mapping[str, Any]]:
        listing = await self._send("GET", "evals?limit=50&order=desc")
        found = []
        for evaluation in listing.get("data") or []:
            if not isinstance(evaluation, Mapping):
                continue
            metadata = evaluation.get("metadata")
            if (
                EVAL_ID.fullmatch(str(evaluation.get("id", "")))
                and isinstance(metadata, Mapping)
                and metadata.get("source") == self.suite.source
            ):
                found.append(evaluation)
        return found[:5]

    async def run_detail(self, eval_id: str, run_id: str) -> dict[str, Any]:
        if not EVAL_ID.fullmatch(eval_id) or not RUN_ID.fullmatch(run_id):
            raise ValueError("Valid evaluation and run IDs are required.")
        if not self.live:
            raise EvaluationUnavailable("Live Foundry evaluations are turned off.")
        assert self.project is not None
        with tracer.start_as_current_span("foundry.evaluation.get") as span:
            evaluation = await self._send("GET", f"evals/{eval_id}")
            metadata = evaluation.get("metadata")
            if not isinstance(metadata, Mapping) or metadata.get("source") != self.suite.source:
                raise RunNotFound("That run does not belong to this demo's evaluation suite.")
            run = await self._send("GET", f"evals/{eval_id}/runs/{run_id}")
            items: list[dict[str, Any]] = []
            after: str | None = None
            for _ in range(3):
                query = "limit=100" + (f"&after={after}" if after else "")
                page = await self._send(
                    "GET", f"evals/{eval_id}/runs/{run_id}/output_items?{query}"
                )
                items.extend(
                    output_item(self.suite, element)
                    for element in page.get("data") or []
                    if isinstance(element, Mapping)
                )
                after = str(page.get("last_id") or "")
                if not page.get("has_more") or not re.fullmatch(r"[\w-]{1,80}", after):
                    break
            span.set_attribute("demo.evaluation.items", len(items))
        verdicts = [item["verdict"] for item in items]
        return {
            "run": run_summary(self.suite, self.project, evaluation, run),
            "score": {
                "total": len(items),
                "passed": verdicts.count("passed"),
                "failed": verdicts.count("failed"),
                "notScored": verdicts.count("not_scored"),
            },
            "usage": run_usage(self.suite, run),
            "items": items,
        }

    async def start(self) -> dict[str, Any]:
        if not self.live:
            raise EvaluationUnavailable("Live Foundry evaluations are turned off.")
        assert self.project is not None
        if self._lock.locked():
            raise RunConflict("")
        async with self._lock:
            with tracer.start_as_current_span("foundry.evaluation.start") as span:
                evaluation = await self._ensure_suite()
                eval_id = str(evaluation["id"])
                self._check_limits(
                    await self._send("GET", f"evals/{eval_id}/runs?limit=50&order=desc")
                )
                items, usage = await self._answers()
                stamp = datetime.fromtimestamp(self._clock(), UTC)
                body = {
                    "name": "web-" + stamp.strftime("%Y%m%d-%H%M%S"),
                    "metadata": {
                        "source": self.suite.source,
                        "trigger": "web",
                        "app_version": self._app_version[:12],
                        "answer_model": usage.model[:80],
                        "answer_input_tokens": str(usage.input_tokens),
                        "answer_output_tokens": str(usage.output_tokens),
                        "answer_cost_usd": f"{usage.cost_usd:.6f}",
                        "items": str(len(items)),
                    },
                    "data_source": {
                        "type": "jsonl",
                        "source": {
                            "type": "file_content",
                            "content": [{"item": item} for item in items],
                        },
                    },
                }
                created = await self._send("POST", f"evals/{eval_id}/runs", body)
                self._cache = None
                if RUN_ID.fullmatch(str(created.get("id", ""))):
                    self._last_started = (str(created["id"]), self._clock())
                span.set_attribute("demo.evaluation.items", len(items))
                return run_summary(self.suite, self.project, evaluation, created)

    async def _ensure_suite(self) -> Mapping[str, Any]:
        if self._eval_id:
            try:
                return await self._send("GET", f"evals/{self._eval_id}")
            except RunNotFound:
                self._eval_id = None
        for evaluation in await self._suite_evals():
            if evaluation.get("name") == self.suite.suite_name:
                self._eval_id = str(evaluation["id"])
                return evaluation
        created = await self._send("POST", "evals", self.suite.definition())
        if not EVAL_ID.fullmatch(str(created.get("id", ""))):
            raise FoundryError(502)
        self._eval_id = str(created["id"])
        return created

    def _check_limits(self, listing: Mapping[str, Any]) -> None:
        now = self._clock()
        runs = [
            (
                str(run.get("id", "")),
                str(run.get("status", "")),
                _number(run.get("created_at")) or 0,
            )
            for run in listing.get("data") or []
            if isinstance(run, Mapping)
        ]
        for run_id, status, created in runs:
            if status in ACTIVE_STATUSES and now - created < ACTIVE_RUN_WINDOW_SECONDS:
                raise RunConflict(run_id)
        # Foundry's run list can lag a few seconds behind a new run. Until the run this
        # server just started appears as finished, treat it as still going.
        if self._last_started:
            started_id, started_at = self._last_started
            listed = {run_id: status for run_id, status, _ in runs}
            finished = listed.get(started_id) not in (None, *ACTIVE_STATUSES)
            if not finished and now - started_at < LIST_LAG_SECONDS:
                raise RunConflict(started_id)
        last_hour = sorted(created for _, _, created in runs if now - created < 3600)
        if len(last_hour) >= self.suite.max_runs_per_hour:
            retry = int(last_hour[0] + 3600 - now)
            raise RunLimit(
                max(60, retry),
                f"This site starts at most {self.suite.max_runs_per_hour} evaluation runs an hour.",
            )
        if sum(1 for _, _, created in runs if now - created < 86400) >= self.suite.max_runs_per_day:
            raise RunLimit(
                3600,
                f"This site starts at most {self.suite.max_runs_per_day} evaluation runs a day.",
            )
