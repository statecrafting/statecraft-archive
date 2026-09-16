import { describe, it, expect } from "vitest";
import { computeCoherence, SlidingWindow } from "./scoring.js";
import { DEFAULT_WEIGHTS } from "./types.js";

describe("computeCoherence", () => {
  it("returns 1.0 for zero inputs", () => {
    expect(
      computeCoherence({ violationRate: 0, reworkFrequency: 0, intentDrift: 0 }),
    ).toBe(1.0);
  });

  it("returns 0.0 for maximum inputs", () => {
    expect(
      computeCoherence({ violationRate: 1, reworkFrequency: 1, intentDrift: 1 }),
    ).toBe(0.0);
  });

  it("SC-001: known inputs produce expected score", () => {
    // violation=0.5, rework=0.2, drift=0.1, default weights (0.4, 0.3, 0.3)
    // score = 1 - (0.5*0.4 + 0.2*0.3 + 0.1*0.3) = 1 - (0.2 + 0.06 + 0.03) = 1 - 0.29 = 0.71
    const score = computeCoherence(
      { violationRate: 0.5, reworkFrequency: 0.2, intentDrift: 0.1 },
    );
    expect(score).toBeCloseTo(0.71, 10);
  });

  it("clamps below 0", () => {
    expect(
      computeCoherence(
        { violationRate: 1, reworkFrequency: 1, intentDrift: 1 },
        { violationRate: 0.5, reworkFrequency: 0.5, intentDrift: 0.5 },
      ),
    ).toBe(0.0);
  });

  it("clamps above 1", () => {
    // Negative inputs shouldn't happen, but the function should be safe
    expect(
      computeCoherence(
        { violationRate: -1, reworkFrequency: -1, intentDrift: -1 },
      ),
    ).toBe(1.0);
  });

  it("respects custom weights", () => {
    const score = computeCoherence(
      { violationRate: 1, reworkFrequency: 0, intentDrift: 0 },
      { violationRate: 0.5, reworkFrequency: 0.25, intentDrift: 0.25 },
    );
    expect(score).toBeCloseTo(0.5);
  });
});

describe("SlidingWindow", () => {
  it("starts empty", () => {
    const w = new SlidingWindow();
    expect(w.size).toBe(0);
    expect(w.violationRate).toBe(0);
    expect(w.reworkFrequency).toBe(0);
  });

  it("records actions and computes rates", () => {
    const w = new SlidingWindow({ windowSize: 10 });
    w.record("clean");
    w.record("violation");
    w.record("rework");
    w.record("clean");

    expect(w.size).toBe(4);
    expect(w.violationRate).toBeCloseTo(0.25);
    expect(w.reworkFrequency).toBeCloseTo(0.25);
  });

  it("evicts oldest when window is full", () => {
    const w = new SlidingWindow({ windowSize: 3 });
    w.record("violation"); // will be evicted
    w.record("clean");
    w.record("clean");
    w.record("clean"); // evicts the violation

    expect(w.size).toBe(3);
    expect(w.violationRate).toBe(0);
  });

  it("defaults to window size 50", () => {
    const w = new SlidingWindow();
    expect(w.capacity).toBe(50);
  });

  it("getInputs includes intent drift", () => {
    const w = new SlidingWindow({ windowSize: 10 });
    w.record("violation");
    w.record("clean");

    const inputs = w.getInputs(0.5);
    expect(inputs.violationRate).toBeCloseTo(0.5);
    expect(inputs.reworkFrequency).toBe(0);
    expect(inputs.intentDrift).toBe(0.5);
  });

  it("computeResult returns full CoherenceResult", () => {
    const w = new SlidingWindow({ windowSize: 10 });
    w.record("clean");
    w.record("clean");

    const result = w.computeResult(0, DEFAULT_WEIGHTS, () => "2026-01-01T00:00:00.000Z");
    expect(result.score).toBe(1.0);
    expect(result.level).toBe("full");
    expect(result.windowSize).toBe(2);
    expect(result.computedAt).toBe("2026-01-01T00:00:00.000Z");
  });

  it("clear resets the window", () => {
    const w = new SlidingWindow({ windowSize: 10 });
    w.record("violation");
    w.record("violation");
    w.clear();
    expect(w.size).toBe(0);
    expect(w.violationRate).toBe(0);
  });

  it("snapshot returns defensive copy", () => {
    const w = new SlidingWindow({ windowSize: 10 });
    w.record("clean");
    const snap = w.snapshot();
    expect(snap.length).toBe(1);
    expect(snap[0].outcome).toBe("clean");
  });

  it("SC-005: recovery after violations via clean actions", () => {
    const w = new SlidingWindow({ windowSize: 20 });
    // Fill with violations
    for (let i = 0; i < 20; i++) w.record("violation");
    expect(w.violationRate).toBe(1.0);

    // 20 clean actions push out all violations
    for (let i = 0; i < 20; i++) w.record("clean");
    expect(w.violationRate).toBe(0);
    const result = w.computeResult(0);
    expect(result.score).toBe(1.0);
    expect(result.level).toBe("full");
  });
});
