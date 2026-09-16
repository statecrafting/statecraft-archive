# deployd-api durability runbook

> **Audience:** operators running the `platform/charts/deployd-api` Helm
> chart against an S3-compatible object store. This runbook is the
> operational contract for spec
> [`145-deployd-durability`](../../specs/145-deployd-durability/spec.md);
> reading the spec is optional once you've read this. If you find
> yourself reaching for the spec to fill an operational gap, the
> runbook owes more — file an issue.
>
> **Scope.** First-time backup enable, cryptr keyring format, DR
> restore, key rotation, day-2 verification. Hiqlite-internal
> behaviour, the env-translation layer, and the spec-vs-code coupling
> are documented in the spec itself.

---

## 1. Enabling backup on an existing deploy

Backup is **opt-in**. With backup disabled (chart default), deployd-api
runs against the PVC's data-dir with a local-only cron task; no
off-cluster traffic. To enable encrypted S3 snapshots, the operator
must satisfy three preconditions in this order:

1. **S3 bucket exists** — operator-provisioned at the configured
   endpoint, region, and credentials.
2. **Cryptr keyring populated** — at least one `<id>/<base64-32-bytes>`
   pair in the operator-managed secret store (see §2 for format and
   generation).
3. **`backup.endpoint` + `backup.bucket` set in chart values** — the
   gate that lights up env-projection on the Deployment AND
   secret-projection on the ExternalSecret (when ESO).

Below: per-provider happy paths. Pick the one your cluster uses
(determined by `secrets.provider` in your env-specific values file —
`eso`, `csi-azure`, or `k8s`).

### 1.1 ESO (`secrets.provider: "eso"`) — Azure, AWS, GCP, DO managed-K8s

The chart's `ExternalSecret` resource projects four backup keys from
your upstream secret store via the External Secrets Operator. The four
remote-key names default to `deployd-backup-s3-access-key`,
`deployd-backup-s3-secret-key`, `deployd-backup-cryptr-keyring`,
`deployd-backup-cryptr-active-key`; per-env overrides via
`.Values.backup.secretKeys[].remoteKey` if your store uses different
names.

**Step 1 — Populate the upstream vault.**

Azure Key Vault example (CLI):

```bash
# S3 credentials from your object-store provider's IAM
az keyvault secret set --vault-name <vault> --name deployd-backup-s3-access-key --value "$ACCESS_KEY"
az keyvault secret set --vault-name <vault> --name deployd-backup-s3-secret-key --value "$SECRET_KEY"

# Cryptr keyring — generate per §2 first, then upload the file's contents as the value
az keyvault secret set --vault-name <vault> --name deployd-backup-cryptr-keyring --file /tmp/keyring
az keyvault secret set --vault-name <vault> --name deployd-backup-cryptr-active-key --value "k1"
```

AWS Secrets Manager / GCP Secret Manager / DO equivalents follow the
same shape: four secrets under the names above.

**Step 2 — Set backup config in your env's values file.**

```yaml
# values-azure.yaml (or values-aws.yaml, etc.)
backup:
  endpoint: "https://<your-s3-host>"
  bucket: "deployd-prod-backups"
  region: "us-east-1"
  # pathStyle: true        # default; override only if your provider requires virtual-host style
  # schedule: "0 0 */6 * * *"  # NFR-002 default; override for different cadence
  # keep: 28               # NFR-002 default; override for different retention
```

**Step 2.5 — Verify or force ESO sync BEFORE applying.**

The chart's `ExternalSecret` has `refreshInterval: 1h`. After Step 3's
`helm upgrade` adds the new `env:` entries to the Deployment, the
rolled pod expects the four backup keys to already exist in the
projected `deployd-api-secrets` Kubernetes Secret. If ESO hasn't
re-synced since you populated the vault in Step 1, the pod hits
`CreateContainerConfigError: couldn't find key backup-s3-access-key
in secret deployd-api-secrets` and is stuck — up to 60 minutes
until the next sync.

Either verify projection has already happened:

```bash
kubectl get secret -n <ns> deployd-api-secrets \
  -o jsonpath='{.data}' | jq 'keys[]' | grep backup-
# Expected output (4 lines):
# "backup-s3-access-key"
# "backup-s3-secret-key"
# "backup-cryptr-keyring"
# "backup-cryptr-active-key"
```

Or force an immediate ESO sync (no need to wait for `refreshInterval`):

```bash
kubectl annotate externalsecret -n <ns> deployd-api-secrets \
  force-sync=$(date +%s) --overwrite
# Re-run the kubectl get secret check above to confirm.
```

Only proceed to Step 3 once all four backup keys are present in the
projected Secret.

**Step 3 — Apply.**

```bash
helm upgrade --install deployd-api platform/charts/deployd-api \
  -n <ns> -f platform/charts/deployd-api/values-<env>.yaml
```

Pod restarts pick up `DEPLOYD_BACKUP_*` env vars; deployd-api
translates them to `HQL_*` for hiqlite; the cron task starts emitting
to S3 per the schedule.

**Verification:** §5 below.

### 1.2 CSI-Azure (`secrets.provider: "csi-azure"`)

The chart's `SecretProviderClass` resource mounts secrets from Azure
Key Vault via the CSI Secret Store driver. You extend
`.Values.secretsMount.objects` with the four backup keys.

**Step 1 — Same as §1.1 Step 1**: populate the four Key Vault secrets.
Unlike ESO, CSI-Azure projects on pod start; no pre-apply sync
verification (§1.1 Step 2.5) is needed here.

**Step 2 — Set backup config + extend SPC objects in your env values.**

The vault-side names (`deployd-backup-*`) differ from the chart-side
Secret keys the Deployment's `valueFrom: secretKeyRef.key` references
(`backup-*`). The chart's `SecretProviderClass` template projects each
object under its `objectAlias` if set, otherwise under its
`objectName`. **You MUST set `objectAlias` for each of the four
backup objects** — the rebadging is the operator's responsibility,
not the chart's.

```yaml
backup:
  endpoint: "https://<your-s3-host>"
  bucket: "deployd-prod-backups"
  region: "us-east-1"

secretsMount:
  enabled: true
  objects:
    - objectName: deployd-backup-s3-access-key
      objectType: secret
      objectAlias: backup-s3-access-key
    - objectName: deployd-backup-s3-secret-key
      objectType: secret
      objectAlias: backup-s3-secret-key
    - objectName: deployd-backup-cryptr-keyring
      objectType: secret
      objectAlias: backup-cryptr-keyring
    - objectName: deployd-backup-cryptr-active-key
      objectType: secret
      objectAlias: backup-cryptr-active-key
```

The CSI driver mounts each vault secret at the aliased path inside the
pod's `secrets-store` volume; the SPC's K8s-secret-sync (driven by
`secretObjects:` if configured, or by the CSI driver's default
sidecar) writes them into the `deployd-api-secrets` Secret under the
aliased names. The Deployment's `envFrom: secretRef` loads them, and
the four explicit `valueFrom: secretKeyRef.key` env entries find the
keys under their aliased names.

**Step 3 — Apply** (same `helm upgrade` as §1.1 Step 3).

### 1.3 k8s pre-existing Secret (`secrets.provider: "k8s"`, `secrets.create: false`) — Hetzner

The chart does NOT manage the Secret. Operator pre-creates and
maintains `deployd-api-secrets` out-of-band, then sets backup config
in values.

**Step 1 — Add the four backup keys to the existing Secret.**

The cryptr keyring's value is **multi-line** (one
`<id>/<base64-32-bytes>` per line); the other three values are
single-line strings. Two flows below — pick by whether the Secret
already exists.

**Flow A — Edit-in-place (the existing Secret keeps any non-backup
keys — e.g., `DEPLOYD_DB_URL` — already populated).**

Generate the keyring per §2 first → `/tmp/keyring` (one `<id>/<key>`
per line). Then, on a secured workstation:

1. Compute each base64-encoded value separately at the shell:
   ```bash
   echo -n "$AKI" | base64                  # → paste into .data.backup-s3-access-key
   echo -n "$AKS" | base64                  # → paste into .data.backup-s3-secret-key
   base64 < /tmp/keyring | tr -d '\n'       # → paste into .data.backup-cryptr-keyring
   echo -n "k1" | base64                    # → paste into .data.backup-cryptr-active-key
   ```
2. Dump the current Secret to a file you can edit:
   ```bash
   kubectl get secret -n <ns> deployd-api-secrets -o yaml > /tmp/secret.yaml
   ```
3. In `/tmp/secret.yaml`, **strip these server-managed metadata
   fields** before re-applying — `kubectl apply -f` rejects or
   misbehaves on round-tripped versions of them:
   - `metadata.resourceVersion`
   - `metadata.uid`
   - `metadata.creationTimestamp`
   - `metadata.managedFields` (the whole list block)
4. Under `data:`, add the four new entries as string literals — paste
   each base64 value from step 1 as the YAML value (do not paste the
   shell `$(...)` substitution literally):
   ```yaml
   data:
     # ... existing keys preserved ...
     backup-s3-access-key: <paste base64 from step 1>
     backup-s3-secret-key: <paste base64 from step 1>
     backup-cryptr-keyring: <paste base64 from step 1>
     backup-cryptr-active-key: <paste base64 from step 1>
   ```
5. Apply and destroy the plaintext-bearing temp files:
   ```bash
   kubectl apply -f /tmp/secret.yaml
   shred -u /tmp/secret.yaml /tmp/keyring
   ```

**Flow B — Recreate in one shot (destroys any existing keys; only
safe on first-time setup).**

```bash
kubectl create secret generic deployd-api-secrets -n <ns> \
  --from-literal=DEPLOYD_DB_URL="$DBURL" \
  --from-literal=backup-s3-access-key="$AKI" \
  --from-literal=backup-s3-secret-key="$AKS" \
  --from-file=backup-cryptr-keyring=/tmp/keyring \
  --from-literal=backup-cryptr-active-key="k1"
```

`--from-file` is the cleanest path for the multi-line keyring. As an
alternative, `--from-literal` with bash `$'...\n...'` escape syntax
also works (the `...` inside each key body below is a placeholder for
the real 32-byte base64 key — do not paste literally):

```bash
kubectl create secret generic deployd-api-secrets -n <ns> \
  --from-literal=backup-cryptr-keyring=$'k1/AAAA...AAA=\nk2/BBBB...BBB=' \
  ...
```

Either form produces the same Secret. Pick whichever your operator
tooling supports.

**Step 2 — Set backup config in your env's values file** (same as
§1.1 Step 2 — just `endpoint`, `bucket`, `region` at minimum).

**Step 3 — Apply** (same `helm upgrade`).

---

## 2. Cryptr keyring format

The cryptr encryption layer (used by hiqlite for S3-bound snapshots)
is a **keyring**, not a single key. This is the load-bearing design
that makes key rotation possible without breaking historical-snapshot
decryption (see §4).

### 2.1 Format

Two values, both consumed via env vars:

- **`ENC_KEYS`** — multi-line string. Each non-empty line is a single
  key entry: `<id>/<base64-32-bytes>`. Blank lines and lines without
  `/` are ignored.
- **`ENC_KEY_ACTIVE`** — single id, must match exactly one of the ids
  in `ENC_KEYS`. The active key is the one used to encrypt new
  snapshots; all keys in `ENC_KEYS` are available for decryption.

The id must match `^[a-zA-Z0-9:_-]{2,20}$`. Use short stable ids
(`k1`, `k2`, `prod-2026q2`).

The 32-byte key is **base64-standard-encoded** (with `=` padding).
A raw 32-byte key produces a 44-character base64 string.

### 2.2 Generation

```bash
# Single key
echo "k1/$(openssl rand 32 | base64)" > /tmp/keyring
cat /tmp/keyring
# k1/<44 chars including = padding>

# Multi-key (for rotation prep — see §4)
echo "k1/$(openssl rand 32 | base64)" > /tmp/keyring
echo "k2/$(openssl rand 32 | base64)" >> /tmp/keyring
```

### 2.3 ⚠️ Losing the keyring = unrecoverable backups

**Read this carefully.** S3 snapshots are encrypted under the active
key at write time. To decrypt, the consumer must have the same key id
+ key bytes available. If the operator-controlled secret store loses
the keyring (vault rebuild without backup, accidental deletion,
forgotten rotation), every snapshot encrypted under the lost keys
becomes unrecoverable — the snapshots are in S3 but cannot be turned
back into a working hiqlite database.

**This is by design.** The encryption is what makes the off-cluster
backup contract trustworthy (an S3 leak is not a data leak). The
trade-off is operator responsibility for keyring durability.

**Mitigation checklist:**

- Generate the keyring on a secured workstation; never on a pod.
- Store the keyring in the operator's primary secret store (Key Vault
  / Secrets Manager / equivalent) AND in at least one offline secure
  location (a sealed envelope in a safe, a paper print in a safety
  deposit box — this is genuinely the right pattern for a long-lived
  cryptr keyring).
- The keyring is long-lived. Per spec [`145-deployd-durability`
  §3.2 NFR-004](../../specs/145-deployd-durability/spec.md), per-cluster
  generation is rejected — the keyring survives cluster rebuilds and
  is shared across DR-target environments.
- Rotation (see §4) does NOT remove old keys. The retention window
  for an old key is `BackupConfig.keep_days` (default 28). Keep the
  old key in `ENC_KEYS` for at least that long after rotation, or
  until manual S3 cleanup of pre-rotation snapshots.

---

## 3. DR restore procedure

> ⚠️ **Foot-gun warning — read before you start.** `HQL_BACKUP_RESTORE`
> is a **one-shot** env var. When set, hiqlite WIPES the pod's data
> dir (`/var/lib/deployd/data/state_machine/db`, `/snapshots`,
> `/logs`, `/lock_file`) before copying the named S3 snapshot in.
> Leaving the env var set after a successful restore means every
> subsequent pod restart re-wipes + re-restores from the same key —
> any deploy events the running pod added between restarts are
> destroyed. **UNSET the env var as soon as the restored pod is
> Ready. See the redundant final step in §3.4.**

### 3.1 When to use this

Three scenarios where restore-on-startup is the right tool:

- **Voluntary PVC replacement** — sizing change, storage-class
  migration, planned cluster rebuild.
- **Disaster recovery after data-dir loss** — node failure that
  destroyed the PVC's contents, accidental `kubectl delete pvc`,
  cluster-wide event.
- **Cross-cluster migration** — stand up a fresh deployd-api in a new
  cluster (e.g., region failover), point it at the same S3 bucket +
  keyring, restore the most recent snapshot.

For routine pod restarts (image bump, config change, node drain), do
NOT use this procedure. The PVC's data-dir is durable across pod
restarts on its own (the wrapper-shell `rm -rf` from prior versions
of the chart is gone as of spec 145 §2.2).

### 3.2 Pick a snapshot

Snapshots live in S3 at `<bucket>[/<prefix>]` (no path-prefix support
in hiqlite v0.13.1; the bucket root is the listing surface). Filename
format: `backup_node_1_<unix-timestamp>.sqlite`.

Newest snapshot via `aws-cli` (works against any S3-compatible
endpoint with `--endpoint-url`):

```bash
aws s3 ls "s3://$BUCKET/" \
  --endpoint-url "$ENDPOINT" \
  --profile <profile> \
  | grep backup_node_ | sort | tail -1
# 2026-05-10 14:00:00   1048576 backup_node_1_1715347200.sqlite
LATEST="backup_node_1_1715347200.sqlite"
```

Or with `mc` (MinIO client):

```bash
mc ls --recursive <alias>/<bucket> | grep backup_node_ | sort | tail -1
```

### 3.3 Trigger the restore

> **Pre-flight: if your DR scenario deleted the PVC, recreate it first.**
> §3.1's "accidental `kubectl delete pvc`" and "cross-cluster migration"
> paths leave the cluster with no PVC for the new pod to attach. K8s
> does NOT auto-recreate PVCs that pods reference — the new pod will
> sit `Pending` indefinitely with `FailedScheduling: persistentvolumeclaim
> "deployd-api-data" not found`. Run `helm upgrade deployd-api
> platform/charts/deployd-api -n <ns> --reuse-values` (or
> `kubectl apply -f` the PVC manifest) BEFORE the env-set step below so
> the PVC is re-provisioned. The voluntary-PVC-replacement path (§3.1
> first bullet) typically handles this for you because the new PVC is
> already defined in the chart for the new size/class.

```bash
# Set the env var on the existing Deployment — Recreate strategy will
# terminate the current pod and start a new one with the new env.
kubectl set env deployment/deployd-api -n <ns> \
  HQL_BACKUP_RESTORE="s3:$LATEST"

# Watch the new pod come up.
kubectl get pod -n <ns> -l app=deployd-api -w
# Expected: old pod Terminating, new pod ContainerCreating → Running → Ready
# (Ready transition takes ~30s–60s for the steady-state corpus per NFR-001).
```

In the new pod's logs, you'll see this sequence in order:

```
WARN  HQL_BACKUP_RESTORE is set — hiqlite will WIPE the data dir and restore from this snapshot. ...
INFO  initialising hiqlite store data_dir=/var/lib/deployd/data
INFO  backup configured — S3 snapshots enabled bucket=deployd-prod-backups ...
INFO  Found backup restore request S3("backup_node_1_1715347200.sqlite")
INFO  Starting database restore from backup S3(...)
INFO  Given backup check ok - copying into its final place: ... -> .../deployd.db
INFO  restore_backup_finish task successful
INFO  hiqlite store ready
```

The pod's readiness probe will flip to Ready only after `hiqlite store
ready`. If anything fails (snapshot key not found, decryption error,
S3 timeout), the pod stays NotReady and the failing step shows in the
logs — fix and retry.

**Failure mode — `using dev-fallback ENC_KEYS` in the new pod's logs.**
If the `backup configured — S3 snapshots enabled ...` line is replaced
by `backup not configured (no DEPLOYD_BACKUP_* env vars); using
dev-fallback ENC_KEYS ...`, your backup config never loaded — likely
missing `backup.endpoint` / `backup.bucket` in values, or the four
backup env vars didn't project (most often because the projected
Secret on this cluster doesn't have the four `backup-*` keys yet —
see §1.1 Step 2.5 for ESO, or re-check the Secret population per
§1.2 / §1.3). Fix and retry; **restore cannot decrypt the snapshot
without the operator's cryptr keyring loaded into the pod's
`ENC_KEYS` env var** — the dev-fallback keyring is a syntactic
satisfier for hiqlite's s3-feature validation, not a real decryption
key. This reinforces the keyring-as-durable-identity property in §2.3.

### 3.4 ⚠️ UNSET the env var

**This step is non-negotiable.** Run it as soon as the restored pod
is Ready and you've sanity-checked the data:

```bash
kubectl set env deployment/deployd-api -n <ns> HQL_BACKUP_RESTORE-
# the trailing - removes the env var.

# Confirm at the Deployment-spec level:
kubectl get deployment deployd-api -n <ns> -o yaml | grep -A1 HQL_BACKUP_RESTORE || echo "(absent from Deployment spec — good)"

# STRONGER CHECK — confirm on the running pod's process env. The
# Deployment spec can be clean while a previous pod (somehow) survived
# with the old env, or the rollout hasn't picked up yet. Verify against
# /proc/1/environ on the actual serving pod:
POD=$(kubectl get pod -n <ns> -l app=deployd-api -o jsonpath='{.items[0].metadata.name}')
kubectl exec -n <ns> "$POD" -- sh -c \
  'tr "\0" "\n" </proc/1/environ | grep -E "^HQL_BACKUP_RESTORE=" \
   || echo "(/proc/1/environ has no HQL_BACKUP_RESTORE — verified)"'
```

The Deployment will roll the pod again (because `env:` changed); the
new pod starts WITHOUT the restore env var, so it just runs the
existing data dir. From this point on, normal pod restarts are
steady-state — no wipe.

**Why this step earns the redundant callout (§3 intro AND here):**
forgetting to unset means the next time anything restarts the pod
(node drain, autoscaler, helm upgrade), the data dir gets wiped and
restored from the same — now stale — snapshot. Any deploy events
recorded between restore and restart are lost. This has happened to
peer projects with similar restore-via-env patterns; treat the unset
as part of the restore procedure, not a follow-up.

---

## 4. Key rotation

The cryptr keyring supports **gentle rotation**: add a new key,
flip the active key, retain the old key for the retention window. No
downtime, no batch re-encryption.

### 4.1 Procedure

```bash
# Step 1 — Generate a new key.
NEW_KEY=$(openssl rand 32 | base64)
NEW_ID="k$(date +%Y%m)"   # or whatever id scheme; must match ^[a-zA-Z0-9:_-]{2,20}$

# Step 2 — Append to the keyring (in your operator-controlled secret
# store; the procedure varies by provider).
#
# For AKV / SM / GCP-SM: download current keyring, append, re-upload.
# For Hetzner k8s-pre-existing Secret: kubectl edit the multi-line value.
#
# After this step, the keyring contains BOTH keys; ENC_KEY_ACTIVE
# still points at the OLD id. Snapshots continue to be encrypted under
# the old key; old snapshots still decrypt because the old key is
# still in the keyring.

# Step 3 — Restart the pod so the new keyring is loaded.
kubectl rollout restart deployment/deployd-api -n <ns>
kubectl rollout status deployment/deployd-api -n <ns>

# Step 4 — Flip ENC_KEY_ACTIVE to the new id.
# (Same provider-specific edit path as step 2.)

# Step 5 — Restart again so the new active key takes effect.
kubectl rollout restart deployment/deployd-api -n <ns>
kubectl rollout status deployment/deployd-api -n <ns>

# Step 6 — Wait for the retention window to elapse before removing
# the old key from the keyring. The retention window is
# .Values.backup.keep days (default 28 — see §3.2 NFR-002). For the
# default 6-hour cron + 28-day retention, every snapshot encrypted
# under the old key is purged from S3 by hiqlite's cron after 28 days.
# After that, the old key is safe to remove.
#
# Premature removal of the old key = unrecoverable old snapshots
# (per §2.3). Err on the side of keeping old keys longer than
# strictly necessary.
```

### 4.2 What this does NOT cover

- **Automated rotation** is out of scope for spec 145. A future spec
  may automate the six-step procedure above into a Job / CronJob.
- **Forced re-encryption** of historical snapshots under the new
  active key is also out of scope. The gentle-rotation flow above
  assumes the old snapshots age out naturally under the retention
  window.

---

## 5. Verification

### 5.1 Cron-driven snapshot emission

The hiqlite cron task runs on the schedule in
`.Values.backup.schedule` (chart default: `"0 0 */6 * * *"` — every
six hours, on the hour). After each successful run, the pod logs:

```
INFO  Executing backup now
INFO  Backup task finished successfully
```

Inspect the pod's recent logs:

```bash
kubectl logs -n <ns> deployment/deployd-api --since=6h | grep -E 'Backup task|Executing backup'
# Expected: at least one "Backup task finished successfully" in the last 6 hours.
```

If "Executing backup" appears but "Backup task finished" does not, the
cron triggered but the S3 push failed — check the immediately-following
log lines for the S3 error.

### 5.2 S3 bucket listing

The bucket should accumulate snapshots on the cron cadence. With the
default `schedule: "0 0 */6 * * *"` and `keep: 28`, expect:

- New snapshot every 6 hours: `backup_node_1_<incrementing-unix-ts>.sqlite`.
- Up to ~112 snapshots steady-state (4 per day × 28 days).
- Oldest snapshot's timestamp should be ≤ 7 days old per the
  governance-audit RPO floor: this runbook's verification target is
  the OLDEST snapshot ≤ 7d (not the configured 28d retention — 7d is
  a healthier alert threshold; only invoke retention math if you see
  a much older snapshot persisting). The S3 cleanup runs at the end
  of each cron job, so retention is bounded by 6h not 28d.

```bash
aws s3 ls "s3://$BUCKET/" --endpoint-url "$ENDPOINT" --profile <profile> \
  | grep backup_node_ | sort | head -1
# Oldest snapshot — should be < 7 days old.
```

### 5.3 Decrypt smoke check

Periodically (e.g., quarterly): pick a snapshot, pull it locally, and
decrypt with the active key to confirm the keyring still works
end-to-end. Hiqlite's restore flow exercises decryption on every
restore-on-startup, so this is a belt-and-suspenders test for ops
teams that don't routinely perform restores.

```bash
# Get the latest snapshot
aws s3 cp "s3://$BUCKET/backup_node_1_<ts>.sqlite" /tmp/snapshot.enc \
  --endpoint-url "$ENDPOINT" --profile <profile>

# Decrypt using cryptr CLI (matching cryptr 0.10.0 version)
cryptr decrypt --in /tmp/snapshot.enc --out /tmp/snapshot.sqlite

# Verify it's a valid SQLite database
sqlite3 /tmp/snapshot.sqlite "SELECT count(*) FROM deployments; SELECT count(*) FROM deployment_events;"
# Should print non-zero row counts.

shred -u /tmp/snapshot.enc /tmp/snapshot.sqlite
```

---

## See also

- Spec [`145-deployd-durability`](../../specs/145-deployd-durability/spec.md)
  — design rationale, decision log, FR/NFR contracts.
- Spec [`146-deployd-api-memory-hardening`](../../specs/146-deployd-api-memory-hardening/spec.md)
  — the cgroup floor that makes hiqlite's cold-start (and spec 145's
  restore-on-startup) viable. The two specs co-claim `values.yaml`
  under disjoint sections; this runbook does not need to touch the
  `resources:` block.
- Companion audit + verifications:
  - [`specs/144-hiqlite-default-features/audit.md`](../../specs/144-hiqlite-default-features/audit.md)
  - [`specs/144-hiqlite-default-features/verifications.md`](../../specs/144-hiqlite-default-features/verifications.md)
- Hiqlite upstream: <https://github.com/sebadob/hiqlite> (v0.13.1 is
  the pinned version as of spec 145 authoring).
- cryptr 0.10.0: <https://crates.io/crates/cryptr> — keyring + CLI
  documentation.
