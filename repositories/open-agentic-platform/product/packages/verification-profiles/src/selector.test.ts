import { describe, it, expect } from "vitest";
import { parseVerifyFlag, selectProfile } from "./selector.js";

describe("selectProfile", () => {
  it("uses explicit profile override when present (FR-005)", () => {
    expect(
      selectProfile({
        explicit: " release ",
        branch: "feature/new-flow",
        isPR: true,
        isRelease: false,
      }),
    ).toBe("release");
  });

  it("selects release profile from explicit release context", () => {
    expect(selectProfile({ isRelease: true, isPR: true })).toBe("release");
  });

  it("selects pr profile from explicit PR context", () => {
    expect(selectProfile({ isPR: true })).toBe("pr");
  });

  it("detects release profile from release branch pattern", () => {
    expect(selectProfile({ branch: "release/1.2.3" })).toBe("release");
    expect(selectProfile({ branch: "refs/heads/rel/2.0.0" })).toBe("release");
  });

  it("detects hotfix profile from hotfix branch pattern", () => {
    expect(selectProfile({ branch: "hotfix/urgent-patch" })).toBe("hotfix");
  });

  it("detects PR profile from common branch patterns", () => {
    expect(selectProfile({ branch: "feature/my-change" })).toBe("pr");
    expect(selectProfile({ branch: "fix/login-bug" })).toBe("pr");
    expect(selectProfile({ branch: "refs/heads/pull/123/head" })).toBe("pr");
  });

  it("returns null when no context matches", () => {
    expect(selectProfile({ branch: "main" })).toBeNull();
    expect(selectProfile({})).toBeNull();
  });
});

describe("parseVerifyFlag", () => {
  it("parses --verify=value", () => {
    expect(parseVerifyFlag(["run", "--verify=release"])).toBe("release");
  });

  it("parses --verify value", () => {
    expect(parseVerifyFlag(["run", "--verify", "pr"])).toBe("pr");
  });

  it("returns null for missing or empty values", () => {
    expect(parseVerifyFlag(["run"])).toBeNull();
    expect(parseVerifyFlag(["run", "--verify="])).toBeNull();
    expect(parseVerifyFlag(["run", "--verify"])).toBeNull();
  });
});
