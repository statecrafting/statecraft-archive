# Cross-repo lockstep

The generator clones an external baseline (`template-encore`) and must not silently drift from the app invariants frozen there. The lockstep mechanism (spec 006) pins the baseline ref and validates it in CI.

## The lockfile

The committed lockfile lives at:

```
adapters/acme-vue-encore/scripts/lockstep/baseline.lock.json
```

It records:

| Field | Purpose |
|-------|---------|
| `templateRef` | The pinned `template-encore` git ref (commit SHA or tag). |
| `coreServices` | The set of Encore services the baseline declares. |
| `moduleCatalog` | The module names the generator knows about. |
| `specHashes` | SHA-256 of the frozen app-invariant specs in `template-encore`. |

## How the gate works

The lockstep checker (`scripts/lockstep/check.ts`) performs:

1. **Ref resolution**: confirms the pinned ref exists in the `template-encore` remote.
2. **Service diff**: compares the baseline's declared services against `coreServices` in the lockfile.
3. **Module membership**: confirms the module catalog matches.
4. **Spec hash verification**: recomputes SHA-256 of the frozen app-invariant specs and compares against `specHashes`.

Any mismatch fails the gate with a visible diff showing what changed.

## Running locally

```bash
npm run lockstep
```

This invokes the lockstep checker. It requires a `template-encore` checkout at the path specified by `TEMPLATE_ENCORE_SOURCE` or as a sibling directory.

## CI integration

The lockstep gate runs as a reusable workflow (`ci-lockstep.yml`) dispatched unconditionally from `ci.yml`. It is a constitutional gate (always-on, never path-filtered) because upstream drift can break the generator regardless of which files changed in the current PR.

## Updating the lockfile

When `template-encore` legitimately changes (new services, updated specs), the lockfile must be updated:

```bash
npm run lockstep:update
```

This regenerates `baseline.lock.json` from the current `template-encore` checkout. The updated lockfile is committed as part of the PR that adapts the generator to the upstream change.

## Why fail-visible

The lockstep gate is designed to be fail-visible rather than fail-silent. A green CI run means the generator is confirmed compatible with the pinned baseline. A failure means upstream drift has occurred and the generator must be updated before it can safely produce applications.
