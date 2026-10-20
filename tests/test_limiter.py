import time

import pytest

from backend.analytics import explain_statistics
from backend.limiter import PolicyError, RateLimiter


@pytest.fixture
def limiter(tmp_path):
    return RateLimiter(tmp_path / "test.db")


def test_unconfigured_clients_are_allowed_and_counted(limiter):
    result = limiter.evaluate("storefront", "/api/products", now=100)

    assert result["allowed"] is True
    assert result["reason"] == "unconfigured"
    assert limiter.statistics()["allowed"] == 1


def test_bucket_consumes_tokens_then_rejects(limiter):
    limiter.save_policy("storefront", capacity=2, refill_rate=1, now=100)

    assert limiter.evaluate("storefront", now=100)["tokens_remaining"] == 1
    assert limiter.evaluate("storefront", now=100)["tokens_remaining"] == 0
    rejected = limiter.evaluate("storefront", now=100)

    assert rejected["allowed"] is False
    assert rejected["reason"] == "bucket_empty"
    assert limiter.statistics()["rejected"] == 1


def test_bucket_refills_by_elapsed_time_and_caps_at_capacity(limiter):
    limiter.save_policy("storefront", capacity=3, refill_rate=0.5, now=100)
    limiter.evaluate("storefront", now=100)
    limiter.evaluate("storefront", now=100)
    limiter.evaluate("storefront", now=100)

    refilled = limiter.evaluate("storefront", now=104)
    assert refilled["allowed"] is True
    assert refilled["tokens_remaining"] == 1

    limiter.save_policy("storefront", capacity=3, refill_rate=0.5, now=200)
    assert limiter.get_policy("storefront")["tokens"] == 3


def test_one_token_refills_every_360_seconds(limiter):
    limiter.save_policy("storefront", capacity=5, refill_rate=1 / 360, now=100)
    for _ in range(5):
        assert limiter.evaluate("storefront", now=100)["allowed"] is True

    before_refill = limiter.evaluate("storefront", now=459)
    after_refill = limiter.evaluate("storefront", now=460)

    assert before_refill["allowed"] is False
    assert before_refill["tokens_remaining"] == pytest.approx(359 / 360)
    assert after_refill["allowed"] is True
    assert after_refill["tokens_remaining"] == pytest.approx(0)


def test_disabled_policy_allows_requests_and_persists_state(limiter, tmp_path):
    limiter.save_policy("storefront", capacity=1, refill_rate=1, enabled=False, now=100)

    assert limiter.evaluate("storefront", now=100)["reason"] == "policy_disabled"
    reopened = RateLimiter(tmp_path / "test.db")
    assert reopened.get_policy("storefront")["enabled"] is False
    assert reopened.statistics()["allowed"] == 1


@pytest.mark.parametrize(
    ("client_id", "capacity", "refill_rate"),
    [
        ("", 10, 1),
        ("shop", 0, 1),
        ("shop", 10, 0),
        ("shop", -1, 1),
        ("shop", 10, float("nan")),
    ],
)
def test_invalid_policy_values_are_rejected(limiter, client_id, capacity, refill_rate):
    with pytest.raises(PolicyError):
        limiter.save_policy(client_id, capacity, refill_rate)


def test_local_analytics_returns_advisory_recommendation(monkeypatch):
    monkeypatch.delenv("SENTINEL_AI_API_KEY", raising=False)
    result = explain_statistics(
        {
            "total_requests": 100,
            "allowed": 80,
            "rejected": 20,
            "requests_24h": 240,
            "active_policies": 2,
        }
    )

    assert result["source"] == "local"
    assert "20%" in result["explanation"]
    assert result["recommendation"]["capacity"] > 0
    assert result["recommendation"]["refill_rate"] > 0
    assert "advisory only" in result["disclaimer"]


def test_hourly_traffic_separates_allowed_and_rejected_requests(limiter):
    now = time.time()
    limiter.save_policy("storefront", capacity=1, refill_rate=1, now=now)
    limiter.evaluate("storefront", now=now)
    limiter.evaluate("storefront", now=now)

    statistics = limiter.statistics()

    assert statistics["allowed_24h"] == 1
    assert statistics["rejected_24h"] == 1
    assert any(
        hour["allowed"] == 1 and hour["rejected"] == 1
        for hour in statistics["traffic"]
    )
