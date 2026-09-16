# fleet (spec 006)

Operates stamped EnRaHiTu apps on the hetzner-k3s cluster. The unit of
placement is "one EnRaHiTu container + one volume + one ingress" in a
per-tenant namespace (`t-<tenantId>`).

The Kubernetes work is done by the **`fleet-native`** napi addon, consumed as
the published `@statecrafting/fleet-native` (statecrafting spec 006; it lived
here under `addon/fleet-native/` until that transfer). It builds the placement
shape natively with
`kube-rs` (Deployment single-replica Recreate, PVC, ClusterIP Service, nginx
Ingress with a cert-manager DNS-01 TLS annotation, Namespace, baseline
NetworkPolicies) and exposes `placeApp` / `appStatus` / `updateApp` /
`backupApp` / `removeApp`. This service is the typed, governed control layer on
top of it.

## Endpoints

| Verb | Route | Notes |
|---|---|---|
| deploy | `POST /api/v1/tenants/:id/fleet` | place an app; gated soft |
| list | `GET /api/v1/tenants/:id/fleet` | the tenant's apps |
| status | `GET /api/v1/fleet/:appId` | refreshed live from the addon |
| update | `POST /api/v1/fleet/:appId/update` | image change; gated strict |
| backup | `POST /api/v1/fleet/:appId/backup` | scale-down restic; gated soft |
| remove | `DELETE /api/v1/fleet/:appId` | name-confirm guarded; gated strict |

## Invariants

- **Owner-scoped through the tenant.** An app whose tenant the caller does not
  own reads as 404 (existence is never leaked), like factory (005).
- **Intent journal.** Every mutating verb opens a `FleetOp` row before the addon
  runs and closes it with the outcome (spec 006 §3).
- **Governed.** Mutating verbs call `POST /governance/gate` first (fleet is the
  first consumer). Governance is a soft dependency: unreachable means deny for
  strict verbs (remove/update) and warn-and-proceed for soft ones
  (deploy/backup) per spec 008 §3. On allow, the attestation records the gate's
  config hash.
- **Backups** are clean-shutdown-consistent: scale to 0, restic `/data` to
  Hetzner Object Storage (`oap-fleet-backups-prod`), scale back to 1 (spec
  006 §3). `FLEET_S3_RESTIC_PASSWORD` is the real at-rest control.

## Configuration

- `FLEET_BASE_DOMAIN` (env, no default): `<name>.<domain>` for app hosts
  (deployd.xyz). Deploy reports a failedPrecondition if unset.
- `FLEET_S3_RESTIC_PASSWORD`, `FLEET_S3_ACCESS_KEY_ID`,
  `FLEET_S3_SECRET_ACCESS_KEY` (secrets): the backup target. Backup reports a
  failedPrecondition if unset. The addon passes the password into the backup
  Job as restic's own `RESTIC_PASSWORD` env var, which is restic's CLI contract
  and is deliberately not renamed.
- The kubeconfig is resolved Rust-side by the addon
  (`FLEET_KUBECONFIG_PATH`, else in-cluster / `~/.kube/config`).

CoreLedger is the data API (no Encore `SQLDatabase`, no direct SQL).
