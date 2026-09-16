import { describe, it, expect } from "vitest";
import { CoherencePipeline } from "./pipeline.js";
import type { PrivilegeChangedEvent } from "./types.js";

describe("CoherencePipeline", () => {
  it("starts at full privilege with score 1.0", () => {
    const p = new CoherencePipeline();
    expect(p.level).toBe("full");
    expect(p.score).toBe(1.0);
  });

  it("recordAction updates score", () => {
    const p = new CoherencePipeline({ windowSize: 10 });
    const result = p.recordAction("violation");
    expect(result.score).toBeLessThan(1.0);
    expect(result.windowSize).toBe(1);
  });

  it("clean actions keep score high", () => {
    const p = new CoherencePipeline({ windowSize: 5 });
    for (let i = 0; i < 5; i++) p.recordAction("clean");
    expect(p.score).toBe(1.0);
    expect(p.level).toBe("full");
  });

  it("violations degrade privilege level", () => {
    const p = new CoherencePipeline({ windowSize: 5 });
    for (let i = 0; i < 5; i++) p.recordAction("violation");
    // All violations: score = 1 - (1.0 * 0.4 + 0 * 0.3 + 0 * 0.3) = 0.6
    expect(p.score).toBeCloseTo(0.6);
    expect(p.level).toBe("restricted");
  });

  it("emits privilege_changed events (FR-007)", () => {
    const events: PrivilegeChangedEvent[] = [];
    const p = new CoherencePipeline({ windowSize: 2 });
    p.onPrivilegeChanged((e) => events.push(e));

    p.recordAction("clean");
    expect(events.length).toBe(0); // still full

    p.recordAction("violation");
    // 1 violation + 1 clean out of 2: violation rate 0.5
    // score = 1 - 0.5*0.4 = 0.8, still full
    // Actually check: no event yet

    p.recordAction("violation"); // evicts clean, now 2 violations
    // violation rate = 1.0, score = 1 - 1*0.4 = 0.6 → restricted
    expect(events.length).toBeGreaterThan(0);
    const lastEvent = events[events.length - 1];
    expect(lastEvent.previousLevel).toBe("full");
    expect(lastEvent.newLevel).toBe("restricted");
  });

  it("SC-003: coherence drops from full to read_only with events at boundaries", () => {
    const events: PrivilegeChangedEvent[] = [];
    const p = new CoherencePipeline({
      windowSize: 5,
      intentDriftProvider: () => 0.5, // constant drift
    });
    p.onPrivilegeChanged((e) => events.push(e));

    // Start: score 1.0, level full
    // Add violations progressively
    p.recordAction("violation");
    p.recordAction("violation");
    p.recordAction("violation");
    p.recordAction("rework");
    p.recordAction("violation");

    // With 4 violations/5, 1 rework/5, drift 0.5:
    // score = 1 - (0.8*0.4 + 0.2*0.3 + 0.5*0.3) = 1 - (0.32 + 0.06 + 0.15) = 0.47
    expect(p.score).toBeCloseTo(0.47);
    expect(p.level).toBe("read_only");

    // Should have seen transitions through restricted to read_only
    expect(events.length).toBeGreaterThanOrEqual(1);
    // The final event should land at read_only
    expect(events[events.length - 1].newLevel).toBe("read_only");
  });

  it("check() and enforce() use current state", () => {
    const p = new CoherencePipeline({ windowSize: 5 });
    // Full privilege
    expect(p.check("fileDelete").allowed).toBe(true);

    // Degrade to restricted
    for (let i = 0; i < 5; i++) p.recordAction("violation");
    expect(p.check("fileDelete").allowed).toBe(false);
    expect(() => p.enforce("fileDelete")).toThrow();
  });

  it("proof chain records all events", () => {
    const p = new CoherencePipeline({ windowSize: 5 });
    p.recordAction("clean");
    p.recordAction("violation");

    // Each recordAction creates: action_recorded + score_computed (+ maybe privilege_changed)
    expect(p.chain.length).toBeGreaterThanOrEqual(4);
    expect(p.chain.verify().valid).toBe(true);
  });

  it("unsubscribe stops event delivery", () => {
    const events: PrivilegeChangedEvent[] = [];
    const p = new CoherencePipeline({ windowSize: 2 });
    const unsub = p.onPrivilegeChanged((e) => events.push(e));

    p.recordAction("violation");
    p.recordAction("violation");
    const countAfterSub = events.length;

    unsub();
    p.recordAction("clean");
    p.recordAction("clean");

    // No new events after unsubscribe
    expect(events.length).toBe(countAfterSub);
  });

  it("SC-005: recovery after 20 clean actions", () => {
    const p = new CoherencePipeline({ windowSize: 20 });

    // Fill with violations → score drops
    for (let i = 0; i < 20; i++) p.recordAction("violation");
    expect(p.level).not.toBe("full");

    // 20 clean actions push out all violations
    for (let i = 0; i < 20; i++) p.recordAction("clean");
    expect(p.score).toBe(1.0);
    expect(p.level).toBe("full");
  });

  it("reset returns to initial state", () => {
    const p = new CoherencePipeline({ windowSize: 5 });
    for (let i = 0; i < 5; i++) p.recordAction("violation");
    expect(p.level).not.toBe("full");

    p.reset();
    expect(p.level).toBe("full");
    expect(p.score).toBe(1.0);
  });

  it("getResult returns default when no actions recorded", () => {
    const p = new CoherencePipeline();
    const r = p.getResult();
    expect(r.score).toBe(1.0);
    expect(r.level).toBe("full");
    expect(r.windowSize).toBe(0);
  });

  it("intent drift provider is used in score computation", () => {
    let drift = 0;
    const p = new CoherencePipeline({
      windowSize: 5,
      intentDriftProvider: () => drift,
    });

    p.recordAction("clean");
    const scoreLow = p.score;

    drift = 1.0;
    p.recordAction("clean");
    const scoreHigh = p.score;

    // Higher drift → lower score
    expect(scoreHigh).toBeLessThan(scoreLow);
  });
});
