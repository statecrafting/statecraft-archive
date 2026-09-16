import { describe, it, expect } from "vitest";
import {
  scoreToLevel,
  getCapabilities,
  hasCapability,
  enabledCapabilities,
  disabledCapabilities,
  compareLevels,
} from "./privileges.js";

describe("scoreToLevel (FR-005)", () => {
  it("score > 0.7 → full", () => {
    expect(scoreToLevel(0.71)).toBe("full");
    expect(scoreToLevel(0.8)).toBe("full");
    expect(scoreToLevel(1.0)).toBe("full");
  });

  it("0.5 < score <= 0.7 → restricted", () => {
    expect(scoreToLevel(0.51)).toBe("restricted");
    expect(scoreToLevel(0.6)).toBe("restricted");
    expect(scoreToLevel(0.7)).toBe("restricted");
  });

  it("0.3 < score <= 0.5 → read_only", () => {
    expect(scoreToLevel(0.31)).toBe("read_only");
    expect(scoreToLevel(0.4)).toBe("read_only");
    expect(scoreToLevel(0.5)).toBe("read_only");
  });

  it("score <= 0.3 → suspended", () => {
    expect(scoreToLevel(0.3)).toBe("suspended");
    expect(scoreToLevel(0.1)).toBe("suspended");
    expect(scoreToLevel(0.0)).toBe("suspended");
  });

  it("SC-001: score 0.71 maps to full", () => {
    expect(scoreToLevel(0.71)).toBe("full");
  });

  it("boundary: exactly 0.7 is restricted (score > 0.7 for full)", () => {
    expect(scoreToLevel(0.7)).toBe("restricted");
  });
});

describe("getCapabilities", () => {
  it("returns a copy (not reference)", () => {
    const caps1 = getCapabilities("full");
    const caps2 = getCapabilities("full");
    expect(caps1).toEqual(caps2);
    caps1.fileRead = false;
    expect(caps2.fileRead).toBe(true);
  });
});

describe("hasCapability", () => {
  it("full has all capabilities", () => {
    expect(hasCapability("full", "fileRead")).toBe(true);
    expect(hasCapability("full", "agentSpawn")).toBe(true);
  });

  it("SC-002: restricted can read/write but not delete/push/network", () => {
    expect(hasCapability("restricted", "fileRead")).toBe(true);
    expect(hasCapability("restricted", "fileWrite")).toBe(true);
    expect(hasCapability("restricted", "fileDelete")).toBe(false);
    expect(hasCapability("restricted", "gitWrite")).toBe(false);
    expect(hasCapability("restricted", "networkAccess")).toBe(false);
  });

  it("suspended has no capabilities", () => {
    expect(hasCapability("suspended", "fileRead")).toBe(false);
    expect(hasCapability("suspended", "toolUse")).toBe(false);
  });
});

describe("enabledCapabilities / disabledCapabilities", () => {
  it("full has 8 enabled, 0 disabled", () => {
    expect(enabledCapabilities("full").length).toBe(8);
    expect(disabledCapabilities("full").length).toBe(0);
  });

  it("suspended has 0 enabled, 8 disabled", () => {
    expect(enabledCapabilities("suspended").length).toBe(0);
    expect(disabledCapabilities("suspended").length).toBe(8);
  });

  it("read_only has 2 enabled (fileRead, gitRead)", () => {
    const enabled = enabledCapabilities("read_only");
    expect(enabled).toContain("fileRead");
    expect(enabled).toContain("gitRead");
    expect(enabled.length).toBe(2);
  });
});

describe("compareLevels", () => {
  it("full < restricted < read_only < suspended", () => {
    expect(compareLevels("full", "restricted")).toBeLessThan(0);
    expect(compareLevels("restricted", "read_only")).toBeLessThan(0);
    expect(compareLevels("read_only", "suspended")).toBeLessThan(0);
  });

  it("equal levels return 0", () => {
    expect(compareLevels("full", "full")).toBe(0);
    expect(compareLevels("suspended", "suspended")).toBe(0);
  });

  it("reverse order gives positive", () => {
    expect(compareLevels("suspended", "full")).toBeGreaterThan(0);
  });
});
