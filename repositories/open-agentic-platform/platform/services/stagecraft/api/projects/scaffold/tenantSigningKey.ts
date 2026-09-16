/**
 * Tenant signing-key provisioning (OAP spec 220 FR-003, OQ-3).
 *
 * A tenant is a project and a project is a repo, so the platform that
 * creates the project mints the tenant's Ed25519 signing key and sets it as
 * the produced repo's `OAP_SIGNING_KEY` Actions secret at creation time.
 * The born-with CI's terminal `tenant-emit build-certificate` step
 * (spec 220 FR-002) resolves that secret and signs the governance
 * certificate with an operator key rather than the dev-only ephemeral
 * fallback (which `--require-operator-key` refuses).
 *
 * The secret VALUE is the standard-base64 encoding of the raw 32-byte
 * Ed25519 seed, matching the emitter's `decode_seed` (base64 STANDARD, with
 * padding) in `factory-engine/src/governance_certificate.rs`. The key never
 * leaves this process except as a GitHub-encrypted secret: it is minted,
 * sealed to the repo's public key (libsodium `crypto_box_seal`), and PUT to
 * the Actions secrets API. Statecraft does not persist the private seed; the
 * derived public key is returned for attribution (audit metadata) and for
 * the deferred platform-countersign / uplink (spec 220 Out of scope).
 */

import log from "encore.dev/log";
import _sodium from "libsodium-wrappers";

const GITHUB_API = "https://api.github.com";
const API_VERSION = "2022-11-28";

/** The Actions secret name the emitter resolves (spec 220 FR-003). */
export const SIGNING_KEY_SECRET_NAME = "OAP_SIGNING_KEY";

function githubHeaders(token: string): Record<string, string> {
  return {
    Authorization: `Bearer ${token}`,
    Accept: "application/vnd.github+json",
    "Content-Type": "application/json",
    "X-GitHub-Api-Version": API_VERSION,
  };
}

export interface MintedSigningKey {
  /** Standard base64 (with padding) of the raw 32-byte Ed25519 seed. */
  seedB64: string;
  /** Standard base64 (with padding) of the 32-byte Ed25519 public key. */
  publicKeyB64: string;
}

/**
 * Mint a fresh Ed25519 signing key. Returns the base64 seed (the secret
 * VALUE) and the base64 public key (attribution only). The seed encoding is
 * libsodium `base64_variants.ORIGINAL` (standard, padded), which is exactly
 * what the emitter's STANDARD-base64 `decode_seed` accepts.
 */
export async function mintTenantSigningKey(): Promise<MintedSigningKey> {
  await _sodium.ready;
  const sodium = _sodium;
  const seed = sodium.randombytes_buf(32);
  const kp = sodium.crypto_sign_seed_keypair(seed);
  return {
    seedB64: sodium.to_base64(seed, sodium.base64_variants.ORIGINAL),
    publicKeyB64: sodium.to_base64(
      kp.publicKey,
      sodium.base64_variants.ORIGINAL
    ),
  };
}

interface RepoPublicKey {
  key_id: string;
  key: string; // base64 of the repo's Actions secret public key
}

/**
 * Set an encrypted repository Actions secret. Fetches the repo's secret
 * public key, seals `value` to it with libsodium `crypto_box_seal` (the
 * GitHub-documented sealed-box construction), and PUTs the encrypted value.
 * The `/repos/{repo}/actions/secrets/*` endpoints are governed by GitHub's
 * dedicated `secrets` permission (read for the public key, write for the
 * PUT), NOT `actions`; create.ts brokers the token with `secrets: write`.
 */
export async function setRepoActionsSecret(
  token: string,
  fullName: string,
  name: string,
  value: string
): Promise<void> {
  const keyResp = await fetch(
    `${GITHUB_API}/repos/${fullName}/actions/secrets/public-key`,
    { headers: githubHeaders(token) }
  );
  if (!keyResp.ok) {
    const body = await keyResp.text();
    throw new Error(
      `Fetch Actions public key for ${fullName} failed: ${keyResp.status} ${body}`
    );
  }
  const pub = (await keyResp.json()) as RepoPublicKey;

  await _sodium.ready;
  const sodium = _sodium;
  const binKey = sodium.from_base64(pub.key, sodium.base64_variants.ORIGINAL);
  const sealed = sodium.crypto_box_seal(sodium.from_string(value), binKey);
  const encrypted_value = sodium.to_base64(
    sealed,
    sodium.base64_variants.ORIGINAL
  );

  const putResp = await fetch(
    `${GITHUB_API}/repos/${fullName}/actions/secrets/${name}`,
    {
      method: "PUT",
      headers: githubHeaders(token),
      body: JSON.stringify({ encrypted_value, key_id: pub.key_id }),
    }
  );
  if (!putResp.ok) {
    const body = await putResp.text();
    throw new Error(
      `Set Actions secret ${name} on ${fullName} failed: ${putResp.status} ${body}`
    );
  }
  // 201 = created, 204 = updated. Both are success.
  log.info("tenant Actions secret set", { fullName, name });
}

export interface ProvisionSigningKeyResult {
  /** Base64 Ed25519 public key of the minted signer (audit attribution). */
  publicKeyB64: string;
}

/**
 * Provision the tenant's signing key end-to-end: mint an Ed25519 key and set
 * it as the repo's `OAP_SIGNING_KEY` Actions secret. Returns the public key
 * for audit attribution. Throws on any GitHub API failure so the caller can
 * orphan the scaffold job on the same fail-closed path as repo create/push
 * (a produced app must not be born without a signer, spec 220 FR-003 /
 * spec 200 FR-004 posture).
 */
export async function provisionTenantSigningKey(
  token: string,
  fullName: string
): Promise<ProvisionSigningKeyResult> {
  const { seedB64, publicKeyB64 } = await mintTenantSigningKey();
  await setRepoActionsSecret(
    token,
    fullName,
    SIGNING_KEY_SECRET_NAME,
    seedB64
  );
  log.info("tenant signing key provisioned", { fullName, publicKeyB64 });
  return { publicKeyB64 };
}
