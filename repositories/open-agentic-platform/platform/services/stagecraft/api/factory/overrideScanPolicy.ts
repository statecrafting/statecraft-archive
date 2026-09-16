// Spec 200 FR-005 — org-scoped policy slice that gates scanner invocations.
//
// The spec 115 precedent (`api/knowledge/extractionPolicy.ts`) is
// project-scoped; substrate rows carry only `org_id`, so the scanner
// resolves `build/policy/orgs/{orgId}.json` instead. Same deterministic
// fail-closed posture: no snapshot, unreadable snapshot, or schema
// mismatch → scanning disabled, no model call, and the run row completes
// `skipped` with an audited reason (absence of scanning is visible, never
// silent).
//
// OQ-1 (org-slice emission home) is resolved interim as a hand-deployed
// snapshot: the policy compiler emits `build/policy/projects/` only today;
// whether it grows an `orgs/` output is a spec 047 decision. The resolver
// contract here is fixed either way.

import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import log from "encore.dev/log";

export type OverrideScanPolicy = {
  scanAllowed: boolean;
  /** Pinned model id; when unset the worker falls back to its fixed
   * default. Pinning keeps verdicts comparable across orgs. */
  modelPin?: string;
  /** Per-call USD ceiling. Pre-flight estimate must fit under this. */
  costCeilingUsdPerCall: number;
  /** Per-day USD ceiling. Day-aggregate counts committed costs only (soft
   * ceiling — in-flight scans may overshoot by their estimates; accepted,
   * actual spend recorded per run row). */
  costCeilingUsdPerDay: number;
  source: "compiled_bundle" | "default_fallback";
};

export const DEFAULT_SCAN_DISABLED_POLICY: OverrideScanPolicy = {
  scanAllowed: false,
  costCeilingUsdPerCall: 0,
  costCeilingUsdPerDay: 0,
  source: "default_fallback",
};

const CACHE_TTL_MS = 30_000;

type CacheEntry = {
  policy: OverrideScanPolicy;
  loadedAt: number;
};

const cache = new Map<string, CacheEntry>();

function getPolicyDir(): string {
  if (process.env.statecraft_OVERRIDE_SCAN_POLICY_DIR) {
    return process.env.statecraft_OVERRIDE_SCAN_POLICY_DIR;
  }
  return path.resolve(process.cwd(), "build", "policy", "orgs");
}

function isPolicyShape(v: unknown): v is Omit<OverrideScanPolicy, "source"> {
  if (!v || typeof v !== "object") return false;
  const o = v as Record<string, unknown>;
  if (typeof o.scanAllowed !== "boolean") return false;
  if (typeof o.costCeilingUsdPerCall !== "number") return false;
  if (typeof o.costCeilingUsdPerDay !== "number") return false;
  if (o.modelPin != null && typeof o.modelPin !== "string") return false;
  return true;
}

async function loadPolicySnapshot(
  orgId: string,
): Promise<OverrideScanPolicy | null> {
  const filePath = path.join(getPolicyDir(), `${orgId}.json`);
  try {
    await stat(filePath);
  } catch {
    return null;
  }
  try {
    const buf = await readFile(filePath, "utf8");
    const parsed = JSON.parse(buf);
    if (!isPolicyShape(parsed)) {
      log.warn("override-scan policy snapshot schema mismatch; using fallback", {
        orgId,
        path: filePath,
      });
      return null;
    }
    return {
      scanAllowed: parsed.scanAllowed,
      modelPin: parsed.modelPin,
      costCeilingUsdPerCall: parsed.costCeilingUsdPerCall,
      costCeilingUsdPerDay: parsed.costCeilingUsdPerDay,
      source: "compiled_bundle",
    };
  } catch (err) {
    log.warn("override-scan policy snapshot read failed; using fallback", {
      orgId,
      path: filePath,
      err: err instanceof Error ? err.message : String(err),
    });
    return null;
  }
}

/**
 * Returns the override-scan policy slice for an org. 30s in-memory cache;
 * missing or malformed snapshot → scanning-disabled fallback (FR-005).
 */
export async function resolveOverrideScanPolicy(
  orgId: string,
): Promise<OverrideScanPolicy> {
  const now = Date.now();
  const cached = cache.get(orgId);
  if (cached && now - cached.loadedAt < CACHE_TTL_MS) {
    return cached.policy;
  }
  const loaded = await loadPolicySnapshot(orgId);
  const policy = loaded ?? DEFAULT_SCAN_DISABLED_POLICY;
  cache.set(orgId, { policy, loadedAt: now });
  return policy;
}

/** Visible for tests. */
export function _resetOverrideScanPolicyCacheForTesting(): void {
  cache.clear();
}
