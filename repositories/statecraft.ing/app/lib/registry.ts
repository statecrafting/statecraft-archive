// Types + pure helpers for the baked registry payload
// (scripts/bake-registry.mjs -> public/data/registry.json). No Node imports
// here: this module is safe to import from client components. The build-time
// disk read lives in registry.server.ts.

export interface EstablishesUnit {
  kind?: string;
  path?: string;
}

export interface SpecRecord {
  id: string;
  title: string;
  status: string;
  summary?: string;
  created?: string;
  specPath?: string;
  implementation?: string;
  dependsOn?: string[];
  establishes?: Array<EstablishesUnit | string>;
  sectionHeadings?: string[];
  unamendable?: string[];
  origin?: { retroactive?: boolean };
  shardHash?: string;
  // Tolerate unknown extra frontmatter fields across repos.
  [key: string]: unknown;
}

export interface RepoBucket {
  repo: string;
  sha: string;
  shortSha: string;
  asOf: string;
  specCount: number;
  specs: SpecRecord[];
}

export interface RegistryPayload {
  generatedAt: string;
  org: string;
  repos: RepoBucket[];
  totalSpecs: number;
}

/** The numeric prefix of a spec id ("001-site-scaffold" -> "001"). */
export function specNum(id: string): string {
  const m = /^(\d+)/.exec(id);
  return m ? m[1] : id;
}

/** Format an ISO timestamp as a bare UTC date ("2026-07-14"). */
export function formatAsOf(iso: string): string {
  return iso ? iso.slice(0, 10) : "unknown";
}

/** Link to a spec's source markdown on GitHub, pinned to the baked SHA. */
export function githubSpecUrl(
  org: string,
  repo: string,
  sha: string,
  specPath?: string
): string {
  const base = `https://github.com/${org}/${repo}`;
  return specPath ? `${base}/blob/${sha}/${specPath}` : `${base}/tree/${sha}`;
}

const CHIP_BASE =
  "inline-flex items-center rounded px-1.5 py-0.5 font-mono text-[0.7rem] leading-none";

/** Chip classes for a lifecycle `status` value. */
export function statusChip(status: string): string {
  switch (status) {
    case "approved":
      return `${CHIP_BASE} border border-primary/30 bg-primary/10 text-primary`;
    case "draft":
    case "proposed":
      return `${CHIP_BASE} border border-amber-500/30 bg-amber-500/10 text-amber-600 dark:text-amber-400`;
    default:
      return `${CHIP_BASE} border border-border bg-muted text-muted-foreground`;
  }
}

/** Chip classes for an `implementation` value. */
export function implementationChip(impl?: string): string {
  switch (impl) {
    case "complete":
      return `${CHIP_BASE} border border-emerald-500/30 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400`;
    case "in-progress":
      return `${CHIP_BASE} border border-amber-500/30 bg-amber-500/10 text-amber-600 dark:text-amber-400`;
    case "pending":
      return `${CHIP_BASE} border border-border bg-muted text-muted-foreground`;
    default:
      return `${CHIP_BASE} border border-border bg-muted text-muted-foreground`;
  }
}

export function findBucket(
  payload: RegistryPayload,
  repo: string
): RepoBucket | undefined {
  return payload.repos.find((r) => r.repo === repo);
}

export function findSpec(
  payload: RegistryPayload,
  repo: string,
  specId: string
): { bucket: RepoBucket; spec: SpecRecord } | undefined {
  const bucket = findBucket(payload, repo);
  if (!bucket) return undefined;
  const spec = bucket.specs.find((s) => s.id === specId);
  return spec ? { bucket, spec } : undefined;
}

/** Normalize an establishes unit to a display string. */
export function establishesLabel(u: EstablishesUnit | string): string {
  if (typeof u === "string") return u;
  const kind = u.kind && u.kind !== "file" ? ` (${u.kind})` : "";
  return `${u.path ?? "?"}${kind}`;
}
