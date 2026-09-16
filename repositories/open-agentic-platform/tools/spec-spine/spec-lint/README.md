# spec-lint

Implements **Feature 006** ([`specs/006-conformance-lint-mvp/spec.md`](../../specs/006-conformance-lint-mvp/spec.md)): **optional** workflow **warnings** (`W-xxx`) for the **003–005** protocol. This tool does **not** replace **`spec-compiler`** (Feature **001**); it never writes **`registry.json`**.

## Heuristics (MVP)

| Code | Rule (summary) |
|------|------------------|
| **W-001** | `tasks.md`: a **checked** line contains the literal **`(complete)`** tag (Feature **004** optional convention) **and** `execution/verification.md` is missing. **Does not** fire on plain `- [x]` without that tag—narrow on purpose for MVP. |
| **W-002** | `spec.md`: `status: superseded` but body lacks obvious replacement pointer. |
| **W-003** | `spec.md`: `status: retired` but body lacks obvious rationale markers. |
| **W-004** | `execution/changeset.md` exists (non-example) but `execution/verification.md` missing. |
| **W-005** | `tasks.md`: **both** the literal **`(pending)`** substring **and** at least one **`###`** heading (one known mixed-pattern signal). **Not** a general “any two notation styles” detector—expand in a later **spec-lint** release if needed. |

**W-004 skip:** if the first 4 KiB of `changeset.md` matches `(?i)(example|illustrates|non-normative template)`.

**W-002** passes if the body contains `superseded by`, `## Supersession`, `replacement feature`, or a backtick-enclosed `` `NNN-...` `` id.

**W-003** passes if the body contains `## Retirement`, `**Retired**`, `rationale`, `withdrawn`, or `retired (`.

## Scope limits (MVP)

- **W-001** enforces the **explicit `(complete)` tag** convention only; other completion styles are intentionally ignored to avoid noise.
- **W-005** detects **one** specific combination (`(pending)` + `###`), not every possible mixed notation from Feature **004**.

## Build

```bash
cargo build --release --manifest-path tools/spec-lint/Cargo.toml
```

## Run (repository root)

```bash
./tools/spec-lint/target/release/spec-lint
```

Warnings print to **stderr**. **Exit 0** unless **`--fail-on-warn`** is set and at least one warning was emitted (**exit 1**).

```bash
./tools/spec-lint/target/release/spec-lint --fail-on-warn
```

## Optional `--repo`

```bash
./tools/spec-lint/target/release/spec-lint --repo /path/to/open-agentic-platform
```
