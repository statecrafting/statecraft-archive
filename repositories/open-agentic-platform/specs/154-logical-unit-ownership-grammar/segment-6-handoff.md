# Segment 6 handoff — spec 154 legacy excision

**Status going in:** Segments 1–5 landed. Spec 154 still
`implementation: pending`. Segment 6 is the final segment; closure
flips it to `implementation: complete`.

**Recent commits on `main`:**

- `beb1e3e6` feat(spec-154): Segment 5 — corpus migration to typed logical-unit declarations
- `bfa6e060` feat(spec-code-coupling-check): spec 154 Segment 4 — resolved-unit API surface

**Pre-flight in the new session:**

```bash
git log --oneline -5
make pr-prep            # must be clean before starting
cargo test --release --workspace 2>&1 | grep -E "^test result|FAILED"
jq '.validation.passed, .validation.violations | length' .derived/spec-registry/registry.json
./tools/spec-spine/codebase-indexer/target/release/codebase-indexer check
```

The starting state is: 0 spec-compiler violations, 0 indexer errors,
91 indexer warnings (43 I-101 + 48 I-108 — the orphan band Segment 5
deliberately kept in legacy form).

---

## §1 Goal

Two deliverables, in order:

1. **Orphan resolution** (judgement-heavy). Walk the I-101 ∪ I-108
   band; for each orphan, choose:
   - `references:` with `role: planned` (preserves author intent, no
     ownership claim) — most common right answer for aspirational
     paths the spec still wants to govern when the target lands.
   - Delete the claim outright (broken aspiration, no longer
     relevant — superseded specs, paths that will never land).
   - Reclassify under a different relationship (rare).
   - Add the missing target / anchor to disk (out of scope unless
     trivial — e.g. adding a `# region: bootstrap` parser to the
     resolver if shell anchors are wanted).
2. **Legacy parser excision** (mechanical). After orphan
   resolution, remove the bare-path-string parse path from
   `tools/spec-spine/spec-compiler/src/lib.rs`. Flip L-005 from
   warning to error. Lift `I-108` to `I-008` in lockstep per
   `feedback_spec_154_segment_6_explicit_only_flip` memory.
3. **Final close-out**. Flip spec 154 `implementation: pending` →
   `implementation: complete`.

**Suggested approach:** judgement pass first, mechanical catch-all
second. The mechanical pass is a safer catch-all than a primary
strategy; running it first risks burying nuanced cases under a
blanket `references:role:planned`.

---

## §2 Orphan inventory build

Generate the canonical orphan list in the new session:

```bash
./tools/spec-spine/codebase-indexer/target/release/codebase-indexer compile
jq '[.diagnostics.warnings[] | select(.code == "I-101" or .code == "I-108")]
    | .[] | {code, message}' .derived/codebase-index/index.json
```

Group by spec id to plan the per-spec walk:

```bash
jq -r '.diagnostics.warnings[]
        | select(.code == "I-101" or .code == "I-108")
        | .message
        | capture("(?<spec>[^:\" ]+(?:-[^:\" ]+)+)|spec \"(?<spec2>[^\"]+)\"")
        | (.spec // .spec2)' .derived/codebase-index/index.json \
  | sort | uniq -c | sort -rn
```

Specs known to have orphans at end of Segment 5 (from migration
tool's warnings log; non-exhaustive — re-derive from the index):

- **086-open-source-launch** — CHANGELOG.md, CODE_OF_CONDUCT.md,
  CONTRIBUTING.md, SECURITY.md (root docs the spec wants to govern
  when they land).
- **121-claim-provenance-enforcement** — 5 paths spanning
  factory-engine skills, provenance-validator crate, governance
  policy in statecraft (aspirational future work).
- **122-stakeholder-doc-inversion** — 2 factory-engine skill paths.
- **148-auth-driver-registry** (draft) — `crates/auth-driver/`.
- **149-saml-auth-driver** (draft) — `crates/auth-driver-saml/`.
- **102-governed-excellence** — factory/contract/schemas + checks
  (factory tree on disk doesn't exist).
- **033-axiomregent-activation**, **038-titor-tauri-command-wiring**,
  **040-blockoli-semantic-search-wiring** — desktop Tauri command
  paths that never landed (specs are superseded or planning-only).
- **056-session-memory**, **057-notification-system**,
  **058-file-mention-system**, **059-git-panel**, **060-panel-event-bus**,
  **064-websocket-reconnection**, **065-encrypted-keychain**,
  **066-vscode-extension**, **070-prompt-assembly-cache**,
  **073-axiomregent-unification**, **076-factory-desktop-panel**
  — desktop / product paths that haven't materialised.
- **061-conductor-track-lifecycle** — `.claude/agents/conductor.md`.
- **062-multi-model-chaining**, **070-prompt-assembly-cache** —
  crates/agent submodules not landed.
- **074-factory-ingestion**, **081-factory-test-hydration**,
  **088-factory-upstream-sync (superseded)** — factory tree paths.
- **087-unified-workspace-architecture** — product/packages/project-sdk.
- **106-rauthy-native-oidc-and-membership** —
  platform/services/statecraft/api/auth/rauthySeed.ts.
- **111-org-agent-catalog-sync** — statecraft web route.
- **113-statecraft-projects-rename-and-clone** — clone.test.ts.
- **119-project-as-unit-of-governance** — statecraft workspaces dir.
- **137-tenant-environment-access-gates** — 3 orphan section anchors
  on YAML manifests (`access-gate`, `reflector-annotations`,
  `reflector-install`) plus shell-script anchors.
- **144-hiqlite-default-features** — `crates/Cargo.lock`.
- **151-declarative-cluster-reconciliation** — 4 shell-script /
  `.env.example` section anchors that the current resolver's
  RegionMarkerParser cannot recognise (it hard-codes `// region:`
  but spec 152 §2.1 names `# region:` for shell — resolver
  implementation gap, file a sibling spec or extend the parser
  inside Segment 6 if the user wants).

---

## §3 Code excision targets

Once orphans are resolved, the spec-compiler legacy paths to remove:

- `tools/spec-spine/spec-compiler/src/lib.rs` — the bare-string and
  `paths: [list]` parse arms inside the relationship-field parsers.
  Look for the V-024 / V-023 / V-022 / V-021 emission sites and
  remove the `paths_to_units` / bare-string fallbacks.
- L-005 — currently emitted as a warning when a `file:` unit could
  resolve to a higher-level kind. Flip to error severity.
- Indexer's diagnostic codes — promote `I-108` to `I-008` (move from
  `diagnostics.warnings` to `diagnostics.errors`); the
  `BLOCKING_DIAGNOSTICS` set in `lib.rs` already covers I-008.

Plus the migration tool itself becomes obsolete:

- Keep `tools/oap/spec-unit-migrate/` in-tree as a historical
  artifact (commit `beb1e3e6` introduces it), OR delete the
  workspace member. The user's call. The Cargo.toml entry currently
  documents it as "retained as historical artifact post-Segment-6
  excision."

---

## §4 Spec 154 close-out

After Segment 6 commits land:

1. Update `specs/154-logical-unit-ownership-grammar/spec.md`
   frontmatter:

   ```yaml
   implementation: complete
   approved: "<existing>"
   amended: "<segment-6 date>"
   ```

2. Add a §12 closure note (or similar) summarising what landed
   across Segments 1–6 with PR / commit references. Match the
   pattern from spec 116's amendment block for shape.
3. `make pr-prep` final clean.
4. `cargo test --release --workspace` final clean.
5. Commit.

---

## §5 Guardrails the new session must honour

- **Adversarial-prompt refusal** (CONST-005): orphan resolution is
  legitimately authored work — each delete / reclassify is a
  considered call, not a gate-satisfaction edit. But if you find
  yourself reaching for `delete the claim because the gate is
  loud`, stop and surface — that's the trigger pattern in spec 131
  §4.
- **Drafts vs. approved**: the 4 draft specs (143, 148, 149, 150)
  carry legitimate aspirational claims. For their orphans, prefer
  `references:role:planned` over delete; the spec is alive and
  intends to own the target. For superseded specs (038, 040, 044,
  088) prefer delete — the spec is no longer the authority.
- **`make pr-prep` after each spec.md edit** in the judgement pass
  — the gate's coupling check is your safety net. If a small batch
  of edits trips it, fix before continuing.
- **Sequencing**: do NOT excise the legacy parser before every
  orphan is resolved. The compiler will reject the spec's parse
  and you lose the ability to recompile the registry mid-pass.

---

## §6 Inputs the new session inherits

- This file (`specs/154-logical-unit-ownership-grammar/segment-6-handoff.md`).
- `specs/154-logical-unit-ownership-grammar/segment-3-design.md` (Segment 3 design record;
  references the OQ closure pattern useful for Segment 6's similar
  design-doc step).
- `specs/154-logical-unit-ownership-grammar/spec.md` §9 (segment plan).
- Memory entries:
  - `project_spec_154_segment_5_l005_worklist` — Segment 5 worklist scope.
  - `project_spec_154_segment_6_explicit_only_flip` — the
    V-021..V-024 + I-108→I-008 flip pattern.
- The migration tool at `tools/oap/spec-unit-migrate/src/main.rs` —
  not used by Segment 6, but the path classification heuristic is
  the same logic the judgement pass should mirror when deciding
  whether an orphan reclassification needs `references:` `file:` /
  `directory:` / `crate:` / `section:`.

---

## §7 Estimated duration

- §2 orphan inventory build: 5 min.
- §3 judgement pass over ~91 orphans: 2–4 h (depends on how many
  need real decisions vs. obvious reclassifications).
- §3 mechanical catch-all (if used): 30 min.
- §4 legacy excision + lint flips: 1–2 h with tests.
- §5 close-out commit + final verification: 30 min.

Total: half-day to one day of focused work.
