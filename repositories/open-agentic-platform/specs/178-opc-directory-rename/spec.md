---
id: "178-opc-directory-rename"
slug: opc-directory-rename
title: "Rename product/apps/desktop → product/apps/opc"
status: approved
implementation: complete
owner: open-agentic-platform
created: "2026-05-24"
kind: migration
domain: opc
risk: low
authors:
  - "open-agentic-platform"
language: en
code_aliases:
  - OPC_DIRECTORY_PATH
extends:
  - spec: "032-opc-inspect-governance-wiring-mvp"
    nature: additive
    unit: { kind: directory, path: product/apps/opc }
amends:
  - "034-featuregraph-registry-scanner-fix"
  - "047-governance-control-plane"
  - "101-codebase-index-mvp"
  - "104-makefile-ci-parity-contract"
  - "118-workflow-spec-traceability"
  - "129-granular-package-oap-metadata"
  - "131-adversarial-prompt-refusal-policy"
  - "134-fast-local-ci-mode"
  - "135-fast-ci-as-default"
  - "154-logical-unit-ownership-grammar"
  - "156-references-edge-provenance-grammar"
  - "161-knowledge-requirements-provenance-emission"
  - "167-born-with-spec-spine-kernel"
  - "168-per-project-governance-certificate"
  - "169-tool-schema-strictness"
amends_sections: []
references:
  - role: precedent
    unit: { kind: file, path: specs/105-scripts-to-binaries-migration/spec.md }
summary: >
  Mechanical rename of the OPC desktop app's on-disk location from
  the former path under `product/apps/` to `product/apps/opc`. The
  former directory name was inconsistent with the binary name `opc`
  and with the broader OPC nomenclature used across the spec corpus.
  The rename is purely structural: the binary name (`opc`), the npm
  package name (`@opc/desktop`), the Tauri identifier, the SBOM
  artifact basenames, and all runtime behavior are out of scope. The
  rename PR also folds in a single missing `[package.metadata.oap]`
  claim on `product/apps/opc/src-tauri/Cargo.toml` pointing at spec
  032 — a pre-existing gap identified during the precondition survey
  for the upcoming codification handoff.
---

# Feature Specification: Rename the OPC desktop directory to `product/apps/opc`

## Purpose

Bring the on-disk directory name for the OPC desktop application into
alignment with the rest of the OPC nomenclature before public launch
makes the rename expensive. Pre-launch the path is purely internal
mechanical work; post-launch it would appear in screenshots, READMEs,
announcement copy, third-party references, and the public release
surface, raising the rename cost asymmetrically. The cost asymmetry
argues for renaming now.

This spec also records the addition of an `[package.metadata.oap]
spec = "032-opc-inspect-governance-wiring-mvp"` declaration to
`product/apps/opc/src-tauri/Cargo.toml`. The `opc` `rust-lib-bin`
crate at the heart of the desktop application carried no `oap.spec`
claim before this change, and the rename PR is the natural carrier —
it touches the file mechanically. The claim points at 032 as primary
owner; future codification work will update the claim as ownership
evolves.

## Scope

In scope:

- Rename the former OPC desktop app directory (previously
  `product/apps/<former-name>`) to `product/apps/opc` on disk (via
  `git mv`).
- Update every path reference that previously named
  `product/apps/<former-name>` (or the bare `apps/<former-name>`
  form used in workflow snippets, parity-check test fixtures, and
  doc comments) so it points at `product/apps/opc`. Affected
  surfaces: spec bodies and frontmatter under `specs/`, the root
  `Cargo.toml` workspace exclude list, CI workflows under
  `.github/workflows/`, the root `Makefile`, root and `docs/` prose,
  `CLAUDE.md`, `AGENTS.md`, the codebase-indexer's manifest discovery
  (`tools/spec-spine/codebase-indexer/src/manifest.rs`), the OAP
  policy-compiler and ci-parity-check test fixtures
  (`tools/oap/...`), and Rust doc comments in `crates/factory-engine`
  and `crates/axiomregent` that name the path in narrative form.
- Add a single `[package.metadata.oap] spec =
  "032-opc-inspect-governance-wiring-mvp"` declaration to
  `product/apps/opc/src-tauri/Cargo.toml`.

Out of scope (explicit, by halt-trigger discipline):

- Any code change beyond path references. No refactors, no cleanups,
  no behavioral changes, no version bumps. If a path update
  mechanically forces a behavioral change (none is expected), that
  is a separate spec.
- The npm package name `@opc/desktop` in
  `product/apps/opc/package.json`. The package name is an identifier,
  not a path. Renaming it is a follow-up.
- CI workflow filenames `ci-desktop.yml`, `release-desktop.yml`,
  `build-axiomregent.yml`. These are build-target identifiers and
  the parity-check tool also names them as constants. Renaming the
  files is a follow-up.
- The SBOM artifact basenames (`sbom-desktop-<triple>.cdx.json`).
  These are release-artifact identifiers consumed by external
  release pipelines and customers; renaming them is a follow-up
  with a separate compatibility plan.
- The binary name `opc` (unchanged — already aligned).
- The Tauri identifier (unchanged — already aligned).
- The `domain:` field on this or any other spec. The next session
  authors the `domain:` field spec and backfills `domain: opc`
  across the OPC-tract specs including this one.
- Phase 1 of the codification handoff at
  `/tmp/handoffs/opc-spine-seam-fix-2026-05-23/`. This spec is a
  precondition; it is not the handoff.

## Mechanical change list

The find/replace plan, itemized by path surface:

1. `git mv` of the former OPC desktop directory to
   `product/apps/opc`.
2. **Spec corpus** (`specs/**/*.md`): replace every occurrence of
   the former path with `product/apps/opc`. This includes
   `implements:` lists, `extends:` units, `co_authority:` units,
   `references:` units, body prose, and changeset / verification /
   plan / tasks supplementary docs.
3. **Workspace declarations**: update the root `Cargo.toml`'s
   `exclude = [...]` entry that named the former
   `<former-path>/src-tauri` to point at
   `product/apps/opc/src-tauri`. Also update the explanatory
   comment a few lines above. `product/pnpm-workspace.yaml` uses
   globbed `apps/*` so no change required there.
4. **CI workflows** (`.github/workflows/`): update path references
   in `ci-desktop.yml`, `release-desktop.yml`, `ci-supply-chain.yml`,
   `build-axiomregent.yml`. Workflow filenames are out of scope.
5. **Root `Makefile`**: update all targets that previously `cd`'d
   into the former directory or named former-path-prefixed paths
   for `src-tauri/Cargo.toml` / `dist` / `package.json`.
6. **Root documentation**: update `README.md` (two locations),
   `CLAUDE.md` (two locations), `AGENTS.md`, and all references in
   `docs/`.
7. **Tools sources**: update the manifest-discovery constant in
   `tools/spec-spine/codebase-indexer/src/manifest.rs` (the
   `[workspace.exclude]` parallel list); update test fixtures and
   inline workflow YAML constants in
   `tools/oap/policy-compiler/src/lib.rs` and
   `tools/oap/ci-parity-check/src/lib.rs`.
8. **Rust doc comments**: update path-naming narrative comments in
   `crates/factory-engine/src/statecraft_client.rs` and
   `crates/axiomregent/src/feature_tools.rs`.
9. **Generated fixtures**: regenerate
   `crates/featuregraph/tests/golden/features_graph.json` via
   `UPDATE_GOLDEN=1 cargo test -p featuregraph` after the spec
   frontmatter updates land.
10. **`.derived/codebase-index/index.json`**: NOT hand-edited.
    Regenerates from `make pr-prep`.

## `oap.spec` claim addition

Add to `product/apps/opc/src-tauri/Cargo.toml` under `[package]`:

```toml
[package.metadata.oap]
spec = "032-opc-inspect-governance-wiring-mvp"
```

Rationale: the `opc` `rust-lib-bin` crate is the heart of the
desktop application, but the precondition survey for the
codification handoff confirmed it carried no `oap.spec` claim.
Adding the claim here gives the rename PR a single natural carrier
for that fold-in. Spec 032 (`opc-inspect-governance-wiring-mvp`)
is the closest existing owner; an upcoming codification spec will
take over primary ownership and the claim will update at that time.

## Requirements

- **FR-001**: The former OPC desktop directory no longer exists on
  disk; `product/apps/opc` exists and contains the same tree
  (preserved by `git mv`).
- **FR-002**: A working-tree grep for the former path (excluding
  `node_modules`, `target`, `.derived`) returns zero matches. Same
  for the bare-form path in narrative comments and test fixtures.
- **FR-003**: `product/apps/opc/src-tauri/Cargo.toml` declares
  `[package.metadata.oap] spec = "032-opc-inspect-governance-wiring-mvp"`.
- **FR-004**: `make pr-prep` (codebase index regeneration + spec/code
  coupling gate against `origin/main`) exits zero.
- **FR-005**: `spec-lint` does not regress; V-020 does not fire on
  this spec.
- **FR-006**: `cargo build --manifest-path
  product/apps/opc/src-tauri/Cargo.toml` exits zero.

## Success criteria

- **SC-001**: The rename is a no-op for product behavior. The
  desktop application builds, runs, and tests with the new path
  identically to the old.
- **SC-002**: The spec/code coupling gate (spec 127, amended by
  spec 130 and 133) holds: every spec that previously named the
  former path in `implements:` / `establishes:` / `extends:` /
  `refines:` / `co_authority:` units now names `product/apps/opc`
  and the gate accepts the diff because all such spec frontmatter
  is itself part of this PR.
- **SC-003**: The codebase index regenerates cleanly. The `opc`
  crate's spec column in `CODEBASE-INDEX.md` shows
  `032-opc-inspect-governance-wiring-mvp` instead of `-`.
- **SC-004**: Strict path-only discipline preserved. The PR contains
  no behavioral changes, no version bumps, no refactors.

## Out-of-scope (follow-ups surfaced)

Items the brief asked to surface as follow-ups rather than bundle:

1. **Rename `@opc/desktop` package to a path-aligned name.** Pure
   identifier rename; affects `pnpm --filter` invocations and the
   parity-check fixture in
   `tools/oap/ci-parity-check/src/lib.rs`. Defer to a separate
   PR.
2. **Rename CI workflow files** (`ci-desktop.yml`,
   `release-desktop.yml`). Affects the parity-check workflow
   filename constant and any external references to workflow URLs.
   Defer.
3. **Rename SBOM artifact basenames** (`sbom-desktop-<triple>` →
   `sbom-opc-<triple>`). Externally-visible release artifact
   identifier; needs a compatibility plan for consumers. Defer.

## Notes on `domain:` field

The brief explicitly defers the `domain:` field on this spec until
the next session, which authors the `domain:` field spec and
backfills `domain: opc` across the OPC-tract corpus. This spec does
not declare a `domain:` field.
