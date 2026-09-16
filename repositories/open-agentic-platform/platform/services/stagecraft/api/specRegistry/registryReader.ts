// Spec 163 / spec 103 / spec 217: spec-spine registry subprocess wrapper.
//
// Spec 103 mandates that the compiled spec registry be read only through
// the governed consumer by orchestrated workflows. Spec 217 swapped the
// in-tree reader for the published `spec-spine` CLI: the registry is now
// the sharded `.derived/spec-registry/by-spec/*.json` tree, read via
// `spec-spine registry <verb> --repo <projectRoot>`. This module is the
// statecraft-side enforcement: every call on behalf of the Requirements
// view (FR-001..FR-006) routes through `spawnSpecSpine` below; no other
// module in `api/specRegistry/` parses the registry shards.
//
// The binary path is resolved from REGISTRY_CONSUMER_BIN (env), which now
// points at the `spec-spine` CLI. Tests pass `binaryPath` directly so they
// do not depend on the developer's ambient environment.

import { spawn } from "node:child_process";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import type {
  SpecDetail,
  SpecEdge,
  SpecListRow,
  SpecReference,
  SpecRelationships,
} from "./types";

export interface ReaderOptions {
  /** Override for REGISTRY_CONSUMER_BIN (the spec-spine CLI); tests set this. */
  binaryPath?: string;
  /** Subprocess timeout. Default 30s; spec-spine is fast. */
  timeoutMs?: number;
}

const DEFAULT_TIMEOUT_MS = 30_000;

function resolveBinary(opts: ReaderOptions): string {
  const bin = opts.binaryPath ?? process.env.REGISTRY_CONSUMER_BIN;
  if (!bin) {
    throw new Error(
      "spec-spine CLI path is not configured. Set REGISTRY_CONSUMER_BIN to the " +
        "`spec-spine` binary, or install it: " +
        "`cargo install spec-spine-cli --version 0.10.0 --locked`"
    );
  }
  return bin;
}

interface SpawnResult {
  stdout: string;
}

function spawnSpecSpine(
  bin: string,
  args: string[],
  timeoutMs: number
): Promise<SpawnResult> {
  return new Promise((resolveP, rejectP) => {
    const proc = spawn(bin, args, { stdio: ["ignore", "pipe", "pipe"] });
    const out: Buffer[] = [];
    const err: Buffer[] = [];
    proc.stdout.on("data", (d: Buffer) => out.push(d));
    proc.stderr.on("data", (d: Buffer) => err.push(d));
    const timer = setTimeout(() => proc.kill("SIGKILL"), timeoutMs).unref();
    proc.on("close", (code) => {
      clearTimeout(timer);
      if (code !== 0) {
        rejectP(
          new Error(
            `spec-spine ${args.join(" ")} exited ${code}: ${Buffer.concat(err)
              .toString("utf8")
              .slice(0, 2000)}`
          )
        );
        return;
      }
      resolveP({ stdout: Buffer.concat(out).toString("utf8") });
    });
    proc.on("error", rejectP);
  });
}

/** Shape we accept from `spec-spine registry list --json`. */
interface RawListRow {
  id: string;
  title: string;
  status: string;
  implementation: string;
  kind?: string | null;
  summary?: string | null;
  specPath: string;
  extraFrontmatter?: Record<string, unknown>;
  references?: Array<{ role?: string; unit?: unknown }>;
  category?: string[] | string | null;
  risk?: string | null;
  owner?: string | null;
  // Spec 130 relationship-graph fields — opaque arrays passed through
  // for the grouping projections. Indexed access in
  // `relationshipFieldsFor` below.
  [k: string]: unknown;
}

const RELATIONSHIP_FIELD_NAMES = [
  "establishes",
  "extends",
  "refines",
  "supersedes",
  "amends",
  "coAuthority",
  "constrains",
] as const;

function relationshipFieldsFor(raw: RawListRow): Record<string, unknown[]> {
  const out: Record<string, unknown[]> = {};
  for (const name of RELATIONSHIP_FIELD_NAMES) {
    const v = (raw as Record<string, unknown>)[name];
    if (Array.isArray(v) && v.length > 0) {
      out[name] = v;
    }
  }
  return out;
}

function projectListRow(raw: RawListRow): SpecListRow {
  const extra = (raw.extraFrontmatter ?? {}) as Record<string, unknown>;
  // Spec 217: the library carries OAP overlay keys (category/risk/owner)
  // inside extraFrontmatter, not at the top level. Read top-level first
  // (back-compat), then fall back to the overlay map.
  const rawCategory = raw.category ?? extra.category;
  const categories = Array.isArray(rawCategory)
    ? rawCategory.filter((s): s is string => typeof s === "string")
    : typeof rawCategory === "string"
      ? [rawCategory]
      : [];
  const rawRisk = raw.risk ?? extra.risk;
  const rawOwner = raw.owner ?? extra.owner;
  const hasDecompositionOrigin = Array.isArray(raw.references)
    ? raw.references.some((r) => r?.role === "decomposition-origin")
    : false;
  return {
    id: raw.id,
    title: raw.title,
    status: raw.status,
    implementation: raw.implementation,
    kind: raw.kind ?? null,
    categories,
    // Spec 164 FR-008: typed for the Development board's filter chips.
    risk: typeof rawRisk === "string" ? rawRisk : null,
    owner: typeof rawOwner === "string" ? rawOwner : null,
    summary: raw.summary ?? null,
    specPath: raw.specPath,
    extraFrontmatter: extra,
    relationshipFields: relationshipFieldsFor(raw),
    hasDecompositionOrigin,
  };
}

/** List specs from the project's spec-spine registry shards (FR-001). */
export async function listSpecs(
  repoRoot: string,
  opts: ReaderOptions = {}
): Promise<SpecListRow[]> {
  const bin = resolveBinary(opts);
  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const { stdout } = await spawnSpecSpine(
    bin,
    ["--repo", repoRoot, "registry", "list", "--json"],
    timeoutMs
  );
  const arr = JSON.parse(stdout) as RawListRow[];
  if (!Array.isArray(arr)) {
    throw new Error("spec-spine registry list --json did not return an array");
  }
  return arr.map(projectListRow).sort((a, b) => a.id.localeCompare(b.id));
}

/** Shape we accept from `spec-spine registry show <id> --json`. */
interface RawShowRecord extends RawListRow {
  references?: Array<{ role: string; unit: SpecReference["unit"] }>;
}

function stripFrontmatter(md: string): string {
  // Spec 000 grammar: frontmatter is a single leading `---` block.
  // We strip it for the rendered body so react-markdown does not
  // render YAML as a literal code block.
  if (!md.startsWith("---")) return md;
  const closing = md.indexOf("\n---", 3);
  if (closing < 0) return md;
  const after = md.indexOf("\n", closing + 4);
  return after < 0 ? "" : md.slice(after + 1);
}

/** Get one spec record + body (FR-006). */
export async function getSpecDetail(
  specId: string,
  repoRoot: string,
  projectRoot: string,
  opts: ReaderOptions = {}
): Promise<SpecDetail> {
  const bin = resolveBinary(opts);
  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const { stdout } = await spawnSpecSpine(
    bin,
    ["--repo", repoRoot, "registry", "show", specId, "--json"],
    timeoutMs
  );
  const raw = JSON.parse(stdout) as RawShowRecord;
  const list = projectListRow(raw);
  const references: SpecReference[] = Array.isArray(raw.references)
    ? raw.references
        .filter((r) => r && typeof r.role === "string" && r.unit)
        .map((r) => ({ role: r.role, unit: r.unit }))
    : [];

  let body = "";
  try {
    const raw = await readFile(join(projectRoot, list.specPath), "utf8");
    body = stripFrontmatter(raw);
  } catch {
    // A missing or unreadable spec.md is not fatal — the registry row
    // is still useful. The detail view renders an empty body banner.
    body = "";
  }

  return { ...list, body, references };
}

/**
 * Outgoing + incoming relationship edges for a spec (FR-006, spec 130).
 * Spec 217: read from `spec-spine registry relationships <id> --json`, a
 * typed spec-to-spec neighborhood, replacing the prior scrape of the
 * in-tree human-text output. The library emits outgoing edges (dependsOn /
 * supersedes / amends) plus the reverse incoming edges (dependedOnBy /
 * supersededBy / amendedBy); each projects into the {kind, otherSpec}
 * SpecEdge shape the Requirements view renders.
 */
export async function getSpecRelationships(
  specId: string,
  repoRoot: string,
  opts: ReaderOptions = {}
): Promise<SpecRelationships> {
  const bin = resolveBinary(opts);
  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const { stdout } = await spawnSpecSpine(
    bin,
    ["--repo", repoRoot, "registry", "relationships", specId, "--json"],
    timeoutMs
  );
  return parseRelationshipsJson(specId, stdout);
}

/** Shape of `spec-spine registry relationships <id> --json`. */
interface RawRelationships {
  id?: string;
  dependsOn?: string[];
  supersedes?: string[];
  amends?: string[];
  dependedOnBy?: string[];
  supersededBy?: string[];
  amendedBy?: string[];
}

function edgesFrom(list: string[] | undefined, kind: string): SpecEdge[] {
  return Array.isArray(list)
    ? list
        .filter((s): s is string => typeof s === "string" && s.length > 0)
        .map((otherSpec) => ({ kind, otherSpec }))
    : [];
}

export function parseRelationshipsJson(specId: string, json: string): SpecRelationships {
  const raw = JSON.parse(json) as RawRelationships;
  const outgoing: SpecEdge[] = [
    ...edgesFrom(raw.dependsOn, "depends_on"),
    ...edgesFrom(raw.supersedes, "supersedes"),
    ...edgesFrom(raw.amends, "amends"),
  ];
  const incoming: SpecEdge[] = [
    ...edgesFrom(raw.dependedOnBy, "depends_on"),
    ...edgesFrom(raw.supersededBy, "supersedes"),
    ...edgesFrom(raw.amendedBy, "amends"),
  ];
  return { id: specId, outgoing, incoming };
}
