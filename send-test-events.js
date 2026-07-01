/**
 * Sends a few sample events to the ingestion API so you can see
 * the pipeline work end-to-end without needing the real IDS running.
 *
 * Run: node src/send-test-events.js
 */

const API = process.env.API_URL || "http://localhost:4000/events";

const sampleEvents = [
  { source: "ids", src_ip: "10.0.0.5", event_type: "port_scan", severity: "medium" },
  { source: "ids", src_ip: "10.0.0.5", event_type: "syn_flood", severity: "high" }, // same IP, 2nd type -> should escalate
  { source: "auth-log", src_ip: "10.0.0.9", event_type: "failed_login", severity: "low" },
];

async function send(event) {
  const res = await fetch(API, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(event),
  });
  const body = await res.json();
  console.log(`Sent ${event.event_type} from ${event.src_ip} ->`, body);
}

(async () => {
  for (const event of sampleEvents) {
    await send(event);
    await new Promise((r) => setTimeout(r, 500));
  }
})();
