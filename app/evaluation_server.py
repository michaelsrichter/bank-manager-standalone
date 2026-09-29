from __future__ import annotations

import argparse
import asyncio
import json
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from typing import Any
from urllib.parse import urlparse

from bank_chat import HELP_TEXT, build_control, manager_snapshot
from bank_runtime import ExecutionMode, run_request
from foundry_intent import FoundryIntentRouter, IntentRoutingError

ROUTER = FoundryIntentRouter()
CONTROL = build_control()
SNAPSHOT = manager_snapshot(
    "Maya Chen",
    restricted_mode=False,
    customer_approved=False,
    admin_mode=False,
)


class EvaluationHandler(BaseHTTPRequestHandler):
    def do_GET(self) -> None:
        if urlparse(self.path).path != "/health":
            self._send_json(404, {"error": "not_found"})
            return
        self._send_json(200, {"status": "ready"})

    def do_POST(self) -> None:
        path = urlparse(self.path).path
        modes = {
            "/baseline": ExecutionMode.BASELINE,
            "/governed": ExecutionMode.GOVERNED,
        }
        mode = modes.get(path)
        if mode is None:
            self._send_json(404, {"error": "not_found"})
            return

        try:
            content_length = int(self.headers.get("Content-Length", "0"))
            payload = json.loads(self.rfile.read(content_length))
            message = payload["message"]
            if not isinstance(message, str) or not message.strip():
                raise ValueError("message must be a non-empty string")
            result = asyncio.run(
                run_request(
                    prompt=message,
                    snapshot=SNAPSHOT,
                    mode=mode,
                    router=ROUTER,
                    control=CONTROL if mode is ExecutionMode.GOVERNED else None,
                )
            )
        except (KeyError, TypeError, ValueError, json.JSONDecodeError) as error:
            self._send_json(400, {"error": str(error)})
            return
        except IntentRoutingError as error:
            self._send_json(502, {"error": str(error)})
            return
        except Exception as error:
            self.log_error("Evaluation request failed: %s", error)
            self._send_json(500, {"error": "evaluation_request_failed"})
            return

        self._send_json(
            200,
            {
                "response": _response_text(result),
                "events": _events(result),
            },
        )

    def log_message(self, format: str, *args: Any) -> None:
        print(f"{self.address_string()} - {format % args}")

    def _send_json(self, status: int, payload: dict[str, Any]) -> None:
        body = json.dumps(payload).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)


def _response_text(result: dict[str, Any]) -> str:
    value = result.get("value")
    if isinstance(value, dict) and isinstance(value.get("text"), str):
        response = value["text"]
    elif result["reason"] == "intent_not_recognized":
        response = HELP_TEXT
    else:
        response = result.get("message") or "The request was not completed."

    evidence = {
        "execution_mode": result["mode"],
        "selected_tool": (
            result["action"]["tool_name"] if result.get("action") else None
        ),
        "tool_arguments": (
            result["action"]["args"] if result.get("action") else None
        ),
        "policy_decision": result["policy_decision"],
        "policy_reason": result["reason"],
        "tool_executed": result["tool_executed"],
    }
    return f"{response}\n\nExecution evidence:\n{json.dumps(evidence, sort_keys=True)}"


def _events(result: dict[str, Any]) -> list[dict[str, Any]]:
    action = result.get("action")
    if action is None:
        return []

    tool_call_id = "bank-manager-tool-call"
    events = [
        {
            "role": "tool_call",
            "tool_name": action["tool_name"],
            "tool_args": action["args"],
            "tool_call_id": tool_call_id,
            "content": "",
        }
    ]
    events.append(
        {
            "role": "tool_result",
            "tool_name": action["tool_name"],
            "tool_args": action["args"],
            "tool_call_id": tool_call_id,
            "content": json.dumps(
                {
                    "policy_decision": result["policy_decision"],
                    "policy_reason": result["reason"],
                    "tool_executed": result["tool_executed"],
                    "value": result.get("value"),
                },
                sort_keys=True,
            ),
        }
    )
    return events


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--host", default="127.0.0.1")
    parser.add_argument("--port", default=8765, type=int)
    args = parser.parse_args()

    server = ThreadingHTTPServer((args.host, args.port), EvaluationHandler)
    print(f"Evaluation adapter listening on http://{args.host}:{args.port}")
    try:
        server.serve_forever()
    finally:
        server.server_close()
        ROUTER.close()


if __name__ == "__main__":
    main()
