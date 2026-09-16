import { readdir, readFile, stat } from "node:fs/promises";
import { join, relative, basename } from "node:path";
import { randomUUID } from "node:crypto";
import { parse as parseYaml } from "yaml";
import type { ArtifactKind } from "../db/schema";
import { sha256Hex } from "./substrate";


// ---------------------------------------------------------------------------
// Exclusion rules lifted from spec 088 §5
// ---------------------------------------------------------------------------

// Paths are evaluated against the repo-relative path (POSIX separators).
//
// Spec 199 FR-008 — reviewed against the OWNED factory layout
// (factory: process/ + contract/ + adapters/ + docs/). The dead
// org-specific entries (eval_framework/, REDTEAM/, Security Agent/,
// Factory Agent/…) are stripped with the retired translate-sync. Repo
// tooling and prose docs are excluded; everything the engine or the
// admission gate consumes (process/**, contract/**, adapters/**,
// upstream-map.yaml) is mirrored.
const FACTORY_SOURCE_EXCLUDES: Array<(rel: string) => boolean> = [
  (p) => p === ".git" || p.startsWith(".git/"),
  (p) => p === ".github" || p.startsWith(".github/"),
  (p) => p === ".claude" || p.startsWith(".claude/"),
  (p) => p === ".idea" || p.startsWith(".idea/"),
  (p) => p === "docs" || p.startsWith("docs/"),
  // Spec 199 FR-008: the owned repos ship a Docusaurus docs site under
  // `website/` whose static assets (favicon.ico, fonts, social cards) are
  // binary. The substrate stores bodies as UTF-8 TEXT, so a null byte in a
  // binary asset aborts the ingest INSERT (Postgres "invalid byte sequence
  // for encoding UTF8: 0x00"). `website/` is documentation, never factory
  // content; exclude it in both repos.
  (p) => p === "website" || p.startsWith("website/"),
  (p) => p === "README.md" || p === "CLAUDE.md",
  (p) => p === ".gitattributes" || p === ".gitignore" || p === ".env.github",
];

const TEMPLATE_EXCLUDES: Array<(rel: string) => boolean> = [
  (p) => p === ".git" || p.startsWith(".git/"),
  (p) => p === ".github" || p.startsWith(".github/"),
  (p) => p === ".claude" || p.startsWith(".claude/"),
  (p) => p === "node_modules" || p.startsWith("node_modules/"),
  (p) => p === "apps" || p.startsWith("apps/"),
  (p) => p === "packages" || p.startsWith("packages/"),
  (p) => p === "modules" || p.startsWith("modules/"),
  (p) => p === "scripts" || p.startsWith("scripts/"),
  (p) => p === "docker" || p.startsWith("docker/"),
  (p) => p === "docs" || p.startsWith("docs/"),
  // Spec 199 FR-008: template-encore ships its Docusaurus docs site (binary
  // favicon/fonts/images) under `website/`. Same null-byte-into-TEXT hazard
  // as the factory side; never factory content. Exclude it.
  (p) => p === "website" || p.startsWith("website/"),
  (p) => p === "README.md" || p === "CODEMAP.md" || p === "PLACEHOLDERS.md",
  (p) => p === "docker-compose.yml" || p === "eslint.config.mjs",
  (p) => p === "tsconfig.base.json" || p === "package.json",
  (p) => p === "template.json",
  (p) => /(^|\/)package-lock\.json$/.test(p),
];

// ---------------------------------------------------------------------------
// Filesystem walker — yields POSIX-relative paths for files only, respecting
// an exclusion predicate evaluated against each relative path.
// ---------------------------------------------------------------------------

async function* walk(
  root: string,
  excluded: (rel: string) => boolean
): AsyncGenerator<{ rel: string; abs: string }> {
  async function* recurse(dir: string): AsyncGenerator<{ rel: string; abs: string }> {
    const entries = await readdir(dir, { withFileTypes: true });
    for (const entry of entries) {
      const abs = join(dir, entry.name);
      const rel = relative(root, abs).split(/\\|\//).join("/");
      if (excluded(rel)) continue;
      if (entry.isDirectory()) {
        yield* recurse(abs);
      } else if (entry.isFile()) {
        yield { rel, abs };
      }
    }
  }
  yield* recurse(root);
}

async function readText(abs: string): Promise<string> {
  return readFile(abs, "utf8");
}

/**
 * Defense-in-depth for the substrate's UTF-8 TEXT body columns
 * (`upstream_body` / `user_body` / `effective_body`). A NUL byte (0x00) is a
 * valid Unicode code point but Postgres rejects it in `text`/`varchar`
 * ("invalid byte sequence for encoding UTF8: 0x00"), which aborts the ingest
 * transaction. Reading a binary file as UTF-8 turns most invalid bytes into
 * U+FFFD, but genuine NUL bytes survive, so this catches binary content the
 * path excludes above might miss. Such files are not authorable text and have
 * no business in the substrate; skip them rather than wedge the whole sync.
 */
function containsNullByte(body: string): boolean {
  return body.includes("\u0000");
}



// ---------------------------------------------------------------------------
// Legacy `legacy-factory` manifest → ACP pipeline-state
//
// Spec 112 §3.4. Bridges the 5-stage legacy manifest produced by
// `legacy-factory` into a pipeline-state.schema.yaml-conformant
// document that ACP consumers can read. Build Spec production is deferred:
// the legacy split `requirements/{ui,api}/build-spec.json` stay on disk
// and the first ACP run after translation emits a unified Build Spec
// alongside them.
//
// This function is pure: it does not read the filesystem and does not
// mutate its inputs. Callers own the upstream read (the detection crate's
// structured report carries `legacyManifest`) and the downstream write
// (the Import PR that adds `.factory/pipeline-state.json` to the repo).
// ---------------------------------------------------------------------------

export type GoaSoftwareFactoryManifest = {
  pipelineStatus?: string;
  completedAt?: string;
  factoryInputs?: Record<string, unknown>;
  stages?: Record<string, GoaStageEntry>;
  fileOwnership?: Record<string, unknown>;
  [key: string]: unknown;
};

export type GoaStageEntry = {
  status?: string;
  startedAt?: string;
  completedAt?: string;
  outputDirectory?: string;
  artifacts?: string[];
  summary?: Record<string, unknown>;
  [key: string]: unknown;
};

export type GoaWorkingState = {
  schemaVersion?: string;
  lastCompletedStage?: string;
  completedAt?: string;
  templateVariant?: string;
  factoryInputs?: Record<string, unknown>;
  [key: string]: unknown;
};

export type FactoryAdapterRow = {
  name: string;
  version: string;
  sourceSha?: string;
  manifest?: Record<string, unknown>;
};

// Schema-conformant output shape. Kept structural rather than importing a
// generated type because the Rust-owned schema is the source of truth and
// this codebase does not yet generate TS types from the YAML.
export type PipelineStateDocument = {
  schema_version: string;
  pipeline: {
    id: string;
    factory_version: string;
    started_at: string;
    updated_at: string;
    completed_at?: string;
    status: "running" | "paused" | "completed" | "failed" | "cancelled";
    adapter: { name: string; version: string };
    build_spec: { path: string; hash: string };
  };
  stages: Record<string, PipelineStageEntry>;
  audit?: Array<{
    timestamp: string;
    event:
      | "stage_confirmed"
      | "stage_rejected"
      | "feature_flagged"
      | "pipeline_paused"
      | "pipeline_resumed"
      | "adapter_overridden"
      | "manual_fix_applied";
    stage?: string;
    details?: string;
  }>;
};

export type PipelineStageEntry = {
  status: "pending" | "in_progress" | "completed" | "failed" | "skipped";
  started_at?: string;
  completed_at?: string;
  artifacts?: Array<{ path: string; type: string; hash: string }>;
};

// Legacy stage-key → ACP stage-id mapping (spec 112 §3.4).
export const LEGACY_STAGE_MAP: ReadonlyArray<[string, string]> = [
  ["stage1_businessRequirements", "business-requirements"],
  ["stage2_serviceRequirements", "service-requirements"],
  ["stage3_databaseDesign", "data-model"],
  ["stage4_apiControllers", "api-specification"],
  ["stage5_clientInterface", "ui-specification"],
];

// Status tokens the legacy manifest uses for terminal completion.
const LEGACY_TERMINAL = new Set(["PASSED", "PASS", "COMPLETE", "COMPLETED"]);

function mapLegacyStatus(
  raw: string | undefined
): PipelineStageEntry["status"] {
  if (!raw) return "pending";
  const up = raw.toUpperCase();
  if (LEGACY_TERMINAL.has(up)) return "completed";
  if (up === "FAILED" || up === "FAIL") return "failed";
  if (up === "SKIPPED") return "skipped";
  if (up === "IN_PROGRESS" || up === "RUNNING") return "in_progress";
  return "pending";
}

function inferArtifactType(path: string): string {
  const base = basename(path).toLowerCase();
  if (base.endsWith(".schema.json") || base.endsWith(".schema.yaml")) {
    return "schema";
  }
  if (base.endsWith("build-spec.json")) return "build-spec";
  if (base.endsWith(".md") || base.endsWith(".docx")) return "document";
  if (base.endsWith(".json")) return "data";
  return "artifact";
}

function selectAdapter(
  legacy: GoaSoftwareFactoryManifest,
  orgAdapters: FactoryAdapterRow[]
): { name: string; version: string } {
  // Heuristic (deterministic): prefer an adapter matching the legacy
  // factoryInputs.templateMode / templateVariant hint if one is available,
  // else the first adapter in the supplied list. Adapter identity comes
  // from the substrate's manifests (spec 199 FR-002) — there is no
  // synthetic fallback; callers guard the empty-org case (import.ts
  // raises failedPrecondition before translating).
  const inputs = legacy.factoryInputs ?? {};
  const clientStack = typeof inputs.clientTechStack === "string"
    ? inputs.clientTechStack.toLowerCase()
    : "";
  const preferred = orgAdapters.find((a) =>
    clientStack.includes("vue") && a.name.toLowerCase().includes("vue")
  );
  const picked = preferred ?? orgAdapters[0];
  if (!picked) {
    throw new Error(
      "translateLegacyManifest requires at least one org adapter; sync the factory upstream first"
    );
  }
  return { name: picked.name, version: picked.version };
}

function pickPipelineTimestamps(
  legacy: GoaSoftwareFactoryManifest,
  workingState: GoaWorkingState,
  stageEntries: Array<[string, PipelineStageEntry]>
): { started_at: string; updated_at: string; completed_at?: string } {
  const started = stageEntries
    .map(([, entry]) => entry.started_at)
    .filter((s): s is string => Boolean(s))
    .sort()[0];
  const completedCandidates = [
    legacy.completedAt,
    workingState.completedAt,
    ...stageEntries
      .map(([, entry]) => entry.completed_at)
      .filter((s): s is string => Boolean(s)),
  ].filter((s): s is string => Boolean(s));
  const completed = completedCandidates.sort().pop();
  const fallback = new Date(0).toISOString();
  const started_at = started ?? completed ?? fallback;
  const updated_at = completed ?? started_at;
  return {
    started_at,
    updated_at,
    completed_at: completed,
  };
}

/**
 * Translate a legacy `legacy-factory` manifest + working-state
 * pair into an ACP `pipeline-state.schema.yaml`-conformant document.
 *
 * Pure. Idempotent for the same inputs modulo the generated pipeline
 * UUID, which is fresh per invocation — callers that need stability
 * (e.g. re-translation during Import preview) should persist the first
 * result rather than regenerating.
 */
export function translateLegacyManifest(
  legacy: GoaSoftwareFactoryManifest,
  workingState: GoaWorkingState,
  orgAdapters: FactoryAdapterRow[]
): PipelineStateDocument {
  const stages: Record<string, PipelineStageEntry> = {};
  const stageEntries: Array<[string, PipelineStageEntry]> = [];

  // pre-flight — synthesised as completed (legacy runs presuppose it).
  const preflight: PipelineStageEntry = { status: "completed" };
  stages["pre-flight"] = preflight;
  stageEntries.push(["pre-flight", preflight]);

  // Map the five numbered legacy stages.
  const legacyStages = legacy.stages ?? {};
  let anyMapped = false;
  let anyIncomplete = false;
  for (const [legacyKey, acpId] of LEGACY_STAGE_MAP) {
    const raw = legacyStages[legacyKey];
    if (!raw) {
      const entry: PipelineStageEntry = { status: "pending" };
      stages[acpId] = entry;
      stageEntries.push([acpId, entry]);
      anyIncomplete = true;
      continue;
    }
    anyMapped = true;
    const status = mapLegacyStatus(raw.status);
    if (status !== "completed") anyIncomplete = true;
    const entry: PipelineStageEntry = { status };
    if (raw.startedAt) entry.started_at = raw.startedAt;
    if (raw.completedAt) entry.completed_at = raw.completedAt;
    if (Array.isArray(raw.artifacts) && raw.artifacts.length > 0) {
      entry.artifacts = raw.artifacts.map((p) => ({
        path: p,
        type: inferArtifactType(p),
        hash: "",
      }));
    }
    stages[acpId] = entry;
    stageEntries.push([acpId, entry]);
  }

  // adapter-handoff — synthesised from fileOwnership when present, else
  // reported as pending. This is consistent with spec 112 §3.4.
  const fileOwnership = legacy.fileOwnership;
  const handoff: PipelineStageEntry =
    fileOwnership && typeof fileOwnership === "object"
      ? { status: "completed" }
      : { status: "pending" };
  stages["adapter-handoff"] = handoff;
  stageEntries.push(["adapter-handoff", handoff]);

  // Overall pipeline status.
  let pipelineStatus: PipelineStateDocument["pipeline"]["status"];
  const legacyPipelineStatus = String(legacy.pipelineStatus ?? "").toUpperCase();
  if (!anyMapped || anyIncomplete) {
    pipelineStatus = "paused";
  } else if (legacyPipelineStatus === "COMPLETE") {
    pipelineStatus = "completed";
  } else {
    pipelineStatus = "paused";
  }

  const ts = pickPipelineTimestamps(legacy, workingState, stageEntries);
  const adapter = selectAdapter(legacy, orgAdapters);

  const document: PipelineStateDocument = {
    schema_version: "1.0.0",
    pipeline: {
      id: randomUUID(),
      factory_version: "legacy-translated",
      started_at: ts.started_at,
      updated_at: ts.updated_at,
      status: pipelineStatus,
      adapter,
      // Build Spec production is deferred. The legacy split
      // build-specs remain in place as informational artefacts; the
      // first ACP run emits a unified one. We encode this explicitly
      // rather than guessing a synthetic hash.
      build_spec: { path: "requirements/", hash: "" },
    },
    stages,
    audit: [
      {
        timestamp: ts.updated_at,
        event: "manual_fix_applied",
        details: "translated-from-legacy-factory-manifest",
      },
    ],
  };

  if (ts.completed_at && pipelineStatus === "completed") {
    document.pipeline.completed_at = ts.completed_at;
  }

  return document;
}

// ===========================================================================
// Spec 139 Phase 1 — substrate translator (verbatim mirror)
// Spec 199 — the only translator. The categorical projection emitter
// (`translateUpstreams` → "7-stage-build" / synthetic adapter) is retired;
// statecraft stores upstream bytes verbatim and serves them by kind and by
// each adapter's own manifest. Origin ids are REQUIRED inputs derived from
// the configured `factory_upstreams.source_id` (origin-from-source,
// FR-003) — there are no static origin constants.
// ===========================================================================

export type SubstrateRowDraft = {
  origin: string;
  path: string;
  kind: ArtifactKind;
  bundleId: string | null;
  upstreamSha: string;
  upstreamBody: string;
  contentHash: string;
  frontmatter: Record<string, unknown> | null;
};

export type SubstrateTranslationInput = {
  factorySourcePath: string;
  factorySourceSha: string;
  templatePath: string;
  templateSha: string;
  /** Spec 199 FR-003 — the configured `factory_upstreams.source_id`. */
  factoryOriginId: string;
  templateOriginId: string;
};

export type SubstrateTranslation = {
  rows: SubstrateRowDraft[];
  factorySourceSha: string;
  templateSourceSha: string;
  factoryOriginId: string;
  templateOriginId: string;
  /**
   * Repo-relative paths skipped because their body contains a NUL byte
   * (binary content the UTF-8 TEXT substrate cannot store). Surfaced so the
   * sync worker can log them instead of silently dropping content.
   */
  skippedBinaryPaths: string[];
};

/**
 * Strip a YAML frontmatter block (`---\n...---\n...`) from a markdown
 * body, returning the parsed frontmatter as a plain JS object plus the
 * remaining body. Returns `null` frontmatter when no block is present
 * (or when the YAML fails to parse — sync-worker logs would surface that;
 * here we degrade gracefully so substrate insert can still happen).
 */
export function extractFrontmatter(body: string): {
  frontmatter: Record<string, unknown> | null;
  bodyOnly: string;
} {
  const m = /^---\s*\r?\n([\s\S]*?)\r?\n---\s*\r?\n?([\s\S]*)$/.exec(body);
  if (!m) return { frontmatter: null, bodyOnly: body };
  try {
    const parsed = parseYaml(m[1]);
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return {
        frontmatter: parsed as Record<string, unknown>,
        bodyOnly: m[2] ?? "",
      };
    }
  } catch {
    // fall through — malformed YAML preserved as null frontmatter so the
    // sync transaction still inserts the row verbatim (the body stays
    // intact; downstream consumers can re-parse on read).
  }
  return { frontmatter: null, bodyOnly: m[2] ?? "" };
}

/**
 * Spec 139 §4.2 kind classifier. Path-based predicates always evaluate
 * before frontmatter-based ones (D-1 locked at Phase 0).
 *
 * Returns one of the 12 closed-set kinds (`governance-envelope` added by
 * spec 198 FR-012; owned-layout predicates by spec 199 FR-008). The
 * substrate row format version is `SUBSTRATE_VERSION = 1` (see
 * `substrate.ts`).
 */
export function classifyArtifactKind(
  rel: string,
  frontmatter: Record<string, unknown> | null,
): ArtifactKind {
  // -------- Path-based predicates (precedence wins) --------

  // 0. governance-envelope (spec 198 FR-012 — the process-layer admission
  //    brief; exactly one per factory source).
  if (rel === "process/governance-envelope.yaml") {
    return "governance-envelope";
  }

  // 1. contract-schema (drained first; matches legacy translator)
  if (/\.(schema)\.(json|ya?ml)$/i.test(rel)) return "contract-schema";

  // 2. pipeline-orchestrator (top-level orchestrator file in either tree;
  //    spec 199 FR-008 adds the owned 3-layer layout's home).
  if (rel === "process/agents/pipeline-orchestrator.md") {
    return "pipeline-orchestrator";
  }

  // 2b. agent (spec 199 FR-008 — owned layout: process + adapter agents
  //     classify by path, no `type:` frontmatter dependence).
  if (
    /^process\/agents\/.+\.md$/.test(rel) ||
    /^adapters\/[^/]+\/agents\/.+\.md$/.test(rel)
  ) {
    return "agent";
  }

  // 3. process-stage (path predicate wins over frontmatter `parent:`)
  if (/^process\/stages\/.+\.md$/.test(rel)) {
    return "process-stage";
  }

  // 4. sample-html
  if (/\/samples\/[^/]+\.html$/.test(rel)) return "sample-html";

  // 5. page-type-reference (D-1 locked at Phase 0 — single new kind)
  if (
    /\/page-types\/(authenticated|public)\/page-type-[^/]+\.md$/.test(rel)
  ) {
    return "page-type-reference";
  }

  // 6. adapter-manifest
  if (/^adapters\/[^/]+\/manifest\.yaml$/.test(rel)) {
    return "adapter-manifest";
  }

  // 7. pattern (adapters/<name>/patterns/**)
  if (/^adapters\/[^/]+\/patterns\//.test(rel)) return "pattern";

  // 8. invariant (adapters/<name>/validation/invariants.yaml)
  if (/^adapters\/[^/]+\/validation\/invariants\.yaml$/.test(rel)) {
    return "invariant";
  }

  // 9. reference-data: frontmatter-less reference markdown (e.g. digest.md)
  // and contract example payloads.
  if (rel.endsWith("/digest.md")) return "reference-data";
  if (/^contract\/examples\//.test(rel)) return "reference-data";

  // -------- Frontmatter-based fallbacks (only for .md) --------

  if (/\.md$/i.test(rel)) {
    if (frontmatter) {
      const t = String(frontmatter.type ?? "");
      const parent = frontmatter.parent;
      if (t === "agent" || t === "orchestrator") return "agent";
      // type: reference outside the page-types path is a reference doc
      // (e.g. svc-page-type-catalog.md). Phase 0 D-1 routes it to
      // reference-data alongside the structured JSON.
      if (t === "reference") return "reference-data";
      if (
        parent !== undefined &&
        parent !== null &&
        parent !== "none"
      ) {
        return "skill";
      }
    }
    // Default for .md without classifying frontmatter: skill.
    return "skill";
  }

  // Last-resort: reference-data (load-bearing json/text without specific
  // home). Sync-worker may emit an unclassified-artifact warning; the row
  // still lands so the operator can rebucket.
  return "reference-data";
}

/**
 * Walk the factory + template repos and emit one `SubstrateRowDraft` per
 * file. Mirrors `translateUpstreams` in walk semantics (same exclusion
 * predicates) but emits the verbatim substrate shape instead of the
 * categorical projection.
 */
export async function translateUpstreamsToSubstrate(
  opts: SubstrateTranslationInput,
): Promise<SubstrateTranslation> {
  // Verify both paths exist before doing real work — same fail-fast
  // contract as `translateUpstreams`.
  for (const [label, path] of [
    ["factory source", opts.factorySourcePath],
    ["template", opts.templatePath],
  ] as const) {
    const s = await stat(path).catch(() => null);
    if (!s || !s.isDirectory()) {
      throw new Error(`${label} path is not a directory: ${path}`);
    }
  }

  const factoryOriginId = opts.factoryOriginId;
  const templateOriginId = opts.templateOriginId;

  const rows: SubstrateRowDraft[] = [];
  const skippedBinaryPaths: string[] = [];

  for await (const { rel, abs } of walk(opts.factorySourcePath, (p) =>
    FACTORY_SOURCE_EXCLUDES.some((fn) => fn(p)),
  )) {
    const body = await readText(abs);
    if (containsNullByte(body)) {
      skippedBinaryPaths.push(rel);
      continue;
    }
    const { frontmatter } = extractFrontmatter(body);
    const kind = classifyArtifactKind(rel, frontmatter);
    rows.push({
      origin: factoryOriginId,
      path: rel,
      kind,
      bundleId: null, // bundle assignment is a sync-worker concern; Phase 1 leaves null.
      upstreamSha: opts.factorySourceSha,
      upstreamBody: body,
      contentHash: sha256Hex(body),
      frontmatter,
    });
  }

  for await (const { rel, abs } of walk(opts.templatePath, (p) =>
    TEMPLATE_EXCLUDES.some((fn) => fn(p)),
  )) {
    const body = await readText(abs);
    if (containsNullByte(body)) {
      skippedBinaryPaths.push(rel);
      continue;
    }
    const { frontmatter } = extractFrontmatter(body);
    const kind = classifyArtifactKind(rel, frontmatter);
    rows.push({
      origin: templateOriginId,
      path: rel,
      kind,
      bundleId: null,
      upstreamSha: opts.templateSha,
      upstreamBody: body,
      contentHash: sha256Hex(body),
      frontmatter,
    });
  }

  // Deterministic ordering: sort by (origin, path) so substrate rows are
  // emitted in stable order regardless of `readdir` quirks. This keeps the
  // round-trip projection's array buckets stable (for fields the legacy
  // translator already sorts by path) and helps `EXPLAIN`-friendly INSERT
  // batching.
  rows.sort((a, b) => {
    if (a.origin !== b.origin) return a.origin.localeCompare(b.origin);
    return a.path.localeCompare(b.path);
  });

  return {
    rows,
    factorySourceSha: opts.factorySourceSha,
    templateSourceSha: opts.templateSha,
    factoryOriginId,
    templateOriginId,
    skippedBinaryPaths,
  };
}
