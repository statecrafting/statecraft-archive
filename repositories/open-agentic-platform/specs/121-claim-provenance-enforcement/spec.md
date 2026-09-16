---
id: "121-claim-provenance-enforcement"
slug: claim-provenance-enforcement
title: Claim Provenance Enforcement
status: approved
implementation: complete
owner: bart
created: "2026-04-30"
kind: governance
domain: tooling
risk: critical
summary: >
  Make every claim that the Factory Phase-1 pipeline mints (`STK-*`,
  `SN-*`, `BR-*`, `UC-*`, `TC-*`, `INT-*`, `FS-*`, `SYSREQ-*`,
  `STREQ-*`, `SWREQ-*`, `USRREQ-*`) prove its provenance against the
  typed extraction corpus produced by spec 120, OR be tagged
  `ASSUMPTION` with a named human owner and a budget entry. Introduce a
  `crates/provenance-validator` crate that reads `ExtractionOutput`
  directly via serde — independent of the LLM that minted the claim —
  and runs an allowlist-driven external-entity detector against each
  claim's text. Claims that name an external entity with no verbatim
  citation and no `ASSUMPTION` tag are `REJECTED`; the Stage 1 gate
  blocks. Stable `anchorHash` IDs preserve `BR-007` across regeneration
  so a charter reword does not renumber downstream tests.
  `ASSUMPTION`-tagged claims propagate to a parallel
  `assumption-only-manifest.md` and Stages 4–5 emit spec-only artifacts
  for them — no DDL, no zod, no test fixtures, no banners — until they
  are promoted to `DERIVED` by a citation arriving in the corpus.
  Stage CD inversion lives in spec 122; this spec produces the
  validator and gate that spec 122 reuses.
depends_on:
  - "075-factory-workflow-engine"  # factory-workflow-engine (stage gate)
  - "091-registry-enrichment"  # registry-enrichment (provenance lives in the enriched registry surface)
  - "118-workflow-spec-traceability"  # workflow-spec-traceability (claim records are traceable artifacts)
  - "120-factory-extraction-stage"  # factory-extraction-stage (typed corpus to cite against)
establishes:
  - unit: { kind: file, path: crates/provenance-validator/Cargo.toml }
  - unit: { kind: file, path: crates/provenance-validator/src/lib.rs }
  - unit: { kind: file, path: crates/provenance-validator/src/allowlist.rs }
  - unit: { kind: file, path: crates/provenance-validator/src/citation.rs }
  - unit: { kind: file, path: crates/factory-contracts/src/provenance.rs }
references:
  - role: historical
    unit: { kind: file, path: crates/provenance-validator/src/anchor.rs }
  - role: historical
    unit: { kind: file, path: platform/services/statecraft/api/governance/provenancePolicy.ts }
  - role: historical
    unit: { kind: file, path: crates/factory-engine/src/stages/s1_business_requirements.rs }
  - role: historical
    unit: { kind: file, path: crates/factory-engine/skills/business-requirements-analyst.md }
  - role: historical
    unit: { kind: file, path: crates/factory-engine/skills/validate.md }
extends:
  - spec: "075-factory-workflow-engine"
    nature: additive
    unit: { kind: file, path: crates/factory-engine/src/stages/quality_gates.rs }
compliance:
  - framework: "owasp-asi-2026"
    # ASI01 via FR-001/FR-024 (validator + QG-13_ExternalProvenance enforce
    # that every external-entity claim cite the corpus verbatim or carry an
    # ASSUMPTION tag — directly defeats the model-prior-driven fabrication
    # mode documented in §1's example forensic).
    # ASI10 via FR-022 (citation drift detection: when extractedCorpusHash
    # changes, every DERIVED claim's quoteHash is re-validated; orphans
    # downgrade — claim-level drift detection).
    controls: ["ASI01", "ASI10"]
---

# 121 — Claim Provenance Enforcement

**Feature Branch:** `121-claim-provenance-enforcement`
**Created:** 2026-04-30
**Status:** Draft
**Input:** "Stage 1 fabricates IDs that look real (Globex integration, STK-13) and the cascade carries them silently into DDL, zod, and tests. Make every claim prove its source against the extraction corpus or be tagged ASSUMPTION with a named owner."

## 1. Problem

Spec 120 closes the raw-bytes-to-typed-extraction seam. It does not enforce that anything downstream of extraction stays anchored to extracted evidence. Today's Factory Phase-1 pipeline does not enforce it either — Stage 1's `business-requirements-analyst` is a single LLM call that emits a 16-section ISO-29148 BRD with `BR-`, `STK-`, `INT-`, `UC-`, `TC-` identifiers, and the only quality gates check internal RTM closure (cross-references inside the BRD itself). They do not check that any claim is backed by extracted evidence.

A forensic on a live example project demonstrates the consequence:

- Stage 1 minted `STK-13` (Globex Finance Integrations / Globex Initech ERP), `SN-022` (Globex scope), and `INT-003` (Globex integration) with a back-citation to a source that says the **opposite** ("Payment processing: Out of Scope"). No quote from the extracted corpus matches any of the three.
- The model's training-data prior knew Globex exists in an enterprise domain it had seen in training, decided it belonged in scope, and produced template-shape claims indistinguishable from the legitimate ones (STK-14 Entra ID, STK-15 Okta, both with real corpus backing).
- Internal quality gates reported PASS because they have no concept of external provenance.
- Stage CD then regenerated `requirements/client/project_charter.md` from the contaminated BRD, **inverting** the source charter's "Payment processing (Finance systems): Out of Scope" into "Globex integration is in scope." The audit trail back to authored stakeholder truth was severed in a single stage.
- By Stage 4 the fabrication had become a `payment_request` table in the DDL, a `createPaymentRequestStub` function, 7 `IntegrationPendingBanner.vue` placements in the UI, and `TC-021/TC-022` test cases that pass forever against `vendor_legal_name: 'TBD'`. Eight artifact families now treat the fabrication as production-bound work.

The same shape will recur on every project. The factory's freedom to "read any format" at Stage 1 is exactly what makes fabrication invisible — closing the freedom is the structural fix.

This spec introduces the invariant: every claim that names external reality must cite the extraction corpus verbatim, or carry an `ASSUMPTION` tag whose budget is held by a named human. The validator that enforces this lives in a separate Rust crate that reads spec-120's typed `ExtractionOutput` directly via serde and cannot be fooled by the same LLM that minted the claim.

## 2. Goals

- **Validator independent of the minter.** A new crate `crates/provenance-validator` reads `ExtractionOutput` from the artifact store via serde and, for every claim emitted by Stage 1 (or any later stage that mints IDs), determines whether the claim's text references external entities and whether those references are backed by verbatim citations. The validator is invoked by the factory engine's stage-gate machinery — not by Stage 1's prompt. It cannot be bypassed by re-prompting.
- **Three provenance modes per claim.** Every claim record carries `provenanceMode ∈ {DERIVED, ASSUMPTION, REJECTED}`:
  - `DERIVED` requires `citations[]` of `{source, lineRange, quote, quoteHash}` against the typed corpus.
  - `ASSUMPTION` requires `{tag, owner, rationale, expiresAt}` and consumes a slot in the per-project assumption budget.
  - `REJECTED` is recorded for forensic visibility; the stage gate blocks while any `REJECTED` exists in `STRICT` mode.
- **Allowlist-driven external-entity detection, NOT NER.** The validator consults a project allowlist auto-derived from (a) the authored charter's vocabulary (when spec 122 is online; until then, from extracted corpus surface), (b) `entity-model.yaml` from Stage 2 outputs (after the first run), (c) a small built-in core (jurisdiction nouns, common verbs, project name). Anything outside the allowlist that looks like an organization, system, or product name flags as an external entity. NER is brittle (Thread B's question 1) — allowlist is durable, project-shaped, and easy to expand.
- **Stable `anchorHash` IDs across regeneration.** Each claim is assigned a semantic anchor hash (a sha256 of normalized concept text, NOT wording). An `id-registry.json` per project maps `anchorHash → first-mint ID`. When Stage 1 reruns and the underlying concept is unchanged, the registry returns the same `BR-007` even if the wording moved. New concepts mint new IDs. This is the load-bearing piece that lets a charter reword not break Stage 4 zod schemas or Stage 5 form bindings.
- **`FAC-S1-011` rule and `QG-13` quality gate.** The Stage 1 validation log gains rule `FAC-S1-011` ("every external-entity-naming claim must have provenance") and quality gate `QG-13_ExternalProvenance`. In `STRICT` mode `QG-13` is blocking on any `REJECTED` claim. In `PERMISSIVE` mode it is warning only — used for retrofitting projects whose existing BRDs have not yet been audited. Default for new projects is `STRICT`.
- **Cross-stage cascade for `ASSUMPTION`.** A separate artifact `assumption-only-manifest.md` lists all `ASSUMPTION`-tagged claims. Stages 4 and 5 read this manifest and emit **spec-only** artifacts for those claims — no DDL tables, no zod schemas, no service stubs, no integration banners, no test fixtures. A claim's promotion from `ASSUMPTION` to `DERIVED` happens only when (a) a citation arrives in the corpus on a subsequent run, OR (b) an operator-signed promotion record is added. Neither path is a silent re-prompt.
- **Citation drift detection.** When the `extractedCorpusHash` (computed from the spec-120 artifact-store inventory) changes between runs, every `DERIVED` claim's `quoteHash` is re-validated against the new corpus. Citations whose quoted text no longer appears verbatim are auto-downgraded to `ASSUMPTION-orphaned` and surface in a drift report. The corresponding stage cascade reruns under the same gate.
- **Retroactive audit mode.** The validator runs as a one-shot tool against an existing project's artifacts (without re-running the pipeline) and produces a report of every claim that would be `REJECTED` or downgraded under the rule. This lets contaminated projects (e.g., the example BRD) get a clean punch list without first re-running Stage 1.

## 3. Non-Goals

- **Spec 120 carrier work.** Schema mirror, `s-1-extract` stage, statecraft endpoint — all delivered by 120. This spec consumes 120's outputs.
- **Stage CD inversion and the stakeholder-doc grammar.** Reclassifying `client-document.md` and `project_charter.md` from outputs to authored inputs, and the section-anchor / citation-syntax grammar for those docs, lives in **spec 122**. This spec's validator is reused by 122 at the Stage CD comparator gate, but the inversion itself is a separate concern.
- **LLM-side prompt engineering to reduce fabrication.** The validator is the safety net regardless of how the model is prompted. Improvements to the Stage 1 prompt that lower the fabrication rate are independent and welcome but not in scope.
- **Per-stage prompt versioning.** Prompt-assembly cache (spec 070) handles fingerprinting. This spec records `extractor.agentRun.promptFingerprint` from spec 120's typed output but does not version Stage 1 prompts itself.
- **Embeddings-based citation matching.** The validator does verbatim string match (with normalized whitespace + Unicode NFC). Semantic similarity matching is out of scope; if a stakeholder reworded a quote, the validator should fail closed and require the citation to be regenerated, not silently match a paraphrase.
- **Auto-promotion from `ASSUMPTION` to `DERIVED`.** When a new run sees a citation that would have backed a previously `ASSUMPTION`-tagged claim, the validator records the candidate citation but does NOT auto-promote. Operator review keeps a human in the loop for governance-grade transitions.
- **Cross-project anchor reuse.** `anchorHash` IDs are scoped per project. The same concept in two projects gets independent `BR-007`s. A future spec may revisit if portfolios need shared identifiers.

## 4. User Scenarios & Testing

### User Story 1 — Stage 1 fabrication is blocked at the gate (Priority: P1)

A factory run on the example bundle reaches Stage 1. The LLM mints, among 30 valid claims, an `STK-13` ("Globex Finance Integrations / Globex Initech ERP: payment system of record") with no extracted-corpus citation. The validator runs at the Stage 1 gate, detects that `STK-13`'s text names external entities `["Globex", "Initech ERP", "Globex Finance"]`, walks the corpus for verbatim hits, finds none, and records `STK-13` with `provenanceMode: REJECTED`. `QG-13_ExternalProvenance` reports FAIL. The Stage 1 gate blocks. The factory pipeline halts at Stage 1 (per orchestrator rule 4) and surfaces the rejection in the desktop UI with a remediation prompt: "Either supply a citation by adding an authorizing artifact to the bundle and re-running, OR downgrade STK-13 to ASSUMPTION with a named owner."

**Why this priority:** This is the headline behaviour. Without it, fabrication still cascades through Stages 2–5 and we ship the same eight-artifact-family contamination the example forensic identifies. P1 because every other story is a refinement.

**Independent Test:** Run a factory pipeline against a fixture bundle that exercises a mock Stage 1 emitting one fabricated claim (`STK-FAKE` naming `XYZ Corp` with no corpus backing). Assert the Stage 1 gate fails with `QG-13` FAIL, the run does not proceed to Stage 2, the desktop UI surfaces the rejection, and `provenance.json` records `STK-FAKE` as `REJECTED`.

**Acceptance Scenarios:**

1. **Given** a Stage 1 output containing one claim whose text names external entities not in the project allowlist, **When** the validator runs, **Then** for each external entity it walks every `ExtractionOutput.text` (and `pages[].text` for paginated objects) in the artifact-store corpus, applying case-insensitive substring match with normalized whitespace + Unicode NFC; if zero hits are found AND no `ASSUMPTION` tag is present, the claim is recorded as `REJECTED`.
2. **Given** any `REJECTED` claim exists, **When** `QG-13_ExternalProvenance` evaluates in `STRICT` mode, **Then** it returns FAIL, and the Stage 1 gate machinery (`crates/factory-engine/src/stages/quality_gates.rs`) blocks pipeline advancement with a typed `qg13_blocked` error carrying the rejected claim ids.
3. **Given** the gate is blocked, **When** the operator inspects the failure in the desktop UI, **Then** they see (a) the claim id, (b) the external entities detected, (c) the corpus files searched and the search-attempt count, (d) the two remediation paths (supply citation OR downgrade to ASSUMPTION), with a one-click action for each.
4. **Given** an operator chooses "downgrade to ASSUMPTION", **When** they supply `{ owner, rationale }` and budget capacity exists, **Then** the claim's `provenanceMode` becomes `ASSUMPTION`, `QG-13` re-evaluates and passes if no `REJECTED` claims remain, and the pipeline advances.

---

### User Story 2 — `ASSUMPTION`-tagged INT-* produces no code at Stage 4/5 (Priority: P1)

An `INT-003-CANDIDATE` claim is admitted as `ASSUMPTION` with `owner: "Program Director (or delegate)"` and `rationale: "Globex integration plausible Phase-2 scope; pending Globex Finance IT authorization"`. The Stage 1 gate passes; Stages 2–3 process the claim spec-only (data model and API surface include placeholder records); Stage 4 reads `assumption-only-manifest.md`, recognizes `INT-003-CANDIDATE` is `ASSUMPTION`, and emits NO `payment_request` DDL, NO `createPaymentRequestStub` function, NO `IntegrationPendingBanner.vue` placements, NO `TC-021/TC-022` test fixtures. Instead it appends to a sibling `pending-promotion.md` listing what would be emitted on promotion to `DERIVED`. CI for the generated code is green; nothing references `INT-003-CANDIDATE` as a live integration.

**Why this priority:** This is the failure-mode prevention. Without it, the `ASSUMPTION` tag is decorative and code still ships. P1 because every fabrication-class claim that survives Stage 1 must be quarantined.

**Independent Test:** Seed a project with one `ASSUMPTION`-tagged `INT-*` claim. Run Stages 2–5. Assert (a) generated DDL contains zero references to the claim's vendor, (b) generated services contain zero stub functions for the claim, (c) generated UI contains zero pending banners for the claim, (d) generated tests contain zero fixtures for the claim, (e) `pending-promotion.md` lists what would have been emitted on promotion.

**Acceptance Scenarios:**

1. **Given** an `ASSUMPTION`-tagged `INT-*` claim in `provenance.json`, **When** Stage 4 (data model + DDL) runs, **Then** the stage's DDL emitter consults `assumption-only-manifest.md` and skips emission of any table, column, foreign key, or check constraint whose origin is the claim's `anchorHash`.
2. **Given** the same `ASSUMPTION`-tagged claim, **When** Stage 5 (UI + tests) runs, **Then** the stage skips emission of any form field, banner placement, or test case whose `originAnchor` is the claim's `anchorHash`, and appends a record to `pending-promotion.md`.
3. **Given** all `ASSUMPTION`-tagged claims have a populated `pending-promotion.md` entry, **When** CI's `assumption-only-manifest-honored` check runs, **Then** it greps the generated code surface for any reference to an `ASSUMPTION` claim's vendor / system name and FAILs if any reference exists outside `pending-promotion.md`.
4. **Given** a citation arrives in the corpus on a later run that would back the claim, **When** the validator re-runs, **Then** it records a `candidatePromotion: { citation, pendingOperatorReview: true }` field on the claim, but does NOT auto-promote `ASSUMPTION → DERIVED`. The desktop UI surfaces the candidate for one-click operator approval.

---

### User Story 3 — Charter reword preserves `BR-007` (Priority: P1)

A run completes; `BR-007` ("applicant must be a registered partner organization") has `anchorHash = sha256("requirement:applicant:registered-partner-organization")`. The stakeholder rewords the charter from "applicant must be a registered partner organization" to "the applying organization is required to hold registered-partner-organization status." Stage 1 reruns. The new wording's normalized concept hash is identical to the previous run's. The `id-registry.json` returns `BR-007`. Downstream Stage 4 zod schemas, Stage 5 form bindings, and `TC-` test cases that reference `BR-007` continue to point at the same requirement; cascade re-runs only re-emit the wording on the form label, not the schema or the test.

**Why this priority:** Without anchor stability, every charter reword renumbers `BR-NNN` and the cascade re-emits the entire DDL/zod/test set. Hand-fixes downstream are obliterated. P1 because the loop is unusable in practice if every reword is a full reset.

**Independent Test:** On a project with a settled `BR-007`, edit the charter to reword the same requirement (keeping the underlying concept identical). Re-run Stage 1. Assert (a) `BR-007` is preserved, (b) no new `BR-NNN` is minted for the reworded text, (c) the only delta in the generated artifacts is the wording in the form label, (d) `id-registry.json` is unchanged.

**Acceptance Scenarios:**

1. **Given** a claim minted by Stage 1 with text "the applying organization is required to hold registered-partner-organization status", **When** the validator computes `anchorHash`, **Then** it normalizes the text (lowercase, strip articles/connectives, sort terms in canonical order, drop modal verbs) before sha256, producing the same hash as for the original wording.
2. **Given** an `id-registry.json` with `sha256:abc... → BR-007`, **When** Stage 1 emits a claim with the matching `anchorHash`, **Then** the validator assigns `BR-007` to the new claim, NOT a fresh ID, and records `regeneratedAt` on the registry entry.
3. **Given** a genuinely-new concept appears in Stage 1 output, **When** the validator computes its `anchorHash`, **Then** the registry assigns the next free `BR-NNN`, and the new entry's `firstMintedAt` is recorded.
4. **Given** two claims minted in the same run produce the same `anchorHash` (collision), **When** the validator detects the collision, **Then** Stage 1 fails with `provenance.duplicate_anchor` carrying both claim texts; the operator must split or merge before the gate passes.

---

### User Story 4 — Retroactive audit on contaminated example BRD (Priority: P2)

The example project has a contaminated BRD (`STK-13`, `INT-003`, `OPEN-004`, possibly more). The operator runs `provenance-validator audit --project acme-example-portal` without re-running Stage 1. The tool reads the existing BRD, reads the existing extraction corpus (or builds one from the project's `.artifacts/extracted/` if spec 120 has not yet been retrofitted), and produces `requirements/audit/retroactive-provenance-report.md` listing every claim that would be `REJECTED` under the rule, every borderline claim (single weak hit, fuzzy match), and every `ASSUMPTION` candidate. No code is regenerated; the report is the deliverable.

**Why this priority:** The contaminated example BRD already exists. Forcing a full Stage 1 rerun to discover what's wrong is expensive and delete-and-restart is worse. P2 because new projects benefit from the gate from day one and don't need the audit; existing projects need this once.

**Independent Test:** Run `provenance-validator audit` against the example project. Assert the report (a) names `STK-13`, `INT-003`, `SN-022` as `REJECTED`, (b) lists their detected external entities and zero corpus hits, (c) names borderline claims (e.g., single-source citations with weak matches), (d) totals a count of REJECTED + borderline + ASSUMPTION candidates, (e) does NOT modify any artifact.

**Acceptance Scenarios:**

1. **Given** an existing project with a BRD and an extracted corpus (either spec-120 typed or legacy `.txt`), **When** `provenance-validator audit` runs, **Then** it parses the BRD's claims by anchor (`### STK-NN`, `### INT-NN`, etc.), runs the same validator logic as the live gate, and produces `retroactive-provenance-report.md` with the per-claim findings.
2. **Given** the corpus is in legacy flat-`.txt` format (pre-spec-120), **When** the audit runs, **Then** the validator builds a synthetic `ExtractionOutput` from each `.txt` file (assigning page boundaries by heuristic) and runs against that. The report flags this in a header so the operator knows the audit is approximate.
3. **Given** the audit finds findings, **When** the operator inspects them, **Then** each finding includes (a) claim id, (b) external entities detected, (c) per-entity corpus search summary (files searched, hit count, fuzziness threshold), (d) suggested remediation (supply citation / downgrade to ASSUMPTION / accept as DERIVED with weak match).
4. **Given** the audit completes, **When** the operator reads the report header, **Then** it shows the total claim count, the count by `provenanceMode`, the suggested next action, and a one-line summary of the project's `provenanceHealth` (e.g. `8 REJECTED of 142 claims = 5.6% fabrication rate`).

---

### User Story 5 — Citation drift on corpus change (Priority: P2)

A project has `BR-031` `DERIVED` from `extracted/Business Case.docx.txt` lines 21–23 with `quoteHash = sha256("...60+ forms returned for correction per cycle...")`. A new run uploads a revised business case to the bundle; the original phrasing is now `"approximately 60 forms come back for correction in each cycle"`. The validator detects `extractedCorpusHash` has changed, re-runs every `DERIVED` claim's `quoteHash` against the new corpus, finds `BR-031`'s `quoteHash` no longer matches any verbatim span, downgrades the claim to `ASSUMPTION-orphaned`, and surfaces it in the drift report. The Stage 1 gate re-evaluates: if the project's assumption budget can accommodate the new orphan, the gate passes with a warning; otherwise it blocks until the operator re-cites or removes the claim.

**Why this priority:** Corpus changes are routine — connectors re-sync, scans get re-OCR'd, stakeholders attach updated documents. Without drift detection a stale citation silently passes. P2 because day-one projects with stable bundles don't see this; long-running projects do.

**Independent Test:** On a project with several `DERIVED` claims, replace one extracted file with a reworded version. Re-run the validator. Assert (a) `extractedCorpusHash` is recomputed, (b) the claim whose citation no longer matches is downgraded to `ASSUMPTION-orphaned`, (c) the drift report names the claim, the missing quote, and the closest fuzzy match in the new corpus, (d) the Stage 1 gate's behavior matches the budget rule.

**Acceptance Scenarios:**

1. **Given** the validator's previous run recorded `extractedCorpusHash = h1`, **When** it runs again and recomputes the hash from the artifact-store inventory and finds `h2 != h1`, **Then** it walks every `DERIVED` claim's `quoteHash` against the new corpus and re-validates each.
2. **Given** a claim's `quoteHash` no longer matches any verbatim span in the new corpus, **When** the validator handles the orphan, **Then** it sets `provenanceMode: ASSUMPTION-orphaned`, records `previousCitation`, attempts a fuzzy-match suggestion (Levenshtein distance ≤ 5% of quote length), and emits a drift entry.
3. **Given** the orphan brings the project's `ASSUMPTION` count above the budget cap, **When** the gate evaluates, **Then** it blocks with `assumption_budget_exceeded` and lists the orphans for operator review.
4. **Given** the operator approves a fuzzy-match suggestion (re-citing the claim against the new wording), **When** the validator records the new citation, **Then** the claim's `provenanceMode` returns to `DERIVED`, the orphan record is cleared, and the budget recovers.

---

### Edge Cases

- **Allowlist bootstrap on first run.** The very first Stage 1 run on a new project has no charter, no entity-model.yaml, and no prior allowlist. Bootstrap rule: combine (a) the built-in core (jurisdiction nouns, common verbs, English stopwords), (b) the project name and slug, (c) all proper nouns surfaced in the extracted corpus by simple capitalized-token scan. The bootstrap allowlist is intentionally generous (false positives are cheap; missed external entities are catastrophic). Subsequent runs refine.
- **Allowlist cache vs re-derivation.** Allowlist is cached in `provenance.json.allowlistVersion` keyed by hashes of its inputs. Re-derived only when an input changes. Cheap.
- **Anchor hash collision.** Two claims with the same `anchorHash` are flagged as duplicates. The operator must split (different concepts) or merge (genuinely the same). The validator does NOT pick a winner.
- **Claim text with no external entities at all.** `provenanceMode: DERIVED` with `namesExternalEntity: false, citations: []`. No citation required for purely internal, project-bounded claims. The allowlist's job is to draw this line correctly.
- **Citation pointing at an ASSUMPTION-tagged extracted file.** Claims cited against a file that is itself an OPC-side OR server-side `ASSUMPTION`-tagged extraction (e.g., the agent extractor returned uncertain output) inherit a weakened `provenanceMode: DERIVED-weak`. They do not block the gate but are surfaced in the report.
- **Assumption budget set to zero.** Some workspaces (regulatory) require zero assumptions. A project whose budget is zero refuses any `ASSUMPTION`-tagged claim and the gate cannot pass without supplying citations. This is enforceable.
- **`ASSUMPTION`'s `expiresAt` passes.** A claim whose `expiresAt` is in the past is treated as `REJECTED` on the next gate evaluation. Operators get a notification on expiry-week so they can refresh, downgrade, or supply a citation before the gate re-blocks.
- **Corpus reduces to empty.** If the bundle is emptied (all knowledge objects removed), every `DERIVED` claim's citation orphans. The gate refuses to pass; the operator must either restore the corpus, downgrade en-masse, or accept the project is no longer derivable from evidence.
- **Validator panics or fails.** A panic in the validator MUST fail the gate closed. There is no "validator unavailable → claim accepted" fallback. Stage gates depend on the validator producing a definite verdict.
- **Schema version mismatch.** If `provenance.json` declares `schemaVersion 1.0` and the validator binary embeds `1.1`, the validator refuses to run with `precondition_failed: schema_version_too_old` and instructs the operator to re-run Stage 1, which writes a fresh `1.1` file. No silent migrations.
- **Operator forges a citation manually.** A citation whose `quoteHash` does not match the actual `quote` in the cited source line range fails verification (the validator re-computes `quoteHash` from the corpus). This catches both honest typos and intentional bypass attempts. Records as `REJECTED` with reason `quote_hash_mismatch`.

## 5. Requirements

### 5.1 Functional Requirements

#### Validator crate

- **FR-001**: A new crate `crates/provenance-validator` MUST be added, with a public function `pub fn validate(claims: &[Claim], corpus: &Corpus, allowlist: &Allowlist, budget: &AssumptionBudget) -> ValidationReport`. The crate MUST depend only on `factory-contracts`, `serde`, `serde_json`, `sha2`, and `unicode-normalization`. It MUST NOT depend on any LLM client.
- **FR-002**: The validator MUST be deterministic for the same inputs. Two invocations against the same `(claims, corpus, allowlist, budget)` MUST produce byte-identical `ValidationReport` outputs.
- **FR-003**: The crate MUST expose a `pub fn audit(project_dir: &Path) -> AuditReport` entry point that runs in retroactive mode against an existing project's BRD + extracted corpus without invoking Stage 1.
- **FR-004**: The validator MUST be invoked by `crates/factory-engine/src/stages/quality_gates.rs` after Stage 1 emission and before the Stage 1 gate evaluates. The integration point is a new gate function `pub fn evaluate_qg13(stage_outputs: &Stage1Outputs) -> QualityGateResult`.
- **FR-005**: A panic or unhandled error in the validator MUST fail the gate closed with `qg13_validator_panic` and the original error embedded. There MUST NOT be a fallback that admits unvalidated claims.

#### Provenance schema

- **FR-006**: A new module `crates/factory-contracts/src/provenance.rs` MUST define serde types:
  - `Claim { id: ClaimId, kind: ClaimKind, stage: u8, mintedAt: DateTime, text: String, anchorHash: AnchorHash, provenanceMode: ProvenanceMode, citations: Vec<Citation>, assumption: Option<AssumptionTag>, namesExternalEntity: bool, extractedEntityCandidates: Vec<String>, candidatePromotion: Option<CandidatePromotion> }`
  - `ProvenanceMode { Derived, DerivedWeak, Assumption, AssumptionOrphaned, Rejected { reason: String } }`
  - `Citation { source: PathBuf, lineRange: (u32, u32), quote: String, quoteHash: QuoteHash }`
  - `AssumptionTag { owner: String, rationale: String, expiresAt: DateTime }`
  - `IdRegistry { anchors: BTreeMap<AnchorHash, ClaimId>, entries: BTreeMap<ClaimId, IdRegistryEntry> }`
- **FR-007**: The provenance schema version MUST be a compile-time const `pub const PROVENANCE_SCHEMA_VERSION: &str = "1.0.0"`. The schema parity check from spec 120 MUST be extended to cover `provenance.rs` against any TypeScript mirror in statecraft (currently `platform/services/statecraft/api/governance/provenancePolicy.ts` reserved for the mirror).
- **FR-008**: The validator MUST emit a single `provenance.json` per project to the artifact store, at a stable path resolved by `factory-engine`'s artifact-store conventions. The file is cumulative across runs (one file, append-on-mint, update-in-place per claim).
- **FR-009**: A sibling `id-registry.json` MUST persist the `AnchorHash → ClaimId` mapping across runs. It MUST be checked into the project workspace (NOT regenerated from scratch on each run) so anchor stability survives a clean rebuild.
- **FR-010**: A sibling `assumption-only-manifest.md` MUST be emitted listing every `ASSUMPTION`-tagged or `ASSUMPTION-orphaned` claim with `id`, `kind`, `owner`, `rationale`, `expiresAt`, and `pendingPromotionPath` (where to look on promotion).

#### Anchor hashing

- **FR-011**: `anchorHash` for a claim MUST be computed by: (a) lowercase the claim text, (b) Unicode NFC normalize, (c) strip articles `{a, an, the}` and connectives `{is, are, must, may, can, will, shall}`, (d) tokenize, (e) sort tokens lexicographically and deduplicate, (f) join with single spaces, (g) sha256 the result. The procedure MUST be implemented identically in the validator and in any downstream consumer (e.g., spec 122's Stage CD comparator).
- **FR-012**: The normalization procedure MUST be exposed as a public function `pub fn anchor_hash(text: &str) -> AnchorHash` in the validator crate so other crates can compute consistent hashes.
- **FR-013**: An `id-registry.json` lookup that returns a `ClaimId` MUST also stamp the entry with `regeneratedAt: DateTime` so the operator can see how many regenerations a stable ID has survived.
- **FR-014**: A new claim with no matching `anchorHash` in the registry MUST be assigned the next free `<KIND>-<NNN>` (e.g., `BR-008` if the highest existing `BR-` is `BR-007`). The validator MUST reserve and increment the counter atomically per kind.

#### Allowlist

- **FR-015**: The allowlist MUST be computed by `crates/provenance-validator/src/allowlist.rs::derive(project: &ProjectContext) -> Allowlist`. Inputs: (a) built-in core (file: `crates/provenance-validator/data/core-allowlist.txt`), (b) project name + slug + workspace name, (c) capitalized-token scan over the typed extraction corpus (frequency-thresholded), (d) `entity-model.yaml` from prior Stage 2 outputs if present, (e) charter vocabulary from spec 122 if present.
- **FR-016**: External-entity detection MUST flag any noun phrase in claim text whose lowercased form is NOT in the allowlist AND is plausibly an organization/system/product name. The plausibility heuristic is a simple regex over capitalization + token shape; semantic NER is explicitly out of scope.
- **FR-017**: The allowlist MUST be cached on disk at a stable path keyed by a hash of its inputs. Re-derived only when any input changes. The current allowlist version MUST be recorded in `provenance.json.allowlistVersion`.
- **FR-018**: A workspace policy slice (resolved via spec 047 governance) MAY override the allowlist generosity setting (`generous | strict`). Default `generous` (false positives over false negatives).

#### Citation matching

- **FR-019**: Citation matching MUST be verbatim with normalized whitespace + Unicode NFC. The validator computes `quoteHash = sha256(NFC(normalize_whitespace(quote)))` and asserts the same hash appears at the cited `lineRange` in the cited source. Match is exact; no fuzzy matching at this stage (drift detection in FR-022 handles fuzziness separately).
- **FR-020**: A citation whose declared `quoteHash` does not match the actual content at `lineRange` in the cited source MUST be `REJECTED` with reason `quote_hash_mismatch`. This catches both stale citations and forged ones.
- **FR-021**: The validator MUST search every `ExtractionOutput.text` AND every `pages[].text` (when paginated) in the artifact-store corpus. It MUST produce a per-entity search summary in the report: `{ entity, filesSearched, pagesSearched, hitCount, hits: [{ source, lineRange, quote }] }`.
- **FR-022**: When `extractedCorpusHash` (computed from the artifact-store inventory hash, NOT individual file hashes) changes between runs, the validator MUST re-validate every `DERIVED` claim's `quoteHash`. Orphans are downgraded to `ASSUMPTION-orphaned` and the drift report is emitted.

#### Quality gate and modes

- **FR-023**: A new rule `FAC-S1-011` MUST be added to `crates/factory-engine/skills/validate.md` (or its compiled equivalent if the factory engine internalizes skill prose at compile time). The rule's full text MUST match the validator's behaviour: every claim that names an external entity must carry a verbatim citation OR an `ASSUMPTION` tag.
- **FR-024**: A new quality gate `QG-13_ExternalProvenance` MUST be added to the Stage 1 gate set. In `STRICT` mode it returns FAIL on any `REJECTED` claim. In `PERMISSIVE` mode it returns WARN.
- **FR-025**: The mode MUST be set per project via `factory-config.yaml` (or equivalent) with a `provenance.mode: STRICT | PERMISSIVE` key. Default for ALL projects is `STRICT` from the first run — there is NO permissive ramp. Existing projects whose BRDs predate this spec MUST complete a retroactive audit (FR-036) and resolve every `REJECTED` claim (by supplying a citation, downgrading to `ASSUMPTION`, or removing the claim) before the first `STRICT`-mode run will pass. `PERMISSIVE` remains available via explicit operator opt-in for projects with a deliberate, audit-logged reason.
- **FR-026**: A workspace policy slice MAY pin the mode irrespective of project config. A regulated workspace can force `STRICT` everywhere.
- **FR-027**: Mode changes MUST be audit-logged via `audit_log` action `factory.provenance_mode_changed` with `{ project, from, to, actor, reason }`.

#### Assumption budget

- **FR-028**: A project's assumption budget MUST be declared in `factory-config.yaml` with `provenance.assumptionBudget: <integer>`. Default 10. A workspace policy MAY pin a maximum.
- **FR-029**: Each `ASSUMPTION`-tagged claim MUST consume one slot. `ASSUMPTION-orphaned` claims also consume one slot. The validator MUST refuse to admit an `ASSUMPTION` claim that would push the count over the budget.
- **FR-030**: An `ASSUMPTION`'s `expiresAt` MUST be at most 90 days from `taggedAt`. Default 30 days. On expiry, the claim is treated as `REJECTED` until refreshed.
- **FR-031**: An `ASSUMPTION` MUST have `owner` populated with a non-empty string. The owner is informational at this layer (not a directory lookup); a future spec may bind to identity (spec 080 onboarding).

#### Cross-stage cascade

- **FR-032**: Stage 4 (data model + DDL) MUST read `assumption-only-manifest.md` and skip emission of any DDL artifact whose origin claim's `anchorHash` matches an `ASSUMPTION` or `ASSUMPTION-orphaned` entry. Skipped artifacts MUST be appended to `pending-promotion.md` with the would-have-been emission spec.
- **FR-033**: Stage 5 (UI + tests) MUST apply the same skip rule. Generated UI MUST contain zero references to vendor / system names from `ASSUMPTION` claims. Generated tests MUST contain zero fixtures for them.
- **FR-034**: A new CI check `assumption-only-manifest-honored` (in `tools/oap/ci-parity-check` or equivalent) MUST scan generated code for any reference to an `ASSUMPTION` claim's vendor / system surface forms (the entity strings recorded in `extractedEntityCandidates`) and FAIL if any reference exists outside `pending-promotion.md`.
- **FR-035**: Promotion of an `ASSUMPTION` claim to `DERIVED` MUST emit `audit_log` action `factory.provenance_promoted` with `{ claimId, fromMode, toMode, citation, actor }`. The operator who approves the promotion is the actor of record.

#### Audit (retroactive)

- **FR-036**: The `provenance-validator audit` subcommand MUST accept `--project <path>` and `--corpus <path>` arguments. When `--corpus` is omitted, the tool walks the project's artifact store for the typed extraction; when no typed extraction exists, the tool reads `.artifacts/extracted/*.txt` legacy files and synthesizes a flat `ExtractionOutput` per file.
- **FR-037**: The audit MUST emit `requirements/audit/retroactive-provenance-report.md` with: header summary (total claims, by mode), per-claim findings, suggested remediation per finding, and a project `provenanceHealth` percentage.
- **FR-038**: The audit MUST NOT modify any artifact in the project. It is read-only and produces only the report file.
- **FR-039**: When run in legacy `.txt` mode, the report header MUST flag `synthesizedCorpus: true` and explain that page-boundary heuristics are approximate.

#### Observability

- **FR-040**: Each validator run MUST emit `audit_log` action `factory.provenance_validated` with `{ project, totalClaims, derivedCount, assumptionCount, rejectedCount, mode, durationMs }`.
- **FR-041**: The desktop UI's pipeline view MUST surface the validation report for each Stage 1 run: per-claim mode, citations, and one-click remediation actions (supply citation, downgrade to ASSUMPTION, promote ASSUMPTION).
- **FR-042**: A workspace-level dashboard panel `Provenance Health` MUST aggregate per-project rejected/assumption rates and surface trends across runs. (Implementation may defer to a follow-up; spec reserves the surface.)

### 5.2 Key Entities

- **`Claim`** (new, in `factory-contracts/src/provenance.rs`): one record per ID minted by Stage 1 or any later stage. Cumulative across runs, indexed by `ClaimId`.
- **`Corpus`** (new, in `provenance-validator/src/citation.rs`): an in-memory view over all typed `ExtractionOutput` artifacts in the project's artifact store. Built once per validator run.
- **`Allowlist`** (new, in `provenance-validator/src/allowlist.rs`): the project allowlist, cached.
- **`AssumptionBudget`** (new): per-project counter and cap.
- **`IdRegistry`** (new, persisted as `id-registry.json`): the `AnchorHash → ClaimId` mapping that survives across runs.
- **`provenance.json`** (new artifact): the per-project provenance record. Cumulative.
- **`assumption-only-manifest.md`** (new artifact): the parallel listing Stages 4–5 read.
- **`pending-promotion.md`** (new artifact): records what would be emitted on `ASSUMPTION → DERIVED` promotion.
- **`retroactive-provenance-report.md`** (new artifact, audit mode only).

### 5.3 Permissions and audit

- Validator invocations from inside the factory pipeline inherit the run's existing identity; no new permission.
- `provenance-validator audit` (CLI) requires only filesystem access to the project; it does not touch network resources.
- Mode changes (`STRICT` ⇄ `PERMISSIVE`) and `ASSUMPTION → DERIVED` promotions require workspace-membership; workspace admins may pin the mode globally.
- Every validator run, every mode change, and every promotion emits an `audit_log` row. Skipped artifacts at Stage 4/5 also emit a row (`factory.assumption_skip_emitted`) so audit reconstructs what was deferred.

### 5.4 Out-of-process operations

- The validator runs in-process inside `crates/factory-engine`; there is no separate daemon.
- Allowlist derivation reads files from disk only.
- Citation matching reads typed `ExtractionOutput` from the artifact store via the standard `factory-engine` artifact-store APIs (spec 094) — no direct filesystem access.

## 6. Success Criteria

### Measurable Outcomes

- **SC-001**: Running the validator on the synthetic fabrication BRD in `audit` mode reports `STK-13`, `INT-003`, and `SN-022` as `REJECTED`. Verified by the synthetic `payment-scope-fabrication` fixture.
- **SC-002**: A fault-injected Stage 1 mock that emits a fabricated claim (entity not in allowlist, no citation) is blocked at the gate in `STRICT` mode 100% of the time. The pipeline does NOT advance to Stage 2. Verified by an integration test with a fake LLM transport.
- **SC-003**: An `ASSUMPTION`-tagged `INT-*` claim produces zero references in generated DDL, services, UI, and tests across a fixture project. The `assumption-only-manifest-honored` CI check confirms this.
- **SC-004**: Re-running Stage 1 on a project whose charter has been reworded (concept unchanged) preserves all `BR-NNN` IDs from the prior run. Verified by a fixture comparing `id-registry.json` before/after.
- **SC-005**: When the extraction corpus is replaced with a reworded version, every `DERIVED` claim whose `quoteHash` no longer matches is downgraded to `ASSUMPTION-orphaned` and surfaced in the drift report. Zero silent passes.
- **SC-006**: `PERMISSIVE` mode WARNs on `REJECTED` claims but does NOT block the gate; `STRICT` mode blocks. Verified by toggling the mode flag in a fixture and asserting gate behavior.
- **SC-007**: Assumption budget exhaustion fails the gate cleanly with `assumption_budget_exceeded` and the rejected claim list. Verified by a fixture project with budget = 1 and two `ASSUMPTION` candidates.
- **SC-008**: An `ASSUMPTION` whose `expiresAt` is in the past is treated as `REJECTED` on the next gate evaluation. Verified by clock-fixture.
- **SC-009**: Anchor-hash collision detection FAILs Stage 1 with `provenance.duplicate_anchor` carrying both claim texts. Verified by fixture.
- **SC-010**: The validator is byte-deterministic: two runs against the same inputs produce identical `provenance.json` files. Verified by a property test.
- **SC-011**: Schema parity check (extended from spec 120) FAILs CI on any drift between `provenance.rs` and its TS mirror. Verified by deliberate-drift regression test.
- **SC-012**: `provenance-validator audit` on a legacy-corpus project (no spec-120 artifacts) produces a report with `synthesizedCorpus: true` flagged in the header and approximately-correct findings. Verified against a frozen synthetic snapshot.

## 7. Open Decisions

- **`PERMISSIVE` mode lifecycle.** ~~Should `PERMISSIVE` exist permanently or only as a one-run ramp on first activation?~~ **RESOLVED 2026-04-30:** `STRICT` is the default for all projects from the first run; there is no permissive ramp. Existing projects retrofit via the FR-036 retroactive audit, which produces a punch list of `REJECTED` claims that operators resolve (cite / downgrade / remove) before adoption. `PERMISSIVE` remains a config option for explicit, audit-logged opt-in but is not the default for any new or migrated project.
- **Auto-promotion of `ASSUMPTION → DERIVED` on citation arrival.** V1: never auto-promote; record the candidate and require operator review. Tradeoff: pure automation vs governance-grade transitions. Open to revision after first six months of use.
- **Allowlist generosity tuning.** V1's allowlist is intentionally generous (false positives cheap). If operator fatigue from over-flagging becomes an issue, the workspace policy may pin `generous | strict`. Long-term: per-project tuning curves.
- **Allowlist co-evolution with charter authoring.** Spec 122 introduces authored stakeholder docs as input. Once 122 lands, the charter's vocabulary becomes the primary allowlist source. V1 (this spec, before 122) bootstraps from corpus surface forms; the transition is clean (the auto-derived layer just gets richer inputs).
- **Cross-stage cascade depth.** This spec defines Stage 4/5 skips. Stage 2/3 may also need skip rules (data model + API surface), but those stages are spec-only by nature so the impact is smaller. Decision deferred to plan.md.
- **`id-registry.json` as project artifact vs workspace artifact.** V1: per-project, checked into the project workspace. A workspace-level registry would let two projects share `BR-007` for the same anchor; not in V1.
- **Quote-hash tolerance for whitespace-only changes.** V1: normalize whitespace + NFC, no other tolerance. A future iteration may add tolerance for trivial differences (e.g., curly vs straight quotes); for now, fail closed and require re-citation.
- **Validator's home for the legacy `.txt` audit mode.** V1: synthesized `ExtractionOutput` from each `.txt` with heuristic page boundaries. If audits become routine, a proper `legacy-corpus-loader` module may be split out.

## 8. Provenance

- `crates/provenance-validator/` — new crate; the validator binary and library.
- `crates/factory-contracts/src/provenance.rs` — new types module mirroring (when a TS mirror exists) `platform/services/statecraft/api/governance/provenancePolicy.ts`.
- `crates/factory-engine/src/stages/quality_gates.rs` — gate evaluator gains `evaluate_qg13`.
- `crates/factory-engine/src/stages/s1_business_requirements.rs` — Stage 1 driver invokes validator after emission.
- `crates/factory-engine/skills/validate.md` (or compiled equivalent) — adds `FAC-S1-011`.
- `crates/factory-engine/skills/business-requirements-analyst.md` — annotated with the new validation expectations (Stage 1 MUST emit citations alongside claims).
- `platform/services/statecraft/api/governance/provenancePolicy.ts` — reserved path for future TS mirror; the schema parity check from spec 120 extends to cover it.
- `requirements/audit/retroactive-provenance-report.md` (per-project, audit-mode only) — output path reserved.
- Forensic record: `_tmp/acme-fabrication-forensic.md` (operator's local copy at `acme-example-portal/requirements/debug/Forensic-Analysis_ACME-Integration-Scope-Provenance.md`) — the in-the-wild contamination this spec prevents.
- Spec 120 — typed extraction corpus this validator cites against.
- Spec 075 — factory-workflow-engine; gate machinery this validator plugs into.
- Spec 091 — registry-enrichment; eventual home for cross-project `provenance.json` aggregation.
- Spec 094 — unified artifact store; persistence layer for `provenance.json`, `id-registry.json`, `assumption-only-manifest.md`, `pending-promotion.md`.
- Spec 047 — governance control plane; provides the policy slice that may pin `provenance.mode`.
- Spec 118 (draft) — workflow-spec-traceability; once approved, the natural home for cross-run claim history.
- Spec 122 (planned) — stakeholder-doc inversion + Stage CD comparator; reuses this validator at the Stage CD comparator gate.
