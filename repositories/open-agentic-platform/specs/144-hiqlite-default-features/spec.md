---
id: "144-hiqlite-default-features"
slug: hiqlite-default-features
title: "Hiqlite default-features hygiene — stop unifying upstream defaults across the crates workspace"
status: approved
implementation: complete
owner: bart
created: "2026-05-10"
closed: "2026-05-10"
kind: tooling
domain: platform
risk: low
depends_on:
  - "073-axiomregent-unification"  # axiomregent-unification (axiomregent's hiqlite usage)
  - "052-state-persistence"  # state-persistence (orchestrator's hiqlite-backed distributed mode)
code_aliases: ["HIQLITE_DEFAULT_FEATURES"]
refines:
  - aspect: "cargo-manifest-hygiene"
    unit: { kind: file, path: crates/orchestrator/Cargo.toml }
  - aspect: "cargo-manifest-hygiene"
    unit: { kind: file, path: crates/axiomregent/Cargo.toml }
summary: >
  `crates/orchestrator/Cargo.toml:20` declares the `hiqlite` dependency
  without `default-features = false`. Cargo unifies features across the
  `crates/` workspace, silently turning `auto-heal`, `backup`, `s3`, and
  `toml` on for both `orchestrator` and `axiomregent` even though
  axiomregent correctly sets `default-features = false` itself; the
  unification pulls `cron`, `toml 1.1.2+spec-1.1.0` (and the already-explicit
  `futures-util`) into `crates/Cargo.lock` for code that never runs. This
  spec adds the missing flag, drops two redundant feature entries
  (axiomregent `cache`, orchestrator `dlock`), surfaces `auto-heal` as an
  explicit choice in both crates, and verifies the lockfile no longer
  carries the unified-by-accident transitives. No source code, schema, or
  runtime behaviour changes. The deployd-api-rs durability fix is its own
  spec (145).
---

# 144 — Hiqlite default-features hygiene

## 1. Background

The `crates/` Cargo workspace currently ships every binary that depends
on hiqlite — including the desktop `axiomregent` crate, transitively
via `product/apps/opc/src-tauri` — with `auto-heal`, `backup`, `s3`, and
`toml` compiled in, even though no source code imports a single API
those features expose. The cause is a single missing manifest flag
captured in `audit.md` (this directory) Phase 2.2 and Phase 3a.

`crates/orchestrator/Cargo.toml:20`:

```toml
hiqlite = { version = "~0.13", features = ["sqlite", "dlock", "listen_notify_local"], optional = true }
```

The line lacks `default-features = false`. Cargo then unifies the
upstream default set (`auto-heal`, `backup`, `sqlite`, `toml`) across
the workspace, defeating axiomregent's own `default-features = false`
flag at `crates/axiomregent/Cargo.toml:38`. `crates/Cargo.lock`
confirms the bleed: `cron` (pulled in by `backup`), `futures-util`
(already explicit via `listen_notify_local`), and
`toml 1.1.2+spec-1.1.0` (pulled in by `toml`) are present in the
hiqlite deps block.

The negative control is `platform/services/deployd-api-rs/Cargo.lock`
— a separate Cargo workspace whose hiqlite dep correctly sets
`default-features = false`. Its lockfile contains none of `cron`,
`futures-util`, or `toml 1.1.2+spec-1.1.0` in the hiqlite deps block.
The drift is therefore not an upstream-version problem (both lockfiles
resolve `0.13.1` against the same checksum) — it is the orchestrator
manifest declaration alone.

Two adjacent cleanups land in the same diff:

- **`axiomregent`'s explicit `cache`** (`crates/axiomregent/Cargo.toml:38`)
  is redundant. Both `dlock` and `listen_notify_local` already require
  `cache` transitively per upstream `hiqlite/Cargo.toml`. Listing it
  alongside either is misleading without changing what gets compiled.
- **`orchestrator`'s explicit `dlock`** (`crates/orchestrator/Cargo.toml:20`)
  is dead. `grep -rnE 'client\.lock\(|hiqlite::Lock' crates/orchestrator/src`
  returns no hits, and `hiqlite::Lock` is not imported anywhere in
  `hiqlite_store.rs:17`. `verifications.md` Q2 further confirms the
  entire `--features distributed` build path is dead-on-disk: no
  `Cargo.toml`, CI workflow, Makefile, or downstream consumer enables
  it, so the gated code does not ship in any binary OAP currently
  produces. Removing `dlock` is therefore cosmetic, but worth doing on
  the same line that takes the load-bearing fix.

The fifth toggle — `auto-heal` — is a deliberate choice rather than a
removal. Once `default-features = false` is in place, `auto-heal` stops
being inherited; the spec promotes it back to an explicit feature on
both crates because cheap WAL self-repair is a real reliability win on
both the desktop process (axiomregent) and the single-node fallback
path that `local-sqlite` would not use anyway (orchestrator's
distributed mode is dead today, but the explicit choice prevents
silent re-enablement when the path revives).

## 2. Resolution

### 2.1 Orchestrator manifest

`crates/orchestrator/Cargo.toml:20` becomes:

```toml
hiqlite = { version = "~0.13", default-features = false, features = ["sqlite", "listen_notify_local", "auto-heal"], optional = true }
```

Three changes on one line:

1. Add `default-features = false`. Stops Cargo from unifying upstream
   defaults across the workspace — the load-bearing fix.
2. Drop `dlock`. Dead code; `verifications.md` Q2 confirms the
   distributed build path does not ship anywhere.
3. List `auto-heal` explicitly. Was inherited by accident; recorded as
   an intentional choice now that the inheritance is gone.

`cache` is **not** listed. It remains active transitively via
`listen_notify_local` (upstream `listen_notify_local = ["cache"]`),
which is the correct posture for a feature axiomregent's source code
does not directly call.

### 2.2 Axiomregent manifest

`crates/axiomregent/Cargo.toml:38` becomes:

```toml
hiqlite = { version = "~0.13", default-features = false, features = ["sqlite", "dlock", "listen_notify_local", "auto-heal"] }
```

Two changes on one line:

1. Drop `cache`. Redundant — required transitively by both `dlock` and
   `listen_notify_local`.
2. List `auto-heal` explicitly. Was inherited via the orchestrator
   manifest defect; recorded as an intentional choice now.

`dlock` and `listen_notify_local` stay — both have direct call sites in
axiomregent (`router/dlock.rs:34`, `events.rs:37`).

### 2.3 Lockfile regeneration

After §2.1 and §2.2, run `cargo check --manifest-path
crates/orchestrator/Cargo.toml` (or `cargo generate-lockfile
--manifest-path crates/Cargo.toml`, which is the workspace root and
owns `crates/Cargo.lock`) to regenerate the lockfile without compiling
the world. The hiqlite deps block must:

- Drop `cron` (pulled in only by `backup`).
- Drop `toml 1.1.2+spec-1.1.0` (pulled in only by the `toml` feature).
- Retain `futures-util` (still required by the explicit
  `listen_notify_local`).
- Retain `cryptr`, `s3-simple`, `deadpool`, `rusqlite`, etc.
  (unconditional or feature-independent transitives).

`platform/services/deployd-api-rs/Cargo.lock` is **not** touched —
that workspace is unaffected by this change.

### 2.4 CI verification

`.github/workflows/ci-orchestrator.yml` invokes the composite
`./.github/actions/rust-ci` action against
`crates/orchestrator/Cargo.toml` with no `--features` flag, exercising
the default `local-sqlite` build (`crates/orchestrator/Cargo.toml:11-13`).
This spec confirms the manifest change does not perturb that path:
`cargo check`, `cargo clippy`, and `cargo test` against the
orchestrator manifest with default features must pass before the
spec is closed.

## 3. Acceptance criteria

- **AC-1** — `crates/orchestrator/Cargo.toml:20` carries
  `default-features = false`, lists `["sqlite", "listen_notify_local",
  "auto-heal"]`, and does not list `dlock`.
- **AC-2** — `crates/axiomregent/Cargo.toml:38` lists
  `["sqlite", "dlock", "listen_notify_local", "auto-heal"]` and does
  not list `cache`.
- **AC-3** — Post-regen `crates/Cargo.lock` does not contain
  `cron` or `toml 1.1.2+spec-1.1.0` in the hiqlite-attributable
  transitive set; it does still contain `futures-util` (kept by
  explicit `listen_notify_local`).
- **AC-4** — `cargo check`, `cargo clippy --all-targets`, and `cargo
  test` against `crates/orchestrator/Cargo.toml` and
  `crates/axiomregent/Cargo.toml` pass with default features (no
  `--features distributed`).
- **AC-5** — `.github/workflows/ci-orchestrator.yml` and the `crates/`
  workspace CI pipelines remain green on the post-change tree.
- **AC-6** — `make ci` (warm) is green.
- **AC-7** — Spec-code coupling gate accepts the change against this
  spec's `implements:` list with no warnings.

## 4. Out of scope

- **`--features distributed` work.** `verifications.md` Q2 confirmed
  the gated build path is dead across the entire repo (no Cargo
  manifest, CI workflow, Makefile, Dockerfile, or downstream consumer
  enables it). Phase 4 of the audit's "CORRECT (off) for distributed
  mode" verdict for orchestrator is academic. Distributed-mode revival
  is a future spec.
- **`crates/orchestrator/src/hiqlite_store.rs` removal.** The
  `#[cfg(feature = "distributed")]`-gated body, the
  `store_config.rs` distributed arm, and the `lib.rs` re-exports stay
  in place. Removing dead-on-disk code is politically loaded
  (signals abandonment of a planned mode) and is deferred to a
  separate spec.
- **deployd-api-rs changes.** Spec 145 covers `backup`, `s3`,
  persistence-chart hardening, and restore-on-startup for the
  governance-load-bearing `deployments` / `deployment_events` tables.
- **Hiqlite version bump.** Both lockfiles already resolve to the
  latest published `0.13.1` against an identical checksum
  (`af5f8408…fc669`). No upgrade gap to surface.
- **Other Hiqlite features.** `dashboard`, `listen_notify` (full vs
  `_local`), `macros`, `counters`, `shutdown-handle`, `jemalloc`,
  `webpki-roots`, `cast_ints*`, and `server` are correctly off in all
  three OAP services and stay off; out of scope.
- **Other manifest hygiene.** `platform/services/deployd-api-rs/Cargo.toml:31`
  declares `package.metadata.oap.spec = "073-axiomregent-unification"`,
  the same spec id as `crates/axiomregent`. The audit's open question
  3 ("apparent mis-pin") is its own hygiene pass, not this spec.

## 5. Provenance

- **`audit.md` Phase 2.1** — axiomregent feature usage table; identifies
  redundant explicit `cache`.
- **`audit.md` Phase 2.2** — orchestrator feature usage table; identifies
  dead `dlock` and the missing `default-features = false` as the
  load-bearing finding.
- **`audit.md` Phase 3a** — drift table; root-cause attribution to one
  manifest line.
- **`audit.md` Phase 5** — recommendation table rows for the five
  zero-effort toggles consolidated into this spec.
- **`verifications.md` Q2** — confirms the `--features distributed`
  build path is dead across `Cargo.toml`, CI workflows, Makefiles,
  Dockerfiles, and downstream consumers.
- **`verifications.md` Implications table** — keeps this spec's
  cleanup scope live and independent of the spec 145 deployd-api-rs
  durability work.
- **Upstream Hiqlite** — feature definitions verified at
  `hiqlite/Cargo.toml@v0.13.0` (released 2026-04-14). Both lockfiles
  resolve `0.13.1` against the same checksum.
- **CONST-005 framing.** This is a hygiene amendment to the
  orchestrator and axiomregent manifests; no spec is being edited to
  retroactively justify a code change. The fix removes drift that
  upstream defaults inject into the workspace silently.
