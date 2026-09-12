// The availability matrix (spec 004 section 3.3.1). A capability is read on
// four independent axes, because "the owning spec says complete" answers only
// the first of them:
//
//   implemented  the governing specs report `implementation: complete`
//   released     a versioned artifact a stranger can install exists
//   exercised    a run outside the repository's own tests is on a public record
//   hosted       this project operates it as a service a reader can use
//
// The implemented axis is never authored for a repository in the registry bake
// set: it is rolled up from the baked shards, exactly as the status ladder is.
// For a repository outside the bake set it is authored with the commit it was
// read at, so a stale reading is visibly dated rather than silently wrong. The
// other three axes are authored, and the types refuse a positive reading that
// carries no evidence. `resolveMatrix` fails the build on every rule below, so
// the page cannot render a row that breaks one.

import type { RegistryPayload } from "./registry";
import { findSpec } from "./registry";
import { PRODUCT_FAMILY } from "./product-family";

/** The date the authored readings below were taken. */
export const MATRIX_READ_ON = "2026-09-12";

export interface Evidence {
  label: string;
  /** A /registry path in the baked payload, or a public URL (see EVIDENCE_HOSTS). */
  href: string;
}

type NonEmpty<T> = [T, ...T[]];

/** One authored axis. A positive reading must name its evidence. */
export type Reading =
  | { state: "yes"; note: string; evidence: NonEmpty<Evidence> }
  | { state: "partial"; note: string; evidence: NonEmpty<Evidence> }
  | { state: "no"; note: string; evidence?: Evidence[] }
  | { state: "unknown"; note: string; evidence?: Evidence[] }
  | { state: "n-a"; note: string };

export type ReadingState = Reading["state"];

export type Implemented =
  | { from: "registry"; specs: NonEmpty<{ repo: string; id: string }> }
  | {
      from: "read";
      at: NonEmpty<{ repo: string; sha: string }>;
      state: "yes" | "partial" | "no";
      note: string;
      evidence: NonEmpty<Evidence>;
    };

export interface Limit {
  text: string;
  evidence: NonEmpty<Evidence>;
}

export interface CapabilityRow {
  id: string;
  capability: string;
  summary: string;
  /** Roster repos (spec 003) this capability lives in. */
  repos: NonEmpty<string>;
  implemented: Implemented;
  released: Reading;
  exercised: Reading;
  hosted: Reading;
  /** The exceptions a reader should carry with the claim. */
  limits: Limit[];
}

// Evidence must be checkable by a stranger: the baked registry, or a public
// source the family publishes to.
const EVIDENCE_HOSTS = [
  "https://github.com/statecrafting/",
  "https://crates.io/crates/",
  "https://www.npmjs.com/package/",
  "https://app.statecraft.ing",
];

const CLI_DOC_05: Evidence = {
  label: "statecraft-cli doc 05",
  href: "https://github.com/statecrafting/statecraft-cli/blob/main/docs/design/05-the-realignment-checked.md",
};
const CLI_RELEASE: Evidence = {
  label: "statecraft-cli v0.1.0",
  href: "https://github.com/statecrafting/statecraft-cli/releases/tag/v0.1.0",
};
const SPINE_RELEASE: Evidence = {
  label: "spec-spine v0.18.0",
  href: "https://github.com/statecrafting/spec-spine/releases/tag/v0.18.0",
};
const SPINE_SEAL: Evidence = {
  label: "spec-spine 023",
  href: "https://github.com/statecrafting/spec-spine/tree/main/specs/023-ledger-seal",
};
/** The spec-spine main commit the authored readings were taken at. */
const SPINE_READ_AT = "59cba05";

export const CAPABILITIES: CapabilityRow[] = [
  {
    id: "govern-a-repository",
    capability: "Govern a repository you already have",
    summary:
      "A spec corpus compiled to a typed registry, and a pull-request gate that refuses code which moves without its owning spec.",
    repos: ["spec-spine"],
    implemented: {
      from: "read",
      at: [{ repo: "spec-spine", sha: SPINE_READ_AT }],
      state: "yes",
      note: "The compiler, the index, the linter and the coupling gate are implemented in its own corpus.",
      evidence: [{ label: "spec-spine specs", href: "https://github.com/statecrafting/spec-spine/tree/main/specs" }],
    },
    released: {
      state: "yes",
      note: "v0.18.0, September 9, 2026, from crates.io, npm or PyPI. Fixes merged since then are not in a release yet.",
      evidence: [SPINE_RELEASE, { label: "crates.io", href: "https://crates.io/crates/spec-spine-cli" }],
    },
    exercised: {
      state: "yes",
      note: "It gates every pull request to this site, and every repository on the roster carries a corpus it governs.",
      evidence: [
        {
          label: "this site's gate",
          href: "https://github.com/statecrafting/statecraft.ing/blob/main/.github/workflows/spec-spine.yml",
        },
      ],
    },
    hosted: { state: "n-a", note: "Runs on your machine and in your own CI, with no account." },
    limits: [
      {
        text: "Declared territory covers the source paths a spec claims. It does not cover generated files, lockfiles, migrations or other resources two specs can still share.",
        evidence: [{ label: "spec 004 section 8", href: "/registry/statecraft.ing/004-marketing-surfaces" }],
      },
      {
        text: "The released v0.18.0 verifier still accepts an attestation with added unknown fields or an unsupported schema version. The fix, spec 085, is implemented on main and not yet in a release.",
        evidence: [
          SPINE_RELEASE,
          {
            label: "spec 085",
            href: "https://github.com/statecrafting/spec-spine/tree/main/specs/085-a-verifier-checks-the-bytes-it-was-given",
          },
        ],
      },
      {
        text: "A rewritten index shard can still read fresh. Its fix is a draft, spec 086, and is not implemented.",
        evidence: [
          {
            label: "draft 086",
            href: "https://github.com/statecrafting/spec-spine/tree/main/specs/086-the-committed-index-is-compared-not-trusted",
          },
          {
            label: "spec-spine authority evidence",
            href: "https://github.com/statecrafting/spec-spine/blob/main/docs/authority-evidence.md",
          },
        ],
      },
    ],
  },
  {
    id: "seal-an-attestation",
    capability: "Seal a corpus attestation with a signature",
    summary:
      "spec-spine attest --sign adds a detached Ed25519 seal over a reproducible attestation of the corpus.",
    repos: ["spec-spine"],
    implemented: {
      from: "read",
      at: [{ repo: "spec-spine", sha: SPINE_READ_AT }],
      state: "yes",
      note: "Spec 023, the ledger seal, is implemented.",
      evidence: [SPINE_SEAL],
    },
    released: { state: "yes", note: "In v0.18.0.", evidence: [SPINE_RELEASE] },
    exercised: { state: "unknown", note: "This site cites no published signed attestation." },
    hosted: { state: "n-a", note: "Runs locally; the key stays with whoever holds it." },
    limits: [
      {
        text: "Signing is opt-in: attest alone writes an unsigned attestation, and key custody is the operator's.",
        evidence: [SPINE_SEAL],
      },
      {
        text: "A valid seal says which key signed. Whether to trust that key is decided out of band, not by the attestation.",
        evidence: [SPINE_SEAL],
      },
    ],
  },
  {
    id: "local-governed-run",
    capability: "Run a governed agent session on your own machine",
    summary:
      "Candidate worktrees, capability negotiation, a credential fence, an acceptance receipt and an action broker, with no account.",
    repos: ["statecraft-cli"],
    implemented: {
      from: "registry",
      specs: [
        { repo: "statecraft-cli", id: "108-member-dispatch" },
        { repo: "statecraft-cli", id: "119-admission-and-outcome" },
        { repo: "statecraft-cli", id: "120-capability-contract" },
        { repo: "statecraft-cli", id: "121-candidate-and-receipt" },
        { repo: "statecraft-cli", id: "122-action-broker" },
        { repo: "statecraft-cli", id: "125-credential-fence" },
      ],
    },
    released: {
      state: "no",
      note: "Not in a release. The only release, v0.1.0 of July 22, 2026, predates member dispatch and the local engine, and a packaged engine does not yet run outside a source checkout. It stays not released until a release containing the engine exists and has been tested on a clean machine.",
      evidence: [CLI_RELEASE, { label: "draft 130", href: "/registry/statecraft-cli/130-member-distribution" }],
    },
    exercised: {
      state: "partial",
      note: "Run from a source checkout, where the repository's own review measured it. No run from an installed package is recorded.",
      evidence: [CLI_DOC_05],
    },
    hosted: { state: "n-a", note: "Local by design; it needs no account with this project." },
    limits: [
      {
        text: "A web page open in a browser on the same machine can currently drive the local daemon's API, which checks neither Origin nor Host. A fix is drafted, not implemented.",
        evidence: [CLI_DOC_05, { label: "draft 128", href: "/registry/statecraft-cli/128-api-origin-guard" }],
      },
      {
        text: "Gate commands inherit the daemon's environment, credentials included. The credential fence covers the agent session, not the gate.",
        evidence: [CLI_DOC_05, { label: "draft 129", href: "/registry/statecraft-cli/129-gate-fence" }],
      },
      {
        text: "A candidate worktree prevents accidental edits to your checkout. It is not a security boundary.",
        evidence: [CLI_DOC_05],
      },
    ],
  },
  {
    id: "cli-and-mcp",
    capability: "Drive governance verbs from a terminal or a coding agent",
    summary:
      "The statecraft binary and its MCP server expose the same verbs to a person and to an agent.",
    repos: ["statecraft-cli"],
    implemented: {
      from: "registry",
      specs: [
        { repo: "statecraft-cli", id: "101-cli-mcp-thesis" },
        { repo: "statecraft-cli", id: "104-governance-verbs" },
        { repo: "statecraft-cli", id: "105-mcp-server" },
        { repo: "statecraft-cli", id: "107-release-distribution" },
      ],
    },
    released: {
      state: "yes",
      note: "v0.1.0 binaries for macOS, Linux and Windows, each with a checksum and a CycloneDX SBOM. That release is the CLI and the MCP server only: installing it, by install.sh or by hand, does not install the local engine.",
      evidence: [CLI_RELEASE, { label: "spec 107", href: "/registry/statecraft-cli/107-release-distribution" }],
    },
    exercised: {
      state: "partial",
      note: "Spec 107 records a live install on a developer machine. Whether a provider reported every tool call an agent made is unknown.",
      evidence: [{ label: "spec 107", href: "/registry/statecraft-cli/107-release-distribution" }, CLI_DOC_05],
    },
    hosted: {
      state: "no",
      note: "The governance verbs call a control plane's API, and no plane is open for sign-up.",
      evidence: [{ label: "spec 104", href: "/registry/statecraft-cli/104-governance-verbs" }],
    },
    limits: [
      {
        text: "Provider tool-event coverage is unknown: no driver proves it observed every tool call a provider made.",
        evidence: [CLI_DOC_05],
      },
    ],
  },
  {
    id: "run-evidence",
    capability: "Export a run's evidence and re-check it offline",
    summary:
      "A hash-chained journal export with an attestation block and acceptance receipts, verified by recomputation.",
    repos: ["statecraft-cli"],
    implemented: {
      from: "registry",
      specs: [
        { repo: "statecraft-cli", id: "031-journal-export" },
        { repo: "statecraft-cli", id: "039-attested-export" },
        { repo: "statecraft-cli", id: "121-candidate-and-receipt" },
      ],
    },
    released: {
      state: "no",
      note: "Not in a release: v0.1.0 predates it.",
      evidence: [CLI_RELEASE],
    },
    exercised: {
      state: "partial",
      note: "Checked by the repository's own review, which found that a chain fabricated end to end with a fresh anchor also verifies. The one committed bundle predates acceptance receipts.",
      evidence: [CLI_DOC_05],
    },
    hosted: { state: "n-a", note: "Runs locally." },
    limits: [
      {
        text: "The evidence is unsigned. A receipt is a journal record, not a signed document.",
        evidence: [{ label: "spec 121", href: "/registry/statecraft-cli/121-candidate-and-receipt" }],
      },
      {
        text: "Recomputation settles integrity. It does not say who produced the bundle.",
        evidence: [CLI_DOC_05],
      },
    ],
  },
  {
    id: "team-control-plane",
    capability: "Connect repositories to a hosted team control plane",
    summary:
      "Tenants through a per-org GitHub App, an action gate and an attestation chain, run as one governed service.",
    repos: ["statecraft"],
    implemented: {
      from: "registry",
      specs: [
        { repo: "statecraft", id: "002-app-shell" },
        { repo: "statecraft", id: "004-tenants-github-app" },
        { repo: "statecraft", id: "008-governance-attestation" },
        { repo: "statecraft", id: "009-control-plane-deploy" },
        { repo: "statecraft", id: "011-tenant-lifecycle" },
      ],
    },
    released: {
      state: "no",
      note: "No self-host release. The deploy spec describes one specific cluster and is still in progress.",
      evidence: [{ label: "spec 009", href: "/registry/statecraft/009-control-plane-deploy" }],
    },
    exercised: {
      state: "partial",
      note: "A deployment serves app.statecraft.ing. This site cites no public record of tenant use.",
      evidence: [{ label: "app.statecraft.ing", href: "https://app.statecraft.ing" }],
    },
    hosted: { state: "no", note: "No sign-up, pricing or support is offered." },
    limits: [
      {
        text: "Spec 008 leaves the chain's anchor unsigned until an operator key is configured, and the deploy spec records that key as declared with no delivery path. This site does not claim the running chain is signed.",
        evidence: [
          { label: "spec 008", href: "/registry/statecraft/008-governance-attestation" },
          { label: "spec 009", href: "/registry/statecraft/009-control-plane-deploy" },
        ],
      },
    ],
  },
  {
    id: "stamp-an-application",
    capability: "Stamp a new application from a template",
    summary:
      "A factory stamps a complete application into your GitHub org, born with a certificate that binds its agentic posture.",
    repos: ["statecraft", "enrahitu"],
    implemented: {
      from: "registry",
      specs: [
        { repo: "statecraft", id: "005-factory-service" },
        { repo: "enrahitu", id: "009-template-contract" },
        { repo: "enrahitu", id: "012-born-with-provenance" },
      ],
    },
    released: { state: "no", note: "Not released." },
    exercised: { state: "no", note: "No production stamp is recorded in a public source." },
    hosted: { state: "no", note: "Not offered." },
    limits: [],
  },
  {
    id: "operate-a-fleet",
    capability: "Operate applications as one container and one volume",
    summary: "Placement, update and backup as governed verbs with an audit trail.",
    repos: ["statecraft"],
    implemented: { from: "registry", specs: [{ repo: "statecraft", id: "006-fleet" }] },
    released: { state: "no", note: "Not released." },
    exercised: { state: "no", note: "No placed application is recorded in a public source." },
    hosted: { state: "no", note: "Managed hosting is not offered." },
    limits: [],
  },
  {
    id: "self-host-enrahitu",
    capability: "Self-host the enrahitu application",
    summary:
      "One container and one volume: the application, its identity provider and replicated SQLite, with no managed dependency.",
    repos: ["enrahitu"],
    implemented: {
      from: "registry",
      specs: [{ repo: "enrahitu", id: "007-single-container-packaging" }],
    },
    released: {
      state: "partial",
      note: "The latest release, v0.2.0 of July 16, 2026, predates the application's current shape. Its operations guide documents signed images.",
      evidence: [
        { label: "enrahitu v0.2.0", href: "https://github.com/statecrafting/enrahitu/releases/tag/v0.2.0" },
        { label: "operations guide", href: "https://github.com/statecrafting/enrahitu/blob/main/docs/OPERATIONS.md" },
      ],
    },
    exercised: { state: "unknown", note: "This site cites no public record of a deployment." },
    hosted: { state: "no", note: "Not offered as a hosted service." },
    limits: [],
  },
  {
    id: "record-primitives",
    capability: "Hash-link records and verify them offline",
    summary:
      "A hash-linked ledger, canonical JSON, and a certificate emitter and verifier that share no trust.",
    repos: ["attest-ledger", "canonical-keysort-json", "tenant-emit", "tenant-tail"],
    implemented: {
      from: "read",
      at: [
        { repo: "attest-ledger", sha: "a9c3595" },
        { repo: "canonical-keysort-json", sha: "8da1e47" },
        { repo: "tenant-emit", sha: "2d5b538" },
        { repo: "tenant-tail", sha: "7855a65" },
      ],
      state: "yes",
      note: "Each is a small library with its own spec corpus.",
      evidence: [
        { label: "attest-ledger", href: "https://github.com/statecrafting/attest-ledger" },
        { label: "tenant-tail", href: "https://github.com/statecrafting/tenant-tail" },
      ],
    },
    released: {
      state: "yes",
      note: "attest-ledger-core and canonical-keysort-json on crates.io; tenant-emit and tenant-tail on npm.",
      evidence: [
        { label: "attest-ledger-core", href: "https://crates.io/crates/attest-ledger-core" },
        { label: "canonical-keysort-json", href: "https://crates.io/crates/canonical-keysort-json" },
        { label: "tenant-emit", href: "https://www.npmjs.com/package/tenant-emit" },
        { label: "tenant-tail", href: "https://www.npmjs.com/package/tenant-tail" },
      ],
    },
    exercised: {
      state: "partial",
      note: "The control plane's governance chain is built on attest-ledger. No production certificate is recorded as verified by tenant-tail.",
      evidence: [{ label: "statecraft spec 008", href: "/registry/statecraft/008-governance-attestation" }],
    },
    hosted: { state: "n-a", note: "Libraries you run yourself." },
    limits: [
      {
        text: "attest-ledger signs only a chain's genesis anchor, and checks that signature against the public key the anchor itself carries. A valid signature says which key signed, not whose key it is; that takes a key pinned by someone other than the producer.",
        evidence: [
          {
            label: "attest-ledger signing",
            href: "https://github.com/statecrafting/attest-ledger/blob/main/crates/core/src/signing.rs",
          },
        ],
      },
    ],
  },
];

export interface ResolvedSpecState {
  repo: string;
  id: string;
  implementation: string;
}

export interface ResolvedImplemented {
  state: "yes" | "partial" | "no";
  note: string;
  evidence: Evidence[];
  /** Present when the axis was rolled up from the baked registry. */
  specs?: ResolvedSpecState[];
  /** Present when the axis was authored against a commit. */
  readAt?: Array<{ repo: string; sha: string }>;
}

export interface ResolvedRow extends Omit<CapabilityRow, "implemented"> {
  implemented: ResolvedImplemented;
}

function evidenceOf(r: Reading): Evidence[] {
  return "evidence" in r && r.evidence ? r.evidence : [];
}

/** Resolve every row against the baked payload and enforce the matrix rules.
 *  Throws, naming every violation, so the prerender fails rather than render a
 *  row that reads louder than its evidence. */
export function resolveMatrix(
  payload: RegistryPayload,
  rows: CapabilityRow[] = CAPABILITIES
): ResolvedRow[] {
  const problems: string[] = [];
  const roster = new Set(PRODUCT_FAMILY.map((r) => r.repo));
  const ids = new Set<string>();

  const checkEvidence = (row: string, e: Evidence) => {
    if (e.href.startsWith("/registry/")) {
      const [, , repo, id] = e.href.split("/");
      if (!findSpec(payload, repo, id)) {
        problems.push(`${row}: evidence ${e.href} is not in the baked registry`);
      }
    } else if (!EVIDENCE_HOSTS.some((h) => e.href.startsWith(h))) {
      problems.push(`${row}: evidence ${e.href} is not a public source this matrix accepts`);
    }
  };

  const resolved = rows.map((row): ResolvedRow => {
    if (ids.has(row.id)) problems.push(`${row.id}: duplicate row id`);
    ids.add(row.id);
    for (const repo of row.repos) {
      if (!roster.has(repo)) problems.push(`${row.id}: "${repo}" is not on the spec-003 roster`);
    }

    let implemented: ResolvedImplemented;
    if (row.implemented.from === "registry") {
      const specs = row.implemented.specs.map((ref) => {
        const hit = findSpec(payload, ref.repo, ref.id);
        if (!hit) problems.push(`${row.id}: ${ref.repo}/${ref.id} is not in the baked registry`);
        const impl = typeof hit?.spec.implementation === "string" ? hit.spec.implementation : "";
        return { ...ref, implementation: impl };
      });
      const complete = specs.filter((s) => s.implementation === "complete").length;
      const moving = specs.some((s) => s.implementation === "in-progress");
      implemented = {
        state: complete === specs.length ? "yes" : complete > 0 || moving ? "partial" : "no",
        note: `${complete} of ${specs.length} governing specs report implementation: complete.`,
        evidence: specs.map((s) => ({ label: `${s.repo}/${s.id.slice(0, 3)}`, href: `/registry/${s.repo}/${s.id}` })),
        specs,
      };
    } else {
      for (const at of row.implemented.at) {
        if (!/^[0-9a-f]{7,40}$/.test(at.sha)) problems.push(`${row.id}: read-at sha "${at.sha}" is not a commit id`);
        if (!roster.has(at.repo)) problems.push(`${row.id}: read-at repo "${at.repo}" is not on the roster`);
      }
      implemented = {
        state: row.implemented.state,
        note: row.implemented.note,
        evidence: row.implemented.evidence,
        readAt: row.implemented.at,
      };
    }

    const axes = { released: row.released, exercised: row.exercised, hosted: row.hosted };
    for (const [axis, reading] of Object.entries(axes)) {
      if ((reading.state === "yes" || reading.state === "partial") && evidenceOf(reading).length === 0) {
        problems.push(`${row.id}: ${axis} reads "${reading.state}" with no evidence`);
      }
      // A capability that is not fully implemented cannot be fully released,
      // exercised or hosted: "complete" is necessary for "available", never
      // sufficient, and never the other way round.
      if (implemented.state !== "yes" && reading.state === "yes") {
        problems.push(`${row.id}: ${axis} reads "yes" but implemented reads "${implemented.state}"`);
      }
      for (const e of evidenceOf(reading)) checkEvidence(row.id, e);
    }
    for (const e of implemented.evidence) checkEvidence(row.id, e);
    for (const limit of row.limits) for (const e of limit.evidence) checkEvidence(row.id, e);

    return { ...row, implemented };
  });

  if (problems.length > 0) {
    throw new Error(
      `availability matrix (app/lib/availability.ts) refused ${problems.length} row rule(s):\n  ${problems.join("\n  ")}`
    );
  }
  return resolved;
}

/** Human label for an axis reading. "no" is phrased per axis so an absent
 *  release, an absent record and an absent offer read differently. */
export function readingLabel(axis: "implemented" | "released" | "exercised" | "hosted", state: ReadingState): string {
  if (state === "unknown") return "unknown";
  if (state === "n-a") return "not applicable";
  const table = {
    implemented: { yes: "implemented", partial: "partly implemented", no: "not implemented" },
    released: { yes: "released", partial: "partly released", no: "not released" },
    exercised: { yes: "exercised", partial: "partly exercised", no: "no recorded run" },
    hosted: { yes: "hosted", partial: "partly hosted", no: "not offered" },
  } as const;
  return table[axis][state];
}

const CHIP_BASE =
  "inline-flex items-center rounded px-1.5 py-0.5 font-mono text-[0.7rem] leading-none";

/** Chip classes. Only "yes" is green; "unknown" is never styled as a pass. */
export function readingChip(state: ReadingState): string {
  switch (state) {
    case "yes":
      return `${CHIP_BASE} border border-emerald-500/30 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400`;
    case "partial":
      return `${CHIP_BASE} border border-amber-500/30 bg-amber-500/10 text-amber-600 dark:text-amber-400`;
    case "unknown":
      return `${CHIP_BASE} border border-dashed border-border text-muted-foreground`;
    default:
      return `${CHIP_BASE} border border-border bg-muted text-muted-foreground`;
  }
}
