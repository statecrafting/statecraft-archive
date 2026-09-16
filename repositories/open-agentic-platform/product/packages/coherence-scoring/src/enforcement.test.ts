import { describe, it, expect } from "vitest";
import {
  checkCapability,
  enforceCapability,
  checkCapabilities,
  actionToCapability,
  CapabilityDeniedError,
} from "./enforcement.js";
import type { CoherenceResult } from "./types.js";
import { DEFAULT_WEIGHTS } from "./types.js";

function makeResult(score: number, level: "full" | "restricted" | "read_only" | "suspended"): CoherenceResult {
  return {
    score,
    level,
    inputs: { violationRate: 0, reworkFrequency: 0, intentDrift: 0 },
    weights: DEFAULT_WEIGHTS,
    windowSize: 10,
    computedAt: "2026-01-01T00:00:00.000Z",
  };
}

describe("checkCapability", () => {
  it("allows fileRead at full", () => {
    const result = checkCapability("fileRead", makeResult(0.9, "full"));
    expect(result.allowed).toBe(true);
    expect(result.reason).toBeUndefined();
  });

  it("denies fileDelete at restricted", () => {
    const result = checkCapability("fileDelete", makeResult(0.6, "restricted"));
    expect(result.allowed).toBe(false);
    expect(result.reason).toContain("fileDelete");
    expect(result.reason).toContain("restricted");
  });

  it("denies toolUse at read_only", () => {
    const result = checkCapability("toolUse", makeResult(0.4, "read_only"));
    expect(result.allowed).toBe(false);
  });

  it("denies everything at suspended", () => {
    const result = checkCapability("fileRead", makeResult(0.1, "suspended"));
    expect(result.allowed).toBe(false);
  });
});

describe("enforceCapability", () => {
  it("does not throw when allowed", () => {
    expect(() => enforceCapability("fileRead", makeResult(0.9, "full"))).not.toThrow();
  });

  it("throws CapabilityDeniedError when denied", () => {
    expect(() => enforceCapability("gitWrite", makeResult(0.6, "restricted"))).toThrow(
      CapabilityDeniedError,
    );
  });

  it("error contains capability and level info", () => {
    try {
      enforceCapability("networkAccess", makeResult(0.6, "restricted"));
    } catch (e) {
      expect(e).toBeInstanceOf(CapabilityDeniedError);
      const err = e as CapabilityDeniedError;
      expect(err.capability).toBe("networkAccess");
      expect(err.level).toBe("restricted");
      expect(err.score).toBe(0.6);
    }
  });
});

describe("checkCapabilities", () => {
  it("returns results for all capabilities", () => {
    const results = checkCapabilities(
      ["fileRead", "fileWrite", "fileDelete"],
      makeResult(0.6, "restricted"),
    );
    expect(results.length).toBe(3);
    expect(results[0].allowed).toBe(true); // fileRead
    expect(results[1].allowed).toBe(true); // fileWrite
    expect(results[2].allowed).toBe(false); // fileDelete
  });
});

describe("actionToCapability", () => {
  it("maps known actions", () => {
    expect(actionToCapability("file.read")).toBe("fileRead");
    expect(actionToCapability("git.push")).toBe("gitWrite");
    expect(actionToCapability("agent.spawn")).toBe("agentSpawn");
  });

  it("returns undefined for unknown actions", () => {
    expect(actionToCapability("unknown.action")).toBeUndefined();
  });
});

describe("CapabilityDeniedError", () => {
  it("is an Error", () => {
    const err = new CapabilityDeniedError({
      allowed: false,
      capability: "fileDelete",
      level: "restricted",
      score: 0.6,
      reason: "test reason",
    });
    expect(err).toBeInstanceOf(Error);
    expect(err.name).toBe("CapabilityDeniedError");
    expect(err.message).toBe("test reason");
  });
});
