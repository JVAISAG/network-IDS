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

const { correlate } = require("./lib/correlator");
require("dotenv").config();
const Redis = require("ioredis");

const STREAM_KEY = process.env.STREAM_KEY || "security-events";

const redis = new Redis(process.env.REDIS_URL || "redis://localhost:6379");

const activity = new Map();

function handleEvent(fields) {
  const { event, srcIp, distinctTypes, escalated } = correlate(fields, activity);

  console.log(
    `[event] ${event.source} ${event.event_type} from ${srcIp} (severity=${event.severity})`
  );

  if (escalated) {
    console.log(
      `[ESCALATED] ${srcIp} triggered ${distinctTypes.length} distinct event types ` +
      `in the last 300s: [${distinctTypes.join(", ")}]`
    );
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
