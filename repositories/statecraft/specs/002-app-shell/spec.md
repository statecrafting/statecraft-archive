---
id: "002-app-shell"
title: "The control plane's EnRaHiTu app shell"
status: approved
created: "2026-07-14"
implementation: complete
depends_on:
  - "001-statecraft-thesis"
establishes:
  - "package.json"
  - "package-lock.json"
  - "encore.app"
  - "tsconfig.json"
  - "vitest.config.ts"
  - "vitest.setup.ts"
  - "infra.config.dev.json"
  - "infra.config.json"
  - ".github/workflows/verify.yml"
  - { kind: directory, path: "backend/" }
  - { kind: directory, path: "backend/auth/" }
  - { kind: directory, path: "backend/core/" }
  - { kind: directory, path: "backend/health/" }
  - { kind: directory, path: "backend/hiq/" }
  - { kind: directory, path: "backend/idp/" }
  - { kind: directory, path: "backend/lib/" }
  - { kind: directory, path: "backend/web/" }
  - { kind: directory, path: "scripts/" }
  - { kind: directory, path: "docker/" }
  - { kind: directory, path: ".statecraft/" }
summary: >
  statecraft becomes a running EnRaHiTu app: the slimmed chassis from
  statecrafting/enrahitu is brought into this repo (the two-directory
  backend/ + frontend/ layout, CoreLedger, auth baseline, rauthy proxy,
  health, packaging, verify workflow; the Encore toolchain and the
  hiqlite addon arrive as pinned @enrahitu/* npm packages, not vendored
  source), stamped with app name "statecraft". After this spec the
  control plane boots, authenticates, and tests green; every later
  service spec (004+) adds Encore services onto this shell. This is
  deliberate dogfooding: the platform is stamped from the same template
  it will stamp for customers.
---

# 002: App shell

## 0. Cross-repo gate (read first)

BLOCKED until enrahitu specs 018 (packaged chassis) and 019
(frontend/backend layout) are implemented (decided 2026-07-14): the
first template consumer must import the slimmed two-directory shape,
never the fat tree. When picking work, if enrahitu's registry does not
show 018 and 019 implemented, take spec 008 instead (it has no chassis
dependency) and report the blockage. After 018/019, the import in §2
brings a tree whose only code directories are `frontend/` and
`backend/`, with the toolchain and the hiqlite addon arriving as
pinned npm packages (@enrahitu/toolchain, @enrahitu/hiqlite-native)
rather than as vendored source; read the template's then-current
CLAUDE.md for the layout truth and adjust the §2 mechanics to it.

RESOLVED 2026-07-15: enrahitu 018 and 019 are `implementation: complete`
(enrahitu commit 83a4551), which explicitly delegated the slimmed
clean-clone / boot-smoke acceptance to this, its first stamped consumer.
The slimmed import in §2 was performed against that commit and is that
delegated acceptance; §2 records the mechanics actually used.

## 1. Purpose

Every service the control plane needs (tenants, factory, fleet) is an
Encore.ts service on the EnRaHiTu substrate. The shell must exist first,
and it must arrive the same way a customer app arrives: stamped from the
template, not hand-assembled, so that template drift and platform drift
are the same drift and get caught together.

## 2. How the chassis was brought in

Performed 2026-07-15 against enrahitu commit 83a4551 (018/019 complete).
No scaffold verb exists yet (enrahitu spec 014 is pending), so this was
a manual slimmed import; it doubles as the consumer-side acceptance that
enrahitu 018 §4 delegated to the first stamped consumer.

1. Import the slimmed subset from enrahitu's latest main, preserving
   paths: `backend/` (the whole Encore app: auth, core, health, hiq,
   idp, lib, web), `frontend/` (the Vue SPA, without its node_modules),
   `docker/`, and the app-owned `scripts/` files (docker-build.sh,
   generate-keys.ts, sync-dev-rauthy-secret.mjs, verify-born-with.mjs
   and its test, fixtures/). Root files: `encore.app`, `tsconfig.json`,
   `vitest.config.ts`, `vitest.setup.ts`, `infra.config.dev.json`,
   `infra.config.json`, `.statecraft/born-with.schema.json`, and a
   rewritten `.github/workflows/verify.yml`. NOT imported (the slimming,
   spec 019 §1): `vendor/`, `addon/` (enrahitu's hiqlite source),
   `packages/`, `template.toml`, and enrahitu's governance identity
   (`specs/`, `standards/`, `.claude/`, `AGENTS.md`, `CLAUDE.md`,
   `README.md`, `LICENSE`, `spec-spine.toml`, the spec-spine workflow):
   this repo's identity wins. Never import enrahitu's `.env` (a live
   secret). `.gitignore` is merged into this repo's existing one.

   **Divergence from upstream, 2026-07-20.** `docker/entrypoint.sh` was
   byte-identical to enrahitu's copy until spec 009 §4.8 item 1 was closed
   here: it now forwards the five `SMTP_*` variables into the rauthy
   subshell, gated on `SMTP_URL`, so the embedded rauthy has a mail
   transport instead of failing every send against rauthy's
   `smtp_url = 'localhost'` default. The same pass closed §4.8 item 2 by
   mapping `RAUTHY_S3_*` onto rauthy's `HQL_S3_*`, which is the only
   consistent backup of the identity database. The change landed in this repo rather
   than upstream because the published image builds from this copy and the
   deploy needed it; mirroring it into `statecrafting/enrahitu` is an open
   follow-up. Until that lands the two files differ, and **the next chassis
   sync must not silently revert it**: re-importing enrahitu's
   `docker/entrypoint.sh` wholesale would remove the mail transport without
   any gate noticing, since no test covers it.

   **A third hunk, 2026-07-21: `RP_ORIGIN` must carry an explicit port.** The
   entrypoint set `RP_ORIGIN="$PUBLIC_URL"`, and rauthy aborts on it. Its
   config validator parses that value with `rsplit_once(':')` and parses the
   tail as a `u16` (`src/data/src/rauthy_config.rs`), so a bare
   `https://app.statecraft.ing` splits at the *scheme* colon and fails on
   `//app.statecraft.ing`, panicking with "Invalid value for
   `webauthn.rp_origin` port" before rauthy ever serves. The entrypoint now
   rebuilds the origin from the `hostport` it already parses, appending the
   scheme's default port when the public URL carries none.

   This is a genuine upstream chassis bug and not a statecraft
   misconfiguration: any enrahitu app whose `ENRAHITU_PUBLIC_URL` omits an
   explicit port cannot boot its embedded rauthy at all. It went unseen
   because it is unreachable locally, where the public URL is
   `http://localhost:4000` and therefore already has a port. It is the third
   reason the next chassis sync must not blind-revert this file, and it
   raises the priority of the upstream mirror above.

   **Why the deploy must not "fix" this by setting a port in the public URL.**
   Adding `:443` to `ENRAHITU_PUBLIC_URL` also clears the panic, and it is the
   wrong repair: that variable is the container's identity input (spec 009
   §4.3 rule 3), so a port-suffixed value is burned into the issuer and the
   client's redirect URIs on first boot and is thereafter correctable only
   through the admin API. The defect belongs to the derivation, so the
   derivation is where it is fixed.

   **A fourth hunk, 2026-07-21: forward `SMTP_STARTTLS_ONLY`.** The SMTP
   passthrough forwarded five variables and dropped this sixth, which made mail
   deliverable only on an implicit-TLS port (465). rauthy builds its transport
   with lettre's `relay()` and only switches to `starttls_relay()` when
   `starttls_only` is set, so a STARTTLS port (587) cannot be used without it.
   That is not a niche preference: providers commonly block outbound 465, and
   the statecraft cluster's own network does (Hetzner blocks 465 and 25, leaves
   587 open, verified from a pod), so 587 was the only reachable port and it was
   unreachable without this flag. The entrypoint now forwards it alongside the
   other five, still gated on `SMTP_URL`.

   The consequence of the gap was not a lost feature but an outage. rauthy's
   `create_mailer` `panic!`s once its connection retries are exhausted
   (`src/data/src/email/mailer.rs`, doc-commented "# Panics"), and this
   entrypoint supervises die-together, so an unreachable mailer crash-loops the
   whole container. This is the fourth reason the next chassis sync must not
   blind-revert this file, and it and the SMTP transport hunk together are the
   argument for making the upstream mirror a priority rather than a someday.

   **A fifth divergence, in `backend/idp/proxy.ts` not the entrypoint,
   2026-07-21: strip the browser's `Sec-Fetch-*` headers.** The rauthy
   passthrough proxy forwards to the loopback rauthy with undici `fetch()`, and
   undici unconditionally sets `Sec-Fetch-Mode` to `cors` (a fetch() call always
   stamps its own request mode over any value passed). rauthy's CSRF guard
   (`src/middlewares/src/csrf_protection.rs`) allows a cross-site top-level
   `navigate` but blocks a cross-site `cors`, and its provider callback is not on
   the path-exception list, so the rewrite turns the GitHub upstream login's
   return leg (`GitHub -> /auth/v1/providers/callback`) into a "cross-origin
   request forbidden" `BadRequest`. It was found the only way it could be, by a
   real operator login reaching GitHub and bouncing off the callback. The proxy
   now drops every `sec-fetch-*` request header, so rauthy takes its
   header-absent path and leans on the CSRF defenses this proxy does not corrupt
   (the OAuth `state` parameter, PKCE, and `__Host-` SameSite cookies).
   Verified live: sending `Sec-Fetch-Mode: navigate` through the proxy still
   reached rauthy as `cors` and was blocked, while sending no `Sec-Fetch`
   headers was allowed.

   Unlike the four entrypoint hunks this touches an app source file, so it is
   baked into the image at build time and cannot be reached by a manifest. It is
   the fifth reason the chassis sync must not blind-revert statecraft's copies,
   and it belongs in the same upstream mirror, since any enrahitu app that puts
   its rauthy behind this proxy and uses an upstream provider hits it.
2. The root `package.json` is written fresh, not copied: app name
   `statecraft`, `@enrahitu/toolchain` and `@enrahitu/hiqlite-native`
   pinned to `0.1.0` from the registry (binaries resolve from
   node_modules; no cargo runtime build), plus this repo's own
   `@statecraft/governance-native` addon (spec 008) as a `file:` dep and
   a `build:addon` script. `npm install` generates the lockfile and
   `npm ci` is reproducible from it (all six @enrahitu platform optionals
   pinned, so linux CI resolves too). `infra.config.*` app_id and the SPA
   title are stamped to `statecraft`; substrate names (`@enrahitu/*`,
   `ENRAHITU_*` env prefixes) are deliberately left as the chassis.
3. One enrahitu bug was patched in the imported `vitest.config.ts`: its
   `encoreRuntimeLib()` resolved the Encore runtime only from the
   now-absent `vendor/`, breaking `npm test` for every slimmed consumer.
   Fixed to delegate to the toolchain's exported resolver
   (`@enrahitu/toolchain/resolve`), which finds the binary in
   node_modules. Reported upstream to enrahitu.
4. Repoint spec-linkage keys to this repo's ids: root `package.json` and
   `frontend/package.json` -> `002-app-shell`. The governance addon and
   service keep `008-governance-attestation`. `spec-spine lint` failing on
   a dangling id is the check that they were all caught.
5. The governance service (spec 008), authored at repo-root `governance/`
   against the old flat layout, is relocated under `backend/governance/`
   so its `../core/ledger` import resolves and Encore discovers it as a
   service, and wired to the built addon. See spec 008 for that half.
6. Record provenance: the README "Chassis" section names the enrahitu
   commit and date. There is no born-with cert here until the factory
   (spec 005) exists; that is noted there explicitly.
7. `spec-spine compile && spec-spine index`; commit the shards with the
   import.

## 3. Constraints

- The frontend/ Vue placeholder comes along for now; spec 007 replaces
  it with the React Router v7 governance UI. Do not invest in it.
- License boundary (CLAUDE.md convention): the imported chassis is
  Apache-2.0 code entering an AGPL-3.0 repo; that direction is fine. The
  Encore toolchain (with its MPL-2.0 runtime) is no longer vendored: it
  arrives as the @enrahitu/toolchain npm package, which carries its own
  license, so there is no `vendor/` license file to keep here.
- No Encore SQLDatabase anywhere; CoreLedger is the only durable-data
  API (chassis rule, kept).
- `spec-spine.toml` reflects the slimmed shape: the root `package.json`
  and `frontend/` are npm packages linked to this spec; the governance
  addon and service stay on 008. `standalone_npm_packages` gains
  `frontend` (the governance addon is already listed); `[index]
  extra_hashed_inputs` gains the chassis manifests (the root and
  frontend package.json, the infra configs) so edits trip staleness here
  too.
- Later service specs extend the 002-owned root config in place (amended
  here as they land): spec 003 adds the `dev:db` script (package.json) and
  a Postgres service arm in `verify.yml`, wiring CoreLedger onto Postgres
  via `ENRAHITU_LEDGER_URL` while stamped apps stay on libSQL. Spec 004
  adds the three GitHub App secrets (`GITHUB_APP_ID`,
  `GITHUB_APP_PRIVATE_KEY_B64`, `GITHUB_WEBHOOK_SECRET`) to
  `infra.config.json`'s `secrets` block so the deployed control plane
  binds them from env; dev leaves them unset (the tenants service reads
  `process.env` as a local fallback). Spec 006 adds the three fleet backup
  secrets; one of them, `RESTIC_PASSWORD`, was renamed
  `FLEET_S3_RESTIC_PASSWORD` on 2026-07-20 when the platform's own `/data`
  backup got a separate credential group (spec 010 §4). That rename is
  confined to the `secrets` block's key and its `$env` binding; the
  eleven-secret count is unchanged, and the new `PLATFORM_S3_*` keys are
  deliberately not declared here, because the app never reads them.

  **Production metadata and metrics, 2026-07-20 (spec 009 §4.2, §4.7).**
  `infra.config.json` is production-only: `npm run dev` augments from
  `infra.config.dev.json` instead
  (`node_modules/@enrahitu/toolchain/bin/dev.mjs:50`), and only
  `scripts/docker-build.sh` consumes the production file, so edits here do not
  reach a local run. Two corrections followed. `cloud` moved from `local` to
  `hetzner`, because `local` beside `env_type: production` silently disables
  Encore's missing-secret guard and makes an unmounted secret read as `""`
  rather than crash the pod; and `base_url` moved from `http://localhost:8080`
  to `https://app.statecraft.ing`. A `metrics` block was added, pointed at the
  in-cluster Prometheus, which the file previously lacked entirely.

## 4. Acceptance

- From a clean checkout: `npm ci && npm --prefix frontend ci`,
  `npm run build:addon`, `npm run build:web`, `npm run build:app`,
  `npm run typecheck`, `npm test` all green (the chassis suite plus the
  governance service: 55 passed / 11 skipped at import time; the 11 are
  the CoreLedger Postgres arm, which auto-skips without a live database
  and gets CI coverage in spec 003). `cargo test --no-default-features`
  in addon/governance-native/ stays green (22).
- `npm run dev` boots; `GET /health` and `GET /hiq/health` return 200,
  and the governance service answers (`GET /governance/verify` -> ok).
- verify.yml runs green on main.
- `spec-spine lint --fail-on-warn` and `spec-spine index check` green.

## Status (2026-07-15)

`implementation: complete`; acceptance holds in full.

- The §0 cross-repo gate is resolved: enrahitu 018 (packaged chassis) and
  019 (frontend/backend layout) are `implementation: complete` at
  enrahitu commit `83a4551`, and the slimmed two-directory import in §2
  was performed against that commit (the delegated clean-clone acceptance).
- §4 build/test acceptance (item 1) and green-on-main (item 3) hold via
  the `verify` workflow on the latest main commit: `npm ci`, `build:addon`,
  `build:web`, `build:app`, `typecheck`, `npm test` (both CoreLedger
  drivers), and the webapp typecheck + component tests all pass.
- §4 dev-boot acceptance (item 2) live-verified against a local
  `npm run dev` (Encore on :4000, CoreLedger on the dev Postgres):
  `GET /health` -> 200 `{"status":"ok","ledger":"ok","app":"enrahitu"}`;
  `GET /hiq/health` -> 200 `{"status":"ok"}`; `GET /governance/verify`
  -> 200 `{"ok":true,"seq":0}`.
- §4 spine gates (item 4): `spec-spine lint --fail-on-warn` reports
  0 errors / 0 warnings and `spec-spine index check` is fresh.

### Update 2026-07-16 (the `frontend/` edge was a phantom; dropped)

This spec `establishes`-ed `frontend/`, the chassis's placeholder SPA directory.
It never held authored code here: verified 2026-07-16, `frontend/` has **zero
git-tracked files**, and what sits on disk is 860 gitignored `node_modules`
files left by the chassis import. Spec 007 replaced the placeholder with a real
SPA but landed it at `webapp/`, so the corpus ended up owning an empty
`frontend/` while the actual UI lived under a name the chassis does not use.

The edge is dropped here and `frontend/` becomes spec 007's territory when its
2026-07-16 realignment moves `webapp/` -> `frontend/`. This is a bookkeeping
correction, not a behavior change: no tracked file moves under this spec, and
002's acceptance is untouched. The chassis import shape (§2) is unaffected; the
two-directory `backend/` + `frontend/` convention it describes is in fact what
007's move restores.

## 5. Out of scope

- Postgres (spec 003), any new service (004+), UI replacement (007).
- Automating chassis refresh from upstream enrahitu (a later spec;
  manual re-import with a recorded commit is the v0 mode).

## Amendment (2026-07-21): spec 011 tenant lifecycle

Spec 011 makes coordinated edits inside this spec's `backend/auth/`
territory: `entities.ts` gains two nullable GitHub-identity columns on
`user_account` (`githubUserId`, `githubLogin`; resolved at login, null for
non-federated accounts), and `rauthy.ts` calls a login hook that resolves
that identity and reconciles org-derived tenant memberships. Spec 011 also
establishes a new file inside this directory, `backend/auth/github-identity.ts`,
which it owns. See specs/011-tenant-lifecycle/spec.md §5.1, §5.3.

## Amendment (2026-07-22): the toolchain + hiqlite repoint to @statecrafting

The chassis's build toolchain and hiqlite addon, which §2 imported as pinned
`@enrahitu/*` npm packages, now come from the `@statecrafting` scope
(statecrafting specs 002/003), matching the governance and fleet addons this app
already consumes there. `package.json` moves `@enrahitu/toolchain@0.1.0` to
`@statecrafting/toolchain@0.2.0` and `@enrahitu/hiqlite-native@0.1.0` to
`@statecrafting/hiqlite-native@0.1.0`; `backend/hiq/init.ts` and
`vitest.config.ts` import the new specifiers; the image workflow stages the
runtime from `@statecrafting/toolchain-linux-x64`. The stamped-app shape §2
describes is unchanged: the toolchain still arrives as a devDependency of
prebuilt binaries with no vendored source, `enrahitu-dev`/`enrahitu-build` keep
their bin names, and the substrate-name convention (§2 item 2) simply reads
`@statecrafting/*` now. The `0.2.0` toolchain adds the app-model extractor
(statecrafting spec 002 amendment), which this app does not use, so nothing else
changes here. (Superseded the same day by the spec 012 amendment below: the
toolchain moves to `0.3.0` and its extractor modules become the platform's
model producer.)

## Amendment (2026-07-22): spec 012 frontend-admin adoption, chassis plumbing

Spec 012 adopts the chassis observability + admin surfaces (enrahitu specs
022/023 at commit `950a9be`) and makes these coordinated edits inside this
spec's territory; spec 012 §5.1 records the design.

- `backend/obs/` and `backend/admin/` (established by spec 012) join the
  service tree; `obsMiddleware` mounts outermost on every API service
  (auth, factory, fleet, governance, health, hiq, idp, tenants), `web`
  stays uninstrumented, and `core/ledger`'s `Ledger.fromEnv` wraps
  `instrumentDriver` around the driver.
- `backend/lib/` gains `app-model.ts` (the fail-closed model loader, the
  platform's stand-in for the chassis kernel boot) and `jwt-verify.ts`
  (the public-key-only verification split; `jwt.ts` re-exports);
  `roles.ts` gains `operatorRole()` reading the model; `env.ts` gains
  `adminUiEnabled` (`ADMIN_UI_ENABLED`, default true); `auth/mock.ts`
  gains the fourth (operator) principal.
- Follow-up the same day: `infra.config.json`'s `secrets` block gains
  `RAUTHY_API_KEY` (`$env` binding, the spec 011 §6 rauthy admin API
  key), joining the eleven bindings already declared there, as the key
  reached the pod Secret with the spec 012 deploy (spec 009's
  2026-07-22 re-pin amendment trail).
- Build wiring: `package.json` moves `@statecrafting/toolchain` to
  `0.3.0` and adds prom-client + the OTel packages, plus the
  `dev:web-admin`/`build:web-admin`/`extract:model`/`check:model`
  scripts; `tsconfig.json`/`vitest.config.ts` exclude `frontend-admin`;
  `verify.yml` and `image.yml` install/build the dashboard and run the
  model freshness check; `.gitignore` and `backend/web/dist-admin/`
  follow the dist placeholder pattern; `spec-spine.toml` lists
  `frontend-admin` as a standalone npm package and hashes
  `app-manifest.json`.

## Amendment (2026-07-25): the entrypoint's stop handler (a convergent hunk)

`docker/entrypoint.sh` gains a SIGTERM/SIGINT handler that forwards the
signal to rauthy and the app and waits for both before exiting 0. It is
armed immediately after `RAUTHY_PID` is assigned, so a stop during the
rauthy health wait is covered, and it tolerates an unset `APP_PID` in
that window.

Unlike the four hunks recorded above, this one is **not** a divergence.
It lands identically in enrahitu's copy (its spec 007), and the reason it
appears here at all is that the copies are maintained separately: a
chassis fix to the entrypoint does not reach a stamped app through a
version pin, only through the next sync. Recorded here so the next
upstream sync sees a hunk it already has rather than one to reconcile.

The motivation is a live defect, diagnosed in spec 009's amendment of the
same date: without a handler the runtime's signal reached PID 1 alone,
rauthy was SIGKILLed at the end of the grace period, and its embedded
hiqlite never released its WAL and state-machine lock files. Every boot
after every restart began unclean, and on 2026-07-25 that escalated to
three crash-looped boots on a single routine pod replacement.

`docker/entrypoint.test.ts` is the first test in this repo over `docker/`.
It covers the shipped function rather than a copy: the `shutdown()` body
is lifted out of `docker/entrypoint.sh` by text and run against stub
children, so editing the real function breaks the test. Four cases: both
traps installed, SIGTERM and SIGINT each reaching both children, and a
signal that lands before the app has started. The negative was checked by
hand: with the trap removed the harness exits 143 and neither child is
signalled at all.
