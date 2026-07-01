# mini-xdr — real-time security event correlation platform

Ingestion API + Redis Streams + rules engine + ML anomaly scoring +
live dashboard.

## Architecture

```
                    ┌─────────────────┐
                    │  ingestion-api   │  POST /events
                    │  (port 4000)     │
                    └────────┬────────┘
                             │ XADD
                             ▼
                    ┌─────────────────┐
                    │  Redis Stream   │
                    │ security-events │
                    └──┬──────────┬───┘
                       │          │
          XREADGROUP   │          │  XREAD (separate
          (broadcast)  │          │  consumer group)
                       ▼          ▼
            ┌──────────────┐  ┌──────────────┐
            │ broadcast-   │  │ rules-       │
            │ server       │  │ consumer.js  │
            │ (port 5000)  │  │ (CLI logs)   │
            │ Socket.io    │  └──────────────┘
            │ Mongo persist│
            └──────┬───────┘
                   │     ┌──────────────┐
                   │     │  ml-scorer   │
                   │     │ (port 8000)  │
                   │     │ Isolation    │
                   │     │ Forest       │
                   │     └──────┬───────┘
                   │            │
                   ▼            ▼
            ┌──────────────────────────┐
            │       MongoDB (xdr)      │
            │  ┌─────────┐ ┌─────────┐ │
            │  │ events  │ │security-│ │
            │  │         │ │ alerts  │ │
            │  └─────────┘ └─────────┘ │
            └──────────────────────────┘
                        │
                        ▼
            ┌──────────────────────┐
            │  dashboard (Next.js) │
            │  live table via      │
            │  Socket.io           │
            └──────────────────────┘
```

## Prerequisites

- **Node.js 18+**
- **Docker Desktop** (for Redis + MongoDB) — or run them natively
- **Python 3.12+** (for the ML scorer)

## Run it (5 terminals + optional dashboard)

**1. Start infrastructure**
```bash
docker compose up -d
```
(No Docker? Run `redis-server` and `mongod` locally instead.)

**2. Terminal 1 — ingestion API**
```bash
cp .env.example .env
npm install
node ingestion-api.js
```
Expected: `Ingestion API listening on http://localhost:4000`

**3. Terminal 2 — rules consumer**
```bash
node rules-consumer.js
```
Expected: `Rules consumer watching stream "security-events"...`

**4. Terminal 3 — ML anomaly scorer**
```bash
cd ml-scorer
pip install -r requirements.txt
uvicorn main:app --reload --port 8000
```
Expected: starts on port 8000, scores events once the cold-start buffer fills.

**5. Terminal 4 — broadcast server (live dashboard backend)**
```bash
node broadcast-server.js
```
Expected: `Broadcast server listening on http://localhost:5000`

**6. Terminal 5 — send test events**
```bash
node send-test-events.js
```
Watch Terminals 2 and 4 for event flow. View Terminal 3 for ML scores.

**7. Dashboard (separate terminal)**
```bash
cd dashboard
npm install
npm run dev
```
Open http://localhost:3000. A live table shows events as they arrive.
Rows are color-coded by anomaly score (green < 0.3, yellow 0.3–0.7,
red > 0.7). Click any row to see that IP's full event history.

**Run order matters:** Redis + Mongo first, then ingestion-api, then
consumers (rules-consumer, ml-scorer, broadcast-server), then dashboard.

## Wiring in your real IDS

Your Python IDS (`ids_starter.py`) currently just prints alerts. Point it
at this API instead: in `check_port_scan` / `check_syn_flood`, replace
the `print(...)` with a POST request:

```python
import requests

requests.post("http://localhost:4000/events", json={
    "source": "ids",
    "src_ip": src_ip,
    "event_type": "port_scan",   # or "syn_flood"
    "severity": "medium",
})
```

Now real sniffed traffic flows through the same pipeline as the test events.

## What's next (in order)
1. ✅ Ingestion API + Redis Stream + rules consumer
2. Wire the real IDS into it (few lines, see above)
3. ✅ Python ML scorer service (Isolation Forest on distinct_ports, event_rate)
4. ✅ Broadcast server + live dashboard (Next.js, Socket.io)
5. Docker Compose for the whole stack; optional cloud/K8s deploy
