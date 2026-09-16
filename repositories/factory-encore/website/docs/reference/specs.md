# Spec corpus

The spec corpus (`specs/`) contains the governing specifications for factory-encore. Each spec lives in its own directory as `NNN-slug/spec.md` with YAML frontmatter. The directory name equals the frontmatter `id`.

## Spec inventory

| ID | Title | Domain | Kind | Status |
|----|-------|--------|------|--------|
| 000-factory-kernel | Factory kernel: spec-spine governance and the resilient CI surface | governance | governance | approved |
| 001-module-manifest-schema | Module manifest schema: declarative service composition and the module taxonomy | generator | architecture | approved |
| 002-encore-generator-core | Encore generator core: copy-base + select-driver + merge-config | generator | feature | approved |
| 003-user-management-module | User-management: the reference Encore service module | generator | feature | approved |
| 004-dual-app-generator | Dual-app generator: two independent Encore apps (external + staff, both rauthy OIDC) | generator | feature | approved |
| 005-architecture-doc-governance | Architecture documentation governance: human docs as derived views of the owning specs | generator | governance | approved |
| 006-factory-schema-lockstep | Generator/baseline lockstep: pin the generator to template-encore's frozen invariants | generator | architecture | approved |

## Closed taxonomies

Domains and kinds are closed enums declared in `spec-spine.toml`:

**Domains**: `governance`, `generator`

**Kinds**: `governance`, `architecture`, `feature`

Adding a new domain or kind requires editing `spec-spine.toml` and passing the corpus lint.

## Spec frontmatter fields

Every spec declares the following in its YAML frontmatter:

| Field | Required | Description |
|-------|----------|-------------|
| `id` | Yes | Unique identifier matching the directory name. |
| `title` | Yes | Human-readable title. |
| `status` | Yes | Lifecycle status (`draft`, `approved`, `deprecated`). |
| `created` | Yes | Creation date (ISO 8601). |
| `owner` | Yes | Author/owner identifier. |
| `kind` | Yes | One of the closed kind taxonomy values. |
| `domain` | Yes | One of the closed domain taxonomy values. |
| `risk` | Yes | Risk level (`low`, `medium`, `high`). |
| `implementation` | Yes | Implementation status (`pending`, `in-progress`, `complete`). |
| `depends_on` | Yes | Array of spec IDs this spec depends on. |
| `code_aliases` | No | Array of code-level aliases for grep/search. |
| `summary` | Yes | Multi-line summary of the spec's purpose. |
| `establishes` | No | Array of file paths this spec establishes (owns). |

## Key specs explained

### 000-factory-kernel

The governance kernel. It adopts spec-spine over the corpus and stands up the OAP resilient CI surface. The terminal `ci-gate` aggregates the governance gate, the generator test gate, the lockstep gate, and an AI PR review that passes with a visible notice on a Claude API failure (never a silent green).

### 002-encore-generator-core

The single-app generator: `setup-app.ts` performs copy-base, select-driver, merge-config, and optional module composition. It reuses `copyTemplateBase` and `setAuthDriver` as composable primitives.

### 004-dual-app-generator

The dual-app generator: `setup-dual-app.ts` produces two independent Encore applications (public + internal) from a single invocation. It reuses the core primitives from spec 002.

### 006-factory-schema-lockstep

The cross-repo lockstep. A committed lockfile (`baseline.lock.json`) pins the `template-encore` ref, core services, module catalog membership, and SHA-256 of frozen app-invariant spec hashes. The lockstep gate refuses any silent upstream drift.
