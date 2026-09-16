# The spec spine, in detail

This document explains the spec spine in three passes: first the principles
without naming the system, then the named components and their guarantees,
then the closing argument for why the design is what it is.

---

## 1. The principles

Every piece of work in the repository — every feature, every refactor, every
infrastructure change — is anchored to a small markdown document that
*declares its territory*. The territory isn't a vague description; it's an
explicit list of code paths plus a set of typed relationships to the other
documents that have touched those paths before. Together those documents
form a graph, and the graph is the source of truth about who is allowed to
change what.

### What ties the documents together: typed edges

A document doesn't just claim "I exist." It declares, in machine-readable
frontmatter, things like:

- *establishes* — I am the document that first brought this code into being.
- *extends* — I'm adding surface to a predecessor's territory without disturbing it.
- *refines* — I'm tightening behavior on a specific aspect.
- *supersedes* — I am replacing this predecessor, partially or fully.
- *amends* — I'm patching a predecessor in place (clarification, correction, restriction).
- *co-authority* — I share a path with another document on a named section.
- *constrains* — I assert an invariant that everyone else must respect.

These edges turn the corpus from a flat pile of claims into a directed
graph. **Authority over any given path is derived by walking the graph**,
not declared directly. "Who currently has authority over file X, function
Y?" is a query against the graph, not a guess.

### Why parallel work becomes safe

Three properties fall out of this design:

1. **Disjoint territory is provably disjoint.** Two agents working on
   documents that establish or refine non-overlapping paths cannot collide
   by construction. The graph tells them so before either of them edits a
   line.
2. **Shared territory is typed, not undefined.** When two documents touch
   the same path — say, a project-wide Makefile where many features add
   targets — they declare co-authority section-by-section, with named
   anchors. The collision becomes a structured merge, not a free-for-all.
3. **History is queryable.** "Who established this file" and "who currently
   has authority on it" are different questions. An amendment doesn't blow
   away its predecessor; it patches it in place, and consumers see the
   patched view. Two agents can refine different aspects of the same
   predecessor in parallel without one having to wait for the other.

### Why agents don't trample each other

Three guardrails sit on top of the graph:

1. **A deterministic compiler** reads the markdown corpus and emits a
   frozen JSON registry. Two agents producing changes independently
   produce diffable, mechanically-mergeable registries — there is no
   interpretation drift at merge time.
2. **A coupling gate at PR time** cross-references every modified code path
   against the graph. If an agent changes a path without changing the
   document that has authority over it — or vice versa — CI refuses the
   merge. This is the mechanism that catches silent drift before it lands.
3. **A refusal rule at prompt time** prevents an agent from "resolving" a
   coupling-gate failure by quietly editing the contract to match the code
   it just wrote. The agent must surface the contradiction and let a human
   (or another agent with explicit authority) decide. Without this, the
   long-running failure mode is an agent erasing the contract to keep
   going.

### The net effect

What looks from the outside like a pile of markdown is actually a contract
surface with formal ownership semantics. Multiple agents can hold
work-in-progress simultaneously because the graph tells them what they
own, the compiler makes merges mechanical, the coupling gate is a hard
floor against silent drift, and the refusal rule is a hard ceiling against
rewriting history to escape the floor. Remove any of those four and
parallelism stops being safe; together, they make the corpus behave less
like documentation and more like a typed, append-only ledger of authority.

---

## 2. The named system

The system has a name: the **spec spine**. It lives in this repository in
three coordinated locations:

- `specs/NNN-slug/spec.md` — the markdown corpus itself (currently 178
  specs, 000 through 177)
- `standards/spec/` — the constitutional layer: `contract.md`,
  `constitution.md`, templates, grammars
- `.derived/spec-registry/registry.json` and
  `.derived/codebase-index/index.json` — compiled machine truth,
  deterministic and hash-verifiable

### The constitutional layer — three tiers of authority

Not every document is equal. Conflicts resolve in this order (highest
wins):

1. **Spec 000 (`000-bootstrap-spec-system`)** — the spec that defines what
   a spec is. Bootstraps the corpus; its invariants are non-overridable.
2. **`standards/spec/constitution.md`** — durable principles (markdown-only
   authored truth, compiler-owned JSON, spec-first development,
   determinism, legacy-as-evidence). Subordinate to spec 000 where they
   differ.
3. **Ordinary specs** — feature-level claims operating within the
   constitutional envelope.

Five **constitutional policy rules** (CONST-001 through CONST-005) sit on
top and bind agent behavior at runtime: destructive-op confirmation,
secrets scanning, tool allowlists, diff-size warnings, and spec/code
coherence. **CONST-005** is the one that powers the prompt-time refusal
rule.

### Authority is over *units*, not just files

The graph expresses ownership at finer granularity than "file." A unit can
be:

- **a file** (the default)
- **a section** within a file — a named anchor like a particular Makefile
  target or a Markdown heading (spec 152, path co-authority)
- **a symbol** — a Rust function, a TypeScript export (specs 147, 154–156,
  the *logical unit ownership grammar*)

This is the property that makes the canonical co-authority case — the
repo-root `Makefile`, with many features adding targets — actually
tractable. Co-authority is **section-scoped**, not file-scoped.

### Two registries, two directions

- **`.derived/spec-registry/by-spec/*.json`**: the spec-as-source view
  (what does each spec say?). Read through `spec-spine registry` (`list`,
  `show`, `status-report`).
- **`.derived/codebase-index/by-spec/*.json` and `by-package/*.json`**: the code-as-source view (for
  each path/section/symbol in the repo, which spec(s) currently claim
  authority?). Read through `spec-spine index` (`check`, `render`,
  `orphans`).

They are inverses. The coupling gate joins them at PR time and refuses the
merge if they disagree.

### How code connects back to specs

Each Rust crate declares `[package.metadata.oap] spec = "<id>"` in its
`Cargo.toml`; each npm package declares a top-level
`"oap": { "spec": "<id>" }` in its `package.json`. The **`spec-spine index`**
command walks the tree, hashes those manifests along with the spec files, and
builds the inverse map. The **`featuregraph`** crate is the in-memory
query layer that backs `authorities(P)` (the function "who currently owns
this path?") for both the coupling gate and any future consumer that
needs the same answer.

### Consumer binaries: typed reads or nothing (spec 103)

Spec 103 (`init-protocol-governed-reads`) makes it a workflow violation
for any orchestrated tool to parse `.derived/**/*.json` directly. Every
read goes through `spec-spine registry`, `oap-registry-enrich`, or
`spec-spine index`. The point is not aesthetics: ad-hoc `jq` over compiled
JSON would let an agent silently encode schema assumptions, and schema
drift would then fail loudly somewhere else, not at the read. Typed
binaries make drift fail at the deserializer, with a clean error. Schema
versions are embedded as compile-time constants (mismatches fail at
`cargo build`, not at runtime).

### The rules layer — binding agents to the spine at prompt time

`.claude/rules/` carries three files that load automatically into every
orchestrated workflow:

- **`orchestrator-rules.md`** — six behavioral rules (execute in order,
  write output files, stop at checkpoints, halt on failure, local agents
  only, never enter plan mode autonomously).
- **`governed-artifact-reads.md`** — the spec 103 read contract.
- **`adversarial-prompt-refusal.md`** — the CONST-005 refusal pattern:
  when an instruction would engineer drift between spec and code, halt,
  surface the contradiction, propose a non-destructive reframe, wait for
  human direction. This is the **prompt-time** defense; the coupling gate
  is the **PR-time** defense; together they sandwich the failure mode.

### The pre-merge gate chain

Not a single check — a chain:

- **`make pr-prep`** — local refresh: rebuilds the codebase index, runs
  the coupling check against `origin/main`. The two checks that fail
  first in CI when forgotten.
- **`.githooks/pre-commit`** — opt-in hard refusal on staleness
  (`git config core.hooksPath .githooks`).
- **CI: spec-code coupling check** (spec 127, amended by 130, 133) — the
  absolute floor.
- **CI: spec-lint** (spec 128 made fail-on-warn the default).
- **CI: schema parity walker** (spec 125) — Rust ↔ TypeScript contract
  drift fails CI.
- **CI: `cargo test --test exit_codes` in the `spec-spine index` crate** (spec 217: previously in `codebase-indexer`): stricter
  than the staleness check, not caught by `make pr-prep`; matters for
  specs adding `kind: symbol` units.

### The waiver mechanism — the gate's escape valve, itself governed

The coupling gate would be tyranny without an escape valve, and the
escape valve itself has to be in the ledger:

- **`Spec-Drift-Waiver:` in the PR body** (spec 127 FR-005) — explicit,
  named, cites the specs it applies to. The blessed path for legitimate
  consolidated changes like dependabot dep refreshes. **Never amend owner
  specs to satisfy a refresh — waiver instead.**
- **Amends-aware coupling** (spec 133) — an amendment to a predecessor's
  paths is recognized as legitimate authority, not drift.

### Lifecycle and the retroactive bootstrap

Specs carry `status:` — today 169 approved, 5 draft, 4 superseded. A
superseded spec retains its `establishes:` history but loses current
authority; the superseding spec inherits.

For specs whose `implements:` paths predate the graph, frontmatter carries
`origin: retroactive: true`. Without it, every pre-graph spec would look
like a fresh `establishes:` claim and the history would be wrong. This is
the bootstrap marker for "I'm declaring authority I've held since before
the graph existed."

### Determinism is the load-bearing property

None of this works without a deterministic compiler. The same committed
inputs must produce byte-identical JSON. Two consequences:

- **Two agents producing the same change produce the same registry.**
  Merge conflicts are rare and mechanical.
- **Index staleness is detectable by content-hash comparison alone** — no
  re-analysis needed.

### What you get

Put the named pieces together and the corpus stops behaving like
documentation and starts behaving like a **typed, hash-verifiable,
append-only ledger of who-owns-what**:

- Agents query the ledger (`spec-spine registry`, `spec-spine index`) to
  find their territory.
- Agents edit code and specs; the compiler re-mints the ledger.
- Agents open a PR; the coupling gate verifies code and ledger agree.
- Agents face a contradiction; the CONST-005 refusal rule stops them from
  rewriting the ledger to escape.
- A human authorizes a `Spec-Drift-Waiver`; the waiver is itself recorded
  in the PR and citable.

The spec spine is what makes "many agents working in parallel" tractable
in a way that "good intentions and code review" cannot — the contract is
the substrate, the compiler enforces its shape, the consumer binaries
enforce its reads, the gates enforce its truthfulness at PR time, and the
refusal rule enforces its truthfulness at prompt time. Remove any layer
and the others stop being sufficient.

---

## 3. Closing argument

A note on origin, then the argument.

I built this to solve my own problem. Unconstrained agentic output is
unprocessable — I will not review every line an agent produces, and
pretending otherwise just moves the bottleneck back to me. The only honest
move is to stop reviewing output and start constraining intent.

**Intent becomes a requirement. The requirement defines the spec. The spec
is law.**

Everything downstream — the compiler, the registries, the coupling gate,
the refusal rule — is mechanical enforcement of that law. The human writes
the contract once; the machinery enforces it on every diff, forever.

I treat all agentic output as hostile by default. Agents earn passage by
surviving the gates, not by appealing to my trust. When the work is large
enough to need many of them, I pit them against each other — divide the
territory, type the boundaries, let the spine arbitrate. Parallel agents
do not need to cooperate. Cooperation is a property of the substrate, not
a virtue the agents have to share.

This is what lets one person sit at the helm of the development pyramid
and steer it without the structure becoming incoherent or drifting from
the original intent. The human's job is to author the law. The agents'
job is to comply with it. The spine's job is to make non-compliance
impossible to merge.

What I have just described is **L4 first-class Agentic SWE**: not
AI-assisted coding, not copilots, not humans-in-the-loop on every diff —
a delegated execution model where the human governs the contract and the
contract governs the work.
