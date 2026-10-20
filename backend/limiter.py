from __future__ import annotations

import math
import sqlite3
import time
from pathlib import Path
from typing import Any


class PolicyError(ValueError):
    pass


class RateLimiter:
    def __init__(self, database_path: str | Path = "sentinel.db") -> None:
        self.database_path = str(database_path)
        self._initialize()
    # above one is to init db
    def _connect(self) -> sqlite3.Connection:
        connection = sqlite3.connect(self.database_path, timeout=10)
        connection.row_factory = sqlite3.Row
        return connection
# connect with db 
    def _initialize(self) -> None:
        Path(self.database_path).parent.mkdir(parents=True, exist_ok=True)
        with self._connect() as connection:
            connection.executescript(
                """
                PRAGMA journal_mode = WAL;
                CREATE TABLE IF NOT EXISTS policies (
                    client_id TEXT PRIMARY KEY,
                    capacity INTEGER NOT NULL CHECK (capacity > 0),
                    refill_rate REAL NOT NULL CHECK (refill_rate > 0),
                    enabled INTEGER NOT NULL DEFAULT 1,
                    tokens REAL NOT NULL,
                    last_refill REAL NOT NULL,
                    created_at REAL NOT NULL,
                    updated_at REAL NOT NULL
                );
                CREATE TABLE IF NOT EXISTS request_events (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    client_id TEXT NOT NULL,
                    route TEXT NOT NULL,
                    allowed INTEGER NOT NULL,
                    reason TEXT NOT NULL,
                    tokens_remaining REAL,
                    created_at REAL NOT NULL
                );
                CREATE INDEX IF NOT EXISTS idx_request_events_created
                    ON request_events(created_at);
                CREATE INDEX IF NOT EXISTS idx_request_events_client
                    ON request_events(client_id, created_at);
                """
            )
# create the table in sqlite db if not exist, and create index for request_events table
    @staticmethod
    def _validate_policy(client_id: str, capacity: int, refill_rate: float) -> None:
        if not client_id or len(client_id) > 100:
            raise PolicyError("Client ID must be between 1 and 100 characters.")
        if isinstance(capacity, bool) or not isinstance(capacity, int) or capacity < 1:
            raise PolicyError("Capacity must be a positive whole number.")
        if (
            isinstance(refill_rate, bool)
            or not isinstance(refill_rate, (int, float))
            or not math.isfinite(refill_rate)
            or refill_rate <= 0
        ):
            raise PolicyError("Refill rate must be greater than zero.")
  # validate the policy 
    @staticmethod
    def _policy_dict(row: sqlite3.Row) -> dict[str, Any]:
        return {
            "client_id": row["client_id"],
            "capacity": row["capacity"],
            "refill_rate": row["refill_rate"],
            "enabled": bool(row["enabled"]),
            "tokens": min(float(row["tokens"]), float(row["capacity"])),
            "last_refill": row["last_refill"],
            "updated_at": row["updated_at"],
        }
# make the row to dict for return
    def list_policies(self) -> list[dict[str, Any]]:
        with self._connect() as connection:
            rows = connection.execute(
                "SELECT * FROM policies ORDER BY client_id"
            ).fetchall()
            return [self._policy_dict(row) for row in rows]
 # list the policies in the db
    def get_policy(self, client_id: str) -> dict[str, Any] | None:
        with self._connect() as connection:
            row = connection.execute(
                "SELECT * FROM policies WHERE client_id = ?", (client_id,)
            ).fetchone()
            return self._policy_dict(row) if row else None
# retrive the policy for a specific client_id
    def save_policy(
        self,
        client_id: str,
        capacity: int,
        refill_rate: float,
        enabled: bool = True,
        now: float | None = None,
    ) -> dict[str, Any]:
        self._validate_policy(client_id.strip(), capacity, refill_rate)
        client_id = client_id.strip()
        timestamp = time.time() if now is None else now
        with self._connect() as connection:
            connection.execute("BEGIN IMMEDIATE")
            existing = connection.execute(
                "SELECT * FROM policies WHERE client_id = ?", (client_id,)
            ).fetchone()
            if existing:
                elapsed = max(0.0, timestamp - existing["last_refill"])
                refilled = min(
                    float(existing["capacity"]),
                    float(existing["tokens"]) + elapsed * float(existing["refill_rate"]),
                )
                tokens = min(float(capacity), refilled)
                last_refill = timestamp
                created_at = existing["created_at"]
            else:
                tokens = float(capacity)
                last_refill = timestamp
                created_at = timestamp
            connection.execute(
                """
                INSERT INTO policies (
                    client_id, capacity, refill_rate, enabled, tokens,
                    last_refill, created_at, updated_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
                ON CONFLICT(client_id) DO UPDATE SET
                    capacity = excluded.capacity,
                    refill_rate = excluded.refill_rate,
                    enabled = excluded.enabled,
                    tokens = excluded.tokens,
                    last_refill = excluded.last_refill,
                    updated_at = excluded.updated_at
                """,
                (
                    client_id,
                    capacity,
                    refill_rate,
                    int(enabled),
                    tokens,
                    last_refill,
                    created_at,
                    timestamp,
                ),
            )
            row = connection.execute(
                "SELECT * FROM policies WHERE client_id = ?", (client_id,)
            ).fetchone()
            return self._policy_dict(row)
# create teh new policy or update the existing policy for a specific client_id
    def evaluate(
        self,
        client_id: str,
        route: str = "/api/demo",
        now: float | None = None,
    ) -> dict[str, Any]:
        client_id = client_id.strip()
        if not client_id or len(client_id) > 100:
            raise PolicyError("Client ID must be between 1 and 100 characters.")
        timestamp = time.time() if now is None else now
        route = route.strip()[:200] or "/api/demo"
        with self._connect() as connection:
            connection.execute("BEGIN IMMEDIATE")
            row = connection.execute(
                "SELECT * FROM policies WHERE client_id = ?", (client_id,)
            ).fetchone()
            if not row:
                allowed, reason, remaining = True, "unconfigured", None
            elif not row["enabled"]:
                allowed, reason, remaining = True, "policy_disabled", float(row["tokens"])
            else:
                elapsed = max(0.0, timestamp - float(row["last_refill"]))
                tokens = min(
                    float(row["capacity"]),
                    float(row["tokens"]) + elapsed * float(row["refill_rate"]),
                )
                allowed = tokens >= 1.0
                remaining = tokens - 1.0 if allowed else tokens
                reason = "allowed" if allowed else "bucket_empty"
                connection.execute(
                    """
                    UPDATE policies
                    SET tokens = ?, last_refill = ?, updated_at = ?
                    WHERE client_id = ?
                    """,
                    (remaining, timestamp, timestamp, client_id),
                )
            connection.execute(
                """
                INSERT INTO request_events
                    (client_id, route, allowed, reason, tokens_remaining, created_at)
                VALUES (?, ?, ?, ?, ?, ?)
                """,
                (client_id, route, int(allowed), reason, remaining, timestamp),
            )
            return {
                "allowed": allowed,
                "client_id": client_id,
                "route": route,
                "reason": reason,
                "tokens_remaining": remaining,
                "capacity": row["capacity"] if row else None,
                "refill_rate": row["refill_rate"] if row else None,
            }
# evaluate the request for a specific client_id and route, and return the result
    def statistics(self) -> dict[str, Any]:
        now = time.time()
        with self._connect() as connection:
            totals = connection.execute(
                """
                SELECT COUNT(*) AS total,
                    COALESCE(SUM(allowed), 0) AS allowed,
                    COUNT(*) - COALESCE(SUM(allowed), 0) AS rejected
                FROM request_events
                """
            ).fetchone()
            today = connection.execute(
                """
                SELECT COUNT(*) AS total,
                    COALESCE(SUM(allowed), 0) AS allowed,
                    COUNT(*) - COALESCE(SUM(allowed), 0) AS rejected
                FROM request_events WHERE created_at >= ?
                """,
                (now - 86400,),
            ).fetchone()
            clients = connection.execute(
                "SELECT COUNT(*) AS count FROM policies WHERE enabled = 1"
            ).fetchone()["count"]
            hourly = connection.execute(
                """
                SELECT CAST((? - created_at) / 3600 AS INTEGER) AS hours_ago,
                    COUNT(*) AS requests,
                    COALESCE(SUM(allowed), 0) AS allowed,
                    COUNT(*) - COALESCE(SUM(allowed), 0) AS rejected
                FROM request_events
                WHERE created_at >= ?
                GROUP BY hours_ago
                """,
                (now, now - 24 * 3600),
            ).fetchall()
            recent = connection.execute(
                """
                SELECT id, client_id, route, allowed, reason, tokens_remaining, created_at
                FROM request_events ORDER BY id DESC LIMIT 10
                """
            ).fetchall()
            history = connection.execute(
                """
                SELECT id, client_id, route, allowed, reason, tokens_remaining, created_at
                FROM request_events ORDER BY id DESC LIMIT 100
                """
            ).fetchall()

        traffic = [
            {"hour": hour, "requests": 0, "allowed": 0, "rejected": 0}
            for hour in range(23, -1, -1)
        ]
        for item in hourly:
            index = 23 - min(23, max(0, item["hours_ago"]))
            traffic[index]["requests"] = item["requests"]
            traffic[index]["allowed"] = item["allowed"]
            traffic[index]["rejected"] = item["rejected"]
        return {
            "total_requests": totals["total"],
            "allowed": totals["allowed"],
            "rejected": totals["rejected"],
            "requests_24h": today["total"],
            "allowed_24h": today["allowed"],
            "rejected_24h": today["rejected"],
            "active_policies": clients,
            "traffic": traffic,
            "recent_events": [dict(item) for item in recent],
            "events": [dict(item) for item in history],
        }
# used to get the statistics of the requests and policies