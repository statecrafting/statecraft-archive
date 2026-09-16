# Data model: Compiled spec registry (MVP)

**Feature**: `000-bootstrap-spec-system`

## RegistryDocument (`registry.json`, deterministic)

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `specVersion` | string | yes | Format version for `registry.schema.json`. |
| `build` | BuildInfo | yes | Compiler identity, input root, content hash. **No wall-clock timestamp.** |
| `features` | FeatureRecord[] | yes | All compiled features from markdown inputs. |
| `validation` | ValidationSummary | yes | Aggregate validation result. |

## BuildInfo (inside `registry.json` only)

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `compilerId` | string | yes | Stable identifier of the compiler implementation (e.g. `open-agentic-spec-compiler`). |
| `compilerVersion` | string | yes | Semantic version of the compiler. |
| `inputRoot` | string | yes | Normalized repository-relative root (canonical full-repo value: `"."`). See Feature 000 research **D8**. |
| `contentHash` | string | yes | SHA-256 hex per `research.md` D2. |

## BuildMeta (`build-meta.json`, ephemeral)

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `builtAt` | string (ISO 8601 date-time) | yes | UTC wall-clock emission time. |
| `compilerId` | string | no | Optional duplicate for logs. |
| `compilerVersion` | string | no | Optional duplicate for logs. |

Schema: `contracts/build-meta.schema.json`.

## FeatureRecord

Normalized fields (from frontmatter + compiler):

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `id` | string | yes | Matches `specs/<id>/` and frontmatter `id`. |
| `title` | string | yes | From frontmatter. |
| `status` | string | yes | From frontmatter. |
| `created` | string | yes | From frontmatter ISO date. |
| `summary` | string | yes | From frontmatter; always normalized, never only inside a blob. |
| `specPath` | string | yes | Relative path to authoritative `spec.md`. |
| `sectionHeadings` | string[] | yes | Level-1 and level-2 headings in document order (exact depth fixed in compiler). |
| `authors` | string[] | no | From frontmatter when present. |
| `kind` | string | no | From frontmatter when present (e.g. `constitutional-bootstrap`). |
| `featureBranch` | string | no | From frontmatter `feature_branch` when present. |
| `extraFrontmatter` | object | no | Only for **unmapped** frontmatter keys; **max 8** keys; each value MUST match **`extraFrontmatterValue`** in `registry.schema.json` (string, number, boolean, null, or string array ≤64 items). **Forbidden:** nested objects, non-string arrays, copying the entire parsed YAML tree wholesale. |

## ValidationSummary

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `passed` | boolean | yes | True iff zero violations with severity `error`. |
| `violations` | Violation[] | yes | Stable list, sorted by `code` then `message`. |

## Violation

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `code` | string | yes | e.g. `V-001`, `V-004`. |
| `severity` | string | yes | `error` \| `warning` (MVP may emit only `error`). |
| `message` | string | yes | Human-readable description. |
| `path` | string | no | File path if applicable. |

## Out of scope for MVP JSON payload

- Full markdown body text (may be added in a later registry version).
- Graph edges between features (future **featuregraph** feature).
- xray scan results or axiomregent policy payloads.
