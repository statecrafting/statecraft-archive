# Add or remove a module

Modules can be composed into a generated application at create time (via `--with`) or after generation using the `add-module` and `remove-module` scripts.

## List available modules

```bash
npx tsx adapters/acme-vue-encore/scripts/add-module.ts --list
```

This prints the module catalog with names, versions, statuses, and descriptions.

## Add a module to an existing app

Navigate to the factory-encore repository and run:

```bash
npx tsx adapters/acme-vue-encore/scripts/add-module.ts \
  user-management \
  --root ../my-app
```

The composition engine:

1. Validates the module manifest and checks for conflicts.
2. Auto-installs dependencies (e.g., `api-gateway` requires `security-core`).
3. Copies service directories from the module's `files/` into the application.
4. Merges database migrations into `apps/api/db/migrations/`.
5. Binds secrets into `apps/api/lib/secrets.ts` and `infra.config.json`.
6. Merges CORS entries into `encore.app`.
7. Updates `template.json` to track the installed module set.
8. Regenerates `apps/web/src/modules.ts` for frontend navigation.
9. Merges environment variables into `.env.example`.
10. Runs `npm install` (unless `--no-install`).

## Preview changes with dry-run

```bash
npx tsx adapters/acme-vue-encore/scripts/add-module.ts \
  api-gateway \
  --root ../my-app \
  --dry-run
```

This shows exactly what files would be created, modified, or merged without making changes.

## Remove a module

```bash
npx tsx adapters/acme-vue-encore/scripts/remove-module.ts \
  user-management \
  --root ../my-app
```

The decomposition engine:

1. Checks reverse dependencies (refuses removal if other modules depend on it).
2. Refuses removal of always-on modules.
3. Deletes owned files and cleans empty directories.
4. Decomposes Encore services, migrations, secrets, and CORS using recorded `composedMigrations`.
5. Updates `template.json`.
6. Comments out (does not delete) environment variables.

If the installation lacks a `composedMigrations` record (legacy install), the engine emits a visible warning and skips migration deletion rather than silently omitting it.

## Handling conflicts

Modules declare `conflicts` in their manifest. When you add a module that conflicts with an already-installed module:

- The conflicting module is auto-removed before the new module is composed.
- A warning is printed showing what was removed.

## Dependency resolution

Modules declare `requires` (hard dependencies) and `requiresOneOf` (at least one must be present):

- Hard dependencies are auto-installed recursively.
- `requiresOneOf` is validated but not auto-resolved (you must install one manually).

## Validate module state

After adding or removing modules, validate the project's module state:

```bash
npx tsx adapters/acme-vue-encore/scripts/validate-modules.ts \
  --root ../my-app
```

This checks that `template.json` is consistent, all referenced files exist, and dependency/conflict rules are satisfied.
