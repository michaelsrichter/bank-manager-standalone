from __future__ import annotations

import threading
import time
from collections import deque
from collections.abc import Callable
from dataclasses import dataclass


@dataclass(frozen=True)
class RateDecision:
    allowed: bool
    scope: str | None = None
    retry_after_seconds: int = 0


class SlidingWindowLimiter:
    """In-memory per-key sliding window. One bucket set per replica.

    Container Apps runs at most two replicas, so the effective public ceiling is
    at most twice the configured value; see docs/security/rate-limiting.md.
    """

    def __init__(
        self,
        *,
        per_ip: int,
        per_session: int,
        window_seconds: float = 60.0,
        max_keys: int = 10_000,
        clock: Callable[[], float] = time.monotonic,
    ) -> None:
        self._limits = {"ip": per_ip, "session": per_session}
        self._window = window_seconds
        self._max_keys = max_keys
        self._clock = clock
        self._hits: dict[str, deque[float]] = {}
        self._lock = threading.Lock()

    def check(self, ip: str, session: str | None) -> RateDecision:
        now = self._clock()
        keys = [("ip", f"ip:{ip}")]
        if session:
            keys.append(("session", f"session:{session}"))
        with self._lock:
            self._evict(now)
            for scope, key in keys:
                bucket = self._hits.get(key)
                if bucket is not None:
                    self._trim(bucket, now)
                    if len(bucket) >= self._limits[scope]:
                        retry = int(self._window - (now - bucket[0])) + 1
                        return RateDecision(False, scope, max(retry, 1))
            for _, key in keys:
                self._hits.setdefault(key, deque()).append(now)
        return RateDecision(True)

    def _trim(self, bucket: deque[float], now: float) -> None:
        while bucket and now - bucket[0] >= self._window:
            bucket.popleft()

    def _evict(self, now: float) -> None:
        if len(self._hits) < self._max_keys:
            return
        for key in list(self._hits):
            bucket = self._hits[key]
            self._trim(bucket, now)
            if not bucket:
                del self._hits[key]
        if len(self._hits) >= self._max_keys:
            self._hits.clear()
