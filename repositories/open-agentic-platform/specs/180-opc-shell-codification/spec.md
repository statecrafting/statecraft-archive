---
id: "180-opc-shell-codification"
slug: opc-shell-codification
title: "OPC shell codification — broad authority on the un-bound desktop shell, narrow Tier 1 invariants on the tab/IPC seam"
status: approved
implementation: complete
owner: bart
created: "2026-05-24"
kind: governance
domain: opc
risk: medium
amends:
  - "034-featuregraph-registry-scanner-fix"
amends_sections: []
depends_on:
  - "032-opc-inspect-governance-wiring-mvp"  # opc-inspect-governance-wiring-mvp (the MVP shell wiring this spec extends)
  - "132-constitutional-invariant-freeze"  # constitutional-invariant-freeze (invariant-freeze flavor precedent)
  - "133-amends-aware-coupling-gate"  # amends-aware-coupling-gate (satisfaction predicate this spec rides)
  - "147-spec-kind-grammar"  # spec-kind-grammar (kind enum)
  - "152-path-co-authority"  # path-co-authority (future co-authority transition with 172)
  - "153-invariant-freeze-additive-evolution"  # invariant-freeze-additive-evolution (refined invariant-freeze semantics)
  - "154-logical-unit-ownership-grammar"  # logical-unit-ownership-grammar (unit declarations)
  - "156-references-edge-provenance-grammar"  # references-edge-provenance-grammar (references shape)
  - "166-opc-stop-hook-gate-chain"  # opc-stop-hook-gate-chain (Tier 2 bench gate composes with chain semantics)
  - "172-opc-live-agent-session-introspection"  # opc-live-agent-session-introspection (this spec refines its tab-system surface)
  - "174-codification-gate"  # codification-gate (this spec is self-checked against 174 semantics)
  - "177-ci-orchestrator-pr-gate"  # ci-orchestrator-pr-gate (Tier 2 bench gate wires under ci-gate, not top-level)
code_aliases:
  - "OPC_SHELL_CODIFICATION"
  - "OPC_TAB_RECONCILIATION_DISCIPLINE"
  - "OPC_FS_HANDLER_DISCIPLINE"
  - "OPC_BENCH_PRESENCE"
origin:
  retroactive: true
establishes:
  - unit: { kind: directory, path: product/apps/opc/src/lib }
  - unit: { kind: directory, path: product/apps/opc/src/services }
  - unit: { kind: directory, path: product/apps/opc/src/stores }
  - unit: { kind: directory, path: product/apps/opc/src/routes }
  - unit: { kind: directory, path: product/apps/opc/src/components/factory }
  - unit: { kind: directory, path: product/apps/opc/src/components }
  - unit: { kind: directory, path: product/apps/opc/src/contexts }
  - unit: { kind: directory, path: product/apps/opc/src/hooks }
  - unit: { kind: directory, path: product/apps/opc/src-tauri/src/commands }
  - unit: { kind: directory, path: product/apps/opc/src-tauri/src }
  - unit: { kind: file, path: product/apps/opc/vite.config.ts }
  - unit: { kind: file, path: product/apps/opc/tsconfig.json }
  - unit: { kind: file, path: product/apps/opc/src/components/UsageDashboard.tsx }
  - unit: { kind: file, path: product/apps/opc/src/components/TabManager.tsx }
  - unit: { kind: file, path: product/apps/opc/src-tauri/src/commands/usage.rs }
  # Phase 2 — Tier 2 (FR-T8/T9). The benches/ tree and the ci-opc-bench.yml
  # reusable workflow are inaugurated by this spec; declaring them closes the
  # authority seam so `registry-consumer by-authority` returns 180, not silence
  # (the §2 note pre-authorised this follow-up amendment once benches/ existed).
  - unit: { kind: directory, path: product/apps/opc/src-tauri/benches }
  - unit: { kind: file, path: .github/workflows/ci-opc-bench.yml }
extends:
  # Phase 2 adds the opc-bench job + paths-filter route + ci-gate need to
  # ci.yml — an additive extension of spec 177's orchestrator. The coupling
  # gate bypasses .github/ (spec 152 §3.2), so this edge is for honest graph
  # representation / registry-consumer discoverability, mirroring specs 188/191.
  - spec: "177-ci-orchestrator-pr-gate"
    nature: additive
    unit: { kind: file, path: .github/workflows/ci.yml }
  # Phase 2 adds the criterion/filetime dev-deps, the [[bench]] target, and a
  # dedicated [profile.bench] to the opc package manifest for FR-T8 — an
  # additive extension of spec 032's package manifest (032 stays primary
  # owner per §10; this is the same additive-deps shape 064/065/076/119/165/
  # 172/178 already use on this file), satisfying the coupling gate for the
  # manifest edit without displacing the primary-owner claim.
  - spec: "032-opc-inspect-governance-wiring-mvp"
    nature: additive
    unit: { kind: file, path: product/apps/opc/src-tauri/Cargo.toml }
  # Adding spec 180's relationship-graph rows (and the Phase 2 establishes/
  # extends edges) changes spec 180's entry in the featuregraph golden
  # fixture (owned by spec 034). This additive extension claims that fixture
  # path, the same shape specs 188/190/191 use when their registry rows move
  # the golden — so regenerating the golden is coupling-satisfied here.
  - spec: "034-featuregraph-registry-scanner-fix"
    nature: additive
    unit: { kind: file, path: crates/featuregraph/tests/golden/features_graph.json }
refines:
  - aspect: "tab-list-reconciliation-discipline"
    unit: { kind: file, path: product/apps/opc/src/components/TabContent.tsx }
    refines_specs: ["172-opc-live-agent-session-introspection"]
  - aspect: "tab-list-reconciliation-discipline"
    unit: { kind: file, path: product/apps/opc/src/contexts/TabContext.tsx }
    refines_specs: ["172-opc-live-agent-session-introspection"]
  - aspect: "tab-list-reconciliation-discipline"
    unit: { kind: file, path: product/apps/opc/src/hooks/useTabState.ts }
    refines_specs: ["172-opc-live-agent-session-introspection"]
references:
  - role: invariant-freeze-precedent
    unit: { kind: file, path: specs/132-constitutional-invariant-freeze/spec.md }
  - role: invariant-freeze-precedent
    unit: { kind: file, path: specs/153-invariant-freeze-additive-evolution/spec.md }
  - role: bench-precedent
    unit: { kind: file, path: crates/policy-kernel/benches/kernel_eval.rs }
  - role: bench-precedent
    unit: { kind: file, path: tools/oap/policy-compiler/benches/compile_many.rs }
  - role: bench-precedent
    unit: { kind: file, path: tools/spec-spine/codebase-indexer/benches/resolver.rs }
  - role: ci-gate-orchestrator
    unit: { kind: file, path: specs/177-ci-orchestrator-pr-gate/spec.md }
  - role: parallel-claim
    unit: { kind: file, path: specs/165-opc-decomposition-pipeline/spec.md }
  - role: codification-gate-self-check
    unit: { kind: file, path: specs/174-codification-gate/spec.md }
summary: >
  Codifies the previously un-bound OPC desktop shell. Establishes broad
  authority over every authority-empty OPC subsystem root surfaced by
  the Phase 0 seam map (`src/lib/`, `src/services/`, `src/stores/`,
  `src/routes/`, `src/components/factory/`, the top-level `components/`,
  `contexts/`, `hooks/`, the unclaimed subset of `src-tauri/src/commands/`,
  and the build-tooling surface) so that a future `registry-consumer
  by-authority` query against any of these paths returns a named door,
  not silence. Binds Tier 1 structural invariants only on the
  bug-adjacent surface — the tab-list reconciliation files refined from
  spec 172 (`TabContent.tsx`, `TabContext.tsx`, `useTabState.ts`), the
  `UsageDashboard.tsx` / `TabManager.tsx` view shells, and the
  filesystem-scanning IPC handlers (canonical case: `commands/usage.rs`).
  Inaugurates a Tier 2 bench-presence + relative-regression gate for
  filesystem-scanning Tauri handlers (criterion at
  `product/apps/opc/src-tauri/benches/`, N=200 PR / N=2000 nightly, 25%
  regression threshold, amendable). Excludes Tier 3 absolute latency
  budgets explicitly. The Tier 2 gate is operationally owned by the OPC
  subsystem maintainer per §6.
---

# 180 — OPC shell codification

> **OAP specs assert structural invariants; performance is the
> consequence, not the contract.**

## 1. Preamble

This spec closes the spec/code authority seam the Phase 0 discovery
pass surfaced: whole subsystem trees of the OPC desktop returned empty
from `registry-consumer by-authority`, the entire un-bound shell
surface larger than the originating bug report anticipated. Per the
user's Phase 0 resolutions, this spec establishes broad authority
across the un-bound roots without binding behavioral invariants on
roots that have no forcing function, and binds Tier 1 structural
invariants only on the narrow surface the originating perf-bug
touches.

> *Handoff provenance.* The Phase 0 outputs lived as transient
> working-state under `/tmp/handoffs/opc-spine-seam-fix-2026-05-23/`
> and `/tmp/analysis/opc-spine-seam-2026-05-23.md`. Those paths are
> not in the worktree, so they cannot ride as `references:` units (a
> `kind: file` reference must resolve in the worktree per spec 154
> §3.6, and spec 156's `provenance:` grammar covers only `knowledge`
> and `code-fingerprint` URI shapes — handoff briefs are neither).
> The load-bearing observations from those documents are absorbed
> into this spec's body verbatim; the documents themselves remain as
> archival working-state, not as governance edges.

Criterion bench files are an established substrate convention
(precedent: `crates/policy-kernel/benches/kernel_eval.rs`,
`tools/oap/policy-compiler/benches/compile_many.rs`,
`tools/spec-spine/codebase-indexer/benches/resolver.rs`). CI gating on
relative bench regression is **not** established — Phase 0 verified the
three precedent benches are operator-invoked only, with zero CI jobs
running them and zero thresholds enforced. This spec inaugurates CI
gating for handlers under
`product/apps/opc/src-tauri/src/commands/` that scan the user
filesystem. Future amendments may extend gating to the three precedent
benches; that extension is out of scope here.

## 2. Authority enumeration

The seam map surfaced the un-bound OPC surface as whole subsystem
trees, not isolated files. Each un-bound root gets its own
`establishes:` claim in the frontmatter so a future
`registry-consumer by-authority <root>` returns this spec rather than
silence. The enumeration is **not a single blanket glob** — each entry
is named so future codification can refine per-root without ambiguity.

| Path | Scope note |
|---|---|
| `product/apps/opc/src/lib/` | utility library; **no invariants bound; future refinement expected** |
| `product/apps/opc/src/services/` | service-layer persistence (`sessionPersistence.ts`, `tabPersistence.ts`); **no invariants bound** |
| `product/apps/opc/src/stores/` | global state stores (`agentStore.ts`, `projectCatalogStore.ts`, `sessionStore.ts`); **no invariants bound** |
| `product/apps/opc/src/routes/` | routing subtree (currently `routes/factory/*`); **no invariants bound** |
| `product/apps/opc/src/components/factory/` | factory panel components (25 files); **no invariants bound (defer to factory specs for invariant binding)** |
| `product/apps/opc/src/components/` | view shells (top-level); Tier 1 invariants bound only for `UsageDashboard.tsx`, `TabContent.tsx`, `TabManager.tsx` |
| `product/apps/opc/src/contexts/` | React context providers; Tier 1 bound only for `TabContext.tsx` (refines spec 172) |
| `product/apps/opc/src/hooks/` | custom hooks; Tier 1 bound only for `useTabState.ts` (refines spec 172) |
| `product/apps/opc/src-tauri/src/commands/` | IPC handlers; Tier 1 bound for filesystem-scanning handlers (`usage.rs` first; the spec asserts the *pattern* for any future handler that scans the user filesystem, see §3.2) |
| `product/apps/opc/src-tauri/src/` | Tauri shell outside `commands/`; **no invariants bound**, except for the managed-state registration the Tier 1 cache invariant transitively requires (§3.2.2) |
| `product/apps/opc/src-tauri/benches/` | Tier 2 criterion bench directory (§5); **mandated by FR-T8** but NOT declared in `establishes:` because the directory does not yet exist (spec 154 §3.5 hard-errors on missing-directory units at compile time). Phase 2 creates the directory and adds the bench; a follow-up frontmatter amendment to this spec may then claim it under `establishes:` if codification of authority-over-an-empty-bench-tree becomes useful. |
| `product/apps/opc/vite.config.ts`, `tsconfig.json` | build tooling; authority established, **no invariants bound** |

The "no invariants bound" labelling is load-bearing — it tells the next
codification pass "authority is here; behavior is open for refinement."
Per the user's resolutions, binding invariants on a subsystem root
without forcing function is a CONST-005-adjacent failure mode (author
from the seam, not from the appetite).

### 2.1 Relationship-graph posture

- **`establishes:`** the directories above plus three bug-adjacent view
  shells (`UsageDashboard.tsx`, `TabManager.tsx`, `commands/usage.rs`).
  These paths exist on disk but had no authority spec; the new spec
  brings them under explicit authority for the first time.
- **`refines:`** spec 172 on `TabContent.tsx`, `TabContext.tsx`, and
  `useTabState.ts`. Spec 172 `extends:` 032 to claim those files
  additively for the live-sessions panel; this spec adds structural
  invariants about tab-list reconciliation (an aspect 172 does not
  address). The constitutional definition of `refines:` is
  "behavior tightening of an *aspect* across one or more paths" — the
  aspect here is `tab-list-reconciliation-discipline`. Spec 172 keeps
  its `extends:` claims unchanged.
- **`co_authority:`** not declared in this codification. Section
  boundaries between 172's live-session concerns and this spec's
  tab-lifecycle concerns are not yet crisp in code. A future spec may
  transition to section-anchored co-authority per spec 152 once the
  boundaries stabilize; the transition is marked
  `[[opc-tab-system-co-authority]]` below.
- **`extends:`** 032 is not declared on the broad enumeration. 032 is
  the OPC inspect+governance MVP wiring spec at product-consolidation
  granularity; its authority is package-level. This spec brings the
  enumerated subsystem roots under explicit per-root authority, which
  is `establishes:` (none of the roots had file-level authority before
  this spec). This honest declaration also avoids stacking two competing
  `extends: 032` chains on the same root — the 165 / 172 / 178 path
  is per-file `extends: 032` for individual files, which this spec
  preserves; the directory-level claims are this spec's own.

### 2.2 Composition with active drafts and recently-approved specs

- **Spec 165 (`opc-decomposition-pipeline`, draft).** Spec 165
  `establishes:` `commands/decomposition.rs` and `extends:` 032
  additively for three Tauri shell-glue files (`Cargo.toml`,
  `commands/mod.rs`, `lib.rs`). This spec's `establishes:` on
  `src-tauri/src/commands/` does **not** displace 165's establishing
  claim on `commands/decomposition.rs` — that file remains 165's. The
  shell-glue paths 165 extends are also under this spec's broad
  authority over the surrounding directories; per spec 133's
  amends-aware satisfaction and spec 152's section model, edits to
  those files are satisfied by editing **either** authority spec.
- **Spec 172 (`opc-live-agent-session-introspection`, approved).**
  Spec 172 `extends:` 032 to claim `TabContent.tsx`, `TabContext.tsx`,
  `useTabState.ts`, `lib/api.ts`. This spec `refines:` three of those
  four with a tab-list-reconciliation aspect (excluding `lib/api.ts`,
  which is not a tab-list-reconciliation surface).
- **Reverse-edge discoverability.** The user's Phase 0 resolutions
  pre-authorised one-line `refined_by:` / `extended_by:` frontmatter
  additions on specs 172 and 165 for "graph-edge declaration per
  spec 156." On verification during this Phase 1 pass, those fields
  are **not** part of the relationship-graph grammar:
  `KNOWN_KEYS` (`tools/shared/spec-types/src/lib.rs:142+`) does not
  include them, no spec in the corpus uses them, and spec 156
  governs `references.provenance:` for typed external pointers (not
  bidirectional graph edges).

  The discoverability the user wanted is already provided by
  `registry-consumer show-relationships <id>`, which walks the
  corpus for matching forward edges. The mechanism for `refines:`
  specifically is the per-entry `refines_specs: [<target-spec-id>]`
  field consumed by `refines_spec_refs` at
  `tools/spec-spine/registry-consumer/src/lib.rs:741+` and surfaced
  as an Incoming edge at `lib.rs:1266-1272`. This spec's three
  `refines:` entries carry
  `refines_specs: ["172-opc-live-agent-session-introspection"]`, so
  `registry-consumer show-relationships
  172-opc-live-agent-session-introspection` surfaces this spec under
  Incoming. No reverse-edge declaration on 172's frontmatter is
  required; the spec-level link is encoded in this spec's forward
  edge, and the consumer derives the reverse view. (Note: the path
  claim alone — `unit: { kind: file, path: ... }` — does not produce
  a spec-level incoming edge; the explicit `refines_specs:` target
  is what `refines_spec_refs` reads. This is a substantive grammar
  point worth surfacing because the prose in the constitution's
  "Eight relationships" summary describes `refines:` as
  path-and-aspect-scoped without naming `refines_specs:` as the
  reverse-edge bridge.)

  Adding non-load-bearing keys (`refined_by:`, `extended_by:`) to
  approved specs' frontmatter to satisfy a mechanism the registry
  already provides as a derived query is a CONST-005-adjacent move
  (manufacturing the appearance of a grammar feature that doesn't
  exist); this codification declines the carve-out and leaves specs
  172 and 165 untouched. Spec 165's parallel-claim relationship is
  carried in this spec's `references: [{role: parallel-claim,
  unit: …165-…}]` forward edge — `references_spec_refs` is not part
  of the typed-edge incoming derivation, but the `references:` shape
  is itself a non-owning citation per spec 154 §4, so the spec-level
  link is by path-citation, not by reverse-edge declaration.
- **Specs 143, 161, 162 (drafts).** Phase 0 verified zero OPC overlap.
  No composition required.
- **Spec 183 (`opc-boot-precondition-gate`, approved).** Two changes
  land on this spec's titlebar surface (`CustomTitlebar.tsx`, under the
  `src/components` directory authority established above) on 2026-06-04:
  - *(a) Version banner.* The previously-empty titlebar centre now
    renders the OPC version as `OPC v<version>`, resolved at runtime
    from `tauri.conf.json` via `@tauri-apps/api/app`'s `getVersion()`
    (the single version source — `tauri.conf.json`, `package.json`, and
    `src-tauri/Cargo.toml` are all `0.4.0`). This is pure shell-identity
    surface, squarely inside this spec's broad un-bound-shell authority;
    no Tier 1 invariant attaches.
  - *(b) Nav-cluster suppression.* The titlebar's right-side
    cockpit-navigation cluster (Workspace Projects, Factory, Usage,
    Settings, …) is hidden until the boot gate green-lights the cockpit
    (`navEnabled = bootGateOpen`). That visibility rule is **spec 183's
    FR-T3 invariant** ("boot renders ONLY a boot-state surface"), not a
    180 invariant: 183 owns the *when*, this spec owns the *surface*. The
    split mirrors the 165/172 pattern above — edits to
    `CustomTitlebar.tsx` are satisfied by editing this spec's authority,
    and the cross-spec invariant is recorded in both specs in prose
    rather than via a frontmatter authority edge (183 holds no
    `establishes:`/`refines:` claim on this file, by design). See spec
    183 §3.3 FR-T3 (2026-06-04 sub-clause) for the invariant side.

## 3. Tier 1 — Structural invariants

These are boolean assertions about code shape, enforceable by lint
rule, unit test, or coupling-gate edit-trigger. Each invariant cites
the path(s) it constrains.

### 3.1 Tab-list reconciliation (refines spec 172)

**FR-T1.** Components that render a list of tab panels (currently
`product/apps/opc/src/components/TabContent.tsx`) MUST NOT wrap mapped
panel children in `<AnimatePresence mode="wait">`. Exit-on-close
animation, if desired, MUST be local to the closing panel rather than
gating reconciliation of the entire mapped set.

> *Rationale.* `mode="wait"` defers child unmount-and-replace until the
> exit animation completes, which blocks reconciliation of unrelated
> tab panels behind whatever exit animation is in flight. The
> structural defect is "tab-list reconciliation is gated by sibling
> animation"; the structural defense is "no `mode="wait"` wrapping the
> mapped list." This invariant is defensible without reference to any
> specific perf fix — `mode="wait"` is the wrong reconciliation
> contract for a list whose siblings change independently.

**FR-T2.** Components rendered per-tab in the tab list MUST be
memoized via `React.memo` with a comparator that depends on at minimum
`tab.id` and the active-tab marker (currently `isActive`).
Implementation detail (e.g., whether the comparator additionally
depends on tab-local mutable state) is the implementer's call; the
spec asserts the *presence and minimum-key set* of memoization, not
the full comparator shape.

**FR-T3.** `TabContext.tsx` and `useTabState.ts` MUST NOT trigger
remount of all sibling panels on a single panel state change. State
changes that affect only one panel MUST be scoped (e.g., per-panel
state slice, panel-id-keyed selector) so that React reconciliation can
skip unaffected panels.

### 3.2 Filesystem-scanning IPC handlers

The canonical instance is `product/apps/opc/src-tauri/src/commands/usage.rs`.
The invariants below apply to **any** Tauri command handler under
`product/apps/opc/src-tauri/src/commands/` that scans the user
filesystem — present and future. Adding a new such handler without
satisfying these invariants is a spec/code coupling violation under
spec 127/133.

**FR-T4 (async + spawn_blocking).** A Tauri command handler under
`product/apps/opc/src-tauri/src/commands/` that reads from the user
filesystem (i.e., paths outside the app's own resource bundle) MUST
be declared `pub async fn` and MUST perform the blocking filesystem
work via `tokio::task::spawn_blocking` (or an equivalent off-runtime
mechanism). Synchronous handlers MUST NOT block the Tauri runtime on
user-filesystem I/O.

> *Rationale.* Tauri commands run on the runtime that also drives
> window events and IPC. A synchronous filesystem scan starves that
> runtime for the duration of the scan, making the desktop appear
> frozen. This is a Tauri-shaped invariant, not a perf-tuning trick —
> any sync handler that does substantial I/O is structurally wrong
> regardless of how fast the I/O is on any given machine.

**FR-T5 (file-mtime cache).** A handler that aggregates over many
filesystem inputs MUST consult a process-lifetime cache keyed by file
path, with the file's mtime as the freshness marker, before
re-parsing a previously-seen file. A cache miss (file unseen or mtime
changed) MAY re-read; a cache hit (mtime unchanged) MUST NOT re-read
the file body.

> *Rationale.* A file-aggregating handler that re-reads every input on
> every invocation is structurally wrong: the cost grows with corpus
> size and call frequency, and the inputs are unchanged across most
> calls. The mtime-keyed cache is the standard substrate for
> file-mtime-keyed memoization; the invariant binds the substrate
> shape, not the cache library.

**FR-T6 (no redundant reads).** A handler MUST NOT perform multiple
read-passes over the same file in a single invocation (e.g., a
separate sort-key extraction pass followed by a parse pass). One
read produces the in-memory representation; the handler operates on
the in-memory shape. Redundant disk reads of the same path are a
structural defect, not a performance-tuning concern.

**FR-T7 (managed state for cache).** Per FR-T5, a process-lifetime
cache requires a holding location. The Tauri shell at
`product/apps/opc/src-tauri/src/lib.rs` MUST register the cache as
Tauri managed state at app initialization so handlers retrieve it via
`State<...>` rather than constructing per-call. This is the
transitive `src-tauri/src/` invariant the cache requirement implies;
no other invariants bind on `src-tauri/src/` outside `commands/`.

### 3.3 Files the invariants bind on, today

- **FR-T1 / FR-T2 / FR-T3** bind on: `TabContent.tsx`, `TabContext.tsx`,
  `useTabState.ts`, `TabManager.tsx`. `UsageDashboard.tsx` is the
  canonical *consumer* of the tab system but is not itself a
  tab-system file; FR-T1..T3 do not bind on `UsageDashboard.tsx`.
- **FR-T4 / FR-T5 / FR-T6** bind on every filesystem-scanning handler
  under `commands/`. As of the spec's draft date, the canonical
  instance is `commands/usage.rs`. Future filesystem-scanning handlers
  inherit the invariants automatically (this is what makes the spec
  load-bearing for future work).
- **FR-T7** binds on `src-tauri/src/lib.rs` only insofar as cache
  registration is required when at least one handler under FR-T5 is
  present.

## 4. Tier 3 exclusion

Absolute latency budgets ("must complete in <X ms") are **explicitly
out of scope**. The reasoning:

1. **Runner variance.** CI runners and developer workstations vary by
   order of magnitude in I/O bandwidth, memory pressure, and
   concurrent workload. A latency budget that gates merges on one
   environment is a flake source on another.
2. **Performance is consequence, not contract.** The Tier 1 invariants
   above are structural assertions about code shape; if they hold, the
   handler's wall-clock behavior is correct *for any reasonable
   workload*. Binding a number would conflate the shape (durable) with
   the consequence (environment-dependent).
3. **Specs binding absolute numbers age badly.** What is "fast enough"
   on 2026-era hardware is not the same as on 2030-era hardware. The
   spec spine is meant to outlast individual machines.

If a future seam genuinely demands an absolute-latency assertion to be
meaningful (e.g., a UX-perceptibility invariant where "fast enough"
cannot be expressed structurally), the path is amendment of this spec
with explicit justification — not silent insertion of a millisecond
ceiling.

## 5. Tier 2 — Bench-presence + relative regression

### 5.1 The contract

**FR-T8 (bench-presence).** Every Tauri command handler under
`product/apps/opc/src-tauri/src/commands/` that scans the user
filesystem (i.e., every handler subject to FR-T4..T7) MUST have a
corresponding criterion bench file under
`product/apps/opc/src-tauri/benches/`. The bench file MUST exercise
the handler's primary entry point (or a peer-public function the
handler delegates to) over a representative input set.

**FR-T9 (CI gating).** The bench MUST be wired into CI as a job that:

- On `pull_request` / `merge_group`, measures the **base (`main`) commit
  and the head commit on the same runner** and gates merge on relative
  regression **>25%** of head vs that same-runner base.
- Runs at **N=200** input size for the per-PR job (runtime budget
  constraint).
- Runs at **N=2000** input size as a nightly job (compared to the prior
  nightly on a consistent schedule) and surfaces regressions to the
  maintainer.

The 25% threshold is **amendable via spec amendment** if observed
false-positive rate from runner noise becomes operationally
significant. It is not a constitutional invariant. The N=200 / N=2000
split is similarly amendable.

> *Amended 2026-06-06 (same-runner baseline).* The original wiring
> restored a `main` baseline saved by an earlier **push-to-main** run and
> compared the PR/merge_group head against it. Because
> `usage_scan_cold_n200` is a ~6–11 ms cold filesystem-scan microbench
> whose wall-time is dominated by syscall latency, the `macos-latest`
> fleet's ±~80% **inter-runner** I/O variance dwarfed the +25% threshold:
> PR #305 — which changes no code on the benched path (`commands/usage.rs`
> was byte-identical to `main`) — was flagged at +44.8%, +75.7%, and
> +84.4% across three runs, every one spurious. Per this FR's own
> amendability clause (runner-noise false positives), the PR/merge_group
> gate now measures the **base and head commits on the same runner** in
> one job and compares same-runner, so the +25% threshold reflects a real
> code delta rather than which shared runner the job landed on. The
> threshold (+25%) and the relative-only discipline (**FR-T10**) are
> unchanged — only the baseline's *provenance* moved (cross-runner Actions
> cache → same-runner, in-job). `push` still records the informational
> cached `main` baseline (now feeding only the `workflow_dispatch` manual
> diagnostic); the nightly N=2000 trend is unchanged.

> *Amended 2026-06-10 (merge_group path guard + stub idempotence).* The
> same-runner baseline cancelled **inter-runner** variance but not
> **intra-runner temporal drift**: merge-queue run 27305255507 (PR #317)
> flagged +28.2% (CI [+21.2%, +35.9%], p = 0.00) on a diff with **zero
> files under the benched path** — base and head opc sources were
> byte-identical, so the delta could not be a code regression. Two
> amplifiers made this class of false positive structural. (1) Under
> spec 188 Phase 2, `merge_group` forces every route output in `ci.yml`
> to `true` (a merge group has no PR base to diff at the route layer),
> so the gate runs on every queue entry — including diffs the §5.3
> pull_request path filter would have skipped. (2) The job's stub
> re-assertion rewrote the dist stub and `touch`ed the sidecar stub
> after each checkout, bumping their mtimes and invalidating cargo's
> fingerprint (`include_str!` dep-info + tauri-build's externalBin
> tracking) — forcing an unnecessary multi-minute opc recompile between
> the base and head measurements, which widened the time gap and changed
> machine state right before the head run. Per this FR's amendability
> clause, the job now (a) **recomputes the §5.3 path filter in-job**
> against the merge-group base (`git diff --quiet base..head --
> product/apps/opc/src-tauri .github/workflows/ci-opc-bench.yml`) and
> skips the measurement entirely when the diff cannot affect the benched
> code — restoring on `merge_group` exactly the filter `ci.yml` applies
> on `pull_request`; and (b) asserts the stubs **idempotently** (write
> only if missing) so an unchanged opc tree reuses the build cache. The
> threshold (+25%), the relative-only discipline (**FR-T10**), and the
> gate's semantics for opc-touching diffs are unchanged — a diff that
> touches the benched path is still measured and gated same-runner.

> *Amended 2026-06-24 (force the same-runner checkouts).* Same-runner
> mode runs `cargo bench` on the base commit, then `git checkout
> --detach` back to head. `cargo bench` (no `--locked`) rewrites
> `product/apps/opc/src-tauri/Cargo.lock` whenever the checked-out
> commit's lock is bench-incomplete: a `main` base lock can lack the
> criterion dev-dependency closure that a head PR's regenerated lock
> already carries, so building the base mutates its lock and leaves an
> uncommitted working-tree change. The non-forced `git checkout --quiet
> --detach "$HEAD_SHA"` then aborted with "local changes would be
> overwritten by checkout", hard-failing the job (and therefore
> `ci-gate`) on a pure harness fault rather than a code regression: PR
> #437, a dependency-consolidation PR whose head lock was bench-complete,
> hit this deterministically while its 6.8 ms benchmark passed under the
> threshold. Per this FR's amendability clause, both same-runner
> checkouts now pass `--force`, discarding build-induced lockfile churn
> before the commit switch. The threshold (+25%), the relative-only
> discipline (**FR-T10**), and the gate's measurement semantics are
> unchanged: only the checkout's robustness to a cargo-touched working
> tree improved.

> *Amended 2026-06-25 (narrow the in-job path guard to benched source +
> harness).* The 2026-06-10 in-job guard skipped the same-runner
> measurement only when base..head touched neither
> `product/apps/opc/src-tauri/**` (the whole crate directory) nor this
> workflow, mirroring `ci.yml`'s `pull_request` route filter. But the
> crate directory also contains `Cargo.lock`, `Cargo.toml`, `build.rs`,
> and the `tauri.*.conf.json` files, so a deps-only or config-only diff
> still ran the gate and stayed exposed to the residual intra-runner
> temporal variance the 2026-06-10 amendment documents (+28.2% on a
> zero-opc diff). The dependency-refresh class is the canonical case: PR
> #441 (a lockfile-only bump of `anyhow`, `env_logger`, `env_filter`)
> and the earlier #437 / #438 consolidation all touched the crate
> directory without touching the benched `usage_scan` handler, and
> #437 / #438 needed a branch-protection bypass to land past a spurious
> regression flag. The benched microbench's measured runtime is
> determined solely by the handler source (`src-tauri/src/**`) and the
> bench harness (`src-tauri/benches/**`); a lockfile or manifest edit
> cannot change it in a way the relative gate should police. Per this
> FR's amendability clause, the in-job guard's benchable set is narrowed
> to `src-tauri/src`, `src-tauri/benches`, and this workflow, so
> deps/config-only diffs skip the same-runner measurement on both
> `pull_request` and `merge_group`. This makes the in-job filter
> deliberately **stricter** than `ci.yml`'s `src-tauri/**` route filter,
> which still dispatches the job (it now exits early without measuring).
> The narrowing is a scoped, documented reduction of gate coverage, not
> a silent disablement (§5.4): the gate still fires fully on any change
> to the benched source or harness, and the nightly N=2000 trend
> (non-gating) remains the safety net for a genuine dependency-driven
> regression. The threshold (+25%), the relative-only discipline
> (**FR-T10**), and the gate's measurement semantics for source-touching
> diffs are unchanged.

**FR-T10 (no Tier 3 leak).** The Tier 2 gate MUST NOT assert any
absolute latency value. It is strictly a relative-delta comparison
against the saved baseline. Inserting an absolute threshold into the
gate body is a CONST-005-adjacent failure mode (Tier 3 leaking into
Tier 2 by stealth); spec amendment is the only path past this
invariant.

### 5.2 Inaugural posture (honest framing)

CI gating on criterion bench regression is **not** an existing OAP
substrate convention. The three precedent benches
(`policy-kernel/benches/`, `policy-compiler/benches/`,
`codebase-indexer/benches/`) are operator-invoked only; no CI workflow
runs them, no threshold guards them. Phase 0 verified this directly.

Therefore this spec **inaugurates** CI bench gating for the OPC IPC
layer. The framing "extends criterion precedent" is true at the
*bench-file* level (the criterion convention, the `[[bench]]` Cargo
declaration, the `cargo bench` runtime) and is **not** true at the
*gating* level. The spec author is responsible for honest framing;
silent inflation of "extends" into "extends with gating" would be a
CONST-005-adjacent rhetorical slide.

Future amendments may extend gating to the three precedent benches.
That work is out of scope here.

### 5.3 CI wiring under spec 177

Per spec 177 (`ci-orchestrator-pr-gate`), the PR-gate workflow fleet
has been collapsed behind a single `ci-gate` aggregator at
`.github/workflows/ci.yml`. The Tier 2 bench gate this spec mandates
MUST be wired as a `workflow_call:` reusable workflow dispatched from
`ci.yml` (path-filtered on `product/apps/opc/src-tauri/**`), not as a
new top-level workflow that registers separately with branch
protection. The gate's failure composes into `ci-gate` via the
standard `needs:` + `if: always()` aggregator pattern spec 177 §2.4
specifies. On `merge_group`, where the route layer cannot compute that
filter (spec 188 Phase 2 forces all route outputs `true`), the bench
job recomputes a path filter in-job against the merge-group base and
skips the measurement when nothing benched changed. As of the
2026-06-25 narrowing that in-job filter is deliberately **stricter**
than the route layer's `src-tauri/**`: it fires only on the benched
source (`src-tauri/src/**`), the bench harness (`src-tauri/benches/**`),
or this workflow, so deps/config-only diffs skip the same-runner
measurement on both `pull_request` and `merge_group` (FR-T9 amendments
2026-06-10 and 2026-06-25).

### 5.4 Section 6 — Operational ownership

This spec's Tier 2 CI gating is operationally owned by the OPC
subsystem maintainer. Amendment of the 25% threshold, baseline
rebasing, regression triage, and per-handler bench wiring under
FR-T8 are that owner's responsibility. A noisy gate must be diagnosed
and either amended (per the spec amendment process) or have the
underlying noise fixed; silent disablement is a CONST-005-adjacent
failure mode and is itself a CRITICAL finding under spec 174's
codification-gate semantics.

The operational-ownership clause is not boilerplate. Leaving
ownership implicit creates a tragedy-of-the-commons risk where the
first noisy false-positive results in the gate being silently
disabled — the same failure mode the codification-gate exists to
defend against. Naming the owner is the structural defense.

## 6. Self-check against spec 174

Spec 174 (`codification-gate`) blocks session closure when a
CRITICAL/HIGH finding from `axiomregent`, `provenance-validator`, or
`policy-kernel` is unrepresented in the spec spine. This spec is
authored under that gate's standards.

Mental simulation: a hypothetical future session touches
`commands/usage.rs`, runs the gate at close, and surfaces findings
about handler shape (async vs sync), cache discipline, or redundant
reads. Would those findings be flagged as unrepresented?

- **Handler-shape findings (`pub async fn`, `spawn_blocking`).**
  Represented by FR-T4. Class match: "Tauri command handlers under
  `src-tauri/src/commands/` that scan the user filesystem MUST be
  `pub async fn`, performing the blocking work via
  `tokio::task::spawn_blocking`." Keyword overlap is high (sync,
  async, blocking, command handler) — 174's heuristic matcher would
  pass.
- **Cache discipline findings (mtime-keyed memoization).**
  Represented by FR-T5. Class match: "MUST consult a process-lifetime
  cache keyed by file path with mtime as the freshness marker."
- **Redundant-reads findings.** Represented by FR-T6. Class match:
  "MUST NOT perform multiple read-passes over the same file."
- **Tab-list reconciliation findings.** Represented by FR-T1..T3.
  Class match: "MUST NOT wrap mapped panel children in
  `<AnimatePresence mode='wait'>`", "MUST be memoized via React.memo
  with a comparator on `tab.id` and `isActive`".

A future session touching any of these surfaces and producing a
CRITICAL/HIGH finding finds the corresponding rule already in the
spine. The codification is not shaped to evade 174's gate; it
satisfies the gate by binding the rules the gate would otherwise
demand.

## 7. Out of scope (and why)

- **CLAUDE.md spec-traceability.** Whether the three CLAUDE.md files
  (`./CLAUDE.md`, `./platform/CLAUDE.md`,
  `./platform/services/statecraft/CLAUDE.md`) should be spec-traceable
  is a real but separate question. Future-work pointer:
  `[[claude-md-spec-traceability]]`. This codification does not
  resolve it; the seam map flagged it as adjacent.
- **`tabPersistence.ts` double-listing.** Phase 0 reported both
  `src/lib/tabPersistence.ts` and `src/services/tabPersistence.ts`.
  This spec's broad authority over both directories covers either
  case; investigating which file (or both) actually exists is a
  code-hygiene concern separate from this codification.
- **CI gating extension to the three precedent benches.**
  `policy-kernel/`, `policy-compiler/`, `codebase-indexer/` benches
  remain operator-invoked. Extending the inaugural gating to them is
  a future amendment.
- **Tier 1 invariants on subsystem roots without forcing function.**
  Per user resolutions §5, this spec deliberately does **not** bind
  invariants on `lib/`, `services/`, `stores/`, `routes/`,
  `components/factory/`, or the bulk of `components/`/`hooks/`/`contexts/`.
  Authority is established broadly; behavior binding is left for
  future refinement when a real forcing function appears.
- **Co-authority transition with spec 172.** Section-anchored
  co-authority per spec 152 is the more powerful machinery, but the
  section boundaries between 172's live-session concerns and this
  spec's tab-lifecycle concerns are not yet crisp in code. Future-
  work pointer: `[[opc-tab-system-co-authority]]`.
- **Force-disconnect / live-session invariants.** Spec 172 owns the
  live-sessions surface (`LiveSessionsPanel.tsx`, `activity.rs`,
  `live_sessions.rs`). This spec does not reach into 172's
  establishing claims.
- **Refactor of `src-tauri/src/lib.rs` beyond cache registration
  (FR-T7).** The shell file's broader shape is not bound; only the
  managed-state registration the cache invariant transitively
  requires.

## 8. Future work

- `[[claude-md-spec-traceability]]` — whether CLAUDE.md files become
  spec-traceable.
- `[[opc-tab-system-co-authority]]` — section-anchored co-authority
  between this spec and spec 172 once section boundaries crystallize.
- `[[opc-bench-gate-extension-to-spec-spine-tools]]` — extending the
  inaugural Tier 2 gating to `policy-kernel/`, `policy-compiler/`,
  and `codebase-indexer/` benches.
- `[[opc-shell-tier1-broadening]]` — Tier 1 invariants on currently
  no-invariants-bound subsystem roots (`lib/`, `services/`, etc.)
  when concrete forcing functions surface.
- `[[opc-boot-precondition-gate]]` — spec 183 codifies the runtime
  preconditions that gate the OPC boot→cockpit transition (bundled
  sidecar health, materialised org session) and the precondition-loss
  semantics that keep the cockpit honest mid-session. Topically
  adjacent to this spec's authority enumeration and tab-system /
  filesystem invariants, but framed separately so 183 can land
  without bloating this draft. The MCP-routing replumb of Semantic
  Search / Call Graph / Checkpoint follows under spec 183's
  simplifying assumption that sidecar availability is already
  asserted by the boot gate; the in-cockpit probe-port poll added in
  commit `993de5ae` becomes redundant once 183 lands and is expected
  to be removed as part of that implementation.

## 9. Acceptance

- **AC-1.** Spec frontmatter declares `kind: governance`, `domain: opc`,
  `origin.retroactive: true`. The relationship-graph fields
  (`establishes`, `refines`, `references`, `depends_on`) are populated
  per §2.
- **AC-2.** `spec-lint` does not regress; **V-020** does not fire on
  this spec (every relationship-graph field is explicitly declared).
- **AC-3.** `make pr-prep` exits clean against `origin/main` with
  this spec as the sole new authored artifact (plus the regenerated
  `.derived/codebase-index/index.json`). No edits to other specs'
  bodies or frontmatter; no `oap.spec` manifest changes (see §10 and
  AC-5).
- **AC-4.** `registry-consumer by-authority` returns
  `180-opc-shell-codification` for every path this spec claims
  authority over via unit-grammar:

  ```bash
  registry-consumer by-authority product/apps/opc/src/lib
  registry-consumer by-authority product/apps/opc/src/services
  registry-consumer by-authority product/apps/opc/src/stores
  registry-consumer by-authority product/apps/opc/src/routes
  registry-consumer by-authority product/apps/opc/src/components/factory
  registry-consumer by-authority product/apps/opc/src/contexts
  registry-consumer by-authority product/apps/opc/src/hooks
  registry-consumer by-authority product/apps/opc/src-tauri/src/commands
  registry-consumer by-authority product/apps/opc/src-tauri/src
  registry-consumer by-authority product/apps/opc/src-tauri/src/commands/usage.rs
  registry-consumer by-authority product/apps/opc/src/components/UsageDashboard.tsx
  registry-consumer by-authority product/apps/opc/src/components/TabManager.tsx
  registry-consumer by-authority product/apps/opc/vite.config.ts
  registry-consumer by-authority product/apps/opc/tsconfig.json
  ```

  Each query returns `180-opc-shell-codification` with relationship
  `establishes`. The three refines paths
  (`TabContent.tsx`, `TabContext.tsx`, `useTabState.ts`) return
  `180-opc-shell-codification` with relationship `refines` (and 172
  with relationship `extends`, as joint authorities). The
  authority-empty subsystem trees Phase 0's seam map surfaced no
  longer return empty.
- **AC-5.** Specs 172 and 165 are **not** modified by this PR. The
  user's Phase 0 resolutions pre-authorised one-line `refined_by:` /
  `extended_by:` additions on those specs; verification during
  authoring established those fields are not part of the
  relationship-graph grammar (see §2.2's "Reverse-edge
  discoverability" paragraph). Incoming-edge discoverability is
  already a derived query via `registry-consumer show-relationships
  <spec-id>`, which walks the corpus for forward edges after this
  spec lands. No frontmatter churn on approved specs is required.
- **AC-6.** This spec is self-consistent under spec 174's
  codification-gate heuristic (per §6's mental simulation). The
  Tier 1 invariants cover the class of CRITICAL/HIGH findings a
  future session touching the bug-adjacent surface would surface.
- **AC-7.** Tier 2 implementation is *not* part of this spec's
  acceptance — adding the criterion bench, wiring it under spec 177's
  `ci-gate`, and surfacing the threshold are Phase 2 work. AC-7
  asserts only that the contract (FR-T8..T10) is unambiguous enough
  for a Phase 2 implementer to satisfy mechanically.

## 10. Manifest posture (no `oap.spec` displacement)

The two OPC desktop manifests already carry primary-owner claims:

- `product/apps/opc/package.json` → `"oap": { "spec":
  "032-opc-inspect-governance-wiring-mvp" }`
- `product/apps/opc/src-tauri/Cargo.toml` → `[package.metadata.oap]
  spec = "032-opc-inspect-governance-wiring-mvp"` (added by spec 178
  per Phase 0's surfaced gap)

This spec does **not** displace 032 as the package's primary owner.
Spec 032 is `kind: product-consolidation` — the OPC desktop's product
identity claim. Spec 180 is `kind: governance` — a structural-invariant
overlay on a subset of 032's product surface. Both are legitimate
authorities on the package; 032 is the product owner, 180 is the
governance overlay. The codebase-indexer surfaces 032 in the package's
Spec column (the primary-owner attribution); spec 180's authority over
specific directories and files arrives via the relationship-graph
fields in §2 (`establishes:`, `refines:`), which the coupling gate
consumes alongside the manifest claim per spec 130's any-one-claimant
heuristic and spec 133's amends-aware satisfaction.

Overwriting an established primary-owner claim to fit a new spec is a
CONST-005-adjacent move; the relationship graph is the right vehicle
for added authority, and this spec uses it.

No manifest backfill is required by this codification beyond what
spec 178 already landed.

## 11. Cross-references

- **Spec 032** — OPC inspect+governance MVP; the package-level
  predecessor whose surface this spec's per-directory `establishes:`
  claims sit alongside.
- **Spec 132** — constitutional-invariant-freeze; precedent for
  binding structural invariants with `kind: governance`.
- **Spec 133** — amends-aware coupling gate; the satisfaction
  predicate this spec rides for spec-edit-satisfies-coupling under
  refines/extends edges.
- **Spec 147** — spec-kind grammar; `kind: governance` is the
  empirically-correct fit (per VALID_KINDS and the 132/153 precedent
  for invariant-binding governance specs).
- **Spec 152** — path co-authority; future-work substrate for
  section-anchored co-authority with spec 172.
- **Spec 153** — invariant-freeze additive evolution; the refined
  semantics under which future amendments to this spec must remain
  backward-compatible.
- **Spec 154** — logical-unit ownership grammar; unit declarations
  in `establishes:` / `refines:` use this grammar.
- **Spec 156** — references-edge provenance grammar; one-line
  bidirectional edge declarations on specs 165 and 172 use this
  grammar's discoverability posture.
- **Spec 166** — OPC stop-hook gate chain; Tier 2 bench gate composes
  with its block-on-non-zero semantics at the CI layer (the chain
  itself is Stop-hook-time, but the operational owner / silent-
  disablement defense rides the same posture).
- **Spec 172** — live agent-session introspection; this spec
  `refines:` 172 on three tab-system files.
- **Spec 174** — codification-gate; this spec self-checks against
  174's CRITICAL/HIGH heuristic per §6.
- **Spec 177** — CI orchestrator PR-gate; the Tier 2 bench gate wires
  under `ci-gate`, not as a new top-level workflow.
- **Spec 178** — OPC directory rename; the predecessor PR that
  brought every path in this spec to its post-rename form.
- **Spec 179** — domain frontmatter field; the precondition that
  makes `domain: opc` filterable.

## 12. Profile alignment for build reuse (completion, 2026-06-03)

This spec landed the OPC desktop's build **mechanism** — its own Cargo
workspace (split from root), an aggressive size-optimised
`[profile.release]` (`opt-level="z"`, `lto=true`, `codegen-units=1`,
`panic="abort"`, `strip=true`), and the `[profile.bench]` carve-out that
FR-T8's benches needed to compile under that release profile. It recorded
the mechanism but **not the rationale that made the mechanism necessary**,
leaving the reasoning to be re-derived by investigation. This section
completes 180 by recording that rationale and updating the mechanism to its
now-correct form. It does **not** overturn 180; it makes 180 complete enough
that this reasoning is never re-litigated.

### 12.1 Why the workspace split exists (the libsqlite3-sys isolation)

`product/apps/opc/src-tauri` is a **self-contained Cargo workspace, excluded
from the root workspace** (`exclude = ["product/apps/opc/src-tauri", …]` in
root `Cargo.toml`). The reason is a hard Cargo constraint, not ergonomics:

- Both sides link SQLite. OPC links it directly via `rusqlite`; axiomregent
  links it via `hiqlite → rusqlite → libsqlite3-sys`.
- `libsqlite3-sys` declares `links = "sqlite3"`. **Cargo permits exactly one
  package declaring a given `links` key per dependency graph.** If two
  *different* `libsqlite3-sys` versions ever co-resolved in one graph, the
  build fails hard: *"multiple packages link to native library `sqlite3`"*.
- Separate workspaces = separate Cargo resolution graphs = each side resolves
  its **own single** `libsqlite3-sys`, so the collision cannot occur. This is
  the isolation the split buys. (The rationale was previously implicit in a
  one-line comment on `src-tauri/Cargo.toml`; it is now recorded here.)

### 12.2 The merge is rejected (and stays rejected)

Folding `src-tauri` into the root workspace was evaluated and **rejected**.
A single workspace re-exposes exactly what the split prevents:

1. **The `links="sqlite3"` collision returns.** A unified graph has one
   resolution; if OPC's `rusqlite` range and hiqlite's ever resolve to
   incompatible `libsqlite3-sys` majors, the unified build hard-errors.
2. **`rusqlite` feature-union.** axiomregent (via hiqlite) activates a large
   `rusqlite` feature set (`load_extension`, `vtab`, `series`, `functions`,
   `backup`, …); OPC activates a minimal set. A `--workspace` build unifies
   features → OPC's bundled SQLite would silently gain `load_extension`/`vtab`
   — a change to installer contents and security surface.

The merge buys **zero additional reuse** over the route in §12.3, while
re-introducing both hazards. Do not re-propose it; the reuse goal is met
without it.

### 12.3 How shared-crate reuse is actually delivered

OPC and axiomregent share a 9-crate internal core (`agent`,
`agent-frontmatter`, `canonical-json`, `featuregraph`, `policy-kernel`,
`registry-reader`, `spec-types`, `run`, `xray`) and ~555 packages total
across their two dependency graphs. Reuse is delivered by **three aligned
conditions, not by merging**:

1. **Profile-match.** Cargo keys artifact reuse by a per-unit fingerprint
   (package id, features, profile codegen flags, target, rustc, RUSTFLAGS,
   dependency metadata-hashes) — *not* by workspace identity. So two separate
   workspaces sharing a `CARGO_TARGET_DIR` (or an `sccache` cache) reuse a
   crate's compiled `.rlib` **iff** the fingerprints match. This is why
   `[profile.release]` is aligned to the root workspace's **cargo defaults**
   (`opt-level=3`, `lto=false`, `codegen-units=16`, `panic="unwind"`): a
   matching profile is a precondition of the shared fingerprint.
2. **Shared target/cache** across both builds (Part B follow-on; `sccache` is
   recommended over a raw shared `CARGO_TARGET_DIR` for cross-runner CI reuse).
3. **Lock-alignment.** Profile-match is necessary but **not sufficient** — a
   shared crate only reuses if its whole transitive subtree resolves
   identically. The two `Cargo.lock`s currently diverge on ~94 packages; the
   divergent shared subgraphs that block reuse must be aligned (watching the
   crypto/TLS path — `aws-lc-rs`/`openssl`/`h2` — where any shared bump changes
   **both** shipped binaries). This is Part B follow-on work, measured
   before/after so the win is quantified, not assumed.

`strip` is a **link-time** step on the final binary only; it does not key
dependency-`.rlib` reuse, so OPC keeps `strip=true` for a tidy binary while
still sharing the core.

### 12.4 The corrected profile decision: reuse-over-size

Operator decision (settled): **optimise the OPC release profile for
shared-crate build reuse / CI speed over binary size.** Tauri v2's lean
baseline (a ~29.7 MB dmg) makes the size knobs (`opt-level="z"`, `lto=true`,
`codegen-units=1`) **not worth their build-time cost** — `lto` + `cu=1`
serialise codegen and add whole-program link time, and they diverge OPC's
fingerprint from root, defeating reuse. `[profile.release]` is therefore
aligned to cargo defaults; only `strip=true` remains (link-only, reuse-safe).

### 12.5 Why `panic = "unwind"` — behavioral, not size

The `panic="abort"` → `panic="unwind"` change is decided on **behavioral**
grounds, independent of the size decision:

- OPC has **no dependence on abort semantics**. The only `abort` calls in
  `src-tauri` are `tokio::JoinHandle::abort()` (async task cancellation);
  `src-tauri/src` itself has no `catch_unwind`, no `std::panic` hook, and no
  `extern "C"`/`#[no_mangle]` FFI.
- The one `catch_unwind` reachable in OPC's *dependency graph* —
  `provenance-validator`'s `validate()`/`audit()` (pulled in via
  `factory-engine`) — is a deliberate **fail-closed** safety net: a validator
  panic is converted to a `ProvenanceMode::Rejected` report (`panic_report`),
  never silently allowed past a gate. **The caller enforces it**:
  `factory-engine`'s quality gate treats a caught validator panic as an
  *unconditional* `Fail` (`stages/quality_gates.rs` FR-005 — "Always Fail;
  never depends on mode"; module doc: "any `Rejected` claim FAILs the gate").
  It is **already exercised under `unwind`** in the `factory-engine`/axiomregent
  path today (the root workspace is `unwind`), so OPC→`unwind` makes OPC
  *consistent* with that established behavior rather than introducing it. Under
  OPC's prior `abort` the catch was inert (abort does not unwind, so a validator
  panic crashed OPC instead of rejecting) — `unwind` is therefore strictly safer
  here, not riskier.
- The `cdylib`/`staticlib` crate-types are Tauri's **mobile** FFI artifacts,
  not compiled into the desktop dmg. The only mobile FFI entry point is `run()`
  decorated `#[cfg_attr(mobile, tauri::mobile_entry_point)]`
  (`src-tauri/src/lib.rs:91`) — Tauri's macro emits it as `extern "C"`, which
  auto-aborts on unwind (Rust ≥1.81), and it is `#[cfg(mobile)]`-gated. No naked
  Rust panic crosses a non-`extern "C"` `cdylib` boundary, so `unwind` is not UB
  even on a mobile build.
- `unwind` is **more resilient**: a panicking Tauri command unwinds to a
  `JoinError` at the tokio task boundary instead of aborting the whole app.
- **axiomregent stays `unwind` (the default) — do NOT flip it to `abort`.**
  axiomregent is a long-lived stdio MCP server with embedded hiqlite (raft +
  SQLite); under `abort` a single panicking handler would kill the server and
  in-flight state. Alignment is OPC→unwind (toward axiomregent's existing
  default), never axiomregent→abort.

### 12.6 The `[profile.bench]` carve-out is retired (FR-T8 persists)

The `[profile.bench]` block existed for one reason: to decouple FR-T8's
criterion benches from release's `panic="abort"` + whole-program LTO, which
otherwise produced panic-strategy rlib mismatches on the cross-workspace path
deps (*"can't find crate for `orchestrator`"*). With `[profile.release]` now
at `unwind` + defaults, `bench` inherits the correct strategy and the carve-out
is redundant — it is **removed**. **FR-T8 (bench-presence for fs-scanning
handlers) is unchanged and remains required**; only the now-moot
profile-decoupling mechanism is gone. The `usage_scan` bench carries no
panic/abort dependency beyond buildability, which the inherited `unwind`
release profile satisfies.

### 12.7 Standing obligation: the SQLite drift-guard

By recording §12.1–12.2 — "separate workspaces preserve the
`links="sqlite3"` isolation" — 180 now **asserts** that guarantee, and
therefore owns the obligation to detect if it silently erodes. The erosion
mode is precise: **OPC's `rusqlite` range and hiqlite's `rusqlite` range
resolving to incompatible `libsqlite3-sys` MAJORS.** Today they are aligned
(`libsqlite3-sys 0.37.0`, `rusqlite 0.39.0` on both locks); the merge-rejection
argument holds only while they stay single-major-compatible.

**FR-T11 (sqlite-isolation drift-guard).** CI MUST detect when the OPC
workspace lock (`product/apps/opc/src-tauri/Cargo.lock`) and the root
workspace lock (`Cargo.lock`) resolve `libsqlite3-sys` to **different major
versions**. On divergence the guard fails with a diagnostic pointing here
(§12.2): the shared-target reuse assumption and the "merge is safe to avoid"
argument both rest on single-major-compatibility, and a major split means the
two binaries no longer share the SQLite native layer.

- **Proposed home:** a small shell check under `tools/lint/` (the spec-158 /
  spec-193 `release-version-guard.sh` precedent — a fixture-tested shell lint),
  wired as a `make ci` sub-target so it runs in the fast local loop and the
  PR gate. It reads the two committed lockfiles only (present in a bare
  checkout, no build), so it is cheap and fail-fast.
- **Scope note:** the guard checks *major* compatibility, not exact-version
  equality — patch/minor drift between the two locks is expected and harmless;
  only a `links="sqlite3"` major incompatibility is the failure this guards.
- Implementation is the immediate follow-on (with Part B); this section specs
  the obligation and its home so it is not lost.

### 12.8 What this completion changed

- `product/apps/opc/src-tauri/Cargo.toml`: `[profile.release]` aligned to
  cargo defaults (size knobs + `panic="abort"` removed; `strip=true` kept);
  `[profile.bench]` block removed.
- This section (§12) recording the rationale, the merge-rejection, the reuse
  mechanism, and FR-T11.
- **Not changed:** axiomregent's profile (stays `unwind`/default); FR-T8
  bench-presence; 032's primary-owner claim on the manifest (§10); the
  workspace split itself (kept, per §12.1–12.2).
