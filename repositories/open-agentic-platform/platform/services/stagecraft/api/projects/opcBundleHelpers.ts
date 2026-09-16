// Spec 112 §6.3 — pure helpers for the Open-in-OPC bundle endpoint.
//
// Kept free of the Encore native runtime so unit tests can exercise the
// shape-mapping logic without standing up Postgres. The mirror pattern
// used by import.ts / importHelpers.ts.

import { buildProjectOpenDeepLink } from "./scaffold/deepLink";

export interface BundleProjectInput {
  id: string;
  name: string;
  slug: string;
  orgId: string;
  factoryAdapterId: string | null;
}

export interface BundleRepoInput {
  githubOrg: string;
  repoName: string;
  defaultBranch: string;
}

export interface BundleAdapterInput {
  id: string;
  name: string;
  version: string;
  sourceSha: string;
  syncedAt: Date;
  manifest: unknown;
}

export interface BundleContractInput {
  name: string;
  version: string;
  sourceSha: string;
  syncedAt: Date;
  schema: unknown;
}

export interface BundleProcessInput {
  name: string;
  version: string;
  sourceSha: string;
  syncedAt: Date;
  definition: unknown;
}

export interface BundleAgentInput {
  id: string;
  name: string;
  version: number;
  contentHash: string;
  frontmatter: unknown;
  bodyMarkdown: string;
}

export interface OpcBundleProject {
  id: string;
  name: string;
  slug: string;
  orgId: string;
}

export interface OpcBundleRepo {
  cloneUrl: string;
  githubOrg: string;
  repoName: string;
  defaultBranch: string;
}

export interface OpcBundleAdapter {
  id: string;
  name: string;
  version: string;
  sourceSha: string;
  syncedAt: string;
  manifest: unknown;
}

export interface OpcBundleContract {
  name: string;
  version: string;
  sourceSha: string;
  syncedAt: string;
  schema: unknown;
}

export interface OpcBundleProcess {
  name: string;
  version: string;
  sourceSha: string;
  syncedAt: string;
  definition: unknown;
}

export interface OpcBundleAgent {
  id: string;
  name: string;
  version: number;
  status: "published";
  contentHash: string;
  frontmatter: unknown;
  bodyMarkdown: string;
}

/**
 * Spec 112 §6.4 — short-lived clone token derived from spec 109 state.
 *
 * The bundle returns a token OPC threads into the git clone subprocess
 * (`https://x-access-token:<value>@…`) and into the factory engine
 * launch as `GITHUB_TOKEN`. The long-lived PAT itself never crosses
 * Statecraft → OPC except in the `project_github_pat` branch, where
 * GitHub does not offer a derived short-lived form (§10 risk).
 *
 * `expiresAt` is set for `github_installation` (≈1h TTL) and null for
 * `project_github_pat`. Public-anonymous resolution returns null at
 * the field level — null means "clone anonymously", not "resolution
 * failed". A resolver hard failure surfaces as 503 from the endpoint.
 */
export interface OpcBundleCloneToken {
  value: string;
  source: "github_installation" | "project_github_pat";
  expiresAt: string | null;
}

/**
 * Spec 198 FR-014 — the standing admission for the org's factory origin,
 * with the platform's admission seal (compact JWS, Ed25519, kid resolved
 * against `/api/factory/.well-known/jwks.json`). The OPC engine verifies
 * the seal before trusting any factory content in this bundle (ASI04 m1);
 * a null `sealJws` is an unsealed admission and is refused fail-closed.
 * Null `admission` means the bundle carries no admitted factory content.
 */
/** Spec 198 FR-013(c) — one override the run will consume; the engine
 * binds these into the governance certificate at emission. Mirrors
 * `admission.ts::ConsumedOverride` (same wire shape, camelCase). */
export interface OpcBundleConsumedOverride {
  artifactId: string;
  path: string;
  contentHash: string;
  author: string | null;
  modifiedAt: string | null;
  verified: boolean;
  verifiedBy: string | null;
}

export interface OpcBundleAdmission {
  origin: string;
  envelopeHash: string | null;
  sealJws: string | null;
  /** Spec 198 FR-013(c) — overrides active on the admitted factory's
   * content at bundle assembly. Already predicate-checked: when the
   * admitted envelope declares `overrides.require_verified: true`, an
   * unverified override fails the bundle request instead of riding here. */
  consumedOverrides: OpcBundleConsumedOverride[];
}

export interface OpcBundleResponse {
  project: OpcBundleProject;
  repo: OpcBundleRepo | null;
  deepLink: string | null;
  adapter: OpcBundleAdapter | null;
  contracts: OpcBundleContract[];
  processes: OpcBundleProcess[];
  agents: OpcBundleAgent[];
  cloneToken: OpcBundleCloneToken | null;
  admission: OpcBundleAdmission | null;
}

/**
 * Compose the bundle from raw DB rows. No I/O. Re-exposes
 * buildProjectOpenDeepLink with the project_id + clone URL the bundle
 * uses; OPC and the web UI both rely on the same string.
 *
 * `cloneToken` is resolved by the caller (the API handler) before
 * invocation — keeping this helper pure means the unit tests can
 * exercise shape-mapping without standing up the App-broker flow.
 */
export function buildOpcBundle(input: {
  project: BundleProjectInput;
  repo: BundleRepoInput | null;
  adapter: BundleAdapterInput | null;
  contracts: BundleContractInput[];
  processes: BundleProcessInput[];
  agents: BundleAgentInput[];
  cloneToken: OpcBundleCloneToken | null;
  admission: OpcBundleAdmission | null;
}): OpcBundleResponse {
  const repo = input.repo ? toBundleRepo(input.repo) : null;
  return {
    project: {
      id: input.project.id,
      name: input.project.name,
      slug: input.project.slug,
      orgId: input.project.orgId,
    },
    repo,
    deepLink: repo
      ? buildProjectOpenDeepLink({
          projectId: input.project.id,
          cloneUrl: repo.cloneUrl,
        })
      : null,
    adapter: input.adapter ? toBundleAdapter(input.adapter) : null,
    contracts: input.contracts.map(toBundleContract),
    processes: input.processes.map(toBundleProcess),
    agents: input.agents.map(toBundleAgent),
    cloneToken: input.cloneToken,
    admission: input.admission,
  };
}

function toBundleRepo(r: BundleRepoInput): OpcBundleRepo {
  return {
    cloneUrl: cloneUrlFor(r.githubOrg, r.repoName),
    githubOrg: r.githubOrg,
    repoName: r.repoName,
    defaultBranch: r.defaultBranch,
  };
}

function toBundleAdapter(a: BundleAdapterInput): OpcBundleAdapter {
  return {
    id: a.id,
    name: a.name,
    version: a.version,
    sourceSha: a.sourceSha,
    syncedAt: a.syncedAt.toISOString(),
    manifest: a.manifest,
  };
}

function toBundleContract(c: BundleContractInput): OpcBundleContract {
  return {
    name: c.name,
    version: c.version,
    sourceSha: c.sourceSha,
    syncedAt: c.syncedAt.toISOString(),
    schema: c.schema,
  };
}

function toBundleProcess(p: BundleProcessInput): OpcBundleProcess {
  return {
    name: p.name,
    version: p.version,
    sourceSha: p.sourceSha,
    syncedAt: p.syncedAt.toISOString(),
    definition: p.definition,
  };
}

function toBundleAgent(a: BundleAgentInput): OpcBundleAgent {
  return {
    id: a.id,
    name: a.name,
    version: a.version,
    status: "published",
    contentHash: a.contentHash,
    frontmatter: a.frontmatter,
    bodyMarkdown: a.bodyMarkdown,
  };
}

export function cloneUrlFor(githubOrg: string, repoName: string): string {
  return `https://github.com/${githubOrg}/${repoName}.git`;
}
