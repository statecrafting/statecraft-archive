// Spec 220 FR-003: the platform mints the tenant's Ed25519 signing key and
// sets it as the produced repo's OAP_SIGNING_KEY Actions secret. These tests
// pin the two properties the emitter and GitHub depend on:
//   1. the minted seed is standard-base64 of exactly 32 bytes (what the
//      emitter's `decode_seed` accepts) and its public key is a real Ed25519
//      derivation of that seed;
//   2. the secret is sealed to the repo's public key with libsodium
//      `crypto_box_seal`, so GitHub (holding the box secret key) can open it
//      and the recovered plaintext is exactly the base64 seed.
//
// Pure unit test: `fetch` is stubbed, so no network and no real GitHub repo.

import { afterEach, describe, expect, test, vi } from "vitest";
import _sodium from "libsodium-wrappers";
import {
  mintTenantSigningKey,
  provisionTenantSigningKey,
  setRepoActionsSecret,
  SIGNING_KEY_SECRET_NAME,
} from "./tenantSigningKey";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("mintTenantSigningKey", () => {
  test("returns a standard-base64 32-byte seed and its Ed25519 public key", async () => {
    await _sodium.ready;
    const sodium = _sodium;
    const { seedB64, publicKeyB64 } = await mintTenantSigningKey();

    // Standard base64 (with padding) decodes to exactly 32 bytes, the shape
    // the emitter's STANDARD-base64 `decode_seed` requires.
    const seed = sodium.from_base64(seedB64, sodium.base64_variants.ORIGINAL);
    expect(seed.length).toBe(32);

    const pub = sodium.from_base64(
      publicKeyB64,
      sodium.base64_variants.ORIGINAL
    );
    expect(pub.length).toBe(32);

    // The public key is the genuine Ed25519 derivation of the seed.
    const rederived = sodium.crypto_sign_seed_keypair(seed).publicKey;
    expect(sodium.to_base64(rederived, sodium.base64_variants.ORIGINAL)).toBe(
      publicKeyB64
    );
  });

  test("mints a fresh key each call", async () => {
    const a = await mintTenantSigningKey();
    const b = await mintTenantSigningKey();
    expect(a.seedB64).not.toBe(b.seedB64);
  });
});

describe("setRepoActionsSecret", () => {
  test("seals the value to the repo public key so GitHub can open it", async () => {
    await _sodium.ready;
    const sodium = _sodium;

    // Stand in for GitHub's per-repo Actions secret box keypair.
    const box = sodium.crypto_box_keypair();
    const repoPubB64 = sodium.to_base64(
      box.publicKey,
      sodium.base64_variants.ORIGINAL
    );

    let putBody: { encrypted_value: string; key_id: string } | undefined;
    let putUrl = "";

    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init?: RequestInit) => {
        if (!init || init.method === undefined) {
          // GET public-key
          expect(url).toContain("/actions/secrets/public-key");
          return {
            ok: true,
            json: async () => ({ key_id: "kid-42", key: repoPubB64 }),
          } as unknown as Response;
        }
        // PUT secret
        putUrl = url;
        putBody = JSON.parse(init.body as string);
        return { ok: true, status: 201, text: async () => "" } as unknown as Response;
      })
    );

    await setRepoActionsSecret("tok", "acme/widget", "MY_SECRET", "hello-value");

    expect(putUrl).toContain("/repos/acme/widget/actions/secrets/MY_SECRET");
    expect(putBody?.key_id).toBe("kid-42");

    // GitHub opens the sealed box with its box secret key; the recovered
    // plaintext must be exactly the value we asked to store.
    const sealed = sodium.from_base64(
      putBody!.encrypted_value,
      sodium.base64_variants.ORIGINAL
    );
    const opened = sodium.crypto_box_seal_open(
      sealed,
      box.publicKey,
      box.privateKey
    );
    expect(sodium.to_string(opened)).toBe("hello-value");
  });

  test("throws with the GitHub status when the public-key fetch fails", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: false,
        status: 403,
        text: async () => "forbidden",
      } as unknown as Response))
    );
    await expect(
      setRepoActionsSecret("tok", "acme/widget", "X", "v")
    ).rejects.toThrow(/403/);
  });
});

describe("provisionTenantSigningKey", () => {
  test("stores an OAP_SIGNING_KEY whose opened value is a 32-byte seed", async () => {
    await _sodium.ready;
    const sodium = _sodium;
    const box = sodium.crypto_box_keypair();
    const repoPubB64 = sodium.to_base64(
      box.publicKey,
      sodium.base64_variants.ORIGINAL
    );

    let putBody: { encrypted_value: string; key_id: string } | undefined;
    let secretName = "";

    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init?: RequestInit) => {
        if (!init || init.method === undefined) {
          return {
            ok: true,
            json: async () => ({ key_id: "kid-1", key: repoPubB64 }),
          } as unknown as Response;
        }
        secretName = url.split("/actions/secrets/")[1];
        putBody = JSON.parse(init.body as string);
        return { ok: true, status: 204, text: async () => "" } as unknown as Response;
      })
    );

    const { publicKeyB64 } = await provisionTenantSigningKey("tok", "acme/widget");

    // It provisions under the emitter-resolved name.
    expect(secretName).toBe(SIGNING_KEY_SECRET_NAME);

    // The stored secret opens to a base64 seed that decodes to 32 bytes, and
    // that seed re-derives the returned public key (the full mint, seal, open
    // chain is self-consistent).
    const sealed = sodium.from_base64(
      putBody!.encrypted_value,
      sodium.base64_variants.ORIGINAL
    );
    const seedB64 = sodium.to_string(
      sodium.crypto_box_seal_open(sealed, box.publicKey, box.privateKey)
    );
    const seed = sodium.from_base64(seedB64, sodium.base64_variants.ORIGINAL);
    expect(seed.length).toBe(32);
    expect(
      sodium.to_base64(
        sodium.crypto_sign_seed_keypair(seed).publicKey,
        sodium.base64_variants.ORIGINAL
      )
    ).toBe(publicKeyB64);
  });
});
