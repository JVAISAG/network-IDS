/**
 * Ingestion API
 * Accepts security events (from the Python IDS, or any other source)
 * over HTTP and pushes them onto a Redis Stream for downstream
 * consumers (rules engine, ML scorer) to process independently.
 *
 * Run: node src/ingestion-api.js
 */

require("dotenv").config();
const express = require("express");
const Redis = require("ioredis");

const PORT = process.env.PORT || 4000;
const STREAM_KEY = process.env.STREAM_KEY || "security-events";
const redis = new Redis(process.env.REDIS_URL || "redis://localhost:6379");

const app = express();
app.use(express.json());

// Basic shape every event must have. Keep this loose on purpose —
// different sources (IDS, auth logs, cloud logs) will have different
// payloads, but every event needs enough to correlate on.
function validateEvent(body) {
  const errors = [];
  if (!body.source) errors.push("source is required (e.g. 'ids', 'auth-log')");
  if (!body.src_ip) errors.push("src_ip is required");
  if (!body.event_type) errors.push("event_type is required (e.g. 'port_scan', 'syn_flood', 'failed_login')");
  return errors;
}

app.post("/events", async (req, res) => {
  const errors = validateEvent(req.body);
  if (errors.length) {
    return res.status(400).json({ ok: false, errors });
  }

  const event = {
    source: req.body.source,
    src_ip: req.body.src_ip,
    event_type: req.body.event_type,
    severity: req.body.severity || "low",
    detail: JSON.stringify(req.body.detail || {}),
    received_at: new Date().toISOString(),
  };

  try {
    // XADD with '*' lets Redis auto-generate a unique, ordered entry ID.
    const id = await redis.xadd(
      STREAM_KEY,
      "*",
      "source", event.source,
      "src_ip", event.src_ip,
      "event_type", event.event_type,
      "severity", event.severity,
      "detail", event.detail,
      "received_at", event.received_at
    );
    res.status(201).json({ ok: true, id });
  } catch (err) {
    console.error("Failed to push event to stream:", err.message);
    res.status(500).json({ ok: false, error: "internal error" });
  }
});

app.get("/health", async (req, res) => {
  try {
    await redis.ping();
    res.json({ ok: true, redis: "connected" });
  } catch {
    res.status(503).json({ ok: false, redis: "unreachable" });
  }
});

app.listen(PORT, () => {
  console.log(`Ingestion API listening on http://localhost:${PORT}`);
  console.log(`POST events to /events, pushed onto stream "${STREAM_KEY}"`);
});
