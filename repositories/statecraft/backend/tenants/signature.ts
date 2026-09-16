/**
 * GitHub webhook signature verification (spec 004 §3).
 *
 * GitHub signs each delivery with HMAC-SHA256 over the exact request body and
 * sends it as `X-Hub-Signature-256: sha256=<hex>`. We recompute over the raw
 * body BYTES (never the re-encoded JSON, which could differ) and compare in
 * constant time. A missing signature, an unset secret, or any mismatch fails
 * closed. Pure function: secret passed in, so it is unit-testable.
 */
import { createHmac } from "node:crypto";

import { constantTimeEqual } from "../lib/csrf";

export function verifyWebhookSignature(
  rawBody: Buffer,
  signatureHeader: string | undefined,
  secret: string,
): boolean {
  if (!secret || !signatureHeader) return false;
  const expected = `sha256=${createHmac("sha256", secret).update(rawBody).digest("hex")}`;
  return constantTimeEqual(signatureHeader, expected);
}
