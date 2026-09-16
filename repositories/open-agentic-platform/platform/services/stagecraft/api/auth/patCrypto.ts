/**
 * AES-256-GCM helpers for PAT storage at rest (spec 106 FR-006).
 *
 * The full CRUD surface (POST/DELETE/GET/validate `/auth/pat`) is implemented
 * in FR-006. The membership resolver depends on `decryptPat` during login.
 *
 * Key: 32 random bytes, base64-encoded, supplied through the
 * `PAT_ENCRYPTION_KEY` Encore secret. Each row uses a fresh per-row nonce
 * (`token_nonce`); ciphertext (`token_enc`) includes the GCM auth tag.
 *
 * The core `encryptWithKey`/`decryptWithKey` helpers are exported so the
 * unit test can exercise the crypto without needing the Encore secret
 * runtime binding. Production code uses `encryptPat` / `decryptPat`, which
 * load the key from the secret on every call.
 */

import { secret } from "encore.dev/config";
import { KEY_BYTES, encryptWithKey, decryptWithKey } from "./patCrypto-pure";

export { encryptWithKey, decryptWithKey } from "./patCrypto-pure";

const patEncryptionKey = secret("PAT_ENCRYPTION_KEY");

function loadKey(): Buffer {
  const raw = patEncryptionKey();
  if (!raw) {
    throw new Error("PAT_ENCRYPTION_KEY secret is not set");
  }
  const key = Buffer.from(raw, "base64");
  if (key.length !== KEY_BYTES) {
    throw new Error(
      `PAT_ENCRYPTION_KEY must decode to ${KEY_BYTES} bytes (got ${key.length}). ` +
        "Generate with: openssl rand -base64 32"
    );
  }
  return key;
}

/** Encrypt a PAT using the PAT_ENCRYPTION_KEY secret. */
export function encryptPat(plaintext: string): { tokenEnc: Buffer; tokenNonce: Buffer } {
  return encryptWithKey(loadKey(), plaintext);
}

/** Decrypt a stored PAT. Throws on tag-mismatch / key-drift. */
export function decryptPat(tokenEnc: Buffer, tokenNonce: Buffer): string {
  return decryptWithKey(loadKey(), tokenEnc, tokenNonce);
}
