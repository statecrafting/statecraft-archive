---
id: "009-control-plane-deploy"
title: "The control-plane deploy: one governed container on the statecraft cluster"
status: approved
created: "2026-07-16"
implementation: in-progress
depends_on:
  - "002-app-shell"
  - "008-governance-attestation"
  - "010-statecraft-cluster"
establishes:
  - ".github/workflows/image.yml"
  - ".github/workflows/ai-pr-review.yml"
  - ".github/workflows/ai-changelog.yml"
  - ".dockerignore"
  - { kind: directory, path: "infra/gitops/clusters/statecraft-hetzner/statecraft/" }
  - "infra/gitops/clusters/statecraft-hetzner/statecraft-kustomization.yaml"
# The manifest subtree landed 2026-07-20 and is declared above. It sits inside
# spec 010's `infra/` on the nested-ownership pattern this corpus already uses
# (spec 002 owns backend/ while 004, 005, 006, and 008 own subdirectories
# inside it), which is what let the relocation off a top-level `deploy/`
# happen without a second location for Kubernetes YAML (section 3). The AI
# review and changelog workflows landed 2026-07-23 (section 4.9). Still to
# land with its unit: .github/workflows/cd.yml.
summary: >
  Stand the control plane up on the spec 010 cluster as a platform-grade K8s
  deployment at app.statecraft.ing. Rewritten ground-up 2026-07-19 to the
  two-plane thesis (001 section 3), which unpauses it. The rewrite inverts the
  deploy's job: the published image is embedded-rauthy and self-seeds its own
  identity on first boot, so the shared-rauthy secret set is void, five of the
  eleven Encore secrets are discarded by the entrypoint if injected, and the
  /data volume becomes the identity anchor of the platform. What the deploy
  still owes the container: nine real secrets, the non-secret env, a Postgres
  URL, an ingress, and one seeder pass for the only thing first boot cannot
  seed (the upstream GitHub provider, which rauthy has no declarative
  bootstrap for). Operator surfaces gate on the custom statecraft_operator
  role, seeded here; rauthy_admin stays break-glass. Live bring-up is a human
  checkpoint.
---

# 009: The control-plane deploy

## 1. Purpose

The control plane has no deployment. Stage 1 (the image) landed 2026-07-16
and is cluster-independent; stage 2 stopped before a manifest was written and
was paused while the thesis was rewritten. This spec is that rewrite, and it
unpauses the work.

Under the two-plane model (001 section 3.1) the platform **is** one EnRaHiTu
app, and that changes what a deploy means. The previous version of this spec
deployed an application against platform services: a rauthy installed on the
cluster, key material minted by an operator and delivered through SOPS, a
seeder converging an OIDC client against a shared IdP. None of that survives.
The container carries its own IdP, mints its own signing keys, generates its
own client secret, and bootstraps its own admin. The deploy's job shrinks to
placing one container plus one volume plus one ingress, handing it the few
things it genuinely cannot mint for itself, and seeding the one thing its
first boot cannot reach.

This is the unit of placement the fleet sells (001 section 3.2), executed on
the platform first. The deploy that stands statecraft up is the same shape the
fleet will run for every tenant app, which is the point of being the first
production EnRaHiTu app.

**What still holds from the previous version.** The chosen public host is
`app.statecraft.ing`; the apex stays the GitHub Pages marketing site. The
control plane runs the Postgres driver against its own born-empty database
(spec 003, thesis section 3.2), not the fleet's per-app libSQL shape. The OAP
dependency is severed: the OAP build was a different application, its database
held research-era schema, and both went with the old cluster when spec 010
tore it down on 2026-07-17. Nothing is migrated.

## 2. What the realignment changes

The image is not a detail of this spec; it is the reason the spec inverts. All
of the following is verified against the published artifact
(`docker/Dockerfile`, `docker/entrypoint.sh`, `docker/first-boot.mjs`) and
against rauthy 0.36.0, the pinned upstream.

### 2.1 The image is embedded-rauthy and self-seeds

rauthy is not embeddable as a library (knowledge://grand-refactor/01-grounding-record
section 2): binary-only entrypoint, its hiqlite behind a private `OnceLock`,
and the published `rauthy-client` is a remote OIDC client rather than an embed.
"Embedded rauthy" therefore means a **peer process inside the container**, and
that is exactly what ships: the Dockerfile copies the `ghcr.io/sebadob/rauthy:0.36.0`
binary in beside the app, and the entrypoint runs it on loopback `127.0.0.1:8081`
with die-together supervision. It is reachable only through the app's own
`/auth/*` passthrough proxy (`backend/idp/proxy.ts`, spec 002, which owns
`backend/idp/` and brought the rauthy proxy in with the chassis).

`docker/first-boot.mjs` runs before either process and generates into the
`/data` volume. The first four rows below are written once and never
overwritten, so restarts and upgrades keep their identity:

| Material | Path under `/data` |
|---|---|
| Access + refresh RS256 keypairs | `keys/{access,refresh}-{private,public}.pem` |
| The rauthy OIDC client secret | `keys/rauthy-client-secret` |
| The rauthy bootstrap admin password | `rauthy/admin-password` |
| rauthy `ENC_KEYS` / `ENC_KEY_ACTIVE`, its hiqlite Raft + API secrets, and the app's own hiqlite secrets | `rauthy/secrets.env` |
| The declarative rauthy client bootstrap, redirect URIs derived from `ENRAHITU_PUBLIC_URL` | `rauthy/bootstrap/clients.json` |

The fifth row is the exception and it matters: `clients.json` is rewritten
unconditionally on **every** boot, with no existence guard. That is harmless
in itself, because rauthy only reads bootstrap data while its database is
uninitialized, but it produces a trap worth naming here rather than
discovering live. After a public-URL change the file on disk shows correct,
freshly derived redirect URIs while the client actually registered in rauthy
still carries the old ones, and nothing reconciles the two. The file is not
evidence of the running configuration. Section 4.3 rule 3 is the operational
consequence.

The container's only identity inputs are `ENRAHITU_PUBLIC_URL` and
`ENRAHITU_ADMIN_EMAIL`. Everything else about who it is, it decides for itself
on first contact with an empty volume.

### 2.2 Five of the eleven Encore secrets are discarded if injected

`infra.config.json` declares 11 Encore secrets, each `$env`-bound to an
identically named variable. The previous version of this spec concluded that
"the deploy's job is simply to put these 11 on the pod". That is now false for
five of them: the entrypoint **unconditionally exports them from `/data`**
immediately before starting the app, so anything the pod injected is
overwritten in the same shell.

**Discarded if injected** (self-generated, read from `/data/keys/`):
`JWT_PRIVATE_KEY`, `JWT_PUBLIC_KEY`, `JWT_REFRESH_PRIVATE_KEY`,
`JWT_REFRESH_PUBLIC_KEY`, `RAUTHY_CLIENT_SECRET`.

**Genuinely required from the deploy** (nothing in the image can mint them):
`GITHUB_APP_ID`, `GITHUB_APP_PRIVATE_KEY_B64`, `GITHUB_WEBHOOK_SECRET`,
`FLEET_S3_RESTIC_PASSWORD`, `FLEET_S3_ACCESS_KEY_ID`,
`FLEET_S3_SECRET_ACCESS_KEY`, `SMTP_PASSWORD`, `RAUTHY_S3_ACCESS_KEY_ID`, and
`RAUTHY_S3_SECRET_ACCESS_KEY`. (The restic key was spelled `RESTIC_PASSWORD`
until the 2026-07-20 credential split; see section 4.3 rule 2.)

**`SMTP_PASSWORD` joined that list on 2026-07-20**, when section 4.8 item 1
was closed by wiring rauthy's mail transport in the entrypoint. It is the
only secret among the five SMTP keys; the other four are non-secret and
travel as plain env (section 4.4). Before that change the embedded rauthy
kept rauthy's `smtp_url = 'localhost'` default, so every send failed and
password reset, email verification, and MFA recovery did not work.

**`RAUTHY_S3_*` joined it in the same pass**, closing section 4.8 item 2. Note
the asymmetry with `PLATFORM_S3_*`, which is deliberately kept OFF the pod: the
restic CronJob runs as its own workload, whereas rauthy runs *inside* this
container, so its backup credentials have nowhere else to live. Containment is
about which workload holds a credential, not about the word "backup".

The cluster Secret this deploy creates therefore carries **nine** keys, not
eleven. `infra.config.json` keeps all 11 declarations unchanged: Encore
requires every `secret()` a service calls to be defined, and the entrypoint is
what satisfies the five. The rule this spec adopts is that **injecting a
discarded secret is forbidden, not merely redundant**: a Secret key that the
container silently ignores reads as configured while having no effect, which
is the failure mode that produced the previous version's incorrect secret
list.

**A twelfth secret is declared and undeliverable.** `backend/governance/config.ts:51`
declares `secret("GovernanceAnchorKey")`, the Ed25519 anchor signing key of
spec 008's attestation chain. It appears in neither `infra.config.json` nor
the operator catalog, and it is spelled in PascalCase where the other eleven
are `SCREAMING_SNAKE_CASE`, so it has no `$env` binding and no delivery path.
It does not block boot today: Encore resolves secrets lazily at call time, and
nothing calls this one yet. It becomes a hard failure the moment spec 008's
anchor signing is exercised. Closing it means adding the mapping and the
catalog key; this spec records the gap and defers the fix to whichever of 008
or the substrate rewrite lights up the consumer, since inventing a delivery
path for an unused secret would be guessing at its custody.

**The prior "operator prerequisite" is void.** The previous version held that
the four `JWT_*` PEMs "exist in no `.env` and no cluster secret", must be
minted by `npm run generate-keys`, and must be delivered via SOPS or login
returns 500. Two corrections. They now exist in the operator `.env` as real
multi-line PEMs (verified), and more importantly delivering them would be a
no-op for the container, which mints its own. `npm run generate-keys` remains
a genuine prerequisite for a **local** run against a working tree (it writes
the gitignored `keys/`), and that is the only claim this spec makes for it.

### 2.3 The shared-rauthy secret set is void

Spec 010 section 2.1 retired the cluster rauthy and kept its key material,
stating that "every `RAUTHY_*` key the catalog declares is still required, now
by the embedded rauthy inside the control-plane container", and delegated
their delivery here. Delivery is this spec's, and this spec finds the premise
does not survive contact with the image: the embedded rauthy generates its own
`ENC_KEYS`, its own hiqlite Raft and API secrets, and its own bootstrap admin
password, and the entrypoint passes it a deliberately scoped environment that
includes none of the catalog's values.

Against the catalog, the embedded topology settles as follows.

- **Dead, self-generated in-container:** `RAUTHY_RAFT_SECRET`,
  `RAUTHY_API_SECRET`, `RAUTHY_ADMIN_PASSWORD`, `RAUTHY_ENC_KEY_ID`,
  `RAUTHY_ENC_KEY`, `HIQLITE_SECRET_RAFT`, `HIQLITE_SECRET_API`,
  `RAUTHY_CLIENT_SECRET`, and the four `JWT_*` PEMs.
- **Dead, fixed by the chassis:** `RAUTHY_CLIENT_ID`. The entrypoint hardcodes
  the client id `enrahitu`; the catalog key cannot change it.
- **Dead, never wired into the image:** `RAUTHY_S3_ACCESS_KEY_ID` /
  `RAUTHY_S3_SECRET_ACCESS_KEY` (rauthy's hiqlite S3 backups) and the whole
  SMTP group. The entrypoint exports neither, so the embedded rauthy has no
  backup target and no mail transport. Both are real capability losses and are
  carried as named gaps in section 4.8, not quietly dropped.
- **Live, and now the only rauthy keys with a consumer:**
  `GITHUB_UPSTREAM_CLIENT_ID` / `GITHUB_UPSTREAM_CLIENT_SECRET` (section 4.5)
  and `RAUTHY_ADMIN_TOKEN`, the API key the seeder authenticates with. The
  catalog already describes that key in rauthy's `<name>$<secret>` form with
  consumer "seed-rauthy job", which is the mechanism section 4.5 specifies.
  Its description overstates the job's scope, though: it claims the job
  converges "OIDC clients, scopes, and upstream providers", where only the
  provider needs the API. The client is seeded declaratively at first boot
  (section 2.1) and scopes are not converged at all. Narrowing that
  description belongs with the pruning below.
- **Redefined:** `RAUTHY_URL` (section 2.4).
- **Stale, and not this spec's to delete:** `APP_BASE_URL` is declared with
  consumer "app, rauthy redirect", but no code reads it; the app reads
  `WEBAPP_BASE_URL` and `FRONTEND_URL`. `OIDC_SPA_CLIENT_ID`, `OIDC_M2M_CLIENT_ID`, and
  `OIDC_M2M_CLIENT_SECRET` are OAP names with no consumer in this codebase.

**The catalog edit was proposed here and performed in 010.**
`infra/secrets/catalog.toml` is spec 010 territory. Pruning roughly a dozen
keys from a live operator `.env` is a cluster-secret change with its own
validation gate (`npm run secrets:validate` fails on unknown keys), and 010
section 2.1 asserted these keys were required. Resolving that contradiction by
editing the catalog from inside this spec is exactly the move the coherence
guard forbids, so it was raised as human checkpoint 1 (section 6).

**Resolved 2026-07-20.** The operator decided the contradiction in favor of the
verified image behavior and authorized amending spec 010 rather than retaining
the keys. Spec 010 section 2.1 now carries the amendment and the per-key
decision: fourteen keys dropped, the four `JWT_*` PEMs and
`RAUTHY_CLIENT_SECRET` kept but demoted to `required = false` with their local
run named as the consumer (they cannot be dropped, because `npm run
secrets:check` requires every `infra.config.json` secret to be catalogued), and
`RAUTHY_S3_*` plus the SMTP group kept against the named gaps of section 4.8.
The catalog went from 47 keys to 33. Checkpoint 1 is closed; pruning the live
operator `.env` moved to 010's own checkpoint 6.

### 2.4 `auth.statecraft.ing` does not return

Spec 010 section 2.1 retired the `auth.<DOMAIN>` host and handed this spec the
question of whether it survives at all, declining to guess. It does not
survive, and the answer is structural rather than a preference.

The entrypoint sets `RAUTHY_ISSUER="$PUBLIC_URL/auth/v1/"`, gives rauthy
`PUB_URL` equal to the app's own host with `PROXY_MODE=true`, and binds it to
loopback where nothing but the app's proxy can reach it. The whole rauthy
surface (discovery, authorize, token, JWKS, the account UI, the admin UI) is
served same-origin below `https://app.statecraft.ing/auth/`. A second host
could only be an ingress pointed at the same proxy path, and it would mint a
second issuer identity for one IdP.

Consequences: the issuer is `https://app.statecraft.ing/auth/v1/`; the
catalog's `RAUTHY_URL` is redefined from `https://auth.<DOMAIN>` to
`https://<APP_HOST>/auth/v1/` or dropped as derived; and the `auth`
DNS record should be removed rather than repointed (checkpoint 4).

**Settled 2026-07-20: dropped, not redefined.** Of the two options above, spec
010 section 2.1 took the second. `RAUTHY_URL` had no consumer (no code reads
it, and the entrypoint derives the issuer from `ENRAHITU_PUBLIC_URL`), so
keeping it would restate in a settable variable a value the container computes
for itself. `APP_BASE_URL` was dropped with it, and the validator's
`https://auth.<DOMAIN>` derived-agreement formula went with both. Checkpoint 4,
the DNS record removal, is unaffected and still outstanding.

**Noted, and accepted:** the rauthy admin UI is publicly reachable at
`https://app.statecraft.ing/auth/v1/admin`, protected by rauthy's own login.
This is not a regression (the retired `auth.<DOMAIN>` was equally public) but
it is now on the same host as the product, and it is the break-glass surface
of section 4.6. Restricting it at the edge is deferred: doing it in ingress
means path-matching an upstream's UI routes, which breaks on upstream layout
changes, and the substrate rewrite is the right place for the app's proxy to
gate it.

### 2.5 The deferred Grafana OIDC item is void

PR #29 deferred a Grafana OIDC client item from spec 010 to this spec. It is
void, not inherited. Thesis section 3.4 forbids a separate Grafana OIDC client
and any standalone monitoring identity; spec 010 section 2.2 then dropped
Grafana outright with its `grafana-oidc` Secret and both `GRAFANA_OIDC_*`
catalog keys. There is no client to seed, no Grafana to seed it for, and no
successor task. Platform observability is the in-substrate flag-gated
`frontend-admin` (section 4.7).

## 3. Territory

- `.github/workflows/image.yml`: builds the single-container image from
  `docker/Dockerfile` (the enrahitu chassis, spec 002) and pushes to
  `ghcr.io/statecrafting/statecraft` on release and `workflow_dispatch`, amd64
  (the cluster is x86-64). **Landed; see section 4.1.**
- `.dockerignore`.
- `infra/gitops/clusters/statecraft-hetzner/statecraft/` and its tier file
  `infra/gitops/clusters/statecraft-hetzner/statecraft-kustomization.yaml`:
  the statecraft-owned manifests for the Deployment, PVC, Service, Ingress,
  Secret, the seeder Job, and the `/data` backup CronJob (section 4.3 rule 2).
  **Manifests only: this spec is the documentation.** A `README.md` beside
  them is forbidden for the reason one was removed on 2026-07-16: it restated
  the topology and then drifted, and `**/README.md` is a coupling bypass
  prefix, so such a file is a second source of truth no gate checks.

  **Relocated 2026-07-20, from a top-level `deploy/`.** Two claims justified
  the separate directory and both were wrong. The first was that these
  manifests are the artifact the fleet reuses per tenant. They are not:
  `addon/fleet-native/src/resources.rs` builds every tenant resource as typed
  `k8s-openapi` structs in Rust, and spec 006 §1 states its placement shape is
  "distinct from that full tenant-app chart; it is authored here, not lifted".
  There is no chart for tenants to reuse, so section 1's "same shape the fleet
  will run" is a claim about topology (container + volume + ingress), not
  about a shared artifact. The second was that spec ownership required a
  separate root directory. It does not: nested ownership is this corpus's
  established pattern, with spec 002 owning `backend/` while 004, 005, 006,
  and 008 own subdirectories inside it. Spec 010 keeps `infra/`; this spec
  owns the subtree above.

  What decided it is maintainability rather than governance. A second
  top-level location for Kubernetes YAML is how OAP arrived at five of them,
  with cert-manager ClusterIssuers duplicated across `k8s/bootstrap/` and
  `gitops/clusters/hetzner-prod/manifests/`. One Flux tree with one tier per
  concern is the structure that keeps the coupling gate meaningful, and the
  app is a tier like any other: `dependsOn: infrastructure`, so Postgres,
  ingress-nginx, and cert-manager are Ready before the control plane places.

  The one genuine spec 010 touch is a single line added to that tree's root
  `kustomization.yaml` resource list, which is a coordinated edit, not a
  waiver.

  **Landed 2026-07-20:** the tier file plus `pvc.yaml`, `deployment.yaml`,
  `service.yaml`, `ingress.yaml`, and `backup-cronjob.yaml`. The Deployment
  was re-pinned on 2026-07-21 to the image carrying the section 4.8 item 2
  backup wiring, and given the three non-secret `RAUTHY_S3_*` values that
  wiring reads. All five validate
  against the live API server by `kubectl apply --dry-run=server`, which is
  admission validation rather than schema parsing and is non-mutating. Three
  authoring decisions are worth stating here because a reader would otherwise
  read their absence as an oversight.

  **The pinned digest tracks the chassis fixes the live bring-up forced**, and
  each re-pin is recorded because the digest is the deployed truth. After the
  backup-wiring image it advanced twice on 2026-07-21: first to the image that
  forwards `SMTP_STARTTLS_ONLY` (section 4.8 item 1, the only reachable mail
  configuration on this network), then to the image whose rauthy proxy strips
  `Sec-Fetch-*` (spec 002, so the GitHub upstream login callback is not blocked
  as a forged `cors` request). Each re-pin is a mechanical bump of the digest
  comment and value; the reasoning lives in the owning sections rather than in
  the manifest.

  **The tier sets `wait: false`, unlike every other tier in the tree.** First
  boot generates two RS256 keypairs and rauthy's whole database before the app
  answers, and the Deployment cannot become Ready until an operator has
  provisioned the pull secret and the SOPS Secrets. Tying the tier's Ready to
  that would wedge the entire reconciliation on a human step.

  **The seeder Job is deliberately not shipped.** Section 4.5 specifies one,
  but it authenticates with `RAUTHY_ADMIN_TOKEN`, which first boot cannot mint:
  `first-boot.mjs` composes only `clients.json`, never `api_keys.json` (section
  4.8 item 3). A Job that cannot authenticate is worse than no Job, because it
  fails on every reconcile and reads as configured. The GitHub upstream
  provider is therefore created through the admin UI with the break-glass
  account, which is precisely the fallback section 4.5 already names, and the
  same gap means `statecraft_operator` is created by hand rather than from a
  `roles.json`.

  **The pod runs as root, deliberately.** The image declares no `USER`, and it
  writes `/data`, `/rauthy`, and `/data/rauthy/db` directly. Setting
  `runAsNonRoot` without a matching `runAsUser` is exactly what broke the
  fleet's first live deploy (spec 006 E2E finding), so the manifest sets
  `fsGroup` (which is what the hcloud mount actually needs) and nothing else.
  Hardening the image to a non-root UID is an enrahitu chassis change, not
  something to improvise in a Deployment on the way to first boot.
- `.github/workflows/cd.yml`: on push to `main` (sha-pinned) and on
  `workflow_dispatch`; never floats `latest` onto the running release.
- `.github/workflows/ai-pr-review.yml` and `ai-changelog.yml`: ported from OAP
  spec 085, stripped of OAP paths and secrets. **Landed 2026-07-23; see
  section 4.9 for what the port kept and dropped.**

**Cross-spec touches**, each requiring a coordinated edit or a cited waiver:
`infra.config.json` (spec 002) needs a production origin and a metrics block
(sections 4.2, 4.7). `infra/secrets/catalog.toml` (spec 010) needed the pruning
of section 2.3 and the `RAUTHY_URL` decision of section 2.4; **both landed
2026-07-20** in spec 010 section 2.1, on operator authorization, as a 010-owned
edit rather than a cross-spec touch from here.

## 4. Behavior

### 4.1 Image

One amd64 image at `ghcr.io/statecrafting/statecraft:<sha>`, `:latest`, and
the release tag. Private is acceptable; the deploy provides a namespace
`dockerconfigjson` pull secret, matching the fleet finding that the
reflector-synced `ghcr-pull` carries bot credentials without access to new
packages.

**Met 2026-07-16.** The build uses the npm toolchain rather than a vendored
cross-build: `npm ci` on a linux runner pulls the prebuilt Encore runtime,
tsparser, and hiqlite from the `@enrahitu/*-linux-x64` optional dependencies,
and only statecraft's own `governance-native` and `fleet-native` addons build
in CI. Two fixes were needed to reach green: `build:web` needed an explicit
`npm --prefix frontend ci` (the frontend is not a root workspace), and the
prebuilt toolchain binaries require `GLIBC_2.39`, which moved the build to
`ubuntu-24.04` and bumped `docker/Dockerfile.base` from `node:24-slim`
(bookworm, glibc 2.36) to `node:24-trixie-slim` (glibc 2.41). That spec 002
chassis touch was waived at the time and is worth an enrahitu follow-up: the
chassis publishes 2.39 toolchain binaries against a 2.36 base image.

There is no `/health` smoke test in the image job: the control plane needs
Postgres to be healthy, so runtime verification belongs to the deploy.

### 4.2 Topology

On the spec 010 cluster, in its own namespace:

- A **single-replica Deployment**. Single replica is not a simplification to
  be lifted later: the container runs one embedded rauthy and one app hiqlite
  against one volume, so a second replica is a second IdP, not a second copy.
  Horizontal scale is a substrate question (hiqlite Raft membership), not a
  `replicas:` value.
- A **PVC mounted at `/data`**, `ReadWriteOnce` on `hcloud-volumes`. Section
  4.3 is why this is the most important object in the manifest set.
- A **ClusterIP Service** on the app's port.
- An **Ingress at `app.statecraft.ing`**, `ingressClassName: nginx`, TLS via
  `letsencrypt-prod-dns01-cloudflare`. This is the ingress that has never
  existed; creating it is what makes the host real. DNS is an A record to the
  worker, because ingress-nginx tolerates no control-plane taint (spec 010
  section 4).
- A **Secret** with the nine keys of section 2.2, and **no others**.
- **Postgres**: the control plane's own born-empty database on 010's Postgres,
  addressed by `ENRAHITU_LEDGER_URL`; the driver is chosen by URL scheme (spec
  003). CoreLedger's schema init is CREATE-only with no auto-migration, which
  a born-empty database satisfies exactly; it is also why the database must be
  born empty rather than reused.

`infra.config.json` carries `metadata.base_url: http://localhost:8080` and
`env_name: selfhost`. The deployed configuration must carry the real origin.

**`metadata.cloud` must stop saying `local`.** It currently does, while
`env_type` says `production`, and that combination silently disables Encore's
missing-secret guard. `secret()` returns a resolver that throws
`secret <name> is not set` when the value is absent from the runtime config,
**except** when the app metadata reports the Local cloud, where it returns the
empty string instead. `"local"` is exactly the string that maps to that case.
So in the deployed control plane as configured today, a secret that the deploy
forgets, misspells, or fails to mount does not crash the pod: it reads as `""`
and the service proceeds with an empty credential. Several config helpers then
treat empty as "fall back to plain env", which compounds the silence.

The deployed configuration sets `cloud` to a value outside Encore's known set
(`local`, `encore`, `aws`, `gcp`, `azure`), which maps to Unspecified and
restores fail-loud resolution. This is the single highest-value line in the
deployed config, because it converts the failure mode of section 2.2's
nine-key Secret from a silent misconfiguration into a crash loop.

**Done 2026-07-20, and it needed no override machinery.** The fix looked like
it would require mounting a production config over the image's baked-in one,
because `docker/Dockerfile.base:30` copies the generated
`infra.config.docker.json` to `/encore/infra.config.json` and pins
`ENCORE_INFRA_CONFIG_PATH` at it. It did not: **`infra.config.json` is
production-only and local dev never reads it.** The enrahitu toolchain's
`dev.mjs` augments from `infra.config.dev.json` instead (verified at
`node_modules/@enrahitu/toolchain/bin/dev.mjs:50`), and that file carries its
own `env_name: local`, `env_type: development`, `base_url:
http://localhost:4000`. So `cloud: "local"` beside `env_type: "production"`
was a pure production defect with no local consumer, and the correction is a
literal edit: `cloud` is now `hetzner`, `base_url` is
`https://app.statecraft.ing`. `env_name` stays `selfhost`, which is accurate.

Encore's JSON schema types `cloud` as a free-form string, so this validates;
the known-set check that matters lives in the runtime, which is precisely the
layer this line steers.

**Tested live 2026-07-21, and the premise does not hold for these secrets.**
The claim above, including its "single highest-value line" billing, was verified
by the deliberate fail-loud test section 5 asks for, and it failed. With
`cloud: hetzner` in effect (confirmed: the runtime logs `CLOUD_UNSPECIFIED`),
`GITHUB_WEBHOOK_SECRET` was removed from the pod Secret and the pod rolled. It
came up **healthy**, and a request to `/github/webhook` returned `401 invalid
signature`, not the expected crash or a `500 secret ... is not set`. The
resolver returned an empty string and the service proceeded to verify signatures
against it, rejecting every webhook: precisely the silent-empty degradation this
line was supposed to abolish.

The reason is a layer this section did not account for. All eleven secrets are
declared in `infra.config.json` as `{"$env": "<NAME>"}` bindings, and section
2.2 deliberately keeps every one of those declarations. So a secret is **never
"absent from the runtime config"**; it is always configured, to whatever its
env var holds. When the env var is unset the `$env` reference resolves to the
empty string, and "configured to empty" never reaches the "not set" branch that
`cloud != local` re-arms. The `metadata.cloud` distinction is real, but it
governs genuinely unconfigured secrets (the twelfth, `GovernanceAnchorKey`,
which has no `$env` binding, is the one that would actually throw), not the nine
this deploy delivers. `fromSecretOrEnv` (`backend/tenants/config.ts`,
`backend/fleet/config.ts`) then trims the empty value and falls through to
`process.env`, which envFrom left equally empty, so the silence is doubled
exactly as the paragraph above feared, just for a different reason than it gave.

A second correction rides along: these secrets are read **lazily**, inside
per-request config getters, so a missing one does not crash-loop the pod at
boot at all. It yields a healthy pod that fails only when the owning endpoint is
first exercised. The section 5 acceptance wording ("crash-loops the pod") is
wrong on both counts, and is corrected there.

**What real fail-loud would take**, recorded as a recommendation rather than
built here: an explicit startup assertion that the nine required secrets resolve
non-empty (the shape `scripts/verify-born-with.mjs` already uses for other
born-with material), which fails closed regardless of Encore's `$env` behavior.
That is a chassis-or-app change with an owner to assign, not a manifest edit, so
it is named and left for a spec that owns the startup path.

**Built 2026-07-23, and the "not a manifest edit" premise above was wrong.**
The paragraph assumed the assertion had to live where Encore resolves secrets,
inside the app or the chassis. It does not: every key the deploy owes is an
ordinary environment variable at container start (the `envFrom` Secret of
section 4.4), so the Deployment's `command` can wrap the image entrypoint and
assert all ten non-empty (the nine of section 2.2 plus `RAUTHY_API_KEY`, which
joined via the spec 011/012 catalog amendment) before `/enrahitu/entrypoint.sh`
ever runs. A missing or empty key now exits 1 with a `[required-env]` line
naming every absent variable at once, which the die-together restart policy
turns into the crash loop the acceptance always wanted. This is a
manifest-only change in this spec's own territory: no image rebuild, no
chassis divergence, survives re-pins. The chassis-generic version (a
`ENRAHITU_REQUIRED_ENV`-driven assertion inside the entrypoint itself) remains
the better long-term home and is handed to the enrahitu spine as a
substrate-rewrite item; when it lands, this wrapper reduces to setting that
variable.

### 4.3 The volume is the identity anchor

This is the load-bearing operational consequence of the embedded topology and
it has no counterpart in the previous version of this spec.

Every piece of the platform's identity now lives in one PVC: both signing
keypairs, the OIDC client secret, rauthy's encryption keys, and rauthy's
entire hiqlite database, which holds the users, the roles, the client, and
(after section 4.5) the upstream provider configuration. Under the retired
shared-rauthy topology that state lived in the cluster and was reconstructible
from SOPS ciphertext in git. It is not reconstructible now: the material was
generated in-container and exists nowhere else.

Losing the volume is therefore not a restart, it is the loss of the platform's
identity plane: every session and token invalid, every user gone, the upstream
provider unconfigured, and a new client secret that no longer matches anything.
Three rules follow.

1. **The PVC is never deleted as a remediation step.** Recreating the pod is
   safe; recreating the volume is a re-founding.
2. **The volume must be backed up before the platform carries anything real.**
   rauthy's own S3 backup path is not wired into the image (section 2.3), so
   the interim mechanism is volume-level: a scheduled `restic` CronJob against
   a Hetzner bucket. Wiring rauthy's native backups is an enrahitu chassis
   change, tracked in section 4.8.

   **Corrected 2026-07-20.** This rule previously said the job should reuse
   `RESTIC_PASSWORD` and the `FLEET_S3_*` credentials the pod already holds.
   It must not. Those protect **tenant** app volumes and travel with the
   placement path; `/data` is the platform's identity plane, and rule 1 above
   is the whole reason it is treated differently. Reusing the tenant
   credential would encrypt the one artifact this section calls
   unreconstructible under a repository password whose blast radius is every
   tenant, to save two catalog entries. The operator provisioned a separate
   bucket and the `PLATFORM_S3_*` group (spec 010 §4) instead:
   `PLATFORM_S3_ACCESS_KEY_ID`, `PLATFORM_S3_SECRET_ACCESS_KEY`,
   `PLATFORM_S3_RESTIC_PASSWORD`.

   Those three are **not** on the pod. They mount on the CronJob's own Secret,
   on the same reasoning section 4.5 applies to the seeder Job, so the pod
   Secret stays at the nine keys of section 2.2. Custody of
   `PLATFORM_S3_RESTIC_PASSWORD` belongs with the break-glass material
   (section 4.6): losing it and the volume together is unrecoverable, since
   nothing else decrypts the backup.

   **Landed 2026-07-20 as `backup-cronjob.yaml`**, daily at 02:30 UTC against
   `statecraft-platform-backup`, retaining 7 daily / 4 weekly / 6 monthly.
   Two limitations are recorded rather than papered over, because both bound
   what a restore can promise.

   First, it is a **crash-consistent** copy, not a quiesced one: restic reads
   `/data` while rauthy's hiqlite is live, so a restored snapshot is
   equivalent to pulling power at that instant. The fleet solves this by
   scaling the workload to 0 first, which is unavailable here because scaling
   the control plane to 0 is a platform outage. A genuinely consistent backup
   needs rauthy's native hiqlite S3 backup, which is section 4.8 item 2, and
   that remains the real fix rather than this.

   Second, the PVC is `ReadWriteOnce`, so the Job carries a **required**
   podAffinity onto the app pod's node. Required rather than preferred on
   purpose: a scheduling failure should surface as a failed Job, not as a
   backup that silently never runs.

   **The co-mount defect, found live 2026-07-21.** Same-node scheduling is
   necessary but was not sufficient, and the first scheduled run proved it: the
   Job sat in `ContainerCreating` for sixteen hours against
   `MountVolume.SetUp failed [...] mount failed: exit status 255 [...] Resource
   busy`. The cause was the manifest declaring `readOnly: true` on the
   **`persistentVolumeClaim`** rather than only on the `volumeMount`. A
   read-only claim makes the hcloud CSI driver publish a second, fresh `-o ro`
   mount of the underlying block device, which the kernel refuses while the app
   pod holds that device mounted read-write; without it the driver bind-mounts
   the already-staged volume, which is what co-location was for. The
   `volumeMount` keeps `readOnly: true`, so the container's read-only view is
   unchanged and only the publish path differs.

   The design of this rule is unaffected, which is why it is corrected here
   rather than reopened: the mechanism is still a same-node restic sidecar Job
   against the live volume. What the incident changes is the confidence this
   spec can express about it. Acceptance already required a rehearsed restore;
   it now also requires observing **one Job run to completion**, because this
   failure mode is invisible from the CronJob object alone. `kubectl get
   cronjob` reported a healthy schedule with a recent `LAST SCHEDULE` the whole
   time it was failing, which is exactly the "reads as configured" failure the
   seeder Job was kept out of the tree to avoid (section 3).

   The rehearsed restore this spec's acceptance calls for is therefore also
   the test of whether crash-consistency is good enough in practice.
3. **`ENRAHITU_PUBLIC_URL` must be correct before first boot.** The client
   bootstrap derives `redirect_uris`, `post_logout_redirect_uris`, and
   `allowed_origins` from it, and rauthy applies bootstrap data only while its
   database is uninitialized (`migrate_init_prod` returns early once the JWKS
   table is non-empty). Booting once with the wrong public URL leaves a client
   whose redirect URIs are permanently wrong from bootstrap's point of view;
   the fix is then an admin-API correction, not a redeploy. Set it to
   `https://app.statecraft.ing` from the first boot.

### 4.4 Environment

`ENRAHITU_PUBLIC_URL=https://app.statecraft.ing` is the single most important
variable (section 4.3), and `ENRAHITU_ADMIN_EMAIL` sets the bootstrap admin
identity.

**Set by the entrypoint; the deploy must not set them.** `NODE_ENV`,
`AUTH_DRIVER`, `FRONTEND_URL`, `RAUTHY_ISSUER`, `RAUTHY_CLIENT_ID`,
`RAUTHY_REDIRECT_URI`, `RAUTHY_UPSTREAM`, `ENRAHITU_KEYS_DIR`,
`ENRAHITU_HIQ_DATA_DIR`, `ENRAHITU_HIQ_ADDR_RAFT`, `ENRAHITU_HIQ_ADDR_API`.

**Honored if set, and required here:** `ENRAHITU_LEDGER_URL`. The entrypoint
defaults it to a file URL on the volume, so the deploy supplies the Postgres
URL to select the Postgres driver. `ENRAHITU_LEDGER_POOL_SIZE` is optional.

**Read by services, set by the deploy:** `FLEET_BASE_DOMAIN`,
`FLEET_IMAGE_PULL_SECRET`, `FLEET_BACKUP_BUCKET`, `FLEET_BACKUP_S3_ENDPOINT`,
`FLEET_RESTIC_IMAGE`, `FACTORY_TEMPLATE_REPO`, `FACTORY_TEMPLATE_REF`,
`FACTORY_DATA_DIR`, and `STATECRAFT_GOVERNANCE_STATE_DIR`.

`FLEET_IMAGE_PULL_SECRET` was on this list from the start but the
Deployment never set it, found 2026-07-23 while preparing the in-pod fleet
E2E: `fleetImagePullSecret()` resolved empty in production, so placed pods
carried no `imagePullSecrets` and private images could not be pulled at
all. The Deployment now sets it to `ghcr-pull`. It is the NAME of the
dockerconfigjson Secret fleet references on placed pods, not a credential
(the spec 010 catalog carried the opposite claim and is corrected in the
same change); the Secret itself is operator-provisioned in each tenant
namespace, because fleet's RBAC (section 4.2 rbac.yaml) deliberately
grants nothing on secrets.

**`STATECRAFT_GOVERNANCE_CONFIG_DIR` was on that list and must not be, found
live 2026-07-21.** Listing it beside `STATECRAFT_GOVERNANCE_STATE_DIR` treated
two variables as a pair when they are opposites, and the Deployment followed
the spec and pointed both at `/data`. The state dir is mutable chain state and
belongs on the volume. The gate config is a **committed artifact** that ships
inside the image at `/workspace/backend/governance/config/gate.v1.json`, and
`backend/governance/config.ts` already defaults to it correctly by resolving
from `process.cwd()`, which the image sets to `/workspace`. Overriding it aimed
the read at a directory nothing in this system ever creates.

The failure was total rather than degraded: that file is read with
`readFileSync` at **module load**, so the miss is a synchronous `ENOENT` thrown
during ES module evaluation, before any Encore service initializes and with no
route serving. The correct deploy action is to set nothing and let the default
resolve, which is why the variable now appears in this spec only as a
prohibition.

The general rule this deploy keeps rediscovering: `/data` is for what the
container writes, never for what it ships with. The same reasoning already
governs section 4.3's treatment of the volume as the identity anchor.

**Correction:** the previous version wrote
the last two with a lowercase `statecraft_` prefix; the code reads them
uppercase. Environment variable names are case-sensitive, so an operator
following the old spelling would have set variables nothing reads. The same
lowercase spelling survives in a doc comment at `backend/governance/config.ts:16`
(spec 008 territory, comment only, no behavior); worth correcting there when
that file is next touched.

**Read by the embedded rauthy, set by the deploy:** `SMTP_URL`, `SMTP_PORT`,
`SMTP_STARTTLS_ONLY`, `SMTP_USERNAME`, `SMTP_FROM`. These five are non-secret
and travel as plain env; the sixth, `SMTP_PASSWORD`, is a key of the pod Secret
(section 2.2). They are consumed by rauthy, not by any Encore service, which is
why they appear here rather than in `infra.config.json`. The entrypoint forwards
the whole group into the rauthy subshell only when `SMTP_URL` is set, so
omitting it is a supported configuration that disables mail rather than a
failure (section 4.8 item 1).

**`SMTP_PORT` is 587 with `SMTP_STARTTLS_ONLY=true`, and both halves are
load-bearing.** This settled over three edits on 2026-07-21, and the reasoning
is worth keeping because two plausible configurations are wrong here for
different reasons. rauthy builds its transport with lettre's `relay()`, which
opens implicit TLS and needs an implicit-TLS port (465); it speaks STARTTLS on
587 only when `starttls_only` is set. So 587 **without** the flag fails the
handshake against gmail's plaintext greeting (`InvalidMessage(InvalidContentType)`,
misreported at boot as "Check credentials"), and 465 **with** correct TLS is
unreachable, because Hetzner blocks outbound 465 and 25 from this cluster (465
BLOCKED, 587 OPEN, 25 BLOCKED, verified from a pod). Only 587-plus-STARTTLS is
both well-formed and reachable. Forwarding `SMTP_STARTTLS_ONLY` was the spec 002
fourth hunk; it needed a rebuilt image, which is why section 4.8 item 1 tracks
the whole arc.

The dead end this rules out for the reader: choosing 465 to match rauthy's
default TLS mode. It is the natural first guess and it cannot work on this
network, and getting it wrong is not a lost feature but an **outage**, because
rauthy panics on an unreachable mailer (section 4.8 item 1).

`WEBAPP_BASE_URL` is **optional and deliberately left unset**. It only steers
the post-install redirect of the GitHub App flow, and an unset value yields a
relative redirect that lands on this app's own origin, which is correct for a
same-origin deploy. Setting it duplicates the origin in a second place that
can drift.

### 4.5 Identity seeding: what first boot cannot do

First boot seeds the OIDC client and can seed roles, groups, users, scopes,
and API keys, because rauthy reads each from a JSON file in `BOOTSTRAP_DIR`.
It **cannot** seed an upstream auth provider: rauthy 0.36's bootstrap types
are `Client`, `User`, `Group`, `Role`, `Scope`, `UserAttribute`, and `ApiKey`,
and there is no provider among them. Thesis section 3.3 nonetheless requires
customers to authenticate with GitHub OAuth as an upstream provider, so the
gap is real and load-bearing rather than cosmetic.

The mechanism is an API-driven seeder, and rauthy supports it directly:
`POST /auth/v1/providers/create` authorizes via
`validate_api_key_or_admin_session(AccessGroup::AuthProviders, AccessRights::Create)`,
so a bootstrapped API key suffices and no admin session is needed.

The deploy therefore runs a **seeder Job**, after the pod is healthy:

1. First boot bootstraps an API key with `AuthProviders: create` access,
   through `api_keys.json` in `BOOTSTRAP_DIR` (or the `BOOTSTRAP_API_KEY` /
   `BOOTSTRAP_API_KEY_SECRET` pair). Its value is the catalog's
   `RAUTHY_ADMIN_TOKEN`, in rauthy's `<name>$<secret>` form.
2. The Job calls `POST /auth/v1/providers/create` with
   `GITHUB_UPSTREAM_CLIENT_ID` and `GITHUB_UPSTREAM_CLIENT_SECRET`, both of
   which are present in the operator `.env` (verified; the "never ported"
   concern is closed).
3. The Job is **idempotent and convergent**: it lists providers first and
   skips or updates rather than creating a duplicate, because it reruns on
   every deploy while first boot happens once.

The Job's three credentials (`RAUTHY_ADMIN_TOKEN` and the two
`GITHUB_UPSTREAM_*` values) live in **their own Secret, mounted only on the
Job**, never on the app pod. The pod's Secret stays at the nine keys of section
2.2: the control plane never needs to authenticate as an IdP administrator,
and mounting a provider-management credential beside the application would
hand every code path in the app the ability to rewrite the identity plane.

Writing the API key into `BOOTSTRAP_DIR` is an enrahitu chassis change
(`first-boot.mjs` composes that directory), tracked in section 4.8. Until it
lands, the seeder's fallback is an operator-performed provider creation
through the admin UI using the break-glass account, which is a human
checkpoint rather than an automated step.

**The `statecraft_operator` role is seeded the same way**, and more simply,
since roles do have a declarative path: a `roles.json` carrying
`statecraft_operator`. The role flows to the app automatically:
`backend/auth/rauthy.ts` reads the `roles` claim (falling back to `groups`),
and the client's requested scopes already include `groups`. Assigning the role
to the first operator account is a human step (checkpoint 5), because it is an
authorization grant and should not be automated on first boot.

**Gating surfaces on that role is not this spec's work.** `backend/lib/roles.ts`
provides `requireRole`/`hasRole` with any-of semantics, tested, and with no
production callers today. The surfaces that must gate on `statecraft_operator`
(chiefly `frontend-admin`) arrive with the substrate rewrite (thesis section
3.4). This spec provisions the role and the claim path; wiring the checks
belongs to the specs that own those endpoints.

### 4.6 Break-glass

`rauthy_admin` administers the IdP itself and stays with break-glass accounts
(thesis section 3.3). In this topology the break-glass credential is the
bootstrap admin password generated at first boot into
`/data/rauthy/admin-password`, reachable only by `kubectl exec` into the pod,
and used at `https://app.statecraft.ing/auth/v1/admin`.

That is an acceptable posture (possession of it already implies cluster
access, so it grants no privilege an operator lacked) but it is not a
credential policy. Rotating it to a named human account with MFA, and
recording custody, is checkpoint 6.

### 4.7 Observability

Spec 010 provisioned the metrics sink: Prometheus with
`enableRemoteWriteReceiver: true`, no ingress, no LoadBalancer, in-cluster
only. This spec supplies the producer. Encore's self-host metrics config takes
`{ type: "prometheus", remote_write_url, collection_interval }` in
`infra.config.json`, which had **no metrics block at all**, so the control
plane emitted nothing.

**Added 2026-07-20** as a spec 002 coordinated edit, pointed at
`http://monitoring-prometheus.monitoring:9090/api/v1/write` with a 60 second
collection interval. The service name was read from the live cluster rather
than assumed: the kube-prometheus-stack release is named `monitoring`, so its
service is `monitoring-prometheus`, and it is `ClusterIP` with no ingress and
no LoadBalancer, which is the unexposed-sink posture spec 010 section 2.2
requires. `collection_interval` is an integer in seconds per Encore's schema.

**A contract delta, recorded rather than resolved.** Thesis section 3.4 states
that every EnRaHiTu app exposes a Prometheus `/metrics` endpoint, which is a
pull contract. Encore's self-host metrics is push: its exporter does
`remote_write` and there is no scrape endpoint, as spec 010's own
`monitoring.yaml` notes. The control plane will therefore satisfy the
*intent* of the observability contract (its signals reach the platform sink)
while not satisfying its *letter* (no `/metrics` to scrape). Exposing a real
pull endpoint is a substrate capability that does not exist yet; it belongs to
the enrahitu rewrite that owns the contract, not to this deploy. Flagged for
that spec (section 4.8) rather than settled by weakening the thesis.

OTel traces are in the same position and are not configured here.

### 4.8 Upstream gaps this deploy surfaces

Five items belong to the enrahitu chassis, not to this repo, and are recorded
here because this deploy is what makes them concrete. **Items 1, 2, and 5 are
closed** (item 1 reopened 2026-07-21 and re-closed the same day); items 3 and 4
stand. Every closure is an edit to this repo's copy of `docker/entrypoint.sh`,
and together they are one accumulating divergence from upstream, tracked in
spec 002 with a mirror-to-enrahitu follow-up that these keep making more urgent.

1. **The embedded rauthy has no SMTP. CLOSED 2026-07-20, REOPENED then
   RE-CLOSED 2026-07-21.** The story is worth keeping whole, because each step
   was correct on what it knew and wrong on what it did not.

   **Closed 2026-07-20** by forwarding five `SMTP_*` variables so rauthy had a
   mail transport at all, replacing its `smtp_url = 'localhost'` default.

   **Reopened 2026-07-21** when the transport turned out to be unreachable from
   this cluster. Hetzner blocks outbound SMTP egress, verified from a pod rather
   than inferred: **465 BLOCKED, 587 OPEN, 25 BLOCKED**, 443 open as the
   control. The wiring pointed at 465 (implicit TLS), which is exactly the port
   this network blocks. And an unreachable mailer is not a lost feature but an
   **outage**: rauthy's `create_mailer` retries and then `panic!("SMTP
   connection retries exceeded")` (`src/data/src/email/mailer.rs`, doc-commented
   "# Panics"), which the entrypoint's die-together supervision turns into a
   whole-container crash loop. It ran healthy for roughly fifty minutes before
   the retry budget was exhausted, so nothing tied the outage to the change.
   The interim fix disabled SMTP, which the entrypoint supports by gating the
   whole group on `SMTP_URL`.

   **Re-closed 2026-07-21** by making 587 usable. rauthy builds an implicit-TLS
   `relay()` and only speaks STARTTLS when `starttls_only` is set, so the
   working configuration is 587 with `SMTP_STARTTLS_ONLY=true`, which the
   entrypoint had dropped as a sixth variable. Forwarding it (the spec 002
   fourth hunk) and re-pinning the deploy to the image that carries it restores
   mail on the one reachable port. `SMTP_PASSWORD` is the group's only secret
   and stays in the pod Secret; the other four values are non-secret plain env
   (section 4.4).

   **What this unblocks, and what it does not.** With mail reachable, section
   4.6 checkpoint 6 (rotating break-glass to a named human account with MFA) is
   no longer blocked on delivery. It is still an operator action, so break-glass
   stays the generated password at `/data/rauthy/admin-password` until that
   rotation is actually done.

   **A correction this leaves standing.** Section 4.4 first claimed SMTP "costs
   a redeploy, never a re-founding". An unreachable transport costs an outage,
   not merely a redeploy; the re-founding half holds. The claim is kept visible
   with its correction rather than rewritten, because the reasoning error (that
   a per-send setting cannot take the platform down) is the thing worth not
   repeating.

   The wiring, in the image and now reachable:

   The entrypoint
   exported no mail configuration, so rauthy kept its `smtp_url = 'localhost'`
   default and every send failed: no password reset, no email verification, no
   MFA recovery. It was closed rather than carried because the cost was eight
   lines and the credentials already existed. `docker/entrypoint.sh` now passes
   the five SMTP variables into the rauthy subshell, gated on `SMTP_URL` so a
   local trial of the image still needs no mail server. rauthy reads those
   exact names (its `config.toml` documents each as "overwritten by:
   `SMTP_*`") and the catalog's smtp group already used the same spellings, so
   no translation layer was needed.

   **Why it mattered less than it looks, and still mattered.** Thesis section
   3.3 puts exactly two populations in this IdP: customers authenticating
   through GitHub OAuth upstream, and operators. Neither signs up with a
   password, so the headline flows never needed mail: GitHub already verified
   the address, and the break-glass admin password is read from
   `/data/rauthy/admin-password` by `kubectl exec` rather than emailed. What
   did need it is recovery on the margins, which is exactly where an identity
   plane must not be brittle: MFA reset, email-change verification, and the
   named human operator account of section 4.6 checkpoint 6.

   **This is a spec 002 touch, and a divergence from upstream.**
   `docker/entrypoint.sh` was byte-identical to enrahitu's copy before this
   change. Mirroring it into `statecrafting/enrahitu` is a follow-up; until
   that lands the two differ, and the next chassis sync must not silently
   revert this.

   Unlike `ENRAHITU_PUBLIC_URL` and `ENRAHITU_ADMIN_EMAIL`, SMTP is read per
   send rather than at bootstrap, so getting it wrong is a redeploy and never
   a re-founding (contrast section 4.3 rule 3).
2. **The embedded rauthy has no backup target. CLOSED 2026-07-20.** The
   entrypoint exported no S3 configuration, so rauthy's native hiqlite backup
   never ran and `RAUTHY_S3_*` had no consumer. Closed the same way item 1 was,
   and for a better reason than symmetry: this is the **only consistent backup
   of the identity database**. The restic CronJob of section 4.3 rule 2 copies
   `/data` at file level while hiqlite is live, so it is crash-consistent;
   rauthy's own backup is a quiesced snapshot.

   The entrypoint maps the operator-facing `RAUTHY_S3_*` names onto rauthy's
   `HQL_S3_*`, gated on `RAUTHY_S3_URL` so omitting the group disables backups
   rather than failing the boot. `RAUTHY_S3_ACCESS_KEY_ID` and
   `RAUTHY_S3_SECRET_ACCESS_KEY` therefore join the pod Secret (section 2.2);
   the URL, bucket, and region are non-secret plain env.

   **The two mechanisms are ordered to compose, not to overlap.** rauthy's
   backup is scheduled at 01:30 UTC, one hour before the restic CronJob at
   02:30, and rauthy writes its dump locally as well as to S3. The volume
   backup therefore captures a fresh quiesced dump alongside the live and
   inevitably torn database files, which materially improves what a `/data`
   restore can recover even though the file-level copy is unchanged.
3. **`BOOTSTRAP_DIR` carries only `clients.json`.** Roles and the seeder API
   key need `first-boot.mjs` to compose `roles.json` and `api_keys.json`
   (section 4.5).
4. **No `/metrics` pull endpoint** (section 4.7).
5. **`RP_ORIGIN` was derived without a port, and it blocked first boot.
   CLOSED 2026-07-21.** The entrypoint passed `ENRAHITU_PUBLIC_URL` straight
   into rauthy's `RP_ORIGIN`. rauthy validates that value by splitting on the
   last colon and parsing the tail as a port, so a bare
   `https://app.statecraft.ing` failed on the scheme colon and aborted the
   process before it served. The fix rebuilds the origin with an explicit port
   (spec 002 carries the mechanism and the reasoning).

   **This is the one item on this list that was not merely a capability loss.**
   Items 1 through 4 constrain what the platform can claim; this one meant the
   platform did not run. It is also the item this deploy was uniquely
   positioned to find: it cannot reproduce locally, where the public URL is
   `http://localhost:4000` and already carries a port, so the first
   port-less public URL in the project's history was the production one.

   The cost was seventeen hours of `CrashLoopBackOff` (214 restarts) that no
   gate reported, because every gate this repo runs is green on the change that
   shipped it: the image builds, the manifests pass server-side admission, the
   coupling gate is satisfied, and the Deployment's own tier sets `wait: false`
   (section 3) so Flux reports the tier Ready while the pod never becomes so.
   That combination is worth stating plainly rather than filing as bad luck:
   **this repo currently has no gate that fails when the published image cannot
   start.** Section 4.1 declined a `/health` smoke test in the image job on the
   grounds that the control plane needs Postgres; that reasoning holds for the
   app but not for the embedded rauthy, which needs nothing but its own volume
   and would have panicked identically in CI. Closing that hole is an enrahitu
   chassis question (the entrypoint is the unit under test), and it is named
   here as the successor task rather than improvised into this deploy.

None of items 1 through 4 block the deploy; all four constrain what the
deployed platform can honestly claim, which is why they are named. Item 5 did
block it, and is closed.

### 4.9 Ported CI

`ai-pr-review.yml` runs the Claude CLI over the PR diff and posts a review;
`ai-changelog.yml` is its companion. No API key is committed. The PR **gate**
is already covered by this repo's `spec-spine.yml` (coupling) and `verify.yml`
(typecheck/test); port only the missing orchestration if a single required
check is wanted, not OAP's service-specific fan-out.

**Landed 2026-07-23.** What the port kept from OAP: the stdin-fed diff (no
shell evaluation of contributor-controlled content), the pinned CLI version,
the draft-PR skip, the `DIFF_SIZE_CAP` guard with a visible skip comment, the
API-failure classification (auth errors fail the job; outages pass loudly with
a posted notice so a third-party incident never blocks merges silently), and
the retrying comment post. What it dropped: OAP's `workflow_call` dispatch
(this repo has no ci.yml orchestrator, so the trigger is plain `pull_request`;
a dispatch trigger would carry no PR context and was not kept) and the entire
Local-Review-Evidence verifier mode,
because this repo's `/ship` posts no such evidence comment and dead trust
plumbing reads as configured. The review prompt is retargeted at this corpus:
bugs, security, and spec-spine coupling (specs as design truth) rather than
OAP's `Feature:` annotations. Auth is `CLAUDE_CODE_OAUTH_TOKEN`, a repository
secret the operator must set; the job fails with a distinct error when it is
absent, never a silent green. `ai-changelog.yml` keeps its release-published
trigger and appends the generated changelog to the release body; it is inert
until this repo cuts releases, which `image.yml` already anticipates.

Threat model: stdin delivery prevents shell evaluation of
contributor-controlled content, but LLM-level prompt injection through a
crafted diff or commit message remains possible and is accepted. The blast
radius is a PR comment or a release body, both human-read surfaces with no
privileged side effects; neither workflow grants the model tools or write
access beyond the posted text.

## 5. Acceptance

- `image.yml` publishes a pullable `ghcr.io/statecrafting/statecraft`,
  verified by pulling it. **(Met 2026-07-16.)**
- The deploy stands the control plane up on the 010 cluster with no OAP chart,
  CD, or secret dependency, against its own born-empty database.
- The pod's Secret carries exactly the nine keys of section 2.2. Verified by
  absence as much as presence: no `JWT_*` and no `RAUTHY_CLIENT_SECRET` is
  injected.
- Missing secrets fail loud: with `metadata.cloud` off `local` (section 4.2),
  removing a required key from the Secret crash-loops the pod rather than
  yielding an empty credential. Verified once, deliberately, before go-live.
  **Tested 2026-07-21, and NOT met.** The test was run and the premise failed:
  a removed `GITHUB_WEBHOOK_SECRET` yielded a healthy pod and a silent empty
  credential (`/github/webhook` returned `401`, not a crash or a
  `secret ... is not set`), because every secret is `$env`-bound in
  `infra.config.json` and an unset env var resolves to empty rather than
  "not set" (section 4.2). This criterion is not currently satisfiable by the
  `metadata.cloud` mechanism alone; closing it needs an explicit non-empty
  startup assertion (section 4.2's recommendation). Two of this criterion's
  own words are also wrong: resolution is lazy, so a missing secret fails at
  first use of the owning endpoint, not as a boot crash-loop.
  **Mechanism landed 2026-07-23:** the Deployment `command` wrapper of
  section 4.2 asserts all ten required keys non-empty before the entrypoint
  runs, so a removed key now fails the container at start, loudly and by
  name. The deliberate live re-test (remove one key, watch the crash loop,
  restore it) is still owed once, after Flux reconciles the wrapper; until
  that run this item stays open by its own "verified once, deliberately"
  wording.
  **Run 2026-07-25, and MET.** `GITHUB_WEBHOOK_SECRET` (the same key the
  2026-07-21 run used, so the two are directly comparable) was removed from
  the live pod Secret and the pod replaced. The container refused to start,
  by name, and stayed refused: `[required-env] GITHUB_WEBHOOK_SECRET is
  empty or unset` / `[required-env] refusing to start; missing:
  GITHUB_WEBHOOK_SECRET`, exit code 1, `CrashLoopBackOff` within 33 seconds,
  and the public edge served 503 rather than the silent `401` of 2026-07-21.
  Restoring the key and replacing the pod returned the edge to 200. This
  criterion is now satisfied; the amendment below records the run and the
  two findings it produced.
- `https://app.statecraft.ing` serves the governance UI over a real cert (not
  the ingress default certificate).
- OIDC discovery at `https://app.statecraft.ing/auth/v1/.well-known/openid-configuration`
  returns an issuer of `https://app.statecraft.ing/auth/v1/`, and no
  `auth.statecraft.ing` host resolves.
- A real login completes end to end against the container's embedded rauthy.
  This closes spec 010's deferred acceptance. **(Met 2026-07-22, checkpoint 5.)**
- A GitHub upstream login completes, proving the seeder's provider
  configuration (section 4.5).
- An account holding `statecraft_operator` presents that role in its claims,
  observable through the app's own user model. **(Met 2026-07-22, checkpoint 5.)**
- Prometheus shows control-plane series arriving by `remote_write`.
- The volume backup of section 4.3 rule 2 exists and a restore has been
  rehearsed at least once.
- `ai-pr-review.yml` runs on a PR and posts a review; spine gates and verify
  green. **Workflow landed 2026-07-23 (section 4.9); the claim needs its
  first real posted review, which is gated on the operator setting the
  `CLAUDE_CODE_OAUTH_TOKEN` repository secret. The PR that carries the
  workflow exercises it the moment the secret exists.**

Retiring the OAP release is not this spec's acceptance: the old cluster was
deleted wholesale by spec 010 on 2026-07-17, taking the release and its
database with it.

### 5.1 Bring-up outcome, 2026-07-21

First boot succeeded. The control plane is live at `https://app.statecraft.ing`
against its own born-empty database, and the identity plane is founded: both
RS256 keypairs, the OIDC client secret, the bootstrap admin password, and an
initialized rauthy hiqlite database all exist under `/data`.

**Met, each verified against the live system rather than by inspection:**

| Acceptance item | Evidence |
|---|---|
| Serves over a real cert | 200, Let's Encrypt `CN=app.statecraft.ing` |
| OIDC issuer, no `auth` host | issuer `https://app.statecraft.ing/auth/v1/`; `auth.statecraft.ing` NXDOMAIN |
| Secret carries exactly nine keys | nine present, all five discarded keys absent |
| Metrics by `remote_write` | `e_requests_total`, `e_sys_memory_used_bytes`, `env_name=selfhost`, ~17s fresh |
| Volume backup exists | restic snapshot `779acd3e`, 7.718 MiB, taken with the pod holding the volume |
| Upstream provider seeded | `GET /auth/v1/providers/minimal` returns the GitHub provider |

**Not met, and not to be read as nearly met:**

- ~~A real login has not completed end to end~~ **Closed 2026-07-22
  (checkpoint 5).** The operator-admin login and the `statecraft_operator`
  grant both landed, so this item and the operator-claim item are met and
  spec 010's deferred login acceptance closes with them; see the 2026-07-22
  closure below.
- **Fail-loud is exercised and does not hold.** The deliberate test section 5
  asks for was run on 2026-07-21, and it disproved the mechanism rather than
  confirming it: a removed required secret yields a healthy pod and a silent
  empty credential, because `$env`-bound secrets resolve absent-as-empty and
  never reach the `cloud != local` throw path (section 4.2). Real fail-loud
  needs an explicit non-empty startup assertion, which is named as a
  recommendation and left to the spec that owns the startup path. This is a
  genuine open gap, not a formality: a forgotten or misspelled secret degrades
  this platform silently today.
- ~~**`ai-pr-review.yml` does not exist**, so that line cannot be claimed.~~
  **Landed 2026-07-23** (section 4.9); the first posted review is gated on
  the operator-set `CLAUDE_CODE_OAUTH_TOKEN` secret.

**Closed after the initial bring-up, 2026-07-21:**

- **The restore is rehearsed.** A Job restored the latest restic snapshot into
  scratch space (never touching `/data`) and verified every piece of identity
  material present and readable: both keypairs, the client secret, the admin
  password, `secrets.env`, and the rauthy hiqlite database. Checkpoint 7's
  outstanding half is closed; a snapshot is now known to be a restorable
  identity plane, not merely a stored blob.
- **Mail delivers.** SMTP was disabled during the SMTP-port incident and is
  restored on 587 with STARTTLS (section 4.8 item 1). Checkpoint 6 is unblocked
  as a result, though the rotation it calls for is still operator work.

**Closed 2026-07-22: the operator grant and the real login.** Checkpoint 5 is
closed and both its acceptance items are met, each verified against the live
system:

- **The grant landed.** `statecraft_operator` was added to
  `admin@statecraft.ing` alongside its existing `rauthy_admin` and `admin`
  (appended, never replaced, so break-glass is intact). The rauthy hiqlite
  `users` row now reads `admin,rauthy_admin,statecraft_operator`.
- **The claim reaches the app's user model.** After a fresh app login the
  CoreLedger `user_account` row for the operator reads
  `["admin","rauthy_admin","statecraft_operator"]` with a `last_login_at`
  after the grant. That row is exactly what `GET /api/v1/auth/me` returns
  (`backend/auth/me.ts`), so the OIDC `roles` claim provably flows
  claim -> `profileFromClaims` -> `upsertUserFromProfile` -> user model. This
  is the real end-to-end login that also closes spec 010's deferred login
  acceptance.
- **The grant is operator work because the admin account is passkey-gated,
  which section 4.5 did not record.** `admin@statecraft.ing` has a registered
  WebAuthn passkey (`RauthyAdmin`), so `POST /auth/v1/oidc/authorize` returns
  the `WebauthnLoginResponse` MFA challenge (HTTP 200, "correct credentials,
  needs Webauthn MFA") after a correct password. No `rauthy_admin` session,
  and therefore no role grant, can be obtained without the physical
  authenticator; the grant was performed through the admin UI by the operator.
  The next operator provisioning an `<app>_operator` role will hit the same
  wall, which is why it is named here rather than left to rediscovery.

**Three defects blocked first boot, and none was caught by any gate.** Each is
recorded where it belongs (4.8 item 5, 4.4, and 4.8 item 1) rather than
summarized away: a port-less `RP_ORIGIN` that made rauthy panic before serving,
a gate-config path aimed at the volume instead of the image, and an SMTP
transport that was unreachable from this network. The first cost seventeen
hours of `CrashLoopBackOff`; the third cost a second outage roughly fifty
minutes after a rollout that looked healthy.

The common shape is worth stating once, because it is the argument for the
successor task in 4.8 item 5: **every one of these shipped green.** The image
built, the manifests passed server-side admission, the coupling gate was
satisfied, and the statecraft tier sets `wait: false` by design, so Flux
reported Ready while the pod never became so. This repo still has no gate that
fails when the published image cannot start.

## 6. Human checkpoints

Live bring-up is operator work, proposed here rather than performed.

1. **Decide the catalog pruning. CLOSED 2026-07-20.** Section 2.3 found that
   roughly a dozen catalog keys lost their consumer, contradicting spec 010
   section 2.1's statement that every `RAUTHY_*` key is still required. The
   operator decided to amend 010 to the verified image behavior rather than
   retain the keys, and the amendment landed in 010 section 2.1 with the
   per-key decision (section 2.3 above). What remains is operator work on the
   live `.env`, tracked as 010 checkpoint 6, not a decision.
2. **Delete the two `GRAFANA_OIDC_*` lines** from the operator `.env`, which
   is spec 010 checkpoint 3. **Done:** `npm run secrets:validate` was green
   against the live file on 2026-07-20 before the catalog amendment, which is
   only possible with both lines gone.
3. **Confirm `ENRAHITU_PUBLIC_URL` before the first boot.** Section 4.3 rule
   3; the cheapest checkpoint here and the most expensive to miss.
4. **Remove the `auth.statecraft.ing` DNS record** (section 2.4) and add the
   `app` A record to the worker IP. Out-of-band at Cloudflare, like the
   firewall rules. **CLOSED 2026-07-21:** `app.statecraft.ing` resolves to the
   worker and `auth.statecraft.ing` is NXDOMAIN, both verified live.
5. **Grant `statecraft_operator`** to the first operator account, and confirm
   the claim reaches the app. **CLOSED 2026-07-22.** The role was granted to
   `admin@statecraft.ing` through the admin UI (appended to `rauthy_admin` and
   `admin`, so break-glass is preserved), and the claim was verified reaching
   the app end to end: after a fresh login the CoreLedger `user_account` row,
   the exact payload `GET /api/v1/auth/me` serves, reads
   `["admin","rauthy_admin","statecraft_operator"]` with a post-grant
   `last_login_at`. The grant is an admin-UI action rather than an automated
   step for two reasons: the seeder Job that would carry a `roles.json` is not
   shipped (section 4.5), and the admin account is passkey-gated, so a correct
   password yields only a `WebauthnLoginResponse` MFA challenge and an admin
   session needs the operator's physical authenticator (recorded in section
   5.1's 2026-07-22 closure). Granting a role is the authorization decision,
   which is why it stayed a human step. The GitHub upstream provider was
   already confirmed live 2026-07-21 by `GET /auth/v1/providers/minimal`.
6. **Take custody of the break-glass admin credential** (section 4.6): read it
   from the volume, rotate it to a named account with MFA, and record where it
   lives. **Unblocked 2026-07-21** now that SMTP delivers on 587 (section 4.8
   item 1 re-closed): the enrolment and MFA-verification mail a named account
   needs can now be sent. Still outstanding as an operator action; until it is
   done, custody is the generated password at `/data/rauthy/admin-password`,
   reachable only by `kubectl exec`.
7. **Verify the volume backup and rehearse a restore** before the platform
   holds anything real (section 4.3 rule 2). **CLOSED 2026-07-21.** The backup
   is verified (snapshot `779acd3e`, 7.718 MiB across 18 files, written while
   the app pod held the volume, the co-mounted case an earlier run did not
   exercise), and the restore is rehearsed: a Job restored the latest snapshot
   into scratch space, never touching `/data`, and confirmed both keypairs, the
   client secret, the admin password, `secrets.env`, and the rauthy hiqlite
   database are present and readable. A snapshot is now known to be a restorable
   identity plane, which is the half that carries the meaning.

## 7. Out of scope

- **The cluster and its platform services**: Flux, SOPS, cert-manager,
  ingress-nginx, reflector, Postgres, NSQ, Prometheus, object storage, and DNS
  provisioning are all spec 010. This spec deploys one application onto a
  cluster it assumes exists.
- **The enrahitu chassis changes of section 4.8.** They are named here and
  owned upstream; this spec deploys the image as published.
- **Gating operator surfaces on `statecraft_operator`** (section 4.5) and
  `frontend-admin` itself, which arrives with the substrate rewrite.
- **A crypto service for stored credentials.** Spec 010 section 7 records that
  the control plane stores no secret at rest and that OAP's
  `PAT_ENCRYPTION_KEY` has no successor, because spec 004's GitHub App flow
  mints short-lived installation tokens instead of storing customer
  credentials. Its absence from the operator `.env` is therefore correct and
  is not a gap this deploy fills. That decision stays conditional on the App's
  permission set covering every console verb, which is a spec 004 gate.
- **Alerting policy**, and the question of which consumer reads Prometheus.
- Non-hetzner deployment targets.
- Multi-replica or HA control plane (section 4.2 explains why this is
  structural, not deferred tuning).
- Re-homing the marketing site: the apex stays GitHub Pages.

## Amendment (2026-07-22): re-pin to the spec 012 image

The Deployment moves to digest `ce8edee5` (tag `dfe27c1`, the spec 012
merge): the first image carrying the operator dashboard (spec 012) and
the spec 011 tenant-lifecycle code. The spec 011 §9 one-time
`user_account` ALTER (github_user_id + github_login) was applied to the
live database before this pin (its stamp_job precursor already
existed), so the new image's auth store boots against a compatible
schema. `RAUTHY_API_KEY` remains unminted (spec 011's remaining
deploy-time act); github-identity resolution degrades to a logged
`no_api_key` skip until it exists, which blocks nothing in this deploy.

**Closed later the same day.** The operator had already minted the key
(read scopes: users, roles, groups, clients, sessions, scopes, user
attributes) and held it in the operator `.env`; the pod Secret
(`statecraft-secrets.sops.yaml`, this spec's territory) gains
`RAUTHY_API_KEY` as its tenth key, the Deployment's envFrom comment is
updated, and the catalog/infra-config declarations land in specs
010/002 territory with their own amendments. A pod restart after the
Flux apply makes the key visible to the app.

## Amendment (2026-07-22): spec 012 frontend-admin adoption, deploy env

Spec 012 makes one coordinated edit in this spec's deploy manifest
territory (`infra/gitops/.../statecraft/deployment.yaml`): the pod env
gains `ADMIN_UI_ENABLED="true"`, the runtime kill switch for the
operator dashboard (enrahitu spec 023 §3.1); flipping it to "false"
serves 404 on `/admin` and `/api/admin/*` without a rebuild.
`OTEL_EXPORTER_OTLP_ENDPOINT` is deliberately unset: no collector
exists, and traces live in the in-app ring buffer the dashboard renders
(enrahitu spec 022). The image (unchanged mechanics, §4.2) now carries
`app-model.json`, the built `backend/web/dist-admin/` bundle, and
serves `/metrics`; the pod scrape annotations and the ingress /metrics
exclusion are spec 010's half of this adoption (its 2026-07-22
amendment). The §7 exclusion of "`frontend-admin` itself" stands: the
surface arrived with spec 012, not this spec.

## Amendment (2026-07-22, second pin): the spec 011 walk-fix image

The Deployment moves to digest `aeefe203` (tag `07a723f`, the PR #60
merge). Three fixes ride it, all surfaced by spec 011's live acceptance
walk: fleet remove forwards `subject_name`/`confirm_name` into the
action gate (governance-native's `confirm-name-required` check denied
every production remove without them), the SPA encodes DELETE payloads
as query parameters (Encore's decode contract; tenant delete, fleet
remove, and operator membership revoke were unusable from the UI), and
the dashboard gains the spec 011 §5.6 tenant-less install entry. No
schema or secret deltas; a pod delete after the Flux apply picks up the
image.

## Amendment (2026-07-22): fleet placement RBAC

Spec 011's acceptance walk surfaced that the pod ran as the namespace
default ServiceAccount with no cluster grants, so every fleet placement
and teardown died Forbidden at the API server (spec 006's first-deploy
"works at placement" finding predates the cluster rebuild; the rebuilt
cluster never carried the grants). The manifests gain `rbac.yaml`: a
dedicated `statecraft` ServiceAccount, a `statecraft-fleet` ClusterRole
scoped to exactly the resource types fleet-native touches (namespaces
get/list/create; deployments, services, PVCs, jobs, ingresses,
networkpolicies full lifecycle), and its ClusterRoleBinding; the
Deployment's pod template adopts the ServiceAccount. A ClusterRole
because tenant namespaces (`t-<tenantId>`) are dynamic.

## Amendment (2026-07-23, third pin): the fleet placement enablers

The Deployment moves to digest `f9fa57c9` (tag `676b642`, the PR #65
merge). It carries the spec 006 amendment's deploy-chosen container port
(persisted on `fleet_app`; the `BIGINT` ALTER was applied to the live
database before this pin, so no ordering window existed) and the code
that reads `FLEET_IMAGE_PULL_SECRET`, which the same PR added to this
Deployment's env (section 4.4 note). One secret-shaped delta rides the
manifest rather than the pod Secret: `FLEET_IMAGE_PULL_SECRET` is a
resource name and travels as plain env. The digest change rolls the pod
by itself (Recreate); no pod delete is needed.

## Amendment (2026-07-23, fourth pin): fleet-native 0.2.0

The Deployment moves to digest `43717a27` (tag `5cbbded`, the PR #67
merge). It carries exactly one change: the `@statecrafting/fleet-native`
pin at 0.2.0, whose per-app ingress-allow NetworkPolicy ends the
namespace-wide port pin the 2026-07-23 in-pod two-stage E2E surfaced
(spec 006 amendment, statecrafting spec 006 amendment). No schema delta,
no new secret, and no env change rides this pin; the digest change rolls
the pod by itself (Recreate). Post-roll the operator deletes the stale
hand-patched `fleet-allow-ingress-nginx` from the test tenant namespace,
per the spec 006 amendment's migration note.

## Amendment (2026-07-25): the fail-loud test, run at last, and what it found

Section 5's oldest open acceptance item is closed. The test it asks for
("remove a required key, watch the crash loop, restore it") ran against
the live control plane on 2026-07-25, deliberately, once.

Method, recorded because the restore path is the part worth copying: the
`secrets` Flux Kustomization was suspended first, so reconciliation could
not race the test, and resumed afterwards, so the restore came from git
rather than from anything typed by hand. `GITHUB_WEBHOOK_SECRET` was
removed from the pod Secret with a JSON-patch `remove`, and the pod was
replaced by deleting it (never `kubectl rollout restart` on a
Flux-managed Deployment). The same key the failed 2026-07-21 run used, so
the two results are directly comparable.

Result, the exact inversion of 2026-07-21:

```
[required-env] GITHUB_WEBHOOK_SECRET is empty or unset
[required-env] refusing to start; missing: GITHUB_WEBHOOK_SECRET
```

exit code 1, `CrashLoopBackOff` within 33 seconds of the replacement, and
`https://app.statecraft.ing` serving 503. In 2026-07-21 the same removal
produced a healthy pod and a silent `401`. The wrapper does what section
4.2 built it to do: the failure is loud, immediate, names every missing
variable at once, and fails closed at the edge. Restoring the Secret
through Flux and replacing the pod returned the edge to 200; the restored
value was byte-compared against the pre-test value before the local copy
was destroyed. Total deliberate downtime, about three minutes.

### Finding 1: rauthy is never asked to stop, and it costs restarts

The recovery restart did not come up first try. It crash-looped three
times before a boot got through, on a pod replacement with nothing else
wrong with it, and the reason is a defect this test would never have been
looking for:

```
thread 'tokio-rt-worker' panicked at hiqlite-wal-0.14.0/src/log_store.rs:47:21:
LockFile /data/rauthy/db/logs is locked and in use by another process
```

`docker/entrypoint.sh` is PID 1, and it had no signal handler. The
runtime signals PID 1 and nothing else, so on every container stop the
shell died alone and rauthy was SIGKILLed at the end of the grace period,
never releasing its hiqlite WAL and state-machine locks. Every boot after
every restart therefore began unclean (three `LockFile ... exists
already - this is not a clean start!` warnings, present on the successful
boot too), and intermittently the stale lock was read as live and aborted
rauthy outright, which die-together turns into a crash loop.

This is the same failure shape as the seventeen-hour outage in section
4.6 item 5, reached by a different route: anything that aborts rauthy
becomes a container crash loop, and this one is reachable from an
ordinary `kubectl delete pod`. Fixed in this repo's copy of the
entrypoint (spec 002 owns `docker/`) and upstream in the enrahitu chassis
(its spec 007); stamped apps each carry their own copy, so the handler
does not arrive by a pin. **The fix is not yet in the deployed image**:
the running digest predates it, so the residual is one image rebuild and
digest re-pin, deliberately not improvised on the same night as the test.

### Finding 2: the backup errors are replayed history, not failing backups

The recurring `Error creating backup: ... output file already exists`
noted after the 2026-07-24 E2E is diagnosed and is not what it looks
like. Backups are healthy: rauthy's hiqlite writes one file per day at
01:30 into `/data/rauthy/db/state_machine/backups`, and four consecutive
daily files were present with no gaps.

The errors are raft log replay. On boot hiqlite re-applies the `Backup`
entries in its log, each with its **original** timestamp, and the
timestamp is the backup filename, so `VACUUM main INTO` targets a file
that already exists and fails. The count is exactly the number of
retained backups: four errors, matching the four files, all emitted
within 200ms of startup. Upstream knows: `writer.rs` carries the literal
`TODO include a TS in the req to skip backups if they are replayed after
a restart`.

So the earlier "every few minutes" reading was wrong. It is once per
boot, once per retained backup, and the E2E made it look periodic only
because the pod was restarting repeatedly (Finding 1 explains why it was
restarting more than expected). It is cosmetic: the replayed backup
fails, the real daily backup succeeds, and the existing file is left
intact. It is also **not ours to fix** and is recorded here rather than
queued: rauthy pins `hiqlite` 0.14.0 from crates.io with the
`[patch.crates-io]` block commented out, so the fork under `DevDep`
is not in this image's dependency path at all. The one real cost is that
it grows with `HQL_BACKUP_KEEP_DAYS` (30 here), so a month from now every
boot will log thirty of these, and a genuine backup failure would be
harder to see among them. Worth an upstream issue, not a local patch.

## Amendment (2026-07-25, fifth pin): the stop handler reaches production

The Deployment moves to digest `780eeefe` (tag `7ff1347`, the PR #72
merge). This pin exists because the amendment above closed an acceptance
item by finding a defect, and the fix it produced could not reach the
cluster without a rebuild: the running image predated it. Two changes
ride the pin, from two different specs' territory.

The first is Finding 1's fix. `docker/entrypoint.sh` (spec 002's
territory, mirrored upstream in the enrahitu chassis) installs `TERM` and
`INT` traps that forward the stop to rauthy and the app and then wait for
them, so rauthy releases its hiqlite WAL and state-machine locks on the
way out. The trap is installed immediately after rauthy is backgrounded
rather than after the app starts, so a stop arriving during the rauthy
health wait is handled too. This ends the crash-loop-on-restart shape
that made an ordinary `kubectl delete pod` a gamble.

The second is spec 006's name-reuse fix: `fleet_app.name` keeps its index
and loses `unique`, uniqueness is scoped to non-removed rows and enforced
fleet-wide in `store.ts`, and deploy answers a typed 409 before the
action gate. The deploy ordering here is inverted from the usual and
worth stating, because it means this pin carries less risk than it looks
like: the `DROP CONSTRAINT` was applied to the live database on
2026-07-25 ahead of the merge (precedent: the `port` `BIGINT` ALTER,
third pin), and since the deployed code has no name check at all, that
ALTER alone already fixed the production symptom. What the image adds is
the typed 409 for a name that is genuinely still live. One consequence
does arrive with the image rather than before it: `ensureSchema` emits
the plain `idx_fleet_app_name` only when the column is not unique, so the
index appears on this image's **first boot**, not on the boot after the
ALTER (verified absent across two boots, spec 006 amendment).

No schema delta rides this pin (the ALTER preceded it), no secret delta,
and no env change. The digest change rolls the pod by itself under
`Recreate`; no pod delete is needed.

### Acceptance, verified live 2026-07-26

Three signals rather than the usual one. All three hold.

1. **The roll.** Flux applied `main@5d29590`; the Deployment replaced
   the pod under `Recreate` with no intervention, and the new pod came
   up `Ready` on `780eeefe` with zero restarts. The edge served 200.
2. **The clean stop, and the clean boot after it.** A deliberate
   `kubectl delete pod` returned in **two seconds** rather than running
   the grace period out, which is the first observable difference: the
   stop is now handled rather than waited out and SIGKILLed. The
   captured log carries `[entrypoint] received SIGTERM; stopping
   supervised processes`, then the whole chain that SIGKILL used to cut
   off: rauthy's `SIGTERM received; starting graceful shutdown`, the
   app's `shutdown complete`, `RaftCore shutdown complete`, and twice
   (logs and logs_cache) the line this pin exists for, `WAL writer
   Shutdown complete`. The replacement pod then booted with **zero**
   `LockFile ... exists already` warnings, zero lock panics, and zero
   restarts. That is the first clean boot in this deploy's history.
3. **The index.** `fleet_app` now carries `idx_fleet_app_name` (before
   the roll: `fleet_app_pkey`, `idx_fleet_app_status`,
   `idx_fleet_app_tenant_id` only). It appeared on this image's first
   boot, exactly as the spec 006 amendment predicted.

One intermediate state is worth recording so it is not misread next
time: the **first** boot on `780eeefe` still carried the two unclean
warnings. That is correct and expected, because the pod it replaced ran
the handler-less image and was SIGKILLed on its way out. The new
entrypoint can only make the boot *after* its own stop clean, so the
roll itself cannot demonstrate the fix; only the delete in signal 2 can.

### Correction to Finding 2: the backup noise was downstream of Finding 1

Finding 2 above concluded that the `Error creating backup: ... output
file already exists` lines are upstream's to fix, not ours, and
projected that they would grow with `HQL_BACKUP_KEEP_DAYS` until every
boot logged thirty of them. The diagnosis (raft log replay re-applying
past `Backup` entries with their original timestamps) was right; the
conclusion that we could only wait for upstream was wrong.

The two boots above are a controlled comparison: same image, same data,
same four retained backup files, consecutive.

- Unclean boot (the roll, predecessor SIGKILLed): **four** errors,
  matching the four retained files, all within 160ms of startup.
- Clean boot (after the handled stop): **zero**.

The replay only happens when there is a log to replay, and an unclean
stop is what leaves one. Now that stops are handled, the state machine
is persisted on the way out and the entries are not re-applied. So the
noise was a second symptom of Finding 1 rather than an independent
cosmetic defect, and the thirty-a-boot projection does not hold for
normal operation. The upstream `TODO` is still real and still worth an
issue, but its blast radius here is now confined to genuinely unclean
stops (node loss, OOM kill, an external SIGKILL), where it is the least
of the problems. A practical consequence: these errors are now a useful
signal rather than background noise, because seeing them at all means
the previous stop was not clean.
