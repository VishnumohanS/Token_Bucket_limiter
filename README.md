# SentinelAI

SentinelAI is a small, single-tenant API rate-limiting demo. A React storefront provides example API traffic and a control panel for configuring and observing a SQLite-persisted Token Bucket limiter.

## Features

- Per-client token bucket policies with configurable capacity and time per token refill.
- Atomic SQLite updates for request evaluation; empty buckets reject requests.
- Clients without a configured policy are allowed by default.
- Manual single-request and burst simulation, plus a storefront that sends requests through the same limiter.
- A live, time-refilling token visualization; each cup represents one token for capacities up to 12. The dashboard accepts refill time in seconds per token and converts it to the API's token-per-second rate.
- Aggregated allowed/rejected counts, visible rejection details, request history, and a 24-hour chart with separate allowed/rejected lines.
- Optional AI analytics using aggregate statistics only. Without credentials, local analysis is available. Recommendations are advisory and must be reviewed and explicitly saved.

## Run locally

Requirements: Python 3.10+ and Node.js 20.19+ (or 22.12+).

1. Create and activate a Python virtual environment, then install dependencies:

   ```powershell
   py -m venv .venv
   .\.venv\Scripts\Activate.ps1
   pip install -r requirements.txt
   ```

2. Start the API from the project root:

   ```powershell
   uvicorn backend.app:app --reload
   ```

3. In another terminal, start the React app:

   ```powershell
   cd frontend
   npm install
   npm run dev
   ```

Open the Vite URL shown in the terminal (normally `http://localhost:5173`). The API listens on `http://localhost:8000`.

SQLite data is stored in `data/sentinel.db` by default. Set `SENTINEL_DATABASE_PATH` to use another location. Set `SENTINEL_CORS_ORIGINS` to a comma-separated list of allowed browser origins if the frontend is hosted elsewhere.

## Optional AI analytics

Local aggregate-based insights work without an AI provider. To enable OpenAI-compatible chat completions, set `SENTINEL_AI_API_KEY`; optionally set `SENTINEL_AI_ENDPOINT` and `SENTINEL_AI_MODEL`. Only request totals, allow/reject counts, the 24-hour total, and active policy count are sent. AI is not called during request evaluation and cannot change policies.

## API

- `GET /api/health`
- `GET /api/policies` and `GET /api/policies/{client_id}`
- `POST /api/policies` and `PUT /api/policies/{client_id}`
- `POST /api/requests/evaluate` with `client_id` and optional `route`
- `GET /api/stats`
- `POST /api/analytics`

## Tests

Run backend tests from the project root:

```powershell
pytest
```
