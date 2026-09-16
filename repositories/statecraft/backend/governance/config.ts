/**
 * Governance service configuration: the ledger state directory, the gate
 * config (committed JSON, spec 008 §2), and the anchor signing key.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { secret } from "encore.dev/config";

/**
 * Where the tamper-evident chain lives on the container volume. The chain file
 * is the authority; CoreLedger keeps only a query index. Overridable so tests
 * and dev use a scratch dir.
 *
 * Resolved per call rather than captured at module load: ES imports evaluate
 * before test hooks run, so a module-load constant would freeze to the default
 * before a test's beforeAll can set statecraft_GOVERNANCE_STATE_DIR, silently
 * leaking the chain into the repo's ./.data/governance and making the suite
 * order- and run-count-dependent. A getter honors the override whenever it is
 * set.
 */
export function governanceStateDir(): string {
  return process.env.STATECRAFT_GOVERNANCE_STATE_DIR ?? "./.data/governance";
}

/**
 * The committed gate config v1, read once at module load. Its stable hash is
 * pinned by a test in the addon package (statecrafting spec 005), so any change
 * to this file is visible in review.
 *
 * Resolved from the app root (process.cwd()), NOT import.meta.url: enrahitu-build
 * runs the bundled app from .encore/build/combined/, so a module-relative path
 * escapes the repo and the data file is not carried into the bundle. This
 * mirrors backend/lib/secrets.ts, which reads its dev files the same way
 * (enrahitu-dev/enrahitu-build keep cwd at the app root). Overridable so tests
 * and containers can point at a different config dir.
 */
const gateConfigDir =
  process.env.STATECRAFT_GOVERNANCE_CONFIG_DIR ??
  join(process.cwd(), "backend/governance/config");

export const GATE_CONFIG_JSON: string = readFileSync(
  join(gateConfigDir, "gate.v1.json"),
  "utf8",
);

/**
 * Ed25519 anchor signing key: a base64-encoded 32-byte seed, provisioned at
 * first boot (spec 007) and injected as an Encore secret. Never on disk
 * unencrypted (spec 008 §2); only `ledgerAnchor` ever sees it.
 */
export const governanceAnchorKey = secret("GovernanceAnchorKey");
