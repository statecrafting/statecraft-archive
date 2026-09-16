import { describe, it, expect, afterEach } from "vitest";
import { EventLog } from "./event-log.js";
import {
  LogPruner,
  DEFAULT_RETENTION_MS,
  DEFAULT_PRUNE_INTERVAL_MS,
} from "./pruner.js";
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

describe("LogPruner", () => {
  let pruner: LogPruner;

  afterEach(() => {
    pruner?.dispose();
  });

  // --------------- constants ---------------

  it("DEFAULT_RETENTION_MS is 30 days", () => {
    expect(DEFAULT_RETENTION_MS).toBe(30 * 24 * 60 * 60 * 1_000);
  });

  it("DEFAULT_PRUNE_INTERVAL_MS is 24 hours", () => {
    expect(DEFAULT_PRUNE_INTERVAL_MS).toBe(24 * 60 * 60 * 1_000);
  });

  // --------------- manual prune ---------------

  it("prunes entries older than retention period (NF-003)", () => {
    const log = new EventLog();
    const day = 24 * 60 * 60 * 1_000;
    const now = 40 * day; // 40 days from epoch

    // Events at day 5 (35 days ago) and day 20 (20 days ago)
    log.append(makeEvent({ timestamp: 5 * day }), "delivered");
    log.append(makeEvent({ timestamp: 20 * day }), "delivered");

    pruner = new LogPruner(log, { now: () => now, pruneIntervalMs: 0 });
    const removed = pruner.prune();

    // day 5 is 35 days ago — older than 30-day retention
    expect(removed).toBe(1);
    expect(log.size).toBe(1);
  });

  it("keeps entries within retention period", () => {
    const log = new EventLog();
    const day = 24 * 60 * 60 * 1_000;
    const now = 31 * day;

    log.append(makeEvent({ timestamp: 2 * day }), "delivered"); // 29 days old
    log.append(makeEvent({ timestamp: 10 * day }), "delivered"); // 21 days old

    pruner = new LogPruner(log, { now: () => now, pruneIntervalMs: 0 });
    const removed = pruner.prune();
    expect(removed).toBe(0);
    expect(log.size).toBe(2);
  });

  it("custom retention period", () => {
    const log = new EventLog();
    log.append(makeEvent({ timestamp: 100 }), "delivered");
    log.append(makeEvent({ timestamp: 500 }), "delivered");

    pruner = new LogPruner(log, {
      retentionMs: 200,
      now: () => 600,
      pruneIntervalMs: 0,
    });

    const removed = pruner.prune();
    // cutoff = 600 - 200 = 400 → event at 100 pruned, event at 500 kept
    expect(removed).toBe(1);
    expect(log.size).toBe(1);
  });

  it("exposes retention value", () => {
    const log = new EventLog();
    pruner = new LogPruner(log, { retentionMs: 5000, pruneIntervalMs: 0 });
    expect(pruner.retention).toBe(5000);
  });

  it("uses default retention when not specified", () => {
    const log = new EventLog();
    pruner = new LogPruner(log, { pruneIntervalMs: 0 });
    expect(pruner.retention).toBe(DEFAULT_RETENTION_MS);
  });

  // --------------- automatic pruning ---------------

  it("auto-prunes on interval", async () => {
    const log = new EventLog();
    log.append(makeEvent({ timestamp: 100 }), "delivered");

    let clock = 1000;
    pruner = new LogPruner(log, {
      retentionMs: 500,
      pruneIntervalMs: 50, // 50ms for fast test
      now: () => clock,
    });

    // Event at 100, cutoff = 1000 - 500 = 500 → should prune
    // Wait for the interval to fire
    await new Promise((r) => setTimeout(r, 80));
    expect(log.size).toBe(0);
  });

  it("no auto-prune when pruneIntervalMs is 0", async () => {
    const log = new EventLog();
    log.append(makeEvent({ timestamp: 100 }), "delivered");

    pruner = new LogPruner(log, {
      retentionMs: 50,
      pruneIntervalMs: 0,
      now: () => 1000,
    });

    await new Promise((r) => setTimeout(r, 80));
    // Should NOT have auto-pruned
    expect(log.size).toBe(1);
  });

  // --------------- dispose ---------------

  it("dispose stops the timer", async () => {
    const log = new EventLog();
    log.append(makeEvent({ timestamp: 100 }), "delivered");

    pruner = new LogPruner(log, {
      retentionMs: 50,
      pruneIntervalMs: 50,
      now: () => 1000,
    });

    pruner.dispose();
    await new Promise((r) => setTimeout(r, 80));
    // Timer stopped — entry should still be there
    expect(log.size).toBe(1);
  });

  it("dispose is idempotent", () => {
    const log = new EventLog();
    pruner = new LogPruner(log, { pruneIntervalMs: 0 });
    pruner.dispose();
    pruner.dispose(); // no throw
  });
});
