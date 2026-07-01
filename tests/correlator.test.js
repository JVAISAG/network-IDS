const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const { pruneOld, fieldsToObject, correlate } = require("../lib/correlator");

describe("pruneOld", () => {
  it("keeps events within the window", () => {
    const now = 1_000_000;
    const events = [{ type: "a", ts: now - 10_000 }];
    assert.equal(pruneOld(events, now).length, 1);
  });

  it("removes events outside the window", () => {
    const now = 1_000_000;
    const events = [{ type: "a", ts: now - 400_000 }];
    assert.equal(pruneOld(events, now).length, 0);
  });
});

describe("fieldsToObject", () => {
  it("converts flat key-value arrays to an object", () => {
    const fields = ["src_ip", "10.0.0.1", "event_type", "port_scan", "severity", "high"];
    assert.deepEqual(fieldsToObject(fields), {
      src_ip: "10.0.0.1",
      event_type: "port_scan",
      severity: "high",
    });
  });
});

describe("correlate", () => {
  it("single event from an IP does not escalate", () => {
    const map = new Map();
    const fields = ["src_ip", "10.0.0.1", "event_type", "port_scan"];
    const result = correlate(fields, map, 1_000_000);
    assert.equal(result.escalated, false);
    assert.equal(result.srcIp, "10.0.0.1");
    assert.deepEqual(result.distinctTypes, ["port_scan"]);
  });

  it("two different event types from the same IP escalate", () => {
    const map = new Map();
    const now = 1_000_000;

    correlate(["src_ip", "10.0.0.1", "event_type", "port_scan"], map, now);
    const result = correlate(["src_ip", "10.0.0.1", "event_type", "failed_login"], map, now + 10_000);

    assert.equal(result.escalated, true);
    assert.equal(result.srcIp, "10.0.0.1");
    assert.equal(result.distinctTypes.length, 2);
    assert.ok(result.distinctTypes.includes("port_scan"));
    assert.ok(result.distinctTypes.includes("failed_login"));
  });

  it("same event type repeated does not escalate", () => {
    const map = new Map();
    const now = 1_000_000;

    correlate(["src_ip", "10.0.0.2", "event_type", "port_scan"], map, now);
    const result = correlate(["src_ip", "10.0.0.2", "event_type", "port_scan"], map, now + 10_000);

    assert.equal(result.escalated, false);
    assert.deepEqual(result.distinctTypes, ["port_scan"]);
  });

  it("old events are pruned so a later different type counts fresh", () => {
    const map = new Map();
    const farPast = 1_000;
    const now = 1_000_000;

    // old event, outside the window
    correlate(["src_ip", "10.0.0.3", "event_type", "port_scan"], map, farPast);
    // new event, window-pruned to just this one
    const result = correlate(["src_ip", "10.0.0.3", "event_type", "failed_login"], map, now);

    assert.equal(result.escalated, false);
    assert.deepEqual(result.distinctTypes, ["failed_login"]);
  });
});
