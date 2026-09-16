---
id: "122-stakeholder-doc-inversion"
slug: stakeholder-doc-inversion
title: Stakeholder-Doc Inversion and Stage CD Comparator
status: approved
implementation: complete
amended: "2026-05-01"
owner: bart
created: "2026-04-30"
kind: governance
domain: platform
risk: critical
summary: >
  Reclassify `requirements/client/project_charter.md` and
  `requirements/client/client-document.md` from Stage CD outputs to
  authored stakeholder inputs. Define a section-anchor and citation
  grammar (`OBJ-N`, `STAKEHOLDER-N`, `OUTCOME-N`, `IN-SCOPE-N`,
  `OUT-SCOPE-N`, `OWNER-N`) for those documents so the Factory can
  cite them and detect drift section-by-section. Invert Stage CD from
  generator to comparator: the stage takes the BRD as input,
  regenerates a `*.candidate.md` view of each stakeholder doc, and
  diffs it against the authored version. Diffs are classified
  (`wording | structural | scope | external-entity | ownership`); the
  comparator gate blocks on `scope`, `external-entity`, and
  `ownership` diffs. Authored citations inside stakeholder docs run
  through spec 121's validator on the same `FAC-S1-011 / QG-13`
  invariant. A `seed-once` bootstrap path produces initial templates
  for projects without authored docs; a one-shot reclassification
  migration moves existing projects' Stage CD outputs into
  the authored channel with provenance trail.
depends_on:
  - "075-factory-workflow-engine"  # factory-workflow-engine (Stage CD lifecycle)
  - "087-unified-workspace-architecture"  # unified-workspace-architecture (workspace plane = authored truth)
  - "119-project-as-unit-of-governance"  # project-as-unit-of-governance (project = governance unit for the doc set)
  - "120-factory-extraction-stage"  # factory-extraction-stage (typed corpus to cite stakeholder docs against)
  - "121-claim-provenance-enforcement"  # claim-provenance-enforcement (validator + allowlist reused at Stage CD comparator)
establishes:
  - unit: { kind: file, path: crates/factory-engine/src/stages/stage_cd_comparator.rs }
  - unit: { kind: file, path: tools/oap/stakeholder-doc-lint/Cargo.toml }
  - unit: { kind: file, path: product/apps/opc/src/components/factory/StageCdReview.tsx }
references:
  - role: historical
    unit: { kind: file, path: crates/factory-engine/skills/client-document-comparator.md }
  - role: historical
    unit: { kind: file, path: crates/factory-engine/skills/project-charter-comparator.md }
extends:
  - spec: "075-factory-workflow-engine"
    nature: wrapping
    unit: { kind: file, path: crates/factory-engine/src/stages/stage_cd.rs }
  - spec: "121-claim-provenance-enforcement"
    nature: additive
    unit: { kind: file, path: crates/factory-contracts/src/stakeholder_docs.rs }
---

# 122 — Stakeholder-Doc Inversion and Stage CD Comparator

**Feature Branch:** `122-stakeholder-doc-inversion`
**Created:** 2026-04-30
**Status:** Draft
**Input:** "Charter and client-document are currently Stage CD outputs and they get overwritten on every run. The Globex forensic shows this is the contamination amplifier. Make them authored inputs and invert Stage CD into a comparator."

## 1. Problem

The Factory's Stage CD ("Client Document") today writes `requirements/client/project_charter.md` and `requirements/client/client-document.md` from the BRD as terminal client-facing artifacts. They sit under `requirements/client/` but they are **outputs** — the pipeline produces them; nothing consumes them.

The example project forensic (recorded in spec 121) demonstrates the failure mode:

- Stage 1 fabricated `STK-13 / Globex` with no corpus citation.
- Quality gates passed because they checked internal RTM closure, not external provenance (this is what spec 121 fixes).
- Stage CD then **regenerated** `project_charter.md` from the contaminated BRD. The source charter on disk had said "Payment processing (Finance systems) - Out of Scope"; the regenerated charter said "Globex integration is in scope". The regeneration was a silent overwrite. The audit trail back to authored stakeholder truth was severed in a single stage.
- Stages 4–5 then consumed the contaminated Stage CD output (where downstream skills look for "current" client-facing scope) as authoritative, locking the fabrication into DDL, services, UI, and tests.

Spec 121 catches the original fabrication at the Stage 1 gate. But it does not catch contamination introduced at Stage CD by an over-permissive regenerator that is allowed to invert scope, name new external systems, or reassign owners without review. As long as Stage CD is a generator, every regeneration is a re-interpretation that can drift in either direction — even a clean Stage 1 output can be rewritten by Stage CD into something the operator never authored.

There is also a structural problem: the documents stakeholders actually edit are not the BRD. Stakeholders edit the charter and the client-document. The BRD is a derivation suited for the Factory's machine consumption, not for human conversation. Today's pipeline puts the formal artifact upstream of the conversation artifact, which inverts the natural workflow:

```
client-document.md  →  project_charter.md  →  business_requirements_document.md  →  Stages 2–5
   (stakeholder         (sponsor-grade            (16-section ISO-29148, machine-shaped)
    framing)             objectives, scope)
```

Today the factory reads the BRD as primary input and **emits** the charter and client-document as outputs. The natural workflow has it reversed.

This spec inverts Stage CD: the stakeholder docs become **authored inputs** with a structured grammar, and Stage CD becomes a **comparator** that produces a candidate view from the BRD and diffs it against the authored version. Decision-grade diffs (scope flips, new external systems, owner changes) block the gate; wording-only diffs pass. The same validator from spec 121 runs over authored citations so a charter cannot itself fabricate.

## 2. Goals

- **Reclassification.** `project_charter.md` and `client-document.md` become first-class authored markdown under a stable path (`requirements/stakeholder/charter.md` and `requirements/stakeholder/client-document.md` — see Open Decisions). They carry frontmatter (`status`, `owner`, `version`, `supersedes?`, `citations[]`) and bounded structured sections with stable anchors (`OBJ-N`, `STAKEHOLDER-N`, `OUTCOME-N`, `IN-SCOPE-N`, `OUT-SCOPE-N`, `OWNER-N`).
- **Stage CD as comparator, not generator.** Stage CD's invariant flips. Inputs: the regenerated BRD plus the authored stakeholder docs on disk. Outputs: `charter.candidate.md` and `client-document.candidate.md` written to the artifact store, plus a typed `stage-cd-diff.json` recording the per-section diff classification. Stage CD MUST NOT overwrite authored docs.
- **Diff classification.** Each section diff is classified as `wording | structural | scope | external-entity | ownership | citation`. The classification rule is deterministic and based on (a) the diff's affected anchors, (b) the external-entity allowlist from spec 121, (c) the diff's text shape (added/removed sections vs reword vs reordering).
- **Comparator gate.** A new gate `QG-CD-01_StakeholderDocAlignment` runs at Stage CD's exit. Blocks on any `scope`, `external-entity`, `ownership`, or `citation` diff. Passes (with a warning record) on `wording` diffs. Blocks on `structural` diffs unless the operator explicitly approves.
- **Citation validation reuses spec 121.** Authored docs MAY cite extracted spans using the same `{source, lineRange, quote, quoteHash}` shape as `provenance.json`. The spec-121 validator runs over those citations; an authored charter that cites a quote not in the corpus fails the same `FAC-S1-011` rule the BRD does. The charter cannot fabricate either.
- **Anchor preservation.** Section anchors (`OBJ-1`, `STAKEHOLDER-3`, `IN-SCOPE-2`) are the comparator's pairing keys. Authored sections carry their anchors as inline markers. Candidate sections are paired by anchor where the BRD explicitly references one, and by best-fit `anchorHash` similarity (using spec 121's `anchor_hash` function) where they don't. A wording reword keeps the anchor; a new concept produces a new anchor.
- **`seed-once` bootstrap.** New projects with no authored stakeholder docs run Stage CD in `seed` mode for one run: it generates the documents from the BRD, the operator reviews and commits them as authored, and on subsequent runs the stage operates in `compare` mode. Operators may also author the docs from scratch and skip seed entirely.
- **Reclassification migration.** Existing projects whose Stage CD already produced output files run a one-shot migration that moves the files into the authored channel, computes initial anchors, runs the spec-121 validator on the initial state to surface fabrications, and writes a migration provenance record. After the migration, those files are authored.
- **No silent re-import.** Authored docs do NOT re-flow into the BRD on the next run. A change to the charter does not retroactively rewrite Stage 1 output. Operators who want a new BRD must re-run Stage 1; the cascade rule from spec 121 then applies. This stops the loop from being a one-way ratchet of changes from charter to code without operator volition.

## 3. Non-Goals

- **BRD claim provenance.** Spec 121 covers `STK-*`, `BR-*`, `INT-*`, etc. provenance at the Stage 1 gate. This spec extends the same invariant to authored docs but does not redefine it.
- **Typed extraction corpus.** Spec 120 is the carrier; this spec consumes it.
- **Re-extraction of raw documents.** Spec 120's `s-1-extract` boundary is unchanged.
- **Charter authoring tooling.** This spec defines the grammar and the comparator; it does not build a WYSIWYG editor for the charter. Operators edit markdown in their editor of choice. A future spec may add an authoring panel.
- **Multi-author concurrent editing.** V1 assumes one operator authors at a time. Conflicts surface at git-merge level, not in the comparator. A future spec may add doc-level locking.
- **Cross-project doc reuse.** Stakeholder docs are per-project. A portfolio that wants shared boilerplate is out of scope.
- **Versioned diffs.** The comparator emits one diff per Stage CD run. A history of diffs across runs lives in the artifact store but is not surfaced as a versioned timeline. (Future spec.)
- **Auto-merge of accepted candidate sections.** When the operator accepts a candidate, the change must be applied manually (or via an operator-confirmed apply action). The spec does not define an unattended apply.
- **Stakeholder-doc generation from extracted corpus alone.** Bootstrap goes from BRD to seed-once-doc, not from raw extracted text directly. The path "extracted → stakeholder doc" is the next boundary up — a follow-up spec may close it; this spec does not.

## 4. User Scenarios & Testing

### User Story 1 — Scope inversion is blocked at the comparator gate (Priority: P1)

A factory run on a project with an authored `charter.md` (which says `OUT-SCOPE-3: Payment processing (Finance systems)`) produces a Stage 1 BRD. The BRD's claims pass spec 121's gate. Stage CD runs. Its candidate-charter generator (the same logic that previously wrote the file directly) produces `charter.candidate.md` with `IN-SCOPE-7: Globex integration` (an inversion of the authored `OUT-SCOPE-3`). The comparator pairs the candidate's `IN-SCOPE-7` with the authored `OUT-SCOPE-3` by `anchorHash` similarity, classifies the diff as `scope`, and the comparator gate `QG-CD-01_StakeholderDocAlignment` returns FAIL. The pipeline halts at Stage CD. The desktop UI surfaces a side-by-side: authored "Payment processing - Out of Scope" vs candidate "Globex integration - In Scope" with the diff class label and a one-click "Open Stage 1 review" action.

**Why this priority:** This is the headline behaviour. Without it, even a spec-121-clean BRD can be rewritten by Stage CD into something the operator never authored. The Globex forensic showed exactly this happening at Stage CD, after Stage 1's gates reported PASS. P1 because the gate's failure mode here is silent contamination, the worst kind.

**Independent Test:** Seed a project with an authored `charter.md` declaring `OUT-SCOPE-3: Payment processing`. Inject a Stage 1 mock that produces a clean BRD with one drift: a candidate charter line claiming `IN-SCOPE-7: Globex integration`. Run Stage CD. Assert (a) the comparator pairs the two anchors, (b) the diff is classified `scope`, (c) `QG-CD-01` returns FAIL, (d) the pipeline does NOT advance to Stage 4, (e) the desktop UI surfaces the diff.

**Acceptance Scenarios:**

1. **Given** an authored stakeholder doc with anchor `OUT-SCOPE-3: Payment processing (Finance systems)` and `anchorHash = sha256("scope:payment-processing-finance-systems")`, **When** the candidate doc contains anchor `IN-SCOPE-7: Globex integration` whose `anchorHash` is sufficiently similar (Jaccard ≥ 0.6 over normalized tokens) to the authored `OUT-SCOPE-3`, **Then** the comparator pairs them and classifies the diff as `scope` (because the section heading kind changed from `OUT-SCOPE` to `IN-SCOPE`).
2. **Given** any `scope`-classified diff exists in `stage-cd-diff.json`, **When** `QG-CD-01_StakeholderDocAlignment` evaluates, **Then** it returns FAIL with a typed `qg_cd_01_scope_drift` error carrying the affected anchor pairs.
3. **Given** the gate is blocked, **When** the desktop UI renders the review surface, **Then** it shows (a) the authored section, (b) the candidate section, (c) the diff class, (d) a remediation prompt with three actions: `Reject candidate (preserve authored)`, `Accept candidate (apply to authored — requires confirmation)`, `Open Stage 1 review (likely the upstream cause)`.
4. **Given** the operator rejects the candidate, **When** the gate re-evaluates, **Then** the diff is dismissed for this run (recorded in `stage-cd-diff.json` with `resolution: rejected, actor, rejectedAt`); the gate passes; the pipeline advances; the authored doc is unchanged.
5. **Given** the operator accepts the candidate, **When** they confirm the apply, **Then** the authored doc is rewritten to incorporate the candidate section, the change is recorded in the doc's frontmatter `version` bump and `supersedes` chain, an `audit_log` row of `factory.stakeholder_doc_accepted_candidate` is emitted with `{ project, doc, anchor, fromHash, toHash, actor }`, and the gate passes.

---

### User Story 2 — Wording-only edit passes silently (Priority: P1)

The authored charter says `OBJ-2: Reduce form-correction cycles by 50% within 12 months of launch`. A factory rerun produces a candidate charter saying `OBJ-2: Cut the rate of forms returned for correction by half within one year of go-live`. The two anchors share the same `anchorHash` (concept-normalized: `cut form correction half year`). The comparator classifies the diff as `wording`. `QG-CD-01` passes. The drift is recorded but no operator action is required. The authored doc is not modified; the candidate is discarded after the gate passes.

**Why this priority:** Without `wording`-classification, every reword would block the gate and operators would suffer extreme fatigue. Most reword-class drift is meaningless and must pass without friction. P1 because the gate's usability is essential to its adoption.

**Independent Test:** Author a charter section. Re-run Stage CD with a Stage 1 mock that emits a reworded BRD (same concept, different surface form). Assert (a) `anchorHash` matches between authored and candidate, (b) diff classified as `wording`, (c) `QG-CD-01` passes, (d) authored doc unchanged on disk, (e) `stage-cd-diff.json` records the reword for forensic visibility.

**Acceptance Scenarios:**

1. **Given** an authored section and a candidate section whose anchor lines are different but whose `anchorHash` (per spec 121's `anchor_hash` function) is identical, **When** the comparator runs, **Then** it pairs the sections, computes a body diff, and classifies the diff as `wording` if no anchor-changing tokens (scope-kind, owner names, external entities) appear in the diff.
2. **Given** a `wording`-only diff, **When** `QG-CD-01` evaluates, **Then** it returns PASS with a warning record. The pipeline advances.
3. **Given** the gate passed, **When** the next run happens with the same authored doc, **Then** the comparator still detects the wording difference between authored and candidate but treats it the same way (no operator was prompted, no apply happened — the wording difference is stable across runs).
4. **Given** the operator wants the wording aligned, **When** they manually edit the authored doc to match the candidate wording, **Then** subsequent runs produce zero `wording` diffs for that section.

---

### User Story 3 — Bootstrap a fresh project in `seed-once` mode (Priority: P1)

A new project has just had its first Stage 1 run produce a clean BRD. There is no authored `charter.md` on disk. Stage CD detects the absence and runs in `seed` mode: it generates `charter.candidate.md` and `client-document.candidate.md` from the BRD, with anchors pre-populated (`OBJ-1`, `OBJ-2`, `STAKEHOLDER-1` ... `STAKEHOLDER-N`), and presents them in the desktop UI as `Seed candidate ready for review`. The operator reviews, optionally edits, and commits the docs to the project workspace at the canonical path (`requirements/stakeholder/`). The `seed` invocation records itself in `stage-cd-mode-history.json`. On the next run, Stage CD detects the authored docs and operates in `compare` mode.

**Why this priority:** Without seed-once, every new project would require operators to author the stakeholder docs from scratch before Stage CD can run, blocking adoption. With seed-once, projects bootstrap quickly and the inversion to `compare` mode is automatic on the next run. P1 because new-project adoption is the primary growth path.

**Independent Test:** On a project with no authored stakeholder docs, run a factory pipeline through Stage CD. Assert (a) Stage CD runs in `seed` mode (logged in `stage-cd-diff.json` with `mode: "seed"`), (b) two candidate documents are produced, (c) the desktop UI surfaces a "Review and commit seed candidates" action, (d) after the operator commits the documents to the workspace, a re-run of Stage CD operates in `compare` mode.

**Acceptance Scenarios:**

1. **Given** no authored `charter.md` or `client-document.md` exists at the canonical path, **When** Stage CD runs, **Then** it operates in `seed` mode: it generates `charter.candidate.md` and `client-document.candidate.md` with anchored sections, and emits a `stage-cd-seed-ready` event.
2. **Given** the seed candidates exist, **When** the operator commits them as authored (a one-click action that copies the candidate to the canonical path with frontmatter `status: authored, version: "1.0.0"`), **Then** subsequent Stage CD runs detect the authored docs and operate in `compare` mode automatically.
3. **Given** a project that authored its docs from scratch (without seed-once), **When** the operator commits the authored docs at the canonical path, **Then** Stage CD operates in `compare` mode on the next run; the absence of a `seed` event in history is normal and recorded.
4. **Given** a project's authored docs are deleted (intentionally or accidentally), **When** Stage CD runs, **Then** it falls back to `seed` mode for one run with a warning event `stage-cd-mode-fallback-to-seed`. Operators see this in the UI as a clear regression and can either re-author or re-seed.

---

### User Story 4 - Reclassification migration on existing projects (Priority: P1)

The example project was running under the old Stage CD generator. Its `requirements/client/charter.md` and `requirements/client/client-document.md` exist as Stage CD outputs and reflect a contaminated BRD. The operator runs `factory migrate stakeholder-docs --project <path>`. The migration: (a) moves the files from `requirements/client/` to the canonical authored path, (b) computes initial anchors and adds them to the file (operator-reviewable), (c) runs spec 121's validator over the migrated content, (d) emits a migration report listing every section without a citation, every section that names an unknown external entity, and every section whose content contradicts the extracted corpus, (e) writes a migration provenance record in the artifact store. After migration, those files are authored: Stage CD will operate in `compare` mode and immediately surface drift between the authored (contaminated) state and a candidate generated from a freshly-validated BRD.

**Why this priority:** Without a migration path, existing projects cannot adopt 122 without manual reconstruction. The migration must be a single command, idempotent, and must produce a clean punch list of contamination for the operator to clean up. P1 because retrofit is mandatory for any project mid-flight.

**Independent Test:** On a snapshot of the example project, run `factory migrate stakeholder-docs`. Assert (a) the files move to the canonical path with `status: authored, migrated: true, migratedFrom: <old-path>` frontmatter, (b) initial anchors are inserted, (c) the migration report names sections without citations and sections naming `Globex`/`Globex Finance Integrations` as `migration-flagged: external-entity`, (d) the project's first Stage CD run after migration produces a non-empty `stage-cd-diff.json` reflecting the contamination, (e) the migration is idempotent: re-running produces no further changes.

**Acceptance Scenarios:**

1. **Given** an existing project with `requirements/client/charter.md` and `requirements/client/client-document.md`, **When** the operator runs `factory migrate stakeholder-docs`, **Then** the files are moved to `requirements/stakeholder/`, the legacy paths are deleted (or kept as `*.legacy.md` in a configurable mode), and the new files carry `frontmatter.migrated: true, migratedAt, migratedFrom`.
2. **Given** a migrated file, **When** the migration tool inserts anchors, **Then** it identifies sections by header level and naming convention (`### Objectives`, `### Stakeholders`, etc.), inserts the anchor format inline (`### OBJ-1: <heading>`), and preserves all existing prose.
3. **Given** the migrated file, **When** the migration tool runs the spec-121 validator, **Then** every section's body is treated as a synthetic claim and validated for external-entity citation. Sections that reference external entities not in the allowlist with no citations are flagged in the migration report.
4. **Given** the migration completes, **When** the operator re-runs the migration on the same project, **Then** the tool detects that migration has already occurred (`frontmatter.migrated: true`) and exits with `already_migrated` and a diff against the previous migration's report — it does NOT re-process the files.
5. **Given** the project has authored docs that pre-date the migration tool (a project that hand-authored docs before adopting this spec), **When** the operator runs the migration, **Then** the tool detects no legacy `requirements/client/*.md` exists, treats the docs as already-authored, and exits with `nothing_to_migrate`.

---

### User Story 5 — Authored citation that doesn't match the corpus is rejected (Priority: P2)

The operator authors a charter that cites an extracted quote (`source: "extracted/Business-Case.docx.txt", lineRange: [21, 23], quote: "60+ forms returned for correction per cycle"`). On the next factory run, the citation is re-validated against the current corpus. The cited file no longer contains that exact quote (the bundle was updated). The validator reports a citation orphan. The comparator gate blocks (citation diffs are gate-blocking, same as scope diffs). The operator must update the citation, downgrade the section to ASSUMPTION, or remove the citation.

**Why this priority:** Without authored-citation re-validation, a charter could itself accumulate fabrications over time as the corpus changes. The same `FAC-S1-011` invariant must apply to authored stakeholder docs. P2 because most citation drift is gradual; new projects may not encounter it for months.

**Independent Test:** Author a charter with a valid citation. Replace the cited extracted file with a reworded version. Re-run Stage CD. Assert (a) the validator detects the orphaned citation, (b) the diff is classified as `citation`, (c) `QG-CD-01` returns FAIL, (d) the operator can resolve via three paths (re-cite, downgrade to ASSUMPTION, remove).

**Acceptance Scenarios:**

1. **Given** an authored doc section with `frontmatter.citations[N] = {source, lineRange, quote, quoteHash}`, **When** the validator re-computes the corpus's `quoteHash` at the cited line range, **Then** if the hashes mismatch, the citation is recorded as `orphaned` and the section's effective `provenanceMode` becomes `ASSUMPTION-orphaned` per spec 121.
2. **Given** any orphaned authored citation, **When** the comparator classifies the diff, **Then** it is classified `citation`, and `QG-CD-01` blocks.
3. **Given** the operator chooses to re-cite, **When** they supply a new `lineRange` or new source matching the current corpus, **Then** the validator recomputes `quoteHash`, the section returns to `DERIVED`, and the gate re-evaluates.
4. **Given** the operator chooses to downgrade, **When** they supply `{owner, rationale, expiresAt}` and budget capacity exists, **Then** the section's effective `provenanceMode` becomes `ASSUMPTION` per spec 121, and the gate re-evaluates.

---

### Edge Cases

- **Anchor missing from authored doc.** If an authored section has no anchor (e.g., a stakeholder hand-edited and forgot the marker), `stakeholder-doc-lint` emits W-122-001. The comparator falls back to fuzzy `anchorHash` pairing for that section but flags it in the diff report. Operators are encouraged to add anchors but the comparator does not block on missing anchors.
- **Authored doc has anchor that the candidate does not.** Treated as `structural` diff: the candidate dropped a section the authored had. Blocks gate unless operator approves.
- **Candidate has a new anchor with no authored analog.** Treated as `structural` diff: the candidate introduces a section. Blocks gate; operator decides whether to incorporate into authored or reject.
- **Candidate body cites an extracted span the authored doesn't.** The candidate's citations run through spec 121's validator independently. Successful candidate citations are surfaced in the diff as `citation-evidence` to help the operator decide whether to incorporate.
- **Two operators concurrently edit the authored doc.** Out of scope for in-tool merging. Surface as git merge conflict; the comparator runs against whichever version is on disk after the merge.
- **Authored doc deleted between runs.** Stage CD falls back to `seed` mode for one run with a `mode-fallback-to-seed` warning. Operator must re-author or re-commit.
- **Authored doc has frontmatter `status: draft`.** Comparator runs but does NOT block the gate on diffs against draft docs — drafts are explicitly not yet authoritative. Operator must promote `draft → authored` to enforce the gate.
- **Authored doc's `frontmatter.version` was bumped without an apply.** Surfaces as W-122-002 in `stakeholder-doc-lint`: version was changed but no `appliedFrom` chain exists.
- **External-entity classification disagreement.** The comparator and spec 121's validator both run external-entity detection; they MUST use the same allowlist. Mismatch is a build-time bug.
- **Reclassification migration on a project with hand-edits.** If `requirements/client/charter.md` already has manual modifications relative to its Stage CD generation history, the migration tool preserves the manual content and flags the file as `manuallyEdited: true` in frontmatter. Operators should review before relying on the migration.
- **Operator forces approval through a `scope` diff.** The override is recorded with full audit (`factory.stakeholder_doc_force_approve`) including the operator's identity, reason, and a link to the diff. Workspace policy MAY require a co-approver for scope overrides on regulated projects.
- **Anchor renumbering by the candidate.** If the candidate emits `OBJ-1, OBJ-2, OBJ-3` while the authored has `OBJ-1, OBJ-2, OBJ-3` but the same concepts are at different anchor indices, the comparator pairs by `anchorHash` (not by anchor index). Anchor index is for human readability; `anchorHash` is for pairing.

## 5. Requirements

### 5.1 Functional Requirements

#### Stakeholder-doc grammar

- **FR-001**: A new module `crates/factory-contracts/src/stakeholder_docs.rs` MUST define serde types for the authored stakeholder docs: `StakeholderDoc { kind: DocKind, frontmatter: StakeholderFrontmatter, sections: Vec<AnchoredSection> }`, `DocKind { Charter, ClientDocument }`, `StakeholderFrontmatter { status: AuthoringStatus, owner: String, version: SemVer, supersedes: Option<SemVer>, citations: Vec<Citation>, migrated: bool, migratedAt: Option<DateTime>, migratedFrom: Option<PathBuf> }`, `AnchoredSection { anchor: SectionAnchor, headingText: String, body: String, citations: Vec<Citation>, anchorHash: AnchorHash }`.
- **FR-002**: Section anchors MUST follow the format `<KIND>-<NNN>` where `<KIND>` ∈ `{OBJ, STAKEHOLDER, OUTCOME, IN-SCOPE, OUT-SCOPE, OWNER, ASSUMPTION, RISK}` and `<NNN>` is a zero-padded integer (`OBJ-001`, `STAKEHOLDER-003`). Anchors are inserted inline in the heading: `### OBJ-1: Reduce form-correction cycles by 50%`.
- **FR-003**: Anchor kinds MUST be exhaustive for V1; adding a new kind requires a spec amendment. The lint tool `stakeholder-doc-lint` rejects unknown kinds.
- **FR-004**: Authored docs MAY include citations at two levels: (a) frontmatter-level `citations[]` for whole-doc claims (e.g., the charter's overall objective set is derived from `business-case.docx`), (b) section-level `citations[]` for per-section claims (e.g., `OBJ-1` cites a specific quote). Both use the spec-121 `Citation` type verbatim.
- **FR-005**: A new tool `tools/oap/stakeholder-doc-lint` MUST validate authored docs against the grammar. It MUST run as part of `make ci` and MUST be invoked by the comparator before producing diffs (the comparator refuses to run against an invalid authored doc).
- **FR-006**: The grammar MUST have a compile-time schema version `pub const STAKEHOLDER_DOC_SCHEMA_VERSION: &str = "1.0.0"`. The schema parity check from spec 120 MUST be extended to cover this module.

#### Canonical paths and reclassification

- **FR-007**: The canonical authored path MUST be `requirements/stakeholder/charter.md` and `requirements/stakeholder/client-document.md`. Paths are pinned by spec to prevent drift across projects.
- **FR-008**: A migration command MUST exist: `factory migrate stakeholder-docs --project <path> [--keep-legacy]`. It moves `requirements/client/charter.md` → `requirements/stakeholder/charter.md` and the same for `client-document.md`. By default the legacy paths are deleted; with `--keep-legacy` they are renamed `*.legacy.md`.
- **FR-009**: The migration MUST be idempotent. Re-running on a migrated project exits with `already_migrated` and produces a no-op diff against the prior migration report.
- **FR-010**: The migration MUST insert section anchors by header inspection. Sections without an obvious heading-to-kind mapping (e.g., a free-form prose section) are inserted with kind `OBJ` (default fallback) and flagged in the report for operator review.
- **FR-011**: The migration MUST run spec 121's validator on the migrated content. The migration report names every section that fails validation, with the same remediation prompts (supply citation, downgrade, remove) Stage 1 surfaces.
- **FR-012**: The migration MUST emit a provenance record `requirements/audit/stakeholder-doc-migration.md` listing the files moved, the anchors inserted, the validator findings, and the migration timestamp.

#### Stage CD inversion

- **FR-013**: Stage CD MUST be split into two phases (in `crates/factory-engine/src/stages/stage_cd.rs`):
  - **Phase 1 (candidate generation):** the existing Stage CD generator logic produces `charter.candidate.md` and `client-document.candidate.md` to the artifact store. NOT to the project workspace.
  - **Phase 2 (comparator):** new logic in `stage_cd_comparator.rs` that diffs candidates against authored docs.
- **FR-014**: Stage CD MUST detect the project's mode at start: `seed` if no authored docs exist at the canonical path, `compare` otherwise. Mode is recorded in `stage-cd-diff.json`.
- **FR-015**: In `seed` mode, Stage CD MUST: (a) run Phase 1 (candidate generation), (b) emit `stage-cd-seed-ready` with paths to the candidates, (c) NOT run Phase 2, (d) NOT block the gate (the gate passes with a warning recording that no authored docs existed).
- **FR-016**: In `compare` mode, Stage CD MUST: (a) run Phase 1, (b) run Phase 2, (c) write `stage-cd-diff.json` to the artifact store, (d) evaluate `QG-CD-01_StakeholderDocAlignment`.
- **FR-017**: Stage CD MUST NOT write to the project workspace under any mode. Authored docs are only modified by explicit operator action (FR-022) or by the migration tool (FR-008).

#### Comparator and diff classification

- **FR-018**: The comparator MUST pair candidate sections to authored sections by: (a) exact anchor match (`OBJ-1 ↔ OBJ-1`) takes precedence, (b) `anchorHash` exact match if anchors differ but concepts are equal, (c) `anchorHash` similarity (Jaccard ≥ 0.6 over normalized tokens) for fuzzy pairing, (d) unmatched sections on either side are recorded as `structural` diffs.
- **FR-019**: For each paired section, the comparator MUST compute a body diff and classify it as one of:
  - `wording` — anchorHash matches; body diff contains no scope-kind tokens (`in-scope`, `out-of-scope`, `excluded`, `included`), no external-entity tokens (per spec 121 allowlist), no owner-name tokens, and no citation deltas.
  - `structural` — section added or removed.
  - `scope` — anchor kind changed (`IN-SCOPE-N` ↔ `OUT-SCOPE-N`) OR body contains a scope-flip phrase (regex matched).
  - `external-entity` — body contains an entity not in the allowlist that was not in the authored body.
  - `ownership` — body contains an owner-name token that differs from the authored body's owners (matched against the project's known-owners set).
  - `citation` — citation list differs (new citation, removed citation, orphaned citation per FR-021).
- **FR-020**: Classification MUST be deterministic. Two runs against the same `(authored, candidate)` pair MUST produce identical classification.
- **FR-021**: Authored citations MUST be re-validated by spec 121's validator on every Stage CD run. Orphaned citations (per spec 121 FR-022) classify the section's diff as `citation`.

#### Comparator gate

- **FR-022**: A new gate `QG-CD-01_StakeholderDocAlignment` MUST be added to Stage CD's gate set. It evaluates `stage-cd-diff.json` and:
  - PASS if all diffs are `wording` (recorded as warnings).
  - FAIL if any diff is `scope`, `external-entity`, `ownership`, or `citation`.
  - FAIL if any diff is `structural` UNLESS the operator has approved that specific diff (via FR-024).
- **FR-023**: The gate MUST emit `audit_log` action `factory.stage_cd_gate_evaluated` with `{ project, mode, diffCounts, decision, blockingDiffs[] }`.
- **FR-024**: An operator approval action MUST be available via the desktop UI: `Reject candidate` (preserves authored, dismisses the diff for this run), `Accept candidate` (applies the candidate to the authored doc, requires confirmation, bumps `frontmatter.version`), `Force approve` (passes the gate without applying — used for documenting acknowledged drift, requires a reason, audit-logged with full identity).
- **FR-025**: The `Accept candidate` action MUST: (a) write the candidate's section body to the authored doc at the same anchor, (b) preserve frontmatter except for `version` (incremented per semver patch), (c) record the change in `frontmatter.appliedFrom` with `{ runId, candidatePath, fromHash, toHash, actor, appliedAt }`, (d) emit `factory.stakeholder_doc_accepted_candidate`.
- **FR-026**: The `Force approve` action MUST require a free-text `reason` (operator must type something). The reason is recorded in the audit row. Workspace policy MAY require a second approver for `scope` and `ownership` diffs — when set, the gate passes only when both approvers have force-approved.

#### Anchor stability and `anchorHash`

- **FR-027**: The comparator MUST use spec 121's `anchor_hash` function unchanged. No alternate normalization is permitted at the stakeholder-doc layer.
- **FR-028**: When an authored section's anchor index conflicts with a sibling (e.g., two `OBJ-1`), the lint tool emits W-122-003 and the comparator refuses to run until the conflict is resolved.
- **FR-029**: The reclassification migration MUST insert anchors with `anchorHash` already computed and recorded inline (as a comment) so the operator can audit the migration's pairing decisions: `### OBJ-1: Reduce form-correction cycles <!-- anchorHash: sha256:abc... -->`.

#### Operator UX

- **FR-030**: A new desktop UI surface `product/apps/opc/src/components/factory/StageCdReview.tsx` MUST render the comparator's output: the `stage-cd-diff.json` per-section, side-by-side authored vs candidate views, diff classification labels, and the three operator actions (Reject / Accept / Force approve).
- **FR-031**: The review surface MUST link each diff to its underlying claim chain (the BRD claim → Stage 1 emit → upstream extraction citation, where derivable). This lets operators navigate from a Stage CD scope flip to the Stage 1 fabrication that caused it without leaving the surface.
- **FR-032**: The review surface MUST surface the `seed-ready` signal distinctly from the `compare-blocked` signal: seeding is a positive milestone, blocking is a remediation action.

#### Schema parity and lint

- **FR-033**: The schema parity check (spec 120 / 121) MUST be extended to cover `stakeholder_docs.rs`. Drift between Rust types and any TS mirror (none required for V1 but path reserved) fails CI.
- **FR-034**: `stakeholder-doc-lint` MUST emit warnings:
  - `W-122-001` — section without anchor.
  - `W-122-002` — frontmatter version bumped without `appliedFrom` chain.
  - `W-122-003` — duplicate anchor.
  - `W-122-004` — citation references a source not in the project's artifact store.
  - `W-122-005` — section body contains an unallowed external entity (per spec 121 allowlist).
- **FR-035**: `stakeholder-doc-lint` MUST run on `make ci`. By default warnings do not fail the build (consistent with `spec-lint`'s default); a `--fail-on-warn` flag exists for stricter enforcement.

#### No silent re-import

- **FR-036**: Authored docs MUST NOT re-flow into the BRD on subsequent runs. A change to the charter does NOT retroactively rewrite Stage 1 outputs. The cascade rule is one-way: BRD changes propagate to candidate stakeholder docs (via Stage CD comparator); authored changes do NOT propagate to BRD without an explicit operator-initiated Stage 1 rerun.
- **FR-037**: An operator-initiated "rerun Stage 1 with authored docs as priority input" action MAY exist (a future spec; not required by V1). When implemented, it MUST emit a discrete event and produce a clean Stage 1 cascade per spec 121's rules.

### 5.2 Key Entities

- **`StakeholderDoc`** (new, in `factory-contracts/src/stakeholder_docs.rs`): typed view of an authored markdown doc.
- **`AnchoredSection`** (new): one section keyed by anchor; carries `anchorHash` from spec 121's normalization.
- **`StakeholderFrontmatter`** (new): document-level metadata including `status`, `owner`, `version`, `supersedes`, `citations`, migration trail.
- **`stage-cd-diff.json`** (new artifact): per-run diff record produced by the comparator.
- **`charter.candidate.md` / `client-document.candidate.md`** (new artifacts): Stage CD Phase 1 outputs, written to the artifact store, never to the project workspace.
- **`requirements/stakeholder/charter.md` / `requirements/stakeholder/client-document.md`** (new authored paths): the canonical homes for stakeholder-authored truth.
- **`requirements/audit/stakeholder-doc-migration.md`** (new artifact, migration only): the migration provenance record.

### 5.3 Permissions and audit

- Stage CD comparator runs inherit the factory run's identity; no new permission.
- Operator actions (Reject / Accept / Force approve) require workspace-membership.
- `Force approve` on `scope` and `ownership` diffs MAY require a co-approver per workspace policy.
- The migration tool requires filesystem access only.
- Every comparator run, every gate evaluation, every operator action, and every migration emits an `audit_log` row.

### 5.4 Out-of-process operations

- The comparator runs in-process inside `crates/factory-engine`; no separate daemon.
- The migration tool runs as `factory migrate stakeholder-docs` on the operator's machine; it has no network dependency.
- The lint tool reads files from disk only.

## 6. Success Criteria

### Measurable Outcomes

- **SC-001**: A factory run with an authored `OUT-SCOPE-3: Payment processing` and a candidate `IN-SCOPE-7: Globex integration` (paired by `anchorHash` similarity ≥ 0.6) is blocked at `QG-CD-01` 100% of the time. Verified by fixture replicating the example project forensic.
- **SC-002**: A `wording`-only diff (anchorHash matches, body reword without scope/entity/owner/citation deltas) passes the gate without operator action 100% of the time. Verified by fixture covering several reword shapes.
- **SC-003**: Bootstrap on a fresh project with no authored docs runs Stage CD in `seed` mode, produces both candidate documents to the artifact store, and does NOT block the gate.
- **SC-004**: Reclassification migration on the example project moves the two files to the canonical path, inserts anchors, runs spec-121 validation, and produces a non-empty migration report flagging `Globex`-class fabrications. Verified by fixture pinned to the current example project state.
- **SC-005**: An authored citation whose `quoteHash` no longer matches the corpus is detected as orphaned, the diff is classified `citation`, and the gate blocks. Verified by replacing a cited file with a reworded version.
- **SC-006**: Diff classification is deterministic: two comparator runs against the same `(authored, candidate)` pair produce byte-identical `stage-cd-diff.json`. Verified by property test.
- **SC-007**: An operator's `Force approve` action requires a non-empty reason and is audit-logged with full identity. Verified by integration test asserting empty-reason force approvals are rejected.
- **SC-008**: Authored docs are NEVER modified by Stage CD without an explicit `Accept candidate` action. Verified by integration test asserting a comparator run that finds zero diffs leaves the authored doc bytes unchanged on disk.
- **SC-009**: `stakeholder-doc-lint` emits W-122-001 through W-122-005 correctly across a fixture set covering each warning condition.
- **SC-010**: The reclassification migration is idempotent. Re-running on a migrated project exits with `already_migrated` and produces no further file mutations. Verified by fixture.
- **SC-011**: A `seed`-mode run does NOT write to the project workspace; only the artifact-store candidates are created. Verified by integration test.
- **SC-012**: Schema parity check fails CI on any drift between `stakeholder_docs.rs` and (eventual) TS mirrors. Verified by deliberate-drift regression test.

## 7. Open Decisions

- **Canonical path: `requirements/stakeholder/` vs `requirements/client/`.** The example project uses `requirements/client/` and other projects likely follow. Moving to `stakeholder/` is cleaner (the docs are *by* stakeholders, not *for* clients) but breaks existing repo paths. V1 chooses `requirements/stakeholder/` and migrates; an alternative is to keep `requirements/client/` and just add frontmatter to flip the meaning. Open for plan.md.
- **Whether `seed-once` can produce both docs in one run or one at a time.** V1: both at once. Operators may want to seed only the charter and author client-document from scratch. Decision deferred to plan.md based on operator feedback.
- **Force-approve co-approval requirement.** V1 reserves the workspace-policy hook (FR-026) but does not require co-approval by default. Regulated workspaces will likely want to enable it; default is single-approver to stay practical.
- **Whether the comparator should suggest an apply (auto-merge proposal) for accepted diffs.** V1: no, operator manually applies via the desktop action. A future iteration may add a generated patch that the operator can `git apply`.
- **Cycle prevention strength.** V1 forbids automatic re-import of authored docs into BRD (FR-036). Some operators may want a "rerun Stage 1 with these authored docs as priority input" action (FR-037 — currently optional). Whether this lands in V1 or a follow-up is open.
- **Anchor format extensibility.** V1 has a fixed kind set (`OBJ, STAKEHOLDER, OUTCOME, IN-SCOPE, OUT-SCOPE, OWNER, ASSUMPTION, RISK`). Some projects may want `CONSTRAINT`, `MILESTONE`, etc. V1 fixes the set; a future spec may add a workspace-level extension mechanism.
- **Whether `client-document` should split further.** Some projects' "client document" is really three documents (executive summary, glossary, audience-by-audience views). V1 keeps a single document; a future spec may decompose.
- **Whether wording-only diffs that accumulate over many runs should auto-apply.** Currently they pass silently and the candidate is discarded. If the operator's intent is "the candidate's wording is consistently better" they must manually apply each time. Auto-apply on N consecutive identical wording diffs is a tempting heuristic but creates a silent-modification path. V1: no auto-apply.

## 8. Provenance

- `crates/factory-contracts/src/stakeholder_docs.rs` — new types module.
- `crates/factory-engine/src/stages/stage_cd.rs` — Stage CD driver, split into Phase 1 (candidate generation) and Phase 2 (comparator).
- `crates/factory-engine/src/stages/stage_cd_comparator.rs` — new module: pairing, classification, gate evaluation.
- `crates/factory-engine/skills/client-document-comparator.md`, `crates/factory-engine/skills/project-charter-comparator.md` — new skill prose for comparator-mode behaviour, distinct from the legacy generator skills.
- `tools/oap/stakeholder-doc-lint/` — new lint tool, runs on `make ci`.
- `product/apps/opc/src/components/factory/StageCdReview.tsx` — new UI surface for diff review.
- `requirements/stakeholder/charter.md`, `requirements/stakeholder/client-document.md` — canonical authored paths reserved by spec.
- `requirements/audit/stakeholder-doc-migration.md` — migration provenance path.
- Forensic record: `requirements/debug/Forensic-Analysis_Globex-Integration-Scope-Provenance.md` (project-local at the example project workspace) - documents the Stage CD overwrite this spec prevents.
- Spec 120 — typed extraction corpus underwriting authored-doc citations.
- Spec 121 — validator + allowlist + `anchor_hash` reused at the comparator gate; same `FAC-S1-011` invariant applied to authored docs.
- Spec 075 — factory-workflow-engine; Stage CD lifecycle this spec inverts.
- Spec 087 — unified-workspace-architecture; workspace plane is where authored truth lives.
- Spec 119 — project-as-unit-of-governance; project is the governance unit for the stakeholder doc set.
- Spec 094 — unified artifact store; persistence layer for `*.candidate.md` and `stage-cd-diff.json`.
- Spec 091 — registry-enrichment; eventual home for cross-project `stage-cd-diff` aggregation.
