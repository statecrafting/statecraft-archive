// Data for the products / architecture page (spec 004 section 3.3). The repo
// roster is NOT re-listed here: it is owned by spec 003 and imported from
// product-family.ts, so this page cannot drift from the family. What this
// module adds is the architectural framing (layers, the delivery flow) and a
// short, checkable detail per repo. No status badge or spec count is invented;
// the only per-repo signal beyond spec 003 is whether the repo has a baked
// spec corpus in /registry.

import { PRODUCT_FAMILY, type RepoMeta } from "./product-family";

// Icon keys are resolved to inline-SVG components in the route, keeping this
// module JSX-free.
export type IconKey =
  | "governance"
  | "substrate"
  | "control-plane"
  | "interface"
  | "verification";

export interface ArchLayer {
  id: string;
  name: string;
  icon: IconKey;
  blurb: string;
  repos: string[];
}

// Repos whose spec corpora are baked into /registry (spec 001 section 3 bake
// set, minus this site). The page links these to their registry corpus.
export const BAKED_REPOS = new Set<string>([
  "statecraft",
  "enrahitu",
  "statecraft-cli",
]);

// The architecture as layers. Every repo in the family appears in exactly one
// layer; the union of layer.repos equals the spec-003 roster (asserted by a
// build-time check in the route loader).
export const ARCHITECTURE_LAYERS: ArchLayer[] = [
  {
    id: "governance",
    name: "Governance toolchain",
    icon: "governance",
    blurb:
      "The spec spine everything else is built and checked against. Markdown is the source of truth; drift is refused at pull-request time.",
    repos: ["spec-spine"],
  },
  {
    id: "substrate",
    name: "Substrate",
    icon: "substrate",
    blurb:
      "The runnable chassis a stamped app is born from: Encore.ts, rauthy, hiqlite, and Turso in a single container with zero managed dependencies, plus the shared native packages and vendored toolchain it is built from.",
    repos: ["enrahitu", "statecrafting"],
  },
  {
    id: "control-plane",
    name: "Control plane",
    icon: "control-plane",
    blurb:
      "The governed loop itself: specify, stamp, operate, verify. This is the layer the status ladder tracks as it lands.",
    repos: ["statecraft"],
  },
  {
    id: "interface",
    name: "Interface",
    icon: "interface",
    blurb:
      "How people and agents drive the plane: a CLI and an MCP server exposing the same governed verbs, so an agent passes through the controls a person does.",
    repos: ["statecraft-cli"],
  },
  {
    id: "verification",
    name: "Verification primitives",
    icon: "verification",
    blurb:
      "Small, single-purpose libraries that make the record checkable by someone who trusts none of it: certificates, a signed ledger, canonical hashing, a decision gate, and a trust score.",
    repos: [
      "tenant-emit",
      "tenant-tail",
      "attest-ledger",
      "canonical-keysort-json",
      "action-gate",
      "trust-window",
    ],
  },
];

export interface FlowStep {
  verb: string;
  tool: string;
  detail: string;
  /**
   * The spec whose implementation state decides this step's maturity chip, or
   * omitted when the step is governed by spec-spine itself (which demonstrably
   * runs today). Resolved against the baked registry in the route loader so the
   * chip cannot drift from the specs, mirroring the home page's loop.
   */
  ref?: { repo: string; id: string };
}

// The governed delivery flow, stated as the real verbs. The maturity of each
// step is not hand-asserted here: it is rolled up from the referenced spec in
// the loader, so this page and the home page status ladder always agree.
export const DELIVERY_FLOW: FlowStep[] = [
  { verb: "Specify", tool: "spec-spine", detail: "intent compiles to a typed, hash-verifiable spec; drift is gated in CI" },
  { verb: "Stamp", tool: "enrahitu + template contract", detail: "a contract stamps a complete app from the chassis, born with a certificate", ref: { repo: "enrahitu", id: "009-template-contract" } },
  { verb: "Operate", tool: "the fleet", detail: "one container, one volume; update and backup are governed verbs with an audit trail", ref: { repo: "statecraft", id: "006-fleet" } },
  { verb: "Verify", tool: "attest-ledger + tenant-tail", detail: "the run is recorded in a signed ledger and re-checked by an independent verifier", ref: { repo: "statecraft", id: "008-governance-attestation" } },
];

export interface ProductDetail {
  blurb: string;
  highlights: string[];
}

// Short, checkable framing per repo. Highlights describe what the repo is, not
// how mature it is; nothing here asserts a count, a status, or a benchmark.
export const PRODUCT_DETAIL: Record<string, ProductDetail> = {
  statecraft: {
    blurb:
      "The governed delivery control plane: the loop that turns intent into an operated, verifiable application.",
    highlights: [
      "Specify, stamp, operate, verify as one governed loop",
      "Your code lives in your GitHub org the whole time",
      "AGPL-3.0: self-hostable, copyleft",
    ],
  },
  enrahitu: {
    blurb:
      "The EnRaHiTu template chassis a stamped app is born from, runnable on its own today.",
    highlights: [
      "Encore.ts, rauthy, hiqlite, Turso in one container",
      "Zero managed dependencies",
      "The substrate for the factory's stamp",
    ],
  },
  "statecraft-cli": {
    blurb:
      "The command line and MCP server: the same governed verbs for people and for coding agents.",
    highlights: [
      "One set of verbs, one set of guards",
      "MCP face so an agent uses the controls a person does",
      "No side doors around the governance model",
    ],
  },
  "spec-spine": {
    blurb:
      "The spec-governance toolchain the whole family, including this website, is built and checked against.",
    highlights: [
      "compile, index, lint, couple: the governed loop",
      "Deterministic: same inputs, byte-identical output",
      "Refuses code that drifts from its owning spec",
    ],
  },
  "tenant-emit": {
    blurb:
      "The tenant certificate emitter: signs a produced app's governance certificate from a finished run.",
    highlights: [
      "Emit-only by construction, separate from the verifier",
      "Signs what the factory actually produced",
    ],
  },
  "tenant-tail": {
    blurb:
      "The tenant certificate verifier: re-checks the factory's paperwork with no trust in the producer.",
    highlights: [
      "Offline, identity-free, read-only",
      "Fails with a specific diagnostic on any mismatch",
    ],
  },
  "action-gate": {
    blurb:
      "A pure, deterministic decision gate at the heart of every governed action.",
    highlights: [
      "evaluate(context, checks) returns Allow, Deny, or Degrade",
      "No hidden state: same inputs, same decision",
    ],
  },
  "attest-ledger": {
    blurb:
      "A tamper-evident record ledger: what the plane did, in a form a stranger can re-check.",
    highlights: [
      "Append-only, hash-linked, Ed25519-signed",
      "Ships with an independent verifier",
    ],
  },
  "canonical-keysort-json": {
    blurb:
      "Deterministic canonical JSON so record hashes agree across independent parties.",
    highlights: [
      "Lexicographic key sort at the serialization boundary",
      "The same bytes hash the same way everywhere",
    ],
  },
  "trust-window": {
    blurb:
      "A rolling-window trust scorer: privilege is earned and decays rather than granted once.",
    highlights: [
      "Weighted samples map to a graduated privilege level",
      "Trust reflects recent behavior, not a one-time grant",
    ],
  },
  statecrafting: {
    blurb:
      "The shared native packages and build toolchain the chassis is assembled from.",
    highlights: [
      "The @statecrafting/* napi addons",
      "The Encore build toolchain enrahitu vendors",
      "Apache-2.0 at the root; two packages are AGPL-3.0, recorded in its own corpus",
    ],
  },
};

export interface ProductEntry {
  meta: RepoMeta;
  detail: ProductDetail;
  baked: boolean;
}

// The catalog, in roster order (spec 003). Throws if the roster and the detail
// map fall out of sync, so a repo can never render with no framing.
export function productEntries(): ProductEntry[] {
  return PRODUCT_FAMILY.map((meta) => {
    const detail = PRODUCT_DETAIL[meta.repo];
    if (!detail) {
      throw new Error(
        `products page: no detail for family repo "${meta.repo}". Add it to PRODUCT_DETAIL in app/lib/products.ts.`
      );
    }
    return { meta, detail, baked: BAKED_REPOS.has(meta.repo) };
  });
}
