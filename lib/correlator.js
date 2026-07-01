const CORRELATION_WINDOW_MS = 5 * 60 * 1000;
const DISTINCT_TYPES_TO_ESCALATE = 2;

function pruneOld(events, now = Date.now()) {
  const cutoff = now - CORRELATION_WINDOW_MS;
  return events.filter((e) => e.ts >= cutoff);
}

function fieldsToObject(fields) {
  const event = {};
  for (let i = 0; i < fields.length; i += 2) {
    event[fields[i]] = fields[i + 1];
  }
  return event;
}

function correlate(fields, activityMap, now = Date.now()) {
  const event = fieldsToObject(fields);
  const srcIp = event.src_ip;
  const existing = activityMap.get(srcIp) || [];
  const pruned = pruneOld(existing, now);
  pruned.push({ type: event.event_type, ts: now });
  activityMap.set(srcIp, pruned);

  const distinctTypes = new Set(pruned.map((e) => e.type));
  return {
    event,
    srcIp,
    distinctTypes: [...distinctTypes],
    escalated: distinctTypes.size >= DISTINCT_TYPES_TO_ESCALATE,
  };
}

module.exports = {
  pruneOld,
  fieldsToObject,
  correlate,
  CORRELATION_WINDOW_MS,
  DISTINCT_TYPES_TO_ESCALATE,
};
