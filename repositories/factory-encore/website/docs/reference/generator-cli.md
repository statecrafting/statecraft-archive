# Generator CLI

The `acme-vue-encore` adapter ships a deterministic generator under `adapters/acme-vue-encore/scripts/`. Five CLI entry points handle application generation and module management.

## setup-app

Generates a single Encore.ts + Vue 3 application from the `template-encore` lean baseline.

```bash
npx tsx adapters/acme-vue-encore/scripts/setup-app.ts \
  --profile <minimal|public|internal> \
  --dest <path> \
  [--source <path>] \
  [--with <module>...] \
  [--no-git] \
  [--no-install]
```

| Flag | Required | Description |
|------|----------|-------------|
| `--profile` | Yes | One of `minimal`, `public`, or `internal`. Sets the auth driver and default module set. |
| `--dest` | Yes | Destination directory for the generated application. |
| `--source` | No | Path to a `template-encore` checkout. Defaults to `TEMPLATE_ENCORE_SOURCE` env var or a sibling `template-encore` directory. |
| `--with` | No | Additional modules to compose (e.g., `--with user-management --with api-gateway`). |
| `--no-git` | No | Skip `git init` in the destination. |
| `--no-install` | No | Skip `npm install` in the destination. Implies `--no-git`. |

### Semantics

- The destination must be empty or non-existent (unless overridden interactively).
- `--no-git` and `--no-install` are designed for machine-driven runs where the consuming platform owns VCS state and dependency installation.
- When `NO_GIT=true` or `NO_INSTALL=true` environment variables are set, they have the same effect as the corresponding flags.

## setup-dual-app

Generates two independent Encore applications (public + internal) from a single invocation.

```bash
npx tsx adapters/acme-vue-encore/scripts/setup-dual-app.ts \
  --dest <path> \
  [--source <path>] \
  [--yes] \
  [--no-git] \
  [--no-install]
```

| Flag | Required | Description |
|------|----------|-------------|
| `--dest` | Yes | Destination root. Produces `<dest>/public/` and `<dest>/internal/`. |
| `--source` | No | Path to a `template-encore` checkout. |
| `--yes` | No | Skip interactive confirmation prompts. |
| `--no-git` | No | Skip per-variant `git init`. |
| `--no-install` | No | Skip `npm install` in both variants. Implies `--no-git`. |

### Output shape

```
<dest>/
  public/     complete Encore app; AUTH_DRIVER=rauthy
  internal/   complete Encore app; AUTH_DRIVER=rauthy
```

Each subdirectory is a standalone Encore application with its own `encore.app`, database, and deployment boundary. The dual generator does not compose `--with` modules.

## add-module

Composes a module into an already-generated application.

```bash
npx tsx adapters/acme-vue-encore/scripts/add-module.ts \
  <module-name> \
  [--root <path>] \
  [--list] \
  [--dry-run] \
  [--no-install]
```

| Flag | Required | Description |
|------|----------|-------------|
| `<module-name>` | Yes (unless `--list`) | The module to install. |
| `--root` | No | Path to the generated application root. Defaults to current directory. |
| `--list` | No | List available modules and exit. |
| `--dry-run` | No | Show what would be done without making changes. |
| `--no-install` | No | Skip `npm install` after composition. |

### Behavior

- Validates the module manifest and checks for conflicts.
- Auto-removes conflicting modules if present.
- Auto-installs module dependencies (declared in `requires`).
- Copies service directories, merges migrations, binds secrets, merges CORS entries.
- Updates `template.json` to track the installed module set.
- Regenerates `apps/web/src/modules.ts` for frontend nav registration.
- Merges environment variables into `.env.example`.

## remove-module

Removes a previously composed module from an already-generated application.

```bash
npx tsx adapters/acme-vue-encore/scripts/remove-module.ts \
  <module-name> \
  [--root <path>] \
  [--dry-run] \
  [--no-install]
```

| Flag | Required | Description |
|------|----------|-------------|
| `<module-name>` | Yes | The module to remove. |
| `--root` | No | Path to the generated application root. |
| `--dry-run` | No | Show what would be done without making changes. |
| `--no-install` | No | Skip `npm install` after decomposition. |

### Behavior

- Checks installation state and reverse dependencies (refuses removal if other modules depend on it).
- Refuses removal of always-on modules.
- Deletes owned files and cleans empty directories.
- Decomposes Encore services, migrations, secrets, and CORS using recorded `composedMigrations`.
- Updates `template.json`.
- Comments out (does not delete) environment variables.
- If the installation lacks a `composedMigrations` record (legacy install), emits a visible warning and skips migration deletion rather than silently omitting it.

## validate-modules

Validates the module catalog and/or a generated project's module state.

```bash
npx tsx adapters/acme-vue-encore/scripts/validate-modules.ts \
  [--root <path>] \
  [--graph]
```

| Flag | Required | Description |
|------|----------|-------------|
| `--root` | No | Path to a generated application to validate. Without it, validates the catalog only. |
| `--graph` | No | Print a Mermaid dependency graph of the module catalog. |

### Checks performed

- Validates `template.json` structure.
- Validates every module manifest against the schema.
- Checks that all referenced files exist.
- Validates file ownership consistency.
- Checks dependency and conflict rules for installed modules.
- Verifies that generated `apps/web/src/modules.ts` matches expected output.
