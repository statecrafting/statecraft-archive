/**
 * Pure AES-256-GCM helpers for PAT storage at rest (spec 106 FR-006).
 *
 * Split out from `patCrypto.ts` so unit tests can exercise the crypto
 * primitives without loading the Encore runtime (which `patCrypto.ts` needs
 * for the `PAT_ENCRYPTION_KEY` secret binding).
 */

import { createCipheriv, createDecipheriv, randomBytes } from "crypto";

export const KEY_BYTES = 32; // AES-256
export const NONCE_BYTES = 12; // GCM recommended
export const TAG_BYTES = 16;

export function encryptWithKey(
  key: Buffer,
  plaintext: string
): { tokenEnc: Buffer; tokenNonce: Buffer } {
  if (key.length !== KEY_BYTES) {
    throw new Error(`encryption key must be ${KEY_BYTES} bytes (got ${key.length})`);
  }
  const nonce = randomBytes(NONCE_BYTES);
  const cipher = createCipheriv("aes-256-gcm", key, nonce);
  const ciphertext = Buffer.concat([cipher.update(plaintext, "utf-8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return { tokenEnc: Buffer.concat([ciphertext, tag]), tokenNonce: nonce };
}

export function decryptWithKey(
  key: Buffer,
  tokenEnc: Buffer,
  tokenNonce: Buffer
): string {
  if (key.length !== KEY_BYTES) {
    throw new Error(`encryption key must be ${KEY_BYTES} bytes (got ${key.length})`);
  }
  if (tokenEnc.length <= TAG_BYTES) {
    throw new Error("Stored PAT ciphertext is shorter than the GCM tag size");
  }
  if (tokenNonce.length !== NONCE_BYTES) {
    throw new Error(`Stored PAT nonce is ${tokenNonce.length} bytes (expected ${NONCE_BYTES})`);
  }
  const ciphertext = tokenEnc.subarray(0, tokenEnc.length - TAG_BYTES);
  const tag = tokenEnc.subarray(tokenEnc.length - TAG_BYTES);
  const decipher = createDecipheriv("aes-256-gcm", key, tokenNonce);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString("utf-8");
}
