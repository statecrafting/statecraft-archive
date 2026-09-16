/**
 * OAP-owned contract schemas — substrate ingest.
 *
 * The Factory's contract schemas are OAP-internal at
 * `standards/schemas/factory/`, not tracked in the upstream repos.
 * Without this loader, the contracts surface stays empty after every sync
 * because `translateUpstreamsToSubstrate` only walks the two upstream
 * repos (neither carries `*.schema.*` files in its main tree).
 *
 * Spec 139 plan.md (Constitution Check, Principle II) commits to keeping
 * these schemas mirrored per-org through the substrate as
 * `(origin='oap-self', kind='contract-schema')`. This module emits the
 * substrate row drafts; `syncPipeline.runSyncPipeline` merges them into
 * the per-sync `substrate.rows` set so the prune/retire machinery treats
 * them like any other origin's content.
 *
 * Schema directory resolved in this order:
 *   1. `OAP_FACTORY_SCHEMAS_DIR` env var (explicit override — set this in
 *      production container images)
 *   2. Walk up from `__dirname` looking for `standards/schemas/factory/`
 *      (dev / monorepo-local execution)
 *   3. Return empty (no crash — substrate just won't carry the rows)
 */

import { readdir, readFile, stat } from "node:fs/promises";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import log from "encore.dev/log";

import { sha256Hex } from "./substrate";
import type { SubstrateRowDraft } from "./translator";

export const OAP_SELF_ORIGIN = "oap-self";

/** Stable upstream-sha stamp for OAP-self contract schemas. */
const OAP_SELF_CONTRACT_SCHEMAS_SHA = "oap-self/contract-schemas";

const MODULE_DIR = dirname(fileURLToPath(import.meta.url));

async function findSchemasDirByWalkUp(start: string): Promise<string | null> {
  let current = start;
  for (let i = 0; i < 8; i += 1) {
    const candidate = join(current, "standards", "schemas", "factory");
    const s = await stat(candidate).catch(() => null);
    if (s && s.isDirectory()) return candidate;
    const parent = dirname(current);
    if (parent === current) return null;
    current = parent;
  }
  return null;
}

async function resolveSchemasDir(): Promise<string | null> {
  const override = process.env.OAP_FACTORY_SCHEMAS_DIR;
  if (override) {
    const s = await stat(override).catch(() => null);
    if (s && s.isDirectory()) return override;
    log.warn("OAP_FACTORY_SCHEMAS_DIR set but not a directory", {
      path: override,
    });
  }
  return findSchemasDirByWalkUp(MODULE_DIR);
}

async function* walkSchemas(
  root: string,
): AsyncGenerator<{ rel: string; abs: string }> {
  async function* recurse(
    dir: string,
  ): AsyncGenerator<{ rel: string; abs: string }> {
    const entries = await readdir(dir, { withFileTypes: true });
    for (const entry of entries) {
      const abs = join(dir, entry.name);
      if (entry.isDirectory()) {
        yield* recurse(abs);
      } else if (entry.isFile() && /\.schema\.(json|ya?ml)$/.test(entry.name)) {
        const rel = relative(root, abs).split(/\\|\//).join("/");
        yield { rel, abs };
      }
    }
  }
  yield* recurse(root);
}

/**
 * Walk `standards/schemas/factory/` and emit one substrate row
 * draft per `*.schema.{json,yaml,yml}` file. The substrate path uses the
 * full repo-relative location (`standards/schemas/factory/<rel>`)
 * so it's stable across moves and identifiable in the artifact browser.
 *
 * Returns an empty array if the schemas directory cannot be located —
 * the sync still completes and the contracts surface degrades to empty
 * rather than crashing.
 */
export async function loadOapOwnedSubstrateRows(): Promise<SubstrateRowDraft[]> {
  const dir = await resolveSchemasDir();
  if (!dir) {
    log.warn(
      "OAP-owned contract schemas directory not found; substrate will not carry them",
      { searched: [process.env.OAP_FACTORY_SCHEMAS_DIR ?? "(no env)", MODULE_DIR] },
    );
    return [];
  }

  const rows: SubstrateRowDraft[] = [];
  for await (const { rel, abs } of walkSchemas(dir)) {
    const body = await readFile(abs, "utf8");
    rows.push({
      origin: OAP_SELF_ORIGIN,
      path: `standards/schemas/factory/${rel}`,
      kind: "contract-schema",
      bundleId: null,
      upstreamSha: OAP_SELF_CONTRACT_SCHEMAS_SHA,
      upstreamBody: body,
      contentHash: sha256Hex(body),
      frontmatter: null,
    });
  }
  rows.sort((a, b) => a.path.localeCompare(b.path));
  log.info("loaded OAP-owned contract schemas into substrate drafts", {
    dir,
    count: rows.length,
  });
  return rows;
}
