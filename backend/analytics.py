from __future__ import annotations

import json
import os
import urllib.error
import urllib.request
from typing import Any


def explain_statistics(statistics: dict[str, Any]) -> dict[str, Any]:
    """Generate analytics from aggregates only; never participates in request decisions."""
    total = statistics["total_requests"]
    rejected = statistics["rejected"]
    rejection_rate = rejected / total if total else 0.0
    recommended_capacity = 20
    recommended_refill = 2.0
    if total:
        recommended_capacity = max(
            5, min(500, round(statistics["requests_24h"] / 24 * 1.5))
        )
        recommended_refill = max(
            0.5,
            min(50.0, round(statistics["requests_24h"] / 86400 * 1.25, 2)),
        )
    if not total:
        explanation = "There is not enough traffic yet. Send a few demo requests to build a useful baseline."
    elif rejection_rate >= 0.2:
        explanation = (
            f"{rejected:,} of {total:,} requests were rejected "
            f"({rejection_rate:.0%}). Consider a larger burst capacity or a faster refill."
        )
    elif rejection_rate > 0:
        explanation = (
            f"Traffic is mostly within limits, with {rejected:,} rejected request"
            f"{'s' if rejected != 1 else ''}. The current limits appear close to demand."
        )
    else:
        explanation = (
            f"All {total:,} recorded requests were allowed. Keep the current limits "
            "and observe a busier traffic window before tightening them."
        )

    result = {
        "source": "local",
        "explanation": explanation,
        "recommendation": {
            "capacity": recommended_capacity,
            "refill_rate": recommended_refill,
            "reason": "A conservative starting point based on recent request volume; validate before applying.",
        },
        "disclaimer": "Suggestions are advisory only. They never make real-time allow or deny decisions.",
    }
    api_key = os.getenv("SENTINEL_AI_API_KEY")
    if not api_key:
        return result

    endpoint = os.getenv("SENTINEL_AI_ENDPOINT", "https://api.openai.com/v1/chat/completions")
    model = os.getenv("SENTINEL_AI_MODEL", "gpt-4o-mini")
    payload = {
        "model": model,
        "temperature": 0.2,
        "messages": [
            {
                "role": "system",
                "content": (
                    "Analyze only these aggregate API request statistics. Return JSON with "
                    "keys explanation, recommendation (capacity positive integer, refill_rate "
                    "positive number, reason). Do not make real-time request decisions or "
                    "claim to change a policy. Keep advice conservative."
                ),
            },
            {
                "role": "user",
                "content": json.dumps(
                    {
                        "total_requests": total,
                        "allowed": statistics["allowed"],
                        "rejected": rejected,
                        "requests_24h": statistics["requests_24h"],
                        "active_policies": statistics["active_policies"],
                    }
                ),
            },
        ],
        "response_format": {"type": "json_object"},
    }
    request = urllib.request.Request(
        endpoint,
        data=json.dumps(payload).encode("utf-8"),
        headers={
            "Authorization": f"Bearer {api_key}",
            "Content-Type": "application/json",
        },
        method="POST",
    )
    try:
        with urllib.request.urlopen(request, timeout=12) as response:
            body = json.loads(response.read().decode("utf-8"))
        generated = json.loads(body["choices"][0]["message"]["content"])
        recommendation = generated["recommendation"]
        capacity = recommendation["capacity"]
        refill_rate = recommendation["refill_rate"]
        if (
            isinstance(capacity, bool)
            or not isinstance(capacity, int)
            or not 1 <= capacity <= 100000
            or isinstance(refill_rate, bool)
            or not isinstance(refill_rate, (int, float))
            or not 0 < refill_rate <= 100000
            or not isinstance(generated.get("explanation"), str)
        ):
            raise ValueError("AI response did not contain a valid recommendation.")
        result.update(
            {
                "source": "ai",
                "explanation": generated["explanation"][:1200],
                "recommendation": {
                    "capacity": capacity,
                    "refill_rate": float(refill_rate),
                    "reason": str(recommendation.get("reason", ""))[:500],
                },
            }
        )
    except (urllib.error.URLError, TimeoutError, KeyError, TypeError, ValueError, json.JSONDecodeError) as exc:
        raise RuntimeError(f"AI analytics request failed: {exc}") from exc
    return result
