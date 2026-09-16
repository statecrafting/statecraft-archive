---
paths:
  - "**/Cargo.toml"
  - "Makefile"
  - "Makefile.*"
---

# Raw build invocations

These are the underlying cargo commands behind the Makefile entry points
(`make setup`, `make ci`, `make registry`, `make pr-prep`). Prefer the
Makefile targets in normal use; reach for these only when investigating
a specific tool or driving a build outside the Makefile.

## Spec-spine tools

The four in-tree spec-spine binaries were deleted in spec 217 and replaced by the published
`spec-spine-cli` crate (see spec 217-spec-spine-engine-swap-collapse). Install once via:

```bash
cargo install spec-spine-cli --version 0.10.0 --locked
# or: make setup  (installs as part of contributor bootstrap)
```

```bash
# Compile spec registry
spec-spine compile

# Index commands
spec-spine index                    # build/rebuild the codebase index
spec-spine index check              # staleness gate
spec-spine index check --slice claude-config  # config-slice gate
spec-spine index render             # refresh CODEBASE-INDEX.md
spec-spine index orphans --json     # list crates/packages with no oap.spec

# Registry read commands
spec-spine registry list
spec-spine registry list --ids-only
spec-spine registry list --json
spec-spine registry show <feature-id>
spec-spine registry status-report --json --nonzero-only
spec-spine registry relationships --json

# Spec/code coupling gate
spec-spine couple --base <ref> --head <ref> --paths-from <file>

# Spec lint (survives in-tree)
cargo build --release --manifest-path tools/spec-spine/spec-lint/Cargo.toml
```

## OAP-specific tools

```bash
# OAP registry enrichment (by-authority queries; spec 217-spec-spine-engine-swap-collapse)
oap-registry-enrich by-authority
cargo build --release --manifest-path tools/oap/oap-registry-enrich/Cargo.toml

# OAP code index enrichment
cargo build --release --manifest-path tools/oap/oap-code-index-enrich/Cargo.toml
./tools/oap/oap-code-index-enrich/target/release/oap-code-index-enrich render

# Policy compiler
cargo build --release --manifest-path tools/oap/policy-compiler/Cargo.toml
```

## Per-crate target dirs

The Makefile passes `--target-dir <crate>/target` overrides per issue #46
to avoid workspace-wide rebuilds. Direct `cargo build` without
`--target-dir` lands in the workspace `target/` and may not match what
the Makefile expects. Prefer `make <target>` for routine work.
