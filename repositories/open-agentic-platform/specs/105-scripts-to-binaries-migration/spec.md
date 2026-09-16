---
id: "105-scripts-to-binaries-migration"
title: "Retire scripts/ — Migrate To Rust Binaries Or Make Recipes By Nature"
status: approved
implementation: complete
owner: bart
created: "2026-04-16"
amended: "2026-06-11"
amendment_record: |
  Amended 2026-06-11 — adapter-scopes derivation source cutover (spec 198
  FR-012). `adapter-scopes-compiler` no longer scrapes top-level directories
  from `directory_conventions:`; it projects each adapter manifest's
  `governance:` sub-envelope verbatim (`file_write_scope` as declared,
  admission-validated write globs; `allowed_commands` still derived from the
  manifest's own `commands:` map — the manifest's
  `allowed_commands_from: commands` declaration names that home and the
  admission gate enforces it; the compiler itself reads `commands:`
  unconditionally). A
  manifest without a `governance:` section now fails the compile —
  fail-closed, mirroring admissibility (adapter-manifest schema 1.1.0).
  Input moves to a factory-source checkout via a now-required
  `--adapters-dir` (the in-repo `factory/adapters/` this spec originally
  read was retired by spec 108); output narrows to the single committed
  statecraft snapshot (the legacy `build/adapter-scopes.json` copy is
  retired, with the ci-parity-check PRODUCERS rule repointed under the
  spec 104 amendment of the same date). First derivation ran 2026-06-11
  against the admitted acme-vue-encore manifest
  (sha256 57f43e1a8908…, matching the sealed admission record's
  adapter_manifest_hashes). The governed-binary venue split this spec
  establishes is unchanged.

  Amended 2026-06-04 — axiomregent demotion fetch re-point. `make fetch-axiomregent`
  (the Makefile recipe this spec moved off `scripts/fetch-axiomregent.js`) no longer
  downloads from a GitHub *Release*: axiomregent has no standalone release (specs
  037/193, amended). It now pulls the host-triple sidecar from the latest successful
  `build-axiomregent.yml` CI run artifact (`gh run download`, non-ceremonial, 30-day
  retention), with `make axiomregent` (build-from-source) as the offline fallback.
  The governed-binary vs Makefile-recipe split this spec establishes is unchanged;
  only the recipe's fetch source moved from a release channel to a CI artifact.
  Trust posture (documented in the recipe): a CI artifact is produced on every push
  to main and is NOT attestation-verified — a wider trust surface than the former
  attested release asset. This is a dev-convenience path (not the production bundled
  path); `make axiomregent` (build from your own checkout) is the zero-trust-delegation
  option for contributors who want it.
kind: migration
domain: tooling
risk: medium
depends_on:
  - "000-bootstrap-spec-system"  # bootstrap-spec-system
  - "037-cross-platform-axiomregent"  # cross-platform-axiomregent (originator of build-axiomregent.sh)
  - "073-axiomregent-unification"  # axiomregent-unification (owner of fetch-axiomregent.js surface)
  - "075-factory-workflow-engine"  # factory-workflow-engine (consumer of adapter-scopes.json)
  - "104-makefile-ci-parity-contract"  # makefile-ci-parity-contract (the enforcement surface)
code_aliases: ["SCRIPTS_RETIRE"]
establishes:
  - unit: { kind: file, path: tools/oap/adapter-scopes-compiler/src/main.rs }
  - unit: { kind: file, path: tools/oap/adapter-scopes-compiler/src/lib.rs }
co_authority:
  - with_specs:
      - "037-cross-platform-axiomregent"
      - "073-axiomregent-unification"
      - "104-makefile-ci-parity-contract"
    unit: { kind: section, file: Makefile, anchor: axiomregent-build }
summary: >
  Retire the repo-root `scripts/` directory. Each script moves to the
  venue that matches its nature: scripts that perform real logic
  (parsing, compilation, validation) become governed Rust binaries
  under `tools/`; scripts that are pure orchestration (loops, copies,
  invocation of existing tools like gh/cargo) become Makefile recipes.
---

# 105 — Scripts-To-Binaries Migration

## 1. Problem Statement

The `scripts/` directory at the repo root is a residue from earlier
milestones. It contains three executables:

- `scripts/compile-adapter-scopes.js` — reads `factory/adapters/*/manifest.yaml`,
  compiles a normalised `adapter-scopes.json` to two destinations. Implements
  its own handwritten YAML subset parser.
- `scripts/fetch-axiomregent.js` — fetches pre-built `axiomregent` sidecar
  binaries from GitHub Releases during `make setup` / `product/apps/opc` predev.
- `scripts/build-axiomregent.sh` — builds `axiomregent` locally for one or
  more Rust targets and copies them into `product/apps/opc/src-tauri/binaries/`.

Each of these violates the same principle, in a different way:

1. **Handwritten parsers that duplicate governed tooling.** The adapter-scopes
   script reinvents YAML parsing in JavaScript because the Rust
   `factory-contracts` crate (spec 074) can already parse adapter manifests
   with a compile-time schema. A drift in manifest shape silently produces a
   wrong `adapter-scopes.json` that ships into statecraft.
2. **Release-channel logic outside the governed tool surface.** The
   fetch script talks to the GitHub Releases API with ad-hoc auth, ad-hoc
   tarball extraction, ad-hoc asset-name conventions. This logic is a
   first-class build-system concern and belongs in a reviewable binary.
3. **Cross-compilation shell orchestration.** The build script just loops
   over rust targets and copies binaries. That loop already exists as
   `make ci-cross` (spec 104); the only remaining capability the script
   adds is "copy the resulting binaries into the Tauri sidecar directory",
   which belongs in a dedicated subcommand.

Per user convention ("move away from scripts/ towards our binaries"),
each script should become a governed Rust binary with a spec, tests, and
Makefile integration.

## 2. Solution

### 2.1 Classification Rule

Each script is classified by what it actually does:

- **Real logic** — parsing, compilation, validation, schema-driven output.
  Migrate to a **governed Rust binary** under `tools/` with a typed
  schema and tests. Example: `compile-adapter-scopes.js` consumes
  adapter manifest YAML (spec 074 schema) and emits a compiled JSON
  artifact. That is compiler work; it belongs in Rust.
- **Orchestration** — loops, copies, environment detection, invocations
  of tools that already do the real work (`gh`, `cargo`, `cp`, `strip`).
  Migrate to a **Makefile recipe**. Inventing a Rust wrapper around
  `gh release download` would just re-implement what `gh` already does,
  badly. Make is the right venue for orchestration.

### 2.2 Target Layout

After migration, `scripts/` is empty and deleted. Each capability lives
at the venue that matches its nature:

| Former script | New home | Kind | Rationale |
|---------------|----------|------|-----------|
| `compile-adapter-scopes.js` | `tools/oap/adapter-scopes-compiler/` | New Rust crate | Real logic (YAML parsing, scope compilation) |
| `fetch-axiomregent.js` | `make fetch-axiomregent` recipe | Makefile target | Orchestration (wraps `gh release download`) |
| `build-axiomregent.sh` | `make axiomregent-all` recipe | Makefile target | Orchestration (for-loop + `cargo build` + `cp` + `strip`) |

The Makefile recipes invoke existing tools (`gh`, `rustc`, `cargo`,
`cp`, `strip`) directly — there is no custom parser, no auth logic to
re-implement, no filesystem API to wrap. Reducing the ceremony is the
point of the migration.

### 2.3 Migration Order

The three migrations are independent and can ship in any order:

**Phase 1 — `adapter-scopes-compiler` (real logic → Rust).**
The script's output is committed
(`platform/services/statecraft/api/factory/adapter-scopes.json`) and
consumed at build time by statecraft. We regenerate with the new
binary, assert byte-identical output against the committed file (minus
an intentionally-omitted `compiled_at` timestamp), then delete the JS.

**Phase 2 — `make fetch-axiomregent` recipe (orchestration → Make).**
Replaces `scripts/fetch-axiomregent.js`. Wraps
`gh release download --repo <repo> --pattern axiomregent-<host> --dir <binaries> --skip-existing`.
Add `gh` to `check-deps`. Rewrite `product/apps/opc/package.json` predev
and `build:executables` hooks to invoke `make fetch-axiomregent-check`.
Replace the `make setup` call with the same.

**Phase 3 — `make axiomregent-all` recipe (orchestration → Make).**
Replaces `scripts/build-axiomregent.sh --all`. A `for` loop over
`CI_CROSS_TARGETS` (already defined by spec 104) that runs
`cargo build --release --target <t> --manifest-path crates/axiomregent/Cargo.toml`,
copies the resulting binary to `product/apps/opc/src-tauri/binaries/`, and
strips debug symbols on Unix. The single-host build already exists as
the `axiomregent` target.

Phase 1 ships with this spec as the reference migration. Phases 2 and 3
may land in separate PRs or together.

### 2.4 Governance Per Migration

Every migration MUST:

- For Rust-binary migrations: add the replacement crate's
  `[package.metadata.oap]` section so traceability picks it up.
- Preserve output byte-identically where the script produced a committed
  artifact (adapter-scopes.json); a before/after diff of the committed
  file MUST be empty in the migration PR, except for intentionally
  removed non-deterministic fields (e.g. `compiled_at`).
- Delete the script in the same PR as the replacement lands — no
  "coexistence" period.
- Update `make setup`, `product/apps/opc/package.json`, and any other
  callers in the same PR.
- Remove header comments referencing the retired script from any
  downstream consumer.

## 3. Functional Requirements

### FR-01: `adapter-scopes-compiler` Crate

A new Rust crate at `tools/oap/adapter-scopes-compiler/` MUST:

- Be a binary crate with `name = "open_agentic_adapter_scopes_compiler"`
  and `[[bin]]` named `adapter-scopes-compiler`
- Carry `[package.metadata.oap] spec = "105-scripts-to-binaries-migration"`
- Read every `factory/adapters/*/manifest.yaml` using a YAML parser
  (`serde_yaml`) with a typed schema
- Emit `build/adapter-scopes.json` and
  `platform/services/statecraft/api/factory/adapter-scopes.json` with
  byte-identical output to the pre-migration script
- Include an integration test that runs against the committed manifests
  and asserts the emitted JSON matches a golden file

### FR-02: `fetch-axiomregent` Makefile Recipe

A `fetch-axiomregent` target in the root `Makefile` MUST:

- Detect the host triple via `rustc -vV`
- Append `.exe` for Windows triples
- Create `product/apps/opc/src-tauri/binaries/` if missing
- Invoke `gh release download --repo $(AXIOMREGENT_REPO) --pattern axiomregent-<triple>[.exe] --dir product/apps/opc/src-tauri/binaries --skip-existing`
- Fail with a clear diagnostic if `gh` is not installed (pointer to
  install command and `gh auth login`)

A sibling `fetch-axiomregent-check` target MUST be idempotent: if the
sidecar binary already exists for the host triple, print a one-line
confirmation and exit 0; otherwise delegate to `fetch-axiomregent`.

### FR-03: `axiomregent-all` Makefile Recipe

An `axiomregent-all` target in the root `Makefile` MUST:

- Iterate `$(CI_CROSS_TARGETS)` (defined by spec 104)
- Per target: run `cargo build --release --target <t> --manifest-path crates/axiomregent/Cargo.toml`
- Append `.exe` for Windows, copy the resulting binary from
  `crates/target/<t>/release/axiomregent[.exe]` to
  `product/apps/opc/src-tauri/binaries/axiomregent-<t>[.exe]`
- Run `strip` on Unix targets (best-effort; tolerate absence)
- Fail fast on any target build error

The existing single-host `axiomregent` target (host-only build + copy)
MUST remain unchanged.

### FR-03.1: `check-deps` MUST List `gh`

The `check-deps` target MUST add `gh` to the required-tool list with
the install hint `brew install gh` and a note that `gh auth login` is
required after install.

### FR-04: Makefile Integration

After each migration:

- `make setup` MUST invoke the replacement, not the script
- A dedicated target (`make adapter-scopes`, `make fetch-axiomregent`,
  `make install-axiomregent`) MUST exist for the replacement
- No target or recipe MUST reference `scripts/` after migration completes

### FR-05: Package.json Hooks

For Phase 2, `product/apps/opc/package.json` scripts that shell into
`node ../../scripts/fetch-axiomregent.js` MUST be rewritten to invoke
the axiomregent binary instead (or the Makefile target that wraps it).

### FR-06: Delete The Directory

After all three phases, `scripts/` MUST be deleted. A grep of the
repository for the literal string `scripts/` (outside documentation,
changelogs, and historical spec text under `specs/037/` and `specs/073/`)
MUST return zero hits in active pipeline files.

## 4. Success Criteria

### SC-01: adapter-scopes.json Is Byte-Identical Pre/Post Phase 1

`git diff platform/services/statecraft/api/factory/adapter-scopes.json`
on the Phase 1 migration commit MUST produce no content changes —
only the `compiled_at` timestamp is permitted to differ, and the
compiler output SHOULD make that field deterministic by omitting or
freezing it.

### SC-02: make setup Still Works End-To-End

After each phase lands, a fresh clone running `make setup` MUST install
dependencies, build tools, compile the registry, and fetch/build the
axiomregent sidecar — just as it did before, with no `scripts/`
invocation anywhere in the Make output.

### SC-03: scripts/ Directory Is Absent After Phase 3

On the merge commit of Phase 3, `ls scripts/` MUST error with ENOENT.

### SC-04: Traceability Is Complete

`codebase-indexer compile` after each phase MUST map this spec (105) to
the newly-created crate's path via the `[package.metadata.oap]`
annotation, and the rendered `CODEBASE-INDEX.md` Layer 2 table MUST list
the crate.

### SC-05: No Behavioural Regression

Each migration PR MUST include a before/after trace showing:
- Phase 1: `adapter-scopes.json` byte-identical (minus frozen timestamp)
- Phase 2: `make setup` on a clean clone still produces a working
  sidecar binary
- Phase 3: `cargo build --release --target <triple> --manifest-path
  crates/axiomregent/Cargo.toml` via the install subcommand produces a
  binary in the expected location

## 5. Out of Scope (MVP)

- **Unifying `platform/Makefile` and the root Makefile.** Platform's
  Makefile is a Terraform/Helm harness; merging it would bloat the
  surface without clear benefit.
- **Killing `platform/services/statecraft/scripts/docker-build.sh`.**
  That lives under the statecraft service, not the repo root, and is
  scoped to its own deployment harness.
- **Porting the Makefile itself to a Rust runner.** Make remains the
  right tool for recipe orchestration; this spec only migrates the
  underlying programs it invokes.

## 6. Clarifications

- "Governed Rust binary" here means a crate under `tools/` or a
  subcommand on an existing crate, declaring its spec via
  `[package.metadata.oap]`, with tests and Makefile integration.
- The adapter-scopes compiler is a separate crate (not a subcommand of
  `spec-compiler`) because it compiles a different schema to a different
  destination; folding it into `spec-compiler` would conflate two
  unrelated contracts.
- Phase ordering is a recommendation; implementers MAY land phases in a
  different order as long as each phase independently satisfies its
  success criteria.

## Cross-references

- Spec 127 (`spec-code-coupling-gate`) adds a new Rust binary
  (`tools/spec-spine/spec-code-coupling-check/`) and a paired Makefile target.
  Added per the same convention this spec codifies — declares
  `[package.metadata.oap].spec`, mirrors its workflow in `make ci`,
  no `scripts/` artefact introduced. No change to this spec's
  migration-plan invariants.
