# Verification — 048 Hookify Rule Engine

Canonical contract: `specs/048-hookify-rule-engine/spec.md`.

## Commands

From the repository root:

```bash
pnpm --filter @opc/hookify-rule-engine test
pnpm --filter @opc/hookify-rule-engine build
```

## Success criteria coverage

| ID | Evidence |
|----|----------|
| SC-001 | `packages/hookify-rule-engine/src/actions.test.ts` (force-push block); `starter-rules.test.ts` uses packaged `rules/block-force-push.md` |
| SC-002 | `actions.test.ts` warn path |
| SC-003 | `actions.test.ts` modify / `append_arg` |
| SC-004 | `loader.test.ts` hot-reload / snapshot |
| SC-005 | Parser skip diagnostics (`parser.test.ts`, loader integration) |
| SC-006 | `hooks-json.test.ts` — manifest lists `PreToolUse`, `PostToolUse`, `UserPromptSubmit`, `Stop` with `hookify-rule-engine evaluate --event <Event>` commands; `cli.test.ts` exercises `generate-manifest` |

## Non-functional

| ID | Evidence |
|----|----------|
| NF-001 | `packages/hookify-rule-engine/src/nf001.test.ts` — 100 in-memory rules, 1000 timed evaluations, p99 latency &lt; 10ms |

## Phase 6 deliverables

- **`hooks-json.ts`**: `buildHooksManifest`, `stringifyHooksManifest`, `writeHooksManifest` (optional `--check` for drift detection).
- **CLI** (`hookify-rule-engine`): `evaluate --event <HookEventType> [--rules-dir <path>]` (stdin JSON payload); `generate-manifest [--output <path>] [--check] [--command-prefix <prefix>]`.
- **Starter rules**: `packages/hookify-rule-engine/rules/` (`block-force-push.md`, `block-credential-read.md`, `warn-large-write.md`).
- **Default rules directory** remains `.claude/hooks/rules/` (copy starter rules there or point `--rules-dir` at the package `rules/` folder for evaluation).

## hooks.json location

Generated manifest defaults to `hooks.json` in the current working directory when using `generate-manifest` without `--output`. Projects may commit `.claude/hooks.json` or root `hooks.json` per integration preference.
