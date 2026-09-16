# Contributing

Thanks for your interest in improving this template. This is a spec-governed
repository: every substantive change begins as a markdown spec, compiles into a
deterministic registry, and is mechanically reconciled against the code that
implements it. Read this before opening a pull request.

## Ground rules

1. **Specs are the source of truth.** Features and architectural changes start
   as a spec under `specs/NNN-slug/spec.md` with YAML frontmatter. See
   `standards/spec/constitution.md` (durable principles) and
   `standards/spec/contract.md` (the short normative summary).
2. **Owned code moves with its spec.** A changed path that an owning spec
   declares must be accompanied by an authoring edit to that spec, or a
   visible `Spec-Drift-Waiver:` line in the PR body. The coupling gate
   (`npx spec-spine couple`) enforces this at PR time.
3. **Never edit a spec just to satisfy a mechanical refresh.** If code and its
   owning spec disagree, surface the contradiction instead of rewriting the
   spec to match the code (see `.claude/rules/adversarial-prompt-refusal.md`).
4. **Read derived artifacts through the CLI.** Compiled output under
   `.derived/**` is read via `npx spec-spine registry ...` and
   `npx spec-spine index check`, never by ad-hoc `jq`/`python`/`sed`.

## Local workflow

```bash
make setup        # npm install, compile the registry, build the index
make spine        # all governance verbs: compile, lint, index check, couple
make pr-prep      # pre-commit gate: refresh index + coupling check
make ci           # full local CI: spine + lint + typecheck + tests + pins
```

Application commands (npm workspaces) live in `README.md` and `CODEMAP.md`.

## Pull requests

1. Branch from `main`.
2. Make your change, including any owning-spec edit.
3. Run `make ci` and ensure it is green.
4. Fill out `.github/pull_request_template.md`. Include a `Spec-Drift-Waiver:`
   line only when a genuine, justified decoupling is required.
5. CODEOWNERS routes review automatically.

## Style

- TypeScript (strict) for application, library, and test code.
- Vue 3 with `<script setup>` single-file components.
- Conventional commit messages (`feat:`, `fix:`, `docs:`, `chore:`, ...).
- No em dashes in prose or code (a repo and house-style convention).

## Code of conduct

Participation is governed by [CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md).
