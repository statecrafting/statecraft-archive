/**
 * Spec 199 FR-002/FR-005 — the thin-consumer adapter view.
 *
 * Adapters are whatever `adapter-manifest`-kinded substrate rows declare
 * themselves to be: `name` / `version` come from the parsed manifest YAML
 * (`adapter.name` / `adapter.version`), never from injected constants or
 * path predicates. Shared by the serve path (`browse.ts`), the bind path
 * (`projects/create.ts`), the bundle (`projects/opcBundle.ts`), runs, and
 * readiness — one identity derivation, everywhere.
 */

import { parse as parseYaml } from "yaml";
import type { SubstrateRowDraft, SubstrateTranslation } from "./translator";

export type AdapterView = {
  name: string;
  version: string;
  sourceSha: string;
  origin: string;
  path: string;
  manifest: Record<string, unknown>;
};

function parseManifestRow(row: SubstrateRowDraft): AdapterView | null {
  let manifest: unknown;
  try {
    manifest = parseYaml(row.upstreamBody);
  } catch {
    return null;
  }
  if (!manifest || typeof manifest !== "object") return null;
  const m = manifest as Record<string, unknown>;
  const adapter = m.adapter as Record<string, unknown> | undefined;
  const name = typeof adapter?.name === "string" ? adapter.name : null;
  if (!name) return null;
  return {
    name,
    version:
      typeof adapter?.version === "string" ? adapter.version : "0.0.0",
    sourceSha: row.upstreamSha,
    origin: row.origin,
    path: row.path,
    manifest: m,
  };
}

/** Every self-declaring adapter in the substrate, name-sorted. */
export function listAdapterViews(
  substrate: SubstrateTranslation,
): AdapterView[] {
  return substrate.rows
    .filter((r) => r.kind === "adapter-manifest")
    .flatMap((r) => {
      const view = parseManifestRow(r);
      return view ? [view] : [];
    })
    .sort((a, b) => a.name.localeCompare(b.name));
}

export function findAdapterView(
  substrate: SubstrateTranslation,
  name: string,
): AdapterView | undefined {
  return listAdapterViews(substrate).find((a) => a.name === name);
}

/** True iff the manifest carries the `schema_version` string the OPC
 * factory engine requires (spec 139 guard; spec 199 FR-006 extends it to
 * the bundle path). */
export function manifestHasSchemaVersion(view: AdapterView): boolean {
  return typeof view.manifest.schema_version === "string";
}

/**
 * Spec 199 FR-004 — "what is a process" is answered by "whatever files a
 * valid envelope": the factory origin's process identity is the
 * `process.id` its governance envelope declares. Returns null when the
 * factory files no envelope (in which case it is inadmissible anyway).
 */
export function findEnvelopeProcess(
  substrate: SubstrateTranslation,
): { name: string; sourceSha: string } | null {
  const row = substrate.rows.find(
    (r) =>
      r.origin === substrate.factoryOriginId &&
      r.kind === "governance-envelope",
  );
  if (!row) return null;
  try {
    const parsed = parseYaml(row.upstreamBody) as {
      process?: { id?: string };
    };
    const name = parsed?.process?.id;
    return typeof name === "string" && name.length > 0
      ? { name, sourceSha: row.upstreamSha }
      : null;
  } catch {
    return null;
  }
}
