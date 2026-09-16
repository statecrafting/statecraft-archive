---
id: "145-deployd-durability"
slug: deployd-durability
title: "deployd-api durability chain — PVC + scrub-narrowing + Hiqlite backup/s3 + restore-on-startup"
status: approved
implementation: complete
closed: "2026-05-15"
owner: bart
created: "2026-05-10"
kind: platform-delivery
domain: platform
risk: medium
depends_on:
  - "073-axiomregent-unification"  # axiomregent-unification (deployd-api-rs runtime carrier)
  - "086-open-source-launch"  # open-source-launch (deployd-api role context)
  - "144-hiqlite-default-features"  # hiqlite default-features hygiene (companion; manifest discipline this spec inherits)
code_aliases: ["DEPLOYD_DURABILITY"]
extends:
  - spec: "073-axiomregent-unification"
    nature: additive
    unit: { kind: file, path: platform/services/deployd-api-rs/Cargo.toml }
  - spec: "073-axiomregent-unification"
    nature: additive
    unit: { kind: file, path: platform/services/deployd-api-rs/src/main.rs }
  - spec: "073-axiomregent-unification"
    nature: additive
    unit: { kind: file, path: platform/services/deployd-api-rs/src/store.rs }
  - spec: "073-axiomregent-unification"
    nature: additive
    unit: { kind: file, path: platform/services/deployd-api-rs/src/config.rs }
  - spec: "073-axiomregent-unification"
    nature: additive
    unit: { kind: file, path: platform/services/deployd-api-rs/src/auth.rs }
  - spec: "136-tenant-hello-demo-service"
    nature: additive
    unit: { kind: file, path: platform/charts/deployd-api/values.yaml }
  - spec: "136-tenant-hello-demo-service"
    nature: additive
    unit: { kind: file, path: platform/charts/deployd-api/values-hetzner.yaml }
  - spec: "136-tenant-hello-demo-service"
    nature: additive
    unit: { kind: file, path: platform/charts/deployd-api/values-azure.yaml }
  - spec: "136-tenant-hello-demo-service"
    nature: additive
    unit: { kind: file, path: platform/charts/deployd-api/values-aws.yaml }
  - spec: "136-tenant-hello-demo-service"
    nature: additive
    unit: { kind: file, path: platform/charts/deployd-api/values-gcp.yaml }
  - spec: "136-tenant-hello-demo-service"
    nature: additive
    unit: { kind: file, path: platform/charts/deployd-api/values-do.yaml }
  - spec: "136-tenant-hello-demo-service"
    nature: additive
    unit: { kind: file, path: platform/charts/deployd-api/values-local.yaml }
  - spec: "136-tenant-hello-demo-service"
    nature: additive
    unit: { kind: file, path: platform/charts/deployd-api/templates/deployment.yaml }
  - spec: "136-tenant-hello-demo-service"
    nature: additive
    unit: { kind: file, path: platform/charts/deployd-api/templates/external-secret.yaml }
  - spec: "136-tenant-hello-demo-service"
    nature: additive
    unit: { kind: file, path: .github/workflows/cd-deployd-api-rs.yml }
summary: >
  The `deployments` and `deployment_events` tables in deployd-api-rs's
  Hiqlite store are the audit trail of who deployed what, when, with
  what scope, and what outcome — not reconstructable from K8s state for
  rolled-back releases, and not reconstructable at all for the
  append-only event log. Today three reinforcing layers of "off" make
  this data ephemeral on the actively-shipping Hetzner deploy: the env
  values file disables the chart's PVC, the container start-up
  command runs `rm -rf /var/lib/deployd/data/*` on every boot, and the
  Cargo manifest enables only `["sqlite"]` so there is no off-cluster
  durability path. This spec lands the four coupled fixes as one unit:
  flip persistence on, narrow the data-dir scrub back to the targeted
  stale-lock cleanup it replaced, enable Hiqlite `backup`+`s3`+`auto-heal`
  with operator-supplied S3 credentials, and add restore-on-startup so
  a fresh pod against an empty volume rehydrates from the most recent
  encrypted snapshot. Splitting the four lands a half-fix.
---

# 145 — deployd-api durability chain

## 1. Background

`deployd-api-rs` is the platform's Rust deployment-orchestration
service. Its Hiqlite store carries two governance-load-bearing tables
(`audit.md` Phase 4):

- **`deployments`** (`platform/services/deployd-api-rs/src/store.rs:39-77`)
  — one row per release; release SHA, artifact ref, status, endpoints.
  Partially reconstructable from the K8s API for *currently-deployed*
  releases, **not** reconstructable for rolled-back ones.
- **`deployment_events`** (`store.rs:39-77`) — append-only event log
  per deployment. The audit trail itself; not reconstructable from any
  other source.

Three layers of "off" stack to make this state ephemeral on the
actively-shipping Hetzner deploy (`verifications.md` Q1):

1. **The env values file overrides the chart default to disable the
   PVC.** `platform/charts/deployd-api/values-hetzner.yaml:34-38` sets
   `persistence.enabled: false` with the inline rationale "Stealth
   stage: use emptyDir for hiqlite state. Deployment history is lost
   on pod restart, which is acceptable pre-GA. Flip to true and set a
   size/class when persistent deployment history is required." The
   chart's top-level default is `true`
   (`platform/charts/deployd-api/values.yaml:22-25`); the other env
   files (`values-azure.yaml`, `values-aws.yaml`, `values-gcp.yaml`,
   `values-do.yaml`, `values-local.yaml`) inherit that default.
2. **The container start-up command erases the data directory on every
   pod start.** `platform/charts/deployd-api/templates/deployment.yaml:39-43`:

   ```yaml
   command: ["/bin/sh", "-c"]
   args:
     - |
       rm -rf /var/lib/deployd/data/*
       exec /usr/local/bin/deployd-api
   ```

   Commit `3aa8893a` widened an earlier targeted stale-lock cleanup
   from commit `cd84f1e9` (which removed only
   `/var/lib/deployd/data/state_machine/lock`) into a full data-dir
   scrub. Even when a PVC is mounted, the Hiqlite data subtree under
   `/var/lib/deployd/data/*` is wiped at every boot, so the volume is
   durable from K8s's perspective but **not** from the application's.
3. **The Cargo manifest enables only `["sqlite"]`.**
   `platform/services/deployd-api-rs/Cargo.toml:17`:
   `default-features = false, features = ["sqlite"]`. `backup` and `s3`
   are off; there is no off-cluster durability path even if (1) and (2)
   were resolved. The single-replica, single-node Hiqlite cluster at
   `127.0.0.1:7001` (`store.rs:15-18`, `node_id: 1`) is the only copy
   of the data.

Phase 4 of `audit.md` named this an **OVERSIGHT**: deploy history is
governance-load-bearing data, not reconstructable from K8s state, and
the `cryptr → s3-simple` chain is already in
`platform/services/deployd-api-rs/Cargo.lock` as a Hiqlite transitive
(zero new direct deps to enable encrypted S3 backup). The
`verifications.md` Implications table promoted the original audit's
"S effort" recommendation to **M effort** and converted it from "an
audit recommendation" into "its own spec" — this is that spec.

### 1.1 Coordination with spec 146 (deployd-api memory hardening)

**Read this before implementing §2.** Spec 146
(`146-deployd-api-memory-hardening`, authored 2026-05-10) lands a
chart-default `resources` block on
`platform/charts/deployd-api/values.yaml` populating `limits.memory:
1Gi`, `requests.memory: 256Mi`, `requests.cpu: 100m`. Spec 146 closes
spec 143 FU-021 — the OOM driver was *cold-start hiqlite WAL pressure
against an unbounded cgroup* on the actively-shipping Hetzner deploy
(restartCount=3, exit 137, ~10 min lifetime). Spec 146 §2.4 and spec
143's §13 2026-05-10 ~17:00 / ~17:30 UTC entries flag this as a
coordination point with spec 145 for one reason:

> **If memory pressure during WAL init produces an OOM *before* spec
> 145's restore-on-startup path runs, the chart-default 1Gi cgroup
> spec 146 lands is the load-bearing safeguard that lets
> restore-on-startup run at all.**

Concretely, when this session lands §2.4 (restore-on-startup):

1. **Verify the cgroup floor is present.** `helm template` against
   `values.yaml` must render `resources.limits.memory` and
   `resources.requests.memory` non-empty in the deployd-api
   Deployment. Spec 146 already wires this; the assertion here is
   "spec 146 landed before spec 145's restore code path is
   exercised on cluster." If §2 of this spec ships ahead of spec
   146, the restore path runs against an unbounded cgroup and the
   cold-start OOM can fire *before* the restore logic gets to run.
2. **Decide absorb-vs-fork on WAL-pressure-aware scheduling.** If
   restore-on-startup itself drives non-trivial allocation under
   the 1Gi floor (e.g., decrypting a multi-MB snapshot in-memory),
   this session captures the data and decides whether to:
   - **Absorb** — raise the cgroup default in spec 146 (amend
     §2.1 with budget math for the restore-decrypt allocation), or
   - **Fork** — file a follow-up spec on
     WAL-pressure-aware scheduling (e.g., stream decrypt to disk,
     or chunk restore by table).
   Spec 146 §2.4 names this absorb-vs-fork choice as deferred to
   this session — the floor is sufficient cover for the diagnosed
   FU-021 failure mode, but spec 145's restore allocation profile
   is the next pressure surface and this session has the data.
3. **Touch points.** Spec 146 claims the same `values.yaml` file
   under spec 130's any-claimant heuristic. Edits to the
   `resources:` block from this session require either the spec 146
   amendment path (cleanest) or a Spec-Drift-Waiver per spec 127
   FR-005. The two specs' edits to `values.yaml` are otherwise
   disjoint (146 adds `resources:`; 145 changes
   `persistence.enabled` and `command.args`).

This subsection is informational, not contractual; it does not
expand spec 145's `implements:` list. The coordination flag exists
so this session's first read of spec 145 surfaces the spec 146
context without needing to dredge spec 143's §13 ledger.

## 2. Resolution

The four changes below land as one coherent unit. They are coupled
because:

- without (a), no Cargo feature change matters;
- without (b), a PVC is durable from K8s's perspective but not from
  the application's;
- without (c), on-cluster persistence still has no DR story;
- without (d), a fresh pod against an empty volume cannot rehydrate.

### 2.1 Chart — flip Hetzner persistence on; audit other env files

**File:** `platform/charts/deployd-api/values-hetzner.yaml:34-38`.

Set:

```yaml
persistence:
  enabled: true
  size: 10Gi
  storageClass: hcloud-volumes
```

The inline "stealth stage" rationale is replaced with one sentence:
"Persistent deployment history required from spec 145; size pinned to
10Gi (the hcloud CSI minimum — see Verification below) and storage
class pinned to `hcloud-volumes` rather than the cluster default to
avoid silent re-binding if cluster StorageClass priorities are
reordered."

**Note on the values key.** The chart's existing convention
(`values.yaml:22-25`, `templates/pvc.yaml:9-11`) uses `storageClass`
as the values key — the rendered K8s `PersistentVolumeClaim.spec.
storageClassName` field is produced by the template. Writing
`storageClassName:` in a values file would be silently ignored.
Spec amendments 2026-05-10 (Phase 0 finding F1) reconciled the
spec to match the chart's existing key.

**Verification — Hetzner CSI minimum (T002, completed 2026-05-10).**
The hcloud CSI provisioner (`csi.hetzner.cloud`) enforces a 10 GiB
minimum. T002 evidence on the live `oap-hetzner-master1` cluster:
all four existing PVCs allocated through `hcloud-volumes` provisioned
at 10 GiB or larger (`rauthy-system/data-rauthy-0` = 10Gi,
`statecraft-system/data-postgresql-0` = 10Gi,
`statecraft-system/minio` = 20Gi,
`statecraft-system/statecraft-api-workspace` = 10Gi). The 10 GiB pin
matches that empirical floor. The `hcloud-volumes` StorageClass is
the cluster default (`storageclass.kubernetes.io/is-default-class:
"true"`) but is pinned explicitly to avoid silent re-binding.

**Other env files.** `values-azure.yaml`, `values-aws.yaml`,
`values-gcp.yaml`, `values-do.yaml` inherit the chart default
(`persistence.enabled: true`, `size: 1Gi`,
`storageClassName: ""` → cluster default) silently. The chart-level
default at `values.yaml:22-25` is correct for managed-K8s targets;
no per-env override is added unless the operator's evidence flags a
specific cluster's StorageClass needs an explicit pin. `values-local.yaml`
(kind / minikube / k3d) sets `persistence.enabled: false` explicitly
with a one-sentence inline rationale ("Dev loop only — emptyDir is
fine; restore-on-startup is opt-in via env-supplied BackupConfig
which is unset in this profile"). FR-002 records the decisions
explicitly.

The chart `templates/pvc.yaml:1-15` and `templates/deployment.yaml:99-100,
:115-121` already implement the PVC + volume-mount machinery and need
no edits — the gate is `.Values.persistence.enabled`.

### 2.2 Chart — narrow the container-start `rm` scope

**File:** `platform/charts/deployd-api/templates/deployment.yaml:39-43`.

**Resolution (locked 2026-05-10 — Option B).** The container
`command`/`args` wrapper is removed. The Deployment falls back to
the image's default entrypoint (`/usr/local/bin/deployd-api`) with
no pre-start scrub. Hiqlite v0.13.1's first-boot path manages the
state-machine lock file internally; the `cd84f1e9` workaround that
motivated the wider `rm -rf` was a stale-lock issue from earlier
Hiqlite versions on emptyDir, addressed upstream by the time
deployd-api-rs's lockfile resolved 0.13.1.

The reverse path (Option A — narrow `rm -f` of just
`/var/lib/deployd/data/state_machine/lock`) is held in reserve. If
T055 (pod restart against a populated PVC) reveals stale-lock
contamination on Hiqlite v0.13.1, AMEND this section back to Option
A in a follow-up commit before merging.

**Validation pointer.** AC-4 (Phase 4 T055): pod restart against
the now-populated PVC; confirm `deployments` and `deployment_events`
rowsets unchanged, and that Hiqlite first-boot completes without
manual intervention.

**Rationale — partial landing ahead of the full chain (2026-05-11).**
An external HIAS readiness assessment surfaced the `rm -rf
/var/lib/deployd/data/*` boot scrub as a Critical/High finding: the
wipe destroys the deployd audit trail (`deployments` and
`deployment_events` rowsets) on every pod restart even when
`persistence.enabled: true` mounts a PVC at `/var/lib/deployd` — the
PVC survives but its contents do not, which is the worst-of-both
outcome (durable from K8s's perspective, ephemeral from the
application's). The §2.2 Option-B landing — removing the
`command`/`args` wrapper so the container falls back to the image's
default entrypoint — is being applied ahead of §2.1 (PVC flip), §2.3
(Cargo features), and §2.4 (restore-on-startup). This is a partial
implementation of the four-coupled-fixes contract this spec
otherwise lands as a unit: removing the destructive scrub closes the
immediate audit-trail loss on the actively-shipping Hetzner deploy
while the rest of the durability chain is sequenced. Spec status
remains `draft` and `implementation: pending` to reflect that §2.1,
§2.3, §2.4 are still owed. Self-disclosure pattern: future readers
should see that this section landed first because it was the only
self-contained safety fix in the chain — not because the chain itself
was reordered. The drift between the spec's "lands as one unit"
framing in the summary and this partial-landing reality is
deliberate and audited.

### 2.3 Cargo — enable `backup`, `s3`, `auto-heal`; env-translation layer

**File:** `platform/services/deployd-api-rs/Cargo.toml:17`.

Becomes:

```toml
hiqlite = { version = "~0.13", default-features = false, features = ["sqlite", "backup", "s3", "auto-heal"] }
```

`backup` and `s3` mutually-imply per upstream (`s3 = ["backup"]`,
`backup` activates the cron-driven snapshot path that emits to S3 via
`cryptr → s3-simple`). `auto-heal` enables WAL self-repair for the
single-node deploy — cheap reliability, mirrors spec 144's posture
on the orchestrator + axiomregent crates.

**SBOM impact.** The `cryptr` and `s3-simple` chain is already in
`platform/services/deployd-api-rs/Cargo.lock` as a Hiqlite transitive
(`audit.md` Phase 2.3, Phase 3b). No new direct deps. `cron` enters
the lockfile (it is feature-gated by `backup` upstream). No other
crates should appear; the diff is feature-flag-driven.

**Hiqlite v0.13.1 BackupConfig accessibility — env-translation layer.**
Phase 0 finding F4 (2026-05-10) established that
`hiqlite::backup::BackupConfig` lives in a private module
(`hiqlite-0.13.1/src/lib.rs:62-63` declares `mod backup;`, not
`pub mod backup;`, and there is no `pub use backup::BackupConfig`
re-export anywhere in the crate). Application code therefore cannot
construct or assign a custom `BackupConfig` value on
`NodeConfig.backup_config`. The only ways to populate it from outside
hiqlite are:

1. **`NodeConfig::default()`** — produces a hard-coded default
   `BackupConfig` with `cron_schedule = "0 30 2 * * * *"` (02:30
   daily, 7-field) and `keep_days = 30`. Not customizable.
2. **`NodeConfig::from_env()`** — reads `HQL_BACKUP_CRON`,
   `HQL_BACKUP_KEEP_DAYS`, `HQL_S3_*`, `ENC_KEYS`, `ENC_KEY_ACTIVE`,
   `HQL_NODE_ID`, `HQL_NODES`, `HQL_SECRET_RAFT`, `HQL_SECRET_API`,
   `HQL_DATA_DIR`, `HQL_FILENAME_DB`, `HQL_BACKUP_KEEP_DAYS_LOCAL`,
   and (optionally) `HQL_BACKUP_RESTORE` from the process environment
   and constructs the full `NodeConfig` including a non-default
   `BackupConfig`. All-or-nothing — `NodeConfig::from_env` either
   parses successfully or panics (`expect()` calls inside).

This spec adopts approach 2 — `NodeConfig::from_env()` — with a
deployd-side translation layer to keep the operator-facing
`DEPLOYD_BACKUP_*` env-var prefix intact.

**Translation layer.** `platform/services/deployd-api-rs/src/config.rs`
gains a typed `BackupConfig` struct that reads `DEPLOYD_BACKUP_*`
env vars and exposes an `apply_to_hql_env()` method that translates
to the `HQL_*` prefix Hiqlite expects. `init_db` in `src/store.rs`
calls `BackupConfig::apply_to_hql_env()` (and unconditionally sets
the non-backup `HQL_*` env vars: `HQL_NODE_ID=1`, `HQL_NODES=1
127.0.0.1:7001 127.0.0.1:7002`, `HQL_DATA_DIR=<data_dir arg>`,
`HQL_FILENAME_DB=deployd.db`, plus the existing
`HIQLITE_SECRET_RAFT`/`HIQLITE_SECRET_API` translated to
`HQL_SECRET_RAFT`/`HQL_SECRET_API`) before calling
`NodeConfig::from_env()`.

**ENC_KEYS validation.** Hiqlite's `s3` feature requires `enc_keys`
to be non-empty even when backup itself is not configured (the cron
task runs unconditionally with the `backup` feature on; if no
`s3_config`, it produces local-only backups in
`<data_dir>/state_machine/backups/`). `values-local.yaml` therefore
provides a chart-default dummy `ENC_KEYS` / `ENC_KEY_ACTIVE` to
satisfy validation; production env files override with the
operator-supplied keyring. The runbook in §2.5 documents key
generation.

**`backup_keep_days_local`.** Hiqlite v0.13.1 has a separate
local-snapshot retention field on `NodeConfig` (`backup_keep_days_local:
u16`, default 30). It governs the local copies in
`<data_dir>/state_machine/backups/`. This spec leaves it at the
upstream default; the chart does not project an env var override.
Operators who need a different local-retention can set
`HQL_BACKUP_KEEP_DAYS_LOCAL` directly on the Deployment env.

**Helm wiring — three-provider acknowledgment.**
`platform/charts/deployd-api/templates/deployment.yaml` gains env
entries for the BackupConfig fields. Non-sensitive fields (endpoint,
bucket, prefix, schedule, retention, S3 region, path-style flag)
come from `.Values.backup.*`. Sensitive fields (S3 access key, S3
secret key, cryptr keyring, cryptr active-key id) come via the
chart's existing secret-projection layer, which the operator selects
through `.Values.secrets.provider`:

| `provider` | Projection template | Operator action |
|---|---|---|
| `eso` | `templates/external-secret.yaml` | Add four keys to `secrets.keys` (per-env override or chart default); ESO fetches from upstream secret store. |
| `csi-azure` | `templates/secretproviderclass.yaml` | Add four keys to `secretsMount.objects`; SPC mounts from Azure Key Vault. |
| `k8s` | `templates/secrets-k8s.yaml` (only renders when `secrets.create: true`) — or operator-managed pre-existing Secret when `secrets.create: false` | Operator pre-creates `deployd-api-secrets` with the four keys, OR sets `secrets.data.*` in values for chart-create flow. |

The currently-shipping Hetzner deploy uses `provider: "k8s"` with
`create: false` — operator pre-creates the Secret out-of-band and
adds the four new BackupConfig keys to it manually. The chart's
`envFrom: secretRef: deployd-api-secrets, optional: true`
(`templates/deployment.yaml:59-62`) loads whatever the operator
populated, regardless of provider.

`templates/external-secret.yaml` IS in this spec's `implements:`
list — its template-rendered surface gains a parallel `range` block
for the new backup keys (so ESO operators get them by default).
The new `range` is gated by `{{- if and .Values.backup.endpoint
.Values.backup.bucket }}` for **symmetric opt-in semantics with the
Deployment env block** — when an operator has not enabled backup
(endpoint+bucket unset), the ExternalSecret data block carries only
the pre-existing non-backup entries, mirroring the env-block
suppression. `secretproviderclass.yaml` and `secrets-k8s.yaml` are
NOT in `implements:` (the SPC and k8s-create-true paths use the
existing `.Values.secretsMount.objects` and `.Values.secrets.data`
extension points; no new template surface is required). The runbook
in §2.5 documents the operator-side procedure for all three
providers.

### 2.4 Restore — operator-driven DR mode

**File:** `platform/services/deployd-api-rs/src/main.rs:24-28`,
`src/store.rs:13-33`.

Phase 0 finding F4 (2026-05-10) established that Hiqlite v0.13.1's
restore primitive is **env-driven**. `start_node()` automatically
calls `backup::restore_backup_start(&node_config)` at
`hiqlite-0.13.1/src/start.rs:52`, which reads the `HQL_BACKUP_RESTORE`
env var:

- Format: `s3:<object_key>` (restore from named S3 object) or
  `file:<path>` (restore from local file).
- When set: hiqlite removes the existing data subtree (`path_db`,
  `path_snapshots`, `path_lock_file`, `path_logs` — `backup.rs:344-349`),
  copies the named snapshot into place, and proceeds with normal Raft
  init. `start_node()` returns Ok only after restore completes;
  `restore_backup_finish` (the post-restore raft log purge) is also
  awaited inside `start_node()`.
- When unset: hiqlite proceeds with normal start against whatever is
  in the data dir.

There is no public Hiqlite API for "list S3 snapshots" or "auto-pick
the latest snapshot when data_dir is empty." Application-side
auto-detection of "fresh PVC, restore from latest" is therefore
**not implementable against v0.13.1** without forking hiqlite or
duplicating its S3 code path. Spec §2.4's prior wording (which
described that auto-detection model) is amended.

**Operator-driven DR restore — the only supported flow.** When
`HQL_BACKUP_RESTORE` is set in the pod environment, hiqlite's
restore runs inside `start_node()`. Pod readiness blocks until the
restore completes (because `init_db` blocks on `start_node()`, and
the existing `/healthz` probe blocks on `init_db` returning Ok).

**Activation procedure (runbook owns this):**

1. Operator identifies the snapshot key in S3 (latest by
   `backup_node_<id>_<timestamp>.sqlite` filename — runbook documents
   how to list and sort).
2. Operator sets `HQL_BACKUP_RESTORE=s3:<key>` on the Deployment env
   (e.g. `kubectl set env deployment/deployd-api
   HQL_BACKUP_RESTORE=s3:backup_node_1_1715347200.sqlite`).
3. Pod restarts; hiqlite restores; pod becomes Ready.
4. Operator UNSETS the env var (`kubectl set env
   deployment/deployd-api HQL_BACKUP_RESTORE-`) so subsequent
   restarts do NOT re-restore (each restore wipes the data dir
   first — leaving the var set would re-wipe on every pod restart,
   which is a foot-gun).

**The chart never sets `HQL_BACKUP_RESTORE`.** No `.Values.backup.
restoreFrom` or equivalent — the env var is a deliberate one-shot
operator action. The runbook's restore procedure is the only
documented path.

**Failure mode.** If `HQL_BACKUP_RESTORE` points to a key that
doesn't exist (or fails decryption), `start_node()` returns Err,
`init_db` returns Err, the pod readiness probe never flips Ready,
and the Deployment surfaces the error in pod logs. The service does
not silently start with an empty database — the failure is loud.

**Steady-state — no auto-restore.** When `HQL_BACKUP_RESTORE` is
unset (the chart's default posture, every pod restart), hiqlite
starts against whatever is in the data dir. Pod restarts against a
populated PVC are the steady-state path; the Option B scrub removal
in §2.2 ensures the data subtree survives those restarts.

Pod readiness gating: the existing `/healthz` (or readiness probe)
does not flip to Ready until `init_db` returns successfully —
restore-in-progress is a not-Ready state, and the existing
startupProbe `failureThreshold: 120` (10 minutes total — see
`templates/deployment.yaml:69-74`) gives restore the budget Hiqlite's
cold-start can use.

### 2.5 Operational runbook

**File:** `docs/runbooks/deployd-api-durability.md` (new).

Documents:

- Required S3 prerequisites (bucket creation, IAM/access policy,
  encryption-key generation for `cryptr`, retention policy).
- Required Helm values + Kubernetes Secret keys (operator-side
  inventory).
- DR restore procedure (what an operator runs to force a restore from
  a specific snapshot, troubleshooting, rollback).
- Key-rotation considerations (out of scope for implementation but
  surfaced for ops awareness — see NFR-004).
- How to confirm a backup succeeded (log line / metric / S3 listing).

## 3. Requirements

### 3.1 Functional requirements

- **FR-001** — `platform/charts/deployd-api/values-hetzner.yaml`:
  `persistence.enabled: true`, with explicit `size` and
  `storageClassName` set to values appropriate for the Hetzner block
  storage class. The "stealth stage" rationale comment is removed.
- **FR-002** — Other env values files: `values-azure.yaml`,
  `values-aws.yaml`, `values-gcp.yaml`, `values-do.yaml` inherit the
  chart default `persistence.enabled: true` silently (no per-env
  override); `values-local.yaml` carries an explicit
  `persistence.enabled: false` with a one-sentence inline rationale
  for the dev-loop context (kind / minikube / k3d). Implementation MAY
  add an explicit per-env override on a managed-K8s file if the
  operator's evidence flags a specific cluster's StorageClass need;
  the default posture is silent inheritance.
- **FR-003** — `platform/charts/deployd-api/templates/deployment.yaml:39-43`:
  the data-dir scrub is **eliminated entirely** (Option B per §2.2
  resolution locked 2026-05-10). The container `command`/`args`
  wrapper is removed; the Deployment falls back to the image's
  default entrypoint (`/usr/local/bin/deployd-api`). Validation that
  Hiqlite v0.13.1 first-boot completes without manual intervention
  is deferred to T055 (pod restart against populated PVC); if that
  fails, AMEND back to Option A in a follow-up commit before merge.
- **FR-004** — `platform/services/deployd-api-rs/Cargo.toml:17` enables
  `backup`, `s3`, and `auto-heal` alongside the existing `sqlite`,
  with `default-features = false` retained.
- **FR-005a** (steady-state translation layer) —
  `platform/services/deployd-api-rs/src/config.rs` exposes a typed
  `BackupConfig` struct that reads operator-facing `DEPLOYD_BACKUP_*`
  env vars (S3 endpoint URL, bucket, region, path-style flag, access
  key id, secret access key, cryptr keyring, cryptr active-key id,
  cron schedule string, retention/keep-days — Phase 1 finding F6
  dropped the `path_prefix` field after `~/.cargo/registry/src/.../
  hiqlite-0.13.1/src/s3.rs:45-76` review confirmed
  `S3Config::try_from_env` reads no path-prefix env var and
  `backup-cron` lists from bucket root unconditionally)
  and exposes `apply_to_hql_env()` which writes the equivalent
  `HQL_*` env vars Hiqlite consumes. `BackupConfig::from_env()` returns
  `Ok(None)` when the operator has not opted in (no `DEPLOYD_BACKUP_*`
  vars set) and `Err` on partial config (some set, some missing).
  `init_db` in `src/store.rs` calls `BackupConfig::apply_to_hql_env()`
  (when `Some`) and translates the existing `HIQLITE_SECRET_RAFT` /
  `HIQLITE_SECRET_API` env vars (plus the hardcoded `node_id`,
  `nodes`, `data_dir`, `filename_db`) into their `HQL_*` equivalents,
  then calls `hiqlite::start_node(NodeConfig::from_env())`. This
  preserves the operator-facing `DEPLOYD_*`/`HIQLITE_*` env-var
  contract while routing all hiqlite configuration through the
  upstream-supported `NodeConfig::from_env()` path (the only path
  that produces a non-default `BackupConfig` per Phase 0 finding F4).
- **FR-005b** (DR restore mode, operator-opt-in) — When the operator
  sets `HQL_BACKUP_RESTORE=s3:<object_key>` directly on the
  Deployment env (out-of-band, runbook-driven — the chart never
  projects a value for this), the next pod start triggers Hiqlite's
  internal restore (`start_node()` → `restore_backup_start` →
  `restore_backup` → wipes data subtree, copies snapshot, finishes
  raft init). The application code path is identical to the
  steady-state path: `init_db` calls `start_node()`, which returns
  Ok only after restore completes. The operator UNSETS
  `HQL_BACKUP_RESTORE` after the restore succeeds so subsequent
  restarts do not re-wipe + re-restore.
- **FR-006** — Pod readiness gating. `init_db` calls
  `hiqlite::start_node()` (which blocks on restore when
  `HQL_BACKUP_RESTORE` is set). The pod's `/healthz` readiness probe
  does not flip Ready until `init_db` returns Ok. Restore failure
  (no snapshot at the named key, decryption error, network failure)
  produces an Err return from `start_node()`, the pod stays NotReady,
  and the failure surfaces in pod logs. The service does not
  silently start with an empty database in DR-mode (`HQL_BACKUP_RESTORE`
  set); in steady-state mode (`HQL_BACKUP_RESTORE` unset) the pod
  starts against whatever is in the PVC's data subtree, including an
  empty subtree on a fresh PVC if no operator-driven restore was
  staged.
- **FR-007** — `cargo build --manifest-path platform/services/deployd-api-rs/Cargo.toml`
  produces no new direct dependencies. The lockfile diff is limited
  to feature-flag-driven activations (`cron` enters; `cryptr`,
  `s3-simple` were already present).
- **FR-008** — `docs/runbooks/deployd-api-durability.md` exists and
  covers S3 prerequisites, env/secret inventory, DR restore procedure,
  and key-rotation considerations.

### 3.2 Non-functional requirements

- **NFR-001** — Operator-driven DR restore (per FR-005b — when
  `HQL_BACKUP_RESTORE=s3:<key>` is set on the Deployment env)
  completes within 60 seconds for the steady-state snapshot size
  (today's `deployments` + `deployment_events` corpus) OR fails fast
  with the reason logged. The 60s budget is well within the
  startup-probe `failureThreshold: 120 * periodSeconds: 5 = 10
  minutes` window (`templates/deployment.yaml:67-74`). Steady-state
  snapshot size and the actual measured bound are pinned during T054
  AC-2 validation; if 60s is unattainable for the current corpus,
  the implementation surfaces the measured number and the spec
  amends NFR-001 — but does not extend the startup-probe budget,
  which already covers the worst-case Hiqlite cold-start.
- **NFR-002** — Backup cron schedule and retention policy are
  operator-configurable via Helm values (with secret material via
  Kubernetes Secret). Hard-coded schedules are forbidden — the
  operator owns the cadence/retention contract for their environment.
  Chart-level defaults: `schedule: "0 0 */6 * * *"` (every 6 hours;
  6-field cron, sec=0 min=0 hour=*/6 day=* month=* weekday=* — the
  format Hiqlite's `cron::Schedule::from_str` parser requires;
  amended 2026-05-10 from the original 5-field `"0 */6 * * *"`
  per Phase 0 finding F3), `keep: 28` (28 days of snapshots retained
  at the S3 layer via `BackupConfig.keep_days`). These match the
  governance-audit RPO target (≤ 6 hours) and provide a ~one-month
  rolling window for DR rollback. The chart projects these values as
  `HQL_BACKUP_CRON` and `HQL_BACKUP_KEEP_DAYS` — operators override
  per-env in their values file. Hiqlite's local-backup retention
  (`HQL_BACKUP_KEEP_DAYS_LOCAL`, default 30) is held at the upstream
  default by this spec; operators who want a different local retention
  can override on the Deployment env directly.
- **NFR-003** — S3 credentials (access key, secret key) and the
  `cryptr` keyring (key id + 32-byte material) come from a Kubernetes
  Secret loaded via the chart's secret-projection layer. The chart
  supports three providers (selected via `.Values.secrets.provider`):
  `eso` projects via `templates/external-secret.yaml`; `csi-azure`
  projects via `templates/secretproviderclass.yaml`; `k8s` (Hetzner's
  current posture) loads from an operator-managed pre-existing
  Secret. Sensitive values are never present in `values.yaml`, never
  baked into the container image, and never logged. The runbook in
  §2.5 documents the per-provider operator procedure.
- **NFR-004** — The `cryptr` encryption keyring is a **long-lived,
  operator-controlled** value stored in the operator's Azure Key
  Vault entry (or equivalent operator-controlled secret store) —
  **not** generated per-cluster at install time. This is the only
  posture compatible with cross-cluster DR: snapshots survive
  cluster rebuilds and remain decryptable under the operator's
  retained keyring. Per-cluster generation would mean a cluster
  rebuild loses decryption capability for snapshots taken under the
  prior keyring, which defeats the off-cluster encrypted-backup
  contract.

  **Cryptr keyring shape (Phase 0 finding F4 detail).** The
  upstream `cryptr 0.10.0` `EncKeys` type is a *keyring*, not a
  single key. It exposes two env vars:
  - `ENC_KEYS` — a multi-line string of `<id>/<base64-encoded-32-bytes>`
    entries (one per line, IDs match `^[a-zA-Z0-9:_-]{2,20}$`).
  - `ENC_KEY_ACTIVE` — the id of the currently-active key (must
    appear in `ENC_KEYS`).

  This shape supports gentle key rotation: add a new key id to
  `ENC_KEYS`, flip `ENC_KEY_ACTIVE` to the new id, take a snapshot
  under the new key, retain old keys in `ENC_KEYS` until all
  snapshots encrypted under them have aged out of retention. Key
  rotation IS implementable in operator workflow — it is not "out
  of scope" in the way the prior wording implied. **Implementation**
  of an automated rotation tool remains out of scope for this spec;
  the runbook documents the manual operator procedure.

- **NFR-005** — Pod restart against an existing populated PVC, with
  the Option B scrub removal from FR-003 (per §2.2 resolution),
  completes in the same time class as the pre-spec startup (no new
  latency on the steady-state pod restart path).

### 3.3 Acceptance criteria

- **AC-1** — Hetzner deploy survives pod eviction (`kubectl delete
  pod -n <ns> deployd-api-...`) without losing rows from
  `deployments` or `deployment_events`. Validation: pre-eviction
  query, post-eviction same query, identical rowsets.
- **AC-2** — A fresh pod started against a freshly-provisioned
  (empty) PVC, with operator-supplied `HQL_BACKUP_RESTORE=s3:<key>`
  env var (per FR-005b runbook procedure), rehydrates from the named
  S3 snapshot before becoming Ready. Validation: drop the PVC, set
  `HQL_BACKUP_RESTORE` (e.g. `kubectl set env deployment/deployd-api
  HQL_BACKUP_RESTORE=s3:<latest>`), force pod restart, watch the
  readiness probe — pod Ready only after the
  `restore_backup_finish task successful` log line; query
  `deployments` / `deployment_events` and confirm rowset matches the
  pre-restart snapshot. After verification, operator UNSETS
  `HQL_BACKUP_RESTORE` (`kubectl set env deployment/deployd-api
  HQL_BACKUP_RESTORE-`) so subsequent pod restarts do not re-wipe
  the data dir.
- **AC-3** — Backup cron emits snapshots in S3 at the configured
  cadence; snapshots are encrypted at rest under the operator-supplied
  `cryptr` key and decryptable on a fresh pod (validated by AC-2).
- **AC-4** — The container-start data-dir scrub no longer deletes
  rows from `deployments` or `deployment_events` across pod restarts.
  Validation: pod restart against a populated PVC, query both tables,
  confirm rowsets unchanged.
- **AC-5** — `cargo build / check / clippy / test --manifest-path
  platform/services/deployd-api-rs/Cargo.toml` is green; no new
  direct deps; lockfile diff is feature-flag-driven only.
- **AC-6** — `helm template platform/charts/deployd-api -f
  values-hetzner.yaml` renders without error and the rendered
  Deployment carries the post-FR-003 startup args, the env entries
  for BackupConfig (sensitive ones from secretRef), and the PVC
  mount.
- **AC-7** — `docs/runbooks/deployd-api-durability.md` is reviewed
  by the operator on duty and confirms it is sufficient for first-time
  S3 setup, day-2 monitoring, and DR restore.
- **AC-8** — Spec-code coupling gate accepts the change against
  this spec's `implements:` list with no warnings. The coupling
  surface is intentionally cross-layer (chart + service + runbook);
  spec 130's primary-owner heuristic places primary ownership on
  spec 145 since this is the spec that motivates the coupled change.
- **AC-9** — `make ci` (warm) is green.

## 4. Out of scope

- **Multi-replica deployd-api.** `store.rs:15` keeps `node_id: 1`
  and the single-replica posture. Hiqlite `dlock` for write
  coordination across replicas is a future spec (audit Phase 5
  "future-spec" cluster, open question 1).
- **`listen_notify` SSE wiring** to stream deploy events into
  statecraft's audit_log table. Future spec; not motivated by any
  current failure (today's statecraft path polls `/v1/deployments/.../status`).
- **axiomregent durability.** Hiqlite-level S3 backup at axiomregent
  was rejected by the audit (durable copy lives in statecraft
  Postgres). The "axiomregent offline audit buffering" question
  (audit open question 2) is its own future spec.
- **orchestrator changes.** Spec 144 covers manifest hygiene there.
  The orchestrator distributed-mode backup posture is academic per
  `verifications.md` Q2 (the build path is dead-on-disk).
- **Deployd-api-rs spec-pin hygiene.**
  `platform/services/deployd-api-rs/Cargo.toml:31` declaring
  `package.metadata.oap.spec = "073-axiomregent-unification"` is a
  separate hygiene pass (audit open question 3) — not this spec.
- **Key rotation implementation.** The runbook surfaces the
  operator-side constraint; a feature-level rotation path is not
  delivered here.
- **Multi-cloud env directory instantiation.** Spec 072
  (`multi-cloud-k8s-portability`) owns environment instantiation for
  AWS / GCP / DO. This spec audits those env files for persistence
  consistency but does not stand up new env directories.
- **`cron` schedule format / library swap.** Hiqlite's upstream cron
  semantics define the schedule string; this spec does not introduce
  a custom scheduler.

## 5. Provenance

- **`audit.md` Phase 2.3** — deployd-api-rs feature analysis;
  load-bearing case for `backup` + `s3` enablement.
- **`audit.md` Phase 4** — "OVERSIGHT" verdict on deployd-api-rs
  durability; classifies `deployments` and `deployment_events` as
  governance-load-bearing.
- **`audit.md` Phase 5** — original "S effort" recommendation row.
- **`verifications.md` Q1** — PVC posture investigation. PVC template
  exists; `values-hetzner.yaml` overrides the chart default to
  `false`; container start-up command runs `rm -rf
  /var/lib/deployd/data/*` on every boot (commit `3aa8893a` widened
  the earlier targeted lock cleanup from commit `cd84f1e9`).
- **`verifications.md` Implications table** — the four-step
  coupling rationale: chart persistence + scrub narrowing + S3
  enablement + restore-on-startup land together or land a half-fix.
- **`verifications.md` Next actions §2** — promotes the audit's
  "S effort" recommendation to **M**, and from "an audit
  recommendation" to "its own spec".
- **Chart anchors:**
  `platform/charts/deployd-api/templates/pvc.yaml:1-15`,
  `templates/deployment.yaml:39-43`, `:99-100`, `:115-121`.
- **Values anchors:**
  `platform/charts/deployd-api/values-hetzner.yaml:34-38`,
  `platform/charts/deployd-api/values.yaml:22-25`.
- **Service anchors:**
  `platform/services/deployd-api-rs/src/store.rs:13-33`, `:35-77`,
  `src/main.rs:24-28`.
- **Cargo anchors:**
  `platform/services/deployd-api-rs/Cargo.toml:17`,
  `Cargo.lock` (hiqlite deps block; `cryptr` + `s3-simple`
  already present).
- **CONST-005 framing.** This spec adds a new contract; it does not
  edit prior specs to retroactively justify a code change. Spec 145
  is authored before any chart, Cargo, or service-code edit lands.
  Phase 0 amendments to §2.1, §2.2, §2.3, §2.4, §3.1 FR-005a/b, §3.2
  NFR-001/002/003/004, §3.3 AC-2, and §6 (this amendment pass,
  2026-05-10) refine the spec's *own* design in light of upstream
  API constraints (Hiqlite v0.13.1 restore semantics, BackupConfig
  visibility, cryptr keyring shape) and operator-side reality
  (Hetzner CSI minimum, k8s-provider posture). They tighten the
  spec's contract before any implementation work lands — a
  legitimate amendment, not retroactive justification of a code
  change.
- **Phase 0 verification anchors (2026-05-10).**
  - T001b coupling-gate dry-run: `OK — 16 diff path(s) checked` (no
    conflicts with specs 086 / 073 / 072).
  - T002 hcloud CSI minimum: `kubectl get pvc -A` on
    `oap-hetzner-master1` showed all four existing PVCs at
    `hcloud-volumes` allocated 10 GiB or larger.
  - T007/T008 Hiqlite v0.13.1 source review: `~/.cargo/registry/src/
    index.crates.io-1949cf8c6b5b557f/hiqlite-0.13.1/src/{lib,backup,
    config,start,s3}.rs`. Key findings: `mod backup;` is private (no
    `pub` re-export); `start_node()` auto-calls `restore_backup_start`
    + `start_cron`; restore is env-driven via `HQL_BACKUP_RESTORE`.

## 6. Decision log + open questions

All operator decisions are now resolved. The two implementation-time
items previously listed as "still open" (Q2 scrub option, Q6 restore
API) were resolved during Phase 0 (2026-05-10) with the spec
amendments captured here. Q7 (BackupConfig accessibility) and Q8
(secret-projection mechanism) emerged during Phase 0 and are also
folded in.

### Resolved 2026-05-10 (initial — operator decisions, pre-implementation)

1. **Hetzner storage class.** `storageClassName: hcloud-volumes`.
   Pinning the class explicitly prevents silent re-binding if cluster
   StorageClass priorities are reordered. (See §2.1.)
3. **Backup cron schedule + retention defaults.** `schedule: "0 0
   */6 * * *"` (6-field cron — see Q3 amendment below), `keep: 28`.
   Chart-level default in `values.yaml`; operator-configurable per
   NFR-002. (See §3.2 NFR-002.)
4. **`cryptr` key provisioning.** Long-lived operator-controlled
   keyring in Azure Key Vault (or equivalent). NOT per-cluster
   generation — that posture would lose decryption capability across
   cluster rebuilds and defeat the off-cluster backup contract.
   (See §3.2 NFR-004.)
5. **Other env files' persistence posture.** `values-azure.yaml`,
   `values-aws.yaml`, `values-gcp.yaml`, `values-do.yaml` inherit
   the chart default silently. `values-local.yaml` opts out
   explicitly with `persistence.enabled: false` and a one-sentence
   inline rationale for the dev-loop context. (See §2.1 + §3.1
   FR-002.)

### Resolved 2026-05-10 (Phase 0 — implementation-time, this amendment pass)

1a. **Hetzner storage SIZE — amended from 1 GiB to 10 GiB.** T002
    verification on the live `oap-hetzner-master1` cluster confirmed
    the hcloud CSI provisioner enforces a 10 GiB minimum (all four
    existing PVCs allocated through `hcloud-volumes` are 10 GiB or
    larger). `values-hetzner.yaml` pins `size: 10Gi`. (See §2.1.)

1b. **Values key — amended from `storageClassName` to `storageClass`.**
    Phase 0 finding F1 (2026-05-10): the chart's existing convention
    (`values.yaml`, `templates/pvc.yaml`) uses `storageClass` as the
    values key (rendered K8s field stays `storageClassName:`). Spec
    §2.1 example block + T030 amended to match. (See §2.1.)

2. **Scrub Option A vs Option B — locked Option B.** Implementation
   drops the wrapper shell entirely; falls back to image's default
   entrypoint. Validation deferred to T055 (pod restart against
   populated PVC); if T055 reveals stale-lock contamination on
   Hiqlite v0.13.1, AMEND back to Option A in a follow-up commit
   before merge. (See §2.2.)

3a. **Cron format — amended from 5-field to 6-field.** Phase 0
    finding F3 (2026-05-10): Hiqlite parses cron strings via
    `cron::Schedule::from_str`, which requires 6 or 7 fields (with
    seconds). The original 5-field default `"0 */6 * * *"` would be
    rejected. Amended to 6-field `"0 0 */6 * * *"` (sec=0 min=0
    hour=*/6 day=* month=* weekday=*). Same semantic. (See §3.2
    NFR-002.)

6. **Hiqlite restore API — amended.** Phase 0 finding F4 (2026-05-10):
   v0.13.1's restore is env-driven (`HQL_BACKUP_RESTORE=s3:<key>`)
   and runs inside `start_node()`. There is no public Hiqlite API
   for "list S3 snapshots" or "auto-pick latest snapshot when
   data_dir is empty" — application-side auto-rehydration is not
   implementable against v0.13.1. The spec adopts an
   operator-driven restore model (see §2.4 + FR-005b + AC-2). The
   chart never sets `HQL_BACKUP_RESTORE`; the runbook owns
   activation.

7. **BackupConfig accessibility (new question, resolved).** Phase 0
   finding F4 (2026-05-10): `hiqlite::backup::BackupConfig` is in a
   private module — application code cannot construct a custom
   value. Implementation routes all hiqlite config through
   `NodeConfig::from_env()` with a deployd-side translation layer
   (`DEPLOYD_BACKUP_*` → `HQL_*`) in `src/config.rs`. Operator-facing
   env-var prefix is preserved. (See §2.3, §2.4, FR-005a.)

8. **Secret-projection mechanism (new question, resolved).** Phase 0
   finding F2 (2026-05-10): the chart supports three providers
   (`eso` / `csi-azure` / `k8s`); the actively-shipping Hetzner
   deploy uses `provider: "k8s"` with `create: false` (operator-
   managed pre-existing Secret). Spec §2.3's prior wording
   ("MUST be sourced via external-secret.yaml") was provider-
   specific; amended to acknowledge all three. `external-secret.yaml`
   IS in `implements:` (gains a parallel `range` block for the new
   backup keys); `secretproviderclass.yaml` and `secrets-k8s.yaml`
   are NOT in `implements:` (existing extension points cover them);
   the runbook documents the per-provider operator procedure.


## Security hardening amendment (2026-07-02)

Provisioned the hiqlite raft and API secrets through the chart (values keys, secret template, and env wiring) so the deployd-api service can require them at startup instead of falling back to known default credentials.

Recorded during the cross-subsystem security-hardening sweep; couples the security fixes in the code paths this spec authors to their owning spec per the spec 127 coupling gate.
