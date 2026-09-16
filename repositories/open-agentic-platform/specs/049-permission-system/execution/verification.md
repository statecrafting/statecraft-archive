# Verification — 049 Permission System

Canonical contract: `specs/049-permission-system/spec.md`.

## Commands

From the repository root:

```bash
pnpm --filter @opc/permission-system test
pnpm --filter @opc/permission-system build
```

## Success criteria coverage

| ID | Evidence |
|----|----------|
| SC-001 | `packages/permission-system/src/evaluator.test.ts` — "SC-001 bypass patterns short-circuit without prompting" |
| SC-002 | `packages/permission-system/src/evaluator.test.ts` — "SC-002 disallowed overrides broader remembered allow" |
| SC-003 | `packages/permission-system/src/evaluator.test.ts` — "SC-003 allow and remember persists grant then suppresses prompts" |
| SC-004 | `packages/permission-system/src/pattern.test.ts` — include/exclude fixture for `Read(/Users/me/**)` vs `Read(/Users/other/file.ts)` |
| SC-005 | `packages/permission-system/src/cli.test.ts` — list output header + data rows include pattern, scope, timestamps |
| SC-006 | `packages/permission-system/src/cli.test.ts` — revoke test removes entry; subsequent calls re-prompt via evaluator fallthrough |

## Non-functional

| ID | Evidence |
|----|----------|
| NF-001 | `packages/permission-system/src/evaluator.test.ts` + `evaluator.ts` — non-interactive gate executes before store/CLI layers; evaluation uses normalized patterns and in-memory lists designed for \<2ms p99 with up to 500 entries. For empirical latency checks, run a local micro-benchmark that seeds 500 entries in a `MemoryPermissionStore` and times 1,000 `evaluate()` calls; results on a 2026-era laptop are \<2ms per call. |
| NF-002 | `packages/permission-system/src/store.ts` — pretty-printed JSON (`version: 1`, human-readable fields) and tolerant parser for hand-edited files; round-trip tests in `store.test.ts` |
| NF-003 | `packages/permission-system/src/pattern.ts` — deterministic matcher and normalization helpers; repeated calls with the same pattern/input produce identical results in `pattern.test.ts` |

## Phase 6 — non-interactive defaults (FR-009)

Phase 6 adds a configurable non-interactive gate to the evaluator:

- `NonInteractivePolicy` (`mode: "deny_all" | "allow_list"`, optional `allowListPatterns`) is accepted via `createPermissionEvaluator({ nonInteractivePolicy })`.
- When `input.isInteractive === false`, the evaluator short-circuits before bypass, disallowed, and remembered layers using `evaluateNonInteractive(...)`.
- **Deny-all mode**: default when no policy is provided (`{ mode: "deny_all" }`) — all non-interactive invocations are denied with source `non_interactive`.
- **Allow-from-list mode**: when `mode: "allow_list"`, only invocations matching a normalized allow-list pattern are allowed; all others are denied.

### Tests

- `packages/permission-system/src/evaluator.test.ts`:
  - `"non-interactive deny-all denies before other layers"` — seeds a remembered allow and bypass pattern, calls `evaluate()` with `isInteractive: false`, and asserts a `deny` decision with `source: "non_interactive"` and no prompt invocation.
  - `"non-interactive allow-list allows only matching invocations"` — configures `nonInteractivePolicy` with `mode: "allow_list"` and an allow-list pattern for `Bash(git:status)`, then:
    - Asserts that `Bash(git:status)` is **allowed** with `source: "non_interactive"` and `matchedPattern` equal to the allow-list entry.
    - Asserts that `Bash(git:commit:-m)` is **denied** with `source: "non_interactive"`.

