// Spec 187 [[opc-e2e-auth-state-seeding]]: headless signed-in session seeding.
//
// Reaching a signed-in OPC cockpit in CI would otherwise require a full GitHub
// OAuth/PKCE flow against Rauthy (auth.rs), which has no dev bypass. But OPC's
// boot path only ever DECODES the stored session JWT's claims and never
// verifies its signature (statecraft_client.rs::decode_jwt_claims) or calls
// Rauthy's JWKS to validate it. And the mock duplex accepts any bearer. So the
// entire "signed-in" state is one OS-keychain entry holding a fake, unsigned
// JWT whose payload carries an `exp` in the future and a `custom.oap_org_id`
// claim (which is what flips `org_session_ready = has_org && sync_hello`).
//
// The keychain write goes through the `e2e_seed_session` bin (built from this
// same opc crate under `--features e2e-seed`), so it uses the exact `keyring`
// crate/version OPC reads back with. See src-tauri/src/bin/e2e_seed_session.rs.
//
// Seed BEFORE the OPC binary launches so the token is present when the Rust
// setup() and the React AuthContext read the keychain at t=0; launchOpc wires
// this ordering when passed `seedSession`.

import { spawnSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

/** Service/account the OPC app reads its session token from (mirrors
 *  keychain.rs::SERVICE_NAME / DEFAULT_USER and the statecraft_client.rs slots). */
export const KEYCHAIN_SERVICE = "dev.opc.statecraft";
export const SESSION_ACCOUNT = "session";

export interface SeedSessionOptions {
  /** `custom.oap_org_id` claim; drives `has_org`. Default "org_mock". */
  orgId?: string;
  /** `custom.oap_user_id` / `sub`. Default "user_e2e". */
  userId?: string;
  /** `custom.oap_org_slug`. Default "org-mock". */
  orgSlug?: string;
  /** `custom.github_login`. Default "e2e-bot". */
  githubLogin?: string;
  email?: string;
  name?: string;
  /** `exp - now`, seconds. Default 3600 (must outlast the fixture). */
  ttlSeconds?: number;
}

function b64url(input: string): string {
  return Buffer.from(input, "utf8").toString("base64url");
}

/**
 * Build a fake, UNSIGNED session JWT that OPC accepts on boot. The claims are
 * the only thing read (`decode_jwt_claims` is claims-only); the signature
 * segment is a fixed placeholder that is never verified.
 */
export function buildSeedJwt(opts: SeedSessionOptions = {}): string {
  const now = Math.floor(Date.now() / 1000);
  const orgId = opts.orgId ?? "org_mock";
  const userId = opts.userId ?? "user_e2e";
  const header = { alg: "none", typ: "JWT", kid: "e2e-seed" };
  const payload = {
    iss: "e2e-seed",
    sub: userId,
    iat: now,
    exp: now + (opts.ttlSeconds ?? 3600),
    email: opts.email ?? "e2e@example.test",
    name: opts.name ?? "E2E Seed User",
    // Rauthy nests the OAP attributes under `custom` (claim_str reads there
    // first, then falls back to top-level). Nesting is faithful to real tokens.
    custom: {
      oap_org_id: orgId,
      oap_user_id: userId,
      oap_org_slug: opts.orgSlug ?? "org-mock",
      github_login: opts.githubLogin ?? "e2e-bot",
    },
  };
  return `${b64url(JSON.stringify(header))}.${b64url(JSON.stringify(payload))}.${b64url("e2e-seed-signature")}`;
}

/**
 * Repo path of the built `e2e_seed_session` example (cargo release output).
 * It is a cargo `[[example]]`, not a `[[bin]]`, so it lands under
 * `target/release/examples/` (see src-tauri/Cargo.toml for why: a required-
 * features bin breaks Tauri's bundler, examples are never bundled).
 */
export function seedBinPath(platform: NodeJS.Platform = process.platform): string {
  const opcRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
  const name = platform === "win32" ? "e2e_seed_session.exe" : "e2e_seed_session";
  return join(opcRoot, "src-tauri", "target", "release", "examples", name);
}

/**
 * Write the seeded session JWT into the OS keychain so the next OPC launch boots
 * signed in. Returns the JWT and the org id it encodes (align the mock's
 * `orgId` with this for a coherent fixture). Call BEFORE launching the binary.
 */
export function seedSignedInSession(opts: SeedSessionOptions = {}): {
  jwt: string;
  orgId: string;
} {
  const jwt = buildSeedJwt(opts);
  runSeedBin(["set"], jwt);
  return { jwt, orgId: opts.orgId ?? "org_mock" };
}

/** Delete the seeded session entry (teardown; a no-op if already absent). */
export function clearSeededSession(): void {
  runSeedBin(["clear"]);
}

function runSeedBin(args: string[], stdin = ""): void {
  const bin = seedBinPath();
  const res = spawnSync(bin, args, { input: stdin, encoding: "utf8" });
  if (res.error) {
    throw new Error(
      `e2e_seed_session spawn failed (${bin}): ${res.error.message}. ` +
        "Build it with `cargo build --release --example e2e_seed_session --features e2e-seed`.",
    );
  }
  if (res.status !== 0) {
    throw new Error(
      `e2e_seed_session ${args[0]} exited ${res.status}: ${(res.stderr ?? "").trim()}`,
    );
  }
}
