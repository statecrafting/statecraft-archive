---
name: code-quality
description: Human-readable translation of eslint.config.mjs and tsconfig strict rules into generation-time constraints for Vue + Encore code. Read before writing any feature code.
---

# Skill: Code Quality (Lint & TypeScript)

> **When to load**: before writing any feature code (API or UI). This skill is a mandatory pre-read: not a post-hoc validation reference.
>
> **Also read the live config**: Open `eslint.config.mjs` (project root) alongside this skill. This document is a curated summary of the rules that most frequently break AI-generated code; the live config is the authoritative source of truth. If a rule exists in the config but is not listed here, the config wins.

The project enforces `npm run lint -- --max-warnings 0` (zero warnings, zero errors) and `strict: true` TypeScript. Generating code that violates these rules costs more time to fix than writing it correctly the first time.

---

## 1. ESLint Rules That Trip Up AI-Generated Code

The project uses ESLint 9 flat config (`eslint.config.mjs`) with `typescript-eslint` recommended + type-checked rules.

**Hard errors (must fix before code compiles/lints):**

| Rule | What it catches | Correct pattern |
|------|----------------|-----------------|
| `no-floating-promises` | Async call without `await` or `.catch()` | Always `await` async functions. If fire-and-forget is intentional, use `void asyncFn()` |
| `no-explicit-any` | `any` type in source files | Use the real type, a generic, `unknown`, or a type assertion. `any` is only allowed in test files |
| `no-unused-vars` | Unused imports, variables, or function params | Remove dead imports. Prefix intentionally unused params with `_` (e.g., `_unused: string`) |
| `await-thenable` | `await` on a non-Promise value | Only `await` actual Promises. Check return types before adding `await` |
| `no-useless-escape` | Escaping a character that has no special meaning in context: most commonly `\[` inside a regex character class `[...]` | Inside `[...]`, only `]`, `\`, `^` (at start), and `-` (between chars) are special. Write `/[[\]]/` not `/[\[\]]/` |
| `no-irregular-whitespace` | A literal invisible Unicode character (U+FEFF BOM, U+200B zero-width space, etc.) embedded directly in regex source, template literals, or comments | Use `\uXXXX` escape sequences. Literal invisible bytes are silently stripped by editors on save: the fix disappears with no visible diff |
| `no-misleading-character-class` | A regex character class `[...]` containing an invisible, zero-width, or multi-code-unit character written as a literal byte | Same fix: use `\uXXXX` inside character classes. `/[﻿]/` is correct; a literal BOM byte inside `[...]` is both misleading and editor-fragile |
| `no-console` | `console.log()` in source files | Use `logger` from `encore.dev/log` in Encore services, or the project logger in SPA code. `console.log` is only allowed in `apps/api/scripts/` and test files |
| `no-empty-object-type` | `interface Foo extends Bar {}` with no new members | Use `type Foo = Bar` (type alias) when extending without adding fields. Only use `interface extends` when the derived type introduces new properties |
| `no-unsafe-assignment` / `no-unsafe-member-access` / `no-unsafe-argument` | Propagating `any` through assignments, property access, or function args | Cast to `unknown` at the boundary and narrow explicitly before use (see Section 3) |
| `no-base-to-string` | `String(x)` or `${x}` where `x: unknown`: runtime may produce `[object Object]` | Use `safeToString(x)` or narrow by type before converting. Never call `String()` on `unknown` directly |
| `require-await` | `async function` whose body never uses `await` | Remove `async` keyword and change return type from `Promise<T>` to `T` |
| `only-throw-error` | `throw { code, message }` or `throw "string"`: only `Error` instances (or subclasses) may be thrown | In Encore services, use `throw APIError.notFound(...)` / `throw APIError.invalidArgument(...)` (these are proper Error subclasses). In SPA code, use `throw new Error(...)`. Plain object literals and strings are not `Error` instances and lose stack traces |

**Warnings (still block the build because of `--max-warnings 0`):**

| Rule | What it catches | Correct pattern |
|------|----------------|-----------------|
| `no-non-null-assertion` | Using `!` to assert non-null (e.g., `user!.id`) | Use optional chaining (`user?.id`), nullish coalescing (`user?.id ?? 'anonymous'`), or a guard (`if (!user) throw ...`). Exception: `getAuthData()!` inside `auth: true` Encore endpoints: the `!` is correct there because the authHandler guarantees a value |

**Relaxed in test files** (`*.test.ts`, `*.spec.ts`, `__tests__/`): `no-explicit-any`, `no-non-null-assertion`, `no-unused-vars`, and all type-checked rules are OFF. Test files can use `any` and `!` freely.

> **Base JS rules are NOT relaxed in test files**: this includes `no-useless-escape`, `no-irregular-whitespace`, and `no-misleading-character-class`. They all come from `js.configs.recommended`, which the test-file TypeScript override does not touch. These rules fire in `*.test.ts` exactly as in source files.

---

## 2. TypeScript Strict Mode Rules

`tsconfig.base.json` sets `strict: true` plus additional strictness flags. These cause compile errors (not just lint warnings):

| Flag | What it catches | Correct pattern |
|------|----------------|-----------------|
| `noUnusedLocals` | Declared variable never read | Remove unused `const`/`let` declarations, or prefix with `_` |
| `noUnusedParameters` | Function param never read | Remove the param or prefix with `_` |
| `noUncheckedIndexedAccess` | `array[0].field` without null check | Use `array[0]?.field` or guard: `const item = array[0]; if (!item) return` |
| `strictNullChecks` | Accessing `.property` on possibly-undefined value | Add `if (!value)` guard, use `?.` optional chaining, or `?? defaultValue` |
| `noFallthroughCasesInSwitch` | Switch case without `break`/`return` | Every case must end with `break`, `return`, or `throw` |
| `noImplicitOverride` | Overriding a base class method without `override` keyword | Add `override` keyword to overridden methods |
| `isolatedModules` / TS1361 | `import type { Foo }` used as a value (e.g., `instanceof Foo`, `throw new Foo()`) | Use a **value import** (`import { Foo }`) for anything that is a class. Only use `import type` for pure interfaces/type aliases that have no runtime representation |

---

## 3. Common AI Anti-Patterns (Do / Don't)

**Promise handling:**
```typescript
// DON'T: floating promise (lint error)
db.query`SELECT 1`
someAsyncFunction()

// DO: await it
await db.query`SELECT 1`
await someAsyncFunction()

// DO: if fire-and-forget is intentional, use void
void backgroundAudit()
```

**Unused parameters:**
```typescript
// DON'T: unused param triggers both lint and TS errors
export default new Service('example', {
  middlewares: [(_ctx, next) => {  // '_ctx' is unused if you don't use it
    next()
  }],
})

// DO: prefix unused params with _
export default new Service('example', {
  middlewares: [(_ctx: MiddlewareRequest, next: Next) => {
    next()
  }],
})
```

**Array/object access:**
```typescript
// DON'T: noUncheckedIndexedAccess error
const first = result.rows[0]
return first.id  // 'first' is possibly undefined

// DO: guard the access
const first = result.rows[0]
if (!first) return null
return first.id

// DO: or use optional chaining for simple cases
return result.rows[0]?.id ?? null
```

**Logging (Encore services):**
```typescript
// DON'T: no-console warning (blocks build)
console.log('User created:', userId)

// DO: use Encore's structured logger
import log from 'encore.dev/log'
log.info('user created', { userId })
```

**Empty interface extends (DTO derivation):**
```typescript
// DON'T: no-empty-object-type error
interface ConfigurationVersionEntryDto extends ConfigurationValueDto {}

// DO: type alias when no new fields are added
type ConfigurationVersionEntryDto = ConfigurationValueDto

// DO: interface extends is correct when adding fields
interface ConfigurationVersionEntryDto extends ConfigurationValueDto {
  version: number
  updatedAt: string
}
```

**Throwing errors in Encore services:**
```typescript
// DON'T: plain object literal is not an Error instance (fails lint, no stack trace)
throw { code: 'NOT_FOUND', message: 'User not found' }
throw 'Something went wrong'

// DO: use Encore's APIError (these are proper Error subclasses)
import { APIError } from 'encore.dev/api'

throw APIError.notFound('User not found')
throw APIError.invalidArgument('Invalid role ID')
throw APIError.permissionDenied('Insufficient role')
throw APIError.internal('Unexpected database error')

// DO: catch with instanceof (works because APIError is a real class)
if (err instanceof APIError) {
  // err.code, err.message are available
}
```

**getAuthData()! inside auth: true endpoints:**
```typescript
// CORRECT: the ! non-null assertion is intentional and correct here
// The Encore authHandler guarantees AuthData is populated for auth: true endpoints
export const listUsers = api(
  { expose: true, auth: true, method: 'GET', path: '/api/v1/users' },
  async (): Promise<ListResponse> => {
    const auth = getAuthData()!   // <- ! is correct; not a lint violation here
    requireRole(auth.roles, 'admin')
    // ...
  },
)
```

**Type assertions instead of `any`:**
```typescript
// DON'T: no-explicit-any error
const data = JSON.parse(body) as any

// DO: define the shape or use unknown
const data: unknown = JSON.parse(body)
const parsed = someSchema.parse(data)  // validate with Zod
```

**Regex character classes (`no-useless-escape`): active in test files too:**
```typescript
// DON'T: no-useless-escape error: \[ has no special meaning inside [...]
const bracketChars = /[\[\]]/   // intended: match [ or ]
//                     ^^ ESLint error: \[ is a useless escape inside a character class

// DO: [ is already literal inside [...]; only \] is needed to prevent early class close
const bracketChars = /[[\]]/    // matches [ or ]

// Common SQL Server bracket-quoted identifier pattern: note: \[ and \] are OUTSIDE [...] here (correct)
const sqlColumn = /\[[\w\s]+\]/  // matches [column_name]: no lint error
//                ^         ^
//                These escapes are outside the character class, so they ARE meaningful
```

**Invisible Unicode in regex (`no-irregular-whitespace`, `no-misleading-character-class`): active in test files too:**
```typescript
// DON'T: literal U+FEFF BOM byte embedded directly in source
// The character is invisible: editors with "trim Unicode on save" silently delete it,
// turning /^<BOM>/ into /^/: matches everything, fix is lost, no visible diff in git
const stripped = csv.replace(/^<invisible>/, '')      // no-irregular-whitespace fires
const noBom    = text.replace(/[<invisible>]/, '')    // no-misleading-character-class fires too

// DO: use the \uXXXX escape sequence: always visible, never stripped by editors
const stripped = csv.replace(/^﻿/, '')           // BOM strip: correct
const noBom    = text.replace(/[﻿￾]/, '')   // character class form: also correct
```

> **Rule of thumb**: any regex that matches an invisible or control character must use `\uXXXX`.
> Never embed the literal byte: it is invisible in code review and fragile under editor save.

---

## 4. Incremental Lint Checks

Do not wait until the final validation pass to discover lint errors. Run lint checks incrementally during feature development:

```bash
# After completing each feature's Encore service code:
npx eslint apps/api/<service-name>/ --max-warnings 0

# After completing each feature's UI code:
npx eslint apps/web/src/views/{Feature}View.vue apps/web/src/stores/{feature}.store.ts --max-warnings 0

# Full lint check at phase boundaries:
npm run lint
```

Fix lint errors immediately: do not accumulate them for a batch fix at the end.
