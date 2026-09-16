import { describe, expect, test } from "vitest";
import { randomBytes } from "crypto";
import { encryptWithKey, decryptWithKey } from "./patCrypto-pure";

describe("patCrypto (spec 106 FR-006)", () => {
  const key = randomBytes(32);

  test("encrypt+decrypt roundtrip recovers the original plaintext", () => {
    const plain = "ghp_" + "a".repeat(36);
    const { tokenEnc, tokenNonce } = encryptWithKey(key, plain);
    expect(tokenEnc.length).toBeGreaterThan(16);
    expect(tokenNonce.length).toBe(12);
    expect(decryptWithKey(key, tokenEnc, tokenNonce)).toBe(plain);
  });

  test("distinct calls produce distinct nonces and ciphertexts", () => {
    const plain = "github_pat_11ABCDEFG0abc";
    const a = encryptWithKey(key, plain);
    const b = encryptWithKey(key, plain);
    expect(a.tokenNonce.equals(b.tokenNonce)).toBe(false);
    expect(a.tokenEnc.equals(b.tokenEnc)).toBe(false);
    expect(decryptWithKey(key, a.tokenEnc, a.tokenNonce)).toBe(plain);
    expect(decryptWithKey(key, b.tokenEnc, b.tokenNonce)).toBe(plain);
  });

  test("tampered ciphertext fails the GCM auth tag", () => {
    const { tokenEnc, tokenNonce } = encryptWithKey(key, "ghp_" + "x".repeat(36));
    const bad = Buffer.from(tokenEnc);
    bad[0] ^= 0x01;
    expect(() => decryptWithKey(key, bad, tokenNonce)).toThrow();
  });

  test("wrong key fails the GCM auth tag", () => {
    const { tokenEnc, tokenNonce } = encryptWithKey(key, "ghp_" + "y".repeat(36));
    const otherKey = randomBytes(32);
    expect(() => decryptWithKey(otherKey, tokenEnc, tokenNonce)).toThrow();
  });

  test("rejects keys with the wrong byte length", () => {
    const shortKey = randomBytes(16);
    expect(() => encryptWithKey(shortKey, "ghp_x")).toThrow(/32 bytes/);
  });
});
