/**
 * The install `state` token (spec 004 §3).
 *
 * When a user asks for a tenant's install URL we hand GitHub a `state` value
 * that binds the tenantId + userId, short-lived and tamper-evident. GitHub
 * echoes it back to the /github/setup callback, where we recover the binding.
 * v1 signs it with HMAC-SHA256 over the webhook secret (spec 004 §3 permits
 * this); the signature is compared in constant time via the chassis helper.
 *
 * Format: `base64url(payload).base64url(hmac)` where payload is the JSON
 * `{ t: tenantId, u: userId, e: expEpochSeconds }`. Pure functions: the secret
 * is passed in so this is unit-testable without Encore's secret store.
 */
import { createHmac } from "node:crypto";

import { constantTimeEqual } from "../lib/csrf";

import { STATE_TTL_SECONDS } from "./config";

export interface StateBinding {
  tenantId: string;
  userId: string;
}

interface StatePayload {
  t: string;
  u: string;
  e: number;
}

function b64urlEncode(input: string): string {
  return Buffer.from(input, "utf8").toString("base64url");
}

function hmacB64url(secret: string, message: string): string {
  return createHmac("sha256", secret).update(message).digest("base64url");
}

/** Sign a binding into a state token valid for `ttlSeconds` from now. */
export function signState(
  secret: string,
  binding: StateBinding,
  ttlSeconds: number = STATE_TTL_SECONDS,
): string {
  const payload: StatePayload = {
    t: binding.tenantId,
    u: binding.userId,
    e: Math.floor(Date.now() / 1000) + ttlSeconds,
  };
  const encoded = b64urlEncode(JSON.stringify(payload));
  const sig = hmacB64url(secret, encoded);
  return `${encoded}.${sig}`;
}

/**
 * Verify and decode a state token. Returns the binding, or null on any of:
 * malformed token, bad/forged signature, or expiry. Never throws.
 */
export function verifyState(secret: string, token: string | null | undefined): StateBinding | null {
  if (!secret || !token) return null;
  const dot = token.indexOf(".");
  if (dot <= 0 || dot === token.length - 1) return null;
  const encoded = token.slice(0, dot);
  const sig = token.slice(dot + 1);

  const expected = hmacB64url(secret, encoded);
  if (!constantTimeEqual(sig, expected)) return null;

  let payload: StatePayload;
  try {
    payload = JSON.parse(Buffer.from(encoded, "base64url").toString("utf8")) as StatePayload;
  } catch {
    return null;
  }
  if (
    !payload ||
    typeof payload.t !== "string" ||
    typeof payload.u !== "string" ||
    typeof payload.e !== "number"
  ) {
    return null;
  }
  if (payload.e < Math.floor(Date.now() / 1000)) return null;
  return { tenantId: payload.t, userId: payload.u };
}
