"""Reference: a small client for Microsoft Foundry Evaluations (eps-demo-evaluations).

Copy and adapt. It shows the parts that are easy to get wrong:
- find or create the suite by name AND metadata.source;
- start a run with app-produced answers (jsonl) or a hosted-agent target;
- enforce one-run-at-a-time and hourly/daily limits from Foundry's own history;
- score each question from every REQUIRED grader, treating sample.error as an error;
- turn raw Foundry errors into safe categories;
- count judge-model tokens once.

The transport is injected, so tests never call Foundry. In the app, the API owns
this client; the browser only calls the app's /api/evaluations routes.
"""

from __future__ import annotations

import json
import re
import time
from collections.abc import Callable, Mapping, Sequence
from dataclasses import dataclass
from typing import Any, Protocol

TOKEN_SCOPE = "https://ai.azure.com/.default"  # noqa: S105 - an OAuth scope, not a secret
EVAL_ID = re.compile(r"^eval_[0-9a-f]{32}$")
RUN_ID = re.compile(r"^evalrun_[0-9a-f]{32}$")
PROJECT_ENDPOINT = re.compile(
    r"^https://[a-z0-9][a-z0-9-]{1,62}\.services\.ai\.azure\.com/api/projects/[A-Za-z0-9][\w-]{0,63}/?$"
)
ACTIVE = {"queued", "in_progress", "running"}
STUCK_AFTER_SECONDS = 2 * 3600


class Transport(Protocol):
    def send(
        self, method: str, path: str, body: Mapping[str, Any] | None = None
    ) -> dict[str, Any]: ...


class HttpTransport:
    """Calls <project endpoint>/openai/v1/<path> with a short-lived Entra ID token."""

    def __init__(self, project_endpoint: str, credential: Any) -> None:
        import httpx  # any HTTP client works

        if not PROJECT_ENDPOINT.fullmatch(project_endpoint):
            raise ValueError("Not a Foundry project endpoint.")  # never send the token elsewhere
        self._credential = credential  # e.g. DefaultAzureCredential(managed_identity_client_id=...)
        self._client = httpx.Client(
            base_url=project_endpoint.rstrip("/") + "/openai/v1/", timeout=30
        )

    def send(self, method: str, path: str, body: Mapping[str, Any] | None = None) -> dict[str, Any]:
        token = self._credential.get_token(TOKEN_SCOPE).token
        response = self._client.request(
            method, path, json=body, headers={"Authorization": f"Bearer {token}"}
        )
        if response.status_code >= 400:
            # The body can name principals and endpoints: log the status only.
            raise RuntimeError(f"Foundry evaluations API returned HTTP {response.status_code}")
        return response.json()


@dataclass(frozen=True)
class Grader:
    name: str
    required: bool
    criterion: Mapping[str, Any]  # the Foundry testing criterion, without "name"


@dataclass(frozen=True)
class Suite:
    name: str  # bump to ...-v2 when graders or item fields change
    source: str  # a value only this demo uses, e.g. "<demo>-web"
    item_fields: Sequence[str]
    graders: Sequence[Grader]

    def definition(self) -> dict[str, Any]:
        return {
            "name": self.name,
            "metadata": {"source": self.source},
            "data_source_config": {
                "type": "custom",
                # True when Foundry produces the answers (agent or model target) and
                # graders read {{sample.output_text}} or {{sample.output_items}}.
                "include_sample_schema": False,
                "item_schema": {
                    "type": "object",
                    "properties": {field: {"type": "string"} for field in self.item_fields},
                    "required": ["id", "query"],
                },
            },
            "testing_criteria": [{"name": g.name, **g.criterion} for g in self.graders],
        }


def find_or_create_suite(transport: Transport, suite: Suite) -> dict[str, Any]:
    for evaluation in transport.send("GET", "evals?limit=50&order=desc").get("data", []):
        metadata = evaluation.get("metadata") or {}
        if evaluation.get("name") == suite.name and metadata.get("source") == suite.source:
            return evaluation
    return transport.send("POST", "evals", suite.definition())


def check_limits(
    runs: Sequence[Mapping[str, Any]], *, per_hour: int, per_day: int, now: float
) -> None:
    """Raise when a run is still going or a limit is reached. Counts come from Foundry, so
    they hold across restarts and replicas. Old 'running' runs are ignored so they cannot
    block forever."""
    for run in runs:
        if (
            run.get("status") in ACTIVE
            and now - float(run.get("created_at", 0)) < STUCK_AFTER_SECONDS
        ):
            raise RuntimeError(f"run_in_progress:{run.get('id')}")
    if sum(now - float(run.get("created_at", 0)) < 3600 for run in runs) >= per_hour:
        raise RuntimeError("run_limit_reached:hour")
    if sum(now - float(run.get("created_at", 0)) < 86400 for run in runs) >= per_day:
        raise RuntimeError("run_limit_reached:day")


def jsonl_run(
    items: Sequence[Mapping[str, str]], *, source: str, app_version: str
) -> dict[str, Any]:
    """The app produced the answers (model + its own policy/tools). Foundry only grades them."""
    stamp = time.strftime("%Y%m%d-%H%M%S", time.gmtime())
    return {
        "name": f"web-{stamp}",
        "metadata": {"source": source, "trigger": "web", "app_version": app_version[:12]},
        "data_source": {
            "type": "jsonl",
            "source": {"type": "file_content", "content": [{"item": dict(item)} for item in items]},
        },
    }


def agent_run(
    items: Sequence[Mapping[str, str]], *, source: str, agent_name: str
) -> dict[str, Any]:
    """Foundry calls a hosted agent for each question (the ELK Burgers pattern)."""
    stamp = time.strftime("%Y%m%d-%H%M%S", time.gmtime())
    return {
        "name": f"web-{stamp}",
        "metadata": {"source": source, "trigger": "web", "agent": agent_name},
        "data_source": {
            "type": "azure_ai_target_completions",
            "source": {"type": "file_content", "content": [{"item": dict(item)} for item in items]},
            "input_messages": {
                "type": "template",
                "template": [
                    {
                        "type": "message",
                        "role": "user",
                        "content": {"type": "input_text", "text": "{{item.query}}"},
                    }
                ],
            },
            "target": {"type": "azure_ai_agent", "name": agent_name},
        },
    }


def start_run(
    transport: Transport,
    suite: Suite,
    produce_items: Callable[[], Sequence[Mapping[str, str]]],
    *,
    per_hour: int = 3,
    per_day: int = 10,
    app_version: str = "unknown",
) -> dict[str, Any]:
    evaluation = find_or_create_suite(transport, suite)
    eval_id = str(evaluation["id"])
    if not EVAL_ID.fullmatch(eval_id):
        raise RuntimeError("Foundry returned an unexpected eval ID.")
    history = transport.send("GET", f"evals/{eval_id}/runs?limit=50&order=desc").get("data", [])
    check_limits(history, per_hour=per_hour, per_day=per_day, now=time.time())
    items = produce_items()  # only after the limits pass: producing answers costs money
    return transport.send(
        "POST",
        f"evals/{eval_id}/runs",
        jsonl_run(items, source=suite.source, app_version=app_version),
    )


def error_category(message: str | None) -> str:
    """Raw messages can contain principal IDs, endpoints, and prompts. Show a category instead."""
    text = (message or "").lower()
    if "unauthorizeduseraction" in text:
        return "network_blocked"  # looks like RBAC, but in testing it was the account's network
    if any(word in text for word in ("permissiondenied", "401", "403", "lacks the required")):
        return "access_denied"  # check the roles of the app AND the project identity
    if "public access is disabled" in text or "virtual network" in text or "firewall" in text:
        return "network_blocked"
    if "429" in text or "rate limit" in text:
        return "rate_limited"
    return "grader_error" if text else "unknown"


def grade(result: Mapping[str, Any]) -> dict[str, Any]:
    """One grader's result. A grader that could not run can still say status 'completed' with
    passed=false; the nested sample.error is what tells you it never graded the answer."""
    sample = result.get("sample") if isinstance(result.get("sample"), Mapping) else {}
    error = sample.get("error") if isinstance(sample, Mapping) else None
    if error or result.get("status") not in ("completed", None):
        raw = error.get("message") if isinstance(error, Mapping) else error
        return {"name": result.get("name"), "passed": None, "error": error_category(str(raw or ""))}
    reason = result.get("reason")
    if not reason and isinstance(sample, Mapping):  # label_model keeps its reasoning here
        for message in sample.get("output") or []:
            try:
                steps = json.loads(str(message.get("content", ""))).get("steps", [])
                reason = " ".join(str(step.get("conclusion", "")) for step in steps).strip() or None
            except (ValueError, AttributeError):
                continue
    passed = result.get("passed")
    return {
        "name": result.get("name"),
        "passed": passed if isinstance(passed, bool) else None,
        "score": result.get("score"),
        "reason": reason,
        "error": None,
    }


def score_question(grades: Sequence[Mapping[str, Any]], required: Sequence[str]) -> str:
    """passed: every required grader graded and passed. failed: a required grader failed it.
    not_scored: nothing failed, but at least one required grade is missing or errored."""
    by_name = {g["name"]: g for g in grades}
    if any(by_name.get(name, {}).get("passed") is False for name in required):
        return "failed"
    if all(by_name.get(name, {}).get("passed") is True for name in required):
        return "passed"
    return "not_scored"


def judge_usage(run: Mapping[str, Any], judge_model: str) -> tuple[int, int, int]:
    """(calls, input tokens, output tokens) for the judge. Foundry repeats built-in grader usage
    under 'azure_ai_evaluation', so count model entries only."""
    calls = prompt = completion = 0
    for entry in run.get("per_model_usage") or []:
        if str(entry.get("model_name", "")).startswith(judge_model):
            calls += int(entry.get("invocation_count") or 0)
            prompt += int(entry.get("prompt_tokens") or 0)
            completion += int(entry.get("completion_tokens") or 0)
    return calls, prompt, completion


def output_items(
    transport: Transport, eval_id: str, run_id: str, pages: int = 3
) -> list[dict[str, Any]]:
    if not EVAL_ID.fullmatch(eval_id) or not RUN_ID.fullmatch(run_id):
        raise ValueError("Valid evaluation and run IDs are required.")
    items: list[dict[str, Any]] = []
    after = ""
    for _ in range(pages):
        query = "limit=100" + (f"&after={after}" if after else "")
        page = transport.send("GET", f"evals/{eval_id}/runs/{run_id}/output_items?{query}")
        items.extend(page.get("data", []))
        after = str(page.get("last_id") or "")
        if not page.get("has_more") or not re.fullmatch(r"[\w-]{1,80}", after):
            break
    return items
