---
id: "118-workflow-spec-traceability"
slug: workflow-spec-traceability
title: Workflow-to-Spec Traceability — surface "# Spec:" headers in the codebase index
status: approved
implementation: complete
owner: bart
created: "2026-04-28"
amended: "2026-06-18"
amendment_record: |
  amended 2026-06-18 by spec 217 (engine-swap collapse): the in-tree codebase-indexer that scanned workflow headers was deleted; that logic is now in spec-spine-core. The codebase-indexer crate-unit is stripped (path deleted); this spec's authority over the `# Spec:` workflow-header convention (.github/workflows) survives.
kind: governance
domain: tooling
risk: low
depends_on:
  - "000-bootstrap-spec-system"  # bootstrap-spec-system
  - "101-codebase-index-mvp"  # codebase-index-mvp (the structural index this extends)
  - "103-init-protocol-governed-reads"  # init-protocol-governed-reads (governed read discipline)
code_aliases: ["WORKFLOW_TRACEABILITY"]
# 217 deleted the in-tree codebase-indexer; workflow scanning is now in
# spec-spine-core (spec-spine index). The codebase_indexer crate-unit is stripped
# (deleted); this spec's authority over the `# Spec:` workflow-header convention
# (.github/workflows) survives below. Amended by 217.
refines:
  - aspect: "spec-header-convention"
    unit: { kind: directory, path: .github/workflows }
references:
  - role: artifact
    unit: { kind: file, path: .derived/codebase-index/CODEBASE-INDEX.md }
summary: >
  Adopt a header-line convention `# Spec: NNN-slug` in every
  .github/workflows/*.yml. Extend tools/spec-spine/codebase-indexer to scan workflow
  files for the convention and emit a `workflow_traceability` block in
  index.json, rendered as a new "Layer 5: CI Workflow Traceability" section
  of CODEBASE-INDEX.md. Closes the gap where Rust crates trace to specs via
  `[package.metadata.oap]` but workflows have no equivalent.
---

# 118 — Workflow-to-Spec Traceability

## 1. Problem Statement

Spec 101 (`codebase-index-mvp`) gave the project a four-layer structural
index:

1. Crate & package inventory (54 entries today).
2. Spec-to-code traceability (107 mapped specs via `[package.metadata.oap]`
   and explicit `implements:` paths in spec frontmatter).
3. Factory adapter inventory.
4. Infrastructure inventory.

The traceability layer answers "which crate implements spec NNN" and
"which spec governs crate X." It does not answer the analogous question for
**CI workflows.** Today:

- A reader of `.github/workflows/build-axiomregent.yml` can see in the
  comment header that it backs spec 037 (`Feature 037: Build axiomregent
  sidecar binaries…`). That's a one-off, ad-hoc convention.
- `ai-pr-review.yml` and `ai-changelog.yml` cite "Backing spec: 085."
  Same one-off.
- The other 17 workflow files have no spec annotation at all. The spec is
  implicit in the file's path and content.

This is a real gap. Spec 104 (`makefile-ci-parity-contract`) is implemented
*by* `.github/workflows/ci-parity.yml`, but the spec's `implements:` block
lists the workflow path and the indexer happily renders it — meanwhile no
data flows back from the workflow file itself. The traceability is
spec-to-workflow only, not workflow-to-spec.

This spec promotes the existing one-off comment convention to a
machine-readable header line, extends the codebase-indexer to surface it,
and renders a new layer of the codebase index.

## 2. Goals

- **One canonical convention.** Every `.github/workflows/*.yml` file MUST
  contain a `# Spec: NNN-slug` line within its first 10 lines, OR be on an
  explicit "no spec" allowlist with a comment explaining why.
- **Extend the codebase-indexer, don't fork it.** The scanner gains a new
  pass over `.github/workflows/**`; the index gains a new top-level field
  `workflow_traceability`; the renderer gains a new section.
- **Validation is governed.** A new diagnostic code (`I-105`) fires when a
  workflow has neither a `# Spec:` header nor an allowlist entry.
- **No new tools.** All work lives inside the existing
  `tools/spec-spine/codebase-indexer` crate. No new binaries, no new flags.
- **Allowlist for genuinely spec-less workflows.** Some workflows
  (composite actions for installation, the AI workflows backed by 085) are
  fine as-is; the allowlist documents the rationale rather than failing
  the gate.

## 3. Scope

### In scope

- Header convention specification.
- `tools/spec-spine/codebase-indexer/src/workflows.rs` (new module): scan
  `.github/workflows/**/*.yml`, parse the leading comment block, extract
  `# Spec:` lines.
- Index schema addition: `workflow_traceability: Vec<WorkflowTrace>`.
- Allowlist file: `tools/spec-spine/codebase-indexer/workflow-allowlist.toml` lists
  workflow paths that are intentionally spec-less, each with a
  `reason: "..."` field.
- Diagnostic `I-105: workflow file declares no Spec: header and is not on
  the allowlist`.
- Renderer: new `Layer 5: CI Workflow Traceability` section of
  `CODEBASE-INDEX.md`.
- Header backfill: every existing workflow gets a `# Spec:` line or an
  allowlist entry.

### Out of scope

- Composite actions under `.github/actions/`. They are reused by workflows
  and don't have a 1:1 spec mapping. A future spec may extend this
  convention to actions; for now they are excluded.
- Bidirectional reconciliation (warn when a spec's `implements:` lists a
  workflow but the workflow's `# Spec:` doesn't match). A linter
  enhancement, not v1.

## 4. Header Convention

A workflow file MUST contain, within its leading comment block (the
implementation scans the first 20 lines), one or more lines matching:

```
# Spec: NNN-kebab-case-slug
```

Multiple `# Spec:` lines are allowed (some workflows back multiple specs).
The slug MUST match a spec id known to the registry; an unknown slug is
diagnostic `I-106` (warning, not error, because spec drafts may rename).

Allowlist entries live in `tools/spec-spine/codebase-indexer/workflow-allowlist.toml`:

```toml
[[allowlist]]
path = ".github/workflows/ai-pr-review.yml"
reason = "Backed by spec 085 via comment header; allowlist preserves explicit waiver."
spec = "085"  # optional informational link

[[allowlist]]
path = ".github/workflows/dependabot-auto-merge.yml"  # if/when added
reason = "Pure ops automation; no feature spec."
```

If `spec` is set on an allowlist entry, the workflow is treated *as if* it
had a `# Spec: <spec>` header — keeping traceability live without forcing
the comment edit. The allowlist is the documented escape hatch.

## 5. Index Schema

`.derived/codebase-index/index.json` gains a new top-level field
`workflowTraceability` (camelCase per the existing schema convention —
`schemaVersion`, `factoryAdapters`, etc.):

```json
{
  "workflowTraceability": [
    {
      "path": ".github/workflows/build-axiomregent.yml",
      "specs": ["037-cross-platform-axiomregent"],
      "source": "header"
    },
    {
      "path": ".github/workflows/ai-pr-review.yml",
      "specs": ["085-remote-control-cli"],
      "source": "allowlist"
    }
  ]
}
```

`source` is `"header"`, `"allowlist"`, or `"unmapped"` (which means the
file is on neither — and is diagnostic I-105).

The schema version of `index.json` is `1.3.0` (1.2.0 → 1.3.0 for the
workflow traceability addition; consumers are tolerant of unknown fields
per spec 101's contract).

## 6. Renderer Output

A new section of `CODEBASE-INDEX.md`:

```markdown
## Layer 5: CI Workflow Traceability (NN total)

| Workflow | Specs | Source |
|----------|-------|--------|
| `.github/workflows/build-axiomregent.yml` | 037-cross-platform-axiomregent | header |
| `.github/workflows/ci-parity.yml`         | 104-makefile-ci-parity-contract | header |
| `.github/workflows/ai-pr-review.yml`      | 085-remote-control-cli | allowlist |
```

Sorted alphabetically by path. If any workflow has `source: "unmapped"`,
the renderer emits an `I-105` diagnostic line in the existing
`## Diagnostics` block.

## 7. Acceptance Criteria

- **AC-1:** Every existing `.github/workflows/*.yml` file either has a
  `# Spec: NNN-slug` line in its first 10 lines OR an entry in
  `workflow-allowlist.toml`. `codebase-indexer compile` produces no
  `I-105` diagnostics on a clean checkout.
- **AC-2:** `index.json` contains a `workflow_traceability` array with
  one entry per workflow file. Each entry has a non-empty `specs` array.
- **AC-3:** `CODEBASE-INDEX.md` renders Layer 5 with the same row count as
  the workflow file count (`ls .github/workflows/*.yml | wc -l`).
- **AC-4:** A new workflow added without `# Spec:` and not on the
  allowlist triggers `I-105` and fails `codebase-indexer check` (which is
  already a CI gate).
- **AC-5:** `cargo test --manifest-path tools/spec-spine/codebase-indexer/Cargo.toml`
  passes, including new unit tests for the workflow-scanning pass and the
  allowlist parser.

## 8. Backfill Plan

The implementation commits the indexer changes first, then a follow-up
commit backfills the headers and allowlist. Because `I-105` is a warning,
not an error, the staged rollout is safe:

1. Land the scanner + diagnostic + renderer (warnings only). **Done.**
2. Backfill headers + allowlist in the same PR or a fast follow-up.
   **Done** — every `.github/workflows/*.yml` file carries a `# Spec:`
   header (allowlist remains empty).
3. Promote `I-105` from warning to blocking in a subsequent PR once the
   warning count reaches zero on main. **Done** — `codebase-indexer
   check` returns exit code 2 (`IndexError::Blocking`) when any I-105
   diagnostic is present in `index.json`. The existing CI gate
   (`codebase-indexer check` invoked from `ci-codebase-index.yml`) now
   blocks PRs that introduce unmapped workflows.

## 9. Why this isn't a CLAUDE.md addendum

CLAUDE.md is project-author guidance — durable instructions for human and
AI contributors. The `# Spec:` convention is **machine truth**: a parser
consumes it, an index emits it, a renderer surfaces it. Per constitution
Principle II, machine-consumable structure lives in compiler-emitted JSON,
not in CLAUDE.md prose. The convention IS documented in CLAUDE.md (a one-
line addition under "Key Conventions"), but the contract is enforced by
the indexer.

## Cross-references

- Spec 129 (`granular-package-oap-metadata`) extends the same convention
  pattern (`# Spec: NNN-slug` header) to Rust source files via
  `// Spec: specs/NNN-slug/spec.md`. The parser and index entries live
  in the same `tools/spec-spine/codebase-indexer/` crate. Spec 129 bumps
  `schemaVersion` 1.1.0 → 1.2.0 and extends `TraceSource`. No change
  to spec 118's workflow-header behaviour.


## Amendments received

**Amendment 2026-05-24 (record: 178-opc-directory-rename).**
Spec 178 (opc-directory-rename, 2026-05-24): mechanical path rename
`product/apps/desktop/*` → `product/apps/opc/*`. No semantic change
to this spec's claims; owned paths inherit the new prefix.

## Amendment 2026-06-29 (reset-prep housekeeping)

`ci-statecraft.yml` and `cd-statecraft.yml` had their `encore build --config`
repointed from the retired `infra.config.hetzner.json` to the unified
`infra.config.json`. Mechanical filename change; no change to workflow
traceability claims.


## Security hardening amendment (2026-07-02)

Removed a shell-injection vector in release-desktop.yml: the workflow_dispatch tag input is now passed through an env var rather than interpolated directly into the run shell.

Recorded during the cross-subsystem security-hardening sweep; couples the security fixes in the code paths this spec authors to their owning spec per the spec 127 coupling gate.
