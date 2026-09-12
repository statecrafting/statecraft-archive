// The Statecrafting product family: the source of truth for repo names, roles,
// licenses, and URLs used by the site chrome and the registry viewer. Every
// license here is checkable against the LICENSE file in the named repo.

export const ORG = "statecrafting";
export const ORG_URL = `https://github.com/${ORG}`;

export interface RepoMeta {
  /** GitHub repo name under the org (matches the baked registry payload's `repo`). */
  repo: string;
  /** Display name. */
  name: string;
  /** SPDX license id, or "" when the repo carries no license (e.g. this site). */
  license: string;
  /** One-line role in the family. */
  role: string;
  /** GitHub URL. */
  url: string;
}

// Keyed lookup covering every repo the site references (registry sources + the
// governance toolchain + this site itself).
export const REPO_META: Record<string, RepoMeta> = {
  statecraft: {
    repo: "statecraft",
    name: "Statecraft",
    license: "AGPL-3.0",
    role: "the governed delivery control plane",
    url: `${ORG_URL}/statecraft`,
  },
  enrahitu: {
    repo: "enrahitu",
    name: "enrahitu",
    license: "Apache-2.0",
    role: "the EnRaHiTu template chassis (Encore.ts + rauthy + hiqlite + Turso)",
    url: `${ORG_URL}/enrahitu`,
  },
  "statecraft-cli": {
    repo: "statecraft-cli",
    name: "statecraft-cli",
    license: "Apache-2.0",
    role: "the CLI, the MCP server, and the local delivery engine they drive",
    url: `${ORG_URL}/statecraft-cli`,
  },
  "spec-spine": {
    repo: "spec-spine",
    name: "spec-spine",
    license: "Apache-2.0",
    role: "the spec-governance toolchain everything above is governed by",
    url: `${ORG_URL}/spec-spine`,
  },
  "tenant-emit": {
    repo: "tenant-emit",
    name: "tenant-emit",
    license: "Apache-2.0",
    role: "the tenant certificate emitter: signs a produced app's governance certificate",
    url: `${ORG_URL}/tenant-emit`,
  },
  "tenant-tail": {
    repo: "tenant-tail",
    name: "tenant-tail",
    license: "Apache-2.0",
    role: "the tenant certificate verifier: re-checks the factory's paperwork, no trust in the producer",
    url: `${ORG_URL}/tenant-tail`,
  },
  "action-gate": {
    repo: "action-gate",
    name: "action-gate",
    license: "Apache-2.0",
    role: "a pure, deterministic decision gate: evaluate(context, checks) returns Allow, Deny, or Degrade",
    url: `${ORG_URL}/action-gate`,
  },
  "attest-ledger": {
    repo: "attest-ledger",
    name: "attest-ledger",
    license: "Apache-2.0",
    role: "a tamper-evident record ledger: append-only, hash-linked, Ed25519-signed, with an independent verifier",
    url: `${ORG_URL}/attest-ledger`,
  },
  "canonical-keysort-json": {
    repo: "canonical-keysort-json",
    name: "canonical-keysort-json",
    license: "Apache-2.0",
    role: "deterministic canonical JSON: a lexicographic key sort at the serialization boundary, so record hashes agree",
    url: `${ORG_URL}/canonical-keysort-json`,
  },
  "trust-window": {
    repo: "trust-window",
    name: "trust-window",
    license: "Apache-2.0",
    role: "a rolling-window trust scorer: weighted samples map to a graduated privilege level",
    url: `${ORG_URL}/trust-window`,
  },
  statecrafting: {
    repo: "statecrafting",
    name: "statecrafting",
    license: "Apache-2.0",
    role: "the shared native packages: the @statecrafting/* napi addons and the Encore build toolchain",
    url: `${ORG_URL}/statecrafting`,
  },
  "statecraft.ing": {
    repo: "statecraft.ing",
    name: "statecraft.ing",
    license: "",
    role: "this site: the marketing and docs front door",
    url: `${ORG_URL}/statecraft.ing`,
  },
};

// The repos shown as the product family in the footer (README order).
export const PRODUCT_FAMILY: RepoMeta[] = [
  REPO_META["statecraft"],
  REPO_META["enrahitu"],
  REPO_META["statecraft-cli"],
  REPO_META["spec-spine"],
  REPO_META["tenant-emit"],
  REPO_META["tenant-tail"],
  REPO_META["action-gate"],
  REPO_META["attest-ledger"],
  REPO_META["canonical-keysort-json"],
  REPO_META["trust-window"],
  REPO_META["statecrafting"],
];

export function repoMeta(repo: string): RepoMeta | undefined {
  return REPO_META[repo];
}
