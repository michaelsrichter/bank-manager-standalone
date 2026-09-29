from __future__ import annotations

from typing import Any

from ..config import Pricing
from .router import Usage


def estimate_cost(usage: Usage | None, pricing: Pricing, *, fake: bool = False) -> dict[str, Any]:
    """Estimate one call's cost from public list prices in config/models.json.

    Reasoning tokens are already included in output tokens, so they are not
    billed a second time. Cached input tokens are billed at the cached rate.
    """
    if fake:
        return {"currency": pricing.currency, "totalUsd": 0.0, "confidence": "fake"}
    if usage is None:
        return {"currency": pricing.currency, "totalUsd": None, "confidence": "unavailable"}
    cached = min(usage.cached_input_tokens, usage.input_tokens)
    uncached = usage.input_tokens - cached
    input_cost = uncached * pricing.input_per_1m / 1_000_000
    cached_cost = cached * pricing.cached_input_per_1m / 1_000_000
    output_cost = usage.output_tokens * pricing.output_per_1m / 1_000_000
    return {
        "currency": pricing.currency,
        "inputUsd": round(input_cost, 8),
        "cachedInputUsd": round(cached_cost, 8),
        "outputUsd": round(output_cost, 8),
        "totalUsd": round(input_cost + cached_cost + output_cost, 8),
        "confidence": "estimate",
        "pricingSource": pricing.source,
    }
