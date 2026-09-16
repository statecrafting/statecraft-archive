// Spec 139 Phase 4 (T091) — substrate-direct browser.
// Spec 199 FR-003 — origins resolve from the org's `factory_upstreams`
// configuration (origin-from-source); the static legacy scaffold-config
// constants no longer reach the read path. A third-party source with its
// own source_id is therefore never silently filtered.
//
// Loads `factory_artifact_substrate` rows for an org into the
// `SubstrateTranslation` shape the thin-consumer serve path (`browse.ts`)
// and the admission gate (`admission.ts`) consume.

import { and, eq, inArray } from "drizzle-orm";
import { db } from "../db/drizzle";
import { factoryArtifactSubstrate, factoryUpstreams } from "../db/schema";
import {
  type SubstrateRowDraft,
  type SubstrateTranslation,
} from "./translator";

export type LoadSubstrateForOrgOptions = {
  /** Override the resolved factory origin (tests only). */
  factoryOriginId?: string;
  /** Override the resolved template origin (tests only). */
  templateOriginId?: string;
};

export type ResolvedOrigins = {
  factoryOriginId: string;
  templateOriginId: string;
};

/**
 * Spec 199 FR-003 — resolve the org's factory/template origin ids from its
 * `factory_upstreams` rows: the factory origin is the source with role
 * `orchestration` or `mixed`; the template origin is the source with role
 * `scaffold`. An unconfigured side resolves to an empty string, which
 * matches no substrate rows (fail-closed, not a constant fallback).
 */
export async function resolveOriginsForOrg(
  orgId: string,
): Promise<ResolvedOrigins> {
  const rows = await db
    .select({
      sourceId: factoryUpstreams.sourceId,
      role: factoryUpstreams.role,
    })
    .from(factoryUpstreams)
    .where(
      and(
        eq(factoryUpstreams.orgId, orgId),
        inArray(factoryUpstreams.role, ["orchestration", "mixed", "scaffold"]),
      ),
    );
  const factory = rows.find(
    (r) => r.role === "orchestration" || r.role === "mixed",
  );
  const template = rows.find((r) => r.role === "scaffold");
  return {
    factoryOriginId: factory?.sourceId ?? "",
    templateOriginId: template?.sourceId ?? "",
  };
}

/**
 * Read every active substrate row for the org's resolved factory/template
 * origins (plus `oap-self` and the spec 111 `user-authored` origin, which
 * are org-lifecycle origins, not synced sources).
 *
 * **Performance:** loads all rows for the org's origins. The current
 * corpus (~122 rows) is comfortably small. Scale past 10,000 rows would
 * warrant a kind-filtered query path.
 */
export async function loadSubstrateForOrg(
  orgId: string,
  options: LoadSubstrateForOrgOptions = {},
): Promise<SubstrateTranslation> {
  let factoryOriginId = options.factoryOriginId;
  let templateOriginId = options.templateOriginId;
  if (factoryOriginId === undefined || templateOriginId === undefined) {
    const resolved = await resolveOriginsForOrg(orgId);
    factoryOriginId ??= resolved.factoryOriginId;
    templateOriginId ??= resolved.templateOriginId;
  }

  const rows = await db
    .select({
      origin: factoryArtifactSubstrate.origin,
      path: factoryArtifactSubstrate.path,
      kind: factoryArtifactSubstrate.kind,
      bundleId: factoryArtifactSubstrate.bundleId,
      effectiveBody: factoryArtifactSubstrate.effectiveBody,
      contentHash: factoryArtifactSubstrate.contentHash,
      frontmatter: factoryArtifactSubstrate.frontmatter,
      upstreamSha: factoryArtifactSubstrate.upstreamSha,
      version: factoryArtifactSubstrate.version,
      status: factoryArtifactSubstrate.status,
    })
    .from(factoryArtifactSubstrate)
    .where(
      and(
        eq(factoryArtifactSubstrate.orgId, orgId),
        eq(factoryArtifactSubstrate.status, "active"),
      ),
    );

  const drafts: SubstrateRowDraft[] = [];
  let factorySha = "";
  let templateSha = "";
  for (const row of rows) {
    if (
      row.origin !== factoryOriginId &&
      row.origin !== templateOriginId &&
      row.origin !== "oap-self"
    ) {
      continue;
    }
    // Track the latest upstream sha per origin for `factorySourceSha` /
    // `templateSourceSha`; any row's sha for the origin is acceptable
    // since spec 108 rotated all rows on the same sync sha.
    if (row.origin === factoryOriginId && row.upstreamSha) {
      factorySha = row.upstreamSha;
    }
    if (row.origin === templateOriginId && row.upstreamSha) {
      templateSha = row.upstreamSha;
    }
    drafts.push({
      origin: row.origin,
      path: row.path,
      kind: row.kind,
      bundleId: row.bundleId,
      upstreamSha: row.upstreamSha ?? "",
      upstreamBody: row.effectiveBody,
      contentHash: row.contentHash,
      frontmatter:
        (row.frontmatter as Record<string, unknown> | null) ?? null,
    });
  }

  // Deterministic ordering matches translator.ts so serve output is
  // stable across calls.
  drafts.sort((a, b) => {
    if (a.origin !== b.origin) return a.origin.localeCompare(b.origin);
    return a.path.localeCompare(b.path);
  });

  return {
    rows: drafts,
    factorySourceSha: factorySha,
    templateSourceSha: templateSha,
    factoryOriginId: factoryOriginId ?? "",
    templateOriginId: templateOriginId ?? "",
    // Reload from stored rows: nothing is skipped on a serve-path rebuild
    // (the NUL-byte guard only applies to a live upstream walk).
    skippedBinaryPaths: [],
  };
}
