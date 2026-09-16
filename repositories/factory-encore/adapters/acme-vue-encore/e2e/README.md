# acme-vue-encore generator e2e

An end-to-end test of the **acme-vue-encore generator** against the
**template-encore** baseline, with no stagecraft and no open-agentic-platform in
the loop. Governed by spec **`007-generator-e2e-harness`**.

The point: stagecraft's create-project flow is just an orchestrator. The real
work (materialise a profile, compose modules, produce a runnable Encore app) is
done by this adapter's generator scripts (`scripts/`) running with
template-encore as `--source`. This harness drives those scripts directly and
verifies that everything stagecraft needs to enact can in fact be enacted by the
generator and the baseline alone, across all four profiles and every opt-in
module.

## What it replicates (the stagecraft contract)

It mirrors the three stagecraft scaffold steps:

| Stagecraft step | What this harness does |
|---|---|
| Prebuild four profiles (`ensurePrebuilts`) | runs `setup-app.ts --profile {minimal,public,internal}` and `setup-dual-app.ts`, all with `--source <template-encore> --dest ... --yes` under `NO_INSTALL=true` |
| Compose selected modules (`scaffoldFromPrebuilt`) | copies the prebuilt tree (minus `.git`/`node_modules`), runs `add-module.ts <mod> --yes --no-install --root <dest>` per extra, in `INSTALL_ORDER` |
| Module catalog + ordering (`moduleCatalog`) | the five modules and the exact `INSTALL_ORDER` (security-core, data-postgres, data-redis, api-gateway, user-management); dual takes no extras |

## Profiles and modules

Profiles (from the adapter manifest `scaffold.profiles`):

- `minimal`  -> `setup-app.ts --profile minimal`  (AUTH_DRIVER=mock)
- `public`   -> `setup-app.ts --profile public`   (AUTH_DRIVER=rauthy)
- `internal` -> `setup-app.ts --profile internal` (AUTH_DRIVER=rauthy; ships `user-management` by default, per spec 002 STRUCT-1)
- `dual`     -> `setup-dual-app.ts` (independent `public/` + `internal/` Encore apps)

Modules (composed onto the single-app profiles): `security-core`,
`data-postgres`, `data-redis`, `api-gateway` (requires `security-core`),
`user-management`.

## The matrix

For each single-app profile (minimal/public/internal): the base app (no
modules), each module on its own, and all modules together. For dual: the
two-app topology with no extras. That is `3 * (1 + 5 + 1) + 1 = 22` produced
apps.

## Verification

Two layers per produced app:

1. **Structural** (always): backend carried forward, `AUTH_DRIVER` correct for
   the profile, no generator artifacts leaked (`scripts/`, `modules/`,
   `orchestration/`), each requested module recorded in `template.json` with its
   payload present, and dependency auto-resolution (adding `api-gateway` pulls in
   `security-core`).
2. **Build** (default; `--no-build` to skip): the real compile gate, run on the
   produced tree exactly as template-encore's own CI does: `npm install` (root
   workspaces) + `npm --prefix apps/api install` + `npm run typecheck:api`
   (`encore check`) + `npm run typecheck` + `npm run build`. For dual, both
   `public/` and `internal/` are built. This layer requires the Encore CLI and
   Docker; the structural layer requires only Node + tsx.

## Run

```bash
# from the repo root, via the npm scripts (recommended)
npm run e2e:struct         # structural-only matrix (no Docker / Encore) -- the PR lane
npm run e2e:build          # full matrix with the real build -- the nightly lane

# or drive the script directly
bash adapters/acme-vue-encore/e2e/run-e2e.sh                 # preflight + prebuild + full matrix + build
bash adapters/acme-vue-encore/e2e/run-e2e.sh prebuild        # just materialise the 4 profile prebuilts
bash adapters/acme-vue-encore/e2e/run-e2e.sh combo internal user-management   # one combo
bash adapters/acme-vue-encore/e2e/run-e2e.sh matrix --no-build                # structural only, fast
bash adapters/acme-vue-encore/e2e/run-e2e.sh --profiles public,internal       # restrict the matrix
bash adapters/acme-vue-encore/e2e/run-e2e.sh report          # re-print the last results table
```

Override locations with environment variables:

```bash
FACTORY_ENCORE=/path/to/factory-encore \
TEMPLATE_ENCORE=/path/to/template-encore \
OUT_DIR=/tmp/fe-out  bash adapters/acme-vue-encore/e2e/run-e2e.sh
```

`FACTORY_ENCORE` defaults to this repository root; `TEMPLATE_ENCORE` defaults to
a sibling `template-encore` checkout. Output (generated apps, prebuilts,
per-step logs, `results.tsv`) lands under `.out/` (gitignored).

## CI lanes (spec 007)

- **`generator-e2e.yml`** (PR gate): structural-only matrix
  (`run-e2e.sh matrix --no-build`), routed on the generator surface from
  `ci.yml` and folded into the terminal `ci-gate`. Node-only, no Docker/Encore,
  so it stays cheap enough to be a required per-PR check. Fetches template-encore
  at the lockstep pinned ref.
- **`generator-e2e-nightly.yml`** (nightly, non-gating): the full build matrix
  against the pinned ref, on a cron schedule plus `workflow_dispatch`. Opens a
  tracking issue on failure and uploads `results.tsv` + per-step logs.
- **`generator-e2e-drift.yml`** (weekly, non-gating): the full build matrix
  against `template-encore@main`, surfacing baseline drift before it is pinned.
  Opens/annotates a single deduplicated tracking issue on divergence (the
  against-main companion to the deterministic nightly).

## Why the build lane matters

The lockstep gate (spec 006) pins the baseline's invariant hashes; it does not
compile the module payloads against the live baseline. The build lane does
exactly that (`encore check` provisions Postgres and runs the composed
migrations, then type-checks and builds), which is the gap it fills: this harness
is what first surfaced the `user-management` baseline drift (audit-API and
`user_account` schema) fixed in spec 002.
