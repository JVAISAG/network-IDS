/**
 * Broadcast server
 * Express + Socket.io server that consumes the same Redis Stream
 * as rules-consumer.js (via a separate consumer group), persists raw
 * events to Mongo, and pushes them live to dashboard clients.
 *
 * Also polls xdr.security-alerts for ML scores and emits those too.
 *
 * Run: node broadcast-server.js
 */
require("dotenv").config();
const express = require("express");
const { createServer } = require("http");
const { Server } = require("socket.io");
const Redis = require("ioredis");
const { MongoClient } = require("mongodb");

const PORT = process.env.BROADCAST_PORT || 5000;
const REDIS_URL = process.env.REDIS_URL || "redis://localhost:6379";
const MONGO_URL = process.env.MONGO_URL || "mongodb://localhost:27017";
const MONGO_DB = process.env.MONGO_DB || "xdr";
const STREAM_KEY = process.env.STREAM_KEY || "security-events";
const GROUP = "broadcast-group";
const CONSUMER = "broadcast-server-1";

async function main() {
  const redis = new Redis(REDIS_URL);
  const mongo = await MongoClient.connect(MONGO_URL);
  const db = mongo.db(MONGO_DB);
  const eventsCol = db.collection("events");
  const alertsCol = db.collection("security-alerts");

  // ensure the consumer group exists (idempotent)
  try {
    await redis.xgroup("CREATE", STREAM_KEY, GROUP, "$", "MKSTREAM");
  } catch (e) {
    if (!e.message.includes("BUSYGROUP")) throw e;
  }

  // Create Mongo indexes
  await eventsCol.createIndex({ src_ip: 1, _id: -1 });
  await alertsCol.createIndex({ event_id: 1 });

  const app = express();
  const httpServer = createServer(app);
  const io = new Server(httpServer, { cors: { origin: process.env.DASHBOARD_URL || "http://localhost:3000" } });
  app.use(express.json());

  // ── Redis stream consumer ──────────────────────────────────────
  async function consumeStream() {
    console.log(`Broadcast server watching stream "${STREAM_KEY}"...`);
    while (true) {
      try {
        const results = await redis.xreadgroup(
          "GROUP", GROUP, CONSUMER,
          "BLOCK", 5000,
          "COUNT", 10,
          "STREAMS", STREAM_KEY, ">"
        );
        if (!results) continue;
        for (const [, entries] of results) {
          for (const [id, fields] of entries) {
            await handleEntry(id, fields);
          }
        }
      } catch (err) {
        console.error("Stream consumer error:", err.message);
        await new Promise((r) => setTimeout(r, 2000));
      }
    }
  }

  async function handleEntry(id, fields) {
    const event = {};
    for (let i = 0; i < fields.length; i += 2) {
      event[fields[i]] = fields[i + 1];
    }

    const doc = {
      event_id: id,
      source: event.source,
      src_ip: event.src_ip,
      event_type: event.event_type,
      severity: event.severity,
      detail: event.detail || "{}",
      received_at: event.received_at || new Date().toISOString(),
      _created_at: new Date(),
    };

    await eventsCol.insertOne(doc);
    io.emit("event", doc);
    console.log(`[broadcast] event ${id}  ip=${event.src_ip}  type=${event.event_type}`);
  }

  // ── Mongo poller for scores ────────────────────────────────────
  let lastAlertTs = null;
  async function pollAlerts() {
    while (true) {
      try {
        const query = lastAlertTs ? { _created_at: { $gt: lastAlertTs } } : {};
        const docs = await alertsCol.find(query).sort({ _id: 1 }).limit(50).toArray();
        if (docs.length) {
          lastAlertTs = docs[docs.length - 1]._created_at || new Date();
          for (const doc of docs) {
            io.emit("alert", { event_id: doc.event_id, anomaly_score: doc.anomaly_score });
          }
        }
      } catch (err) {
        console.error("Alert poll error:", err.message);
      }
      await new Promise((r) => setTimeout(r, 2000));
    }
  }

  // ── Helpers ────────────────────────────────────────────────────
  async function joinScores(events) {
    if (!events.length) return events;
    const ids = events.map((e) => e.event_id);
    const scores = await alertsCol.find({ event_id: { $in: ids } }).toArray();
    const map = {};
    for (const s of scores) map[s.event_id] = s.anomaly_score;
    return events.map((e) => ({ ...e, anomaly_score: map[e.event_id] ?? null, _id: undefined }));
  }

  // ── REST endpoints ─────────────────────────────────────────────
  app.get("/api/events/recent", async (req, res) => {
    try {
      const events = await eventsCol.find().sort({ _id: -1 }).limit(100).toArray();
      const joined = await joinScores(events);
      res.json(joined);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  app.get("/api/history/:ip", async (req, res) => {
    try {
      const events = await eventsCol.find({ src_ip: req.params.ip }).sort({ _id: -1 }).limit(200).toArray();
      const joined = await joinScores(events);
      res.json(joined);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  app.get("/health", (req, res) => res.json({ ok: true }));

  // ── Start ──────────────────────────────────────────────────────
  httpServer.listen(PORT, () => {
    console.log(`Broadcast server listening on http://localhost:${PORT}`);
  });

  consumeStream();
  pollAlerts();
}

main().catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});
