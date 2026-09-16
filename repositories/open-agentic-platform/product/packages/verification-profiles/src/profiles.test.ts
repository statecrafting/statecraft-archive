import { describe, expect, it } from "vitest";
import { getDefaultProfiles } from "./profiles.js";

describe("getDefaultProfiles", () => {
  it("returns bundled default profiles including hotfix", () => {
    const profiles = getDefaultProfiles();
    expect(profiles.size).toBe(3);
    expect(profiles.has("pr")).toBe(true);
    expect(profiles.has("release")).toBe(true);
    expect(profiles.has("hotfix")).toBe(true);
  });
});
