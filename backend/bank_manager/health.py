"""Cached, coalesced dependency health (eps-demo-production-readiness).

States:
- healthy: the dependency was exercised and behaved exactly as expected.
- available: the dependency answered an authenticated no-inference probe.
- configured: settings exist but the dependency is not actively probed.
- degraded: reachable but throttling or partially unavailable.
- unreachable: network or DNS failure; no answer from the dependency.
- misconfigured: the dependency answered with an auth or not-found error.
"""

from __future__ import annotations

import asyncio
import time
from collections.abc import Callable
from dataclasses import dataclass
from typing import Any, Protocol

from agent_control_specification import AgentControl

from .bank.governance import evaluate_action, manager_snapshot
from .config import ModelOption

EXPECTED_DENIAL = "account_access_denied"


@dataclass(frozen=True)
class ProbeResult:
    name: str
    status: str
    detail: str
    critical: bool

    def public(self) -> dict[str, Any]:
        return {
            "name": self.name,
            "status": self.status,
            "detail": self.detail,
            "critical": self.critical,
        }


class Probe(Protocol):
    name: str
    critical: bool

    async def run(self) -> ProbeResult: ...


class PolicyEngineProbe:
    """Negative probe: an unassigned-account read must be denied with the exact reason."""

    name = "ACS policy engine"
    critical = True

    def __init__(self, control_factory: Callable[[], AgentControl]) -> None:
        self._control_factory = control_factory

    async def run(self) -> ProbeResult:
        try:
            snapshot = manager_snapshot(
                "M-101", restricted_mode=False, customer_approved=False, admin_mode=False
            )
            result = await evaluate_action(
                self._control_factory(),
                {"tool_name": "read_account", "args": {"account_id": "A-2001"}},
                snapshot,
            )
        except Exception:
            return ProbeResult(self.name, "misconfigured", "Policy engine failed to load.", True)
        if result["status"] == "deny" and result["reason"] == EXPECTED_DENIAL:
            return ProbeResult(
                self.name, "healthy", "Expected denial proven: unassigned account blocked.", True
            )
        return ProbeResult(self.name, "misconfigured", "Expected denial was not produced.", True)


class ModelDeploymentProbe:
    """No-inference readiness: an intentionally invalid request (empty messages).

    A 400 validation error proves DNS, private networking, Entra authorization,
    and deployment existence without running (or paying for) model inference.
    """

    critical = False

    def __init__(self, client: Any, option: ModelOption, *, critical: bool = False) -> None:
        self._client = client
        self._option = option
        self.name = f"Model deployment: {option.label}"
        self.critical = critical

    async def run(self) -> ProbeResult:
        return await asyncio.to_thread(self._probe)

    def _probe(self) -> ProbeResult:
        try:
            self._client.chat.completions.create(
                model=self._option.deployment, messages=[], max_tokens=1
            )
        except Exception as error:
            return self._classify(error)
        return ProbeResult(self.name, "available", "Deployment answered.", self.critical)

    def _classify(self, error: Exception) -> ProbeResult:
        status = getattr(error, "status_code", None)
        if status == 400:
            return ProbeResult(
                self.name,
                "available",
                "Authenticated and reachable; invalid probe rejected before inference.",
                self.critical,
            )
        if status == 429:
            return ProbeResult(self.name, "degraded", "Reachable but throttling.", self.critical)
        if status in {401, 403}:
            return ProbeResult(
                self.name, "misconfigured", "Identity is not authorized.", self.critical
            )
        if status == 404:
            return ProbeResult(self.name, "misconfigured", "Deployment not found.", self.critical)
        if status is None:
            return ProbeResult(self.name, "unreachable", "No response from Foundry.", self.critical)
        return ProbeResult(self.name, "degraded", f"Unexpected HTTP {status}.", self.critical)


class StaticProbe:
    def __init__(self, name: str, status: str, detail: str, *, critical: bool = False) -> None:
        self.name = name
        self.critical = critical
        self._result = ProbeResult(name, status, detail, critical)

    async def run(self) -> ProbeResult:
        return self._result


READY_STATES = {"healthy", "available", "configured"}


class HealthService:
    def __init__(
        self,
        probes: list[Probe],
        *,
        ttl_seconds: float,
        clock: Callable[[], float] = time.monotonic,
        wall_clock: Callable[[], float] = time.time,
    ) -> None:
        self._probes = probes
        self._ttl = ttl_seconds
        self._clock = clock
        self._wall_clock = wall_clock
        self._cached: dict[str, Any] | None = None
        self._cached_at = 0.0
        self._lock = asyncio.Lock()

    async def snapshot(self) -> dict[str, Any]:
        if self._fresh():
            return self._cached  # type: ignore[return-value]
        async with self._lock:
            if self._fresh():
                return self._cached  # type: ignore[return-value]
            self._cached = await self._collect()
            self._cached_at = self._clock()
            return self._cached

    def _fresh(self) -> bool:
        return self._cached is not None and self._clock() - self._cached_at < self._ttl

    async def _collect(self) -> dict[str, Any]:
        results = await asyncio.gather(*(_safe_run(probe) for probe in self._probes))
        ready = all(result.status in READY_STATES for result in results if result.critical)
        degraded = any(result.status not in READY_STATES for result in results)
        overall = "ready" if ready and not degraded else "degraded" if ready else "not_ready"
        return {
            "status": overall,
            "ready": ready,
            "checkedAt": self._wall_clock(),
            "cacheSeconds": self._ttl,
            "components": [result.public() for result in results],
        }


async def _safe_run(probe: Probe) -> ProbeResult:
    try:
        return await probe.run()
    except Exception:
        return ProbeResult(probe.name, "degraded", "Probe failed unexpectedly.", probe.critical)
