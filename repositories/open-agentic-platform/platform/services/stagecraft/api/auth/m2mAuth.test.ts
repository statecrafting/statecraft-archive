/**
 * Spec 143 FU-011 Finding 1 — issuer derivation via OIDC discovery.
 *
 * Covers the bug closed by commit-2 of the Tier 1 closure branch:
 * Rauthy 0.35's client_credentials tokens carry `iss` exactly as the
 * discovery doc publishes it (with trailing slash). The previous
 * string-concat derivation (`${rauthyUrl()}/auth/v1`) lost the slash
 * and rejected otherwise-valid tokens. The fix calls
 * `getJwksAndIssuer()` and stripSlash-normalises both sides — same
 * shape as the sibling validator at `rauthy.ts::validateJwt:201`.
 */
import { beforeEach, describe, expect, test, vi } from "vitest";
import { createSign, generateKeyPairSync } from "node:crypto";

const fixture = vi.hoisted(() => ({
  // Default mock: a single RSA JWK + the trailing-slash issuer Rauthy
  // 0.35 publishes through OIDC discovery.
  getJwksAndIssuer: vi.fn(async () => ({
    keys: [] as Array<Record<string, unknown>>,
    issuer: "https://rauthy.test/auth/v1/",
    fetchedAt: Date.now(),
  })),
}));

vi.mock("./rauthy.js", () => ({
  getJwksAndIssuer: fixture.getJwksAndIssuer,
}));

import { validateM2mJwt } from "./m2mAuth";

const TEST_KID = "test-kid-1";

function makeKeypair() {
  const { publicKey, privateKey } = generateKeyPairSync("rsa", {
    modulusLength: 2048,
  });
  const jwk = publicKey.export({ format: "jwk" }) as { n: string; e: string; kty: string };
  return {
    privateKey,
    jwk: { ...jwk, kid: TEST_KID, alg: "RS256", use: "sig" },
  };
}

function signJwt(privateKey: import("node:crypto").KeyObject, payload: Record<string, unknown>): string {
  const header = { alg: "RS256", kid: TEST_KID, typ: "JWT" };
  const headerB64 = Buffer.from(JSON.stringify(header)).toString("base64url");
  const payloadB64 = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const signer = createSign("RSA-SHA256");
  signer.update(`${headerB64}.${payloadB64}`);
  const sig = signer.sign(privateKey).toString("base64url");
  return `${headerB64}.${payloadB64}.${sig}`;
}

describe("validateM2mJwt — issuer via OIDC discovery (FU-011 Finding 1)", () => {
  beforeEach(() => {
    fixture.getJwksAndIssuer.mockReset();
  });

  test("accepts a JWT whose iss matches the discovery-doc issuer (trailing slash)", async () => {
    const { privateKey, jwk } = makeKeypair();
    fixture.getJwksAndIssuer.mockResolvedValue({
      keys: [jwk],
      issuer: "https://rauthy.test/auth/v1/",
      fetchedAt: Date.now(),
    });

    const token = signJwt(privateKey, {
      iss: "https://rauthy.test/auth/v1/",
      sub: "statecraft-knowledge-sweeper",
      exp: Math.floor(Date.now() / 1000) + 1800,
      scope: "platform:knowledge:sweep",
    });

    const claims = await validateM2mJwt(token);
    expect(claims).not.toBeNull();
    expect(claims!.scope).toBe("platform:knowledge:sweep");
  });

  test("accepts when discovery-doc has trailing slash but token's iss does not (stripSlash normalisation)", async () => {
    const { privateKey, jwk } = makeKeypair();
    fixture.getJwksAndIssuer.mockResolvedValue({
      keys: [jwk],
      issuer: "https://rauthy.test/auth/v1/",
      fetchedAt: Date.now(),
    });

    const token = signJwt(privateKey, {
      iss: "https://rauthy.test/auth/v1",
      sub: "statecraft-knowledge-sweeper",
      exp: Math.floor(Date.now() / 1000) + 1800,
      scope: "platform:knowledge:sweep",
    });

    const claims = await validateM2mJwt(token);
    expect(claims).not.toBeNull();
  });

  test("rejects when iss is a different host", async () => {
    const { privateKey, jwk } = makeKeypair();
    fixture.getJwksAndIssuer.mockResolvedValue({
      keys: [jwk],
      issuer: "https://rauthy.test/auth/v1/",
      fetchedAt: Date.now(),
    });

    const token = signJwt(privateKey, {
      iss: "https://attacker.example/auth/v1/",
      sub: "evil",
      exp: Math.floor(Date.now() / 1000) + 1800,
      scope: "platform:knowledge:sweep",
    });

    const claims = await validateM2mJwt(token);
    expect(claims).toBeNull();
  });

  test("rejects when iss is missing", async () => {
    const { privateKey, jwk } = makeKeypair();
    fixture.getJwksAndIssuer.mockResolvedValue({
      keys: [jwk],
      issuer: "https://rauthy.test/auth/v1/",
      fetchedAt: Date.now(),
    });

    const token = signJwt(privateKey, {
      sub: "statecraft-knowledge-sweeper",
      exp: Math.floor(Date.now() / 1000) + 1800,
      scope: "platform:knowledge:sweep",
    });

    const claims = await validateM2mJwt(token);
    expect(claims).toBeNull();
  });

  test("rejects (returns null) when getJwksAndIssuer throws — JWKS-failure posture", async () => {
    fixture.getJwksAndIssuer.mockRejectedValue(new Error("discovery 503"));

    // Token contents don't matter — the throw happens before signature check.
    // Build a syntactically valid 3-part token so the function reaches the
    // discovery call rather than failing early on parts.length !== 3.
    const headerB64 = Buffer.from(JSON.stringify({ alg: "RS256", kid: TEST_KID })).toString("base64url");
    const payloadB64 = Buffer.from(
      JSON.stringify({
        iss: "https://rauthy.test/auth/v1/",
        sub: "x",
        exp: Math.floor(Date.now() / 1000) + 1800,
      }),
    ).toString("base64url");
    const sigB64 = Buffer.from("notarealsignature").toString("base64url");
    const token = `${headerB64}.${payloadB64}.${sigB64}`;

    const claims = await validateM2mJwt(token);
    expect(claims).toBeNull();
  });

  test("rejects an expired token before discovery is even called", async () => {
    const { privateKey, jwk } = makeKeypair();
    fixture.getJwksAndIssuer.mockResolvedValue({
      keys: [jwk],
      issuer: "https://rauthy.test/auth/v1/",
      fetchedAt: Date.now(),
    });

    const token = signJwt(privateKey, {
      iss: "https://rauthy.test/auth/v1/",
      sub: "statecraft-knowledge-sweeper",
      exp: Math.floor(Date.now() / 1000) - 60, // expired 60s ago
      scope: "platform:knowledge:sweep",
    });

    const claims = await validateM2mJwt(token);
    expect(claims).toBeNull();
    expect(fixture.getJwksAndIssuer).not.toHaveBeenCalled();
  });
});
