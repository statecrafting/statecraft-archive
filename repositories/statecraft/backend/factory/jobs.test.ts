import { describe, expect, it } from "vitest";

import { canTransition, isLive, isTerminal, type StampStatus } from "./jobs";

describe("stamp job state machine", () => {
  it("walks the happy path queued -> ... -> green", () => {
    const path: StampStatus[] = ["queued", "stamping", "pushing", "verifying", "green"];
    for (let i = 0; i < path.length - 1; i++) {
      expect(canTransition(path[i]!, path[i + 1]!)).toBe(true);
    }
  });

  it("allows failing from any non-terminal state", () => {
    for (const s of ["queued", "stamping", "pushing", "verifying"] as StampStatus[]) {
      expect(canTransition(s, "failed")).toBe(true);
    }
  });

  it("rejects skips and backward moves", () => {
    expect(canTransition("queued", "pushing")).toBe(false);
    expect(canTransition("queued", "green")).toBe(false);
    expect(canTransition("verifying", "stamping")).toBe(false);
    expect(canTransition("pushing", "queued")).toBe(false);
  });

  it("treats green and failed as terminal", () => {
    expect(isTerminal("green")).toBe(true);
    expect(isTerminal("failed")).toBe(true);
    expect(canTransition("green", "verifying")).toBe(false);
    expect(canTransition("failed", "green")).toBe(false);
  });

  it("classifies live vs terminal statuses", () => {
    for (const s of ["queued", "stamping", "pushing", "verifying"] as StampStatus[]) {
      expect(isLive(s)).toBe(true);
      expect(isTerminal(s)).toBe(false);
    }
    expect(isLive("green")).toBe(false);
    expect(isLive("failed")).toBe(false);
  });
});
