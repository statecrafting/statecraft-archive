import { describe, it, expect } from "vitest";
import {
  DEFAULT_WEIGHTS,
  DEFAULT_WINDOW_SIZE,
  PRIVILEGE_CAPABILITIES,
  PRIVILEGE_LEVELS,
  PRIVILEGE_THRESHOLDS,
} from "./types.js";

describe("types constants", () => {
  it("DEFAULT_WEIGHTS sum to 1.0", () => {
    const sum =
      DEFAULT_WEIGHTS.violationRate +
      DEFAULT_WEIGHTS.reworkFrequency +
      DEFAULT_WEIGHTS.intentDrift;
    expect(sum).toBeCloseTo(1.0);
  });

  it("DEFAULT_WEIGHTS match spec defaults", () => {
    expect(DEFAULT_WEIGHTS.violationRate).toBe(0.4);
    expect(DEFAULT_WEIGHTS.reworkFrequency).toBe(0.3);
    expect(DEFAULT_WEIGHTS.intentDrift).toBe(0.3);
  });

  it("DEFAULT_WINDOW_SIZE is 50", () => {
    expect(DEFAULT_WINDOW_SIZE).toBe(50);
  });

  it("PRIVILEGE_LEVELS has 4 levels in order", () => {
    expect(PRIVILEGE_LEVELS).toEqual(["full", "restricted", "read_only", "suspended"]);
  });

  it("PRIVILEGE_THRESHOLDS cover [0, 1] without gaps", () => {
    expect(PRIVILEGE_THRESHOLDS.full).toEqual({ min: 0.7, max: 1.0 });
    expect(PRIVILEGE_THRESHOLDS.restricted).toEqual({ min: 0.5, max: 0.7 });
    expect(PRIVILEGE_THRESHOLDS.read_only).toEqual({ min: 0.3, max: 0.5 });
    expect(PRIVILEGE_THRESHOLDS.suspended).toEqual({ min: 0.0, max: 0.3 });
  });

  it("full capabilities are all true (FR-006)", () => {
    const full = PRIVILEGE_CAPABILITIES.full;
    expect(Object.values(full).every(Boolean)).toBe(true);
  });

  it("suspended capabilities are all false (FR-006)", () => {
    const suspended = PRIVILEGE_CAPABILITIES.suspended;
    expect(Object.values(suspended).every((v) => !v)).toBe(true);
  });

  it("restricted disables fileDelete, gitWrite, networkAccess, agentSpawn (FR-006)", () => {
    const r = PRIVILEGE_CAPABILITIES.restricted;
    expect(r.fileDelete).toBe(false);
    expect(r.gitWrite).toBe(false);
    expect(r.networkAccess).toBe(false);
    expect(r.agentSpawn).toBe(false);
    expect(r.fileRead).toBe(true);
    expect(r.fileWrite).toBe(true);
    expect(r.toolUse).toBe(true);
  });

  it("read_only allows only fileRead and gitRead (FR-006)", () => {
    const ro = PRIVILEGE_CAPABILITIES.read_only;
    expect(ro.fileRead).toBe(true);
    expect(ro.gitRead).toBe(true);
    expect(ro.fileWrite).toBe(false);
    expect(ro.fileDelete).toBe(false);
    expect(ro.gitWrite).toBe(false);
    expect(ro.networkAccess).toBe(false);
    expect(ro.toolUse).toBe(false);
    expect(ro.agentSpawn).toBe(false);
  });

  it("each privilege level has all 8 capability keys", () => {
    const expectedKeys = [
      "fileRead", "fileWrite", "fileDelete",
      "gitRead", "gitWrite", "networkAccess",
      "toolUse", "agentSpawn",
    ];
    for (const level of PRIVILEGE_LEVELS) {
      expect(Object.keys(PRIVILEGE_CAPABILITIES[level]).sort()).toEqual(expectedKeys.sort());
    }
  });
});
