/**
 * Pure-unit tests for the refresh-token model (spec 003 AC-2, INV-7):
 * hashRefreshToken, a pure crypto function with no Encore or DB dependency. The
 * DB-bound operations (store, find, revoke, revokeAll) are exercised against a
 * live Postgres in auth/refresh.itest.ts (npm run test:integration).
 */
import { describe, expect, it } from "vitest";
import { hashRefreshToken } from "../lib/jwt";

// ---------------------------------------------------------------------------
// hashRefreshToken (the foundation of the rotation invariant)
// ---------------------------------------------------------------------------

describe("hashRefreshToken (INV-7, spec 003 AC-2)", () => {
  it("produces a 64-character lowercase hex string (SHA-256 output width)", () => {
    const hash = hashRefreshToken("some-opaque-token-value");
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
  });

  it("is deterministic: the same token always produces the same hash", () => {
    const token = "deterministic-test-token";
    const first = hashRefreshToken(token);
    const second = hashRefreshToken(token);
    expect(first).toBe(second);
  });

  it("rotation invariant: two distinct tokens produce distinct hashes", () => {
    // Simulates the before/after pair produced by issueTokenPair during rotation.
    // Because signRefreshToken embeds a randomUUID jti, no two issued tokens share
    // a hash, so the revoked entry and the replacement entry are always different rows.
    const tokenBefore = "issued-before-rotation-aaaa";
    const tokenAfter = "issued-after-rotation-bbbb";
    expect(hashRefreshToken(tokenBefore)).not.toBe(hashRefreshToken(tokenAfter));
  });

  it("matches the NIST SHA-256 vector for the empty string", () => {
    // Guards against accidental algorithm substitution (e.g. sha1 vs sha256).
    // NIST FIPS 180-4: SHA-256("") =
    //   e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855
    expect(hashRefreshToken("")).toBe(
      "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
    );
  });

  it("produces different hashes for tokens that differ only by a single character", () => {
    const base = "refresh-token-x";
    const variant = "refresh-token-y";
    expect(hashRefreshToken(base)).not.toBe(hashRefreshToken(variant));
  });
});

// The DB-bound operations (storeRefreshToken, findActiveRefreshToken,
// revokeRefreshToken, revokeAllUserTokens) are exercised against a live Postgres
// in auth/refresh.itest.ts, run via `npm run test:integration` (encore test).
