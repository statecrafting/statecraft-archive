---
id: "001-oap-instance-bootstrap-cli"
title: "oap-bootstrap: fork an OAP org, stand up Hetzner K3s"
status: draft
created: "2026-06-21"
summary: >
  oap-bootstrap is a Go CLI that stands up a fresh open-agentic-platform (OAP)
  instance in a new GitHub org (e.g. acme-inc/open-agentic-platform) and brings
  its Hetzner K3s estate online, exactly mirroring the upstream's own deployment.
  Today that is a multi-hour manual choreography: fork the repo, hand-register a
  GitHub App and OAuth App, click through Rauthy to create OIDC clients, point
  DNS, populate a 151-line .env, and run a 621-line setup.sh in two gated passes.
  This CLI automates it. It is phase-structured rather than stateful: the
  config/env file IS the resumable state, each phase is idempotent
  (detect-or-create), and re-running a phase is the resume mechanism. The CLI
  does NOT reimplement the upstream setup.sh; it wraps it and fills the
  automation gaps setup.sh leaves open (GitHub App registration via the App
  Manifest flow, Cloudflare DNS, Rauthy OIDC client creation), plus the fork +
  parameterize step that makes the org-coupled tree run under a new owner. Scope
  is Hetzner K3s only (parity with the upstream estate); the phase graph leaves
  room for the upstream's Terraform-backed Azure/AWS/GCP/DO providers later.
establishes:
  - { kind: directory, path: "cmd/oap-bootstrap/" }
  - { kind: directory, path: "internal/" }
depends_on:
  - "000-bootstrap"
---

# 001: oap-bootstrap

## 1. Purpose

Make standing up an isolated OAP instance for a new GitHub org a single,
resumable, mostly-unattended CLI run instead of a manual choreography. The CLI
forks the upstream `open-agentic-platform` repo into a target org, registers the
GitHub identities, provisions the Hetzner K3s estate by wrapping the upstream's
proven scripts, wires every secret, and verifies the result.

### Provenance (where this design came from)

This spec was authored inside the upstream open-agentic-platform repo (as its
spec 221) while the implementation details were fresh and verifiable, then
relocated here, its own repository, following the same separate-repo precedent
that the upstream's spec-spine engine and tenant-tail verifier set. The upstream
retains a thin pointer (its spec 221) that keeps the OAP-side footprint (the
`FR-040` env-driving work, section 9) and the extraction-source references. This
repository now holds the authoritative CLI design.

The contract surface this CLI consumes (env var names, K8s secret shapes, the
GitHub webhook permission/event set, the Rauthy client shapes, the setup.sh
phase boundaries) lives in the upstream tree. Drift between that contract and
this CLI is the standing risk; the upstream's `FR-040` env-driving and the
upstream spec 221's context references exist to keep it visible.

## 2. Territory (what this repo owns)

- `cmd/oap-bootstrap/`: the CLI entrypoint and command tree (cobra).
- `internal/`: phase implementations, the config/provenance model, the GitHub
  manifest flow, the Cloudflare and Rauthy clients, the setup.sh wrapper, and
  the SOPS round-trip.

What it does NOT own: the upstream `setup.sh`, `post-create.sh`, Helm charts, or
cluster config. Those stay upstream and are wrapped, never reimplemented.

## 3. Behavior

### 3.1 Configuration model

A single config/env file (default `oap.env`) is the sole source of truth and the
resumable state. There is no separate state database; "resume" is re-running a
phase against the accumulated `oap.env`. Every key is classified by provenance
and sourced accordingly:

- **User-supplied (prompt or up-front)**: `HCLOUD_TOKEN`, `DOMAIN`,
  `LETSENCRYPT_EMAIL`, `CLOUDFLARE_DNS_API_TOKEN`, `ANTHROPIC_API_KEY`,
  `GHCR_PAT`, `GITHUB_TOKEN` (admin:org + repo), optional `SMTP_*`, optional
  `GOOGLE_UPSTREAM_CLIENT_*`, optional `GRAFANA_OIDC_CLIENT_*`, target
  `ORG`/`REPO`.
- **Generated (random, if absent)**: `POSTGRES_PASSWORD`, `SESSION_SECRET`,
  `RAUTHY_RAFT_SECRET`, `RAUTHY_API_SECRET`, `RAUTHY_ADMIN_PASSWORD`,
  `RAUTHY_ENC_KEY_ID`, `RAUTHY_ENC_KEY`, `HIQLITE_SECRET_RAFT`,
  `HIQLITE_SECRET_API`, `GITHUB_WEBHOOK_SECRET`, `MINIO_ROOT_USER`,
  `MINIO_ROOT_PASSWORD`, `PAT_ENCRYPTION_KEY`, `FACTORY_SIGNING_PRIVATE_KEY` +
  `FACTORY_SIGNING_KID`.
- **Provider-produced (GitHub, all from the SINGLE manifest-created App)**:
  `GITHUB_APP_ID`, `GITHUB_APP_PRIVATE_KEY_B64`, `GITHUB_UPSTREAM_CLIENT_ID`,
  `GITHUB_UPSTREAM_CLIENT_SECRET` (the App's own OAuth credentials, reused for
  Rauthy's upstream provider, see Decision D-1). The webhook secret is generated
  by the CLI and handed to the manifest, so it is shared state on both sides.
- **Provider-produced (Rauthy)**: `OIDC_SPA_CLIENT_ID`, `OIDC_M2M_CLIENT_ID`,
  `OIDC_M2M_CLIENT_SECRET`, `RAUTHY_CLIENT_ID`, `RAUTHY_CLIENT_SECRET`,
  `RAUTHY_ADMIN_TOKEN`, `STATECRAFT_KNOWLEDGE_SWEEPER_CLIENT_ID/SECRET`.
- **Derived (computed from DOMAIN)**: `APP_BASE_URL`, `RAUTHY_URL`,
  `OIDC_ENDPOINT`, `DEPLOYD_AUDIENCE`, `TENANTS_BASE_DOMAIN`, every webhook and
  callback URL.

In guided mode the CLI prompts only for user-supplied keys that are absent,
generates generated keys if absent, and never prompts for derived or
provider-produced keys. Both `--yes` (non-interactive, fail on missing required
key) and interactive (prompt-to-fill) modes are supported for every phase.

`oap.env` is kept **encrypted at rest with SOPS + age** (Decision D-2), reusing
the operator's existing age key at `$HOME/.config/sops/age/keys.txt` (already an
upstream prerequisite). Only secret-classed keys are encrypted
(`encrypted_regex`); non-secret config (DOMAIN, ORG, URLs) stays cleartext for
diffability. Decryption is in-process via the SOPS Go library
(`decrypt.File(path, "dotenv")`). Where a plaintext `.env` must be handed to the
wrapped setup.sh (which `source`s it), the CLI writes it to a `0600` temp file
and removes it after the phase.

### 3.2 Command surface

```
oap-bootstrap init      # collect user-supplied keys -> oap.env
oap-bootstrap doctor    # preflight: tool versions + token scopes
oap-bootstrap github    # fork + App manifest + Actions secrets
oap-bootstrap cluster   # wrap upstream setup.sh P1; capture NODE_IP
oap-bootstrap dns       # Cloudflare A records; wait for certs
oap-bootstrap identity  # Rauthy OIDC clients (+ guided provider screen)
oap-bootstrap platform  # wrap upstream setup.sh P2 (secrets + deploy)
oap-bootstrap verify    # endpoint/cert/webhook health
oap-bootstrap apply --yes   # all phases, unattended from a full oap.env
```

Every phase: load `oap.env`, then detect-or-create, then persist produced
values, then report. Each phase is idempotent against both `oap.env` and live
cloud/cluster state, and writes any value it produces back into `oap.env`
immediately (so a crash after resource creation does not orphan the resource's
identity).

### 3.3 Phase dependency graph

```
init ──> github (fork + one App [webhook+OAuth] + Actions secrets; DOMAIN only)
            │
            ▼
         cluster (wraps setup.sh P1; produces NODE_IP)
            │
            ▼
          dns (Cloudflare A records to NODE_IP; wait for certs)
            │
            ▼
        identity (Rauthy OIDC clients; needs Rauthy live)
            │
            ▼
        platform (wraps setup.sh P2; needs all provider-produced keys)
            │
            ▼
         verify
```

The single GitHub App is created in the `github` phase before the cluster exists
because its webhook and OAuth callback URLs are deterministic from the chosen
DOMAIN. Webhook delivery simply does not start until ingress is live.

### 3.4 Phase contracts

- **github (Phase 1a)**: Fork the upstream repo into the target org
  (detect-or-skip) and apply the org-config overlay (relies on the upstream's
  `FR-040` env-driving so a fork needs zero source edits). Register a SINGLE
  GitHub App via the App Manifest flow, producing app id, PEM, webhook secret,
  and OAuth `client_id`/`client_secret` without hand-filling the form. The
  manifest requests the webhook permissions and events matching the upstream
  webhook handler contract, PLUS `email_addresses: read` and an OAuth
  `callback_url` of `https://auth.<domain>/auth/v1/providers/callback`, so the
  same App serves as Rauthy's upstream login provider (Decision D-1). Keep
  user-token expiry disabled. Set the repo's GitHub Actions secrets/vars
  (`KUBECONFIG_HETZNER` deferred to `cluster`, `GHCR_PAT`, `DB_PASSWORD`, the
  `DOMAIN` variable; `CLAUDE_CODE_OAUTH_TOKEN` if AI review is retained).
- **cluster (Phase 1b)**: Provision K3s + GitOps by wrapping the forked repo's
  `setup.sh` Phase 1 (hetzner-k3s create, flux bootstrap, post-create infra),
  passing values from `oap.env`. Do NOT fork the bash into Go. Capture the worker
  node ExternalIP into `oap.env` (`NODE_IP`) and set the deferred
  `KUBECONFIG_HETZNER` Actions secret.
- **dns (Phase 1c)**: With a Cloudflare token, create/upsert the A records
  (`<domain>`, `auth.<domain>`, `deploy.<domain>`, `minio.<domain>`, wildcard
  `*.tenants.<domain>`) to `NODE_IP`. Absent a token, print the exact records and
  block until they resolve. Poll cert-manager Certificate readiness with a
  bounded timeout before declaring the phase complete.
- **identity (Phase 2a)**: Create the four Rauthy OIDC clients (SPA, M2M
  `deployd:deploy`, server, knowledge-sweeper) via the Rauthy admin API
  (API-key callable), capturing credentials into `oap.env`. Register the GitHub
  upstream provider (pointing at the App's `GITHUB_UPSTREAM_CLIENT_ID/SECRET`;
  endpoints `https://github.com/login/oauth/{authorize,access_token}`; userinfo
  `https://api.github.com/user` with Rauthy's `/user/emails` private-email
  fallback). Provider creation is session-gated on Rauthy 0.35, so the CLI
  degrades to a single guided screen for that leg, not silently skipping;
  re-probe on Rauthy 0.36+.
- **platform (Phase 2b)**: Materialize the K8s secrets and deploy statecraft and
  deployd-api by wrapping the forked repo's `setup.sh` Phase 2 (gated on the
  provider-produced and Rauthy-produced keys now present in `oap.env`), not by
  reimplementing secret materialization.
- **doctor**: Preflight tool presence/versions (hetzner-k3s, flux, kubectl,
  helm, sops, age, gh, spec-spine) and credential scopes (Hetzner, GitHub
  admin:org + repo, Cloudflare Zone:Edit) before any mutation.
- **verify**: Assert the three public endpoints return success, the GitHub
  webhook endpoint is reachable, and the TLS certs are Ready, with a per-check
  pass/fail report.

### 3.5 spec-spine consumption

Any spec-spine use (governing this repo's own specs, or reading the forked
registry during `verify`) goes through the published `spec-spine` binary
(subprocess + `--json`), version-pinned and installed via its npm or cargo
distribution. The CLI does NOT embed spec-spine via FFI/cgo (Decision D-3). A
thin Go wrapper typing the `--json` output MAY live in `internal/`; nothing is
added to the spec-spine repo.

## 4. User journeys (acceptance)

- **J1 (P1) Guided fork + stand-up.** From an empty dir with valid credentials,
  `init` then each phase in order yields a running OAP instance in the target org
  on Hetzner K3s, with no manual GitHub or Rauthy clicking beyond the single App
  consent and the one guided Rauthy provider screen. Re-running a failed phase
  continues from the failure point without duplicating resources.
- **J2 (P1) Unattended apply.** A complete `oap.env` + `apply --yes` runs every
  phase non-interactively; first error halts with a named missing key; a second
  `apply --yes` against a provisioned instance performs no cloud mutation and
  exits 0.
- **J3 (P2) One App, no console clicking.** `github` forks and registers the App
  via manifest with the correct permission/event set (including email + OAuth
  callback); its OAuth credentials are captured for Rauthy; Actions secrets are
  set; second run is a clean no-op.
- **J4 (P2) Rauthy OIDC clients provisioned.** `identity` creates the four
  clients with correct flows/scopes via the admin API and captures credentials;
  the provider leg is guided where 0.35-gated; re-run reconciles without
  duplicates.

## 5. Success criteria

- **SC-001**: Empty directory to verified running instance in under 30 minutes
  wall-clock, of which under 5 minutes is human interaction.
- **SC-002**: The only human GUI steps are the single GitHub App manifest consent
  and one guided Rauthy provider screen (the latter only while Rauthy 0.35's
  provider API stays session-gated). No separate OAuth App; no hand-clicked OIDC
  client.
- **SC-003**: Every phase is safely re-runnable; a second `apply --yes` performs
  no cloud mutation and exits 0.
- **SC-004**: `doctor` catches 100% of missing-credential and insufficient-scope
  conditions before any resource is created.
- **SC-005**: The CLI reimplements none of setup.sh's cluster/secret logic; the
  delta between "what setup.sh does" and "what the CLI does" is exactly the named
  automation gaps plus fork + parameterize.

## 6. Edge cases

- **Rauthy 0.35 session-gates upstream-provider creation** (not API-key). Wiring
  the provider into Rauthy is one guided screen regardless of Decision D-1; the
  CLI degrades, never silently skips. OIDC client creation via API-key is
  unaffected.
- **DNS not yet propagated** when a later phase needs an issued cert: poll with a
  bounded timeout and a clear "DNS for <host> does not resolve to <node-ip>"
  message, never hang.
- **Re-run after partial cluster create**: `hetzner-k3s create` and
  `flux bootstrap` are idempotent; a second run is not a failure.
- **GitHub App re-registration** would create a duplicate; detect-by-slug before
  creating.
- **Hetzner blocks SMTP port 465** (confirmed upstream): default SMTP to
  587/STARTTLS; refuse 465 with an explanatory error.
- **Forking a private repo**: confirm intended visibility and AGPL posture before
  pushing.
- **Token scope insufficiency** (Hetzner read-only, GitHub missing admin:org,
  Cloudflare missing Zone:Edit): caught in `doctor`, not mid-provision.
- **Partial secret set** for optional feature groups (S3 backup, SMTP, Grafana
  OIDC): each optional group is all-or-nothing, matching setup.sh.

## 7. Resolved decisions

- **D-1 (GitHub App as Rauthy provider, FEASIBLE).** A single manifest-created
  GitHub App doubles as Rauthy's upstream login provider; no separate OAuth App.
  A GitHub App's user-to-server OAuth is a standard authorization_code grant on
  the same endpoints OAuth Apps use; a user can authorize without installing; the
  token is a normal OAuth token. Rauthy uses the upstream token once (fetch
  `/user`, fall back to `/user/emails`), never stores or refreshes it, and does
  not validate returned scope, so the App's permission-governed (scope-less)
  token works. Caveats: request `email_addresses: read`; carry Rauthy's callback
  in `callback_urls`; keep token expiry disabled. Residual, INDEPENDENT of D-1:
  Rauthy 0.35 session-gates provider creation (see Edge cases). Evidence: GitHub
  docs on generating user access tokens for GitHub Apps; upstream Rauthy source
  (`auth_providers.rs` token-used-once, scope-not-validated;
  `auth_provider_cust_impls.rs` `/user/emails` fallback); upstream
  `seed-rauthy.mjs` provider-API note.
- **D-2 (secrets at rest, SOPS + age).** As in 3.1: encrypt `oap.env` with the
  operator's existing age key, `encrypted_regex` over secrets only, decrypt
  in-process, 0600 temp-file bridge for the setup.sh `source` boundary. Aligns
  with the upstream spec-153 intent to SOPS-migrate per-purpose secrets.
- **D-3 (spec-spine via binary, no shim).** As in 3.5: subprocess + `--json`,
  version-pinned; no FFI. A Go FFI binding is designed but unbuilt upstream
  (spec-spine `docs/bindings-plan.md`) and is not warranted for a
  non-latency-sensitive setup tool.

## 8. Implementation milestones

- **M0 (upstream)**: Env-drive the few hardcoded `statecrafting/open-agentic-platform`
  refs (the upstream's `FR-040`) so a fork needs zero source edits. Lands in the
  upstream repo, not here. Unblocks the `cluster`/`platform` wrappers.
- **M1**: Skeleton + config/provenance model + `init` + `doctor`; `oap.env` SOPS
  round-trip. Ship first; cheapest fail-fast foundation.
- **M2**: `github`: fork + App Manifest flow + Actions secrets. Highest
  manual-pain payoff; M1+M2 already deliver "fork + register the App without
  clicking."
- **M3**: `cluster`: wrap setup.sh P1; capture NODE_IP + kubeconfig.
- **M4**: `dns` + `identity`: Cloudflare records + cert wait; Rauthy clients +
  guided provider leg.
- **M5**: `platform` + `verify` + `apply --yes`: full unattended path and the
  idempotent second-run no-op.

**Implementation status (2026-06-23).** All milestones have landed. M0 in the
upstream repo (its `FR-040`); M1 through M5 in this repo on `main` (`0b0b06d`
M1, `48c2965` M2, `4bb06bc` M3, `1637632` M4, `a4a4097` M5). M5 also added the
`GH_REPO` derived fork seam (sibling of `FLUX_*`) so setup.sh's Phase-2
`gh secret set` targets the fork, not upstream. Every phase is unit-tested; the
live cloud/cluster/Rauthy legs are deferred to a first real-target run, which is
the acceptance gate for SC-001 through SC-005 (§5).

## 9. Out of scope (non-goals)

- Reimplementing setup.sh, post-create.sh, or the Helm charts in Go.
- Multi-cloud providers beyond Hetzner in the first implementation (the phase
  graph accommodates them; the upstream's Terraform modules are the later path).
- Day-2 ops (upgrades, scaling): those are Flux/CD concerns that already exist
  upstream; the CLI's job ends at `verify`.
- Creating the Hetzner account, the GitHub org, or the DNS zone; the CLI assumes
  those exist and that it holds scoped tokens into them.

## 10. Open questions

- **OQ-A**: Should `cluster`/`platform` shell out to the forked repo's setup.sh
  (zero reimplementation, couples to that script's interface), or should the
  upstream refactor setup.sh into a thin, flag-driven entrypoint with a stable
  contract? Recommendation: the latter, as part of the upstream env-driving work.
- **OQ-B**: Provider abstraction boundary. Where does the Hetzner-specific logic
  end and a future Azure/AWS/GCP path begin, so the phase graph is
  provider-pluggable without a rewrite?
