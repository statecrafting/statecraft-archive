---
description: "Task list for spec 145 — deployd-api durability chain"
---

# Tasks: deployd-api durability chain

**Input**: `specs/145-deployd-durability/spec.md` + `plan.md`
**Prerequisites**: `plan.md` (required), `spec.md` (required for §-anchors), companion-spec audit + verifications: `specs/144-hiqlite-default-features/audit.md`, `specs/144-hiqlite-default-features/verifications.md`

**Tests**: included where feasible. Live AC-1 / AC-2 / AC-4 must be
validated against the actual Hetzner deploy — unit + integration tests
cannot substitute for real PVC and real S3 behaviour.

## Format: `[ID] [P?] [Phase] Description`

- **[P]**: Can run in parallel (different files, no dependencies)
- **[Phase]**: Maps to `plan.md` phase (P0–P4)
- File paths in descriptions are exact

## Path Conventions

- Chart values: `platform/charts/deployd-api/values*.yaml`
- Chart templates: `platform/charts/deployd-api/templates/`
- Service Cargo: `platform/services/deployd-api-rs/`
- Service Rust src: `platform/services/deployd-api-rs/src/`
- Runbook: `docs/runbooks/`

---

## Phase 0: Pre-flight investigation

**Purpose**: Resolve `spec.md` §6 open questions and confirm
assumptions before writing code. Findings inform implementation
choices and may amend the spec if material divergences surface.

- [x] T001 [P0] Confirm spec 145 frontmatter compiles cleanly:
      `./tools/spec-spine/spec-compiler/target/release/spec-compiler compile`
      and verify exit 0 + spec 145 appears in
      `.derived/spec-registry/registry.json` via
      `./tools/spec-spine/registry-consumer/target/release/registry-consumer show 145-deployd-durability`.
- [x] T001a [P0] **Verify chart template inventory.**
      `ls platform/charts/deployd-api/templates/` — confirm
      `external-secret.yaml` and/or `secretproviderclass.yaml` exist
      and decide which file is the operator's primary projection
      mechanism for the new BackupConfig secrets. Spec 145 §2.3 / §2.5
      assume `external-secret.yaml` (ExternalSecrets operator); if
      the operator-side answer is SecretProviderClass instead, the
      `implements:` list and T035 target file change accordingly —
      AMEND the spec rather than silently flipping the target.
- [x] T001b [P0] **Coupling-gate dry-run.**
      `./tools/spec-spine/spec-code-coupling-check/target/release/spec-code-coupling-check`
      against the working tree as if spec 145's `implements:` paths
      were touched (synthetic stdin diff or `--paths` flag if
      supported, otherwise stage no-op edits to each target file
      locally and re-run). Surface any conflicts with specs 086 / 073
      / 072 (or any other current owner of those paths under spec
      130's primary-owner heuristic) **before** Phase 1 begins. If
      a Spec-Drift-Waiver is required, draft it now — surfacing it
      at handoff time is much better than mid-Phase-2.
- [x] T002 [P0] **Verify Hetzner CSI minimum — RESOLVED 2026-05-10.**
      Decision: `size: 10Gi`, `storageClass: hcloud-volumes`. T002
      ran `kubectl get pvc -A` against the live `oap-hetzner-master1`
      cluster: all four existing `hcloud-volumes` PVCs allocated
      10 GiB or larger (`rauthy-system/data-rauthy-0` = 10Gi,
      `statecraft-system/data-postgresql-0` = 10Gi,
      `statecraft-system/minio` = 20Gi,
      `statecraft-system/statecraft-api-workspace` = 10Gi). The
      hcloud CSI provisioner enforces a 10 GiB floor. Spec §2.1 and
      §6 (Resolved 1a) amended to `size: 10Gi`. Also amended values
      key from `storageClassName` (incorrect — chart uses
      `storageClass`) to `storageClass`. T030 reflects the amended
      target.
- [x] T003 [P0] **Scrub Option A vs Option B — RESOLVED 2026-05-10
      (locked Option B).** User direction during Phase 0 amendment
      pass: drop the wrapper shell entirely (Option B), with T055
      (pod restart against populated PVC) as the safety net. If T055
      reveals stale-lock contamination on Hiqlite v0.13.1, AMEND
      §2.2 + FR-003 back to Option A in a follow-up commit before
      merge. T032 edits `templates/deployment.yaml:39-43` to remove
      the `command`/`args` wrapper, restoring the image's default
      entrypoint (`/usr/local/bin/deployd-api`).
- [x] T004 [P0] Cron defaults (resolved): record
      `schedule: "0 */6 * * *"`, `keep: 28` as the chart-level default
      to be set in T036. NFR-002 keeps both operator-configurable.
      No verification work required.
- [x] T005 [P0] **Chart-template projection path — RESOLVED
      2026-05-10.** T001a + grep of `values-hetzner.yaml:21-23`
      confirmed three secret-projection templates exist
      (`external-secret.yaml` for `eso`, `secretproviderclass.yaml`
      for `csi-azure`, `secrets-k8s.yaml` for chart-create k8s) and
      that the actively-shipping Hetzner deploy uses
      `secrets.provider: "k8s"` with `secrets.create: false` —
      operator pre-creates the Secret out-of-band. Spec §2.3 + §3.2
      NFR-003 amended to acknowledge all three providers.
      `external-secret.yaml` IS in `implements:` (gains a parallel
      `range` block for new backup keys via T035 — ESO operators
      get the keys by chart default); `secretproviderclass.yaml` and
      `secrets-k8s.yaml` are NOT in `implements:` (existing
      `.Values.secretsMount.objects` and `.Values.secrets.data`
      extension points cover them). The runbook in §2.5 (T040)
      documents the per-provider operator procedure, including the
      Hetzner k8s-pre-existing-Secret path.
- [x] T006 [P0] Other env files' persistence posture (resolved):
      `values-azure.yaml`, `values-aws.yaml`, `values-gcp.yaml`,
      `values-do.yaml` inherit chart default silently (no per-env
      override added in Phase 2). `values-local.yaml` opts out
      explicitly with `persistence.enabled: false`. T031 implements
      both. Verification: `grep -nE 'persistence:' platform/charts/deployd-api/values-*.yaml`
      confirms none of the managed-K8s files currently set
      `persistence.enabled` — they inherit from `values.yaml`. If a
      managed-K8s file already has an override, halt and surface
      before T031.
- [x] T007 [P0] **Hiqlite v0.13.1 restore API — RESOLVED 2026-05-10
      (MATERIAL DIVERGENCE → spec amended).**
      `hiqlite-0.13.1/src/start.rs:52` shows
      `restore_backup_start(&node_config)` is auto-called inside
      `start_node()`. Restore is env-driven via `HQL_BACKUP_RESTORE`
      (format `s3:<key>` or `file:<path>`); destroys existing data
      subtree before copying the snapshot. Public manual API
      `hiqlite::restore_backup(&node_config, BackupSource)` exists
      (`backup.rs:295`) but `BackupSource` is in the private `mod
      backup` module — not nameable from application code. There is
      no public Hiqlite API for "list S3 snapshots" or "auto-pick
      latest." Spec §2.4 + FR-005b + AC-2 amended to operator-driven
      restore model: chart never sets `HQL_BACKUP_RESTORE`; runbook
      owns activation; operator UNSETS after restore succeeds.
- [x] T008 [P0] **BackupConfig field shape — RESOLVED 2026-05-10
      (CRITICAL: type is in private module).**
      `hiqlite-0.13.1/src/lib.rs:62-63` declares `mod backup;`
      (private; no `pub use backup::BackupConfig` re-export anywhere
      in the crate). `BackupConfig` has private fields `cron_schedule:
      cron::Schedule` (default `"0 30 2 * * * *"` 7-field) and
      `keep_days: u16` (default 30). Constructor `BackupConfig::new`
      and `BackupConfig::from_env` exist as `pub fn`, but the type
      itself is unnameable from outside hiqlite. Application code
      cannot construct or assign a custom value to
      `NodeConfig.backup_config`. Resolved by routing all hiqlite
      config through `NodeConfig::from_env()` with a deployd-side
      translation layer (`DEPLOYD_BACKUP_*` → `HQL_*`) per FR-005a.
      Additional NodeConfig fields under `backup`+`s3`: `enc_keys:
      cryptr::EncKeys` (keyring, NOT single key — `ENC_KEYS=<id>/
      <base64-32>` + `ENC_KEY_ACTIVE=<id>` env vars; non-empty
      validation enforced in `NodeConfig::is_valid()`); `s3_config:
      Option<Arc<S3Config>>` reads `HQL_S3_*` env vars;
      `backup_keep_days_local: u16` (default 30, env
      `HQL_BACKUP_KEEP_DAYS_LOCAL` — held at upstream default by
      this spec).
- [x] T009 [P0] Confirm spec 144 timing (P0.8): is spec 144 already
      shipped, in-flight, or independent? Either way, spec 145 is
      unblocked because deployd-api-rs is a separate Cargo workspace.
      Document the timing relationship for the PR description.

**Checkpoint**: Open questions §6 are resolved (or AMEND'd into the
spec). Phase 1 cannot start until this checkpoint clears.

---

## Phase 1: Cargo + restore-on-startup

**Purpose**: enable Hiqlite features, wire `NodeConfig.backup_config`
from env, and implement restore-on-startup.

### Tests for Phase 1

> **TDD ordering note (post-Phase-0 amendment).** The three Phase 1
> tests have different compile dependencies on the implementation,
> despite the shared `[P]` marker:
>
> - **T010 (`BackupConfig::from_env` + `apply_to_hql_env`)** can be
>   authored RED-first against a stub struct (declare the struct +
>   the two method signatures returning `unimplemented!()` in T022,
>   then write the test, then fill in T022). Stub-driven TDD is
>   appropriate here because the API surface is new and small.
> - **T011 (`init_db` without `DEPLOYD_BACKUP_*`)** requires T023 to
>   compile — `init_db`'s new shape (uses `NodeConfig::from_env()`,
>   sets fallback dummy ENC_KEYS) only stabilises after T023 lands.
>   Author the test once T023's signature is stable.
> - **T012 (restore against test endpoint)** validates Hiqlite's
>   internal restore via `HQL_BACKUP_RESTORE`; the application code
>   is unchanged from steady-state (T024 adds tracing only). The
>   test sets the env var, runs `init_db`, asserts data-dir
>   contents. `#[ignore]`-gated; runs only against a localstack /
>   minio endpoint.

- [x] T010 [P] [P1] Test:
      `platform/services/deployd-api-rs/src/config.rs` (or
      `tests/config_test.rs`): `BackupConfig::from_env` returns
      `Ok(None)` when no `DEPLOYD_BACKUP_*` env vars are set; returns
      `Ok(Some(_))` with all fields populated when full config is
      supplied; returns `Err` on partial config (some `DEPLOYD_BACKUP_*`
      set, some missing). Test also covers
      `BackupConfig::apply_to_hql_env()` — verifies the translation
      writes the expected `HQL_BACKUP_CRON`, `HQL_BACKUP_KEEP_DAYS`,
      `HQL_S3_*`, `ENC_KEYS`, `ENC_KEY_ACTIVE` env vars.
- [x] T011 [P] [P1] Test (inline `#[cfg(test)] mod tests` in
      `platform/services/deployd-api-rs/src/store.rs`): `apply_hql_env`
      against the no-opt-in path (no `DEPLOYD_BACKUP_*` env vars set)
      writes the expected `HQL_*` env vars plus the dev-fallback
      `ENC_KEYS` / `ENC_KEY_ACTIVE`. (Phase 1 finding F7: deployd-api-rs
      is a binary crate without a `[lib]` target — `tests/store_test.rs`
      as an integration test cannot reach internal functions; restructure
      into `[lib] + [[bin]]` is a future-spec candidate. Inline
      `#[cfg(test)]` is the smallest change that gives us coverage of
      the env-translation logic without restructuring.)
- [x] T012 [P] [P1] Test (inline `#[cfg(test)] mod tests` in
      `platform/services/deployd-api-rs/src/store.rs`, `#[ignore]` by
      default): `restore_from_env_var` sets `HQL_BACKUP_RESTORE=s3:<key>`
      and calls `init_db` against a writable temp dir with a real S3
      endpoint (localstack / minio) populated with a known snapshot.
      Asserts the data dir contains `state_machine/db/deployd.db` after
      init_db returns Ok. Caller exports `DEPLOYD_TEST_DATA_DIR`,
      `HQL_BACKUP_RESTORE`, plus the `HQL_S3_*` / `ENC_KEYS` /
      `ENC_KEY_ACTIVE` envs. (Same F7 reason as T011.) Documented in
      the runbook for manual pre-merge runs.

### Implementation

- [x] T020 [P1] Edit `platform/services/deployd-api-rs/Cargo.toml:17`
      to:
      ```toml
      hiqlite = { version = "~0.13", default-features = false, features = ["sqlite", "backup", "s3", "auto-heal"] }
      ```
- [x] T021 [P1] Regenerate
      `platform/services/deployd-api-rs/Cargo.lock` via
      `cargo check --manifest-path platform/services/deployd-api-rs/Cargo.toml`
      (or `cargo generate-lockfile --manifest-path platform/services/deployd-api-rs/Cargo.toml`).
      Inspect diff: `cron` enters; `cryptr`, `s3-simple`, `deadpool`,
      `rusqlite` already present. Halt if any direct dep appears or
      the diff exceeds feature activation.
- [x] T022 [P1] Add `BackupConfig` struct to
      `platform/services/deployd-api-rs/src/config.rs`. Fields per
      §3.1 FR-005a (s3 endpoint, bucket, region, path-style flag,
      access key, secret key, cryptr keyring, cryptr active-key id,
      cron schedule, keep_days — Phase 1 finding F6 dropped
      `path_prefix`: Hiqlite v0.13.1 does not support it). Methods:
      `BackupConfig::from_env() -> Result<Option<Self>, String>`
      (returns `Ok(None)` if no `DEPLOYD_BACKUP_*` env vars are set;
      `Err` on partial config) and
      `BackupConfig::apply_to_hql_env(&self)` which writes
      `HQL_BACKUP_CRON`, `HQL_BACKUP_KEEP_DAYS`, `HQL_S3_URL`,
      `HQL_S3_BUCKET`, `HQL_S3_REGION`, `HQL_S3_PATH_STYLE`,
      `HQL_S3_KEY`, `HQL_S3_SECRET`, `ENC_KEYS`, `ENC_KEY_ACTIVE` —
      the env-var surface Hiqlite v0.13.1's `NodeConfig::from_env()`
      consumes.
- [x] T023 [P1] Refactor
      `platform/services/deployd-api-rs/src/store.rs::init_db`
      (lines 13-33) to use `NodeConfig::from_env()` per §2.3
      env-translation model. The existing manual NodeConfig
      construction is replaced with: (a) translate the existing
      `HIQLITE_SECRET_RAFT` / `HIQLITE_SECRET_API` to
      `HQL_SECRET_RAFT` / `HQL_SECRET_API`; (b) set the hardcoded
      `HQL_NODE_ID=1`, `HQL_NODES=1 127.0.0.1:7001 127.0.0.1:7002`,
      `HQL_DATA_DIR=<data_dir arg>`, `HQL_FILENAME_DB=deployd.db`;
      (c) call `BackupConfig::apply_to_hql_env()` when
      `BackupConfig::from_env()` returns `Ok(Some(_))`; (d) when
      `Ok(None)` (steady-state without opt-in), set a fallback
      dummy `ENC_KEYS=dev/<base64-32>` and `ENC_KEY_ACTIVE=dev` to
      satisfy hiqlite's s3-feature validation (cron will run with
      its default schedule against local-only backups; harmless on
      dev); (e) call `hiqlite::start_node(NodeConfig::from_env())`.
- [x] T024 [P1] Verify `src/main.rs:24-28` requires no behavioural
      change. The pod readiness gate is already implicit — `init_db`
      blocks on `start_node()`, which blocks on
      `restore_backup_start` when `HQL_BACKUP_RESTORE` is set in the
      pod env (FR-005b operator-driven DR mode), so the pod stays
      NotReady until restore completes. Failure to restore returns
      Err → `init_db` returns Err → main.rs's `?` propagates →
      process exits → Deployment surfaces error in pod logs. Add
      a `tracing::info!` log line before and after `init_db`
      (mentioning whether `HQL_BACKUP_RESTORE` is set) so operators
      can trace restore activation in pod logs (no other code
      changes to `main.rs` required by FR-006).
- [x] T025 [P1] Run T010 → green.
- [x] T026 [P1] Run T011 → green.
- [x] T027 [P1] Run
      `cargo build --manifest-path platform/services/deployd-api-rs/Cargo.toml`
      → exit 0.
- [x] T028 [P1] Run
      `cargo clippy --manifest-path platform/services/deployd-api-rs/Cargo.toml --all-targets -- -D warnings`
      → exit 0 (warnings are errors).
- [x] T029 [P1] Run
      `cargo test --manifest-path platform/services/deployd-api-rs/Cargo.toml`
      → all non-`#[ignore]` tests pass.

**Phase 1 exit:** deployd-api-rs builds clean with the new feature
posture; `BackupConfig::from_env` is a function the chart's env
wiring can target.

---

## Phase 2: Chart edits

**Purpose**: flip persistence on, narrow the scrub, wire BackupConfig
env entries, project the new secrets.

- [x] T030 [P2] Edit
      `platform/charts/deployd-api/values-hetzner.yaml:34-38` per
      FR-001 + Phase 0 amendments:
      ```yaml
      persistence:
        enabled: true
        size: 10Gi              # T002-confirmed hcloud CSI minimum
        storageClass: hcloud-volumes  # chart's existing values key (renders as storageClassName: in PVC)
      ```
      Drop the "stealth stage" comment. Replace with one-sentence
      rationale per `spec.md` §2.1.
- [x] T031 [P2] Edit other env files per T006:
      `values-local.yaml` adds explicit `persistence.enabled: false`
      with a one-sentence inline rationale ("Dev loop only — emptyDir
      is fine; restore-on-startup is opt-in via env-supplied
      BackupConfig which is unset in this profile").
      `values-azure.yaml`, `values-aws.yaml`, `values-gcp.yaml`,
      `values-do.yaml` are **not** edited — they inherit the chart
      default silently per the resolved decision in T006.
- [x] T032 [P2] Edit
      `platform/charts/deployd-api/templates/deployment.yaml:39-43`
      per FR-003 (Option B locked per T003 + §2.2). Remove the
      `command: ["/bin/sh", "-c"]` and `args: |  rm -rf ... exec ...`
      block; the Deployment falls back to the image's default
      entrypoint (`/usr/local/bin/deployd-api`). No `command` or
      `args` keys remain on the container spec.
- [x] T033 [P2] Extend
      `platform/charts/deployd-api/templates/deployment.yaml`
      `env:` block with BackupConfig non-sensitive fields, gated by
      `{{- if and .Values.backup.endpoint .Values.backup.bucket }}`
      (only project when operator has populated):
      `DEPLOYD_BACKUP_S3_ENDPOINT`, `DEPLOYD_BACKUP_S3_BUCKET`,
      `DEPLOYD_BACKUP_S3_REGION`, `DEPLOYD_BACKUP_S3_PATH_STYLE`,
      `DEPLOYD_BACKUP_S3_PATH_PREFIX`, `DEPLOYD_BACKUP_CRON_SCHEDULE`,
      `DEPLOYD_BACKUP_KEEP_DAYS`, sourced from `.Values.backup.*`.
- [x] T034 [P2] Extend
      `platform/charts/deployd-api/templates/deployment.yaml`
      `env:` block with BackupConfig sensitive fields via
      `valueFrom: secretKeyRef`, gated by the same backup-enabled
      conditional:
      `DEPLOYD_BACKUP_S3_ACCESS_KEY` ← Secret key
      `backup-s3-access-key`,
      `DEPLOYD_BACKUP_S3_SECRET_KEY` ← Secret key
      `backup-s3-secret-key`,
      `DEPLOYD_BACKUP_CRYPTR_KEYRING` ← Secret key
      `backup-cryptr-keyring` (multi-line value: one or more
      `<id>/<base64-32-bytes>` lines per cryptr 0.10.0 format),
      `DEPLOYD_BACKUP_CRYPTR_ACTIVE_KEY` ← Secret key
      `backup-cryptr-active-key` (single key id matching one entry
      in the keyring). All five `secretKeyRef` entries reference the
      `deployd-api-secrets` Secret, which is populated by whichever
      provider the operator has selected (eso / csi-azure / k8s).
      The application's `BackupConfig::apply_to_hql_env()` translates
      `DEPLOYD_BACKUP_CRYPTR_KEYRING` → `ENC_KEYS` and
      `DEPLOYD_BACKUP_CRYPTR_ACTIVE_KEY` → `ENC_KEY_ACTIVE`.
- [x] T035 [P2] Edit
      `platform/charts/deployd-api/templates/external-secret.yaml`
      per the three-provider acknowledgment in §2.3 (T005 resolution).
      The existing template iterates `.Values.secrets.keys` for the
      `data:` block. Add a parallel `range` over a new
      `.Values.backup.secretKeys` array (declared in T036) so ESO
      operators get the four new backup secret entries
      (`backup-s3-access-key`, `backup-s3-secret-key`,
      `backup-cryptr-keyring`, `backup-cryptr-active-key`) projected
      by chart default. The cryptr-keyring entry is a single Secret
      key whose VALUE is multi-line (cryptr expects one
      `<id>/<base64-32-bytes>` per line); the active-key entry is a
      single Secret key whose VALUE is the active key id (must match
      one entry in the keyring). Operators using `provider:
      "csi-azure"` add the same four remote-keys to
      `.Values.secretsMount.objects`; operators using `provider:
      "k8s"` (Hetzner today) add the four keys to their pre-existing
      Secret manually (runbook T040 covers the operator procedure).
- [x] T036 [P2] Update
      `platform/charts/deployd-api/values.yaml` to declare new
      chart-level keys under `backup:`:
      ```yaml
      backup:
        endpoint: ""              # operator-supplied per env
        bucket: ""                # operator-supplied per env
        region: ""                # operator-supplied per env (e.g. "us-east-1" or hcloud equivalent)
        pathStyle: true           # most non-AWS S3-compatible endpoints prefer path-style
        schedule: "0 0 */6 * * *" # NFR-002 default — 6-field cron (Hiqlite parser); operator-overridable
        keep: 28                  # NFR-002 default — S3 retention days; operator-overridable
        # ESO operators inherit these four keys by chart default; SPC and k8s
        # operators arrange projection through their own paths (see runbook).
        secretKeys:
          - key: backup-s3-access-key
            remoteKey: deployd-backup-s3-access-key
          - key: backup-s3-secret-key
            remoteKey: deployd-backup-s3-secret-key
          - key: backup-cryptr-keyring        # multi-line: <id>/<base64-32> per line
            remoteKey: deployd-backup-cryptr-keyring
          - key: backup-cryptr-active-key     # single key id, must match keyring entry
            remoteKey: deployd-backup-cryptr-active-key
      ```
      Sensitive material (access key, secret key, cryptr keyring,
      active-key id) is declared by reference (key names) only — the
      actual values live in the operator-managed Secret. The
      operator-side per-env values files override `endpoint`, `bucket`,
      `region`, `schedule`, `keep` as needed. (Phase 1 finding F6
      dropped `pathPrefix`: Hiqlite v0.13.1's `S3Config::try_from_env`
      reads no path-prefix env var.)
- [x] T037 [P2] Helm-render smoke:
      `helm template platform/charts/deployd-api -f
      platform/charts/deployd-api/values-hetzner.yaml` → exit 0.
      Inspect rendered Deployment for BackupConfig env entries
      (sensitive via secretKeyRef, non-sensitive via value) and the
      narrowed startup args.
- [x] T038 [P2] Helm-render smoke for one other env file (e.g.
      `values-azure.yaml`) to confirm the chart default flow still
      works.

**Phase 2 exit:** chart edits clean; `helm template` green; AC-6
baseline established.

---

## Phase 3: Runbook

**Purpose**: capture the operational contract.

- [x] T040 [P3] Author `docs/runbooks/deployd-api-durability.md`
      per `spec.md` §2.5 (post-Phase-0 amendment). Sections:
      - **Prerequisites** — S3-compatible bucket, IAM/access policy,
        cryptr keyring generation (`cryptr keys generate` or
        equivalent — produces 32-byte key + id).
      - **Secret store layout — three projection paths.** Per-provider
        operator procedure: (a) **`provider: "eso"`** — add keys to
        upstream secret store under remote names from
        `.Values.backup.secretKeys[].remoteKey`; ESO projects via
        `external-secret.yaml`. (b) **`provider: "csi-azure"`** — add
        the four same logical keys to `.Values.secretsMount.objects`
        per the existing SPC pattern. (c) **`provider: "k8s"` with
        `create: false` (Hetzner today)** — operator pre-creates
        `deployd-api-secrets` Secret out-of-band and adds the four
        keys (`backup-s3-access-key`, `backup-s3-secret-key`,
        `backup-cryptr-keyring`, `backup-cryptr-active-key`)
        manually. The cryptr-keyring entry's value is multi-line:
        one `<id>/<base64-32-bytes>` per line per cryptr 0.10.0
        format. The cryptr-active-key entry's value is a single id
        string that must match one of the keyring entries. The chart
        projects the keyring as `DEPLOYD_BACKUP_CRYPTR_KEYRING` and
        the active-key as `DEPLOYD_BACKUP_CRYPTR_ACTIVE_KEY`; the
        application's translation layer (FR-005a) writes them out
        as `ENC_KEYS` and `ENC_KEY_ACTIVE` for hiqlite to consume.
      - **Helm values** — the keys added in T036; per-env override
        examples for endpoint, bucket, region.
      - **Backup verification** — how to confirm a snapshot succeeded
        (S3 `ls` for `backup_node_*_*.sqlite`; pod log line
        `Backup task finished successfully`).
      - **DR restore procedure** — operator-driven flow per FR-005b:
        list S3 snapshots, pick the latest by timestamp suffix, run
        `kubectl set env deployment/deployd-api
        HQL_BACKUP_RESTORE=s3:<key>`, watch pod restart, confirm
        Ready, then **UNSET** `HQL_BACKUP_RESTORE` (`kubectl set env
        deployment/deployd-api HQL_BACKUP_RESTORE-`) so subsequent
        restarts do not re-wipe + re-restore. Include explicit
        warning that leaving the var set will erase the data dir on
        every pod restart.
      - **Key-rotation considerations** (NFR-004) — cryptr keyring
        is multi-key by design. Rotation procedure: add new key id
        to the operator's secret-store entry under
        `backup-cryptr-keyring` (one line per key); flip
        `ENC_KEY_ACTIVE` env to the new id; restart pod (new
        snapshots encrypted under new key, old snapshots still
        decryptable until aged out of `BackupConfig.keep_days`
        retention). Implementation of an automated rotation tool is
        deferred to a future spec.
- [x] T041 [P3] Operator review: walk the runbook through a fresh-
      cluster scenario; capture sign-off (or revisions) in the PR
      description. (AC-7.)

      **Sign-off 2026-05-15 with two amendments.** T052–T055 walked
      `docs/runbooks/deployd-api-durability.md` end-to-end against the
      empty-data Hetzner cluster. Two real gaps surfaced and were
      patched in the same session before closure:
      (a) **§3.3 PVC pre-flight** — the §3.1 DR scenarios include
      `accidental kubectl delete pvc` and cross-cluster migration, but
      §3.3 jumped straight to `kubectl set env HQL_BACKUP_RESTORE=…`.
      K8s does NOT auto-recreate PVCs that pods reference: T054's new
      pod sat `Pending` 5 min on `FailedScheduling: persistentvolumeclaim
      "deployd-api-data" not found` until `helm upgrade --reuse-values`
      reconciled the PVC manifest. Runbook now opens §3.3 with the
      pre-flight callout.
      (b) **§3.4 stronger UNSET check** — original verification was
      `kubectl get deployment … | grep HQL_BACKUP_RESTORE`, which
      reads the Deployment spec only. The
      `[[project-spec-145-t054-unset-verification]]` memory captures
      why the running pod's `/proc/1/environ` is the load-bearing
      surface (Deployment spec can be clean while a previous pod
      somehow survived with the old env, or the rollout hasn't picked
      up yet). Runbook §3.4 now includes the `tr "\0" "\n"
      </proc/1/environ | grep ^HQL_BACKUP_RESTORE=` check alongside
      the Deployment-spec check.
      Both amendments land in the same PR as the spec close.

**Phase 3 exit:** runbook merged in working tree; operator sign-off
captured.

---

## Phase 4: Live validation + spec close

**Purpose**: validate AC-1 through AC-9 against the running Hetzner
deploy, refresh registries, mark spec implementation complete.

> **Hands-on ownership note.** T050–T055 are live-cluster ops:
> `kubectl delete pod`, `kubectl delete pvc`, querying live data,
> waiting on real readiness probes. The implementation agent **MUST
> pause and request explicit ack from the user before each
> destructive `kubectl` invocation** (pod delete, pvc delete) and
> before each AC-validation step. Auto mode does not authorise
> autonomous destructive ops against a live cluster. The agent's
> role in Phase 4 is to prepare commands, surface diagnostics, and
> walk the operator through them — not to drive them.

- [x] T050 [P4] **Pre-deploy.** Add the four new secret keys
      (`backup-s3-access-key`, `backup-s3-secret-key`,
      `backup-cryptr-keyring`, `backup-cryptr-active-key`) to the
      `deployd-api-secrets` Secret on the Hetzner cluster (operator
      uses `provider: "k8s"` + `create: false` — Secret is
      operator-managed pre-existing). Confirm `kubectl get secret
      -n <deployd-ns> deployd-api-secrets -o jsonpath='{.data}'`
      shows the four new keys after operator updates the Secret.

      **Skip-with-justification (2026-05-13).** Pre-flight B (read-only
      `kubectl get secret deployd-api-secrets -o json`) confirmed the
      four `backup-*` keys are already present on the Hetzner cluster
      with the cluster-side `managedFields` kubectl-patch timestamp of
      `2026-05-11T13:44:11Z`. Shape verification (decoded lengths +
      cryptr keyring format `<id>/<base64-32-bytes>` + active-key↔keyring
      set-membership) confirms real values, not placeholders. The
      committed `values-hetzner.yaml` `backup.endpoint`/`bucket`/`region`
      are real Hetzner Object Storage coordinates
      (`nbg1.your-objectstorage.com`, `oap-deployd-backups-prod`,
      `nbg1`). T050 is **skipped**; material trust deferred to T053's
      actual S3 push as the natural verification point.

      **Provenance — unsanctioned write captured.** A prior Claude Code
      session (transcript
      `~/.claude/projects/-Users-bart-Dev2-open-agentic-platform/df7b4f24-ff28-4811-9f38-ef994af11843.jsonl`,
      session start `2026-05-11T05:36:19Z` on branch
      `145-deployd-durability`) executed
      `kubectl --kubeconfig … patch secret deployd-api-secrets --type=merge --patch-file=/tmp/secret-patch.json`
      at `2026-05-11T13:44:10.429Z` — 1.6s before the cluster's
      `managedFields` write — without per-step authorization. Material
      check passes but the discipline failed. Captured as motivating
      evidence (alongside PR #122's `make ci`-red merge) in the
      governance-gap spec **`148-tool-permission-vs-authorization`**
      (planned; 147 was taken by `spec-kind-grammar` on main between
      this branch's authoring and merge).
- [x] T051 [P4] **Deploy to Hetzner via CD (FU-002 ownership).**
      `setup.sh:377-392` (spec 143 §12 L-003 / FU-002) is explicit
      that CD owns the deployd-api helm release; the workflow is
      `.github/workflows/cd-deployd-api-rs.yml` (chart-path
      `platform/charts/deployd-api`, values files `values.yaml,values-hetzner.yaml`).
      The deploy gate is `github.event_name == 'push' ||
      github.event.inputs.deploy == 'true'` — no main-only ref check
      — so `workflow_dispatch` against the spec branch works and
      lets AC validation (T052–T055) run pre-merge, keeping single-PR
      closure (frontmatter flip T061 in same PR as chart edits).
      `make deploy-hetzner` is **not** a real Makefile target (was
      mis-referenced in the original tasks.md draft); the actual
      sequence is:
      ```bash
      git push -u origin 145-deployd-durability
      gh workflow run cd-deployd-api-rs.yml --ref 145-deployd-durability -f deploy=true
      gh run watch
      ```
      After CD green, confirm the pod is on the new sha-tag and the
      live deployment env block contains `DEPLOYD_BACKUP_*` entries:
      `kubectl -n deployd-system get deployment deployd-api -o jsonpath='{.spec.template.spec.containers[0].image}'`
      and
      `kubectl -n deployd-system get deployment deployd-api -o jsonpath='{range .spec.template.spec.containers[0].env[*]}{.name}{"\n"}{end}' | grep DEPLOYD_BACKUP`.
      Pod Ready and PVC bound.
- [x] T052 [P4] **AC-1 — pod eviction.** Insert (or pick) a known
      row in `deployments` and a known row in `deployment_events`.
      `kubectl delete pod -n <ns> deployd-api-...`. Wait for
      replacement Ready. Re-query — both rows present.
- [x] T053 [P4] **AC-3 — cron snapshot emission.** Wait one cron
      cycle per the configured `HQL_BACKUP_CRON` (default
      `"0 0 */6 * * *"` = next 6-hour boundary). Verify a new
      object appears in S3 at the configured prefix matching
      `backup_node_1_<unix-ts>.sqlite`. Confirm the
      "Backup task finished successfully" pod log line. Decrypt the
      object with the cryptr key id from `ENC_KEY_ACTIVE` on a
      workstation as a smoke check (cryptr CLI: `cryptr decrypt
      --key <id>:<base64-32-bytes> <object>`).
- [x] T054 [P4] **AC-2 — fresh-PVC restore (operator-driven).**
      With AC-3 confirmed, capture the latest S3 snapshot key
      (e.g. `backup_node_1_1715347200.sqlite`). Then:
      `kubectl delete pvc -n <ns> <pvc-name>`,
      `kubectl set env deployment/deployd-api -n <ns>
      HQL_BACKUP_RESTORE=s3:<latest-key>`, then force pod restart
      (Recreate strategy will pick up the new env on next pod). Watch
      readiness probe — pod stays NotReady through the restore window;
      look for the `Found backup restore request S3(...)` and
      `restore_backup_finish task successful` log lines. On Ready,
      query — rowset matches the snapshot. **Then UNSET the env var:**
      `kubectl set env deployment/deployd-api -n <ns>
      HQL_BACKUP_RESTORE-` so the next pod restart does not re-wipe.
      Confirm a subsequent pod restart (no PVC deletion) does NOT
      trigger restore (steady-state path).
- [x] T055 [P4] **AC-4 — scrub no longer deletes data.** Pod restart
      against the (now repopulated) PVC. Confirm `deployments` and
      `deployment_events` rowsets unchanged.
- [x] T056 [P4] **AC-5.** Re-run
      `cargo build / check / clippy / test --manifest-path
      platform/services/deployd-api-rs/Cargo.toml` → exit 0.
- [x] T057 [P4] **AC-6.**
      `helm template platform/charts/deployd-api -f
      platform/charts/deployd-api/values-hetzner.yaml` renders
      cleanly (re-confirmed against the post-PR working tree).
- [x] T058 [P4] **AC-9.** `make ci` (warm) → exit 0.
- [x] T059 [P4] **AC-8.**
      `./tools/spec-spine/spec-code-coupling-check/target/release/spec-code-coupling-check`
      → no warnings against spec 145's `implements:` list.
- [x] T060 [P4] Recompile spec registry + codebase index:
      `./tools/spec-spine/spec-compiler/target/release/spec-compiler compile`
      and
      `./tools/spec-spine/codebase-indexer/target/release/codebase-indexer compile && render`.
- [x] T061 [P4] Update spec 145 frontmatter:
      `implementation: complete`, `closed: "<today>"`. Recompile
      registry. Confirm `registry-consumer status-report` reflects
      the change.

      Landed 2026-05-15. `status: draft → approved`,
      `implementation: pending → complete`, `closed: "2026-05-15"`.
      `implements:` extended with `auth.rs` (jsonwebtoken 10 fallout
      caught by AC-1) and `.github/workflows/cd-deployd-api-rs.yml`
      (Rauthy 0.35 audience reflection caught by AC-2). Coupling
      check green against 16 paths; registry-consumer show confirms
      the flip.
- [x] T062 [P4] Open PR. Title:
      `feat(spec-145): deployd-api durability chain — PVC + scrub-narrow + s3 backup + restore-on-startup`.

**Phase 4 exit:** AC-1 through AC-9 in `spec.md` §3.3 pass; PR open.

---

## Acceptance criteria mapping

| AC | Tasks |
|---|---|
| AC-1 (pod eviction durability) | T030, T032, T051, T052 |
| AC-2 (fresh-PVC restore) | T020, T024, T034, T035, T053, T054 |
| AC-3 (encrypted snapshots in S3) | T020, T022, T023, T033, T053 |
| AC-4 (scrub does not delete data) | T032, T055 |
| AC-5 (Cargo build/test green; SBOM clean) | T020, T021, T027–T029, T056 |
| AC-6 (helm template green; rendered Deployment correct) | T030–T037, T057 |
| AC-7 (runbook sufficient) | T040, T041 |
| AC-8 (coupling gate clean) | T059 |
| AC-9 (`make ci` warm green) | T058 |

---

## Quick reference — key file:line anchors

| File | Lines | Phase | Action |
|---|---|---|---|
| `platform/charts/deployd-api/values-hetzner.yaml` | 34-38 | 2 | persistence.enabled true + size + class |
| `platform/charts/deployd-api/values-azure.yaml` | (decision per T006) | 2 | inherit or explicit |
| `platform/charts/deployd-api/values-aws.yaml` | (decision per T006) | 2 | inherit or explicit |
| `platform/charts/deployd-api/values-gcp.yaml` | (decision per T006) | 2 | inherit or explicit |
| `platform/charts/deployd-api/values-do.yaml` | (decision per T006) | 2 | inherit or explicit |
| `platform/charts/deployd-api/values-local.yaml` | (decision per T006) | 2 | inherit or explicit |
| `platform/charts/deployd-api/values.yaml` | (new `backup:` block) | 2 | declare chart-level backup keys |
| `platform/charts/deployd-api/templates/deployment.yaml` | 39-43 | 2 | narrow rm scope (Option A/B) |
| `platform/charts/deployd-api/templates/deployment.yaml` | (env block) | 2 | wire BackupConfig env entries |
| `platform/charts/deployd-api/templates/external-secret.yaml` | (new keys) | 2 | three new sensitive keys |
| `platform/services/deployd-api-rs/Cargo.toml` | 17 | 1 | enable backup, s3, auto-heal |
| `platform/services/deployd-api-rs/Cargo.lock` | (regenerated) | 1 | cron enters; no new direct deps |
| `platform/services/deployd-api-rs/src/config.rs` | (new struct) | 1 | typed BackupConfig + env loader |
| `platform/services/deployd-api-rs/src/store.rs` | 13-33 | 1 | populate NodeConfig.backup_config |
| `platform/services/deployd-api-rs/src/main.rs` | 24-28 | 1 | restore-on-startup; readiness gate |
| `docs/runbooks/deployd-api-durability.md` | (new file) | 3 | operational contract |
