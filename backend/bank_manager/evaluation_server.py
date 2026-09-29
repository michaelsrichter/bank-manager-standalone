"""Local ASSERT evaluation adapter (operator-only; never deployed publicly).

Exposes POST /baseline and POST /governed on 127.0.0.1 so the offline ASSERT
suite in evals/assert/ can compare the ungoverned and ACS-governed lanes with the
same fixed persona. Honors FAKE_AI=1 for a free, deterministic dry run.
"""

from __future__ import annotations

import argparse
import asyncio
import json
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from typing import Any
from urllib.parse import urlparse

from .ai.router import FakeIntentRouter, IntentRouter, IntentRoutingError, OpenAIIntentRouter
from .bank.data import HELP_TEXT
from .bank.governance import build_control, manager_snapshot
from .comparison import run_baseline, run_governed
from .config import Settings, load_intent_config
from .main import FIXTURES

SETTINGS = Settings.from_env()
CONFIG = load_intent_config(SETTINGS.models_path)
CONTROL = build_control()
SNAPSHOT = manager_snapshot(
    "M-101", restricted_mode=False, customer_approved=False, admin_mode=False
)


def build_router() -> IntentRouter:
    if SETTINGS.fake_ai:
        return FakeIntentRouter.from_file(FIXTURES)
    from .ai.client import build_openai_client

    return OpenAIIntentRouter(build_openai_client(SETTINGS, CONFIG), CONFIG)


ROUTER = build_router()


async def evaluate(mode: str, message: str) -> dict[str, Any]:
    action = ROUTER.route(message, CONFIG.default_option).action
    if mode == "baseline":
        return run_baseline(action)
    result: dict[str, Any] = {}
    async for kind, payload in run_governed(CONTROL, message, action, SNAPSHOT):
        if kind == "result":
            result = payload
    return result


class EvaluationHandler(BaseHTTPRequestHandler):
    def do_GET(self) -> None:  # noqa: N802
        if urlparse(self.path).path != "/health":
            self._send(404, {"error": "not_found"})
            return
        self._send(200, {"status": "ready"})

    def do_POST(self) -> None:  # noqa: N802
        mode = urlparse(self.path).path.strip("/")
        if mode not in {"baseline", "governed"}:
            self._send(404, {"error": "not_found"})
            return
        try:
            length = min(int(self.headers.get("Content-Length", "0")), 16_384)
            message = json.loads(self.rfile.read(length))["message"]
            if not isinstance(message, str) or not message.strip():
                raise ValueError("message must be a non-empty string")
            result = asyncio.run(evaluate(mode, message))
        except (KeyError, TypeError, ValueError, json.JSONDecodeError) as error:
            self._send(400, {"error": str(error)})
            return
        except IntentRoutingError as error:
            self._send(502, {"error": str(error)})
            return
        self._send(200, {"response": response_text(result), "events": events(result)})

    def _send(self, status: int, payload: dict[str, Any]) -> None:
        body = json.dumps(payload).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)


def response_text(result: dict[str, Any]) -> str:
    if result.get("text"):
        response = result["text"]
    elif result.get("reason") == "intent_not_recognized":
        response = HELP_TEXT
    else:
        response = result.get("message") or "The request was not completed."
    action = result.get("action") or {}
    evidence = {
        "execution_mode": result.get("lane"),
        "selected_tool": action.get("tool_name"),
        "tool_arguments": action.get("args"),
        "policy_decision": result.get("policyDecision"),
        "policy_reason": result.get("reason"),
        "tool_executed": result.get("toolExecuted"),
    }
    return f"{response}\n\nExecution evidence:\n{json.dumps(evidence, sort_keys=True)}"


def events(result: dict[str, Any]) -> list[dict[str, Any]]:
    action = result.get("action")
    if not action:
        return []
    call_id = "bank-manager-tool-call"
    return [
        {
            "role": "tool_call",
            "tool_name": action["tool_name"],
            "tool_args": action["args"],
            "tool_call_id": call_id,
            "content": "",
        },
        {
            "role": "tool_result",
            "tool_name": action["tool_name"],
            "tool_args": action["args"],
            "tool_call_id": call_id,
            "content": json.dumps(
                {
                    "policy_decision": result.get("policyDecision"),
                    "policy_reason": result.get("reason"),
                    "tool_executed": result.get("toolExecuted"),
                    "text": result.get("text"),
                },
                sort_keys=True,
            ),
        },
    ]


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--port", default=8765, type=int)
    args = parser.parse_args()
    server = ThreadingHTTPServer(("127.0.0.1", args.port), EvaluationHandler)
    print(f"Evaluation adapter listening on http://127.0.0.1:{args.port}")
    try:
        server.serve_forever()
    finally:
        server.server_close()


if __name__ == "__main__":
    main()
