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
const rateLimit = require("express-rate-limit");
const { z } = require("zod");
const cors = require("cors");

const PORT = process.env.PORT || 4000;
const STREAM_KEY = process.env.STREAM_KEY || "security-events";
const redis = new Redis(process.env.REDIS_URL || "redis://localhost:6379");

const app = express();
app.use(cors({ origin: process.env.DASHBOARD_URL || "http://localhost:3000" }));
app.use(express.json());

const limiter = rateLimit({
  windowMs: 1 * 60 * 1000,
  max: 1000,
});
app.use("/events", limiter);

const API_KEY = process.env.API_KEY || "dev-secret-key";
app.use("/events", (req, res, next) => {
  const auth = req.headers["authorization"];
  if (auth !== `Bearer ${API_KEY}`) {
    return res.status(401).json({ error: "unauthorized" });
  }
  next();
});

const eventSchema = z.object({
  source: z.string().min(1),
  src_ip: z.string().ip(),
  event_type: z.string().min(1),
  severity: z.enum(["low", "medium", "high"]).optional().default("low"),
  detail: z.record(z.any()).optional().default({}),
});

app.post("/events", async (req, res) => {
  const parsed = eventSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ ok: false, errors: parsed.error.errors });
  }
  const body = parsed.data;

  const event = {
    source: body.source,
    src_ip: body.src_ip,
    event_type: body.event_type,
    severity: body.severity,
    detail: JSON.stringify(body.detail),
    received_at: new Date().toISOString(),
  };

  try {
    // XADD with '*' lets Redis auto-generate a unique, ordered entry ID.
    const id = await redis.xadd(
      STREAM_KEY,
      "MAXLEN", "~", "1000000",
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

if (require.main === module) {
  app.listen(PORT, () => {
    console.log(`Ingestion API listening on http://localhost:${PORT}`);
    console.log(`POST events to /events, pushed onto stream "${STREAM_KEY}"`);
  });
}

module.exports = app;
