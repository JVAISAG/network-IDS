# mini-xdr — real-time security event correlation platform

Ingestion API + Redis Streams + rules engine. This is stage 1 of the
project: prove events flow end-to-end and get correlated. ML scoring
and the Angular dashboard come next.

## Run it today (3 terminals)

**1. Start Redis**
```bash
docker compose up -d
```
(No Docker? Install Redis locally instead: `redis-server`, then skip
the compose file — everything else points at `localhost:6379` either way.)

**2. Terminal 1 — ingestion API**
```bash
cp .env.example .env
npm install
node src/ingestion-api.js
```
You should see: `Ingestion API listening on http://localhost:4000`

**3. Terminal 2 — rules consumer**
```bash
node src/rules-consumer.js
```
You should see: `Rules consumer watching stream "security-events"...`

**4. Terminal 3 — send test events**
```bash
node src/send-test-events.js
```

Watch Terminal 2. You should see each event logged, and an
`[ESCALATED]` line after the second event from `10.0.0.5` — because
it's a different event_type from the same IP within the correlation
window. That's the core "correlation" behavior a SIEM/XDR does.

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
1. ✅ Ingestion API + Redis Stream + rules consumer (this)
2. Wire the real IDS into it (few lines, see above)
3. Persist events + escalations to MongoDB instead of just logging
4. Python ML scorer service consuming the same stream (Isolation Forest
   on features like distinct_ports, event_rate)
5. Angular + Socket.io dashboard showing live events/escalations
6. Docker Compose for the whole stack; optional cloud/K8s deploy
