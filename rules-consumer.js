/**
 * Rules engine consumer
 * Reads security events off the Redis Stream and correlates them.
 * This is intentionally simple to start: an IP that triggers 2+
 * DISTINCT event types within a time window gets escalated.
 * (e.g. a port_scan followed by a failed_login from the same IP
 * is more suspicious than either alone.)
 *
 * Run: node src/rules-consumer.js
 * Run this in a separate terminal from the ingestion API.
 */

require("dotenv").config();
const Redis = require("ioredis");

const STREAM_KEY = process.env.STREAM_KEY || "security-events";
const CORRELATION_WINDOW_MS = 5 * 60 * 1000; // 5 minutes
const DISTINCT_TYPES_TO_ESCALATE = 2;

const redis = new Redis(process.env.REDIS_URL || "redis://localhost:6379");

// In-memory sliding window per source IP.
// For a real deployment you'd move this to Redis too (e.g. sorted sets)
// so state survives a consumer restart — fine to note as a "next step"
// in your README, don't over-engineer it before it's needed.
const activity = new Map(); // src_ip -> [{ type, ts }]

function pruneOld(events) {
  const cutoff = Date.now() - CORRELATION_WINDOW_MS;
  return events.filter((e) => e.ts >= cutoff);
}

function handleEvent(fields) {
  const event = {};
  for (let i = 0; i < fields.length; i += 2) {
    event[fields[i]] = fields[i + 1];
  }

  const srcIp = event.src_ip;
  const existing = activity.get(srcIp) || [];
  const pruned = pruneOld(existing);
  pruned.push({ type: event.event_type, ts: Date.now() });
  activity.set(srcIp, pruned);

  const distinctTypes = new Set(pruned.map((e) => e.type));

  console.log(
    `[event] ${event.source} ${event.event_type} from ${srcIp} (severity=${event.severity})`
  );

  if (distinctTypes.size >= DISTINCT_TYPES_TO_ESCALATE) {
    console.log(
      `[ESCALATED] ${srcIp} triggered ${distinctTypes.size} distinct event types ` +
      `in the last ${CORRELATION_WINDOW_MS / 1000}s: [${[...distinctTypes].join(", ")}]`
    );
    // Next step: write this escalation to Mongo / push to the dashboard
    // over Socket.io instead of just logging it.
  }
}

async function consume() {
  console.log(`Rules consumer watching stream "${STREAM_KEY}"...`);
  let lastId = "$"; // "$" = only new entries from now on

  while (true) {
    try {
      const results = await redis.xread(
        "BLOCK", 5000,
        "STREAMS", STREAM_KEY, lastId
      );

      if (!results) continue; // timed out, no new events, loop again

      const [, entries] = results[0];
      for (const [id, fields] of entries) {
        handleEvent(fields);
        lastId = id;
      }
    } catch (err) {
      console.error("Consumer error:", err.message);
      await new Promise((r) => setTimeout(r, 2000));
    }
  }
}

consume();
