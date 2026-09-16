# spec-spine.toml

The `spec-spine.toml` file at the repository root is the configuration for the spec-spine governance CLI. It declares the closed taxonomies, the spec directory, the index inputs, and the coupling gate bypass floor.

## Full configuration

```toml
[project]
name = "factory-encore"

[specs]
dir = "specs"

[taxonomies]
domains = ["governance", "generator"]
kinds = ["governance", "architecture", "feature"]

[index]
extra_inputs = [
  "standards/**",
  ".github/workflows/**"
]

[couple]
bypass_floor = [
  "process/",
  "contract/",
  "adapters/acme-vue-encore/agents/",
  "adapters/acme-vue-encore/patterns/"
]
```

## Sections explained

### `[project]`

| Key | Value | Purpose |
|-----|-------|---------|
| `name` | `factory-encore` | Project identifier used in registry metadata. |

### `[specs]`

| Key | Value | Purpose |
|-----|-------|---------|
| `dir` | `specs` | Directory containing spec subdirectories (`NNN-slug/spec.md`). |

### `[taxonomies]`

Closed enums. Every spec must declare a `domain` and `kind` from these lists. Adding a value requires editing this file and passing `spec-spine lint --fail-on-warn`.

| Key | Values |
|-----|--------|
| `domains` | `governance`, `generator` |
| `kinds` | `governance`, `architecture`, `feature` |

### `[index]`

The codebase index hashes the always-hashed core (manifests, `specs/*/spec.md`, `spec-spine.toml`) plus the extra inputs declared here:

| Key | Value | Purpose |
|-----|-------|---------|
| `extra_inputs` | `["standards/**", ".github/workflows/**"]` | Additional paths whose changes should trip the staleness gate. |

Notably, `.claude/**`, `AGENTS.md`, and `CLAUDE.md` are **not** in `extra_inputs`. Editing them does not trip the staleness gate.

### `[couple]`

The coupling gate bypass floor. Paths listed here are excluded from the coupling gate because they are authored prose, not spec-owned generator code:

| Path | Reason |
|------|--------|
| `process/` | Process-layer prose (stages, agents, skills). |
| `contract/` | Mirrored schemas (canonical home is OAP). |
| `adapters/acme-vue-encore/agents/` | Agent prompts (authored prose). |
| `adapters/acme-vue-encore/patterns/` | Code-generation patterns (authored prose). |

The spec-spine CLI also has a built-in bypass floor that covers `.github/`, `docs/`, `README.md`, lockfiles, and `.derived/`.

## Relationship to CI

The `spec-spine.toml` file is part of the always-hashed governance core. Editing it trips the staleness gate and requires `npx spec-spine index` to refresh the codebase index. The spec-spine workflow (`spec-spine.yml`) runs unconditionally on every PR.
