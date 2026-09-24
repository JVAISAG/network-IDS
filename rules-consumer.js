const { fieldsToObject, CORRELATION_WINDOW_MS, DISTINCT_TYPES_TO_ESCALATE } = require("./lib/correlator");
require("dotenv").config();
const Redis = require("ioredis");

const STREAM_KEY = process.env.STREAM_KEY || "security-events";
const ESCALATIONS_KEY = "security-escalations";
const GROUP = "rules-group";
const CONSUMER = `rules-consumer-${process.pid}`;

const redis = new Redis(process.env.REDIS_URL || "redis://localhost:6379");

async function init() {
  try {
    await redis.xgroup("CREATE", STREAM_KEY, GROUP, "$", "MKSTREAM");
  } catch (e) {
    if (!e.message.includes("BUSYGROUP")) throw e;
  }
}

async function handleEvent(id, fields) {
  const event = fieldsToObject(fields);
  const srcIp = event.src_ip;
  if (!srcIp) return;
  const now = Date.now();
  const cutoff = now - CORRELATION_WINDOW_MS;
  const zsetKey = `activity:${srcIp}`;

  const pipeline = redis.pipeline();
  pipeline.zremrangebyscore(zsetKey, "-inf", cutoff);
  pipeline.zadd(zsetKey, now, `${event.event_type}:${now}`);
  pipeline.zrange(zsetKey, 0, -1);
  pipeline.expire(zsetKey, Math.ceil(CORRELATION_WINDOW_MS / 1000));
  
  const results = await pipeline.exec();
  const items = results[2][1]; // zrange result
  
  const distinctTypes = new Set(items.map(i => i.split(":")[0]));

  console.log(
    `[event] ${event.source} ${event.event_type} from ${srcIp} (severity=${event.severity})`
  );

  if (distinctTypes.size >= DISTINCT_TYPES_TO_ESCALATE) {
    const escMsg = `[ESCALATED] ${srcIp} triggered ${distinctTypes.size} distinct event types in the last 300s: [${[...distinctTypes].join(", ")}]`;
    console.log(escMsg);
    // Publish escalation to the main stream
    await redis.xadd(STREAM_KEY, "*", 
      "source", "rules-engine",
      "src_ip", srcIp,
      "event_type", "escalation",
      "severity", "high",
      "detail", JSON.stringify({ reason: escMsg, types: [...distinctTypes] }),
      "received_at", new Date().toISOString()
    );
  }
}

async function reclaim() {
  try {
    const res = await redis.xautoclaim(STREAM_KEY, GROUP, CONSUMER, 10000, "0-0", "COUNT", 100);
    if (res && res[1] && res[1].length > 0) {
      for (const [id, fields] of res[1]) {
        await handleEvent(id, fields);
        await redis.xack(STREAM_KEY, GROUP, id);
      }
    }
  } catch (e) {
    console.error("Reclaim error:", e.message);
  }
}

async function consume() {
  console.log(`Rules consumer watching stream "${STREAM_KEY}"...`);

  while (true) {
    try {
      const results = await redis.xreadgroup(
        "GROUP", GROUP, CONSUMER,
        "BLOCK", 5000,
        "COUNT", 10,
        "STREAMS", STREAM_KEY, ">"
      );

      if (results) {
        for (const [, entries] of results) {
          for (const [id, fields] of entries) {
            await handleEvent(id, fields);
            await redis.xack(STREAM_KEY, GROUP, id);
          }
        }
      }
      
      // Attempt reclaim occasionally
      if (Math.random() < 0.1) await reclaim();
      
    } catch (err) {
      console.error("Consumer error:", err.message);
      await new Promise((r) => setTimeout(r, 2000));
    }
  }
}

init().then(consume).catch(console.error);
