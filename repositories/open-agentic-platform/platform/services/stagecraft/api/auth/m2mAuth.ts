/**
 * Shared M2M authentication middleware for platform seams (spec 082 Phase 2, spec 087 Phase 5).
 *
 * Validates machine-to-machine requests using OIDC JWT exclusively.
 * Static token fallback removed in Phase 5 — all M2M callers must present
 * a valid client_credentials JWT with the required scope.
 *
 * M2M JWTs use client_credentials grant and carry a `scope` claim, which
 * differs from user JWTs that carry `OapClaims` (oap_user_id, github_login,
 * etc.). This middleware validates M2M tokens separately from user tokens.
 */

import { APIError } from "encore.dev/api";
import { getJwksAndIssuer } from "./rauthy.js";
import { createPublicKey, createVerify, verify as cryptoVerify } from "node:crypto";
import log from "encore.dev/log";

/** Minimal claims expected in an M2M client_credentials JWT. */
interface M2mClaims {
  sub: string;
  scope?: string;
  exp: number;
  iss?: string;
  aud?: string | string[];
}

/**
 * Validate an M2M request using OIDC JWT with static token fallback.
 * Throws APIError.unauthenticated() on failure.
 *
 * @param authorization - Raw value of the Authorization header (e.g. "Bearer <token>").
 * @param requiredScope - The OAuth2 scope the token must include (e.g. "platform:audit:write").
 */
export async function validateM2mRequest(
  authorization: string | undefined,
  requiredScope: string
): Promise<void> {
  if (!authorization) {
    throw APIError.unauthenticated("missing authorization header");
  }

  const token = authorization.startsWith("Bearer ")
    ? authorization.slice(7)
    : authorization;

  if (!token) {
    throw APIError.unauthenticated("empty bearer token");
  }

  // Validate M2M JWT — the only accepted auth mechanism (Phase 5).
  const claims = await validateM2mJwt(token);
  if (!claims) {
    throw APIError.unauthenticated("invalid or expired M2M JWT");
  }

  const scopes = claims.scope?.split(" ") ?? [];
  if (!scopes.includes(requiredScope)) {
    throw APIError.permissionDenied(`missing required scope: ${requiredScope}`);
  }
}

/**
 * Validate an M2M JWT (client_credentials grant).
 *
 * Unlike validateJwt() in rauthy.ts, this:
 * - Does NOT check audience (M2M tokens may target any resource)
 * - Returns M2mClaims (with scope) instead of OapClaims (with user fields)
 * - Still verifies issuer, expiry, and RS256 signature via JWKS
 */
export async function validateM2mJwt(token: string): Promise<M2mClaims | null> {
  // Spec 143 §12 L-008 + FU-011 Finding 1: issuer is the discovery-doc
  // value, not a string-concat. JWKS-failure posture (network, cache miss,
  // discovery-shape change) is intentionally delegated to the outer
  // try/catch below: getJwksAndIssuer() throws → catch → log.warn → return
  // null. This is the explicit M2M-path decision (FU-011 audit-step):
  // warn-level (not error) because the M2M validator is on the hot path
  // for cron-driven sweepers and would otherwise alarm on transient Rauthy
  // hiccups; rejection-on-discovery-failure is the safe default. Mirrors
  // rauthy.ts::validateJwt's reject-on-throw posture (it logs at error
  // level — the level differs deliberately, the reject behavior matches).
  try {
    const parts = token.split(".");
    if (parts.length !== 3) return null;

    const headerJson = Buffer.from(parts[0], "base64url").toString();
    const payloadJson = Buffer.from(parts[1], "base64url").toString();
    const header = JSON.parse(headerJson) as { alg: string; kid?: string };
    const payload = JSON.parse(payloadJson) as M2mClaims;

    // Check expiry
    if (!payload.exp || payload.exp < Math.floor(Date.now() / 1000)) {
      return null;
    }

    // Fetch JWKS and the canonical issuer from Rauthy's OIDC discovery doc.
    // String-concat derivation (`${rauthyUrl()}/auth/v1`) loses the
    // trailing-slash that Rauthy 0.35 publishes in `iss`, rejecting
    // otherwise-valid tokens. stripSlash normalisation mirrors
    // rauthy.ts::validateJwt:201 — the bug being closed is the divergence
    // from that sibling validator (§12 L-008).
    const stripSlash = (s: string) => s.replace(/\/+$/, "");
    const { keys, issuer: expectedIssuer } = await getJwksAndIssuer();
    const tokenIssuer = typeof payload.iss === "string" ? stripSlash(payload.iss) : "";
    const normalizedExpected = stripSlash(expectedIssuer);
    if (!tokenIssuer || tokenIssuer !== normalizedExpected) {
      log.warn("M2M JWT rejected: issuer mismatch", { iss: payload.iss, expected: expectedIssuer });
      return null;
    }

    // Verify signature using JWKS — supports RS256 (RSA) and EdDSA (Ed25519).
    const key = header.kid
      ? keys.find((k) => k.kid === header.kid)
      : keys.find((k) => k.alg === header.alg || k.use === "sig");

    if (!key) {
      log.warn("No matching JWKS key for M2M token", { kid: header.kid, alg: header.alg });
      return null;
    }

    const signatureInput = Buffer.from(`${parts[0]}.${parts[1]}`);
    const signature = Buffer.from(parts[2], "base64url");

    let valid = false;
    if (header.alg === "RS256" && key.kty === "RSA" && key.n && key.e) {
      const pubKey = jwkToPem({ n: key.n, e: key.e });
      const verifier = createVerify("RSA-SHA256");
      verifier.update(signatureInput);
      valid = verifier.verify(pubKey, signature);
    } else if (
      header.alg === "EdDSA" &&
      key.kty === "OKP" &&
      (key as { crv?: string }).crv === "Ed25519" &&
      (key as { x?: string }).x
    ) {
      const pubKey = createPublicKey({ key: key as unknown as import("node:crypto").webcrypto.JsonWebKey, format: "jwk" });
      valid = cryptoVerify(null, signatureInput, pubKey, signature);
    } else {
      log.warn("Unsupported M2M JWT alg / JWK combination", {
        alg: header.alg,
        kty: key.kty,
        crv: (key as { crv?: string }).crv,
      });
      return null;
    }

    if (!valid) {
      log.warn("M2M JWT signature verification failed", { alg: header.alg, kty: key.kty });
      return null;
    }

    return payload;
  } catch (e) {
    log.warn("M2M JWT validation error", { error: String(e) });
    return null;
  }
}

/** Convert a JWK RSA public key to PEM format. */
function jwkToPem(key: { n: string; e: string }): string {
  const n = Buffer.from(key.n, "base64url");
  const e = Buffer.from(key.e, "base64url");

  // DER encode the RSA public key
  const nBytes = encodeUnsignedInteger(n);
  const eBytes = encodeUnsignedInteger(e);
  const seq = encodeSequence(Buffer.concat([nBytes, eBytes]));
  const bitString = encodeBitString(seq);
  const algorithmIdentifier = Buffer.from(
    "300d06092a864886f70d0101010500",
    "hex"
  ); // RSA OID
  const outer = encodeSequence(
    Buffer.concat([algorithmIdentifier, bitString])
  );

  const b64 = outer.toString("base64");
  const lines = b64.match(/.{1,64}/g) || [];
  return `-----BEGIN PUBLIC KEY-----\n${lines.join("\n")}\n-----END PUBLIC KEY-----`;
}

function encodeLength(len: number): Buffer {
  if (len < 0x80) return Buffer.from([len]);
  if (len < 0x100) return Buffer.from([0x81, len]);
  return Buffer.from([0x82, (len >> 8) & 0xff, len & 0xff]);
}

function encodeUnsignedInteger(buf: Buffer): Buffer {
  // Ensure positive integer (prepend 0x00 if high bit set)
  const padded = buf[0] & 0x80 ? Buffer.concat([Buffer.from([0]), buf]) : buf;
  return Buffer.concat([Buffer.from([0x02]), encodeLength(padded.length), padded]);
}

function encodeSequence(buf: Buffer): Buffer {
  return Buffer.concat([Buffer.from([0x30]), encodeLength(buf.length), buf]);
}

function encodeBitString(buf: Buffer): Buffer {
  const content = Buffer.concat([Buffer.from([0x00]), buf]); // 0 unused bits
  return Buffer.concat([Buffer.from([0x03]), encodeLength(content.length), content]);
}
