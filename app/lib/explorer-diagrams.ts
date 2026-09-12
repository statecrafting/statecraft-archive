// Interactive architecture diagrams consumed by the whitepaper reader
// (spec 004 section 3.4). Each is a plain data description of an inline SVG:
// nodes with a description, and typed edges between them. Every node maps to a
// real repo or mechanism in the family; nothing here names a subsystem that
// does not exist. Forward-looking pieces say so in their description.

import type { ArchDiagram } from "~/components/architecture-explorer";

export const specSpineExplorer: ArchDiagram = {
  title: "Figure 1. The spec spine: a graph of authority",
  caption:
    "Click any node to read its role. spec-spine turns a markdown corpus into a typed authority graph, compiles it to a frozen JSON registry, and refuses code that drifts from its owning spec. This very site is governed by it.",
  viewBox: "0 0 700 320",
  nodes: [
    { id: "spec-doc", label: "Spec document", x: 20, y: 130, width: 120, height: 52, description: "A markdown document with YAML frontmatter. It declares the units it owns (files, sections, symbols, directories) and typed edges to other specs. It is the authoritative design record for its territory.", color: "oklch(0.20 0.04 195)" },
    { id: "territory", label: "Territory", x: 180, y: 50, width: 100, height: 46, description: "The explicit set of code paths a spec owns. Two specs whose declared paths do not intersect cannot each claim the same file, and the coupling gate refuses a change that reaches outside a spec's claim. What that does not cover: generated files, lockfiles, migrations, fixtures and external resources two non-overlapping specs can still share, and write isolation at the operating-system level, which no graph can provide.", color: "oklch(0.18 0.03 260)" },
    { id: "typed-edges", label: "Typed edges", x: 180, y: 210, width: 100, height: 46, description: "establishes, extends, refines, supersedes, amends, co_authority, constrains, references. These edges turn a flat pile of documents into a directed graph; authority is derived by walking it.", color: "oklch(0.18 0.03 260)" },
    { id: "compiler", label: "Deterministic compiler", x: 330, y: 125, width: 140, height: 52, description: "spec-spine compile reads the whole corpus and emits a frozen JSON registry. Same inputs give byte-identical output on every platform: the registry is a pure function of (config, file contents).", color: "oklch(0.22 0.06 195)" },
    { id: "json-registry", label: "JSON registry", x: 530, y: 55, width: 120, height: 46, description: "The compiler's committed output: per-spec shards plus a codebase index. Consumers read it through spec-spine subcommands, never by parsing the JSON by hand, so schema drift fails at the deserializer.", color: "oklch(0.18 0.03 260)" },
    { id: "coupling-gate", label: "Coupling gate", x: 530, y: 135, width: 120, height: 52, description: "spec-spine couple runs at pull-request time. It cross-references every changed path against the graph and refuses the merge if code moved without its owning spec, or with an explicit cited waiver.", color: "oklch(0.22 0.06 195)" },
    { id: "refusal-rule", label: "Refusal rule", x: 530, y: 225, width: 120, height: 46, description: "A prompt-time rule: an agent may not resolve a coupling failure by quietly editing the spec to match new code. The contradiction is surfaced to a human instead.", color: "oklch(0.22 0.04 15)" },
  ],
  edges: [
    { from: "spec-doc", to: "territory", label: "declares" },
    { from: "spec-doc", to: "typed-edges", label: "declares" },
    { from: "spec-doc", to: "compiler", label: "feeds" },
    { from: "compiler", to: "json-registry", label: "emits" },
    { from: "compiler", to: "coupling-gate", label: "powers" },
    { from: "coupling-gate", to: "refusal-rule", label: "guarded by" },
  ],
};

export const deliveryLoopExplorer: ArchDiagram = {
  title: "Figure 2. The governed delivery loop",
  caption:
    "Click any node to read its role. Intent becomes a governed spec, a contract stamps a complete app from the enrahitu chassis, a fleet operates the result, and a tamper-evident record makes the whole run checkable. The spec spine and the substrate run today; the contract that stamps a complete app is still landing. The home page status ladder is authoritative for how far each rung has come.",
  viewBox: "0 0 720 320",
  nodes: [
    { id: "intent", label: "Intent", x: 10, y: 130, width: 120, height: 52, description: "What a human wants built, in natural language. It is the input to the loop and is never rewritten by an agent behind your back.", color: "oklch(0.20 0.04 80)" },
    { id: "spec", label: "Governed spec", x: 165, y: 70, width: 120, height: 52, description: "spec-spine compiles intent into a typed, hash-verifiable spec. This is real today: every repo in the family, including this website, is governed this way.", color: "oklch(0.22 0.06 195)" },
    { id: "contract", label: "Template contract", x: 330, y: 70, width: 120, height: 46, description: "A versioned contract that stamps a complete application from the enrahitu chassis (Encore.ts, rauthy, hiqlite, Turso in one container). The substrate it stamps from ships today; the contract itself is still being finalized.", color: "oklch(0.18 0.03 260)" },
    { id: "stamped", label: "Stamped app", x: 330, y: 150, width: 120, height: 46, description: "The produced application, born with a certificate that binds an explicit agentic posture. It lives in the customer's own GitHub org, under the customer's license, from the first commit.", color: "oklch(0.18 0.03 260)" },
    { id: "fleet", label: "Fleet (operate)", x: 165, y: 220, width: 120, height: 52, description: "One container and one volume per app. Update and backup are governed verbs that carry an audit trail, rather than a runbook you hope someone followed.", color: "oklch(0.22 0.06 195)" },
    { id: "ledger", label: "Attestation ledger", x: 500, y: 70, width: 130, height: 52, description: "attest-ledger: an append-only, hash-linked record of what the plane did, able to sign entries with Ed25519. canonical-keysort-json sorts keys at the hash boundary so independent parties compute the same hash. Whether a chain is signed is a deployment property: the control plane's own chain is unsigned today.", color: "oklch(0.22 0.06 150)" },
    { id: "verifier", label: "Independent verifier", x: 500, y: 200, width: 130, height: 52, description: "tenant-tail re-checks the record with no trust in the producer: offline, identity-free, read-only. An altered artifact fails with a specific diagnostic. A chain rebuilt from a fresh anchor does not: integrity and issuer trust are separate outcomes, and only integrity is settled by recomputation.", color: "oklch(0.22 0.04 15)" },
  ],
  edges: [
    { from: "intent", to: "spec", label: "specify" },
    { from: "spec", to: "contract", label: "stamp" },
    { from: "contract", to: "stamped", label: "produces" },
    { from: "stamped", to: "fleet", label: "operate" },
    { from: "stamped", to: "ledger", label: "recorded in" },
    { from: "ledger", to: "verifier", label: "verified by" },
  ],
};

export const identityFlowExplorer: ArchDiagram = {
  title: "Figure 3. Identity-bounded collaboration",
  caption:
    "Click any node to read its role. Identity federates from GitHub through Rauthy (the live OIDC signer) into scoped tokens. A deterministic gate decides each action, and a rolling trust score sets the privilege level. Humans and agents pass through the same controls.",
  viewBox: "0 0 720 280",
  nodes: [
    { id: "github", label: "GitHub", x: 10, y: 110, width: 100, height: 52, description: "The upstream identity provider. A person authenticates with GitHub; their identity is federated into the plane through Rauthy rather than trusted directly.", color: "oklch(0.18 0.03 260)" },
    { id: "rauthy", label: "Rauthy OIDC", x: 155, y: 110, width: 115, height: 52, description: "The sole OpenID Connect session signer. It runs inside the control plane's own container, reached only through the plane's origin (issuer https://app.statecraft.ing/auth/v1/, no separate auth host), federating upstream logins and issuing scoped tokens for people and agents alike.", color: "oklch(0.22 0.06 195)" },
    { id: "token", label: "Scoped token", x: 320, y: 40, width: 110, height: 46, description: "A signed token carrying the scopes an action may use. There is no anonymous session: every actor, human or agent, is identified before it can do anything.", color: "oklch(0.20 0.04 80)" },
    { id: "actor", label: "Person or agent", x: 320, y: 185, width: 110, height: 46, description: "A coding agent operates under exactly the same verbs and guards as a person: same posture, no side doors. The token bounds what it may attempt.", color: "oklch(0.18 0.03 260)" },
    { id: "gate", label: "Decision gate", x: 490, y: 70, width: 120, height: 52, description: "action-gate: a pure, deterministic evaluate(context, checks) that returns Allow, Deny, or Degrade. Same inputs, same decision, every time; no hidden state.", color: "oklch(0.22 0.06 195)" },
    { id: "trust", label: "Trust window", x: 490, y: 185, width: 120, height: 52, description: "trust-window: a rolling-window scorer. Weighted samples map to a graduated privilege level, so trust is earned and decays rather than being granted once and forgotten.", color: "oklch(0.22 0.04 15)" },
    { id: "resources", label: "Governed verbs", x: 640, y: 120, width: 70, height: 52, description: "The actions the plane exposes: everything an actor can do passes the gate first, scored by the trust window, recorded in the ledger.", color: "oklch(0.18 0.03 260)" },
  ],
  edges: [
    { from: "github", to: "rauthy", label: "federates" },
    { from: "rauthy", to: "token", label: "issues" },
    { from: "rauthy", to: "actor", label: "identifies" },
    { from: "token", to: "gate", label: "presented" },
    { from: "actor", to: "gate", label: "requests" },
    { from: "gate", to: "trust", label: "scored by" },
    { from: "gate", to: "resources", label: "allows" },
  ],
};
