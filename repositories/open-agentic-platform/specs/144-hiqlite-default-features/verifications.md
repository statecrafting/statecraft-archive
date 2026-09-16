# Verifications — Hiqlite audit follow-ups

**Date:** 2026-05-08
**Author:** Claude Code, Co-Authored-By: Bart
**Companion to:** `audit.md` (same directory)
**Repo state:** branch `main`, commit `a34a7920`

---

## Q1 — PVC posture

**Verdict:** **PVC-CONDITIONAL** — with two reinforcing layers of "off" in the
actively-shipped deployment.

The chart **does** ship a PVC template
(`platform/charts/deployd-api/templates/pvc.yaml:1-15`) and the deployment
template **does** mount a `data` volume at `/var/lib/deployd`
(`platform/charts/deployd-api/templates/deployment.yaml:99-100`,
`:115-121`). Both are gated on `.Values.persistence.enabled`. The
top-level chart default is `true` (`values.yaml:22-25`,
`persistence.enabled: true`, `size: 1Gi`).

However:

1. **The actively-shipped environment overrides the default to `false`.**
   `platform/charts/deployd-api/values-hetzner.yaml:34-38` sets
   `persistence.enabled: false` with the inline rationale: "Stealth stage:
   use emptyDir for hiqlite state. Deployment history is lost on pod
   restart, which is acceptable pre-GA. Flip to true and set a size/class
   when persistent deployment history is required." Hetzner is the
   currently-active deploy target per recent commit history (e.g.
   `01e6f4fd infra(statecraft,143): validate-spec-143 end-to-end deploy
   validation`, `f5a2ca50 letsencrypt-dns01 ClusterIssuer + Hetzner DNS
   webhook`). The other env values files (`values-azure.yaml`,
   `values-aws.yaml`, `values-gcp.yaml`, `values-do.yaml`,
   `values-local.yaml`) do **not** override `persistence`, so they
   inherit the chart default of `true`.

2. **The container startup command erases the data directory on every
   pod start.** `platform/charts/deployd-api/templates/deployment.yaml:39-43`:

   ```yaml
   command: ["/bin/sh", "-c"]
   args:
     - |
       rm -rf /var/lib/deployd/data/*
       exec /usr/local/bin/deployd-api
   ```

   The wipe is intentional: commit `3aa8893a fix(deployd-api): wipe
   emptyDir on container start to unblock hiqlite` (replaced an earlier
   `rm -f /var/lib/deployd/data/state_machine/lock` stale-lock cleanup
   from commit `cd84f1e9`). The Hetzner deploy ran into hiqlite
   first-boot WAL/lock-state contamination across pod restarts and the
   chart's response was to widen the scrub from "stale lock file" to
   "everything in the data dir." Even when `persistence.enabled: true`
   provisions a real PVC mounted at `/var/lib/deployd`, the application
   data subdirectory `/var/lib/deployd/data/*` is wiped at every
   container start, making the volume durable from K8s's perspective
   but **not** durable from the application's perspective.

**Net consequence for the audit.** The deployd-api-rs `backup` + `s3`
recommendation cannot land as a 0-effort or even small-effort change
in isolation. Useful application-level backup requires three coupled
chart changes before any Hiqlite-feature flip: (a) flip
`persistence.enabled` to `true` in `values-hetzner.yaml` and any other
actively-shipping env; (b) narrow the startup `rm -rf` in
`deployment.yaml:42` back to the stale-lock cleanup it replaced (the
audit cannot judge whether stale-lock cleanup is still required, but
the wider scrub is what makes this a durability problem); (c) then
wire S3 endpoint env + restore-on-startup so a fresh pod against an
empty volume can rehydrate from the most recent S3 snapshot.

---

## Q2 — `distributed` build path

**Verdict:** **DISTRIBUTED-DEAD** — no build, CI, deploy, or downstream-
consumer path enables `--features distributed` anywhere in the repo.

Searches performed (all from repo root, all returning zero hits for
`distributed` enablement):

| Pattern                                                              | Hits relevant to `distributed`? |
|----------------------------------------------------------------------|---------------------------------|
| `grep -rnE 'features.*distributed\|--features.*distributed'` across `**/Cargo.toml`, `**/*.yml`, `**/*.yaml`, `**/Dockerfile*`, `**/*.sh`, `**/Makefile`, `**/*.mk`, `**/Justfile` | 0 |
| `grep -rn 'distributed' .github/workflows Makefile platform/Makefile` | 0 |
| `grep -rn '"distributed"\|features.*=.*\[' product/apps/opc/src-tauri/Cargo.toml crates/factory-engine/Cargo.toml` | 0 (orchestrator dep declared without `features = […]`) |

Direct evidence each consumer omits the feature:

- `crates/factory-engine/Cargo.toml:12` — `orchestrator = { path = "../orchestrator" }`. No `features = […]` field; default-features-only build of orchestrator (i.e. `local-sqlite`).
- `product/apps/opc/src-tauri/Cargo.toml:91` — `orchestrator = { path = "../../../crates/orchestrator" }`. No `features = […]` field.
- `.github/workflows/ci-orchestrator.yml:38-42` — invokes the composite action `./.github/actions/rust-ci` with `manifest-path: crates/orchestrator/Cargo.toml`.
- `.github/actions/rust-ci/action.yml:68-84` — runs `cargo check`, `cargo clippy`, `cargo test` with **no** `--features` flag and no opt-in to `--all-features`. Orchestrator's CI thus only exercises the default `local-sqlite` build.
- `Makefile` — every `cargo build/run/test` invocation either omits `--features` or names a different manifest path (`tools/*`, `crates/axiomregent`, `factory-engine`, `deployd-api-rs`); no orchestrator-targeted `--features distributed` anywhere.
- `platform/Makefile` — same; the only orchestrator-adjacent line is `cargo run --manifest-path services/deployd-api-rs/Cargo.toml` at line 238.
- `platform/services/deployd-api-rs/Dockerfile:4` — `cargo build --release` with no `--features`. (deployd-api-rs is a separate Cargo workspace and does not depend on `orchestrator` anyway, but worth noting for completeness.)
- `.cargo/config.toml:15-16` — only sets `[env].TS_RS_EXPORT_DIR`. No `[build]` flags, no implicit feature enablement.

`crates/orchestrator/Cargo.toml:11-13` declares `default = ["local-sqlite"]`, so the absence of any feature override means every shipping build path runs the rusqlite-backed `sqlite_state.rs` code, **not** the hiqlite-backed `hiqlite_store.rs` code. The entire `crates/orchestrator/src/hiqlite_store.rs` file (and the `#[cfg(feature = "distributed")]`-gated arms in `lib.rs`, `store_config.rs`) is dead on disk for every binary OAP currently produces.

---

## Implications

Columns Q1=PVC-DURABLE and Q2=DISTRIBUTED-LIVE are unused (not the verdicts);
columns Q1=PVC-ABSENT and Q2=DISTRIBUTED-DEAD reflect the closest
verdict-shape match. The CONDITIONAL nuance for Q1 is captured below.

| Audit recommendation                                              | Q1 verdict (PVC-CONDITIONAL, active OFF)                                                                        | Q2 verdict (DISTRIBUTED-DEAD)                                                                                                                  |
|-------------------------------------------------------------------|------------------------------------------------------------------------------------------------------------------|------------------------------------------------------------------------------------------------------------------------------------------------|
| deployd-api-rs ENABLE `backup` + `s3` + `auto-heal`               | **Promoted to M effort, durability primary.** Coupled to chart changes (see PVC verdict). Becomes its own spec.  | n/a                                                                                                                                            |
| deployd-api-rs PVC verification                                   | **OPEN** — chart change required before backup work begins. Specifically: flip `values-hetzner.yaml`, narrow `deployment.yaml:42` rm scope. | n/a                                                                                                                                            |
| orchestrator add `default-features = false`                       | n/a                                                                                                              | **STILL LIVE.** Cargo unification still pulls `cron`, `futures-util`, `toml` into `crates/Cargo.lock` whether the gated code runs or not. Zero-effort SBOM cleanup is independent of the dead code path. |
| orchestrator drop dead `dlock`                                    | n/a                                                                                                              | **ACADEMIC** — gated code path doesn't ship; cosmetic only. Worth doing alongside the `default-features = false` flip since both edits touch the same line.                                            |
| orchestrator decide `auto-heal` explicitly                        | n/a                                                                                                              | **ACADEMIC** — same reason. Resolves automatically as a side effect of the `default-features = false` flip (auto-heal stops being inherited; the choice becomes "list it explicitly or omit it"). |
| deployd-api-rs `dlock` future spec                                | n/a (independent)                                                                                                | n/a (independent)                                                                                                                              |
| deployd-api-rs `listen_notify` future spec                        | n/a (independent)                                                                                                | n/a (independent)                                                                                                                              |
| axiomregent drop redundant explicit `cache`                       | n/a (independent)                                                                                                | n/a (independent) — remains LIVE 0-effort.                                                                                                     |
| axiomregent offline audit buffering future spec                   | n/a (independent)                                                                                                | n/a (independent)                                                                                                                              |

---

## Next actions

- **Tier 1 cleanup PR remains live regardless of either verdict.** The
  three 0-effort `Cargo.toml` toggles — orchestrator
  `default-features = false`, drop orchestrator `dlock`, drop
  axiomregent redundant explicit `cache` — can land as one small PR
  scoped to `crates/orchestrator/Cargo.toml:20` and
  `crates/axiomregent/Cargo.toml:38`. SBOM impact (drop of `cron`,
  `futures-util`, `toml` from `crates/Cargo.lock` hiqlite block) is
  the immediate visible benefit.
- **deployd-api-rs backup recommendation is deferred pending chart
  change.** The audit's "S effort" classification for
  `backup` + `s3` + `auto-heal` is no longer accurate. Convert the
  recommendation into a future spec covering: (a) flip
  `values-hetzner.yaml` `persistence.enabled` to `true`, (b) re-narrow
  `deployment.yaml:42` rm scope, (c) wire S3 endpoint env into
  `NodeConfig`, (d) add hiqlite restore-on-startup so a fresh pod
  against an empty volume rehydrates from S3. (a)–(d) form one
  coherent unit; splitting them lands a half-fix.
- **Two of the three orchestrator audit recommendations become cosmetic-only.**
  Drop dead `dlock` and decide `auto-heal` explicitly are now
  cosmetic-only because the gated code does not ship. They are still
  worth doing for hygiene — but should not be sequenced ahead of any
  load-bearing work.
- **Phase 4 verdict for orchestrator becomes moot.** "CORRECT (off) for
  distributed mode" is a true statement about a hypothetical mode that
  no build currently produces. Until distributed mode actually ships,
  orchestrator's backup posture is neither correct nor incorrect — it
  is irrelevant.
- **Open question 5 from the audit is resolved.** "Whether OAP currently
  builds + ships orchestrator with `--features distributed` anywhere"
  is now answered: **no, not anywhere.** The rest of the audit's
  orchestrator-specific findings stand only as theoretical groundwork
  for an eventual distributed-mode spec.
