/**
 * Factory signing authority — secret-bound wrapper (spec 198 FR-014).
 *
 * Statecraft holds the only signing keys in the trust fabric: OPC and every
 * agent are keyless, categorically (ASI10 m6 — the orchestrator mediates
 * signing). Keys live platform-side as Encore secrets; HSM/KMS custody is a
 * deployment-profile obligation (K8s Secret on Hetzner, KeyVault-backed on
 * AKS), not a contract field.
 *
 * Generate a keypair:
 *   openssl genpkey -algorithm ed25519
 * and set `FACTORY_SIGNING_PRIVATE_KEY` to the PKCS#8 PEM and
 * `FACTORY_SIGNING_KID` to a short stable key id (e.g. "fk-2026-06").
 * Rotation: introduce the new key under a new kid, keep the old public key
 * in `FACTORY_SIGNING_PREVIOUS_PUBLIC_JWK` (JSON) until outstanding grants
 * and seals have aged out.
 */

import { secret } from "encore.dev/config";
import {
  exportPublicJwk,
  signCompactJws,
  type FactoryJwsTyp,
  type PublicJwk,
} from "./signing-pure";

export type { FactoryJwsTyp, PublicJwk } from "./signing-pure";
export { verifyCompactJws } from "./signing-pure";

const factorySigningPrivateKey = secret("FACTORY_SIGNING_PRIVATE_KEY");
const factorySigningKid = secret("FACTORY_SIGNING_KID");
const factorySigningPreviousPublicJwk = secret(
  "FACTORY_SIGNING_PREVIOUS_PUBLIC_JWK",
);

function loadKey(): { privateKeyPem: string; kid: string } {
  let privateKeyPem: string | undefined;
  let kid: string | undefined;
  try {
    privateKeyPem = factorySigningPrivateKey();
    kid = factorySigningKid();
  } catch {
    // unset Encore secret — fall through to the env fallback
  }
  // Env fallback for `encore test` (throwaway keypairs) and first-boot
  // bootstrap. Deployed environments use the Encore secrets.
  privateKeyPem ||= process.env.FACTORY_SIGNING_PRIVATE_KEY;
  kid ||= process.env.FACTORY_SIGNING_KID;
  if (!privateKeyPem || !kid) {
    throw new Error(
      "factory signing authority is not configured: set FACTORY_SIGNING_PRIVATE_KEY " +
        "(PKCS#8 PEM, `openssl genpkey -algorithm ed25519`) and FACTORY_SIGNING_KID",
    );
  }
  return { privateKeyPem, kid };
}

/** Whether the signing authority is configured (admission still records,
 * but seals/grants cannot be issued without it — fail closed at use). */
export function signingConfigured(): boolean {
  try {
    loadKey();
    return true;
  } catch {
    return false;
  }
}

/** Sign a payload as the platform, with class-level domain separation. */
export function signFactoryJws(
  typ: FactoryJwsTyp,
  payload: Record<string, unknown>,
): { jws: string; kid: string } {
  const { privateKeyPem, kid } = loadKey();
  return { jws: signCompactJws(privateKeyPem, kid, typ, payload), kid };
}

/** The published keyset: current key, plus the previous public key during
 * `kid` rotation if configured. */
export function factoryJwks(): { keys: PublicJwk[] } {
  const { privateKeyPem, kid } = loadKey();
  const keys: PublicJwk[] = [exportPublicJwk(privateKeyPem, kid)];
  try {
    const previous = factorySigningPreviousPublicJwk();
    if (previous) {
      const parsed = JSON.parse(previous) as PublicJwk;
      if (parsed.kty === "OKP" && parsed.crv === "Ed25519" && parsed.kid && parsed.x) {
        keys.push({ ...parsed, alg: "EdDSA", use: "sig" });
      }
    }
  } catch {
    // rotation key is optional; a missing/malformed value never breaks the keyset
  }
  return { keys };
}
