// Spec 112 §6.3 — OAP project bundle types.
//
// Resolved on the OPC side from state statecraft already maintains
// (factory_adapters, factory_contracts, factory_processes, agent
// catalog). The bundle does not travel as a payload on the deep link;
// it is fetched via `fetch_project_opc_bundle` after handoff.
//
// Types are extracted here so the Tab context, panel, and inbox hook
// can share them without circular imports.

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
  status: string;
  contentHash: string;
  frontmatter: unknown;
  bodyMarkdown: string;
}

/**
 * Spec 112 §6.4 — short-lived clone token derived from spec 109 state.
 *
 * `expiresAt` is set for `github_installation` (~1h TTL) and null for
 * `project_github_pat`. The bundle returns `cloneToken: null` for
 * public-anonymous repos. A hard-resolution failure on the statecraft
 * side surfaces as a 503 instead — never as a null clone token here.
 */
export interface OpcBundleCloneToken {
  value: string;
  source: 'github_installation' | 'project_github_pat';
  expiresAt: string | null;
}

export interface OpcBundle {
  project: OpcBundleProject;
  repo: OpcBundleRepo | null;
  deepLink: string | null;
  adapter: OpcBundleAdapter | null;
  contracts: OpcBundleContract[];
  processes: OpcBundleProcess[];
  agents: OpcBundleAgent[];
  cloneToken: OpcBundleCloneToken | null;
}

/**
 * Spec 112 §6.4.4 — keychain-persisted shape. Mirrors `StoredCloneToken`
 * on the Rust side. The optional `expires_at` field uses snake_case to
 * match the JSON-encoded blob the keychain stores; date is ISO-8601.
 */
export interface StoredCloneToken {
  value: string;
  source: string;
  expires_at?: string | null;
}
