# Contributing

Contributing to the Open Agentic Platform requires adherence to strict governance rules. This is not a standard open-source project; it is a governed operating system where process is enforced by CI gates.

## Spec-First Development

The most important rule is **Spec-First Development**. You cannot merge code without an approved specification that claims authority over that code.

If you are proposing a new feature or architectural change:
1. Author a new Markdown spec in `specs/NNN-slug/spec.md`.
2. Open a pull request containing only the spec.
3. Once the spec is approved and merged, open subsequent pull requests with the code implementation.

The Spec/Code Coupling Gate will enforce that your code changes align with the spec's `establishes`, `extends`, or `co_authority` edges.

## Local Validation

Before opening a pull request, you must run the local validation loop.

For rapid iteration, use the fast CI target:
```bash
make ci
```

Before merging, or if you suspect parity drift, run the strict mirror:
```bash
make ci-strict
```

## Commit Hygiene

OAP enforces strict commit hygiene:
- Use **conventional commits** (e.g., `feat(spec-NNN):`, `fix(spec-NNN):`, `docs(spec-NNN):`).
- Reference the spec ID in commits that modify code under a spec's claimed paths.
- Never bypass Git hooks (`--no-verify`). If a hook fails, fix the underlying issue.
- Never commit `.env` files, credentials, or private keys. The secrets scanner (CONST-002) will block the commit.

## PR-Time Gotchas: The Coupling Gate

A common pitfall involves the `make pr-prep` target and the Coupling Gate.

`make pr-prep` runs the coupling check against `origin/main` using the *current worktree state*. If you split a PR into multiple commits and run `make pr-prep` between them, the check validates the partial diff, not the branch-level diff that CI will see.

**Always re-run `make pr-prep` after the final commit of a multi-commit PR.** If you fail to do this, CI may fail the coupling check because the code paths modified in later commits were not validated against the spec.
