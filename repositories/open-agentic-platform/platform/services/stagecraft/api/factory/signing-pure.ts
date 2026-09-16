/**
 * Pure Ed25519 compact-JWS helpers for the factory signing authority
 * (spec 198 FR-014).
 *
 * Statecraft is the signing authority for three signature classes — the
 * admission seal, the run-grant, and the emission countersign — all Ed25519
 * (EdDSA) compact JWS with a `kid` header resolved against the published
 * JWKS. The classes are domain-separated via the `typ` header so a token of
 * one class can never verify as another.
 *
 * Split out from `signing.ts` so unit tests can exercise the crypto without
 * loading the Encore runtime (which `signing.ts` needs for the
 * `FACTORY_SIGNING_PRIVATE_KEY` / `FACTORY_SIGNING_KID` secret bindings).
 * Same pattern as `../auth/patCrypto-pure.ts`.
 */

import {
  createPrivateKey,
  createPublicKey,
  sign as edSign,
  verify as edVerify,
  type KeyObject,
} from "node:crypto";

/** Domain-separation values for the four signature classes (PD-1). */
export type FactoryJwsTyp =
  | "oap-admission-seal+jws"
  | "oap-run-grant+jwt"
  | "oap-cert-countersign+jws"
  | "oap-audit-segment-countersign+jws";

export type PublicJwk = {
  kty: "OKP";
  crv: "Ed25519";
  x: string;
  kid: string;
  alg: "EdDSA";
  use: "sig";
};

function b64url(data: Buffer | string): string {
  return Buffer.from(data).toString("base64url");
}

function parsePrivateKey(privateKeyPem: string): KeyObject {
  const key = createPrivateKey(privateKeyPem);
  if (key.asymmetricKeyType !== "ed25519") {
    throw new Error(
      `factory signing key must be Ed25519 (got ${key.asymmetricKeyType}). ` +
        "Generate with: openssl genpkey -algorithm ed25519",
    );
  }
  return key;
}

/** Sign a compact JWS over the JSON payload. */
export function signCompactJws(
  privateKeyPem: string,
  kid: string,
  typ: FactoryJwsTyp,
  payload: Record<string, unknown>,
): string {
  const key = parsePrivateKey(privateKeyPem);
  const header = b64url(JSON.stringify({ alg: "EdDSA", typ, kid }));
  const body = b64url(JSON.stringify(payload));
  const signature = edSign(null, Buffer.from(`${header}.${body}`), key);
  return `${header}.${body}.${signature.toString("base64url")}`;
}

/** Export the public half of an Ed25519 private key as a JWK. */
export function exportPublicJwk(privateKeyPem: string, kid: string): PublicJwk {
  // Validate the key is Ed25519 (parsePrivateKey throws otherwise). @types/node 26
  // dropped createPublicKey's KeyObject overload, so derive the public key from the
  // private-key PEM (a BinaryLike) directly; runtime behaviour is identical.
  parsePrivateKey(privateKeyPem);
  const pub = createPublicKey(privateKeyPem);
  const jwk = pub.export({ format: "jwk" }) as { kty: string; crv: string; x: string };
  if (jwk.kty !== "OKP" || jwk.crv !== "Ed25519" || !jwk.x) {
    throw new Error("unexpected JWK export shape for Ed25519 public key");
  }
  return { kty: "OKP", crv: "Ed25519", x: jwk.x, kid, alg: "EdDSA", use: "sig" };
}

export type VerifiedJws = {
  header: { alg: string; typ: FactoryJwsTyp; kid: string };
  payload: Record<string, unknown>;
};

/**
 * Verify a compact JWS against a JWKS keyset, requiring the expected
 * domain-separation `typ`. Throws on any mismatch — callers treat a throw
 * as fail-closed. Expiry (`exp`) is a claim-level concern checked by the
 * caller (the seal and countersign carry no expiry; grants do).
 */
export function verifyCompactJws(
  jws: string,
  keys: PublicJwk[],
  expectedTyp: FactoryJwsTyp,
): VerifiedJws {
  const segments = jws.split(".");
  if (segments.length !== 3) {
    throw new Error("malformed compact JWS (expected 3 segments)");
  }
  const [h, p, s] = segments;
  let header: VerifiedJws["header"];
  try {
    header = JSON.parse(Buffer.from(h, "base64url").toString("utf-8"));
  } catch {
    throw new Error("malformed JWS header");
  }
  if (header.alg !== "EdDSA") {
    throw new Error(`unexpected JWS alg ${header.alg} (expected EdDSA)`);
  }
  if (header.typ !== expectedTyp) {
    throw new Error(
      `JWS typ mismatch: got ${header.typ}, expected ${expectedTyp} (domain separation)`,
    );
  }
  const jwk = keys.find((k) => k.kid === header.kid);
  if (!jwk) {
    throw new Error(`no JWKS key matches kid ${header.kid}`);
  }
  const pub = createPublicKey({ key: jwk, format: "jwk" });
  const ok = edVerify(
    null,
    Buffer.from(`${h}.${p}`),
    pub,
    Buffer.from(s, "base64url"),
  );
  if (!ok) {
    throw new Error("JWS signature verification failed");
  }
  let payload: Record<string, unknown>;
  try {
    payload = JSON.parse(Buffer.from(p, "base64url").toString("utf-8"));
  } catch {
    throw new Error("malformed JWS payload");
  }
  return { header, payload };
}
