# The spec-spine, in detail

This guide covers how the `spec-spine` npm package governs this template: what
the corpus is, the four CLI verbs, typed ownership edges, manifest annotation,
`spec-spine.toml` configuration, coupling gate semantics, and where the gates
run.

For the tool's own semantics (grammar, lint codes, algorithm internals), see the
[spec-spine npm package](https://www.npmjs.com/package/spec-spine).

---

## 1. The corpus

The authoritative design record lives under `specs/`. Each spec is a small
markdown file at `specs/NNN-kebab-slug/spec.md` with YAML frontmatter:

```
specs/
  000-bootstrap/spec.md   # the constitutional root
  001-encore-app-architecture/spec.md
  ...
  015-claude-config-governance/spec.md
```

The `spec-spine` CLI compiles this corpus into two deterministic derived
artifacts under `.derived/`:

| Artifact | What it is |
|----------|-----------|
| `.derived/spec-registry/by-spec/*.json` | Every spec's frontmatter, relationships, and metadata (one shard per spec). The spec-as-source view. |
| `.derived/codebase-index/by-spec/*.json` + `by-package/*.json` | For each owned path in the repo, which spec claims authority (sharded per spec and per package). The code-as-source view. |

These files are never hand-edited. They are written only by the CLI and read
only through the CLI's typed subcommands.

---

## 2. The four CLI verbs

Install: `npm install` (the CLI ships as `spec-spine` in `devDependencies`).
Invoke: `npx spec-spine <verb>` or via Makefile targets.

### `compile`

Reads `specs/*/spec.md` and `spec-spine.toml`; emits the `.derived/spec-registry/by-spec/` shard tree.

```bash
npx spec-spine compile        # or: make spine-compile
```

Run after editing any `spec.md` frontmatter. Deterministic: same inputs produce
byte-identical output.

### `lint [--fail-on-warn]`

Validates every spec against the closed taxonomies (`kind`, `domain`) and
frontmatter schema rules declared in `spec-spine.toml`. `--fail-on-warn`
promotes warnings to errors — this is the mode CI runs in.

```bash
npx spec-spine lint --fail-on-warn   # or: make spine-lint
```

### `index` / `index check`

`index` walks the repo, hashes all governed inputs (manifests, specs, config,
`.claude/**`, workflow YAML, etc.), and emits the `.derived/codebase-index/` shard tree (`by-spec/` + `by-package/`).

`index check` verifies the committed index still matches the current tree.
Exit code 0 = fresh; non-zero = stale (run `make spine-index` to regenerate).

```bash
npx spec-spine index          # regenerate — make spine-index
npx spec-spine index check    # staleness gate — make spine-index-check
```

The inputs the index hashes are declared in `spec-spine.toml`
`[index] extra_hashed_inputs` plus the always-hashed core (manifests,
`specs/*/spec.md`, `spec-spine.toml` itself).

### `couple --base <ref>`

The PR-time coupling gate. Diffs `HEAD` against `<ref>` and refuses if an owned
code path changed without its owning spec also changing in the same diff.

```bash
npx spec-spine couple --base origin/main    # or: make spine-couple
```

Exit codes: `0` pass, `1` drift detected, `2` stale index (run `make spine-index`
first), `3` config error.

---

## 3. Typed ownership edges

Specs declare ownership over paths through typed edges in their frontmatter.
Authority over a path is derived by walking the graph, not asserted ad hoc.

| Edge | Meaning |
|------|---------|
| `establishes` | This spec first brought these paths into being. |
| `extends` | Adds surface to a predecessor's territory without disturbing it. |
| `refines` | Tightens behavior on a specific aspect of a predecessor. |
| `supersedes` | Replaces a predecessor, partially or fully. |
| `amends` | Patches a predecessor in place (clarification, correction, restriction). |
| `co_authority` | Shares a path with another spec on a named section. |
| `constrains` | Asserts an invariant every other spec must respect. |
| `references` | Non-owning pointer — records a relationship without claiming authority. |

Ownership is over **units**, not just files. A unit can be a `file`, a `dir`,
a `section` (named anchor within a file), or a `symbol` (a specific export).
This makes co-authority tractable: the root `Makefile` has many specs adding
targets under named section anchors.

---

## 4. Manifest annotation

npm packages link to their owning spec via a top-level key in `package.json`.
The namespace is `"spec-spine"` (set by `[manifest] metadata_namespace` in
`spec-spine.toml`):

```json
{
  "name": "@template/shared",
  "version": "1.0.0",
  "spec-spine": {
    "spec": "005-shared-package"
  }
}
```

The `index` verb walks every `package.json` found by the workspace resolver
(npm workspaces root + `standalone_npm_packages` in `spec-spine.toml`) and
includes these annotations in the traceability map.

---

## 5. `spec-spine.toml` configuration in use

```toml
[manifest]
metadata_namespace = "spec-spine"    # key name in package.json

[domains]
allowed = ["governance", "app", "ci-cd", "agentic"]

[kind]
allowed = ["architecture", "feature", "governance"]

[layout]
specs_dir     = "specs"
derived_dir   = ".derived"
standards_dir = "standards/spec"
npm_workspaces        = ["package.json"]
standalone_npm_packages = ["apps/api"]   # Encore app, outside npm workspace

[index]
extra_hashed_inputs = [
  "standards/**",
  ".github/workflows/**", ".github/actions/**",
  ".claude/**",
  ".mcp.json",
  ".githooks/**",
  "tools/lint/**",
]
resolver_exclusions = ["node_modules", ".derived", "dist", "build", ".next"]

[coupling]
bypass_prefixes = []          # additions to the built-in floor
waiver_keyword  = "Spec-Drift-Waiver:"
```

**`standalone_npm_packages`** — `apps/api` is the Encore.ts backend. Encore
owns its own install/build lifecycle and sits outside the npm workspace declared
in the root `package.json`. Listing it here ensures the index discovers its
`package.json` annotation.

**`extra_hashed_inputs`** — any edit to `.claude/**`, workflow YAML, or
`tools/lint/**` without regenerating the index will trip `npx spec-spine index check`.
This closes the loop on quiet agentic-config edits.

---

## 6. Coupling gate semantics

The gate diffs `HEAD` against the base ref and classifies every changed path:

- **Bypass floor** (built-in): `.github/`, `docs/`, `README.md`, `CODEOWNERS`,
  lockfiles, `.derived/`. Low-risk surfaces, friction-free by default.
- **Additional bypass**: `[coupling] bypass_prefixes` in `spec-spine.toml`
  (empty in this template).
- **Owned paths**: paths claimed by a spec through `establishes`, `extends`,
  etc. Changing an owned path without touching its owning spec = exit 1 (drift).

**Escape hatch**: include a `Spec-Drift-Waiver: <reason>` line in the PR body.
This is the blessed path for legitimate consolidated changes (e.g. a dep refresh
that touches many owned paths). Pass the PR body with `--pr-body <file>` — CI
does this automatically via the workflow env.

```bash
# CI (spec-spine.yml):
printf '%s' "$PR_BODY" > /tmp/pr-body.txt
npx spec-spine couple --base "origin/${BASE_REF}" --head HEAD --pr-body /tmp/pr-body.txt
```

---

## 7. Where gates run

The four governance verbs run identically in three places:

| Context | Entry point | Notes |
|---------|------------|-------|
| **Local (daily)** | `make spine` | Runs all four verbs in gate order. `make ci` runs `make spine` + npm lint/typecheck/test + workflow-pins lint. |
| **Pre-commit (opt-in)** | `.githooks/pre-commit` | Enable: `git config core.hooksPath .githooks`. Runs index check and workflow-pins lint before every commit. Disable: `git config --unset core.hooksPath`. |
| **Pre-PR** | `make pr-prep` | Regenerates the index (`make spine-index`) and runs the coupling gate (`make spine-couple`). Stage the `.derived/codebase-index/` shards if they drifted. |
| **CI (constitutional)** | `.github/workflows/spec-spine.yml` | Always-on. Compile → lint `--fail-on-warn` → index check → couple (PR-only). Dispatched from the CI orchestrator (spec 009). |

**`make pr-prep` is the command to run before `git commit` on a PR.** It
catches the two checks that fail first in CI when forgotten.
