import { describe, it, expect, afterEach } from "vitest";
import {
  DedupIndex,
  DEFAULT_WINDOW_MS,
} from "./dedup-index.js";

describe("DedupIndex", () => {
  let index: DedupIndex;

  afterEach(() => {
    index?.dispose();
  });

  // --------------- basic dedup behaviour ---------------

  it("allows the first event through (not a duplicate)", () => {
    index = new DedupIndex({ cleanupIntervalMs: 0 });
    expect(index.isDuplicate("key-1")).toBe(false);
  });

  it("suppresses a second event with the same key within the window", () => {
    let clock = 1000;
    index = new DedupIndex({ cleanupIntervalMs: 0, now: () => clock });

    expect(index.isDuplicate("key-1")).toBe(false);
    clock += 5_000; // +5s — still within 20s window
    expect(index.isDuplicate("key-1")).toBe(true);
  });

  it("allows an event after the window expires", () => {
    let clock = 1000;
    index = new DedupIndex({ cleanupIntervalMs: 0, now: () => clock });

    expect(index.isDuplicate("key-1")).toBe(false);
    clock += 20_000; // exactly at window boundary — expired
    expect(index.isDuplicate("key-1")).toBe(false);
  });

  it("allows an event well after the window expires", () => {
    let clock = 1000;
    index = new DedupIndex({ cleanupIntervalMs: 0, now: () => clock });

    expect(index.isDuplicate("key-1")).toBe(false);
    clock += 25_000; // 25s > 20s
    expect(index.isDuplicate("key-1")).toBe(false);
  });

  // --------------- window reset on duplicate (FR-003) ---------------

  it("resets the window on each duplicate (SC-002)", () => {
    let clock = 0;
    index = new DedupIndex({ cleanupIntervalMs: 0, now: () => clock });

    // t=0: first event — deliver
    expect(index.isDuplicate("key-1")).toBe(false);

    // t=5s: duplicate — suppress, window resets to t=5s
    clock = 5_000;
    expect(index.isDuplicate("key-1")).toBe(true);

    // t=20s: 15s since last duplicate (t=5s) — still within 20s window
    clock = 20_000;
    expect(index.isDuplicate("key-1")).toBe(true);

    // t=25s: 5s since last duplicate (t=20s) — still within window
    clock = 25_000;
    expect(index.isDuplicate("key-1")).toBe(true);

    // t=46s: 21s since last duplicate (t=25s) — expired
    clock = 46_000;
    expect(index.isDuplicate("key-1")).toBe(false);
  });

  it("SC-002: two events 5s apart = 1 delivery; third at 25s = second delivery", () => {
    let clock = 0;
    index = new DedupIndex({ cleanupIntervalMs: 0, now: () => clock });

    // First event — deliver
    expect(index.isDuplicate("dup")).toBe(false);

    // Second event 5s later — suppress (duplicate)
    clock = 5_000;
    expect(index.isDuplicate("dup")).toBe(true);

    // Third event 25s after first — but only 20s after the second (which reset
    // the window to t=5s). 25-5 = 20s = expired at boundary.
    clock = 25_000;
    expect(index.isDuplicate("dup")).toBe(false);
  });

  // --------------- configurable window (FR-004) ---------------

  it("uses default 20s window", () => {
    expect(DEFAULT_WINDOW_MS).toBe(20_000);
  });

  it("respects custom window duration", () => {
    let clock = 0;
    index = new DedupIndex({
      windowMs: 5_000,
      cleanupIntervalMs: 0,
      now: () => clock,
    });

    expect(index.isDuplicate("k")).toBe(false);
    clock = 4_999;
    expect(index.isDuplicate("k")).toBe(true); // within 5s, resets window to 4999
    clock = 9_999; // 5000ms since last (4999) — expired at boundary
    expect(index.isDuplicate("k")).toBe(false);
  });

  // --------------- independent keys ---------------

  it("tracks keys independently", () => {
    index = new DedupIndex({ cleanupIntervalMs: 0 });

    expect(index.isDuplicate("a")).toBe(false);
    expect(index.isDuplicate("b")).toBe(false);
    expect(index.isDuplicate("a")).toBe(true);
    expect(index.isDuplicate("b")).toBe(true);
  });

  // --------------- size ---------------

  it("reports the number of tracked keys", () => {
    index = new DedupIndex({ cleanupIntervalMs: 0 });
    expect(index.size).toBe(0);
    index.isDuplicate("a");
    index.isDuplicate("b");
    expect(index.size).toBe(2);
  });

  // --------------- cleanup ---------------

  it("cleanup removes expired entries", () => {
    let clock = 0;
    index = new DedupIndex({ cleanupIntervalMs: 0, now: () => clock });

    index.isDuplicate("old");
    clock = 20_000; // window expired for "old"
    index.isDuplicate("new");

    const removed = index.cleanup();
    expect(removed).toBe(1);
    expect(index.size).toBe(1);
  });

  it("cleanup preserves active entries", () => {
    let clock = 0;
    index = new DedupIndex({ cleanupIntervalMs: 0, now: () => clock });

    index.isDuplicate("a");
    clock = 10_000;
    index.isDuplicate("b");

    clock = 20_000; // "a" expired, "b" still active
    const removed = index.cleanup();
    expect(removed).toBe(1);
    expect(index.size).toBe(1);

    // "b" should still suppress
    expect(index.isDuplicate("b")).toBe(true);
    // "a" was cleaned — new event goes through
    expect(index.isDuplicate("a")).toBe(false);
  });

  it("cleanup returns 0 when nothing to remove", () => {
    index = new DedupIndex({ cleanupIntervalMs: 0 });
    index.isDuplicate("a");
    expect(index.cleanup()).toBe(0);
  });

  // --------------- dispose ---------------

  it("dispose clears all entries", () => {
    index = new DedupIndex({ cleanupIntervalMs: 0 });
    index.isDuplicate("a");
    index.isDuplicate("b");
    index.dispose();
    expect(index.size).toBe(0);
  });

  it("after dispose, previously seen keys are treated as new", () => {
    index = new DedupIndex({ cleanupIntervalMs: 0 });
    index.isDuplicate("a");
    index.dispose();
    expect(index.isDuplicate("a")).toBe(false);
  });

  // --------------- NF-002: scale ---------------

  it("handles 10,000 active keys without error", () => {
    index = new DedupIndex({ cleanupIntervalMs: 0 });
    for (let i = 0; i < 10_000; i++) {
      index.isDuplicate(`key-${i}`);
    }
    expect(index.size).toBe(10_000);

    // All should be duplicates
    for (let i = 0; i < 100; i++) {
      expect(index.isDuplicate(`key-${i}`)).toBe(true);
    }
  });

  // --------------- explicit timestamp parameter ---------------

  it("accepts explicit timestamp parameter", () => {
    index = new DedupIndex({ cleanupIntervalMs: 0 });

    expect(index.isDuplicate("k", 1000)).toBe(false);
    expect(index.isDuplicate("k", 1005)).toBe(true);
    expect(index.isDuplicate("k", 21_005)).toBe(false); // expired
  });
});
