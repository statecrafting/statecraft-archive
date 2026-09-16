import { describe, it, expect } from "vitest";
import { EventLog } from "./event-log.js";
import type { NotificationEvent } from "../types.js";

function makeEvent(overrides: Partial<NotificationEvent> = {}): NotificationEvent {
  return {
    id: overrides.id ?? crypto.randomUUID(),
    provider: overrides.provider ?? "test-provider",
    sessionId: overrides.sessionId ?? "session-1",
    kind: overrides.kind ?? "task_complete",
    severity: overrides.severity ?? "info",
    dedupeKey: overrides.dedupeKey ?? "key-1",
    title: overrides.title ?? "Test",
    body: overrides.body ?? "Test body",
    timestamp: overrides.timestamp ?? 1000,
    metadata: overrides.metadata ?? {},
  };
}

describe("EventLog", () => {
  // --------------- append ---------------

  it("appends an event and increments size", () => {
    const log = new EventLog();
    expect(log.size).toBe(0);
    log.append(makeEvent(), "delivered", ["toast"]);
    expect(log.size).toBe(1);
  });

  it("records both delivered and suppressed events (SC-004)", () => {
    const log = new EventLog();
    log.append(makeEvent({ id: "e1" }), "delivered", ["toast"]);
    log.append(makeEvent({ id: "e2" }), "suppressed");
    expect(log.size).toBe(2);
    const entries = log.query();
    expect(entries.map((e) => e.status)).toContain("delivered");
    expect(entries.map((e) => e.status)).toContain("suppressed");
  });

  it("returns the logged entry with correct fields", () => {
    let clock = 5000;
    const log = new EventLog({ now: () => clock });
    const event = makeEvent({ id: "e1", timestamp: 2000 });
    const entry = log.append(event, "delivered", ["native", "toast"]);
    expect(entry.event).toBe(event);
    expect(entry.status).toBe("delivered");
    expect(entry.deliveredTo).toEqual(["native", "toast"]);
    expect(entry.loggedAt).toBe(5000);
  });

  it("defensive-copies deliveredTo array", () => {
    const log = new EventLog();
    const channels = ["toast"];
    const entry = log.append(makeEvent(), "delivered", channels);
    channels.push("native");
    expect(entry.deliveredTo).toEqual(["toast"]);
  });

  // --------------- query: no filter ---------------

  it("returns all entries newest-first when no filter", () => {
    const log = new EventLog();
    log.append(makeEvent({ id: "e1", timestamp: 1000 }), "delivered");
    log.append(makeEvent({ id: "e2", timestamp: 3000 }), "delivered");
    log.append(makeEvent({ id: "e3", timestamp: 2000 }), "suppressed");
    const results = log.query();
    expect(results.map((r) => r.event.id)).toEqual(["e2", "e3", "e1"]);
  });

  // --------------- query: sessionId ---------------

  it("filters by sessionId", () => {
    const log = new EventLog();
    log.append(makeEvent({ sessionId: "s1", timestamp: 1 }), "delivered");
    log.append(makeEvent({ sessionId: "s2", timestamp: 2 }), "delivered");
    log.append(makeEvent({ sessionId: "s1", timestamp: 3 }), "suppressed");
    const results = log.query({ sessionId: "s1" });
    expect(results).toHaveLength(2);
    expect(results.every((r) => r.event.sessionId === "s1")).toBe(true);
  });

  // --------------- query: kind ---------------

  it("filters by kind", () => {
    const log = new EventLog();
    log.append(makeEvent({ kind: "task_complete", timestamp: 1 }), "delivered");
    log.append(makeEvent({ kind: "task_error", timestamp: 2 }), "delivered");
    log.append(makeEvent({ kind: "task_complete", timestamp: 3 }), "delivered");
    const results = log.query({ kind: "task_error" });
    expect(results).toHaveLength(1);
    expect(results[0].event.kind).toBe("task_error");
  });

  // --------------- query: severity ---------------

  it("filters by severity", () => {
    const log = new EventLog();
    log.append(makeEvent({ severity: "info", timestamp: 1 }), "delivered");
    log.append(makeEvent({ severity: "critical", timestamp: 2 }), "delivered");
    const results = log.query({ severity: "critical" });
    expect(results).toHaveLength(1);
    expect(results[0].event.severity).toBe("critical");
  });

  // --------------- query: status ---------------

  it("filters by delivery status", () => {
    const log = new EventLog();
    log.append(makeEvent({ timestamp: 1 }), "delivered", ["toast"]);
    log.append(makeEvent({ timestamp: 2 }), "suppressed");
    log.append(makeEvent({ timestamp: 3 }), "partial", ["native"]);
    const results = log.query({ status: "suppressed" });
    expect(results).toHaveLength(1);
    expect(results[0].status).toBe("suppressed");
  });

  // --------------- query: time range ---------------

  it("filters by time range (from/to inclusive)", () => {
    const log = new EventLog();
    log.append(makeEvent({ timestamp: 1000 }), "delivered");
    log.append(makeEvent({ timestamp: 2000 }), "delivered");
    log.append(makeEvent({ timestamp: 3000 }), "delivered");
    log.append(makeEvent({ timestamp: 4000 }), "delivered");
    const results = log.query({ from: 2000, to: 3000 });
    expect(results).toHaveLength(2);
    expect(results.map((r) => r.event.timestamp)).toEqual([3000, 2000]);
  });

  it("filters with only from bound", () => {
    const log = new EventLog();
    log.append(makeEvent({ timestamp: 1000 }), "delivered");
    log.append(makeEvent({ timestamp: 5000 }), "delivered");
    const results = log.query({ from: 3000 });
    expect(results).toHaveLength(1);
    expect(results[0].event.timestamp).toBe(5000);
  });

  it("filters with only to bound", () => {
    const log = new EventLog();
    log.append(makeEvent({ timestamp: 1000 }), "delivered");
    log.append(makeEvent({ timestamp: 5000 }), "delivered");
    const results = log.query({ to: 3000 });
    expect(results).toHaveLength(1);
    expect(results[0].event.timestamp).toBe(1000);
  });

  // --------------- query: combined filters ---------------

  it("combines multiple filters (session + kind + time range)", () => {
    const log = new EventLog();
    log.append(makeEvent({ sessionId: "s1", kind: "task_complete", timestamp: 1000 }), "delivered");
    log.append(makeEvent({ sessionId: "s1", kind: "task_error", timestamp: 2000 }), "delivered");
    log.append(makeEvent({ sessionId: "s2", kind: "task_complete", timestamp: 3000 }), "delivered");
    log.append(makeEvent({ sessionId: "s1", kind: "task_complete", timestamp: 4000 }), "delivered");

    const results = log.query({
      sessionId: "s1",
      kind: "task_complete",
      from: 500,
      to: 3500,
    });
    expect(results).toHaveLength(1);
    expect(results[0].event.timestamp).toBe(1000);
  });

  // --------------- query: limit ---------------

  it("respects limit parameter", () => {
    const log = new EventLog();
    for (let i = 0; i < 10; i++) {
      log.append(makeEvent({ timestamp: i * 1000 }), "delivered");
    }
    const results = log.query({ limit: 3 });
    expect(results).toHaveLength(3);
    // newest first
    expect(results[0].event.timestamp).toBe(9000);
  });

  it("limit 0 returns empty", () => {
    const log = new EventLog();
    log.append(makeEvent({ timestamp: 1 }), "delivered");
    expect(log.query({ limit: 0 })).toHaveLength(0);
  });

  // --------------- query: empty log ---------------

  it("returns empty array for empty log", () => {
    const log = new EventLog();
    expect(log.query()).toEqual([]);
    expect(log.query({ sessionId: "s1" })).toEqual([]);
  });

  // --------------- prune ---------------

  it("removes entries older than cutoff", () => {
    const log = new EventLog();
    log.append(makeEvent({ timestamp: 1000 }), "delivered");
    log.append(makeEvent({ timestamp: 2000 }), "delivered");
    log.append(makeEvent({ timestamp: 3000 }), "delivered");
    const removed = log.prune(2000);
    expect(removed).toBe(1);
    expect(log.size).toBe(2);
    // Remaining entries are at 2000 and 3000
    const results = log.query();
    expect(results.map((r) => r.event.timestamp)).toEqual([3000, 2000]);
  });

  it("prune with future cutoff removes everything", () => {
    const log = new EventLog();
    log.append(makeEvent({ timestamp: 1000 }), "delivered");
    log.append(makeEvent({ timestamp: 2000 }), "delivered");
    const removed = log.prune(9999);
    expect(removed).toBe(2);
    expect(log.size).toBe(0);
  });

  it("prune with past cutoff removes nothing", () => {
    const log = new EventLog();
    log.append(makeEvent({ timestamp: 5000 }), "delivered");
    const removed = log.prune(1000);
    expect(removed).toBe(0);
    expect(log.size).toBe(1);
  });

  // --------------- clear ---------------

  it("clear removes all entries", () => {
    const log = new EventLog();
    log.append(makeEvent({ timestamp: 1 }), "delivered");
    log.append(makeEvent({ timestamp: 2 }), "delivered");
    log.clear();
    expect(log.size).toBe(0);
    expect(log.query()).toEqual([]);
  });
});
