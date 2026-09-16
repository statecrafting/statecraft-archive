---
id: "010-statecraft-cluster"
title: "The statecraft cluster: the substrate beneath the control-plane container"
status: approved
created: "2026-07-16"
implementation: in-progress
depends_on:
  - "001-statecraft-thesis"
establishes:
  - { kind: directory, path: "infra/" }
summary: >
  The statecraft-owned hetzner-k3s cluster, reconciled by Flux from an
  in-repo GitOps tree, with one documented secret source that generates
  the operator `.env.example` and the SOPS-encrypted secrets Flux
  decrypts in-cluster. Rewritten ground-up 2026-07-19 to the two-plane
  thesis (001 §3): identity and observability moved inside the
  control-plane container, so the cluster keeps only what a container
  cannot do for itself. The standalone cluster rauthy is retired
  (embedded rauthy is THE platform IdP) and cluster Grafana is dropped
  with its OIDC client (platform observability is the in-substrate
  flag-gated admin dashboard); Prometheus is kept, demoted to an
  unexposed in-cluster metrics sink. What stands: the Flux tree, SOPS,
  cert-manager, ingress-nginx, reflector, Postgres, NSQ, and Hetzner
  Object Storage. The cluster is live (PRs #27-#29); this rewrite is the
  first change that prunes services from it. Amended 2026-07-20 on
  explicit operator authorization, closing spec 009 checkpoint 1: the
  claim that every `RAUTHY_*` key survives the move into the container is
  corrected to the verified image behavior, which self-seeds its own
  identity. The catalog goes from 47 keys to 33, `auth.<DOMAIN>` is
  settled as not returning, and the keys a deploy genuinely owes the
  container are named.
---

# 010: The statecraft cluster

## 1. Purpose

The cluster is what a container cannot do for itself.

Under the two-plane model (001 §3.1) the platform is ONE EnRaHiTu app:
identity lives in the container (embedded rauthy), observability lives in
the container (the flag-gated admin dashboard), and durable state sits
behind CoreLedger. What is left for the cluster is the substrate beneath
that container: machines, ingress, certificates, secret delivery, the
data services the control plane's drivers target, and a place for metrics
to land.

This spec is rewritten ground-up on 2026-07-19 to that shape. Its
previous version provisioned the platform's identity provider and the
platform's operator dashboard as cluster services. The thesis rewrite
moved both inside the control-plane container, so those parts are
**retired here rather than amended** (§2). Everything the cluster still
owes the platform is restated below on its own terms.

**History, compressed.** The cluster statecraft ran on was OAP's: nodes
named `oap-hetzner-*`, Flux reconciling from the `open-agentic-platform`
repository, carrying research-era state. It was torn down on 2026-07-17
rather than kept as a fallback, and a statecraft-owned cluster was built
greenfield from a verified-empty Hetzner project. The platform layer came
up live on 2026-07-18 and Flux was repointed from the feature branch to
`main` (PRs #27-#29). Both `statecraft-hetzner-*` nodes are Ready, every
Flux tier reconciles, the SOPS secrets materialize from ciphertext in
git, and no object on the cluster references `open-agentic-platform`.
There was never a blue-green rollback target and there is none now.

## 2. What the realignment retires

The cluster is live, so this section is not a plan: it is a list of
services that get pruned from a running cluster when this spec merges
(§6).

### 2.1 The cluster rauthy is retired

Thesis 001 §3.3 is literal: embedded rauthy is THE platform IdP, the
control plane hosts it in-container, and there is no standalone cluster
rauthy and no second IdP. This spec is where that becomes true of the
cluster.

**What goes:** the `rauthy` HelmRelease, the vendored in-tree chart at
`charts/rauthy/`, the `rauthy-system` namespace, and the two SOPS
secrets that fed it (`rauthy-secrets`, `rauthy-smtp-secret`). The
previous spec's "rauthy: rebuild, do not migrate" decision is void, because
there is nothing here to rebuild.

**What stays: amended 2026-07-20, and this is the correction.** This spec
originally claimed that "every `RAUTHY_*` key the catalog declares is
still required, now by the embedded rauthy inside the control-plane
container", and delegated delivery to spec 009. Spec 009's rewrite then
verified the published image and found the premise false, raising the
contradiction as its checkpoint 1 rather than resolving it from outside
010's territory. **The operator decided on 2026-07-20 to amend this spec
to the verified image behavior.** That authorization is what makes this
edit legitimate; absent it, editing an owning spec to match what the code
turned out to do is precisely what the coherence guard forbids.

The IdP did not just move: it became **self-founding**. `first-boot.mjs`
generates both RS256 keypairs, the OIDC client secret, the rauthy
bootstrap admin password, `ENC_KEYS` / `ENC_KEY_ACTIVE`, rauthy's hiqlite
Raft and API secrets, and the app's own hiqlite secrets into the `/data`
volume, and the entrypoint then **unconditionally exports** five of them
(`JWT_PRIVATE_KEY`, `JWT_PUBLIC_KEY`, `JWT_REFRESH_PRIVATE_KEY`,
`JWT_REFRESH_PUBLIC_KEY`, `RAUTHY_CLIENT_SECRET`) from `/data` in the same
shell that starts the app. Delivering those five through a Secret is not
redundant, it is a **silent no-op**: the injected value is overwritten
before the app reads it, so the Secret reads as configured while having no
effect. The rest were never wired into the image at all.

So the catalog is pruned from 47 keys to 33, decided per key rather than
by category:

- **Dropped, because the container mints them and delivery is impossible
  (7):** `RAUTHY_RAFT_SECRET`, `RAUTHY_API_SECRET`,
  `RAUTHY_ADMIN_PASSWORD`, `RAUTHY_ENC_KEY_ID`, `RAUTHY_ENC_KEY`,
  `HIQLITE_SECRET_RAFT`, `HIQLITE_SECRET_API`.
- **Dropped, fixed by the chassis (1):** `RAUTHY_CLIENT_ID`. The
  entrypoint hardcodes the client id `enrahitu`; a catalog key cannot
  change it.
- **Dropped, no consumer anywhere in the tree (6):** `SESSION_SECRET`
  (an OAP leftover that no file in this repository reads),
  `OIDC_SPA_CLIENT_ID`, `OIDC_M2M_CLIENT_ID`, `OIDC_M2M_CLIENT_SECRET`
  (OAP names), and the two derived URLs `APP_BASE_URL` and `RAUTHY_URL`
  (below).
- **Kept, declared for Encore and satisfied in-container (5):** the four
  `JWT_*` PEMs and `RAUTHY_CLIENT_SECRET`. They cannot be dropped even
  though the deploy must not send them: `infra.config.json` declares all
  eleven Encore secrets and `npm run secrets:check` fails on any that is
  absent from the catalog. They are also genuinely consumed by a **local**
  run, where `npm run generate-keys` and `npm run dev:idp-secret` write
  the files that `backend/lib/secrets.ts` falls back to. They are now
  `required = false` with that consumer restated, and the catalog states
  that injecting them is forbidden.
- **Kept, and live as of 2026-07-20 (2):** `RAUTHY_S3_*`. It was held
  against spec 009 section 4.8 item 2 (the entrypoint exported no S3
  configuration, so the embedded rauthy had no backup target). That item
  was closed the same day by mapping the operator-facing names onto
  rauthy's own `HQL_S3_*`. Holding it rather than dropping it was the
  right call: the operator had provisioned credentials, and the gap was a
  capability loss rather than material the image supersedes. Both keys
  are now pod Secret keys, because rauthy runs inside the container.
- **Kept, and live as of 2026-07-20 (5):** the SMTP group. It was held on
  the same reasoning as `RAUTHY_S3_*` until spec 009 section 4.8 item 1
  was closed by wiring the entrypoint to forward all five variables into
  the rauthy subshell. Its consumer is now the embedded rauthy rather
  than "none today": `SMTP_PASSWORD` becomes the seventh key of the pod
  Secret, and `SMTP_URL` / `SMTP_PORT` / `SMTP_USERNAME` / `SMTP_FROM`
  are non-secret plain env. The group stays all-or-nothing and optional,
  because omitting it disables mail rather than failing the boot.
- **Kept, and the only rauthy keys with a live consumer (3):** the
  `GITHUB_UPSTREAM_*` pair and `RAUTHY_ADMIN_TOKEN`, the credentials of
  the seeder Job. Their consumer is restated as that Job and its own
  Secret, never the app pod (spec 009 §4.5). `RAUTHY_ADMIN_TOKEN`'s
  description is narrowed to match: the seeder needs the API only for the
  upstream provider, since the OIDC client is seeded declaratively at
  first boot and scopes are not converged at all. It is demoted to
  `required = false` because `first-boot.mjs` does not yet compose
  `api_keys.json` (spec 009 §4.8 item 3), so rauthy has not handed the
  value back yet.
- **Kept, held (2):** the `GOOGLE_UPSTREAM_*` group. Spec 009 §4.5
  specifies a seeder that converges the GitHub provider only, so this
  pair has no consumer until a second provider is converged. It is held
  on the same reasoning as the SMTP group rather than counted as live.

Nine keys, and only nine, are genuinely required from a deploy and belong
on the pod Secret: `GITHUB_APP_ID`, `GITHUB_APP_PRIVATE_KEY_B64`,
`GITHUB_WEBHOOK_SECRET`, `FLEET_S3_RESTIC_PASSWORD`,
`FLEET_S3_ACCESS_KEY_ID`, `FLEET_S3_SECRET_ACCESS_KEY`, `SMTP_PASSWORD`,
`RAUTHY_S3_ACCESS_KEY_ID`, and `RAUTHY_S3_SECRET_ACCESS_KEY` (the first of
the restic keys was spelled `RESTIC_PASSWORD` until the 2026-07-20
credential split, §4; the last three joined as spec 009 §4.8 items 1 and 2
were closed). Their **delivery** still belongs to spec 009. The operator `.env` remains the origin of record for the material it
still names, so deleting rauthy ciphertext from this tree still loses
nothing; there is simply far less to re-encrypt than this spec once
assumed (section 4).

**Cost, accepted:** `auth.statecraft.ing` stops serving when this merges.
Nothing consumes it. The rauthy on this cluster is fresh, carries no
seeded OIDC clients (client seeding was always spec 009's seeder pass),
and the control plane it would authenticate for is not deployed. This
spec originally expected the host to return with 009; the amendment below
settles that it does not.

**Handed to 009, and now settled: `auth.<DOMAIN>` does not survive.**
This spec declined to guess whether `auth.` remained a distinct host.
Spec 009 section 2.4 answered it structurally rather than by preference:
the entrypoint sets `RAUTHY_ISSUER="$PUBLIC_URL/auth/v1/"`, gives rauthy
`PUB_URL` equal to the app's own host under `PROXY_MODE=true`, and binds
it to loopback where only the app's proxy can reach it. The whole rauthy
surface is served same-origin below `https://app.statecraft.ing/auth/`,
and a second host could only mint a second issuer identity for one IdP.

`RAUTHY_URL` is therefore **dropped rather than redefined**, which is the
option 009 section 2.4 left open. It had no consumer: no code reads it,
and the issuer the app actually uses is derived in-container from
`ENRAHITU_PUBLIC_URL`, not supplied by the operator. Keeping it as
`https://<APP_HOST>/auth/v1/` would restate in a settable variable a value
the container computes for itself, which is the drift this amendment is
removing. `APP_BASE_URL` goes with it for the same reason: it claimed the
consumer "app, rauthy redirect", and the app reads `WEBAPP_BASE_URL` and
`FRONTEND_URL` instead. The stale `https://auth.<DOMAIN>` formula is
removed from the validator's derived-agreement check along with them.

### 2.2 Grafana is dropped; Prometheus is kept, demoted

Thesis 001 §3.4 pivots platform observability to the in-substrate
flag-gated `frontend-admin`, same-origin behind `statecraft_operator`,
with no separate Grafana OIDC client and no standalone monitoring
identity. That settles the two halves of the monitoring stack
differently, so this spec decides each explicitly.

**Grafana: dropped, with its OIDC client.** Grafana's sole auth path here
was rauthy `generic_oauth` against a dedicated OIDC client. The pivot
forbids that client, and the cluster rauthy it authenticated against is
retired by §2.1, so keeping Grafana would mean either an unauthenticated
dashboard reachable at ingress or reinstating exactly the standalone
monitoring identity the thesis removes. Neither is acceptable, and the
client was never actually registered in rauthy, so nobody has ever logged
in. The Grafana subchart, its ingress, its `grafana-oidc` Secret, and the
`GRAFANA_OIDC_CLIENT_ID` / `GRAFANA_OIDC_CLIENT_SECRET` catalog keys all
go. The stale `rauthy_admin` role mapping in its config goes with it,
which is convenient: fork 6 of the realignment record replaced that role
with `statecraft_operator`, and this was its last appearance.

**Prometheus: kept, as an unexposed sink.** It is demoted from "the
metrics stack that serves Grafana" to a data plane with no UI and no
identity: no ingress, no LoadBalancer, reachable only in-cluster. Kept
because:

- The substrate contract (001 §3.4) requires every EnRaHiTu app to expose
  Prometheus `/metrics` and OTel traces. Something has to receive them.
  The in-substrate dashboard is a renderer, not a time-series store.
- Cluster-plane signals (node health, ingress, Flux reconciliation, pod
  restarts across the fleet) are invisible from inside any one container.
  They are the operator's only view of the machines the fleet places onto,
  and no in-container dashboard can reconstruct them.
- The fleet's per-tenant Grafana/Prometheus add-on (001 §3.4, spec 006) is
  this same machinery at tenant scope. Dropping the platform's copy would
  mean rebuilding it when the add-on ships.

The demotion is a change of role, not of configuration: only Grafana ever
carried an ingress, so removing Grafana leaves Prometheus in exactly the
posture named here. **Who reads it is deferred.** Whether `frontend-admin`
queries it server-side is a 009 and substrate question; this spec
provisions the sink and asserts nothing about the consumer. Until a
consumer exists the operator reads it through `kubectl port-forward`,
which is deliberate: an operator-only path that needs no second identity
at the edge.

**Alternative recorded and rejected:** dropping Prometheus alongside
Grafana. It would save one HelmRelease and a 20Gi volume, at the price of
blinding the cluster at precisely the layer the in-container dashboard
cannot see.

### 2.3 What stands

Unchanged by the realignment, and restated so the retirements above are
not read as a wider retreat:

- **The in-repo Flux GitOps tree**, five tiers with `dependsOn`
  (`namespaces` -> `secrets` + `infrastructure` -> `manifests` +
  `statecraft`). Decided 2026-07-16 and still right: the cluster's
  definition is governed by the same spine as everything else, so
  `spec-spine couple` binds an infrastructure change to this spec the way
  it binds a code change. The cost (Flux needs a deploy key on a repo that
  also holds application code) is contained by path-scoped kustomizations.

  **The fifth tier arrived 2026-07-20 and is not this spec's.**
  `statecraft-kustomization.yaml` and everything under `statecraft/` are
  spec 009's, declared by that spec and nested inside this one's `infra/`
  on the pattern spec 002 already uses for `backend/`. Adding it to the
  root `kustomization.yaml` resource list is the single line this spec
  owns in that change, and it is a coordinated edit rather than a waiver:
  the tree's entry point is substrate, the application it points at is
  not. This is also the boundary that kept the manifests out of a second
  top-level directory (spec 009 §3), so it is worth stating positively
  rather than leaving as a one-line diff: **the cluster owns the tree, and
  each tier is owned by whichever spec owns what that tier places.**
- **SOPS** for cluster secrets: values encrypted in git, documentation
  beside them, no plaintext at rest, every rotation an auditable commit.
- **cert-manager**, both ClusterIssuers, DNS-01 Cloudflare as the default.
- **ingress-nginx**, DaemonSet with hostPort.
- **reflector**, which clones annotated Secrets across namespaces for the
  tenant wildcard TLS cert and the `ghcr-pull` secret (specs 004/006/009).
  It never had anything to do with rauthy or Grafana.
- **Postgres** (raw StatefulSet, born empty), the CoreLedger driver target
  (spec 003, thesis §3.2).
- **NSQ** (raw manifest). Encore's self-host infra schema supports exactly
  three pub/sub backends (`gcp_pubsub`, `aws_sns_sqs`, `nsq`), so NSQ is
  the only self-hostable choice.
- **Hetzner Object Storage**, not an in-cluster service. The old cluster's
  minio was dropped 2026-07-17; with a managed S3 already in the picture a
  self-hosted one was pure redundancy, and block storage is better
  reserved for workloads that need it.
- **The secret catalog** as the single documented source (§4).

## 3. Territory

- `infra/`: everything infrastructure, owned by this spec.
  - `infra/hetzner/`: cluster provisioning (hetzner-k3s config, node
    pools, the operator bootstrap) and the generated `.env.example`.
  - `infra/gitops/clusters/statecraft-hetzner/`: the Flux entrypoint and
    the kustomizations it reconciles.
  - `infra/secrets/catalog.toml`: the single documented secret source,
    with `catalog.ts` as its generator and validator.
  - `infra/gitops/clusters/statecraft-hetzner/secrets/*.sops.yaml`:
    SOPS-encrypted cluster secrets.

**Cross-spec touches.** The catalog documents the operator and cluster
secret surface (the `.env` at `~/.config/statecrafting/infra/hetzner/`).
It generates its own committed example beside `cluster.yaml` rather than
the root `.env.example`, which is spec 002's local-dev ledger doc: a
developer running `npm run dev` sets none of the operator secrets. The
catalog must *agree with* (not rewrite) two spec 002 artifacts,
`infra.config.json` and the root `.env.example`; agreement is a
validation the generator enforces, not an authoring edit. The one genuine
002 touch is wiring the generator scripts into `package.json`.

## 4. Behavior

### Cluster

hetzner-k3s, x86-64, nodes named `statecraft-hetzner-*`. The operator
kubeconfig is `~/.config/statecrafting/infra/hetzner/kubeconfig`; the
operator `.env` is its sibling.

Two operational facts the hetzner-k3s `cluster.yaml` schema cannot
express, recorded here as design truth:

- **The Hetzner firewall must allow inbound TCP 80/443.** hetzner-k3s
  creates a firewall with SSH/API/NodePort rules only, so the
  ingress-nginx hostPort is unreachable until 80/443 are opened. Added
  live via `hcloud firewall add-rule`; re-running `hetzner-k3s create`
  may reset the firewall and require re-adding them. It is an operator
  step, not a manifest.
- **ingress-nginx runs only on the worker.** The DaemonSet does not
  tolerate the control-plane taint, so only the worker serves 80/443 and
  DNS points at the worker IP.

### GitOps

Flux is bootstrapped against this repository at
`infra/gitops/clusters/statecraft-hetzner`, tracking `main`. Acceptance
includes a zero-hit grep: no manifest, HelmRelease, or GitRepository on
the cluster may reference `open-agentic-platform`.

Every tier sets `prune: true`. That is what makes §2's retirements take
effect on merge, and it is why they are a human checkpoint (§6).

### Secrets: one documented source, two outputs

`infra/secrets/catalog.toml` is the single source. It holds names,
descriptions, ownership, required/optional status, and the consumer of
each value. **It holds no values.** From it:

- **`infra/hetzner/.env.example`** is generated: commented, documented,
  committed. The catalog carries the prose so the artifact need not.
- **The operator `.env`** (gitignored, at
  `~/.config/statecrafting/infra/hetzner/.env`) is validated against the
  catalog: missing required keys and unknown keys both fail.
- **Cluster secrets** are SOPS-encrypted YAML, committed, decrypted
  in-cluster by Flux. The `age` private key is bootstrapped once into
  `flux-system` and never committed; the public key is committed so any
  operator can encrypt.

  **The control plane's own Secrets joined this tier on 2026-07-20**:
  `statecraft-secrets` (the nine keys of spec 009 §2.2) and
  `statecraft-platform-backup` (the `PLATFORM_S3_*` group, mounted only on
  the `/data` backup CronJob). They live here rather than beside spec 009's
  manifests for two mechanical reasons: `.sops.yaml`'s creation rule matches
  only this directory, and this is the only Flux tier carrying a
  `decryption:` block. That is what this section already anticipated when it
  said spec 009 "re-encrypts it from the operator .env into the control-plane
  namespace"; registering the two files is the coordinated edit that
  prediction implied.

**The operator `.env` is the origin of record for the material the
platform still needs from an operator**, which after §2.1 is a much
smaller set: the cluster and provider credentials, the nine keys the pod
Secret carries, and the seeder's three. That origin is what lets §2.1
delete rauthy ciphertext from the tree without losing anything.

**It is no longer the origin of the signing keys.** This spec previously
held that the four `JWT_*` RS256 PEMs are "minted once by `npm run
generate-keys`, written there beside every other operator secret, and
delivered to the cluster through SOPS like the rest". The container mints
its own on first boot and the entrypoint overwrites whatever was
delivered, so the SOPS path for them leads nowhere. `npm run
generate-keys` survives as a real prerequisite for a **local** run
against a working tree, which is the only claim the catalog now makes for
those keys. The PEMs already sitting in the operator `.env` are harmless
to keep and are no longer required; what matters is that they never reach
the pod.

**The two backup domains carry separate credentials (2026-07-20).** The
catalog went 33 keys to 36 with a `platform_s3` group:
`PLATFORM_S3_ACCESS_KEY_ID`, `PLATFORM_S3_SECRET_ACCESS_KEY`, and
`PLATFORM_S3_RESTIC_PASSWORD`, against a bucket the operator provisioned
the same day. `RESTIC_PASSWORD` was renamed `FLEET_S3_RESTIC_PASSWORD` in
the same pass, because once a platform sibling existed the unqualified
name could not say which domain it protected.

Spec 009 §4.3 rule 2 originally proposed backing the control plane's
`/data` up with the fleet's credentials, "reusing `RESTIC_PASSWORD` and
the `FLEET_S3_*` credentials the pod already holds". That is rejected
here. The fleet's credentials protect **tenant** app volumes and are
handled routinely by the placement path; `/data` is the platform's
identity plane, which §4 above states is not reconstructible from
anything in this tree. Encrypting it under the tenant repository password
would put the platform's only irreplaceable material behind a credential
whose blast radius is every tenant, and the reuse saved nothing but two
catalog entries.

The three platform keys are catalogued but deliberately **absent from
`infra.config.json`**: their consumer is a restic CronJob, a separate
workload with its own Secret, so they never reach the app pod. This is
the same containment spec 009 §4.5 applies to the seeder Job's
credentials, and it keeps the pod Secret at nine keys. Custody of
`PLATFORM_S3_RESTIC_PASSWORD` belongs with the break-glass material
(spec 009 §4.6), not with the fleet's: losing both it and the volume is
unrecoverable.

**The `/data` volume, not this file, is the identity plane.** Everything
the platform is (both keypairs, the client secret, rauthy's encryption
keys, and rauthy's entire hiqlite database of users, roles, and clients)
is generated in-container and exists nowhere else. It is not
reconstructible from SOPS ciphertext in git the way the retired
shared-rauthy topology was. Spec 009 section 4.3 carries the operational
rules that follow; the consequence for this spec is that no amount of
secret delivery can re-found a lost volume.

### Platform services

Reconciled by Flux from `infra/gitops/`. Most are HelmReleases; Postgres
and NSQ are raw manifests (still Flux-reconciled), because NSQ has no
maintained chart and a single born-empty Postgres on the official image
sidesteps the Bitnami catalog changes that leave old `bitnami/postgresql`
tags in `ImagePullBackOff`.

- **cert-manager** (HelmRelease) with both ClusterIssuers. The DNS-01
  Cloudflare issuer is the default every platform host uses, so certs
  issue before DNS is cut over; HTTP-01 cannot solve an unreachable host
  on a greenfield cluster. The solver uses `CLOUDFLARE_DNS_API_TOKEN`.
- **ingress-nginx**, **reflector** (HelmReleases).
- **Postgres** (raw StatefulSet, `postgres:17`), born empty.
- **NSQ** (raw manifest), Encore's pub/sub backend.
- **Prometheus** (kube-prometheus-stack HelmRelease, Grafana subchart
  disabled). It receives the control plane's Encore `remote_write`, scrapes
  the pull targets (ingress-nginx, Flux, node-exporter, kube-state-metrics),
  and is reachable only in-cluster (§2.2). Alertmanager and the bundled
  default rules stay off; alerting policy is a later spec, not a chart
  default.

**No identity provider and no operator UI run on this cluster.** Both are
properties of the control-plane container (specs 009 and the substrate
rewrite). A future service that wants either must be argued against
thesis §3.3 and §3.4 first, not added here.

### Object storage

Hetzner Object Storage. Encore's `object_storage` uses the `s3` backend
against the `statecraft-encore-object-storage` bucket, addressed by
`OBJECT_STORAGE_S3_*`; rauthy's hiqlite backups (`RAUTHY_S3_*`) and the
fleet's restic backups (`FLEET_S3_*`) target their own buckets. These
buckets are a separate Hetzner service and survived the 2026-07-17
teardown.

### DNS

Under `statecraft.ing`: `auth` is retired with §2.1 and **does not
return**, since the issuer moved same-origin (§2.1, spec 009 §2.4); its
record should be removed rather than repointed, which is spec 009's
checkpoint 4. `grafana` is retired outright and its record should be
removed (§6); `app` and `deploy` arrive with specs 009 and 006. The fleet
places tenant apps under `deployd.xyz`. The retired `auth` record is
Cloudflare-proxied while `app` is a direct A record to the worker, so
records are not uniform and each is checked individually. The apex stays
GitHub Pages and is not touched.

## 5. Acceptance

Met and holding:

- Nodes named `statecraft-hetzner-*` are Ready, under the kubeconfig at
  `~/.config/statecrafting/infra/hetzner/`.
- Flux reconciles the cluster from this repository, tracking `main`; no
  object on the cluster references `open-agentic-platform`.
- `infra/secrets/catalog.toml` generates `.env.example`, validates a real
  `.env`, and its SOPS counterparts decrypt in-cluster (verified by a
  Secret materializing from ciphertext in git). After the §2.1 amendment
  the validation half is **gated on checkpoint 6**: `secrets:validate`
  fails on fourteen unknown keys until the operator prunes them from the
  live file. `secrets:check` and `secrets:example` stay green.
- cert-manager issues real certs via the DNS-01 issuer for every host the
  cluster still serves; no host serves the ingress default certificate.

New with this rewrite, verified by absence and by posture:

- No rauthy, no Grafana, and no in-cluster minio runs on the cluster. The
  `rauthy-system` namespace is gone.
- Prometheus is Ready, receives `remote_write`, scrapes its pull targets,
  and is reachable only in-cluster: no Ingress and no LoadBalancer
  Service resolves to it.
- Every remaining Flux kustomization and HelmRelease reports Ready after
  the prune, with no orphaned namespace and no orphaned Secret once the
  hand-deleted `grafana-tls` leftover of §6.2 is cleared.

Gated on other specs, and not this spec's to close:

- Encore's `object_storage` reads and writes the Hetzner bucket (009).
- The fleet places an app on this cluster and its live verbs pass (006).
- A real login completes against the control plane's embedded rauthy
  (009). This replaces the previous version's `auth.<domain>` and
  operator-admin-login acceptances, which retired with §2.1.
  **Closed 2026-07-22 by spec 009 checkpoint 5:** the operator-admin login
  completed end to end and the `statecraft_operator` claim was observed in
  the control plane's own user model.

## 6. Human checkpoints

`prune: true` means merging this spec mutates a live cluster with no
further prompt. Each of these is an operator action, proposed here rather
than performed:

1. **Approve the prune.** On merge Flux deletes the rauthy StatefulSet
   and its PVC, the Grafana deployment and its PVC, the `rauthy-system`
   namespace, and three Secrets. Reversible by reverting the commit,
   except for the volumes' contents, which are: a fresh rauthy DB holding
   one bootstrap admin, and a Grafana instance nobody ever logged into.
2. **Verify the prune landed clean**: all tiers Ready, Prometheus still
   Ready and still unexposed. Two leftovers are expected rather than
   automatic. The `grafana-tls` Secret survives in the `monitoring`
   namespace, because deleting the Ingress deletes the cert-manager
   Certificate that owns it but cert-manager does not delete the backing
   Secret unless `enableCertificateOwnerRef` is set; delete it by hand.
   Confirm the Grafana PVC went with the subchart. The `rauthy-tls`
   Secret needs no such step, since its whole namespace is removed.
3. **Prune the operator `.env` of the two `GRAFANA_OIDC_*` keys.**
   **Done.** `npm run secrets:validate` was green against the live
   operator file on 2026-07-20 before the §2.1 amendment, which is only
   possible with those two lines gone. Its instruction that "the rauthy
   keys stay and must not be removed" is superseded by checkpoint 6.
4. **Remove the `grafana.statecraft.ing` DNS record** at Cloudflare. It
   is out-of-band, like the firewall rules; nothing in this tree manages
   it.
5. **Re-add firewall rules 80/443** after any `hetzner-k3s create` rerun.
6. **Prune the operator `.env` of the fourteen keys §2.1 dropped.**
   Deleting a key from the catalog makes it an unknown key, so
   `npm run secrets:validate` fails against the live operator file until
   the matching lines are deleted from it. Run against the real `.env` on
   2026-07-20, immediately after the amendment, it reports exactly
   fourteen `unknown key not in catalog` errors and nothing else:
   `APP_BASE_URL`, `RAUTHY_URL`, `SESSION_SECRET`, `RAUTHY_RAFT_SECRET`,
   `RAUTHY_API_SECRET`, `RAUTHY_ADMIN_PASSWORD`, `RAUTHY_ENC_KEY_ID`,
   `RAUTHY_ENC_KEY`, `HIQLITE_SECRET_RAFT`, `HIQLITE_SECRET_API`,
   `OIDC_SPA_CLIENT_ID`, `OIDC_M2M_CLIENT_ID`, `OIDC_M2M_CLIENT_SECRET`,
   `RAUTHY_CLIENT_ID`. That the error set matches the dropped set exactly,
   with no missing-required error, is the evidence that the amendment
   removed only keys the live file could afford to lose.

   Deleting them destroys the only copy of material the platform no
   longer uses (a retired cluster rauthy's `ENC_KEYS`, its hiqlite
   secrets, and its bootstrap admin password). Nothing can read them
   again: the rauthy they belonged to was pruned by §2.1 and its volume
   went with it. This is an operator action precisely because it is
   irreversible, and it is safe to defer: the file simply fails
   validation until it is done.

   `npm run secrets:check`, the CI gate, stays green throughout, because
   all eleven `infra.config.json` secrets remain catalogued.

7. **Do not carry the dropped keys into the pod Secret.** The five
   `JWT_*` / `RAUTHY_CLIENT_SECRET` values that stay in the catalog are
   the ones the entrypoint overwrites. Spec 009's acceptance verifies
   this by absence; it is repeated here because this catalog is where an
   operator would go looking for "what the deploy needs".

## 7. Out of scope

- **The control plane deployment itself.** Spec 009 targets this cluster;
  this spec stops at the substrate beneath it. That now includes the
  embedded rauthy's secret delivery, its ingress, and the `auth.<DOMAIN>`
  question (§2.1).
- **The admin dashboard.** `frontend-admin` is an in-container surface
  arriving with the substrate rewrite (thesis §3.4); the cluster provides
  it nothing but a metrics sink it may or may not read.
- **Alerting policy.** A later spec, not a chart default.
- **Secrets at rest inside the control plane.** The control plane stores
  no secret at rest: every CoreLedger entity was inspected and none holds
  a credential, and `refresh_token` stores a hash it compares rather than
  reads back. This is by design, because spec 004's GitHub App flow mints
  short-lived installation tokens instead of storing customer
  credentials, which is why OAP's `PAT_ENCRYPTION_KEY` has no successor.

  **The decision is conditional on App reach.** It holds only while the
  installation token can do everything the console must do, including
  scheduling and dispatching Actions runs. Those are App permissions, so
  the condition is satisfiable by widening the App's permission set, which
  the installation flow re-consents. If a console verb turns out to need a
  user-supplied credential, this reopens and the crypto service becomes
  real work; verifying the App's permission set covers the console's verbs
  is a spec 004 gate on that claim, not an assumption to carry silently.
  Should a consumer appear, the mechanism is `cryptr`
  (ChaCha20Poly1305, the source of the `ENC_KEYS` convention rauthy
  already uses), specced then, against a real caller.
- Non-hetzner targets, and multi-cluster or HA topologies.
- Re-homing the marketing site: the apex stays GitHub Pages.

## Amendment (2026-07-22): the RAUTHY_API_KEY catalog delta

The secret catalog (`infra/secrets/catalog.toml`, this spec's §4
catalog line) gains `RAUTHY_API_KEY`: user-supplied, secret, required,
the rauthy admin API key spec 011 §6 named as its catalog delta. The
operator `.env`, the regenerated `.env.example` (37 keys), the pod
Secret (spec 009), and `infra.config.json` (spec 002) all agree;
`secrets:validate` and `secrets:check` are the proof.

## Amendment (2026-07-22): spec 012 frontend-admin adoption, the scrape lands

Spec 012 makes two coordinated edits in this spec's `infra/` territory,
cashing the promise the monitoring header records ("platform
observability is the in-substrate flag-gated frontend-admin"):

- **Prometheus gains its first platform target.** The statecraft pod
  template (spec 009's deployment.yaml) now carries the
  `prometheus.io/scrape|port|path` annotations the existing
  `statecraft-annotated-pods` job already selects on, so the in-cluster
  Prometheus scrapes the app's own `/metrics` (enrahitu spec 022
  contract) directly on the pod, never through the ingress. No change
  to monitoring.yaml itself.
- **`/metrics` stays off the public origin.** `statecraft/ingress.yaml`
  gains a second Ingress (`statecraft-metrics-deny`,
  spec-labeled 012): an Exact `/metrics` location whose
  `whitelist-source-range` allows only 127.0.0.1/32, so nginx's exact
  match beats the `/` prefix and every public request gets 403 while
  `/admin` and `/api/admin/*` stay routed (they are gated in-app,
  server-side). A separate resource because the allowlist annotation
  applies per-Ingress and must not touch the `/` paths.

## Amendment (2026-07-23): FLEET_IMAGE_PULL_SECRET is a name, not a credential

The catalog entry for `FLEET_IMAGE_PULL_SECRET` claimed a base64
dockerconfigjson derived from `GHCR_PAT`, inherited from the OAP-era
design. No code ever read it that way: `fleet/config.ts` has always
consumed it as the NAME of a pre-provisioned `dockerconfigjson` Secret to
reference as `imagePullSecrets` on placed pods (spec 006 §3 finding #2),
and fleet's RBAC deliberately cannot create Secrets. The entry is
corrected to `user-supplied`, non-secret, still required (`ghcr-pull` in
production, matching the spec 009 deploy env), the `derived` provenance
class is left with no members, and `.env.example` is regenerated;
`secrets:validate` and `secrets:check` stay green. The operator `.env`
value predates the correction and should be updated to the Secret name.
