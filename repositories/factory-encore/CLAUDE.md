# factory-encore

`factory-encore` is an original, independent implementation of the Open Agentic
Platform (OAP) factory standard: a three-layer, technology-agnostic software
factory. Its `process/` and documentation are authored here; its `contract/`
mirrors the OAP open standard. Released under Apache-2.0. See `README.md` for the
architecture and `docs/oap-integration.md` for how the layers map onto OAP.

## What this repository is

- **`process/`** transforms business documents into a structured Build
  Specification through ordered pipeline stages. It never references any
  framework or language.
- **`contract/`** holds the formal interface schemas between process and
  implementation: Build Specification, Adapter Manifest, Verification Contract,
  Pipeline State, and Governance Envelope.
- **`adapters/`** is where pluggable, stack-specific implementations live. One
  adapter ships: `acme-vue-encore` (Encore.ts + Vue 3 / PrimeVue / rauthy). It
  is also the create-time home of that product: it carries the deterministic
  generator (`scripts/`), the module catalog (`modules/`), and the create-time
  orchestration (`orchestration/`). The generator clones the `template-encore`
  lean baseline via `--source` and composes modules in. See `adapters/README.md`.
- **`specs/` + `standards/` + `spec-spine.toml` + `package.json`** are the
  governance kernel this repository earned by carrying the generator's code: the
  spec corpus that governs the generator/module system, governed by spec-spine.

## Working rules

- **The contract is an open standard.** Only organization-agnostic and
  stack-agnostic concepts belong in `contract/`. The canonical home of the
  schemas is the OAP repository; this repository mirrors them. Do not fork or
  edit the schemas casually; mirror the canonical version. Anything
  organization- or stack-specific belongs in an adapter, never in the contract.
- **Keep the layers clean.** No framework or language names in `process/` or
  `contract/`. All technology specifics stay inside `adapters/<name>/`.
- **The generator stays pure code.** The deterministic generator under
  `adapters/acme-vue-encore/scripts/` carries zero agent/factory references; keep
  the mechanism intact. Create-time concepts live in `orchestration/` and the
  generator meta-specs, not woven into the generator.
- **Governed code, governed corpus.** Because the generator lives here, the
  repository now carries a spec-spine kernel and a CI surface. Every spec-claimed
  code path changes together with its owning spec.md (the coupling gate);
  `spec-spine compile` / `lint --fail-on-warn` / `index check` must stay green.
  The generator/baseline lockstep (spec 006) is active: `baseline.lock.json` pins
  the `template-encore` ref, its core services, the module catalog, and the
  `encore-app-architecture` / `security-data-invariants` app-invariant spec.md
  hashes, so upstream drift fails `npm run lockstep`
  and the `ci-lockstep` job.

## Build & verify

- `npm test` runs the generator/module/lockstep vitest suite; `npm run typecheck`
  runs `tsc --noEmit`.
- `npm run lockstep` checks the generator against the pinned `template-encore`
  baseline (spec 006).
- `npm run e2e:struct` runs the structural generator e2e (Node-only, the cheap
  PR lane); `npm run e2e:build` runs the full build matrix (needs the Encore CLI
  + Docker; the nightly lane). Both drive the generator against a
  `template-encore` checkout (spec 007). Set `TEMPLATE_ENCORE` if it is not a
  sibling checkout.
- `npm run spec:compile` / `spec:lint` / `spec:check` (or `npm run spec:all`)
  keep the spec-spine corpus green; the coupling gate is `spec-spine couple`.

## Claude Code surface

- **`AGENTS.md`** is the cross-agent session-init protocol authority (read by
  Claude Code, Codex CLI, Cursor, and Copilot via the AAIF/Linux Foundation
  AGENTS.md standard). The `## New Sessions` section is the single source for
  the init protocol; `.claude/skills/init/SKILL.md` is a thin dispatcher that
  reads it. Add an init step there and the next `/init` picks it up.
- **`.claude/rules/`** holds the three rules every orchestrated workflow loads
  automatically: `orchestrator-rules.md`, `governed-artifact-reads.md`, and
  `adversarial-prompt-refusal.md`.
- **`.claude/agents/`** holds the four pipeline agents (architect, explorer,
  implementer, reviewer); **`.claude/skills/`** holds the slash commands (one
  `SKILL.md` per folder).
- `.claude/**`, `AGENTS.md`, and `CLAUDE.md` are not hashed by the codebase
  index here (`spec-spine.toml` hashes only `standards/**` and
  `.github/workflows/**` beyond the always-hashed core), so editing them does
  not trip the staleness gate.

## House style

- **No em dashes (U+2014).** Use a colon, semicolon, comma, parentheses, or two
  sentences. En dashes are acceptable only for numeric or section ranges.
- **LF line endings.** All text files use LF (`.gitattributes` enforces this).
  Do not let an editor rewrite them to CRLF.
