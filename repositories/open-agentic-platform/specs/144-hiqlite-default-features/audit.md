# Audit — Hiqlite usage in OAP

**Date:** 2026-05-08
**Author:** Claude Code, Co-Authored-By: Bart
**Scope:** `axiomregent`, `orchestrator`, `deployd-api-rs` at commit `a34a7920` (branch `main`)
**Hiqlite version pinned by all three manifests:** `~0.13`
**Hiqlite version resolved in both lockfiles:** `0.13.1`
**Latest published Hiqlite:** `0.13.1` (released 2026-04-14, per `github.com/sebadob/hiqlite` Releases)

---

## TL;DR

The single load-bearing finding is **structural, not configuration**:
`crates/orchestrator/Cargo.toml:20` declares `hiqlite` **without
`default-features = false`**, so the workspace inherits Hiqlite's default
features (`auto-heal`, `backup`, `sqlite`, `toml`) and Cargo unifies them
across `crates/axiomregent` as well. The `crates/Cargo.lock` confirms
this: it pulls `cron`, `futures-util`, and `toml 1.1.2+spec-1.1.0` into
the workspace tree, none of which are needed by the explicitly-listed
features. `platform/services/deployd-api-rs/Cargo.lock` does **not**
contain those crates, confirming feature-set divergence between the two
Cargo workspaces.

Concrete consequences:

- `axiomregent`'s explicit `cache` flag is redundant (already required
  transitively by `dlock` and `listen_notify_local`).
- `orchestrator`'s `dlock` flag is **dead** — no `client.lock(...)` calls
  and no `hiqlite::Lock` import in `crates/orchestrator/src/**`.
- `backup` (and `s3`, since `s3 = ["backup"]` in upstream) is silently
  enabled for `axiomregent` + `orchestrator` via Cargo unification, even
  though no service code calls a Hiqlite backup API.
- `deployd-api-rs` is the only service genuinely running with `sqlite`
  alone — and is also the most plausible candidate for `backup` + `s3`
  given its single-node data path and the governance-relevance of the
  `deployments` / `deployment_events` tables.

Recommendations: **5 zero-effort** (toggle `Cargo.toml`), **2 small**
(intentional `backup`+`s3` enablement scoped to one service), **2
future-spec** items.

---

## Phase 1 — Hiqlite feature reference

Source: upstream `hiqlite/Cargo.toml` at tag `v0.13.0` (verified via
`raw.githubusercontent.com/sebadob/hiqlite/v0.13.0/hiqlite/Cargo.toml`).

**Default features:** `["auto-heal", "backup", "sqlite", "toml"]`.

| Feature              | Activates                                                                 | Optional deps pulled                                                                 | Notes                                                                                          |
|----------------------|---------------------------------------------------------------------------|--------------------------------------------------------------------------------------|------------------------------------------------------------------------------------------------|
| `sqlite`             | (leaf)                                                                    | `deadpool`, `rusqlite`, `serde_rusqlite`                                             | Core execution engine. Required by `backup`, `dashboard`.                                      |
| `cache`              | (leaf, but mandatory for `dlock` and `listen_notify_local`)               | (none beyond `openraft/loosen-follower-log-revert` flag)                             | KV-style cache primitive; transitively required by both notification + lock features.          |
| `dlock`              | `cache`                                                                   | (none)                                                                               | Distributed lock. RAII guard returned from `Client::lock(key)`.                                |
| `listen_notify_local`| `cache`                                                                   | `futures-util`                                                                       | In-process listen/notify; cluster-wide topic via Raft commit pipeline.                         |
| `listen_notify`      | `listen_notify_local`                                                     | `eventsource-client`                                                                 | Adds remote (SSE-bridge) subscribers in addition to local.                                     |
| `backup`             | `sqlite`, `s3`                                                            | `cron`                                                                               | Cron-driven snapshots of the embedded WAL. Activates `s3` transitively.                        |
| `s3`                 | `backup`                                                                  | (none beyond what `backup` pulls)                                                    | Push encrypted backups to an S3 endpoint via `cryptr → s3-simple`. Mutually-implies `backup`.  |
| `auto-heal`          | `hiqlite-wal/auto-heal`                                                   | (none)                                                                               | Self-repair WAL on corrupt-segment detection. Default-on upstream.                             |
| `toml`               | (leaf)                                                                    | `toml`                                                                               | TOML parser for the optional config-file path. Default-on upstream.                            |
| `dashboard`          | `sqlite`                                                                  | `argon2`, `axum-extra`, `mime_guess`, `spow`, `tower`, `tower-http`                  | HTTP dashboard for inspecting the cluster.                                                     |
| `macros`             | (leaf)                                                                    | `hiqlite-derive`                                                                     | `#[derive]`-style query macros.                                                                |
| `shutdown-handle`    | (leaf)                                                                    | `ctrlc`                                                                              | Ctrl-C aware shutdown integration.                                                             |
| `counters`           | `cache`                                                                   | (none)                                                                               | Atomic counters built on the cache primitive.                                                  |
| `cast_ints`, `cast_ints_unchecked` | (leaf)                                                      | (none)                                                                               | Numeric casting helpers.                                                                       |
| `webpki-roots`       | (leaf)                                                                    | `webpki-root-certs`                                                                  | Bundled root certs for outbound TLS (e.g. S3).                                                 |
| `jemalloc`           | (leaf)                                                                    | `tikv-jemallocator`                                                                  | Allocator override.                                                                            |
| `server`             | `full`, `listen_notify`, `tokio/macros`                                   | `clap`, `home`, `tracing-subscriber`                                                 | Standalone `hiqlite-server` binary build. **Not** what OAP uses.                               |
| `full`               | `auto-heal`, `backup`, `cache`, `dashboard`, `dlock`, `listen_notify_local`, `macros`, `s3`, `shutdown-handle`, `sqlite`, `toml` | (above)                                       | Convenience superset.                                                                          |

**Inter-feature implications relevant to this audit:**

- `dlock` and `listen_notify_local` both depend on `cache`. Listing
  `cache` alongside either is **redundant**, not additive.
- `s3` and `backup` are mutually-activating. Enabling `backup` enables
  `s3`; enabling `s3` enables `backup`. There is no "backup without S3"
  state at the feature layer.
- `backup` requires `sqlite` (already on for all three OAP services).
- `cron` (the `dep:cron` of `backup`) is the discriminator we can grep
  for in lockfiles to confirm whether `backup` is actually active.

**Upgrade gap (Phase 3c context).** Latest = `0.13.1`. OAP pin =
`~0.13`, lockfile = `0.13.1`. Same minor, same patch, same checksum
across both `Cargo.lock` files (`af5f8408…fc669`). **There is no
upgrade gap.** A version-currency recommendation is not warranted.
Breaking-change surface analysis is moot.

---

## Phase 2 — Per-service audit

### 2.1 `axiomregent`

**Role.** Crate-level doc comment in `crates/axiomregent/src/db/mod.rs:4-8`
states: "Hiqlite database initialisation and schema migrations for
axiomregent. Call init_hiqlite once at startup to obtain a
hiqlite::Client … The node runs in single-node mode (no real Raft peers)
and is strictly local — suitable for a desktop agent process." Spec
binding: `crates/axiomregent/Cargo.toml:64` →
`spec = "073-axiomregent-unification"`. The crate is the unified MCP
agent (GitHub tools, semantic search, checkpoint store), not a server.

**Hiqlite call sites (every `hiqlite::` reference in
`crates/axiomregent/src/**`):**

| File:line                                              | API surface                                             |
|--------------------------------------------------------|---------------------------------------------------------|
| `crates/axiomregent/src/db/mod.rs:14`                  | `use hiqlite::{Client, Node, NodeConfig}`               |
| `crates/axiomregent/src/db/mod.rs:122`                 | `hiqlite::start_node(config).await?`                    |
| `crates/axiomregent/src/db/mod.rs:134`                 | `client.execute(Cow::Borrowed(*ddl), vec![]).await?`    |
| `crates/axiomregent/src/events.rs:9`                   | `use hiqlite::Client`                                   |
| `crates/axiomregent/src/events.rs:37`                  | `client.notify(&payload).await` (listen_notify)         |
| `crates/axiomregent/src/lease.rs:7`                    | `use hiqlite::{Client, Param}`                          |
| `crates/axiomregent/src/run_tools.rs:8`                | `use hiqlite::{Client, Param}`                          |
| `crates/axiomregent/src/checkpoint/store.rs:13`        | `use hiqlite::{Client, Param}`                          |
| `crates/axiomregent/src/search/store.rs:5`             | `use hiqlite::{Client, Param}`                          |
| `crates/axiomregent/src/router/dlock.rs:15`            | `use hiqlite::{Client, Lock}`                           |
| `crates/axiomregent/src/router/dlock.rs:34`            | `client.lock(key).await…` (dlock)                       |
| `crates/axiomregent/src/router/mod.rs:506`             | `dlock::acquire_repo_lock(self.lease_store.client(), root)` |

**Per-feature usage check.**

| Feature              | Used? | Evidence                                                                                          |
|----------------------|-------|---------------------------------------------------------------------------------------------------|
| `sqlite`             | yes   | `db/mod.rs:122` (`start_node`); `db/mod.rs:134` (DDL via `client.execute`); 5 callers query/exec. |
| `dlock`              | yes   | `router/dlock.rs:34` (`client.lock`) keyed by `dlock:worktree:{repo_root}` (line 21); RAII guard held across Tier2/3 tool dispatch (`router/mod.rs:495-520`). |
| `listen_notify_local`| yes   | `events.rs:37` (`client.notify`) for cross-session event propagation (FR-006 per `events.rs:4`).  |
| `cache`              | **redundant** | Explicit at `Cargo.toml:38`; transitively required by both `dlock` and `listen_notify_local`. No `client.cache_*`, no `hiqlite::Cache` reference in source (verified `grep -rnE 'client\.cache\|hiqlite::Cache\|cache_(get\|put\|del)' crates/axiomregent/src` → empty). |

**Per-feature gap check.**

- `backup` / `s3` (off explicitly, but unified-ON via orchestrator —
  see 3a). Schema (`db/mod.rs:21-94`) holds: `audit_log` (governance
  trail), `checkpoints` + `manifest_entries` + `blob_refs` (snapshot
  system), `leases` (worktree lease ledger), `runs` (skill-run history),
  `embeddings` (regenerable from corpus). The audit_log is governance-
  load-bearing — but per `platform/CLAUDE.md` "Key Integration Points
  with OPC", "axiomregent can POST audit records to statecraft's
  audit_log table", which means the **durable copy lives in statecraft's
  Postgres**, not in the local hiqlite instance. The local hiqlite is
  per-user desktop state.
  **Verdict:** the gap is real for the audit_log column if the
  statecraft round-trip is not always wired (e.g. offline desktop
  sessions), but at the abstraction layer this is "user backs up their
  laptop" territory. Recommendation: **NO** for a Hiqlite-level S3
  backup of axiomregent. Flag the offline-audit-fall-through as a
  separate concern (open question).
- `auto-heal` (off explicitly, but unified-ON). WAL self-heal on a
  single-node desktop process is a small but real reliability win —
  cheap, keep on if we end up keeping the unified default. Recommend
  re-enable explicitly only if we choose the "align up" direction in
  Phase 3a; otherwise drop.
- `toml` (off explicitly, but unified-ON). The TOML parser is for
  Hiqlite's optional config-file load path; OAP constructs `NodeConfig`
  in code (`db/mod.rs:107-119`), so the parser is dead. **DROP.**
- `dashboard`: out of scope for a desktop process. **NO.**
- `listen_notify` (vs `_local`): no remote subscriber model in
  axiomregent's role. **NO.**
- `macros`: would simplify `query_as` boilerplate (`run_tools.rs`,
  `checkpoint/store.rs`). Marginal ergonomic win; not the audit's job.
  **REFACTOR (future).**

**Cross-cutting check.**

- Pin: `crates/axiomregent/Cargo.toml:38` →
  `hiqlite = { version = "~0.13", default-features = false, features = ["sqlite", "dlock", "listen_notify_local", "cache"] }`.
  Has `default-features = false` (good).
- Optional: not optional. Hiqlite is unconditional for axiomregent.
- Client lifecycle: opened **once** at startup via `init_hiqlite`
  (`db/mod.rs:104-125`). Single-instance.

**Summary table — `axiomregent`:**

| Feature              | State            | Used? | Recommendation                | Justification                                                                                       |
|----------------------|------------------|-------|-------------------------------|-----------------------------------------------------------------------------------------------------|
| `sqlite`             | on (explicit)    | yes   | KEEP                          | Core; `db/mod.rs:122`, 5 query call sites.                                                          |
| `dlock`              | on (explicit)    | yes   | KEEP                          | `router/dlock.rs:34` worktree lock for Tier2/3 tools.                                               |
| `listen_notify_local`| on (explicit)    | yes   | KEEP                          | `events.rs:37` cross-session event propagation.                                                     |
| `cache`              | on (explicit)    | indirect | REMOVE FROM EXPLICIT LIST  | Redundant — transitively required by `dlock` + `listen_notify_local` (upstream `hiqlite/Cargo.toml`). |
| `backup`             | on (unified)     | no    | KEEP OFF (fix at orchestrator) | Local desktop state; durable audit copy is statecraft Postgres per `platform/CLAUDE.md`.            |
| `s3`                 | on (unified)     | no    | KEEP OFF                      | Same as `backup` — they imply each other.                                                           |
| `auto-heal`          | on (unified)     | no API call | KEEP ON IF EXPLICIT      | Cheap reliability for single-node WAL; intentional rather than inherited.                           |
| `toml`               | on (unified)     | no    | DROP                          | Code constructs `NodeConfig` directly (`db/mod.rs:107-119`); parser unused.                         |
| `dashboard`, `listen_notify`, `macros`, `counters`, `shutdown-handle`, `jemalloc`, `webpki-roots`, `cast_ints*`, `server` | off | n/a | NO | Out of scope for desktop MCP role. |

---

### 2.2 `orchestrator`

**Role.** Manifest spec binding: `crates/orchestrator/Cargo.toml:42` →
`spec = "052-state-persistence"`. No crate-level doc comment; inferred
from `lib.rs` and `hiqlite_store.rs` header (`crates/orchestrator/src/hiqlite_store.rs:1-9`):
"Feature 052: Hiqlite (distributed SQLite via Raft) backend for workflow
state and events. … `HiqliteWorkflowStore` (WorkflowStore) and
`HiqliteEventNotifier` (EventNotifier) implementations that replicate
state and events across a multi-node Raft cluster using hiqlite. Gated
behind `#[cfg(feature = "distributed")]`." Hiqlite is the **distributed
backend**; the default `local-sqlite` feature uses `rusqlite` directly
(`Cargo.toml:11-13`).

**Hiqlite call sites (every `hiqlite::` reference, `feature =
"distributed"` only):**

| File:line                                                       | API surface                                                              |
|-----------------------------------------------------------------|--------------------------------------------------------------------------|
| `crates/orchestrator/src/lib.rs:19,50-51`                       | `#[cfg(feature = "distributed")] pub use hiqlite_store::{HiqliteEventNotifier, HiqliteWorkflowStore}` |
| `crates/orchestrator/src/store_config.rs:22-25`                 | `#[cfg(feature = "distributed")]` variant; `client: hiqlite::Client`     |
| `crates/orchestrator/src/store_config.rs:50`                    | `#[cfg(feature = "distributed")]` arm in store-construction match        |
| `crates/orchestrator/src/hiqlite_store.rs:17`                   | `use hiqlite::{Client, Param, Params}`                                   |
| `crates/orchestrator/src/hiqlite_store.rs:42-70`                | `SCHEMA_SQL` const for `workflows`, `steps`, `events` tables             |
| `crates/orchestrator/src/hiqlite_store.rs:93-110`               | `client.execute(...)` for migrations                                     |
| `crates/orchestrator/src/hiqlite_store.rs:486-491`              | `self.client.notify(&event).await` (listen_notify); fan-out via local `tokio::broadcast` |
| `crates/orchestrator/src/hiqlite_store.rs:569-575`              | `From<&'a mut hiqlite::Row<'r>> for EventIdRow`                          |

**Per-feature usage check.**

| Feature              | Used? | Evidence                                                                                          |
|----------------------|-------|---------------------------------------------------------------------------------------------------|
| `sqlite`             | yes   | `hiqlite_store.rs:42-70` schema; `client.execute` migrations; query_as throughout.                |
| `listen_notify_local`| yes   | `hiqlite_store.rs:486-491`. Note the fan-out is local-only (`local_tx.send(event.clone())` line 488), then `client.notify` line 491 publishes to the cluster topic. |
| `dlock`              | **NO** | `grep -rnE 'client\.lock\(\|hiqlite::Lock' crates/orchestrator/src` → no hits. The `Lock` type is not even imported in `hiqlite_store.rs:17`. |

**Critical lockfile-driven finding.**
`crates/orchestrator/Cargo.toml:20`:
`hiqlite = { version = "~0.13", features = ["sqlite", "dlock", "listen_notify_local"], optional = true }`
**lacks `default-features = false`.** Cargo therefore unifies the
default features — `auto-heal`, `backup`, `sqlite`, `toml` — across
the entire `crates/` workspace. `crates/Cargo.lock` confirms this:

| Crate present in `crates/Cargo.lock` (hiqlite deps block)  | Implies feature on |
|------------------------------------------------------------|--------------------|
| `cron`                                                     | `backup`           |
| `futures-util`                                             | `listen_notify_local` (already explicit) |
| `toml 1.1.2+spec-1.1.0`                                    | `toml`             |

`platform/services/deployd-api-rs/Cargo.lock` (separate workspace) does
**not** contain `cron`, `futures-util`, or `toml` in the hiqlite deps
block — confirming feature-set divergence between the two Cargo
workspaces. This is `axiomregent`'s `default-features = false`
(`crates/axiomregent/Cargo.toml:38`) being defeated by Cargo unification
because of orchestrator's missing flag.

**Per-feature gap check.**

- `backup` / `s3` (currently unified-ON, never used). Workflow state +
  events are governance-relevant (gate decisions, approval audit) but
  in distributed mode hiqlite Raft replicas ARE the redundancy
  mechanism. S3 push would be cluster-wide disaster recovery — useful
  but not load-bearing for the spec-052 role. **NO** at the audit
  level; recommend explicit OFF via `default-features = false`.
- `auto-heal` (unified-ON, no API call). WAL self-heal during a Raft
  consensus operation could mask real corruption signals. Defensible
  either way; recommend explicit choice rather than silent inheritance.
- `toml` (unified-ON, no API call). `NodeConfig` is constructed in code,
  not loaded from TOML. **DROP** by adding `default-features = false`.
- `cache` (transitively-on via `listen_notify_local`, no direct use).
  Mandatory for the notify path; can't be dropped. Not a gap.
- `dashboard`: out of scope. **NO.**
- `listen_notify` (full, vs `_local`): hiqlite_store.rs:471 already
  uses `tokio::sync::broadcast` for local SSE fan-out, and the
  `client.notify` call at line 491 is cluster-wide via Raft. There's
  no remote-SSE subscriber model in orchestrator's role; `_local` is
  the right abstraction. **NO.**
- `macros`: would clean up the row deserialization at lines 521-575;
  ergonomic. **REFACTOR (future).**

**Cross-cutting check.**

- Pin: `crates/orchestrator/Cargo.toml:20`. **Missing
  `default-features = false`** — the load-bearing finding.
- Optional: yes, `optional = true` and gated by feature `distributed`
  (`Cargo.toml:13`). Default build path is `local-sqlite` (rusqlite),
  not hiqlite.
- Client lifecycle: hiqlite client is provided externally and wrapped
  by `HiqliteWorkflowStore::new(client)` (`hiqlite_store.rs:84-88`).
  Single instance per process.

**Summary table — `orchestrator`:**

| Feature              | State                  | Used? | Recommendation                  | Justification                                                                                            |
|----------------------|------------------------|-------|---------------------------------|----------------------------------------------------------------------------------------------------------|
| `sqlite`             | on (explicit)          | yes   | KEEP                            | `hiqlite_store.rs:42-70`.                                                                                |
| `listen_notify_local`| on (explicit)          | yes   | KEEP                            | `hiqlite_store.rs:491`.                                                                                  |
| `dlock`              | on (explicit)          | **NO**| **DEAD — REMOVE**               | No `client.lock` calls; `hiqlite::Lock` not imported. Pulls `cache` (still required transitively via `listen_notify_local` so net code/compile impact: zero, but the explicit entry is misleading). |
| `cache`              | on (transitive)        | no direct | KEEP IMPLICIT                | Mandatory for `listen_notify_local`. Don't list explicitly.                                              |
| `backup`             | on (default unified)   | no    | **EXPLICITLY DISABLE**          | Add `default-features = false`. Raft replicas are the HA story (`hiqlite_store.rs:78`). Not the audit's recommendation to enable. |
| `s3`                 | on (default unified)   | no    | **EXPLICITLY DISABLE** (with `backup`) | Mutually-implies `backup`.                                                                          |
| `auto-heal`          | on (default unified)   | no API call | DECIDE EXPLICITLY         | Defensible either way; surface the choice rather than inherit.                                           |
| `toml`               | on (default unified)   | no    | **DROP** (via `default-features = false`) | `NodeConfig` built in code.                                                                  |
| `dashboard`, `listen_notify`, `macros`, `counters`, `shutdown-handle`, `jemalloc`, `webpki-roots`, `cast_ints*`, `server` | off | n/a | NO | Out of scope. |

---

### 2.3 `deployd-api-rs`

**Role.** Per `platform/CLAUDE.md`, deployd-api is "Rust (axum, hiqlite)
… K8s deployment orchestration with Helm, OIDC JWT auth" on port 8080.
Manifest spec binding: `platform/services/deployd-api-rs/Cargo.toml:31` →
`spec = "073-axiomregent-unification"`. (Spec id is the unification
spec; the deployd role itself is described in spec 047 / 086 contexts —
**Unverified:** which spec carries deployd's primary FR list; Cargo.toml
points to 073 which is the axiomregent unification spec, an apparent
mis-pin. Out of scope for this audit but worth flagging.)

**Hiqlite call sites:**

| File:line                                                  | API surface                                                                                |
|------------------------------------------------------------|--------------------------------------------------------------------------------------------|
| `platform/services/deployd-api-rs/src/store.rs:2`          | `use hiqlite::{Client, Node, NodeConfig, Param}`                                            |
| `platform/services/deployd-api-rs/src/store.rs:13-33`      | `init_db` constructs `NodeConfig` and calls `hiqlite::start_node`                           |
| `platform/services/deployd-api-rs/src/store.rs:35-77`      | `migrate` — DDL for `deployments`, `deployment_events`                                      |
| `platform/services/deployd-api-rs/src/store.rs:107-213`    | CRUD helpers: `get_by_key`, `get_by_release_id`, `insert_deployment`, `update_status`, `add_event`, `get_events` |
| `platform/services/deployd-api-rs/src/main.rs:28`          | `let client = store::init_db(&data_dir).await?` (single-instance startup)                   |

**Per-feature usage check.**

| Feature   | Used? | Evidence                                                                |
|-----------|-------|-------------------------------------------------------------------------|
| `sqlite`  | yes   | `store.rs:30` (`start_node`); CRUD throughout.                          |

`deployd-api-rs` enables nothing else (`Cargo.toml:17`:
`default-features = false, features = ["sqlite"]`). Lockfile confirms
absence of `cron`, `futures-util`, `toml` in the hiqlite deps block.

**Per-feature gap check.**

- `backup` / `s3`. Schema (`store.rs:39-77`) holds `deployments` (the
  current+historical state of every release) and `deployment_events`
  (append-only audit trail of deploy state transitions). `main.rs:24-27`
  defaults the data_dir to `/var/lib/deployd/data`. In-K8s, this **must
  be a PVC** for state to survive pod eviction; **Unverified:** the
  audit did not inspect `platform/charts/deployd-api/templates/**` for
  PVC presence. If the chart mounts a PVC, on-cluster persistence
  works; if not, every pod restart loses deploy history. Either way,
  the data is durable governance state — operators want to know "who
  deployed what, when, with what scope" across pod lifetimes. This is
  the **load-bearing case for `backup` + `s3`** in the audit:
  - The `cryptr → s3-simple` chain is already in
    `platform/services/deployd-api-rs/Cargo.lock` as a hiqlite
    transitive — zero new direct deps.
  - One environment variable for S3 endpoint + key, one for cron
    schedule, no code changes beyond passing them into `NodeConfig`.
  - Recommend **ENABLE** `backup` (and `s3`, since they imply each
    other), scoped to deployd-api-rs.
- `dlock`: `main.rs` is a single-binary axum server. Multi-replica
  deployd would benefit from a leader-election / locked-write pattern,
  but `routes.rs` writes are already isolated by `deployment_id`
  primary key and the current single-node hiqlite at `127.0.0.1:7001`
  (`store.rs:18`) is not multi-replica. This is a **REFACTOR** scope
  question (future spec) — would deployd-api ever scale beyond one
  replica? If yes, `dlock` becomes relevant. If no (current posture),
  **NO.**
- `listen_notify_local` / `listen_notify`: no SSE or webhook fan-out
  to interested subscribers in current deployd-api routes (`routes.rs`
  serves polled `/v1/deployments/.../status` and `.../logs`, not a
  push channel). If the platform plan is to push deploy events to
  statecraft's audit_log via SSE, `listen_notify` is the right fit —
  but that's a feature, not an audit recommendation. **NO** today;
  flag as future-spec candidate.
- `cache`: nothing in `routes.rs` or `k8s.rs` reads from a
  deployd-local cache that is currently hand-rolled. `auth.rs:18-19`
  has a `Lazy<Mutex<Option<(String, String, std::time::Instant)>>>`
  JWKS cache — that is intentionally process-local TTL, not state to
  share across replicas. **NO.**
- `auto-heal`: small reliability win for the single-node deploy. Cheap.
  Recommend **ENABLE** alongside `backup`.
- `toml`, `dashboard`, `listen_notify`, `macros`: out of scope today.
- `shutdown-handle`: `main.rs` does not handle Ctrl-C explicitly;
  axum + tokio handles it for the listener. Marginal value; **NO.**

**Cross-cutting check.**

- Pin: `platform/services/deployd-api-rs/Cargo.toml:17` → `~0.13`,
  `default-features = false`. Pin discipline matches axiomregent.
- Optional: not optional.
- Client lifecycle: **once** at startup (`main.rs:28`).

**Summary table — `deployd-api-rs`:**

| Feature              | State            | Used? | Recommendation                | Justification                                                                                |
|----------------------|------------------|-------|-------------------------------|----------------------------------------------------------------------------------------------|
| `sqlite`             | on (explicit)    | yes   | KEEP                          | `store.rs:30`.                                                                               |
| `backup`             | off              | n/a   | **ENABLE** (small effort)     | Deploy history is governance-relevant audit data; `cryptr→s3-simple` chain already in lock.  |
| `s3`                 | off              | n/a   | **ENABLE** (with `backup`)    | Mutually-implies. Encrypted off-cluster snapshots.                                           |
| `auto-heal`          | off              | n/a   | ENABLE                        | Cheap WAL self-repair for single-node desktop-style deploy.                                  |
| `dlock`              | off              | n/a   | NO (today)                    | Single-replica posture. Re-evaluate if deployd-api goes multi-replica (future spec).         |
| `listen_notify_local`| off              | n/a   | NO (today)                    | No push subscribers in current routes. Future-spec candidate if event-stream emerges.        |
| `cache`              | off              | n/a   | NO                            | JWKS cache is intentionally process-local (`auth.rs:18`).                                    |
| `toml`               | off              | n/a   | NO                            | Code constructs `NodeConfig` directly.                                                       |
| `dashboard`, `listen_notify`, `macros`, `counters`, `shutdown-handle`, `jemalloc`, `webpki-roots`, `cast_ints*`, `server` | off | n/a | NO | Out of scope. |

---

## Phase 3 — Cross-service consistency + version currency

### 3a — Drift

| Feature                | `axiomregent`         | `orchestrator` (cfg distributed)         | `deployd-api-rs` | Classification                                    |
|------------------------|-----------------------|------------------------------------------|------------------|---------------------------------------------------|
| `sqlite`               | explicit ON           | explicit ON                              | explicit ON      | JUSTIFIED — core in all three.                    |
| `dlock`                | explicit ON, USED     | explicit ON, **DEAD**                    | OFF              | DRIFT (align down) — orchestrator's listing is unused; deployd-api-rs correctly off. |
| `listen_notify_local`  | explicit ON, USED     | explicit ON, USED                        | OFF              | JUSTIFIED — deployd has no push subscribers today. |
| `cache`                | explicit ON (redundant)| transitive ON                           | OFF              | DRIFT (align down) — axiomregent's explicit listing is redundant. Don't flip orchestrator/deployd posture. |
| `backup`               | OFF (intent), **ON unified** | OFF (intent), **ON unified via missing `default-features=false`** | OFF | DRIFT (align down for axiom + orch; align UP for deployd-api-rs to intentional ON). |
| `s3`                   | OFF (intent), **ON unified** | OFF (intent), **ON unified**       | OFF              | Same as `backup` (mutually-implying).             |
| `auto-heal`            | OFF (intent), **ON unified** | OFF (intent), **ON unified**       | OFF              | DRIFT (decide explicitly). Cheap to keep on.      |
| `toml`                 | OFF (intent), **ON unified** | OFF (intent), **ON unified**       | OFF              | DRIFT (align down). Drop everywhere — `NodeConfig` is built in code in all three services. |

**Why the drifts exist (root cause):**
The single missing `default-features = false` on
`crates/orchestrator/Cargo.toml:20` propagates Hiqlite's defaults across
the entire `crates/` workspace. Every "DRIFT (align down)" row above
collapses to that one fix. The deployd-api-rs row is unaffected
(separate Cargo workspace) and is the **opposite** direction —
intentional ENABLE, not align-down.

### 3b — Lockfile alignment

Both Cargo.lock files resolve hiqlite to the **same checksum**
(`af5f84089c071ea1a78dd98026d557fc1830fd4972009bc1bda7b2c1506fc669`),
same version (`0.13.1`), same source (`crates.io-index`).

What differs is the **transitive closure under feature unification**:

| Transitive crate (in hiqlite deps block) | `crates/Cargo.lock` | `platform/services/deployd-api-rs/Cargo.lock` | Implies                       |
|------------------------------------------|---------------------|-----------------------------------------------|-------------------------------|
| `cron`                                   | present             | absent                                         | `backup` ON in `crates/`       |
| `futures-util`                           | present             | absent                                         | `listen_notify_local` ON in `crates/` (expected) |
| `toml 1.1.2+spec-1.1.0`                  | present             | absent                                         | `toml` ON in `crates/`         |
| `cryptr`                                 | present             | present                                         | unconditional in hiqlite       |
| `deadpool 0.13.0` / `deadpool` (no version) | `0.13.0`           | bare                                           | minor deadpool divergence between workspaces — cosmetic |
| `reqwest 0.13.3` / `reqwest` (no version)| `0.13.3`            | bare                                           | divergence is cross-workspace, not hiqlite-driven |

**Finding:** lockfile *version pin* is aligned (single resolved version,
single checksum). Lockfile *feature unification* is not — and the
divergence stems entirely from the orchestrator manifest declaration,
which is a code-fix, not a lockfile-regeneration problem.

### 3c — Upgrade gap

Latest published Hiqlite is `0.13.1` (per
`github.com/sebadob/hiqlite/releases`). Both lockfiles resolve to
`0.13.1`. **There is no upgrade gap to surface.** Phase 3c produces no
recommendation.

---

## Phase 4 — Backup posture

The Hiqlite-stored state per service, evaluated against the three
classifications (correct / deferred / oversight):

### `axiomregent`

**Tables (`db/mod.rs:21-94`):**

| Table              | Content                                                        | Governance-relevant? | Source-of-truth elsewhere?                                                                                   |
|--------------------|----------------------------------------------------------------|----------------------|---------------------------------------------------------------------------------------------------------------|
| `checkpoints`      | Repository checkpoint metadata + Merkle roots                   | yes                  | Local desktop state; per-user.                                                                                |
| `manifest_entries` | Per-checkpoint file→blob map                                    | yes                  | Reproducible from `blob_refs` + working tree at checkpoint time.                                              |
| `blob_refs`        | Content-addressed blob ref counts                               | yes                  | Blobs themselves live in the OPC blob store.                                                                  |
| `leases`           | Worktree lease ledger                                           | partial              | Ephemeral — lease lifetime in seconds-to-minutes.                                                             |
| `runs`             | Skill-run history                                               | yes                  | Tools emit JSONL audit logs; runs table is index over those.                                                  |
| `embeddings`       | fastembed vectors over the project corpus                       | no                   | Regenerable from corpus (`crates/axiomregent/src/search/`).                                                   |
| `audit_log`        | Tool-invocation audit (tier, decision, lease)                   | **yes — load-bearing**| **statecraft Postgres** receives axiomregent audit POSTs per `platform/CLAUDE.md` "Key Integration Points → Audit streaming". |

**Verdict:** **CORRECT (off).** axiomregent is a per-user desktop
process; the durable audit substrate is statecraft's Postgres. The
local hiqlite is a desktop cache+state file; user-level backup is the
user's job. **Caveat:** if the audit-streaming round-trip is not always
wired (offline desktop sessions, network failures), local audit_log is
the only copy until reconnect. The audit did not verify whether
axiomregent buffers and replays audit POSTs on reconnection — open
question for a separate spec.

### `orchestrator`

**Tables (`hiqlite_store.rs:42-70`):**

| Table       | Content                                                       | Governance-relevant? | Source-of-truth elsewhere?                                                              |
|-------------|---------------------------------------------------------------|----------------------|------------------------------------------------------------------------------------------|
| `workflows` | Run-level metadata, status, started/completed timestamps       | yes                  | None — orchestrator IS the source of truth for workflow lifecycle.                       |
| `steps`     | Per-step status, gate config/decision, output                  | yes                  | None — gate decisions are governance-load-bearing.                                       |
| `events`    | Append-only event stream (JSON payloads)                       | yes                  | None — replay-from-events is the persistence model (`store.rs:111` doc).                 |

**Verdict:** **CORRECT (off) for distributed mode; N/A for single-node
mode.** Spec 052 is "state-persistence" — the design intent for the
distributed feature (`Cargo.toml:13`) is multi-node Raft replication
(`hiqlite_store.rs:78`). Raft replicas ARE the redundancy mechanism.
S3 push would be cluster-wide DR (multi-region snapshot), useful but
not load-bearing. The default `local-sqlite` feature uses rusqlite
directly — no hiqlite, no backup feature — and that path's
backup story is the operator's choice (local file copy, etc.).

**Caveat:** the *unified-by-accident* state means orchestrator's
distributed-mode build today ships with `backup` compiled-in and
unused. Wasted code and SBOM surface, not a safety issue.

### `deployd-api-rs`

**Tables (`store.rs:39-77`):**

| Table                | Content                                                                | Governance-relevant?  | Source-of-truth elsewhere?                                                                                  |
|----------------------|------------------------------------------------------------------------|-----------------------|--------------------------------------------------------------------------------------------------------------|
| `deployments`        | One row per release; release_sha, artifact_ref, status, endpoints       | **yes — load-bearing**| Partially reconstructable from K8s API (current state) but **NOT** historical (rolled-back releases).        |
| `deployment_events`  | Append-only event log per deployment                                   | **yes — load-bearing**| Not reconstructable — this is the audit trail.                                                               |

**Single-replica posture:** `store.rs:18` opens hiqlite at
`127.0.0.1:7001` with `node_id: 1` and a single-node cluster. **Unverified:**
whether `platform/charts/deployd-api/templates/**` mounts a PVC at
`/var/lib/deployd/data`. If yes, pod restarts preserve state; if no,
every pod restart loses deploy history. Either way, **off-cluster
backup of `deployment_events` is the audit trail's only durability
guarantee against cluster-wide disaster.**

**Verdict:** **OVERSIGHT.** The audit trail of who deployed what to
where is governance-load-bearing. The data is not reconstructable from
K8s state. The `cryptr → s3-simple` transitive chain is already in the
deployd-api lockfile (free). **Recommendation: ENABLE `backup` + `s3`,
scoped to deployd-api-rs.** This is the audit's highest-leverage
finding.

---

## Phase 5 — Recommendations

Sorted by effort ascending. Effort scale: **0** = `Cargo.toml` toggle
only; **S** = small code change (env wiring, `NodeConfig` field),
< 1 day; **M** = refactor, multi-day, future spec; **L** =
architectural, definitely its own spec.

| Service          | Action                                                                 | Effort | Rationale                                                                                                       | Evidence                                                                                                       |
|------------------|------------------------------------------------------------------------|--------|-----------------------------------------------------------------------------------------------------------------|----------------------------------------------------------------------------------------------------------------|
| `orchestrator`   | Add `default-features = false` to hiqlite dep; root-cause fix          | 0      | Stops Cargo unification from forcing `backup`+`auto-heal`+`toml` on the whole `crates/` workspace.              | `crates/orchestrator/Cargo.toml:20`; `crates/Cargo.lock` hiqlite deps include `cron`/`futures-util`/`toml`.    |
| `orchestrator`   | Drop `dlock` from explicit feature list                                | 0      | Dead — no `client.lock(...)` calls; `hiqlite::Lock` not imported.                                                | `grep -rnE 'client\.lock\(\|hiqlite::Lock' crates/orchestrator/src` → empty. Imports at `hiqlite_store.rs:17`. |
| `axiomregent`    | Drop `cache` from explicit feature list                                | 0      | Redundant — `dlock` and `listen_notify_local` both require it transitively (upstream `hiqlite/Cargo.toml`).      | `crates/axiomregent/Cargo.toml:38`; upstream `dlock = ["cache"]`, `listen_notify_local = ["cache"]`.            |
| `orchestrator`   | (After 0-effort #1 above) decide explicitly on `auto-heal`             | 0      | Currently inherited; cheap reliability for single-node fallback paths. Recommend ENABLE explicitly.              | `crates/orchestrator/Cargo.toml:20`.                                                                            |
| `axiomregent`    | (After 0-effort #1 above) decide explicitly on `auto-heal`             | 0      | Same rationale; desktop process benefits from WAL self-repair.                                                   | `crates/axiomregent/Cargo.toml:38`.                                                                             |
| `deployd-api-rs` | ENABLE `backup` + `s3` + `auto-heal`; wire S3 endpoint env to `NodeConfig` | S  | **Load-bearing finding.** Deploy history is governance audit data; not reconstructable from K8s; `cryptr→s3-simple` chain already in lockfile. | `platform/services/deployd-api-rs/src/store.rs:39-77`, `:13-33`; `platform/CLAUDE.md` deploy-history role.       |
| `deployd-api-rs` | Verify chart mounts a PVC at `/var/lib/deployd/data`                   | S      | Even with backups, pod-restart loss is a regression. Confirm chart manifest before considering deploy-API SLO. | `platform/services/deployd-api-rs/src/main.rs:24-27`. **Unverified** — chart not inspected in this audit.       |
| `deployd-api-rs` | Adopt `dlock` if/when deployd-api scales beyond 1 replica              | M (future spec) | Single-replica today; multi-replica writes need cross-instance write coordination.                       | `platform/services/deployd-api-rs/src/store.rs:18` (`node_id: 1`).                                              |
| `deployd-api-rs` | Adopt `listen_notify` for statecraft audit-stream wiring               | M (future spec) | If platform plan wires deploy events into statecraft Postgres, native push beats polling.                | Open question — no current SSE / webhook in `routes.rs`.                                                        |
| `axiomregent`    | Investigate offline-resilient audit_log buffering before recommending Hiqlite-level backup | M (future spec) | Whether axiomregent's audit POSTs to statecraft retry on reconnect is unverified. If they don't, local audit_log loss is a real gap — but the fix is buffering, not Hiqlite S3. | `platform/CLAUDE.md` audit-streaming integration point. |
| `crates/axiomregent/Cargo.toml:64` | Verify spec pin (`073-axiomregent-unification`) — out of audit scope. | — | Cosmetic note: deployd-api-rs's `package.metadata.oap.spec` is also `073` (see Open Questions). | — |

**Recommendation count by effort:**

- **5 zero-effort** (Cargo.toml toggles): orchestrator `default-features = false`,
  drop orchestrator `dlock`, drop axiomregent explicit `cache`,
  intentional `auto-heal` decisions for axiomregent and orchestrator.
- **2 small** (deployd-api-rs `backup`+`s3`+`auto-heal` enablement; PVC
  verification).
- **3 future-spec** items (deployd-api-rs `dlock`, deployd-api-rs
  `listen_notify`, axiomregent offline audit buffering).

The two highest-leverage rows are: (a) the orchestrator
`default-features = false` fix — one line, eliminates SBOM bloat across
the whole `crates/` workspace; and (b) the deployd-api-rs backup
enablement — the load-bearing governance finding from Phase 4.

---

## Open questions

1. **deployd-api-rs PVC posture.** The audit did not inspect
   `platform/charts/deployd-api/templates/**`. The backup recommendation
   is correct regardless, but the urgency of the recommendation depends
   on whether the chart already mounts a PVC at `/var/lib/deployd/data`.
   If it does, off-cluster backup is "DR insurance"; if it doesn't,
   it's "the only durability you have."
2. **axiomregent offline audit buffering.** Per `platform/CLAUDE.md`,
   axiomregent POSTs audit records to statecraft. Whether axiomregent
   buffers and replays those POSTs on reconnect is unverified. If it
   doesn't, the local hiqlite `audit_log` is the only audit copy
   during offline windows and "user backs up their laptop" is too
   weak. Resolving this question is more productive than enabling
   Hiqlite-level S3 backup at axiomregent.
3. **deployd-api-rs spec pin.** `platform/services/deployd-api-rs/Cargo.toml:31`
   declares `spec = "073-axiomregent-unification"`, the same spec id as
   `crates/axiomregent/Cargo.toml:64`. deployd-api-rs is not part of
   axiomregent's role. **Unverified:** whether this is a deliberate
   choice (deployd-api was once part of the unification target) or a
   stale pin. Out of audit scope; flag for a separate hygiene pass.
4. **`auto-heal` semantics.** The audit captured that `auto-heal`
   activates `hiqlite-wal/auto-heal`, but did not inspect the upstream
   semantics (does it silently repair, or does it log a metric we'd
   want to alert on?). The "decide explicitly" recommendation stands
   regardless; the answer determines whether explicit-on warrants a
   companion observability hook.
5. **orchestrator's distributed-mode roadmap.** The `distributed`
   feature is opt-in and `local-sqlite` is the build default
   (`Cargo.toml:11-13`). The audit treated distributed-mode as the
   relevant case for backup posture. **Unverified:** whether OAP
   currently builds + ships orchestrator with `--features distributed`
   anywhere, or whether the entire hiqlite path in orchestrator is
   currently dead-on-disk. If the latter, every orchestrator
   recommendation in this audit is academic until distributed mode
   actually ships.
