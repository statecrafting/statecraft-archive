// Spec 227 Stage 1 (catalog derivation): serve the create-project feature
// module catalog as a projection of the adapter's own module manifests, not a
// hand-mirrored constant. The module `manifest.json` files sync into the
// substrate under `adapters/<name>/modules/<id>/manifest.json` (the factory
// source mirrors `adapters/**`, translator.ts); they land in the catch-all
// `reference-data` kind, so this filters by PATH rather than kind. Admission
// gated via browse.ts's shared `loadOrgView`/`servableRows` so an org whose
// factory origin is not admitted gets no catalog (fail-closed), the same
// posture as the adapter/contract/process browsers (spec 198 FR-001).

import { api } from "encore.dev/api";
import log from "encore.dev/log";
import { getAuthData } from "~encore/auth";
import { parse as parseYaml } from "yaml";
import { loadOrgView, servableRows, type OrgView } from "./browse";
import type { SubstrateRowDraft } from "./translator";
import {
  deriveModuleCatalog,
  isModuleManifestPath,
  parseScaffoldProfiles,
  type ModuleDescriptor,
  type ProfileDefault,
  type RawModuleManifest,
} from "../projects/scaffold/moduleCatalog";
import { getCachedForOrg } from "./moduleCatalogCache";

/** Substrate rows that are an adapter module's `manifest.json`. */
export function moduleManifestRows(
  rows: SubstrateRowDraft[]
): SubstrateRowDraft[] {
  return rows.filter((r) => isModuleManifestPath(r.path));
}

/**
 * Derive the feature-module catalog from an already-loaded `OrgView`. Parses
 * each module `manifest.json` body as JSON; a body that fails to parse is
 * skipped with a warning rather than failing the whole catalog. Exported so a
 * caller that already holds the org's substrate (e.g. `create.ts`, which also
 * resolves the adapter from the same view) derives the catalog without a second
 * substrate round-trip.
 */
export function deriveModuleCatalogFromView(
  view: OrgView,
  orgId?: string
): ModuleDescriptor[] {
  const manifests: RawModuleManifest[] = [];
  for (const row of moduleManifestRows(servableRows(view))) {
    try {
      const parsed = JSON.parse(row.upstreamBody) as RawModuleManifest;
      if (parsed && typeof parsed.name === "string") {
        manifests.push(parsed);
      }
    } catch (err) {
      log.warn("deriveModuleCatalogFromView: unparseable module manifest skipped", {
        orgId,
        path: row.path,
        cause: err instanceof Error ? err.message : String(err),
      });
    }
  }
  return deriveModuleCatalog(manifests);
}

/**
 * Project the org's per-profile scaffold defaults from the single admitted
 * `adapter-manifest` row's `scaffold.profiles[]` (spec 227 Stage 2). Each entry
 * carries the profile id, the Build Spec `variant` it maps to, its default
 * modules (internal ships `["user-management"]`), and the informational
 * `auth_driver`. A missing or unparseable manifest yields `[]` (the form
 * degrades to no profile defaults rather than failing).
 */
export function deriveProfileDefaultsFromView(
  view: OrgView,
  orgId?: string
): ProfileDefault[] {
  const row = servableRows(view).find((r) => r.kind === "adapter-manifest");
  if (!row) return [];
  let manifest: unknown;
  try {
    manifest = parseYaml(row.upstreamBody);
  } catch (err) {
    log.warn("deriveProfileDefaultsFromView: unparseable adapter manifest skipped", {
      orgId,
      path: row.path,
      cause: err instanceof Error ? err.message : String(err),
    });
    return [];
  }
  return parseScaffoldProfiles(manifest);
}

/**
 * The create-project catalog bundle returned by the loader endpoint: the
 * feature-module catalog and the per-profile defaults, both derived from one
 * admitted OrgView.
 */
export interface CreateCatalogBundle {
  modules: ModuleDescriptor[];
  profiles: ProfileDefault[];
}

/** Derive both projections from one OrgView (spec 227). */
export function deriveCreateCatalogFromView(
  view: OrgView,
  orgId?: string
): CreateCatalogBundle {
  return {
    modules: deriveModuleCatalogFromView(view, orgId),
    profiles: deriveProfileDefaultsFromView(view, orgId),
  };
}

/**
 * Cached front door for the create-project catalog bundle, used by the
 * `GET /api/factory/module-catalog` endpoint (the create-project page loader).
 * The bundle changes only when the org's factory origin re-syncs, so a
 * short-TTL per-org cache (see moduleCatalogCache) reuses a recent derivation
 * instead of a substrate load + admission check on every page view. The create
 * path does not go through here: it loads one `OrgView` and derives the catalog
 * and profiles from it directly, threading the same substrate into adapter
 * resolution (ai-review on #533).
 */
async function loadCreateCatalogForOrg(
  orgId: string
): Promise<CreateCatalogBundle> {
  return getCachedForOrg("create-catalog", orgId, async () =>
    deriveCreateCatalogFromView(await loadOrgView(orgId), orgId)
  );
}

export const getModuleCatalog = api(
  {
    expose: true,
    auth: true,
    method: "GET",
    path: "/api/factory/module-catalog",
  },
  async (): Promise<CreateCatalogBundle> => {
    const auth = getAuthData()!;
    return loadCreateCatalogForOrg(auth.orgId);
  },
);
