// Spec 115 FR-017 — project policy slice that gates extractor invocations.
//
// The policy compiler (spec 047 / crates/policy-kernel) emits per-project
// JSON snapshots at `build/policy/projects/{projectId}.json`. This
// resolver reads them on demand with a 30s in-memory cache and falls back
// to the deterministic-only policy when no snapshot exists for the
// project yet (brand-new projects, bundle-pending state per spec §4
// edge cases).
//
// Snapshot shape:
//   {
//     "visionAllowed":      bool,
//     "audioAllowed":       bool,
//     "modelPin":           string?    // optional Anthropic model id
//     "costCeilingUsdPerCall": number,
//     "costCeilingUsdPerDay":  number
//   }
// Anything else → schema mismatch → fall back to deterministic-only and
// log a warning.

import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import log from "encore.dev/log";

// ---------------------------------------------------------------------------
// Type
// ---------------------------------------------------------------------------

export type ExtractionPolicy = {
  visionAllowed: boolean;
  audioAllowed: boolean;
  /**
   * Pinned model id for agent extractors. When unset, the agent extractor
   * falls back to its own default. Pinning makes `promptFingerprint`
   * stable across projects.
   */
  modelPin?: string;
  /** Per-call USD ceiling (FR-018). Pre-flight estimate must fit under this. */
  costCeilingUsdPerCall: number;
  /** Per-day USD ceiling (FR-019). Day-aggregate must stay under this. */
  costCeilingUsdPerDay: number;
  /**
   * Provenance — used in audit metadata so reviewers can identify when the
   * deterministic-only fallback was applied versus a real compiled bundle.
   */
  source: "compiled_bundle" | "default_fallback";
};

// ---------------------------------------------------------------------------
// Default fallback (deterministic-only)
// ---------------------------------------------------------------------------

export const DEFAULT_DETERMINISTIC_ONLY_POLICY: ExtractionPolicy = {
  visionAllowed: false,
  audioAllowed: false,
  costCeilingUsdPerCall: 0,
  costCeilingUsdPerDay: 0,
  source: "default_fallback",
};

// ---------------------------------------------------------------------------
// Resolver
// ---------------------------------------------------------------------------

const CACHE_TTL_MS = 30_000;

type CacheEntry = {
  policy: ExtractionPolicy;
  loadedAt: number;
};

const cache = new Map<string, CacheEntry>();

function getPolicyDir(): string {
  if (process.env.statecraft_EXTRACT_POLICY_DIR) {
    return process.env.statecraft_EXTRACT_POLICY_DIR;
  }
  // Default location matches the policy compiler output (spec 047): the
  // monorepo `build/` directory, walked up from the statecraft module.
  return path.resolve(process.cwd(), "build", "policy", "projects");
}

function isPolicyShape(v: unknown): v is Omit<ExtractionPolicy, "source"> {
  if (!v || typeof v !== "object") return false;
  const o = v as Record<string, unknown>;
  if (typeof o.visionAllowed !== "boolean") return false;
  if (typeof o.audioAllowed !== "boolean") return false;
  if (typeof o.costCeilingUsdPerCall !== "number") return false;
  if (typeof o.costCeilingUsdPerDay !== "number") return false;
  if (o.modelPin != null && typeof o.modelPin !== "string") return false;
  return true;
}

async function loadPolicySnapshot(
  projectId: string,
): Promise<ExtractionPolicy | null> {
  const filePath = path.join(getPolicyDir(), `${projectId}.json`);
  try {
    await stat(filePath);
  } catch {
    return null;
  }
  try {
    const buf = await readFile(filePath, "utf8");
    const parsed = JSON.parse(buf);
    if (!isPolicyShape(parsed)) {
      log.warn("extraction policy snapshot schema mismatch; using fallback", {
        projectId,
        path: filePath,
      });
      return null;
    }
    return {
      visionAllowed: parsed.visionAllowed,
      audioAllowed: parsed.audioAllowed,
      modelPin: parsed.modelPin,
      costCeilingUsdPerCall: parsed.costCeilingUsdPerCall,
      costCeilingUsdPerDay: parsed.costCeilingUsdPerDay,
      source: "compiled_bundle",
    };
  } catch (err) {
    log.warn("extraction policy snapshot read failed; using fallback", {
      projectId,
      path: filePath,
      err: err instanceof Error ? err.message : String(err),
    });
    return null;
  }
}

/**
 * Returns the policy slice for a project. 30s in-memory cache; stale or
 * missing snapshot → deterministic-only fallback (FR-017 / spec §4 edge
 * "No policy bundle resolved for the project").
 */
export async function resolveExtractionPolicy(
  projectId: string,
): Promise<ExtractionPolicy> {
  const now = Date.now();
  const cached = cache.get(projectId);
  if (cached && now - cached.loadedAt < CACHE_TTL_MS) {
    return cached.policy;
  }
  const loaded = await loadPolicySnapshot(projectId);
  const policy = loaded ?? DEFAULT_DETERMINISTIC_ONLY_POLICY;
  cache.set(projectId, { policy, loadedAt: now });
  return policy;
}

/** Visible for tests. */
export function _resetExtractionPolicyCacheForTesting(): void {
  cache.clear();
}
