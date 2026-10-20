from __future__ import annotations

import os
from pathlib import Path
from typing import Any

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field

from backend.analytics import explain_statistics
from backend.limiter import PolicyError, RateLimiter


DATABASE_PATH = os.getenv(
    "SENTINEL_DATABASE_PATH", str(Path(__file__).resolve().parent.parent / "data" / "sentinel.db")
)
limiter = RateLimiter(DATABASE_PATH)
app = FastAPI(title="SentinelAI API", version="1.0.0")
app.add_middleware(
    CORSMiddleware,
    allow_origins=os.getenv(
        "SENTINEL_CORS_ORIGINS",
        "http://localhost:4173,http://localhost:5173,http://localhost:5174,"
        "http://127.0.0.1:4173,http://127.0.0.1:5173,http://127.0.0.1:5174",
    ).split(","),
    allow_methods=["*"],
    allow_headers=["*"],
)


class PolicyInput(BaseModel):
    client_id: str = Field(min_length=1, max_length=100)
    capacity: int = Field(gt=0, le=100000)
    refill_rate: float = Field(gt=0, le=100000)
    enabled: bool = True


class RequestInput(BaseModel):
    client_id: str = Field(min_length=1, max_length=100)
    route: str = Field(default="/api/demo", max_length=200)


def validate_policy_input(data: PolicyInput) -> dict[str, Any]:
    try:
        return limiter.save_policy(
            data.client_id, data.capacity, data.refill_rate, data.enabled
        )
    except PolicyError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc


@app.get("/api/health")
def health() -> dict[str, str]:
    return {"status": "ok"}


@app.get("/api/policies")
def get_policies() -> list[dict[str, Any]]:
    return limiter.list_policies()


@app.get("/api/policies/{client_id}")
def get_policy(client_id: str) -> dict[str, Any]:
    policy = limiter.get_policy(client_id)
    if policy is None:
        raise HTTPException(status_code=404, detail="No policy exists for this client.")
    return policy


@app.post("/api/policies", status_code=201)
def create_policy(data: PolicyInput) -> dict[str, Any]:
    return validate_policy_input(data)


@app.put("/api/policies/{client_id}")
def update_policy(client_id: str, data: PolicyInput) -> dict[str, Any]:
    if client_id != data.client_id:
        raise HTTPException(status_code=422, detail="Path client_id must match the policy client_id.")
    return validate_policy_input(data)


@app.post("/api/requests/evaluate")
def evaluate_request(data: RequestInput) -> dict[str, Any]:
    try:
        return limiter.evaluate(data.client_id, data.route)
    except PolicyError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc


@app.get("/api/stats")
def get_statistics() -> dict[str, Any]:
    return limiter.statistics()


@app.post("/api/analytics")
def get_analytics() -> dict[str, Any]:
    try:
        return explain_statistics(limiter.statistics())
    except RuntimeError as exc:
        raise HTTPException(status_code=502, detail=str(exc)) from exc
