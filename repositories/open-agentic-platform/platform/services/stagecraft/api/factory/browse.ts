// Spec 199 (thin-consumer cutover) — read-only browsers for adapters /
// contracts / processes, served from `factory_artifact_substrate` BY KIND
// and by each adapter's own schema-validated manifest (FR-002/FR-004/FR-005).
// The categorical `projectSubstrateToLegacy` translation is retired; nothing
// here re-buckets content into shapes the open standard never defined.
//
// Spec 198 FR-001 / spec 199 FR-006 — the serve path honours the admission
// gate: content from a factory origin that has not filed a conformant,
// reconciled governance envelope is NOT served (fail-closed), with an
// attributable reason on the wire for the Factory UI.

import { api, APIError } from "encore.dev/api";
import log from "encore.dev/log";
import { getAuthData } from "~encore/auth";
import { parse as parseYaml } from "yaml";
import { loadSubstrateForOrg } from "./substrateBrowser";
import { isFactoryAdmitted } from "./admission";
import type { SubstrateRowDraft, SubstrateTranslation } from "./translator";

// ---------------------------------------------------------------------------
// Wire types. `id`/`name`/`version`/`sourceSha`/`syncedAt` survive from the
// spec 108 surface; detail payloads are now manifest-sourced (adapters),
// schema bodies (contracts), and kind-grouped rows (processes). Spec 199
// fixes no backward-compat constraint — web tabs update in lockstep.
// ---------------------------------------------------------------------------

export type FactoryAdmissionWire = {
  /** "admitted" | "refused" | "unevaluated" for the org's factory origin. */
  status: string;
  reason: string | null;
};

export type FactoryResourceSummary = {
  id?: string;
  name: string;
  version: string;
  sourceSha: string;
  syncedAt: string;
};

export type FactoryAdapterDetail = FactoryResourceSummary & {
  manifest: unknown;
};

export type FactoryContractDetail = FactoryResourceSummary & {
  schema: unknown;
};

/** Spec 199 FR-004 — process content is served by kind, uninterpreted:
 * kind → [{ path, contentHash }]. No orchestrator/stage/agent re-bucketing;
 * the run's governance lives in the admission envelope (spec 198). */
export type FactoryProcessDetail = FactoryResourceSummary & {
  definition: { byKind: Record<string, Array<{ path: string; contentHash: string }>> };
};

// ---------------------------------------------------------------------------
// Substrate loading + admission verdict (one round trip per request)
// ---------------------------------------------------------------------------

export type OrgView = {
  substrate: SubstrateTranslation;
  admission: { admitted: boolean; reason: string | null };
  syncedAt: string;
};

// Exported for the spec 227 module-catalog endpoint (api/factory/moduleCatalog.ts)
// so the admission gate has a single home rather than a second copy.
export async function loadOrgView(orgId: string): Promise<OrgView> {
  const substrate = await loadSubstrateForOrg(orgId);
  const admission = substrate.factoryOriginId
    ? await isFactoryAdmitted(orgId, substrate.factoryOriginId)
    : { admitted: false, reason: "no factory upstream configured" };
  return { substrate, admission, syncedAt: new Date().toISOString() };
}

/** Factory-origin rows serve only under an admitted envelope; `oap-self`
 * rows (OAP's own contract schemas) are not synced factory content and are
 * never admission-gated. */
export function servableRows(view: OrgView): SubstrateRowDraft[] {
  return view.substrate.rows.filter(
    (r) =>
      r.origin === "oap-self" ||
      (r.origin === view.substrate.factoryOriginId && view.admission.admitted),
  );
}

function parsedManifest(row: SubstrateRowDraft): Record<string, unknown> | null {
  try {
    const parsed = parseYaml(row.upstreamBody);
    return parsed && typeof parsed === "object"
      ? (parsed as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

function manifestIdentity(
  manifest: Record<string, unknown>,
): { name: string; version: string } | null {
  const adapter = manifest.adapter as Record<string, unknown> | undefined;
  const name = typeof adapter?.name === "string" ? adapter.name : null;
  const version =
    typeof adapter?.version === "string" ? adapter.version : null;
  return name ? { name, version: version ?? "0.0.0" } : null;
}

// ---------------------------------------------------------------------------
// Adapters — manifest-sourced identity (FR-002). The synthetic
// `acme-vue-node` is gone; whatever adapter-manifest rows the substrate
// carries (any origin) self-declare their identity.
// ---------------------------------------------------------------------------

export const listAdapters = api(
  { expose: true, auth: true, method: "GET", path: "/api/factory/adapters" },
  async (): Promise<{
    adapters: FactoryResourceSummary[];
    admission: FactoryAdmissionWire;
  }> => {
    const auth = getAuthData()!;
    const view = await loadOrgView(auth.orgId);
    const adapters = servableRows(view)
      .filter((r) => r.kind === "adapter-manifest")
      .flatMap<FactoryResourceSummary>((row) => {
        const manifest = parsedManifest(row);
        const identity = manifest ? manifestIdentity(manifest) : null;
        if (!identity) {
          log.warn("listAdapters: unparseable adapter manifest skipped", {
            orgId: auth.orgId,
            path: row.path,
          });
          return [];
        }
        return [
          {
            id: synthesiseId(auth.orgId, "adapter", identity.name),
            name: identity.name,
            version: identity.version,
            sourceSha: row.upstreamSha,
            syncedAt: view.syncedAt,
          },
        ];
      })
      .sort((a, b) => a.name.localeCompare(b.name));
    return {
      adapters,
      admission: admissionWire(view),
    };
  },
);

export const getAdapter = api(
  {
    expose: true,
    auth: true,
    method: "GET",
    path: "/api/factory/adapters/:name",
  },
  async (req: { name: string }): Promise<FactoryAdapterDetail> => {
    const auth = getAuthData()!;
    const view = await loadOrgView(auth.orgId);
    requireFactoryAdmitted(view, `adapter "${req.name}"`);
    for (const row of servableRows(view)) {
      if (row.kind !== "adapter-manifest") continue;
      const manifest = parsedManifest(row);
      const identity = manifest ? manifestIdentity(manifest) : null;
      if (!identity || identity.name !== req.name) continue;
      // Spec 139 (2026-06-05) guard, kept verbatim in spirit: refuse to
      // serve a manifest without `schema_version` — the OPC factory engine
      // would fail deep in startup with a cryptic parse error otherwise.
      if (typeof manifest!.schema_version !== "string") {
        log.error("getAdapter: manifest lacks schema_version", {
          orgId: auth.orgId,
          name: req.name,
          path: row.path,
        });
        throw APIError.internal(
          `adapter "${req.name}" is not configured correctly for this org`,
        );
      }
      return {
        id: synthesiseId(auth.orgId, "adapter", identity.name),
        name: identity.name,
        version: identity.version,
        sourceSha: row.upstreamSha,
        syncedAt: view.syncedAt,
        manifest,
      };
    }
    throw APIError.notFound(`adapter "${req.name}" not found`);
  },
);

// ---------------------------------------------------------------------------
// Contracts — schema bodies served as-is (FR-005).
// ---------------------------------------------------------------------------

function contractName(path: string): string {
  const base = path.split("/").pop() ?? path;
  return base.replace(/\.schema\.(json|ya?ml)$/i, "");
}

function parsedSchemaBody(row: SubstrateRowDraft): unknown {
  try {
    return row.path.endsWith(".json")
      ? JSON.parse(row.upstreamBody)
      : parseYaml(row.upstreamBody);
  } catch {
    return null;
  }
}

export const listContracts = api(
  { expose: true, auth: true, method: "GET", path: "/api/factory/contracts" },
  async (): Promise<{
    contracts: FactoryResourceSummary[];
    admission: FactoryAdmissionWire;
  }> => {
    const auth = getAuthData()!;
    const view = await loadOrgView(auth.orgId);
    const seen = new Set<string>();
    const contracts: FactoryResourceSummary[] = [];
    for (const row of servableRows(view)) {
      if (row.kind !== "contract-schema") continue;
      const name = contractName(row.path);
      if (seen.has(name)) continue;
      seen.add(name);
      contracts.push({
        name,
        version: row.upstreamSha.slice(0, 12),
        sourceSha: row.upstreamSha,
        syncedAt: view.syncedAt,
      });
    }
    contracts.sort((a, b) => a.name.localeCompare(b.name));
    return { contracts, admission: admissionWire(view) };
  },
);

export const getContract = api(
  {
    expose: true,
    auth: true,
    method: "GET",
    path: "/api/factory/contracts/:name",
  },
  async (req: { name: string }): Promise<FactoryContractDetail> => {
    const auth = getAuthData()!;
    const view = await loadOrgView(auth.orgId);
    const found = servableRows(view).find(
      (r) => r.kind === "contract-schema" && contractName(r.path) === req.name,
    );
    if (!found) {
      throw APIError.notFound(`contract "${req.name}" not found`);
    }
    return {
      name: req.name,
      version: found.upstreamSha.slice(0, 12),
      sourceSha: found.upstreamSha,
      syncedAt: view.syncedAt,
      schema: parsedSchemaBody(found),
    };
  },
);

// ---------------------------------------------------------------------------
// Processes — opaque by kind (FR-004). One process per admitted factory
// origin; its name is the envelope's declared process.id. "What is a
// process" is answered by "whatever files a valid envelope" — never by a
// statecraft-assembled categorical object.
// ---------------------------------------------------------------------------

const PROCESS_KINDS = [
  "governance-envelope",
  "pipeline-orchestrator",
  "process-stage",
  "agent",
  "skill",
] as const;

function processName(view: OrgView): string | null {
  const envelopeRow = view.substrate.rows.find(
    (r) =>
      r.origin === view.substrate.factoryOriginId &&
      r.kind === "governance-envelope",
  );
  if (!envelopeRow) return null;
  try {
    const parsed = parseYaml(envelopeRow.upstreamBody) as {
      process?: { id?: string };
    };
    return parsed?.process?.id ?? null;
  } catch {
    return null;
  }
}

export const listProcesses = api(
  { expose: true, auth: true, method: "GET", path: "/api/factory/processes" },
  async (): Promise<{
    processes: FactoryResourceSummary[];
    admission: FactoryAdmissionWire;
  }> => {
    const auth = getAuthData()!;
    const view = await loadOrgView(auth.orgId);
    const processes: FactoryResourceSummary[] = [];
    const name = processName(view);
    if (view.admission.admitted && name) {
      processes.push({
        name,
        version: view.substrate.factorySourceSha.slice(0, 12),
        sourceSha: view.substrate.factorySourceSha,
        syncedAt: view.syncedAt,
      });
    }
    return { processes, admission: admissionWire(view) };
  },
);

export const getProcess = api(
  {
    expose: true,
    auth: true,
    method: "GET",
    path: "/api/factory/processes/:name",
  },
  async (req: { name: string }): Promise<FactoryProcessDetail> => {
    const auth = getAuthData()!;
    const view = await loadOrgView(auth.orgId);
    requireFactoryAdmitted(view, `process "${req.name}"`);
    const name = processName(view);
    if (!name || name !== req.name) {
      throw APIError.notFound(`process "${req.name}" not found`);
    }
    const byKind: Record<string, Array<{ path: string; contentHash: string }>> =
      {};
    for (const row of view.substrate.rows) {
      if (row.origin !== view.substrate.factoryOriginId) continue;
      if (!(PROCESS_KINDS as readonly string[]).includes(row.kind)) continue;
      (byKind[row.kind] ??= []).push({
        path: row.path,
        contentHash: row.contentHash,
      });
    }
    return {
      name,
      version: view.substrate.factorySourceSha.slice(0, 12),
      sourceSha: view.substrate.factorySourceSha,
      syncedAt: view.syncedAt,
      definition: { byKind },
    };
  },
);

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function admissionWire(view: OrgView): FactoryAdmissionWire {
  return {
    status: view.admission.admitted ? "admitted" : "not-admitted",
    reason: view.admission.reason,
  };
}

function requireFactoryAdmitted(view: OrgView, what: string): void {
  if (!view.admission.admitted) {
    throw APIError.failedPrecondition(
      `${what} is not served: ${view.admission.reason ?? "factory not admitted (spec 198 FR-001)"}`,
    );
  }
}

/**
 * Spec 139 Phase 4 — adapters are identified by `(orgId, name)`; the
 * deterministic synthetic id preserves the spec 112 binding surface.
 */
export function synthesiseId(orgId: string, kind: string, name: string): string {
  return `synthetic-${kind}-${orgId.slice(0, 8)}-${name}`;
}

/**
 * Spec 139 Phase 4 (T090) tripwire — WARN on any read against a legacy
 * table. Kept post-cutover as a regression alarm.
 */
export function warnLegacyTableRead(table: string, callsite: string): void {
  log.warn(
    "spec-139-read-shadow: legacy table read after Phase 4 cutover",
    { table, callsite },
  );
}
