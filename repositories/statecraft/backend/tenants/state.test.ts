import { describe, expect, it } from "vitest";

import { signState, verifyState } from "./state";

const SECRET = "test-webhook-secret-0123456789abcdef";

describe("install state token", () => {
  it("round-trips a tenant + user binding", () => {
    const token = signState(SECRET, { tenantId: "t-1", userId: "u-1" });
    expect(verifyState(SECRET, token)).toEqual({ tenantId: "t-1", userId: "u-1" });
  });

  it("rejects a token signed with a different secret", () => {
    const token = signState(SECRET, { tenantId: "t-1", userId: "u-1" });
    expect(verifyState("a-different-secret", token)).toBeNull();
  });

  it("rejects a payload tampered under the original signature", () => {
    const token = signState(SECRET, { tenantId: "t-1", userId: "u-1" });
    const sig = token.slice(token.indexOf(".") + 1);
    const forgedPayload = Buffer.from(
      JSON.stringify({ t: "t-attacker", u: "u-1", e: Math.floor(Date.now() / 1000) + 600 }),
      "utf8",
    ).toString("base64url");
    expect(verifyState(SECRET, `${forgedPayload}.${sig}`)).toBeNull();
  });

  it("rejects an expired token", () => {
    const expired = signState(SECRET, { tenantId: "t-1", userId: "u-1" }, -1);
    expect(verifyState(SECRET, expired)).toBeNull();
  });

  it("rejects malformed or empty tokens", () => {
    expect(verifyState(SECRET, "")).toBeNull();
    expect(verifyState(SECRET, null)).toBeNull();
    expect(verifyState(SECRET, "no-separator")).toBeNull();
    expect(verifyState(SECRET, "payload.")).toBeNull();
    expect(verifyState(SECRET, ".signature")).toBeNull();
    expect(verifyState("", "payload.signature")).toBeNull();
  });
});
