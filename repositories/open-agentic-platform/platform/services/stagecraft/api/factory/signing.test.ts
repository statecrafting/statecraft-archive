/**
 * Unit tests for the pure Ed25519 compact-JWS helpers (spec 198 FR-014).
 *
 * Exercises `signing-pure.ts` only — no Encore runtime, throwaway keypairs
 * generated per run (no committed key material, CONST-002).
 */

import { describe, expect, it } from "vitest";
import { generateKeyPairSync } from "node:crypto";
import {
  exportPublicJwk,
  signCompactJws,
  verifyCompactJws,
  type PublicJwk,
} from "./signing-pure";

function freshKeyPem(): string {
  const { privateKey } = generateKeyPairSync("ed25519");
  return privateKey.export({ type: "pkcs8", format: "pem" }).toString();
}

describe("signing-pure (Ed25519 compact JWS)", () => {
  const pem = freshKeyPem();
  const kid = "fk-test-1";
  const jwks: PublicJwk[] = [exportPublicJwk(pem, kid)];

  it("signs and verifies a round-trip payload", () => {
    const jws = signCompactJws(pem, kid, "oap-run-grant+jwt", {
      run_id: "r-1",
      seq: 0,
    });
    const verified = verifyCompactJws(jws, jwks, "oap-run-grant+jwt");
    expect(verified.payload.run_id).toBe("r-1");
    expect(verified.payload.seq).toBe(0);
    expect(verified.header.kid).toBe(kid);
  });

  it("exports a well-formed OKP JWK", () => {
    const jwk = jwks[0];
    expect(jwk.kty).toBe("OKP");
    expect(jwk.crv).toBe("Ed25519");
    expect(jwk.alg).toBe("EdDSA");
    expect(jwk.use).toBe("sig");
    expect(jwk.x.length).toBeGreaterThan(0);
  });

  it("rejects a tampered payload", () => {
    const jws = signCompactJws(pem, kid, "oap-admission-seal+jws", { a: 1 });
    const [h, , s] = jws.split(".");
    const forged = `${h}.${Buffer.from(JSON.stringify({ a: 2 })).toString("base64url")}.${s}`;
    expect(() =>
      verifyCompactJws(forged, jwks, "oap-admission-seal+jws"),
    ).toThrow(/signature verification failed/);
  });

  it("rejects cross-class use (typ domain separation)", () => {
    const jws = signCompactJws(pem, kid, "oap-run-grant+jwt", { run_id: "r" });
    expect(() =>
      verifyCompactJws(jws, jwks, "oap-cert-countersign+jws"),
    ).toThrow(/typ mismatch/);
  });

  it("rejects an unknown kid", () => {
    const otherPem = freshKeyPem();
    const jws = signCompactJws(otherPem, "fk-unknown", "oap-run-grant+jwt", {});
    expect(() => verifyCompactJws(jws, jwks, "oap-run-grant+jwt")).toThrow(
      /no JWKS key matches kid/,
    );
  });

  it("rejects a signature from a different key under a known kid", () => {
    const otherPem = freshKeyPem();
    // Forge: signed with another key but claiming our kid.
    const jws = signCompactJws(otherPem, kid, "oap-run-grant+jwt", { x: 1 });
    expect(() => verifyCompactJws(jws, jwks, "oap-run-grant+jwt")).toThrow(
      /signature verification failed/,
    );
  });

  it("rejects a non-Ed25519 key at sign time", () => {
    const { privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
    const rsaPem = privateKey.export({ type: "pkcs8", format: "pem" }).toString();
    expect(() => signCompactJws(rsaPem, kid, "oap-run-grant+jwt", {})).toThrow(
      /must be Ed25519/,
    );
  });

  it("rejects malformed compact JWS", () => {
    expect(() => verifyCompactJws("a.b", jwks, "oap-run-grant+jwt")).toThrow(
      /expected 3 segments/,
    );
  });
});
